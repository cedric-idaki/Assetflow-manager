-- ============================================================================
-- Sacco share engine — turns the four-card Shares tab into a real internal
-- share market: a two-sided order book, an automatic trading engine, a share
-- transaction ledger with cost basis, certificates, a dividend centre,
-- configurable trading rules, compliance limits and a full audit trail.
--
-- Layout
--   1.  Settings          — every rule the market runs on (one row per sacco)
--   2.  Holdings          — locking, freezing and cost basis on sacco_shares
--   3.  Treasury          — issued / retired / frozen counters
--   4.  Order book        — buy AND sell orders on sacco_share_listings
--   5.  Transactions      — the immutable per-member share ledger
--   6.  Certificates      — one live certificate per holder, auto-reissued
--   7.  Dividends         — declaration → calculation → payment
--   8.  Audit             — who / when / old / new / why
--   9.  Helpers           — sacco resolution, numbering, guards
--   10. Treasury actions  — issue, buy back, retire, freeze, allot, adjust
--   11. Trading engine    — place / edit / cancel / execute / settle / reverse
--   12. Dividend centre   — declare / calculate / pay / cancel
--   13. Analytics         — holdings, top shareholders, alerts
--   14. RLS, grants, realtime
--
-- Design rules carried over from the rest of the sacco stack:
--   * Money and ownership move only inside SECURITY DEFINER RPCs, never by a
--     browser UPDATE, so every invariant (locks, limits, cost basis) holds.
--   * History is append-only. A bad trade is reversed, never deleted.
--   * Ledger posting is best-effort: a sacco that has not seeded its Finance
--     Hub books still trades, it just does not post (matching the existing
--     treasury behaviour).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SHARE SETTINGS — the rules of the market
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_settings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id               UUID,
  sacco_id               UUID UNIQUE REFERENCES public.saccos(id) ON DELETE CASCADE,

  -- Value + holding rules
  par_value              DECIMAL(15,2) NOT NULL DEFAULT 100,
  min_holding            INTEGER       NOT NULL DEFAULT 0,     -- shares a member must keep
  max_holding_shares     INTEGER       NOT NULL DEFAULT 0,     -- 0 = no cap
  max_holding_percent    DECIMAL(6,3)  NOT NULL DEFAULT 0,     -- 0 = no cap (SASRA-style 20%)

  -- Fees, charged on settlement
  trading_fee_percent    DECIMAL(6,3)  NOT NULL DEFAULT 0,     -- buyer pays
  commission_percent     DECIMAL(6,3)  NOT NULL DEFAULT 0,     -- seller pays

  -- Dividend policy
  dividend_formula       TEXT          NOT NULL DEFAULT 'pro_rata',   -- pro_rata | per_share
  dividend_tax_percent   DECIMAL(6,3)  NOT NULL DEFAULT 0,            -- withholding tax
  votes_per_share        DECIMAL(10,4) NOT NULL DEFAULT 0,            -- 0 = one-member-one-vote

  -- Transfer + approval rules
  allow_member_transfers   BOOLEAN NOT NULL DEFAULT true,  -- member → member gifting
  require_transfer_approval BOOLEAN NOT NULL DEFAULT false,-- admin signs off every trade
  auto_settle              BOOLEAN NOT NULL DEFAULT true,  -- the engine settles itself
  allow_partial_fills      BOOLEAN NOT NULL DEFAULT true,
  price_floor_is_par       BOOLEAN NOT NULL DEFAULT true,  -- no sales below par
  lock_in_days             INTEGER NOT NULL DEFAULT 0,     -- days a new buy cannot be resold

  -- Market hours (local time; 00:00–00:00 means always open)
  market_open_time       TIME    NOT NULL DEFAULT '00:00',
  market_close_time      TIME    NOT NULL DEFAULT '00:00',
  market_days            INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6], -- 0=Sunday
  trading_suspended      BOOLEAN NOT NULL DEFAULT false,
  suspension_reason      TEXT,

  -- Compliance
  require_kyc_to_trade   BOOLEAN NOT NULL DEFAULT true,
  large_trade_threshold  DECIMAL(15,2) NOT NULL DEFAULT 0,   -- 0 = no AML flagging

  -- Certificate numbering
  certificate_prefix     TEXT    NOT NULL DEFAULT 'CERT',
  next_certificate_no    INTEGER NOT NULL DEFAULT 1,

  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_settings_admin ON public.sacco_share_settings(admin_id);

-- ----------------------------------------------------------------------------
-- 2. HOLDINGS — locking, freezing, cost basis
--    locked_shares are escrowed against open sell orders, so a member can never
--    sell the same share twice. Cost basis is maintained by the engine, which is
--    what makes "unrealized gain" and "profit/loss" real numbers rather than
--    par-value guesses.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_shares
  ADD COLUMN IF NOT EXISTS locked_shares        INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_frozen            BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS freeze_reason        TEXT,
  ADD COLUMN IF NOT EXISTS frozen_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_invested       DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_buy_price        DECIMAL(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_gain        DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dividends_earned     DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_purchase_date  DATE,
  ADD COLUMN IF NOT EXISTS last_trade_date      DATE;

-- One holding row per member — the engine reads and writes it as a single
-- position. Guarded so a database that already has duplicates still migrates.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_shares_member
    ON public.sacco_shares(sacco_id, member_id);
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'Duplicate sacco_shares rows exist for a member; the one-holding-per-member '
                'index was NOT created. Merge them, then re-run this index.';
END $$;

-- Seed cost basis for holdings recorded before the engine existed: par value is
-- the only cost anyone knows about, so it becomes the opening average.
UPDATE public.sacco_shares
   SET avg_buy_price  = COALESCE(par_value, 0),
       total_invested = COALESCE(shares_held, 0) * COALESCE(par_value, 0)
 WHERE total_invested = 0 AND COALESCE(shares_held, 0) > 0;

-- ----------------------------------------------------------------------------
-- 3. TREASURY — lifetime counters so the share register reconciles
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_share_treasury
  ADD COLUMN IF NOT EXISTS issued_shares  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retired_shares INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frozen_shares  INTEGER NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- 4. ORDER BOOK — one table, two sides
--    Existing rows are sell listings, which is why `side` defaults to 'sell'.
--    A buy order names the price a member will pay; a sell order names the price
--    they will accept. Partial fills advance filled_shares and leave the order
--    open until it is exhausted.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_share_listings
  ADD COLUMN IF NOT EXISTS side           TEXT    NOT NULL DEFAULT 'sell',
  ADD COLUMN IF NOT EXISTS filled_shares  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_member_id UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS buyer_is_treasury BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT,
  ADD COLUMN IF NOT EXISTS created_by     UUID;

DO $$
BEGIN
  ALTER TABLE public.sacco_share_listings
    ADD CONSTRAINT sacco_share_listings_side_chk CHECK (side IN ('buy', 'sell'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sacco_share_listings_book
  ON public.sacco_share_listings(sacco_id, side, status);

ALTER TABLE public.sacco_share_transfers
  ADD COLUMN IF NOT EXISTS price_per_share DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_fee       DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_fee      DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_type      TEXT NOT NULL DEFAULT 'market',  -- market | transfer | allotment | buyback | reversal
  ADD COLUMN IF NOT EXISTS settled_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_of     UUID,
  ADD COLUMN IF NOT EXISTS reason          TEXT,
  ADD COLUMN IF NOT EXISTS reference       TEXT;

-- Back-fill the per-share price for trades recorded before the column existed.
UPDATE public.sacco_share_transfers
   SET price_per_share = round(price / NULLIF(shares, 0), 2)
 WHERE price_per_share = 0 AND COALESCE(shares, 0) > 0;

CREATE INDEX IF NOT EXISTS idx_sacco_share_transfers_status
  ON public.sacco_share_transfers(sacco_id, status);

-- ----------------------------------------------------------------------------
-- 5. SHARE TRANSACTIONS — the immutable per-holder ledger
--    Every movement of a share writes a row here, for the member side and (on
--    house trades) the treasury side. This is what powers purchase history,
--    sales history, average buy price, trading volume and the share register.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.sacco_share_txn_seq;

CREATE TABLE IF NOT EXISTS public.sacco_share_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  txn_no          TEXT,
  txn_type        TEXT NOT NULL,          -- issue|purchase|sale|transfer_in|transfer_out|
                                          -- allotment|buyback|retire|adjustment|dividend|reversal
  member_id       UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  is_treasury     BOOLEAN NOT NULL DEFAULT false,
  counterparty_id UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  counterparty_is_treasury BOOLEAN NOT NULL DEFAULT false,
  shares          INTEGER NOT NULL DEFAULT 0,      -- signed: + in, − out
  price_per_share DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount          DECIMAL(18,2) NOT NULL DEFAULT 0,
  fee             DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_after   INTEGER NOT NULL DEFAULT 0,
  realized_gain   DECIMAL(18,2) NOT NULL DEFAULT 0,
  transfer_id     UUID,
  listing_id      UUID,
  declaration_id  UUID,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_txn_admin   ON public.sacco_share_transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_txn_member  ON public.sacco_share_transactions(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_share_txn_created ON public.sacco_share_transactions(sacco_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. CERTIFICATES — one active certificate per holder
--    A holding change supersedes the old certificate and issues a new one, so a
--    member's active certificate always states their true balance and the
--    superseded ones remain as history.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  certificate_no  TEXT NOT NULL,
  member_id       UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  shares          INTEGER NOT NULL DEFAULT 0,
  par_value       DECIMAL(15,2) NOT NULL DEFAULT 0,
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | superseded | cancelled
  superseded_by   UUID,
  transaction_id  UUID,
  issued_by       UUID,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_certs_admin  ON public.sacco_share_certificates(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_certs_member ON public.sacco_share_certificates(member_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_share_cert_no
  ON public.sacco_share_certificates(sacco_id, certificate_no);

-- ----------------------------------------------------------------------------
-- 7. DIVIDENDS — declaration and per-member allocation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_dividend_declarations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID,
  sacco_id          UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  period_label      TEXT NOT NULL,                    -- e.g. "FY2025"
  basis             TEXT NOT NULL DEFAULT 'profit_percent', -- profit_percent | per_share
  profit_amount     DECIMAL(18,2) NOT NULL DEFAULT 0,
  dividend_percent  DECIMAL(8,3)  NOT NULL DEFAULT 0,
  dividend_per_share DECIMAL(15,4) NOT NULL DEFAULT 0,
  record_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_date      DATE,
  payout_method     TEXT NOT NULL DEFAULT 'cash',     -- cash | savings
  status            TEXT NOT NULL DEFAULT 'draft',    -- draft|declared|calculated|paid|cancelled
  total_shares      BIGINT NOT NULL DEFAULT 0,
  total_payable     DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_tax         DECIMAL(18,2) NOT NULL DEFAULT 0,
  members_count     INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  declared_by       UUID,
  declared_at       TIMESTAMPTZ,
  calculated_at     TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  journal_entry_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_div_decl_admin ON public.sacco_dividend_declarations(admin_id);

CREATE TABLE IF NOT EXISTS public.sacco_dividend_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID,
  sacco_id         UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  declaration_id   UUID REFERENCES public.sacco_dividend_declarations(id) ON DELETE CASCADE,
  member_id        UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  shares_at_record INTEGER NOT NULL DEFAULT 0,
  gross_amount     DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_amount       DECIMAL(18,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | cancelled
  paid_at          TIMESTAMPTZ,
  payment_ref      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (declaration_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_sacco_div_alloc_admin  ON public.sacco_dividend_allocations(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_div_alloc_member ON public.sacco_dividend_allocations(member_id);

-- ----------------------------------------------------------------------------
-- 8. AUDIT TRAIL — every share action, with the before and after
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  sacco_id       UUID,
  entity         TEXT NOT NULL,          -- holding | listing | transfer | treasury | settings | dividend | certificate
  entity_id      UUID,
  member_id      UUID,
  action         TEXT NOT NULL,
  actor_id       UUID,
  actor_name     TEXT,
  actor_role     TEXT,
  old_values     JSONB,
  new_values     JSONB,
  changed_fields TEXT[],
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_audit_admin   ON public.sacco_share_audit(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_audit_created ON public.sacco_share_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_share_audit_entity  ON public.sacco_share_audit(entity, entity_id);

-- ----------------------------------------------------------------------------
-- 9. HELPERS
-- ----------------------------------------------------------------------------

-- The sacco the caller is acting in: their member record if they are a member,
-- otherwise the sacco they administer.
CREATE OR REPLACE FUNCTION public.sacco_active_sacco_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT s.id FROM public.saccos s
      WHERE s.admin_id = public.current_admin_id()
      ORDER BY s.created_at LIMIT 1),
    (SELECT m.sacco_id FROM public.sacco_members m
      WHERE m.user_id = auth.uid() LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION public.sacco_active_sacco_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_active_sacco_id() TO authenticated;

-- Settings for a sacco, created with defaults on first touch so every RPC can
-- assume a rules row exists.
CREATE OR REPLACE FUNCTION public.sacco_share_settings_row(p_sacco_id uuid)
RETURNS public.sacco_share_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   public.sacco_share_settings%ROWTYPE;
  v_admin uuid;
BEGIN
  SELECT * INTO v_row FROM public.sacco_share_settings WHERE sacco_id = p_sacco_id;
  IF v_row.id IS NOT NULL THEN RETURN v_row; END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;

  INSERT INTO public.sacco_share_settings (admin_id, sacco_id, par_value)
  VALUES (v_admin, p_sacco_id,
          COALESCE((SELECT NULLIF(par_value, 0) FROM public.sacco_share_treasury
                     WHERE sacco_id = p_sacco_id), 100))
  ON CONFLICT (sacco_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_settings_row(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_settings_row(uuid) TO authenticated;

-- Write one audit row. Called by every mutating RPC — a share never moves
-- without a line here saying who moved it and why.
CREATE OR REPLACE FUNCTION public.sacco_share_log(
  p_sacco_id uuid,
  p_entity   text,
  p_entity_id uuid,
  p_action   text,
  p_member_id uuid DEFAULT NULL,
  p_old      jsonb DEFAULT NULL,
  p_new      jsonb DEFAULT NULL,
  p_reason   text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name  text;
  v_role  text;
  v_admin uuid;
BEGIN
  SELECT up.full_name, up.role::text INTO v_name, v_role
    FROM public.user_profiles up WHERE up.id = v_actor;
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;

  INSERT INTO public.sacco_share_audit
    (admin_id, sacco_id, entity, entity_id, member_id, action,
     actor_id, actor_name, actor_role, old_values, new_values, changed_fields, reason)
  VALUES
    (v_admin, p_sacco_id, p_entity, p_entity_id, p_member_id, p_action,
     v_actor, COALESCE(v_name, 'System'), COALESCE(v_role, 'system'),
     p_old, p_new,
     CASE WHEN p_old IS NOT NULL AND p_new IS NOT NULL
          THEN ARRAY(SELECT k FROM jsonb_object_keys(p_new) k
                      WHERE (p_old -> k) IS DISTINCT FROM (p_new -> k))
     END,
     NULLIF(trim(COALESCE(p_reason, '')), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_log(uuid, text, uuid, text, uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;

-- Append a row to the share ledger and return the new id.
CREATE OR REPLACE FUNCTION public.sacco_share_txn(
  p_sacco_id uuid,
  p_type     text,
  p_member_id uuid,
  p_is_treasury boolean,
  p_shares   integer,
  p_price    numeric,
  p_balance_after integer,
  p_counterparty_id uuid DEFAULT NULL,
  p_counterparty_is_treasury boolean DEFAULT false,
  p_fee      numeric DEFAULT 0,
  p_realized numeric DEFAULT 0,
  p_transfer_id uuid DEFAULT NULL,
  p_listing_id  uuid DEFAULT NULL,
  p_declaration_id uuid DEFAULT NULL,
  p_notes    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;

  INSERT INTO public.sacco_share_transactions
    (admin_id, sacco_id, txn_no, txn_type, member_id, is_treasury,
     counterparty_id, counterparty_is_treasury, shares, price_per_share, amount,
     fee, balance_after, realized_gain, transfer_id, listing_id, declaration_id,
     notes, created_by)
  VALUES
    (v_admin, p_sacco_id,
     'SHT-' || lpad(nextval('public.sacco_share_txn_seq')::text, 7, '0'),
     p_type, p_member_id, p_is_treasury,
     p_counterparty_id, p_counterparty_is_treasury,
     p_shares, round(COALESCE(p_price, 0), 2),
     round(abs(p_shares) * COALESCE(p_price, 0), 2),
     round(COALESCE(p_fee, 0), 2), p_balance_after, round(COALESCE(p_realized, 0), 2),
     p_transfer_id, p_listing_id, p_declaration_id, p_notes, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_txn(uuid, text, uuid, boolean, integer, numeric, integer, uuid, boolean, numeric, numeric, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Reissue a member's certificate to match their current balance. The previous
-- active certificate is superseded, never deleted.
CREATE OR REPLACE FUNCTION public.sacco_share_reissue_certificate(
  p_sacco_id  uuid,
  p_member_id uuid,
  p_txn_id    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  uuid;
  v_shares integer;
  v_par    numeric;
  v_no     integer;
  v_prefix text;
  v_new    uuid;
BEGIN
  IF p_member_id IS NULL THEN RETURN NULL; END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;
  SELECT COALESCE(shares_held, 0) INTO v_shares
    FROM public.sacco_shares WHERE sacco_id = p_sacco_id AND member_id = p_member_id;

  -- Claim the next certificate number atomically.
  UPDATE public.sacco_share_settings
     SET next_certificate_no = next_certificate_no + 1, updated_at = now()
   WHERE sacco_id = p_sacco_id
  RETURNING next_certificate_no - 1, certificate_prefix, par_value
       INTO v_no, v_prefix, v_par;

  UPDATE public.sacco_share_certificates
     SET status = 'superseded'
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id AND status = 'active';

  -- A member who has sold out keeps their history but holds no live certificate.
  IF COALESCE(v_shares, 0) <= 0 THEN RETURN NULL; END IF;

  INSERT INTO public.sacco_share_certificates
    (admin_id, sacco_id, certificate_no, member_id, shares, par_value,
     transaction_id, issued_by, status)
  VALUES
    (v_admin, p_sacco_id,
     COALESCE(v_prefix, 'CERT') || '-' || lpad(COALESCE(v_no, 1)::text, 6, '0'),
     p_member_id, v_shares, COALESCE(v_par, 0), p_txn_id, auth.uid(), 'active')
  RETURNING id INTO v_new;

  UPDATE public.sacco_share_certificates
     SET superseded_by = v_new
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id
     AND status = 'superseded' AND superseded_by IS NULL;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_reissue_certificate(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_reissue_certificate(uuid, uuid, uuid) TO authenticated;

-- Staff guard used by every admin RPC.
CREATE OR REPLACE FUNCTION public.sacco_share_require_staff(p_sacco_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Sacco not found'; END IF;
  IF NOT ((public.is_staff_member() AND v_admin = public.current_admin_id())
          OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Only sacco staff can perform this action';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_require_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_require_staff(uuid) TO authenticated;

-- Ensure a holding row exists and return it locked for update.
CREATE OR REPLACE FUNCTION public.sacco_share_holding(
  p_sacco_id uuid,
  p_member_id uuid
)
RETURNS public.sacco_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   public.sacco_shares%ROWTYPE;
  v_admin uuid;
  v_par   numeric;
BEGIN
  SELECT * INTO v_row FROM public.sacco_shares
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id FOR UPDATE;
  IF v_row.id IS NOT NULL THEN RETURN v_row; END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;
  SELECT par_value INTO v_par FROM public.sacco_share_settings WHERE sacco_id = p_sacco_id;

  INSERT INTO public.sacco_shares (admin_id, sacco_id, member_id, shares_held, par_value)
  VALUES (v_admin, p_sacco_id, p_member_id, 0, COALESCE(v_par, 0))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_holding(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Post a share journal entry, best-effort: a society that has not seeded its
-- books still trades, it just does not hit the ledger.
CREATE OR REPLACE FUNCTION public.sacco_share_post_ledger(
  p_sacco_id uuid,
  p_description text,
  p_lines jsonb,
  p_reference text,
  p_member_id uuid,
  p_source_table text,
  p_source_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    v_id := public.sacco_post_journal(
      p_sacco_id, CURRENT_DATE, p_description, p_lines,
      NULL, p_reference, p_member_id, p_source_table, p_source_id, true, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_id := NULL;   -- books not initialised / period closed — trading continues
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_post_ledger(uuid, text, jsonb, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. TREASURY ACTIONS
-- ----------------------------------------------------------------------------

-- Issue brand-new shares into the treasury (capital expansion). Raises the
-- authorized cap alongside if the issue would breach it.
CREATE OR REPLACE FUNCTION public.sacco_share_issue(
  p_shares    integer,
  p_par_value numeric DEFAULT NULL,
  p_reason    text    DEFAULT NULL
)
RETURNS public.sacco_share_treasury
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_admin uuid;
  v_row   public.sacco_share_treasury%ROWTYPE;
  v_old   jsonb;
  v_held  bigint;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  IF COALESCE(p_shares, 0) <= 0 THEN RAISE EXCEPTION 'Issue at least one share'; END IF;
  PERFORM public.sacco_share_settings_row(v_sacco);

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;

  INSERT INTO public.sacco_share_treasury (admin_id, sacco_id, par_value)
  VALUES (v_admin, v_sacco, COALESCE(p_par_value, 0))
  ON CONFLICT (sacco_id) DO NOTHING;

  SELECT * INTO v_row FROM public.sacco_share_treasury WHERE sacco_id = v_sacco FOR UPDATE;
  v_old := to_jsonb(v_row);

  SELECT COALESCE(SUM(shares_held), 0) INTO v_held
    FROM public.sacco_shares WHERE sacco_id = v_sacco;

  UPDATE public.sacco_share_treasury
     SET treasury_shares = treasury_shares + p_shares,
         issued_shares   = issued_shares + p_shares,
         par_value       = COALESCE(NULLIF(p_par_value, 0), par_value),
         -- Keep the authorized cap meaningful rather than silently breached.
         authorized_shares = CASE
           WHEN authorized_shares = 0 THEN 0
           WHEN authorized_shares < v_held + treasury_shares + p_shares
             THEN v_held + treasury_shares + p_shares
           ELSE authorized_shares END,
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_txn(
    v_sacco, 'issue', NULL, true, p_shares,
    COALESCE(NULLIF(p_par_value, 0), v_row.par_value), v_row.treasury_shares,
    NULL, false, 0, 0, NULL, NULL, NULL, p_reason);

  PERFORM public.sacco_share_log(v_sacco, 'treasury', v_row.id, 'issue', NULL,
    v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_issue(integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_issue(integer, numeric, text) TO authenticated;

-- Retire treasury shares — permanently out of circulation.
CREATE OR REPLACE FUNCTION public.sacco_share_retire(
  p_shares integer,
  p_reason text DEFAULT NULL
)
RETURNS public.sacco_share_treasury
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_row   public.sacco_share_treasury%ROWTYPE;
  v_old   jsonb;
  v_free  integer;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  IF COALESCE(p_shares, 0) <= 0 THEN RAISE EXCEPTION 'Retire at least one share'; END IF;

  SELECT * INTO v_row FROM public.sacco_share_treasury WHERE sacco_id = v_sacco FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No treasury has been set up yet'; END IF;
  v_old := to_jsonb(v_row);

  -- Shares the house has already promised to the market cannot be retired.
  SELECT COALESCE(SUM(l.shares - l.filled_shares), 0)::integer INTO v_free
    FROM public.sacco_share_listings l
   WHERE l.sacco_id = v_sacco AND l.side = 'sell'
     AND l.seller_is_treasury AND l.status IN ('open', 'pending_approval');

  IF p_shares > v_row.treasury_shares - COALESCE(v_free, 0) - v_row.frozen_shares THEN
    RAISE EXCEPTION 'Only % treasury shares are free to retire (% listed, % frozen)',
      v_row.treasury_shares - COALESCE(v_free, 0) - v_row.frozen_shares, v_free, v_row.frozen_shares;
  END IF;

  UPDATE public.sacco_share_treasury
     SET treasury_shares = treasury_shares - p_shares,
         retired_shares  = retired_shares + p_shares,
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_txn(v_sacco, 'retire', NULL, true, -p_shares,
    v_row.par_value, v_row.treasury_shares, NULL, false, 0, 0, NULL, NULL, NULL, p_reason);
  PERFORM public.sacco_share_log(v_sacco, 'treasury', v_row.id, 'retire', NULL,
    v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_retire(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_retire(integer, text) TO authenticated;

-- Correct the treasury inventory (stock-take). Signed delta, always audited.
CREATE OR REPLACE FUNCTION public.sacco_share_adjust_treasury(
  p_delta  integer,
  p_reason text
)
RETURNS public.sacco_share_treasury
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_row   public.sacco_share_treasury%ROWTYPE;
  v_old   jsonb;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  IF COALESCE(p_delta, 0) = 0 THEN RAISE EXCEPTION 'An adjustment cannot be zero'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'An inventory correction needs a reason';
  END IF;

  SELECT * INTO v_row FROM public.sacco_share_treasury WHERE sacco_id = v_sacco FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No treasury has been set up yet'; END IF;
  v_old := to_jsonb(v_row);

  IF v_row.treasury_shares + p_delta < 0 THEN
    RAISE EXCEPTION 'That correction would take the treasury below zero';
  END IF;

  UPDATE public.sacco_share_treasury
     SET treasury_shares = treasury_shares + p_delta, updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_txn(v_sacco, 'adjustment', NULL, true, p_delta,
    v_row.par_value, v_row.treasury_shares, NULL, false, 0, 0, NULL, NULL, NULL, p_reason);
  PERFORM public.sacco_share_log(v_sacco, 'treasury', v_row.id, 'adjustment', NULL,
    v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_adjust_treasury(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_adjust_treasury(integer, text) TO authenticated;

-- Freeze / unfreeze a member's holding (dispute, estate, court order).
CREATE OR REPLACE FUNCTION public.sacco_share_freeze_member(
  p_member_id uuid,
  p_frozen    boolean,
  p_reason    text DEFAULT NULL
)
RETURNS public.sacco_shares
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_row   public.sacco_shares%ROWTYPE;
  v_old   jsonb;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  IF p_frozen AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RAISE EXCEPTION 'Freezing a holding needs a reason';
  END IF;

  SELECT * INTO v_row FROM public.sacco_share_holding(v_sacco, p_member_id);
  v_old := to_jsonb(v_row);

  UPDATE public.sacco_shares
     SET is_frozen = p_frozen,
         freeze_reason = CASE WHEN p_frozen THEN trim(p_reason) ELSE NULL END,
         frozen_at = CASE WHEN p_frozen THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- A frozen member's live sell orders come off the book so nothing can match.
  IF p_frozen THEN
    UPDATE public.sacco_share_listings
       SET status = 'cancelled', cancel_reason = 'Holder frozen', updated_at = now()
     WHERE sacco_id = v_sacco AND seller_member_id = p_member_id AND status = 'open';
    UPDATE public.sacco_shares SET locked_shares = 0 WHERE id = v_row.id;
  END IF;

  PERFORM public.sacco_share_log(v_sacco, 'holding', v_row.id,
    CASE WHEN p_frozen THEN 'freeze' ELSE 'unfreeze' END, p_member_id,
    v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_freeze_member(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_freeze_member(uuid, boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. TRADING ENGINE
-- ----------------------------------------------------------------------------

-- Is the market accepting orders right now?
CREATE OR REPLACE FUNCTION public.sacco_share_market_open(p_sacco_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sacco_share_settings%ROWTYPE;
  -- Market hours are local Kenyan hours, not the server's UTC clock.
  v_now time    := (now() AT TIME ZONE 'Africa/Nairobi')::time;
  v_dow integer := EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Nairobi'))::integer;
BEGIN
  SELECT * INTO s FROM public.sacco_share_settings WHERE sacco_id = p_sacco_id;
  IF s.id IS NULL THEN RETURN true; END IF;
  IF s.trading_suspended THEN RETURN false; END IF;
  IF NOT (v_dow = ANY (s.market_days)) THEN RETURN false; END IF;
  IF s.market_open_time = s.market_close_time THEN RETURN true; END IF;   -- always open
  IF s.market_open_time < s.market_close_time THEN
    RETURN v_now >= s.market_open_time AND v_now < s.market_close_time;
  END IF;
  RETURN v_now >= s.market_open_time OR v_now < s.market_close_time;      -- wraps midnight
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_market_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_market_open(uuid) TO authenticated;

-- Place a buy or sell order. Members trade for themselves; staff may place an
-- order on behalf of a member (walk-in instruction) by passing p_member_id.
CREATE OR REPLACE FUNCTION public.sacco_share_place_order(
  p_side      text,
  p_shares    integer,
  p_price     numeric,
  p_expiry    date    DEFAULT NULL,
  p_member_id uuid    DEFAULT NULL,
  p_as_treasury boolean DEFAULT false
)
RETURNS public.sacco_share_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco   uuid;
  v_admin   uuid;
  v_member  uuid := p_member_id;
  v_is_staff boolean := false;
  s         public.sacco_share_settings%ROWTYPE;
  h         public.sacco_shares%ROWTYPE;
  t         public.sacco_share_treasury%ROWTYPE;
  v_row     public.sacco_share_listings%ROWTYPE;
  v_member_row public.sacco_members%ROWTYPE;
  v_free    integer;
  v_listed  integer;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN RAISE EXCEPTION 'Side must be buy or sell'; END IF;
  IF COALESCE(p_shares, 0) <= 0 THEN RAISE EXCEPTION 'Order at least one share'; END IF;

  -- Who is ordering: the caller's own member record, or staff acting for someone.
  SELECT * INTO v_member_row FROM public.sacco_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_member_row.id IS NOT NULL AND p_member_id IS NULL AND NOT p_as_treasury THEN
    v_member := v_member_row.id;
    v_sacco  := v_member_row.sacco_id;
  ELSE
    v_sacco := public.sacco_active_sacco_id();
    PERFORM public.sacco_share_require_staff(v_sacco);
    v_is_staff := true;
    IF p_as_treasury THEN v_member := NULL; END IF;
    IF NOT p_as_treasury AND v_member IS NULL THEN
      RAISE EXCEPTION 'Choose the member this order is for';
    END IF;
  END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(v_sacco);
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;

  IF s.trading_suspended THEN
    RAISE EXCEPTION 'Trading is suspended%',
      COALESCE(' — ' || s.suspension_reason, '');
  END IF;
  -- Staff instructions are accepted outside market hours; member self-service is not.
  IF NOT v_is_staff AND NOT public.sacco_share_market_open(v_sacco) THEN
    RAISE EXCEPTION 'The share market is closed right now';
  END IF;

  IF v_member IS NOT NULL THEN
    SELECT * INTO v_member_row FROM public.sacco_members WHERE id = v_member;
    IF v_member_row.id IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
    IF v_member_row.status <> 'active' THEN
      RAISE EXCEPTION 'That membership is % — trading is not available', v_member_row.status;
    END IF;
    IF s.require_kyc_to_trade AND COALESCE(v_member_row.kyc_status, 'pending') <> 'verified' THEN
      RAISE EXCEPTION 'KYC must be verified before trading shares';
    END IF;
  END IF;

  IF p_side = 'sell' THEN
    IF p_as_treasury THEN
      SELECT * INTO t FROM public.sacco_share_treasury WHERE sacco_id = v_sacco FOR UPDATE;
      IF t.id IS NULL THEN RAISE EXCEPTION 'No treasury has been set up yet'; END IF;
      SELECT COALESCE(SUM(l.shares - l.filled_shares), 0)::integer INTO v_listed
        FROM public.sacco_share_listings l
       WHERE l.sacco_id = v_sacco AND l.side = 'sell' AND l.seller_is_treasury
         AND l.status IN ('open', 'pending_approval');
      v_free := t.treasury_shares - COALESCE(v_listed, 0) - t.frozen_shares;
      IF p_shares > v_free THEN
        RAISE EXCEPTION 'The treasury can list at most % shares', GREATEST(v_free, 0);
      END IF;
    ELSE
      SELECT * INTO h FROM public.sacco_share_holding(v_sacco, v_member);
      IF h.is_frozen THEN RAISE EXCEPTION 'This holding is frozen — %', COALESCE(h.freeze_reason, 'under dispute'); END IF;
      v_free := h.shares_held - h.locked_shares;
      IF p_shares > v_free THEN
        RAISE EXCEPTION 'Only % shares are free to sell (% held, % already listed)',
          GREATEST(v_free, 0), h.shares_held, h.locked_shares;
      END IF;
      IF s.min_holding > 0 AND (h.shares_held - p_shares) < s.min_holding THEN
        RAISE EXCEPTION 'Members must keep at least % shares', s.min_holding;
      END IF;
      IF s.lock_in_days > 0 AND h.first_purchase_date IS NOT NULL
         AND h.first_purchase_date > CURRENT_DATE - s.lock_in_days THEN
        RAISE EXCEPTION 'Shares are locked in for % days after purchase', s.lock_in_days;
      END IF;
      -- Escrow: locked shares cannot be listed again or transferred away.
      UPDATE public.sacco_shares SET locked_shares = locked_shares + p_shares,
             updated_at = now() WHERE id = h.id;
    END IF;

    IF s.price_floor_is_par AND COALESCE(p_price, 0) < s.par_value THEN
      RAISE EXCEPTION 'Price may not be below par value (%)', s.par_value;
    END IF;
  END IF;

  INSERT INTO public.sacco_share_listings
    (admin_id, sacco_id, side,
     seller_member_id, seller_is_treasury,
     buyer_member_id,  buyer_is_treasury,
     shares, price_per_share, status, expiry_date, created_by)
  VALUES
    (v_admin, v_sacco, p_side,
     CASE WHEN p_side = 'sell' AND NOT p_as_treasury THEN v_member END,
     CASE WHEN p_side = 'sell' THEN p_as_treasury ELSE false END,
     CASE WHEN p_side = 'buy'  AND NOT p_as_treasury THEN v_member END,
     CASE WHEN p_side = 'buy'  THEN p_as_treasury ELSE false END,
     p_shares, round(COALESCE(p_price, 0), 2), 'open', p_expiry, auth.uid())
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_log(v_sacco, 'listing', v_row.id, 'order_placed',
    v_member, NULL, to_jsonb(v_row), NULL);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_place_order(text, integer, numeric, date, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_place_order(text, integer, numeric, date, uuid, boolean)
  TO authenticated;

-- Edit an open order. Re-escrows the difference on the sell side.
CREATE OR REPLACE FUNCTION public.sacco_share_update_order(
  p_id     uuid,
  p_shares integer,
  p_price  numeric,
  p_expiry date DEFAULT NULL
)
RETURNS public.sacco_share_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   public.sacco_share_listings%ROWTYPE;
  v_old   jsonb;
  s       public.sacco_share_settings%ROWTYPE;
  h       public.sacco_shares%ROWTYPE;
  v_me    uuid := public.current_sacco_member_id();
  v_delta integer;
BEGIN
  SELECT * INTO v_row FROM public.sacco_share_listings WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'Only an open order can be edited'; END IF;
  IF COALESCE(p_shares, 0) <= v_row.filled_shares THEN
    RAISE EXCEPTION 'The order is already filled for % shares', v_row.filled_shares;
  END IF;

  IF NOT (v_me IS NOT NULL
          AND v_me IN (COALESCE(v_row.seller_member_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(v_row.buyer_member_id,  '00000000-0000-0000-0000-000000000000'::uuid))) THEN
    PERFORM public.sacco_share_require_staff(v_row.sacco_id);
  END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(v_row.sacco_id);
  v_old := to_jsonb(v_row);

  IF v_row.side = 'sell' THEN
    IF s.price_floor_is_par AND COALESCE(p_price, 0) < s.par_value THEN
      RAISE EXCEPTION 'Price may not be below par value (%)', s.par_value;
    END IF;
    v_delta := p_shares - v_row.shares;
    IF v_row.seller_member_id IS NOT NULL AND v_delta <> 0 THEN
      SELECT * INTO h FROM public.sacco_share_holding(v_row.sacco_id, v_row.seller_member_id);
      IF v_delta > 0 AND (h.shares_held - h.locked_shares) < v_delta THEN
        RAISE EXCEPTION 'Only % more shares are free to list', GREATEST(h.shares_held - h.locked_shares, 0);
      END IF;
      UPDATE public.sacco_shares
         SET locked_shares = GREATEST(0, locked_shares + v_delta), updated_at = now()
       WHERE id = h.id;
    END IF;
  END IF;

  UPDATE public.sacco_share_listings
     SET shares = p_shares,
         price_per_share = round(COALESCE(p_price, 0), 2),
         expiry_date = p_expiry,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_log(v_row.sacco_id, 'listing', v_row.id, 'order_edited',
    COALESCE(v_row.seller_member_id, v_row.buyer_member_id), v_old, to_jsonb(v_row), NULL);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_update_order(uuid, integer, numeric, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_update_order(uuid, integer, numeric, date) TO authenticated;

-- Cancel an open order and release the escrow.
CREATE OR REPLACE FUNCTION public.sacco_share_cancel_order(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.sacco_share_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.sacco_share_listings%ROWTYPE;
  v_old jsonb;
  v_me  uuid := public.current_sacco_member_id();
  v_out integer;
BEGIN
  SELECT * INTO v_row FROM public.sacco_share_listings WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_row.status NOT IN ('open', 'pending_approval') THEN
    RAISE EXCEPTION 'This order is already %', v_row.status;
  END IF;

  IF NOT (v_me IS NOT NULL
          AND v_me IN (COALESCE(v_row.seller_member_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       COALESCE(v_row.buyer_member_id,  '00000000-0000-0000-0000-000000000000'::uuid))) THEN
    PERFORM public.sacco_share_require_staff(v_row.sacco_id);
  END IF;

  v_old := to_jsonb(v_row);
  v_out := GREATEST(v_row.shares - v_row.filled_shares, 0);

  IF v_row.side = 'sell' AND v_row.seller_member_id IS NOT NULL AND v_out > 0 THEN
    UPDATE public.sacco_shares
       SET locked_shares = GREATEST(0, locked_shares - v_out), updated_at = now()
     WHERE sacco_id = v_row.sacco_id AND member_id = v_row.seller_member_id;
  END IF;

  UPDATE public.sacco_share_listings
     SET status = CASE WHEN v_row.filled_shares > 0 THEN 'settled' ELSE 'cancelled' END::public.share_listing_status,
         cancel_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_log(v_row.sacco_id, 'listing', v_row.id, 'order_cancelled',
    COALESCE(v_row.seller_member_id, v_row.buyer_member_id), v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_cancel_order(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_cancel_order(uuid, text) TO authenticated;

-- ── Settlement ──────────────────────────────────────────────────────────────
-- Moves the shares, maintains cost basis, writes both ledger legs, reissues
-- certificates and posts to the books. Every path into a settled trade — the
-- automatic engine, an admin approval, a direct allotment — comes through here.
CREATE OR REPLACE FUNCTION public.sacco_share_settle_transfer(p_transfer_id uuid)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t        public.sacco_share_transfers%ROWTYPE;
  s        public.sacco_share_settings%ROWTYPE;
  tr       public.sacco_share_treasury%ROWTYPE;
  hs       public.sacco_shares%ROWTYPE;   -- seller holding
  hb       public.sacco_shares%ROWTYPE;   -- buyer holding
  v_qty    integer;
  v_price  numeric;
  v_gross  numeric;
  v_gain   numeric := 0;
  v_cost   numeric;
  v_txn    uuid;
  v_je     uuid;
  v_desc   text;
BEGIN
  SELECT * INTO t FROM public.sacco_share_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  IF t.status = 'settled' THEN RAISE EXCEPTION 'This trade is already settled'; END IF;
  IF t.status = 'rejected' THEN RAISE EXCEPTION 'This trade was rejected'; END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(t.sacco_id);
  v_qty   := t.shares;
  v_price := CASE WHEN t.price_per_share > 0 THEN t.price_per_share
                  ELSE round(t.price / NULLIF(v_qty, 0), 2) END;
  v_gross := round(v_qty * v_price, 2);

  -- ── Seller side ───────────────────────────────────────────────────────────
  IF t.seller_is_treasury THEN
    SELECT * INTO tr FROM public.sacco_share_treasury WHERE sacco_id = t.sacco_id FOR UPDATE;
    IF tr.id IS NULL THEN RAISE EXCEPTION 'No treasury has been set up yet'; END IF;
    IF tr.treasury_shares < v_qty THEN
      RAISE EXCEPTION 'The treasury holds only % shares — cannot release %', tr.treasury_shares, v_qty;
    END IF;
    UPDATE public.sacco_share_treasury
       SET treasury_shares = treasury_shares - v_qty, updated_at = now()
     WHERE id = tr.id RETURNING * INTO tr;

    PERFORM public.sacco_share_txn(t.sacco_id, 'sale', NULL, true, -v_qty, v_price,
      tr.treasury_shares, t.buyer_member_id, t.buyer_is_treasury, t.seller_fee, 0,
      t.id, t.listing_id, NULL, 'Treasury sale');

  ELSIF t.seller_member_id IS NOT NULL THEN
    SELECT * INTO hs FROM public.sacco_share_holding(t.sacco_id, t.seller_member_id);
    IF hs.shares_held < v_qty THEN
      RAISE EXCEPTION 'The seller holds only % shares', hs.shares_held;
    END IF;
    -- Realised gain against the average cost the engine has been tracking.
    v_cost := round(v_qty * hs.avg_buy_price, 2);
    v_gain := round(v_gross - v_cost - t.seller_fee, 2);

    UPDATE public.sacco_shares
       SET shares_held    = shares_held - v_qty,
           locked_shares  = GREATEST(0, locked_shares - v_qty),
           total_invested = GREATEST(0, total_invested - v_cost),
           realized_gain  = realized_gain + v_gain,
           last_trade_date = CURRENT_DATE,
           updated_at = now()
     WHERE id = hs.id RETURNING * INTO hs;

    v_txn := public.sacco_share_txn(t.sacco_id, 'sale', t.seller_member_id, false,
      -v_qty, v_price, hs.shares_held, t.buyer_member_id, t.buyer_is_treasury,
      t.seller_fee, v_gain, t.id, t.listing_id, NULL, NULL);
    PERFORM public.sacco_share_reissue_certificate(t.sacco_id, t.seller_member_id, v_txn);
  END IF;

  -- ── Buyer side ────────────────────────────────────────────────────────────
  IF t.buyer_is_treasury THEN
    SELECT * INTO tr FROM public.sacco_share_treasury WHERE sacco_id = t.sacco_id FOR UPDATE;
    IF tr.id IS NULL THEN RAISE EXCEPTION 'No treasury has been set up yet'; END IF;
    UPDATE public.sacco_share_treasury
       SET treasury_shares = treasury_shares + v_qty, updated_at = now()
     WHERE id = tr.id RETURNING * INTO tr;

    PERFORM public.sacco_share_txn(t.sacco_id, 'buyback', NULL, true, v_qty, v_price,
      tr.treasury_shares, t.seller_member_id, t.seller_is_treasury, t.buyer_fee, 0,
      t.id, t.listing_id, NULL, 'Treasury buy-back');

  ELSIF t.buyer_member_id IS NOT NULL THEN
    SELECT * INTO hb FROM public.sacco_share_holding(t.sacco_id, t.buyer_member_id);

    UPDATE public.sacco_shares
       SET shares_held    = shares_held + v_qty,
           total_invested = total_invested + v_gross + t.buyer_fee,
           avg_buy_price  = round((total_invested + v_gross + t.buyer_fee)
                                  / NULLIF(shares_held + v_qty, 0), 4),
           par_value      = CASE WHEN COALESCE(par_value, 0) = 0 THEN s.par_value ELSE par_value END,
           first_purchase_date = COALESCE(first_purchase_date, CURRENT_DATE),
           last_trade_date = CURRENT_DATE,
           updated_at = now()
     WHERE id = hb.id RETURNING * INTO hb;

    v_txn := public.sacco_share_txn(t.sacco_id, 'purchase', t.buyer_member_id, false,
      v_qty, v_price, hb.shares_held, t.seller_member_id, t.seller_is_treasury,
      t.buyer_fee, 0, t.id, t.listing_id, NULL, NULL);
    PERFORM public.sacco_share_reissue_certificate(t.sacco_id, t.buyer_member_id, v_txn);
  END IF;

  UPDATE public.sacco_share_transfers
     SET status = 'settled', approved_by = COALESCE(approved_by, auth.uid()),
         settled_at = now(), updated_at = now()
   WHERE id = t.id RETURNING * INTO t;

  -- ── Books ─────────────────────────────────────────────────────────────────
  -- Only a house trade moves the society's own cash. A member-to-member trade
  -- settles between two members and touches the ledger only for the fee income.
  IF t.seller_is_treasury AND NOT t.buyer_is_treasury THEN
    v_desc := 'Treasury share sale to member';
    v_je := public.sacco_share_post_ledger(t.sacco_id, v_desc,
      jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit', v_gross, 'credit', 0),
        jsonb_build_object('account_code', '3010', 'debit', 0, 'credit', v_gross)),
      'SHR-' || left(t.id::text, 8), t.buyer_member_id, 'sacco_share_transfers', t.id);
  ELSIF t.buyer_is_treasury AND NOT t.seller_is_treasury THEN
    v_desc := 'Treasury share buy-back from member';
    v_je := public.sacco_share_post_ledger(t.sacco_id, v_desc,
      jsonb_build_array(
        jsonb_build_object('account_code', '3010', 'debit', v_gross, 'credit', 0),
        jsonb_build_object('account_code', '1020', 'debit', 0, 'credit', v_gross)),
      'SHR-' || left(t.id::text, 8), t.seller_member_id, 'sacco_share_transfers', t.id);
  END IF;

  IF (t.buyer_fee + t.seller_fee) > 0 THEN
    PERFORM public.sacco_share_post_ledger(t.sacco_id, 'Share trading fees',
      jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit', t.buyer_fee + t.seller_fee, 'credit', 0),
        jsonb_build_object('account_code', '4050', 'debit', 0, 'credit', t.buyer_fee + t.seller_fee)),
      'SHF-' || left(t.id::text, 8), t.buyer_member_id, 'sacco_share_transfers', t.id);
  END IF;

  PERFORM public.sacco_share_log(t.sacco_id, 'transfer', t.id, 'settled',
    COALESCE(t.buyer_member_id, t.seller_member_id), NULL, to_jsonb(t), NULL);

  RETURN t;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_settle_transfer(uuid) FROM PUBLIC, anon, authenticated;

-- Take an order off the book — the heart of the engine.
--   member posts sell → system checks ownership → locks shares →
--   buyer purchases → ownership transferred → ledger updated →
--   certificate reissued → audit written
-- Settles automatically unless the society requires approval, in which case a
-- pending transfer waits for staff.
CREATE OR REPLACE FUNCTION public.sacco_share_execute_order(
  p_listing_id uuid,
  p_shares     integer DEFAULT NULL,
  p_member_id  uuid    DEFAULT NULL,     -- counterparty; NULL = the caller
  p_as_treasury boolean DEFAULT false    -- the house takes the other side
)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l         public.sacco_share_listings%ROWTYPE;
  s         public.sacco_share_settings%ROWTYPE;
  h         public.sacco_shares%ROWTYPE;
  tr        public.sacco_share_treasury%ROWTYPE;
  v_me      uuid := public.current_sacco_member_id();
  v_party   uuid;
  v_treas   boolean := p_as_treasury;
  v_qty     integer;
  v_avail   integer;
  v_price   numeric;
  v_gross   numeric;
  v_buyer   uuid;
  v_seller  uuid;
  v_buyer_t boolean;
  v_seller_t boolean;
  v_bfee    numeric;
  v_sfee    numeric;
  v_total   bigint;
  v_after   integer;
  v_row     public.sacco_share_transfers%ROWTYPE;
  v_member_row public.sacco_members%ROWTYPE;
  v_is_staff boolean := false;
BEGIN
  SELECT * INTO l FROM public.sacco_share_listings WHERE id = p_listing_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF l.status <> 'open' THEN RAISE EXCEPTION 'This order is no longer open'; END IF;
  IF l.expiry_date IS NOT NULL AND l.expiry_date < CURRENT_DATE THEN
    UPDATE public.sacco_share_listings SET status = 'expired' WHERE id = l.id;
    RAISE EXCEPTION 'This order expired on %', l.expiry_date;
  END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(l.sacco_id);
  IF s.trading_suspended THEN
    RAISE EXCEPTION 'Trading is suspended%', COALESCE(' — ' || s.suspension_reason, '');
  END IF;

  -- Resolve the counterparty.
  IF v_me IS NOT NULL AND p_member_id IS NULL AND NOT p_as_treasury THEN
    v_party := v_me;
    IF NOT public.sacco_share_market_open(l.sacco_id) THEN
      RAISE EXCEPTION 'The share market is closed right now';
    END IF;
  ELSE
    PERFORM public.sacco_share_require_staff(l.sacco_id);
    v_is_staff := true;
    v_party := CASE WHEN p_as_treasury THEN NULL ELSE p_member_id END;
    IF NOT p_as_treasury AND v_party IS NULL THEN
      RAISE EXCEPTION 'Choose the member taking this order';
    END IF;
  END IF;

  v_avail := l.shares - l.filled_shares;
  v_qty   := LEAST(COALESCE(NULLIF(p_shares, 0), v_avail), v_avail);
  IF v_qty <= 0 THEN RAISE EXCEPTION 'Nothing left to fill on this order'; END IF;
  IF NOT s.allow_partial_fills AND v_qty <> v_avail THEN
    RAISE EXCEPTION 'This society does not allow partial fills — take all % shares', v_avail;
  END IF;

  v_price := l.price_per_share;
  v_gross := round(v_qty * v_price, 2);

  -- Sides. Taking a sell order makes the caller the buyer, and vice versa.
  IF l.side = 'sell' THEN
    v_seller   := l.seller_member_id;  v_seller_t := l.seller_is_treasury;
    v_buyer    := v_party;             v_buyer_t  := v_treas;
  ELSE
    v_buyer    := l.buyer_member_id;   v_buyer_t  := l.buyer_is_treasury;
    v_seller   := v_party;             v_seller_t := v_treas;
  END IF;

  IF v_buyer IS NOT NULL AND v_buyer = v_seller THEN
    RAISE EXCEPTION 'A member cannot trade with themselves';
  END IF;

  -- Compliance on the buying member: KYC, active membership, ownership ceiling.
  IF v_buyer IS NOT NULL THEN
    SELECT * INTO v_member_row FROM public.sacco_members WHERE id = v_buyer;
    IF v_member_row.id IS NULL THEN RAISE EXCEPTION 'Buyer not found'; END IF;
    IF v_member_row.status <> 'active' THEN
      RAISE EXCEPTION 'That membership is % — trading is not available', v_member_row.status;
    END IF;
    IF s.require_kyc_to_trade AND COALESCE(v_member_row.kyc_status, 'pending') <> 'verified' THEN
      RAISE EXCEPTION 'KYC must be verified before trading shares';
    END IF;

    SELECT * INTO h FROM public.sacco_share_holding(l.sacco_id, v_buyer);
    IF h.is_frozen THEN RAISE EXCEPTION 'This holding is frozen — %', COALESCE(h.freeze_reason, 'under dispute'); END IF;
    v_after := h.shares_held + v_qty;

    IF s.max_holding_shares > 0 AND v_after > s.max_holding_shares THEN
      RAISE EXCEPTION 'Ownership limit: a member may hold at most % shares (this would be %)',
        s.max_holding_shares, v_after;
    END IF;
    IF s.max_holding_percent > 0 THEN
      -- The whole issue: member-held plus the treasury pool. A society with no
      -- treasury row still has an issue, so the pool is COALESCEd rather than
      -- selected into the same variable (a no-row SELECT INTO would null it and
      -- silently skip the cap).
      SELECT COALESCE(SUM(sh.shares_held), 0)
             + COALESCE((SELECT tr2.treasury_shares FROM public.sacco_share_treasury tr2
                          WHERE tr2.sacco_id = l.sacco_id), 0)
        INTO v_total
        FROM public.sacco_shares sh WHERE sh.sacco_id = l.sacco_id;

      IF COALESCE(v_total, 0) > 0 AND (v_after::numeric / v_total) * 100 > s.max_holding_percent THEN
        RAISE EXCEPTION 'Ownership limit: no member may hold more than %%% of shares',
          s.max_holding_percent;
      END IF;
    END IF;
  END IF;

  -- The selling side must actually have the shares free.
  IF v_seller_t THEN
    SELECT * INTO tr FROM public.sacco_share_treasury WHERE sacco_id = l.sacco_id FOR UPDATE;
    IF tr.id IS NULL OR tr.treasury_shares < v_qty THEN
      RAISE EXCEPTION 'The treasury does not hold % shares', v_qty;
    END IF;
  ELSIF v_seller IS NOT NULL THEN
    SELECT * INTO h FROM public.sacco_share_holding(l.sacco_id, v_seller);
    IF h.is_frozen THEN RAISE EXCEPTION 'The seller''s holding is frozen'; END IF;
    -- On a sell order the shares are already escrowed; on a buy order they are not.
    IF l.side = 'sell' THEN
      IF h.shares_held < v_qty THEN RAISE EXCEPTION 'The seller holds only % shares', h.shares_held; END IF;
    ELSE
      IF (h.shares_held - h.locked_shares) < v_qty THEN
        RAISE EXCEPTION 'Only % shares are free to sell', GREATEST(h.shares_held - h.locked_shares, 0);
      END IF;
      IF s.min_holding > 0 AND (h.shares_held - v_qty) < s.min_holding THEN
        RAISE EXCEPTION 'Members must keep at least % shares', s.min_holding;
      END IF;
      -- Escrow now so settlement can release it exactly like a sell order.
      UPDATE public.sacco_shares SET locked_shares = locked_shares + v_qty,
             updated_at = now() WHERE id = h.id;
    END IF;
  END IF;

  v_bfee := round(v_gross * s.trading_fee_percent / 100, 2);
  v_sfee := round(v_gross * s.commission_percent / 100, 2);

  INSERT INTO public.sacco_share_transfers
    (admin_id, sacco_id, listing_id,
     seller_member_id, seller_is_treasury, buyer_member_id, buyer_is_treasury,
     shares, price, price_per_share, buyer_fee, seller_fee,
     trade_type, status, reference)
  VALUES
    (l.admin_id, l.sacco_id, l.id,
     v_seller, COALESCE(v_seller_t, false), v_buyer, COALESCE(v_buyer_t, false),
     v_qty, v_gross, v_price, v_bfee, v_sfee,
     'market', 'pending', 'ORD-' || left(l.id::text, 8))
  RETURNING * INTO v_row;

  -- Advance the order book.
  UPDATE public.sacco_share_listings
     SET filled_shares = filled_shares + v_qty,
         status = CASE
           WHEN filled_shares + v_qty >= shares THEN
             CASE WHEN s.require_transfer_approval OR NOT s.auto_settle
                  THEN 'pending_approval' ELSE 'settled' END
           ELSE 'open' END::public.share_listing_status,
         updated_at = now()
   WHERE id = l.id;

  PERFORM public.sacco_share_log(l.sacco_id, 'transfer', v_row.id, 'order_matched',
    COALESCE(v_buyer, v_seller), NULL, to_jsonb(v_row), NULL);

  -- Automatic settlement — no admin intervention unless the rules ask for it.
  IF s.auto_settle AND NOT s.require_transfer_approval THEN
    SELECT * INTO v_row FROM public.sacco_share_settle_transfer(v_row.id);
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_execute_order(uuid, integer, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_execute_order(uuid, integer, uuid, boolean) TO authenticated;

-- Staff approval / rejection for societies that require it.
CREATE OR REPLACE FUNCTION public.sacco_share_approve_transfer(p_id uuid)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE t public.sacco_share_transfers%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.sacco_share_transfers WHERE id = p_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  PERFORM public.sacco_share_require_staff(t.sacco_id);
  RETURN public.sacco_share_settle_transfer(p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_approve_transfer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_approve_transfer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sacco_share_reject_transfer(p_id uuid, p_reason text)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.sacco_share_transfers%ROWTYPE;
  l public.sacco_share_listings%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.sacco_share_transfers WHERE id = p_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  PERFORM public.sacco_share_require_staff(t.sacco_id);
  IF t.status = 'settled' THEN RAISE EXCEPTION 'Settled trades are reversed, not rejected'; END IF;

  UPDATE public.sacco_share_transfers
     SET status = 'rejected', reason = NULLIF(trim(COALESCE(p_reason, '')), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO t;

  -- Put the unsold shares back on the book and release the escrow.
  IF t.listing_id IS NOT NULL THEN
    SELECT * INTO l FROM public.sacco_share_listings WHERE id = t.listing_id FOR UPDATE;
    IF l.id IS NOT NULL THEN
      UPDATE public.sacco_share_listings
         SET filled_shares = GREATEST(0, filled_shares - t.shares),
             status = 'open', updated_at = now()
       WHERE id = l.id;
      IF l.side = 'buy' AND t.seller_member_id IS NOT NULL THEN
        UPDATE public.sacco_shares
           SET locked_shares = GREATEST(0, locked_shares - t.shares), updated_at = now()
         WHERE sacco_id = t.sacco_id AND member_id = t.seller_member_id;
      END IF;
    END IF;
  END IF;

  PERFORM public.sacco_share_log(t.sacco_id, 'transfer', t.id, 'rejected',
    COALESCE(t.buyer_member_id, t.seller_member_id), NULL, to_jsonb(t), p_reason);

  RETURN t;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_reject_transfer(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_reject_transfer(uuid, text) TO authenticated;

-- Reverse a settled trade: a mirror-image settled transfer, so the register
-- still adds up and the original stays on file exactly as it happened.
CREATE OR REPLACE FUNCTION public.sacco_share_reverse_trade(p_id uuid, p_reason text)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t   public.sacco_share_transfers%ROWTYPE;
  v_r public.sacco_share_transfers%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reversal needs a reason';
  END IF;
  SELECT * INTO t FROM public.sacco_share_transfers WHERE id = p_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  PERFORM public.sacco_share_require_staff(t.sacco_id);
  IF t.status <> 'settled' THEN RAISE EXCEPTION 'Only a settled trade can be reversed'; END IF;
  IF EXISTS (SELECT 1 FROM public.sacco_share_transfers WHERE reversed_of = t.id) THEN
    RAISE EXCEPTION 'This trade has already been reversed';
  END IF;

  INSERT INTO public.sacco_share_transfers
    (admin_id, sacco_id, seller_member_id, seller_is_treasury,
     buyer_member_id, buyer_is_treasury, shares, price, price_per_share,
     trade_type, status, reversed_of, reason, reference)
  VALUES
    (t.admin_id, t.sacco_id, t.buyer_member_id, t.buyer_is_treasury,
     t.seller_member_id, t.seller_is_treasury, t.shares, t.price, t.price_per_share,
     'reversal', 'pending', t.id, trim(p_reason), 'REV-' || left(t.id::text, 8))
  RETURNING * INTO v_r;

  SELECT * INTO v_r FROM public.sacco_share_settle_transfer(v_r.id);

  PERFORM public.sacco_share_log(t.sacco_id, 'transfer', t.id, 'reversed',
    COALESCE(t.buyer_member_id, t.seller_member_id), to_jsonb(t), to_jsonb(v_r), p_reason);

  RETURN v_r;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_reverse_trade(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_reverse_trade(uuid, text) TO authenticated;

-- Direct movement with no order book: treasury → member allotment, a forced
-- transfer, or a member-to-member gift. Settles immediately.
CREATE OR REPLACE FUNCTION public.sacco_share_direct_transfer(
  p_shares      integer,
  p_price       numeric DEFAULT 0,
  p_from_member uuid    DEFAULT NULL,
  p_to_member   uuid    DEFAULT NULL,
  p_from_treasury boolean DEFAULT false,
  p_to_treasury   boolean DEFAULT false,
  p_reason      text    DEFAULT NULL
)
RETURNS public.sacco_share_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid;
  v_admin uuid;
  s       public.sacco_share_settings%ROWTYPE;
  v_me    uuid := public.current_sacco_member_id();
  v_row   public.sacco_share_transfers%ROWTYPE;
  v_from  uuid := p_from_member;
  v_staff boolean := false;
  h       public.sacco_shares%ROWTYPE;
BEGIN
  IF COALESCE(p_shares, 0) <= 0 THEN RAISE EXCEPTION 'Transfer at least one share'; END IF;
  IF p_from_treasury AND p_to_treasury THEN RAISE EXCEPTION 'Pick a member on one side'; END IF;

  -- A member may only give away their own shares, and only if the rules allow it.
  IF v_me IS NOT NULL AND p_from_member IS NULL AND NOT p_from_treasury THEN
    v_from := v_me;
    SELECT sacco_id INTO v_sacco FROM public.sacco_members WHERE id = v_me;
    SELECT * INTO s FROM public.sacco_share_settings_row(v_sacco);
    IF NOT s.allow_member_transfers THEN
      RAISE EXCEPTION 'This society does not allow member-to-member transfers';
    END IF;
    IF p_to_treasury THEN RAISE EXCEPTION 'Sell to the treasury through the marketplace'; END IF;
  ELSE
    v_sacco := public.sacco_active_sacco_id();
    PERFORM public.sacco_share_require_staff(v_sacco);
    v_staff := true;
    SELECT * INTO s FROM public.sacco_share_settings_row(v_sacco);
  END IF;

  IF NOT p_from_treasury AND v_from IS NULL THEN RAISE EXCEPTION 'Choose who the shares come from'; END IF;
  IF NOT p_to_treasury AND p_to_member IS NULL THEN RAISE EXCEPTION 'Choose who the shares go to'; END IF;
  IF v_from IS NOT NULL AND v_from = p_to_member THEN RAISE EXCEPTION 'Sender and recipient are the same member'; END IF;

  IF NOT p_from_treasury THEN
    SELECT * INTO h FROM public.sacco_share_holding(v_sacco, v_from);
    IF h.is_frozen THEN RAISE EXCEPTION 'This holding is frozen — %', COALESCE(h.freeze_reason, 'under dispute'); END IF;
    IF (h.shares_held - h.locked_shares) < p_shares THEN
      RAISE EXCEPTION 'Only % shares are free to transfer', GREATEST(h.shares_held - h.locked_shares, 0);
    END IF;
    IF NOT v_staff AND s.min_holding > 0 AND (h.shares_held - p_shares) < s.min_holding THEN
      RAISE EXCEPTION 'Members must keep at least % shares', s.min_holding;
    END IF;
  END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;

  INSERT INTO public.sacco_share_transfers
    (admin_id, sacco_id, seller_member_id, seller_is_treasury,
     buyer_member_id, buyer_is_treasury, shares, price, price_per_share,
     trade_type, status, reason)
  VALUES
    (v_admin, v_sacco,
     CASE WHEN p_from_treasury THEN NULL ELSE v_from END, p_from_treasury,
     CASE WHEN p_to_treasury   THEN NULL ELSE p_to_member END, p_to_treasury,
     p_shares, round(p_shares * COALESCE(p_price, 0), 2), round(COALESCE(p_price, 0), 2),
     CASE WHEN p_from_treasury THEN 'allotment'
          WHEN p_to_treasury   THEN 'buyback'
          ELSE 'transfer' END,
     'pending', NULLIF(trim(COALESCE(p_reason, '')), ''))
  RETURNING * INTO v_row;

  RETURN public.sacco_share_settle_transfer(v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_direct_transfer(integer, numeric, uuid, uuid, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_direct_transfer(integer, numeric, uuid, uuid, boolean, boolean, text)
  TO authenticated;

-- Suspend / resume the whole market.
CREATE OR REPLACE FUNCTION public.sacco_share_set_trading(
  p_suspended boolean,
  p_reason    text DEFAULT NULL
)
RETURNS public.sacco_share_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_row   public.sacco_share_settings%ROWTYPE;
  v_old   jsonb;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  SELECT * INTO v_row FROM public.sacco_share_settings_row(v_sacco);
  v_old := to_jsonb(v_row);

  UPDATE public.sacco_share_settings
     SET trading_suspended = p_suspended,
         suspension_reason = CASE WHEN p_suspended THEN NULLIF(trim(COALESCE(p_reason, '')), '') END,
         updated_at = now()
   WHERE id = v_row.id RETURNING * INTO v_row;

  PERFORM public.sacco_share_log(v_sacco, 'settings', v_row.id,
    CASE WHEN p_suspended THEN 'trading_suspended' ELSE 'trading_resumed' END,
    NULL, v_old, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_set_trading(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_set_trading(boolean, text) TO authenticated;

-- Save the market rules.
CREATE OR REPLACE FUNCTION public.sacco_share_save_settings(p_patch jsonb)
RETURNS public.sacco_share_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_row   public.sacco_share_settings%ROWTYPE;
  v_old   jsonb;
  v_allowed text[] := ARRAY[
    'par_value','min_holding','max_holding_shares','max_holding_percent',
    'trading_fee_percent','commission_percent','dividend_formula','dividend_tax_percent',
    'votes_per_share','allow_member_transfers','require_transfer_approval','auto_settle',
    'allow_partial_fills','price_floor_is_par','lock_in_days','market_open_time',
    'market_close_time','market_days','require_kyc_to_trade','large_trade_threshold',
    'certificate_prefix'];
  v_key text;
  v_set text := '';
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  SELECT * INTO v_row FROM public.sacco_share_settings_row(v_sacco);
  v_old := to_jsonb(v_row);

  FOREACH v_key IN ARRAY v_allowed LOOP
    IF p_patch ? v_key THEN
      v_set := v_set || format('%I = ($1 ->> %L)::%s, ', v_key, v_key,
        CASE v_key
          WHEN 'market_days' THEN 'integer[]'
          WHEN 'market_open_time' THEN 'time'
          WHEN 'market_close_time' THEN 'time'
          WHEN 'certificate_prefix' THEN 'text'
          WHEN 'dividend_formula' THEN 'text'
          WHEN 'min_holding' THEN 'integer'
          WHEN 'max_holding_shares' THEN 'integer'
          WHEN 'lock_in_days' THEN 'integer'
          WHEN 'allow_member_transfers' THEN 'boolean'
          WHEN 'require_transfer_approval' THEN 'boolean'
          WHEN 'auto_settle' THEN 'boolean'
          WHEN 'allow_partial_fills' THEN 'boolean'
          WHEN 'price_floor_is_par' THEN 'boolean'
          WHEN 'require_kyc_to_trade' THEN 'boolean'
          ELSE 'numeric' END);
    END IF;
  END LOOP;

  IF v_set = '' THEN RETURN v_row; END IF;

  EXECUTE format('UPDATE public.sacco_share_settings SET %s updated_at = now() WHERE id = %L',
                 v_set, v_row.id) USING p_patch;

  SELECT * INTO v_row FROM public.sacco_share_settings WHERE id = v_row.id;
  PERFORM public.sacco_share_log(v_sacco, 'settings', v_row.id, 'settings_updated',
    NULL, v_old, to_jsonb(v_row), NULL);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_save_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_save_settings(jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. DIVIDEND CENTRE
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sacco_dividend_declare(
  p_period_label text,
  p_basis        text,
  p_profit       numeric,
  p_percent      numeric,
  p_per_share    numeric,
  p_record_date  date,
  p_payment_date date DEFAULT NULL,
  p_payout_method text DEFAULT 'cash',
  p_notes        text DEFAULT NULL
)
RETURNS public.sacco_dividend_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_admin uuid;
  v_row   public.sacco_dividend_declarations%ROWTYPE;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  IF COALESCE(trim(p_period_label), '') = '' THEN RAISE EXCEPTION 'Name the dividend period'; END IF;
  IF p_basis NOT IN ('profit_percent', 'per_share') THEN RAISE EXCEPTION 'Unsupported basis %', p_basis; END IF;
  IF p_payout_method NOT IN ('cash', 'savings') THEN RAISE EXCEPTION 'Unsupported payout method %', p_payout_method; END IF;
  IF p_basis = 'profit_percent' AND NOT (COALESCE(p_profit, 0) > 0 AND COALESCE(p_percent, 0) > 0) THEN
    RAISE EXCEPTION 'Enter the profit and the dividend percentage';
  END IF;
  IF p_basis = 'per_share' AND NOT (COALESCE(p_per_share, 0) > 0) THEN
    RAISE EXCEPTION 'Enter the amount per share';
  END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;

  INSERT INTO public.sacco_dividend_declarations
    (admin_id, sacco_id, period_label, basis, profit_amount, dividend_percent,
     dividend_per_share, record_date, payment_date, payout_method, notes,
     status, declared_by, declared_at)
  VALUES
    (v_admin, v_sacco, trim(p_period_label), p_basis,
     COALESCE(p_profit, 0), COALESCE(p_percent, 0), COALESCE(p_per_share, 0),
     COALESCE(p_record_date, CURRENT_DATE), p_payment_date, p_payout_method,
     NULLIF(trim(COALESCE(p_notes, '')), ''), 'declared', auth.uid(), now())
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_log(v_sacco, 'dividend', v_row.id, 'declared',
    NULL, NULL, to_jsonb(v_row), NULL);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_dividend_declare(text, text, numeric, numeric, numeric, date, date, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_dividend_declare(text, text, numeric, numeric, numeric, date, date, text, text)
  TO authenticated;

-- Calculate every member's dividend from their holding on the record date.
-- Holdings as of a past record date are reconstructed from the share ledger, so
-- someone who sold after the record date is still paid what they were owed.
CREATE OR REPLACE FUNCTION public.sacco_dividend_calculate(p_id uuid)
RETURNS public.sacco_dividend_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d       public.sacco_dividend_declarations%ROWTYPE;
  s       public.sacco_share_settings%ROWTYPE;
  v_pool  numeric;
  v_total bigint;
  v_rate  numeric;
BEGIN
  SELECT * INTO d FROM public.sacco_dividend_declarations WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Declaration not found'; END IF;
  PERFORM public.sacco_share_require_staff(d.sacco_id);
  IF d.status = 'paid' THEN RAISE EXCEPTION 'This dividend has already been paid'; END IF;
  IF d.status = 'cancelled' THEN RAISE EXCEPTION 'This declaration was cancelled'; END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(d.sacco_id);

  -- Holdings as they stood on the record date: today's balance, unwound by every
  -- share that moved afterwards. Someone who sold last week is still paid what
  -- they were owed on the record date.
  SELECT COALESCE(SUM(x.shares), 0) INTO v_total FROM (
    SELECT GREATEST(0, sh.shares_held - COALESCE((
             SELECT SUM(tx.shares) FROM public.sacco_share_transactions tx
              WHERE tx.member_id = sh.member_id
                AND tx.sacco_id  = sh.sacco_id
                AND tx.created_at::date > d.record_date
                AND tx.txn_type <> 'dividend'), 0)) AS shares
      FROM public.sacco_shares sh
     WHERE sh.sacco_id = d.sacco_id
  ) x;

  IF v_total = 0 THEN RAISE EXCEPTION 'No member held shares on %', d.record_date; END IF;

  IF d.basis = 'per_share' THEN
    v_rate := d.dividend_per_share;
    v_pool := round(v_total * v_rate, 2);
  ELSE
    v_pool := round(d.profit_amount * d.dividend_percent / 100, 2);
    v_rate := round(v_pool / v_total, 4);
  END IF;

  DELETE FROM public.sacco_dividend_allocations WHERE declaration_id = d.id;

  INSERT INTO public.sacco_dividend_allocations
    (admin_id, sacco_id, declaration_id, member_id, shares_at_record,
     gross_amount, tax_amount, net_amount, status)
  SELECT d.admin_id, d.sacco_id, d.id, h.member_id, h.shares,
         round(h.shares * v_rate, 2),
         round(h.shares * v_rate * s.dividend_tax_percent / 100, 2),
         round(h.shares * v_rate, 2) - round(h.shares * v_rate * s.dividend_tax_percent / 100, 2),
         'pending'
    FROM (
      SELECT sh.member_id,
             GREATEST(0, sh.shares_held - COALESCE((
               SELECT SUM(tx.shares) FROM public.sacco_share_transactions tx
                WHERE tx.member_id = sh.member_id
                  AND tx.sacco_id  = sh.sacco_id
                  AND tx.created_at::date > d.record_date
                  AND tx.txn_type <> 'dividend'), 0))::integer AS shares
        FROM public.sacco_shares sh
       WHERE sh.sacco_id = d.sacco_id
    ) h
   WHERE h.shares > 0;

  UPDATE public.sacco_dividend_declarations dd
     SET status = 'calculated',
         dividend_per_share = v_rate,
         total_shares  = v_total,
         total_payable = (SELECT COALESCE(SUM(gross_amount), 0) FROM public.sacco_dividend_allocations WHERE declaration_id = d.id),
         total_tax     = (SELECT COALESCE(SUM(tax_amount), 0)   FROM public.sacco_dividend_allocations WHERE declaration_id = d.id),
         members_count = (SELECT COUNT(*) FROM public.sacco_dividend_allocations WHERE declaration_id = d.id),
         calculated_at = now(), updated_at = now()
   WHERE dd.id = d.id
  RETURNING * INTO d;

  -- Accrue the liability: surplus is appropriated, dividends become payable.
  UPDATE public.sacco_dividend_declarations
     SET journal_entry_id = public.sacco_share_post_ledger(
           d.sacco_id, 'Dividend declared — ' || d.period_label,
           jsonb_build_array(
             jsonb_build_object('account_code', '3200', 'debit', d.total_payable, 'credit', 0),
             jsonb_build_object('account_code', '2210', 'debit', 0, 'credit', d.total_payable)),
           'DIV-' || left(d.id::text, 8), NULL, 'sacco_dividend_declarations', d.id)
   WHERE id = d.id AND journal_entry_id IS NULL;

  PERFORM public.sacco_share_log(d.sacco_id, 'dividend', d.id, 'calculated',
    NULL, NULL, to_jsonb(d), NULL);

  SELECT * INTO d FROM public.sacco_dividend_declarations WHERE id = p_id;
  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_dividend_calculate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_dividend_calculate(uuid) TO authenticated;

-- Pay the calculated dividend. 'savings' credits each member's deposits as a
-- completed contribution — the member's wallet inside the sacco.
CREATE OR REPLACE FUNCTION public.sacco_dividend_pay(p_id uuid, p_reference text DEFAULT NULL)
RETURNS public.sacco_dividend_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d public.sacco_dividend_declarations%ROWTYPE;
  a RECORD;
BEGIN
  SELECT * INTO d FROM public.sacco_dividend_declarations WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Declaration not found'; END IF;
  PERFORM public.sacco_share_require_staff(d.sacco_id);
  IF d.status <> 'calculated' THEN
    RAISE EXCEPTION 'Calculate the dividend before paying it';
  END IF;

  FOR a IN SELECT * FROM public.sacco_dividend_allocations
            WHERE declaration_id = d.id AND status = 'pending' LOOP

    UPDATE public.sacco_shares
       SET dividends_earned = dividends_earned + a.net_amount, updated_at = now()
     WHERE sacco_id = d.sacco_id AND member_id = a.member_id;

    PERFORM public.sacco_share_txn(d.sacco_id, 'dividend', a.member_id, false, 0,
      d.dividend_per_share, a.shares_at_record, NULL, false, a.tax_amount, 0,
      NULL, NULL, d.id, 'Dividend ' || d.period_label);

    -- Credited to the member's savings rather than paid out in cash.
    IF d.payout_method = 'savings' AND a.net_amount > 0 THEN
      INSERT INTO public.sacco_contributions
        (admin_id, sacco_id, member_id, amount, contribution_type, status,
         payment_method, reference, notes, paid_date)
      VALUES
        (d.admin_id, d.sacco_id, a.member_id, a.net_amount, 'dividend', 'completed',
         'other', COALESCE(p_reference, 'DIV-' || left(d.id::text, 8)),
         'Dividend ' || d.period_label || ' credited to savings', COALESCE(d.payment_date, CURRENT_DATE));
    END IF;

    UPDATE public.sacco_dividend_allocations
       SET status = 'paid', paid_at = now(),
           payment_ref = COALESCE(p_reference, 'DIV-' || left(d.id::text, 8))
     WHERE id = a.id;
  END LOOP;

  UPDATE public.sacco_dividend_declarations
     SET status = 'paid', paid_at = now(),
         payment_date = COALESCE(payment_date, CURRENT_DATE), updated_at = now()
   WHERE id = d.id RETURNING * INTO d;

  -- Settle the liability: cash out, or into member savings (a liability swap).
  PERFORM public.sacco_share_post_ledger(d.sacco_id, 'Dividend paid — ' || d.period_label,
    jsonb_build_array(
      jsonb_build_object('account_code', '2210', 'debit', d.total_payable, 'credit', 0),
      jsonb_build_object('account_code',
        CASE WHEN d.payout_method = 'savings' THEN '2010' ELSE '1020' END,
        'debit', 0, 'credit', d.total_payable)),
    'DIV-' || left(d.id::text, 8), NULL, 'sacco_dividend_declarations', d.id);

  PERFORM public.sacco_share_log(d.sacco_id, 'dividend', d.id, 'paid', NULL, NULL, to_jsonb(d), NULL);

  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_dividend_pay(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_dividend_pay(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sacco_dividend_cancel(p_id uuid, p_reason text)
RETURNS public.sacco_dividend_declarations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE d public.sacco_dividend_declarations%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.sacco_dividend_declarations WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Declaration not found'; END IF;
  PERFORM public.sacco_share_require_staff(d.sacco_id);
  IF d.status = 'paid' THEN RAISE EXCEPTION 'A paid dividend cannot be cancelled'; END IF;

  UPDATE public.sacco_dividend_allocations
     SET status = 'cancelled' WHERE declaration_id = d.id;
  UPDATE public.sacco_dividend_declarations
     SET status = 'cancelled', notes = COALESCE(notes || ' · ', '') || COALESCE(trim(p_reason), 'Cancelled'),
         updated_at = now()
   WHERE id = d.id RETURNING * INTO d;

  PERFORM public.sacco_share_log(d.sacco_id, 'dividend', d.id, 'cancelled', NULL, NULL, to_jsonb(d), p_reason);
  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_dividend_cancel(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_dividend_cancel(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 13. ANALYTICS + COMPLIANCE
-- ----------------------------------------------------------------------------

-- Trades worth a second look: oversized, off-market, or self-dealing patterns.
CREATE OR REPLACE FUNCTION public.sacco_share_alerts(p_days integer DEFAULT 90)
RETURNS TABLE (
  transfer_id uuid,
  traded_at   timestamptz,
  member_id   uuid,
  shares      integer,
  amount      numeric,
  severity    text,
  reason      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  s       public.sacco_share_settings%ROWTYPE;
  v_mv    numeric;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  SELECT * INTO s FROM public.sacco_share_settings WHERE sacco_id = v_sacco;
  SELECT sp.market_value INTO v_mv FROM public.sacco_share_prices sp
   WHERE sp.sacco_id = v_sacco ORDER BY sp.effective_date DESC LIMIT 1;

  RETURN QUERY
  -- Large trades (AML threshold)
  SELECT t.id, t.created_at, COALESCE(t.buyer_member_id, t.seller_member_id),
         t.shares, t.price, 'high'::text,
         'Trade of ' || to_char(t.price, 'FM999,999,999.00')
           || ' exceeds the ' || to_char(s.large_trade_threshold, 'FM999,999,999.00') || ' review threshold'
    FROM public.sacco_share_transfers t
   WHERE t.sacco_id = v_sacco AND t.status = 'settled'
     AND COALESCE(s.large_trade_threshold, 0) > 0
     AND t.price >= s.large_trade_threshold
     AND t.created_at > now() - make_interval(days => p_days)

  UNION ALL
  -- Prices far away from the published market value
  SELECT t.id, t.created_at, COALESCE(t.buyer_member_id, t.seller_member_id),
         t.shares, t.price, 'medium'::text,
         'Executed at ' || to_char(t.price_per_share, 'FM999,999.00')
           || ' against a market value of ' || to_char(v_mv, 'FM999,999.00')
    FROM public.sacco_share_transfers t
   WHERE t.sacco_id = v_sacco AND t.status = 'settled'
     AND COALESCE(v_mv, 0) > 0 AND t.price_per_share > 0
     AND abs(t.price_per_share - v_mv) / v_mv > 0.25
     AND t.created_at > now() - make_interval(days => p_days)

  UNION ALL
  -- Rapid in-and-out trading by one member
  SELECT NULL::uuid, max(tx.created_at), tx.member_id,
         SUM(abs(tx.shares))::integer, SUM(tx.amount), 'medium'::text,
         count(*) || ' trades in ' || p_days || ' days — rapid trading pattern'
    FROM public.sacco_share_transactions tx
   WHERE tx.sacco_id = v_sacco AND tx.member_id IS NOT NULL
     AND tx.txn_type IN ('purchase', 'sale')
     AND tx.created_at > now() - make_interval(days => p_days)
   GROUP BY tx.member_id
  HAVING count(*) >= 10

  UNION ALL
  -- Members bumping against the ownership ceiling
  SELECT NULL::uuid, now(), sh.member_id, sh.shares_held,
         round(sh.shares_held * COALESCE(v_mv, sh.par_value), 2), 'low'::text,
         'Holds ' || sh.shares_held || ' shares — within 10% of the ownership limit'
    FROM public.sacco_shares sh
   WHERE sh.sacco_id = v_sacco
     AND COALESCE(s.max_holding_shares, 0) > 0
     AND sh.shares_held >= s.max_holding_shares * 0.9

  UNION ALL
  -- Unverified members holding shares while KYC is required to trade
  SELECT NULL::uuid, now(), sh.member_id, sh.shares_held,
         round(sh.shares_held * COALESCE(v_mv, sh.par_value), 2), 'high'::text,
         'Holds shares but KYC is ' || COALESCE(m.kyc_status, 'pending')
    FROM public.sacco_shares sh
    JOIN public.sacco_members m ON m.id = sh.member_id
   WHERE sh.sacco_id = v_sacco AND sh.shares_held > 0
     AND COALESCE(s.require_kyc_to_trade, false)
     AND COALESCE(m.kyc_status, 'pending') <> 'verified';
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_alerts(integer) TO authenticated;

-- The share register: one authoritative row per holder.
CREATE OR REPLACE FUNCTION public.sacco_share_register()
RETURNS TABLE (
  member_id     uuid,
  member_no     text,
  full_name     text,
  kyc_status    text,
  shares_held   integer,
  locked_shares integer,
  is_frozen     boolean,
  avg_buy_price numeric,
  total_invested numeric,
  realized_gain numeric,
  dividends_earned numeric,
  market_value  numeric,
  unrealized_gain numeric,
  ownership_pct numeric,
  certificate_no text,
  first_purchase_date date,
  last_trade_date date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_mv    numeric;
  v_total bigint;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);

  SELECT sp.market_value INTO v_mv FROM public.sacco_share_prices sp
   WHERE sp.sacco_id = v_sacco ORDER BY sp.effective_date DESC LIMIT 1;
  SELECT COALESCE(SUM(sh.shares_held), 0) INTO v_total
    FROM public.sacco_shares sh WHERE sh.sacco_id = v_sacco;

  RETURN QUERY
  SELECT sh.member_id, m.member_no, m.full_name, COALESCE(m.kyc_status, 'pending')::text,
         sh.shares_held, sh.locked_shares, sh.is_frozen,
         sh.avg_buy_price::numeric, sh.total_invested::numeric,
         sh.realized_gain::numeric, sh.dividends_earned::numeric,
         round(sh.shares_held * COALESCE(NULLIF(v_mv, 0), sh.par_value), 2),
         round(sh.shares_held * COALESCE(NULLIF(v_mv, 0), sh.par_value) - sh.total_invested, 2),
         CASE WHEN v_total > 0 THEN round(sh.shares_held::numeric * 100 / v_total, 3) ELSE 0 END,
         (SELECT c.certificate_no FROM public.sacco_share_certificates c
           WHERE c.member_id = sh.member_id AND c.status = 'active' LIMIT 1),
         sh.first_purchase_date, sh.last_trade_date
    FROM public.sacco_shares sh
    JOIN public.sacco_members m ON m.id = sh.member_id
   WHERE sh.sacco_id = v_sacco
   ORDER BY sh.shares_held DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_register() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_register() TO authenticated;

-- Expire orders whose date has passed and release their escrow. Safe to call
-- from the UI on load, or from a scheduled job.
CREATE OR REPLACE FUNCTION public.sacco_share_expire_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  l       RECORD;
  v_n     integer := 0;
BEGIN
  IF v_sacco IS NULL THEN RETURN 0; END IF;

  FOR l IN SELECT * FROM public.sacco_share_listings
            WHERE sacco_id = v_sacco AND status = 'open'
              AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE LOOP
    IF l.side = 'sell' AND l.seller_member_id IS NOT NULL THEN
      UPDATE public.sacco_shares
         SET locked_shares = GREATEST(0, locked_shares - (l.shares - l.filled_shares))
       WHERE sacco_id = v_sacco AND member_id = l.seller_member_id;
    END IF;
    UPDATE public.sacco_share_listings SET status = 'expired', updated_at = now() WHERE id = l.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_expire_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_expire_orders() TO authenticated;

-- ----------------------------------------------------------------------------
-- 14. RLS, TRIGGERS, GRANTS, REALTIME
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY[
    'sacco_share_settings','sacco_share_transactions','sacco_share_certificates',
    'sacco_dividend_declarations','sacco_dividend_allocations'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_admin_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_admin_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();', t);

    EXECUTE format('ALTER TABLE public.%1$s ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_manage_%1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "tenant_manage_%1$s" ON public.%1$s
         FOR ALL TO authenticated
         USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
         WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());', t);
  END LOOP;
END $$;

ALTER TABLE public.sacco_share_audit ENABLE ROW LEVEL SECURITY;

-- Members read what is theirs, plus the rules everyone trades under.
DROP POLICY IF EXISTS "member_read_share_settings" ON public.sacco_share_settings;
CREATE POLICY "member_read_share_settings" ON public.sacco_share_settings
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

DROP POLICY IF EXISTS "member_read_own_share_txns" ON public.sacco_share_transactions;
CREATE POLICY "member_read_own_share_txns" ON public.sacco_share_transactions
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

DROP POLICY IF EXISTS "member_read_own_certificates" ON public.sacco_share_certificates;
CREATE POLICY "member_read_own_certificates" ON public.sacco_share_certificates
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

-- A declared dividend is society-wide news; a draft is not.
DROP POLICY IF EXISTS "member_read_dividends" ON public.sacco_dividend_declarations;
CREATE POLICY "member_read_dividends" ON public.sacco_dividend_declarations
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id()
         AND status IN ('declared', 'calculated', 'paid'));

DROP POLICY IF EXISTS "member_read_own_allocations" ON public.sacco_dividend_allocations;
CREATE POLICY "member_read_own_allocations" ON public.sacco_dividend_allocations
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

-- Append-only audit: written by SECURITY DEFINER, read by staff and by the
-- member whose own shares moved.
DROP POLICY IF EXISTS "tenant_read_share_audit" ON public.sacco_share_audit;
CREATE POLICY "tenant_read_share_audit" ON public.sacco_share_audit
  FOR SELECT TO authenticated
  USING (
    (admin_id = public.current_admin_id() AND public.is_staff_member())
    OR public.is_global_viewer()
    OR member_id = public.current_sacco_member_id()
  );

-- Members no longer write the order book directly. Every member action now goes
-- through a SECURITY DEFINER RPC, which is what keeps the share escrow, the
-- holding limits and the cost basis honest — a raw UPDATE could list the same
-- share twice or settle a trade without moving it. Reading the book stays open.
DROP POLICY IF EXISTS "member_create_listing"      ON public.sacco_share_listings;
DROP POLICY IF EXISTS "member_update_open_listing" ON public.sacco_share_listings;
DROP POLICY IF EXISTS "member_request_transfer"    ON public.sacco_share_transfers;

-- Live updates: the marketplace must move under members' feet as trades settle.
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY[
    'sacco_share_settings','sacco_share_transactions','sacco_share_certificates',
    'sacco_dividend_declarations','sacco_dividend_allocations','sacco_share_audit',
    'sacco_share_treasury','sacco_share_prices'
  ];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
             WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Seed settings for every sacco that already exists, so the tab has rules to
-- show the moment it loads.
INSERT INTO public.sacco_share_settings (admin_id, sacco_id, par_value)
SELECT s.admin_id, s.id,
       COALESCE((SELECT NULLIF(t.par_value, 0) FROM public.sacco_share_treasury t WHERE t.sacco_id = s.id), 100)
  FROM public.saccos s
ON CONFLICT (sacco_id) DO NOTHING;
