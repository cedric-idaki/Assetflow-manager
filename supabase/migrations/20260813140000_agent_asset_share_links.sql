-- ============================================================================
-- AGENT SHAREABLE LISTING LINKS  (sales agent → potential buyer, attributed)
-- ----------------------------------------------------------------------------
-- A sales agent picks an item out of their tenant's catalogue and sends the
-- buyer a link. The buyer opens a public page (no account, no login), and if
-- they enquire, the enquiry comes back as a LEAD ON THAT AGENT — which is what
-- makes the commission attributable. Without the link the enquiry would land
-- as an anonymous website lead and nobody could say whose sale it was.
--
-- Design:
--   * The token is minted here, from the CSPRNG, and is the only thing that
--     opens the page. 16 bytes → 22 base64url chars: short enough to paste into
--     a WhatsApp message, 128 bits of entropy so it cannot be walked.
--   * Tenancy follows public.assets, which this project scopes by
--     registered_by (NOT by an admin_id column — see 20260721100000). admin_id
--     is denormalised onto the link row so the owning admin can report on agent
--     performance without joining back through user_profiles every time.
--   * One link per (agent, asset, recipient). Re-sharing the same item with the
--     same buyer returns the SAME token, so "12 views" means twelve views of
--     one thing rather than twelve links with one view each.
--   * The public page is served by the `listing-public` Edge Function with the
--     service role. Nothing here is readable by anon: the tables below are
--     staff-scoped, and the two write RPCs are granted to service_role ONLY.
--
-- Attribution path:
--   asset_share_links.agent_id
--     → asset_share_enquiries.agent_id       (the buyer acted)
--       → leads.agent_id + leads.share_link_id  (the agent's pipeline)
--         → the existing conversion/commission machinery, unchanged.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. LEAD PROVENANCE — where a lead came from, when it came from a link.
--    Nullable: every lead registered by hand keeps these NULL.
-- ----------------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS share_link_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS asset_id      uuid;

CREATE INDEX IF NOT EXISTS idx_leads_share_link_id ON public.leads(share_link_id);
CREATE INDEX IF NOT EXISTS idx_leads_asset_id      ON public.leads(asset_id);

-- ----------------------------------------------------------------------------
-- 2. asset_share_links — one shareable listing link.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_share_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token            text NOT NULL UNIQUE,
  asset_id         uuid NOT NULL REFERENCES public.assets(id)  ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,
  admin_id         uuid,                                        -- tenant (denormalised)
  lead_id          uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  -- Who it was sent to. All optional — an agent may just want a link to paste
  -- into a group, in which case the link is attributed to them but to no one
  -- buyer in particular.
  recipient_name   text,
  recipient_phone  text,
  recipient_email  text,
  -- Normalised recipient identity, so re-sharing to the same person reuses the
  -- same token. '' = a general link with no named recipient.
  recipient_key    text NOT NULL DEFAULT '',

  channel          text NOT NULL DEFAULT 'copy',   -- copy | whatsapp | sms | email
  note             text,                            -- agent's message, shown on the page

  is_active        boolean NOT NULL DEFAULT true,
  expires_at       timestamptz,                     -- NULL = no expiry

  view_count       integer NOT NULL DEFAULT 0,
  enquiry_count    integer NOT NULL DEFAULT 0,
  first_viewed_at  timestamptz,
  last_viewed_at   timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT asset_share_links_channel_chk
    CHECK (channel IN ('copy', 'whatsapp', 'sms', 'email'))
);

CREATE INDEX IF NOT EXISTS idx_asset_share_links_agent  ON public.asset_share_links(agent_id);
CREATE INDEX IF NOT EXISTS idx_asset_share_links_asset  ON public.asset_share_links(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_share_links_admin  ON public.asset_share_links(admin_id);
CREATE INDEX IF NOT EXISTS idx_asset_share_links_token  ON public.asset_share_links(token);

-- The reuse key: one live link per (agent, asset, recipient).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_asset_share_links_agent_asset_recipient
  ON public.asset_share_links (agent_id, asset_id, recipient_key)
  WHERE is_active;

-- ----------------------------------------------------------------------------
-- 3. asset_share_link_views — the view trail behind view_count.
--    ip_hash is a SHA-256 of the address, never the address: the agent needs to
--    know the link was opened twice, not who by.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_share_link_views (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid NOT NULL REFERENCES public.asset_share_links(id) ON DELETE CASCADE,
  viewed_at     timestamptz NOT NULL DEFAULT now(),
  ip_hash       text,
  user_agent    text,
  referrer      text
);

CREATE INDEX IF NOT EXISTS idx_asset_share_link_views_link
  ON public.asset_share_link_views(share_link_id, viewed_at DESC);

-- ----------------------------------------------------------------------------
-- 4. asset_share_enquiries — the buyer acted. This is the attribution event.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_share_enquiries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid NOT NULL REFERENCES public.asset_share_links(id) ON DELETE CASCADE,
  asset_id      uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  admin_id      uuid,
  lead_id       uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  full_name     text NOT NULL,
  phone         text,
  email         text,
  message       text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_share_enquiries_agent ON public.asset_share_enquiries(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_share_enquiries_link  ON public.asset_share_enquiries(share_link_id);
CREATE INDEX IF NOT EXISTS idx_asset_share_enquiries_admin ON public.asset_share_enquiries(admin_id);

-- Now that asset_share_links exists, point the lead columns at it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'leads_share_link_id_fkey'
      AND table_name = 'leads' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_share_link_id_fkey
      FOREIGN KEY (share_link_id) REFERENCES public.asset_share_links(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'leads_asset_id_fkey'
      AND table_name = 'leads' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. RLS — agents see their own links; the tenant's staff see the tenant's.
--    There is no INSERT/UPDATE policy anywhere below: every write goes through
--    the SECURITY DEFINER functions in §6, so an agent cannot mint a link for
--    somebody else's asset, reassign one to themselves, or edit their own
--    view/enquiry counts.
-- ----------------------------------------------------------------------------
ALTER TABLE public.asset_share_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_share_link_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_share_enquiries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_own_or_tenant_share_links" ON public.asset_share_links;
CREATE POLICY "read_own_or_tenant_share_links"
ON public.asset_share_links FOR SELECT TO authenticated
USING (
  agent_id = public.get_agent_id_for_user(auth.uid())
  OR (admin_id = public.current_admin_id() AND public.is_staff_member())
  OR public.is_global_viewer()
);

DROP POLICY IF EXISTS "read_own_or_tenant_share_link_views" ON public.asset_share_link_views;
CREATE POLICY "read_own_or_tenant_share_link_views"
ON public.asset_share_link_views FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.asset_share_links l
    WHERE l.id = asset_share_link_views.share_link_id
      AND (
        l.agent_id = public.get_agent_id_for_user(auth.uid())
        OR (l.admin_id = public.current_admin_id() AND public.is_staff_member())
        OR public.is_global_viewer()
      )
  )
);

DROP POLICY IF EXISTS "read_own_or_tenant_share_enquiries" ON public.asset_share_enquiries;
CREATE POLICY "read_own_or_tenant_share_enquiries"
ON public.asset_share_enquiries FOR SELECT TO authenticated
USING (
  agent_id = public.get_agent_id_for_user(auth.uid())
  OR (admin_id = public.current_admin_id() AND public.is_staff_member())
  OR public.is_global_viewer()
);

-- ----------------------------------------------------------------------------
-- 6. create_asset_share_link() — the agent's one write path.
--    Verifies the asset really is in the caller's tenant (same rule as the
--    assets_tenant_manage policy in 20260708150000) before minting anything.
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
  v_admin_id   uuid;
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

  -- The asset must belong to the caller's tenant. Tenancy on assets runs
  -- through registered_by, so resolve the registrant's admin.
  SELECT COALESCE(rp.admin_id, rp.id, public.current_admin_id())
    INTO v_admin_id
  FROM public.assets ast
  LEFT JOIN public.user_profiles rp ON rp.id = ast.registered_by
  WHERE ast.id = p_asset_id
    AND (
      ast.registered_by = auth.uid()
      OR COALESCE(rp.admin_id, rp.id) = public.current_admin_id()
      OR public.is_global_viewer()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item is not in your catalogue.';
  END IF;

  IF v_channel NOT IN ('copy', 'whatsapp', 'sms', 'email') THEN
    v_channel := 'copy';
  END IF;

  -- A lead may only be attached if it is the caller's own lead.
  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = p_lead_id AND agent_id = v_agent_id
  ) THEN
    RAISE EXCEPTION 'That lead does not belong to you.';
  END IF;

  -- Identity of the recipient, for link reuse: phone, then email, then the
  -- lead, then '' for a general link.
  v_key := COALESCE(v_phone, v_email, p_lead_id::text, '');

  IF p_expires_days IS NOT NULL AND p_expires_days > 0 THEN
    v_expires := now() + make_interval(days => p_expires_days);
  END IF;

  -- Re-sharing the same item with the same person keeps the same token, so its
  -- view and enquiry counts stay on one row.
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
           -- Re-sharing renews an expiring link rather than sending a dead one.
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

  -- 16 bytes of CSPRNG as base64url — translate drops '=' (no replacement).
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
    -- Two taps on "Create link" race through the SELECT above together. The
    -- partial unique index is what actually enforces one live link per
    -- (agent, asset, recipient), so the loser of the race takes the winner's
    -- row rather than showing the agent an error for something that worked.
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

-- ----------------------------------------------------------------------------
-- 7. revoke_asset_share_link() — kill a link you own. Its stats survive; the
--    page stops opening.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_asset_share_link(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agent_id uuid := public.get_agent_id_for_user(auth.uid());
  v_rows     integer;
BEGIN
  IF v_agent_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.asset_share_links
     SET is_active = false, updated_at = now()
   WHERE id = p_id
     AND agent_id = v_agent_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. record_share_link_view() — called by the Edge Function on every page open.
--    Repeat opens from the same viewer inside 30 minutes are one view: a buyer
--    scrolling back up is not new interest, and an agent reading their own
--    stats should not be misled by it.
--    Returns true when the view was counted.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_share_link_view(
  p_link_id    uuid,
  p_ip_hash    text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_referrer   text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent boolean;
BEGIN
  IF p_link_id IS NULL THEN
    RETURN false;
  END IF;

  v_recent := p_ip_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.asset_share_link_views
    WHERE share_link_id = p_link_id
      AND ip_hash = p_ip_hash
      AND viewed_at > now() - interval '30 minutes'
  );

  IF v_recent THEN
    RETURN false;
  END IF;

  INSERT INTO public.asset_share_link_views (share_link_id, ip_hash, user_agent, referrer)
  VALUES (p_link_id, p_ip_hash, left(COALESCE(p_user_agent, ''), 400), left(COALESCE(p_referrer, ''), 400));

  UPDATE public.asset_share_links
     SET view_count      = view_count + 1,
         first_viewed_at = COALESCE(first_viewed_at, now()),
         last_viewed_at  = now(),
         updated_at      = now()
   WHERE id = p_link_id;

  RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. record_share_link_enquiry() — the buyer pressed "I'm interested".
--
--    Everything that makes the enquiry attributable happens here, in one
--    transaction: the enquiry row, the LEAD ON THE SHARING AGENT, and the
--    counter. If the same buyer enquires twice, the second enquiry attaches to
--    the lead the first one created instead of forking the pipeline.
--
--    Returns the agent's contact details so the Edge Function can notify them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_share_link_enquiry(
  p_token     text,
  p_full_name text,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL,
  p_message   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link       public.asset_share_links;
  v_asset      public.assets;
  v_agent      public.agents;
  v_phone      text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_email      text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
  v_name       text := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  v_lead_id    uuid;
  v_enquiry_id uuid;
  v_interest   text;
BEGIN
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A name is required.';
  END IF;

  IF v_phone IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'A phone number or an email address is required.';
  END IF;

  SELECT * INTO v_link FROM public.asset_share_links WHERE token = p_token;

  IF NOT FOUND OR NOT v_link.is_active
     OR (v_link.expires_at IS NOT NULL AND v_link.expires_at < now()) THEN
    RAISE EXCEPTION 'This link is no longer active.';
  END IF;

  SELECT * INTO v_asset FROM public.assets     WHERE id = v_link.asset_id;
  SELECT * INTO v_agent FROM public.agents     WHERE id = v_link.agent_id;

  v_interest := COALESCE(v_asset.description, 'Shared listing');

  -- Reuse the lead this link already produced, then any lead of THIS agent
  -- matching the buyer's phone or email. Only then create a new one.
  SELECT id INTO v_lead_id
  FROM public.leads
  WHERE agent_id = v_link.agent_id
    AND (
      share_link_id = v_link.id
      OR (v_phone IS NOT NULL AND phone = v_phone)
      OR (v_email IS NOT NULL AND lower(email) = v_email)
    )
  ORDER BY (share_link_id = v_link.id) DESC, created_at DESC
  LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (
      agent_id, full_name, phone, email, asset_interest, budget_range,
      priority, stage, source, notes, share_link_id, asset_id
    ) VALUES (
      v_link.agent_id, v_name, v_phone, v_email, v_interest,
      CASE WHEN COALESCE(v_asset.selling_price, 0) > 0
           THEN to_char(v_asset.selling_price, 'FM999,999,999,999') END,
      -- Someone who found the listing, read it and typed their number in is a
      -- warmer lead than a name off a list.
      'high'::public.lead_priority,
      'new_lead'::public.lead_stage,
      'shared_link',
      NULLIF(btrim(COALESCE(p_message, '')), ''),
      v_link.id, v_link.asset_id
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Known buyer came back through a link: keep the pipeline stage they are
    -- already at, but re-stamp provenance and freshen the contact clock.
    UPDATE public.leads
       SET share_link_id    = COALESCE(share_link_id, v_link.id),
           asset_id         = COALESCE(asset_id, v_link.asset_id),
           phone            = COALESCE(phone, v_phone),
           email            = COALESCE(email, v_email),
           last_contact_at  = now(),
           updated_at       = now()
     WHERE id = v_lead_id;
  END IF;

  INSERT INTO public.asset_share_enquiries (
    share_link_id, asset_id, agent_id, admin_id, lead_id,
    full_name, phone, email, message
  ) VALUES (
    v_link.id, v_link.asset_id, v_link.agent_id, v_link.admin_id, v_lead_id,
    v_name, v_phone, v_email, NULLIF(btrim(COALESCE(p_message, '')), '')
  )
  RETURNING id INTO v_enquiry_id;

  UPDATE public.asset_share_links
     SET enquiry_count = enquiry_count + 1,
         lead_id       = COALESCE(lead_id, v_lead_id),
         updated_at    = now()
   WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'enquiry_id',  v_enquiry_id,
    'lead_id',     v_lead_id,
    'agent_name',  v_agent.full_name,
    'agent_email', v_agent.email,
    'agent_phone', v_agent.phone,
    'asset_name',  v_interest
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. GRANTS
--
--     These are SECURITY DEFINER. Per this project's function-grants gotcha,
--     revoking PUBLIC is not enough — anon keeps EXECUTE through default
--     privileges unless it is revoked by name too.
--
--     record_share_link_view / record_share_link_enquiry are the public page's
--     write paths and are reachable ONLY by the Edge Function's service role.
--     If `authenticated` could call record_share_link_enquiry, any signed-in
--     user could forge leads onto any agent — which is exactly the commission
--     attribution this feature exists to establish.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_asset_share_link(uuid, uuid, text, text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_asset_share_link(uuid)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_share_link_view(uuid, text, text, text)                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_share_link_enquiry(text, text, text, text, text)                   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_asset_share_link(uuid, uuid, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_asset_share_link(uuid)                                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_share_link_view(uuid, text, text, text)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.record_share_link_enquiry(text, text, text, text, text)                   TO service_role;
