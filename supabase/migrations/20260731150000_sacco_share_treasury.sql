-- ----------------------------------------------------------------------------
-- Sacco share treasury — "the house" trades on the internal exchange.
--
--  1. sacco_share_treasury — one row per sacco: the authorized share cap and
--     the treasury pool (unallotted / bought-back shares the sacco itself
--     holds and can sell or buy on its own marketplace).
--  2. Treasury flags on listings + transfers so either side of a trade can be
--     the sacco itself. The house side keeps seller_member_id /
--     buyer_member_id NULL; the explicit booleans exist because those columns
--     are also ON DELETE SET NULL, so NULL alone cannot mean "the house".
--  3. Members read their sacco's treasury row (the portal shows house
--     listings and the pool); writes stay staff-only via tenant_manage.
--
-- Settlement remains admin-approved for every trade. House trades post share
-- capital to the accounting engine from the dashboard (Dr Bank / Cr Share
-- Capital on a treasury sale; reversed on a buy-back).
-- ----------------------------------------------------------------------------

-- 1. One treasury row per sacco -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_treasury (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID,
  sacco_id          UUID UNIQUE REFERENCES public.saccos(id) ON DELETE CASCADE,
  authorized_shares INTEGER NOT NULL DEFAULT 0,               -- 0 = no cap set
  treasury_shares   INTEGER NOT NULL DEFAULT 0 CHECK (treasury_shares >= 0),
  par_value         DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_treasury_admin
  ON public.sacco_share_treasury(admin_id);

-- Same admin_id default as every other sacco_* table.
DROP TRIGGER IF EXISTS set_admin_id_sacco_share_treasury ON public.sacco_share_treasury;
CREATE TRIGGER set_admin_id_sacco_share_treasury
  BEFORE INSERT ON public.sacco_share_treasury
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

ALTER TABLE public.sacco_share_treasury ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_manage_sacco_share_treasury" ON public.sacco_share_treasury;
CREATE POLICY "tenant_manage_sacco_share_treasury" ON public.sacco_share_treasury
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

DROP POLICY IF EXISTS "member_read_share_treasury" ON public.sacco_share_treasury;
CREATE POLICY "member_read_share_treasury" ON public.sacco_share_treasury
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- 2. Either side of a listing / transfer can be the house ---------------------
ALTER TABLE public.sacco_share_listings
  ADD COLUMN IF NOT EXISTS seller_is_treasury BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sacco_share_transfers
  ADD COLUMN IF NOT EXISTS seller_is_treasury BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buyer_is_treasury  BOOLEAN NOT NULL DEFAULT false;

-- A house listing has no member seller; a member listing must name one (and
-- likewise for the two sides of a transfer, unless the member was deleted —
-- ON DELETE SET NULL — which the flags disambiguate).
