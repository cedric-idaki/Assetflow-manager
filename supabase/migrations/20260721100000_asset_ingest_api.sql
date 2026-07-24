-- ============================================================================
-- ASSET INGEST API  (website → AssetFlow automatic vehicle sync)
-- ----------------------------------------------------------------------------
-- Lets a dealer's own website push its car inventory straight into the Assets
-- tab, instead of a human retyping every vehicle. A per-dealer API key
-- authenticates the machine-facing `ingest-assets` Edge Function, which upserts
-- rows into public.assets stamped with the dealer's tenant (admin_id).
--
-- Design:
--   * Keys are stored ONLY as a SHA-256 hash — the plaintext is shown once at
--     creation and never persisted, so a DB leak can't be replayed.
--   * external_ref = the dealer's own listing id (or VIN/chassis). Upsert is
--     keyed on (registered_by, external_ref) so re-syncs UPDATE instead of
--     duplicating the same item.
--   * source = 'website' marks synced rows apart from manually-added ones.
--   * Tenant scoping matches the app: assets are owned via assets.registered_by
--     (= the admin's auth id). The Edge Function sets registered_by explicitly
--     from the key's owner. (This project scopes assets by registered_by, not by
--     an admin_id column — that column does not exist on assets here.)
-- ============================================================================

-- pgcrypto gives us digest()/gen_random_bytes() for key generation + hashing.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. ASSET COLUMNS for sync provenance + idempotent upsert.
--    IF NOT EXISTS so this is safe against columns the app already added
--    (images / metadata / specifications).
-- ----------------------------------------------------------------------------
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS images         jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS metadata       jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS specifications text;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS external_ref   text;   -- dealer's own listing id / VIN
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS source         text;   -- 'website' for synced rows, NULL for manual

-- One item per (owner, external listing) — the key the Edge Function upserts on.
-- Scoped by registered_by to match how the app filters assets per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_assets_registered_by_external_ref
  ON public.assets (registered_by, external_ref)
  WHERE external_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. asset_ingest_keys — one or more API keys per dealer (tenant).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_ingest_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           uuid NOT NULL,                     -- owner (admin's auth id); written to assets.registered_by
  label              text,                               -- human note, e.g. "Main website"
  key_prefix         text NOT NULL,                      -- first chars, shown in the UI
  key_hash           text NOT NULL UNIQUE,               -- SHA-256 hex of the full key
  default_asset_type text NOT NULL DEFAULT 'other',      -- type applied to synced rows (per client's product)
  default_status     text NOT NULL DEFAULT 'available',  -- status new synced rows go live with
  is_active          boolean NOT NULL DEFAULT true,
  last_used_at       timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_ingest_keys_admin_id ON public.asset_ingest_keys(admin_id);
CREATE INDEX IF NOT EXISTS idx_asset_ingest_keys_hash     ON public.asset_ingest_keys(key_hash);

ALTER TABLE public.asset_ingest_keys ENABLE ROW LEVEL SECURITY;

-- A dealer manages only its own keys; super_admin/director see all (oversight).
DROP POLICY IF EXISTS "tenant_manage_asset_ingest_keys" ON public.asset_ingest_keys;
CREATE POLICY "tenant_manage_asset_ingest_keys"
ON public.asset_ingest_keys FOR ALL TO authenticated
USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- ----------------------------------------------------------------------------
-- 3. create_asset_ingest_key() — mints a key, stores its hash, returns the
--    plaintext ONCE. The caller (admin) must copy it immediately.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_asset_ingest_key(
  p_label              text DEFAULT NULL,
  p_default_asset_type text DEFAULT 'other',
  p_default_status     text DEFAULT 'available'
)
RETURNS TABLE (id uuid, api_key text, key_prefix text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_admin_id uuid := public.current_admin_id();
  v_key      text;
  v_prefix   text;
  v_hash     text;
  v_id       uuid;
BEGIN
  -- Only real admins may create machine credentials for their tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role IN ('admin'::public.user_role, 'super_admin'::public.user_role)
  ) THEN
    RAISE EXCEPTION 'Only an admin can create an asset ingest key.';
  END IF;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No tenant resolved for the current user.';
  END IF;

  -- afk_ + 48 hex chars of CSPRNG.
  v_key    := 'afk_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_prefix := left(v_key, 12) || '…';
  v_hash   := encode(extensions.digest(v_key, 'sha256'), 'hex');

  INSERT INTO public.asset_ingest_keys
    (admin_id, label, key_prefix, key_hash, default_asset_type, default_status, created_by)
  VALUES
    (v_admin_id, p_label, v_prefix, v_hash,
     COALESCE(NULLIF(p_default_asset_type, ''), 'other'),
     COALESCE(NULLIF(p_default_status, ''), 'available'),
     auth.uid())
  RETURNING asset_ingest_keys.id INTO v_id;

  RETURN QUERY SELECT v_id, v_key, v_prefix;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. revoke_asset_ingest_key() — deactivate a key you own.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_asset_ingest_key(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := public.current_admin_id();
  v_rows     integer;
BEGIN
  UPDATE public.asset_ingest_keys
     SET is_active = false
   WHERE id = p_id
     AND admin_id = v_admin_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. GRANTS — these are SECURITY DEFINER, so lock EXECUTE to authenticated only.
--    (Per the project's function-grants gotcha: revoking PUBLIC is not enough;
--     anon keeps EXECUTE via default privileges unless revoked too.)
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_asset_ingest_key(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_asset_ingest_key(uuid)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_asset_ingest_key(text, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.revoke_asset_ingest_key(uuid)             TO authenticated;
