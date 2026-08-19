-- ============================================================================
-- SHAREABLE LISTING LINKS: COMPANY AGENTS ONLY
-- ----------------------------------------------------------------------------
-- Narrows the feature added in 20260813140000 to exactly one kind of agent:
-- a sales agent created by an `admin` (a company owner). Those agents sell that
-- admin's stock, so a link they mint must point at that admin's company and
-- nothing else.
--
-- Who is now refused:
--   * super-admin-created agents — they sell the PLATFORM (they onboard new
--     companies), not any one company's products. There is no "their" catalogue
--     for them to share, and before this they inherited the super admin's own
--     tenant and could have minted links against it.
--   * sacco-side agents (agents.agent_type = 'sacco') — a sacco has members and
--     shares, not a product catalogue.
--   * anyone who is not an agent at all.
--
-- The portal already hides the Catalogue from those agents, but a hidden button
-- is not a control: create_asset_share_link is granted to `authenticated`, so
-- without this migration any signed-in user could call the RPC directly and
-- mint a link against whatever their current_admin_id() happened to resolve to.
-- This is where the rule actually lives.
--
-- NOTE ON TENANCY: this project scopes public.assets by `registered_by`
-- (resolved through the registrant's profile) — assets.admin_id does NOT exist
-- in the live database; 20260817120000 adds it but has not been applied. The
-- asset check below reads registered_by and *also* accepts an admin_id match
-- via to_jsonb(), which yields NULL when the column is absent. So this works
-- before and after that migration lands, without a second edit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. agent_company_admin_id() — the owning admin, or NULL if the caller is not
--    a company sales agent. This single function is the definition of
--    "created by an admin" for the whole feature.
--
--    The owner is resolved the same way the portal resolves agentMode: the
--    agents row first (a super admin provisioning an agent stamps the tenant
--    there, where it can differ from user_profiles.admin_id), then the caller's
--    own profile. The owner must hold the `admin` role — a super_admin owner
--    means a platform agent, which is precisely the case being excluded.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_company_admin_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT owner.id
  FROM public.agents a
  LEFT JOIN public.user_profiles me ON me.id = auth.uid()
  JOIN public.user_profiles owner ON owner.id = COALESCE(a.admin_id, me.admin_id)
  WHERE a.user_id = auth.uid()
    AND COALESCE(a.agent_type, '') <> 'sacco'
    AND owner.role = 'admin'::public.user_role
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_company_admin_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agent_company_admin_id() TO authenticated;

COMMENT ON FUNCTION public.agent_company_admin_id() IS
  'The admin whose company this sales agent sells for, or NULL when the caller is not an agent created by an admin. Gates the shareable-listing-link feature.';

-- ----------------------------------------------------------------------------
-- 2. create_asset_share_link() — same signature, two new refusals.
--    Replaces the 20260813140000 version. The only changes are the caller gate
--    at the top and the asset-ownership check, which is now pinned to the
--    agent's own admin instead of current_admin_id() with a global-viewer
--    escape hatch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_asset_share_link(
  p_asset_id        uuid,
  p_lead_id         uuid    DEFAULT NULL,
  p_recipient_name  text    DEFAULT NULL,
  p_recipient_phone text    DEFAULT NULL,
  p_recipient_email text    DEFAULT NULL,
  p_channel         text    DEFAULT 'copy',
  p_note            text    DEFAULT NULL,
  p_expires_days    integer DEFAULT 30
)
RETURNS public.asset_share_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_agent_id   uuid := public.get_agent_id_for_user(auth.uid());
  v_admin_id   uuid := public.agent_company_admin_id();
  v_phone      text := NULLIF(btrim(COALESCE(p_recipient_phone, '')), '');
  v_email      text := NULLIF(lower(btrim(COALESCE(p_recipient_email, ''))), '');
  v_key        text;
  v_channel    text := lower(COALESCE(NULLIF(btrim(p_channel), ''), 'copy'));
  v_expires    timestamptz;
  v_token      text;
  v_row        public.asset_share_links;
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Only a sales agent can create a shareable listing link.';
  END IF;

  -- The gate. A platform (super-admin-created) or sacco agent has no company
  -- catalogue of their own, so there is nothing here for them to share.
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Shareable listing links are only available to sales agents registered by a company admin.';
  END IF;

  -- The item must belong to THAT admin's company. No global-viewer bypass and
  -- no "I keyed the row in myself" branch: the link carries the company's
  -- stock, so the company is the only thing that may authorise it.
  IF NOT EXISTS (
    SELECT 1
    FROM public.assets ast
    LEFT JOIN public.user_profiles rp ON rp.id = ast.registered_by
    WHERE ast.id = p_asset_id
      AND (
        COALESCE(rp.admin_id, rp.id) = v_admin_id
        OR (to_jsonb(ast) ->> 'admin_id')::uuid = v_admin_id
      )
  ) THEN
    RAISE EXCEPTION 'That item is not in your company catalogue.';
  END IF;

  IF v_channel NOT IN ('copy', 'whatsapp', 'sms', 'email') THEN
    v_channel := 'copy';
  END IF;

  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = p_lead_id AND agent_id = v_agent_id
  ) THEN
    RAISE EXCEPTION 'That lead does not belong to you.';
  END IF;

  v_key := COALESCE(v_phone, v_email, p_lead_id::text, '');

  IF p_expires_days IS NOT NULL AND p_expires_days > 0 THEN
    v_expires := now() + make_interval(days => p_expires_days);
  END IF;

  SELECT * INTO v_row
  FROM public.asset_share_links
  WHERE agent_id = v_agent_id
    AND asset_id = p_asset_id
    AND recipient_key = v_key
    AND is_active
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.asset_share_links
       SET channel         = v_channel,
           note            = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), note),
           recipient_name  = COALESCE(NULLIF(btrim(COALESCE(p_recipient_name, '')), ''), recipient_name),
           recipient_phone = COALESCE(v_phone, recipient_phone),
           recipient_email = COALESCE(v_email, recipient_email),
           lead_id         = COALESCE(p_lead_id, lead_id),
           expires_at      = CASE
                               WHEN v_expires IS NULL THEN expires_at
                               WHEN expires_at IS NULL THEN NULL
                               ELSE GREATEST(expires_at, v_expires)
                             END,
           updated_at      = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  v_token := translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');

  BEGIN
    INSERT INTO public.asset_share_links (
      token, asset_id, agent_id, admin_id, lead_id,
      recipient_name, recipient_phone, recipient_email, recipient_key,
      channel, note, expires_at
    ) VALUES (
      v_token, p_asset_id, v_agent_id, v_admin_id, p_lead_id,
      NULLIF(btrim(COALESCE(p_recipient_name, '')), ''), v_phone, v_email, v_key,
      v_channel, NULLIF(btrim(COALESCE(p_note, '')), ''), v_expires
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
    FROM public.asset_share_links
    WHERE agent_id = v_agent_id
      AND asset_id = p_asset_id
      AND recipient_key = v_key
      AND is_active
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Could not create the link. Please try again.';
    END IF;
  END;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_asset_share_link(uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_asset_share_link(uuid, uuid, text, text, text, text, text, integer) TO authenticated;
