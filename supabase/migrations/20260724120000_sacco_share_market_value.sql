-- ----------------------------------------------------------------------------
-- Sacco shares — core market-value engine.
--
--  1. sacco_share_prices — a sacco_admin publishes a market value per share,
--     one row per day ("everyday market value"). The latest row is the current
--     market value members see; the full series drives the admin trading report.
--  2. Broaden member_update_open_listing so a seller can EDIT their own open
--     listing's price while it stays open (the old WITH CHECK only permitted a
--     move to pending_approval/cancelled, which blocked price edits).
--  3. sacco_member_share_totals() — a privacy-preserving aggregate so a member
--     can see their % of the whole sacco's shares without reading everyone
--     else's individual holdings (member_read_own_shares limits them to their
--     own row).
-- ----------------------------------------------------------------------------

-- 1. Daily market-value history (one value per sacco per day) --------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_prices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  sacco_id       UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  market_value   DECIMAL(15,2) NOT NULL DEFAULT 0,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sacco_id, effective_date)          -- "set today's value" upserts one row/day
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_prices_admin
  ON public.sacco_share_prices(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_prices_sacco_date
  ON public.sacco_share_prices(sacco_id, effective_date DESC);

-- Same admin_id default as every other sacco_* table.
DROP TRIGGER IF EXISTS set_admin_id_sacco_share_prices ON public.sacco_share_prices;
CREATE TRIGGER set_admin_id_sacco_share_prices
  BEFORE INSERT ON public.sacco_share_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

ALTER TABLE public.sacco_share_prices ENABLE ROW LEVEL SECURITY;

-- Tenant policy (mirrors tenant_manage_* on the other sacco tables).
DROP POLICY IF EXISTS "tenant_manage_sacco_share_prices" ON public.sacco_share_prices;
CREATE POLICY "tenant_manage_sacco_share_prices" ON public.sacco_share_prices
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Members read their sacco's price history (current value + trend in the portal).
DROP POLICY IF EXISTS "member_read_share_prices" ON public.sacco_share_prices;
CREATE POLICY "member_read_share_prices" ON public.sacco_share_prices
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- 2. Let a seller edit their own OPEN listing (price/shares/expiry) ---------------
--    Buy (open -> pending_approval) and withdraw (open -> cancelled) are
--    unchanged; the new branch keeps status='open' for the seller's own row.
DROP POLICY IF EXISTS "member_update_open_listing" ON public.sacco_share_listings;
CREATE POLICY "member_update_open_listing" ON public.sacco_share_listings
  FOR UPDATE TO authenticated
  USING (sacco_id = public.current_member_sacco_id() AND status = 'open')
  WITH CHECK (
    sacco_id = public.current_member_sacco_id()
    AND (
      status IN ('pending_approval', 'cancelled')
      OR (status = 'open' AND seller_member_id = public.current_sacco_member_id())
    )
  );

-- 3. Privacy-preserving sacco-wide share totals for the caller's own sacco --------
--    SECURITY DEFINER so it can aggregate every holding, but it only ever
--    returns totals (never per-member rows) and is hard-scoped to the caller's
--    sacco via current_member_sacco_id().
CREATE OR REPLACE FUNCTION public.sacco_member_share_totals()
RETURNS TABLE (total_shares BIGINT, total_market_value NUMERIC, shareholders BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(SUM(s.shares_held), 0)::BIGINT AS total_shares,
    (COALESCE(SUM(s.shares_held), 0) * COALESCE((
      SELECT sp.market_value
      FROM public.sacco_share_prices sp
      WHERE sp.sacco_id = public.current_member_sacco_id()
      ORDER BY sp.effective_date DESC, sp.created_at DESC
      LIMIT 1
    ), 0))::NUMERIC AS total_market_value,
    COUNT(*) FILTER (WHERE COALESCE(s.shares_held, 0) > 0)::BIGINT AS shareholders
  FROM public.sacco_shares s
  WHERE s.sacco_id = public.current_member_sacco_id();
$$;

-- Members call it; anon must not (per the function-grants gotcha, revoking from
-- PUBLIC alone leaves anon with EXECUTE via default privileges).
REVOKE ALL ON FUNCTION public.sacco_member_share_totals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_member_share_totals() TO authenticated;
