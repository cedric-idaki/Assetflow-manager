-- ============================================================================
-- SACCO share withholding & sale register
--
-- A society routinely has to hold a member's shares back: as security on a
-- loan, on exit or death while the estate is settled, under a court order, or
-- while a disciplinary case runs. Sometimes the held-back shares are then sold
-- on the society's internal market to recover what is owed.
--
-- Until now the share engine could only express two extremes — `locked_shares`
-- (automatic escrow behind an open sell order) and `is_frozen` (an all-or-
-- nothing block on the whole holding). Neither can say "500 of this member's
-- 2,000 shares are withheld as security on loan LN-0042", nor value that, nor
-- tell you later what became of them.
--
-- This adds that register:
--
--   1. Holding counter  — sacco_shares.withheld_shares, kept in sync from the
--                         register so every existing free-shares check sees it.
--   2. The register     — sacco_share_withholdings: one row per withholding,
--                         with quantity, valuation, reason and disposition.
--   3. The history      — sacco_share_withholding_events: append-only, every
--                         movement on a withholding with the balance after it.
--   4. Listings link    — sacco_share_listings.withholding_id, so withheld
--                         shares sell through the SAME order book, engine and
--                         settlement path as any other share.
--   5. Guards           — triggers that make withholding real without
--                         rewriting a single engine function (see below).
--   6. RPCs             — withhold / release / place for sale / summary.
--
-- WHY TRIGGERS AND NOT REWRITTEN ENGINE FUNCTIONS
--   sacco_share_place_order, _update_order, _execute_order, _settle_transfer,
--   _cancel_order, _expire_orders and _freeze_member are long, load-bearing and
--   already re-declared once by the KYC-gate migration. Re-declaring them again
--   to thread one more counter through would be seven copies to keep in step.
--   Instead three small triggers close the loop:
--
--     * sacco_shares BEFORE UPDATE — refuses any update that would commit more
--       shares than the member has free once withholding is counted. It fires
--       only when the update TIGHTENS the position (escrow up, or holding
--       down), which is exactly the set of paths that could sell withheld
--       shares, and never on the release paths that legitimately unwind one.
--     * sacco_share_listings AFTER UPDATE — a withholding's sale order that is
--       cancelled or expires puts its shares back under withholding rather
--       than letting them fall free. One trigger covers cancel_order,
--       expire_orders AND freeze_member's bulk cancel.
--     * sacco_share_transfers AFTER UPDATE — a settled sale of withheld shares
--       discharges that many from the withholding and books the proceeds; a
--       reversal puts them back.
--
-- INVARIANT
--   shares_held >= locked_shares + withheld_shares, always.
--   `locked_shares` keeps its existing meaning exactly — escrow behind an open
--   order — so every message and display that already reads it stays truthful.
--   Shares placed for sale move OUT of withheld_shares and INTO locked_shares;
--   the register's own listed_shares remembers they are still withheld, just
--   on the market.
--
-- Money and ownership still move only inside SECURITY DEFINER RPCs, and the
-- history is append-only — the same two rules the rest of the share stack runs
-- on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HOLDING COUNTER
--    Shares under a live withholding that are NOT currently on the market.
--    Derived from the register and re-synced by sacco_share_withholding_sync().
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_shares
  ADD COLUMN IF NOT EXISTS withheld_shares INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.sacco_shares
    ADD CONSTRAINT sacco_shares_withheld_nonneg CHECK (withheld_shares >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.sacco_shares.withheld_shares IS
  'Shares held back by the society under a live withholding and not currently listed for sale. '
  'Disjoint from locked_shares: a withholding put on the market moves into locked_shares.';

-- ----------------------------------------------------------------------------
-- 2. THE REGISTER
--    outstanding_shares is generated, so "how many are still withheld" can
--    never disagree with the movements that produced it.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.sacco_share_withholding_seq;

CREATE TABLE IF NOT EXISTS public.sacco_share_withholdings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  member_id          UUID NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  ref_no             TEXT NOT NULL,
  shares             INTEGER NOT NULL CHECK (shares > 0),
  released_shares    INTEGER NOT NULL DEFAULT 0 CHECK (released_shares >= 0),
  sold_shares        INTEGER NOT NULL DEFAULT 0 CHECK (sold_shares >= 0),
  listed_shares      INTEGER NOT NULL DEFAULT 0 CHECK (listed_shares >= 0),
  outstanding_shares INTEGER GENERATED ALWAYS AS (shares - released_shares - sold_shares) STORED,
  reason_type        TEXT NOT NULL DEFAULT 'other',
  reason             TEXT,
  reference          TEXT,                                -- loan no., case no., minute ref.
  unit_value         DECIMAL(15,2) NOT NULL DEFAULT 0,    -- value per share the day it was withheld
  proceeds           DECIMAL(18,2) NOT NULL DEFAULT 0,    -- net recovered from sales so far
  status             TEXT NOT NULL DEFAULT 'withheld',    -- withheld | for_sale | closed
  withheld_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on          DATE,
  notes              TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sacco_share_withholdings_disposed_chk
    CHECK (released_shares + sold_shares <= shares),
  CONSTRAINT sacco_share_withholdings_status_chk
    CHECK (status IN ('withheld', 'for_sale', 'closed')),
  CONSTRAINT sacco_share_withholdings_reason_chk
    CHECK (reason_type IN ('loan_security', 'loan_default', 'exit', 'deceased',
                           'disciplinary', 'court_order', 'dispute', 'unpaid_dues', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_share_withholding_ref
  ON public.sacco_share_withholdings(sacco_id, ref_no);
CREATE INDEX IF NOT EXISTS idx_sacco_share_withholdings_admin
  ON public.sacco_share_withholdings(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_withholdings_member
  ON public.sacco_share_withholdings(member_id, status);
-- The "what is withheld right now" query the dashboard runs on every load.
CREATE INDEX IF NOT EXISTS idx_sacco_share_withholdings_live
  ON public.sacco_share_withholdings(sacco_id, status)
  WHERE status <> 'closed';

COMMENT ON TABLE public.sacco_share_withholdings IS
  'Shares the society has held back from a member (loan security, exit, court order, discipline) '
  'and the disposition of each: released back to the member, or sold on the internal market.';

-- ----------------------------------------------------------------------------
-- 3. THE HISTORY
--    Append-only. Every movement on a withholding lands here with the balance
--    it left behind, so the register can always be re-read as a statement.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_share_withholding_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID,
  sacco_id          UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  withholding_id    UUID NOT NULL REFERENCES public.sacco_share_withholdings(id) ON DELETE CASCADE,
  member_id         UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,       -- withheld | listed | unlisted | sold | released | reversed
  shares            INTEGER NOT NULL DEFAULT 0,
  outstanding_after INTEGER NOT NULL DEFAULT 0,
  price_per_share   DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount            DECIMAL(18,2) NOT NULL DEFAULT 0,
  listing_id        UUID,
  transfer_id       UUID,
  reason            TEXT,
  actor_id          UUID,
  actor_name        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sacco_share_withholding_events_type_chk
    CHECK (event_type IN ('withheld', 'listed', 'unlisted', 'sold', 'released', 'reversed'))
);

CREATE INDEX IF NOT EXISTS idx_sacco_share_wh_events_admin
  ON public.sacco_share_withholding_events(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_wh_events_wh
  ON public.sacco_share_withholding_events(withholding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_share_wh_events_sacco
  ON public.sacco_share_withholding_events(sacco_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_share_wh_events_member
  ON public.sacco_share_withholding_events(member_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. LISTINGS LINK
--    A withheld-share sale is an ordinary sell order carrying the id of the
--    withholding it discharges, so it matches, settles, posts to the books and
--    reissues certificates through the existing engine untouched.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_share_listings
  ADD COLUMN IF NOT EXISTS withholding_id UUID
    REFERENCES public.sacco_share_withholdings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sacco_share_listings_withholding
  ON public.sacco_share_listings(withholding_id)
  WHERE withholding_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. INTERNALS
-- ----------------------------------------------------------------------------

-- Recompute a member's withheld counter and each withholding's status from the
-- register. Everything that moves a withholding ends by calling this, so the
-- counter is derived rather than incremented — an interrupted operation cannot
-- leave a member's shares stuck out of circulation.
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_sync(
  p_sacco_id  uuid,
  p_member_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_withheld integer;
BEGIN
  IF p_sacco_id IS NULL OR p_member_id IS NULL THEN RETURN 0; END IF;

  -- A withholding is closed once nothing is outstanding; it reads as "for sale"
  -- while any part of it sits on the order book.
  UPDATE public.sacco_share_withholdings w
     SET status = CASE
                    WHEN w.outstanding_shares <= 0 THEN 'closed'
                    WHEN w.listed_shares > 0       THEN 'for_sale'
                    ELSE 'withheld'
                  END,
         closed_on = CASE WHEN w.outstanding_shares <= 0
                          THEN COALESCE(w.closed_on, CURRENT_DATE) END,
         updated_at = now()
   WHERE w.sacco_id = p_sacco_id AND w.member_id = p_member_id;

  -- Withheld = still outstanding, minus whatever is currently on the market
  -- (those shares are escrowed in locked_shares instead).
  SELECT COALESCE(SUM(GREATEST(w.outstanding_shares - w.listed_shares, 0)), 0)::integer
    INTO v_withheld
    FROM public.sacco_share_withholdings w
   WHERE w.sacco_id = p_sacco_id AND w.member_id = p_member_id AND w.status <> 'closed';

  UPDATE public.sacco_shares
     SET withheld_shares = v_withheld, updated_at = now()
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id
     AND withheld_shares IS DISTINCT FROM v_withheld;

  RETURN v_withheld;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withholding_sync(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Append one row to the withholding history.
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_event(
  p_withholding_id uuid,
  p_type           text,
  p_shares         integer,
  p_price          numeric DEFAULT 0,
  p_listing_id     uuid    DEFAULT NULL,
  p_transfer_id    uuid    DEFAULT NULL,
  p_reason         text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w      public.sacco_share_withholdings%ROWTYPE;
  v_id   uuid;
  v_name text;
BEGIN
  SELECT * INTO w FROM public.sacco_share_withholdings WHERE id = p_withholding_id;
  IF w.id IS NULL THEN RETURN NULL; END IF;

  SELECT up.full_name INTO v_name FROM public.user_profiles up WHERE up.id = auth.uid();

  INSERT INTO public.sacco_share_withholding_events
    (admin_id, sacco_id, withholding_id, member_id, event_type, shares,
     outstanding_after, price_per_share, amount, listing_id, transfer_id,
     reason, actor_id, actor_name)
  VALUES
    (w.admin_id, w.sacco_id, w.id, w.member_id, p_type, abs(COALESCE(p_shares, 0)),
     w.outstanding_shares, round(COALESCE(p_price, 0), 2),
     round(abs(COALESCE(p_shares, 0)) * COALESCE(p_price, 0), 2),
     p_listing_id, p_transfer_id, NULLIF(trim(COALESCE(p_reason, '')), ''),
     auth.uid(), COALESCE(v_name, 'System'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withholding_event(uuid, text, integer, numeric, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- The value the society puts on a share today: the published market value if
-- there is one, otherwise par. Same precedence the register and reports use.
CREATE OR REPLACE FUNCTION public.sacco_share_unit_value(p_sacco_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_mv numeric; v_par numeric;
BEGIN
  SELECT sp.market_value INTO v_mv FROM public.sacco_share_prices sp
   WHERE sp.sacco_id = p_sacco_id ORDER BY sp.effective_date DESC LIMIT 1;
  SELECT s.par_value INTO v_par FROM public.sacco_share_settings s WHERE s.sacco_id = p_sacco_id;
  IF COALESCE(v_par, 0) = 0 THEN
    SELECT t.par_value INTO v_par FROM public.sacco_share_treasury t WHERE t.sacco_id = p_sacco_id;
  END IF;
  RETURN COALESCE(NULLIF(v_mv, 0), NULLIF(v_par, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_unit_value(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_unit_value(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. GUARD — withheld shares cannot be listed, transferred or edited away
--
-- Fires only when an update TIGHTENS the position: escrow going up (placing or
-- growing a sell order, escrowing into a buy order) or the holding going down
-- (a direct transfer, a manual correction). Release paths — settlement, cancel,
-- expiry, unfreeze, and this module's own sync — all loosen it, so they pass
-- straight through and a withholding can always be unwound.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_shares_withholding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_free   integer;
  v_detail text;
BEGIN
  IF COALESCE(NEW.withheld_shares, 0) = 0 THEN RETURN NEW; END IF;

  IF NOT (COALESCE(NEW.locked_shares, 0) > COALESCE(OLD.locked_shares, 0)
          OR COALESCE(NEW.shares_held, 0) < COALESCE(OLD.shares_held, 0)) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.locked_shares, 0) + NEW.withheld_shares <= COALESCE(NEW.shares_held, 0) THEN
    RETURN NEW;
  END IF;

  v_free := GREATEST(COALESCE(NEW.shares_held, 0)
                     - COALESCE(OLD.locked_shares, 0) - NEW.withheld_shares, 0);

  SELECT string_agg(w.ref_no || ' — ' || replace(w.reason_type, '_', ' '), ', ' ORDER BY w.ref_no)
    INTO v_detail
    FROM public.sacco_share_withholdings w
   WHERE w.sacco_id = NEW.sacco_id AND w.member_id = NEW.member_id AND w.status <> 'closed';

  RAISE EXCEPTION 'Only % of this member''s % shares are free — % are withheld by the society (%)',
    v_free, COALESCE(NEW.shares_held, 0), NEW.withheld_shares, COALESCE(v_detail, 'see the withholding register');
END;
$$;

DROP TRIGGER IF EXISTS sacco_shares_withholding_guard ON public.sacco_shares;
CREATE TRIGGER sacco_shares_withholding_guard
  BEFORE UPDATE ON public.sacco_shares
  FOR EACH ROW EXECUTE FUNCTION public.sacco_shares_withholding_guard();

-- ----------------------------------------------------------------------------
-- 7. A withholding's sale order coming off the book
--
-- Cancelled or expired, the unfilled remainder goes back under withholding — it
-- must never fall free just because the sale did not happen. Covers
-- sacco_share_cancel_order, sacco_share_expire_orders and the bulk cancel
-- inside sacco_share_freeze_member, all of which release the escrow themselves.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_unlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_out integer;
BEGIN
  IF NEW.withholding_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- 'settled' is in the list because sacco_share_cancel_order marks a
  -- PART-FILLED order settled rather than cancelled while still releasing the
  -- unsold escrow — leaving it out would let that remainder fall free. The
  -- unfilled count below is what separates the two: a genuine full fill leaves
  -- nothing over and returns here immediately.
  IF NEW.status::text NOT IN ('cancelled', 'expired', 'settled') THEN RETURN NEW; END IF;

  v_out := GREATEST(COALESCE(NEW.shares, 0) - COALESCE(NEW.filled_shares, 0), 0);
  IF v_out = 0 THEN RETURN NEW; END IF;

  UPDATE public.sacco_share_withholdings
     SET listed_shares = GREATEST(listed_shares - v_out, 0), updated_at = now()
   WHERE id = NEW.withholding_id;

  PERFORM public.sacco_share_withholding_sync(NEW.sacco_id, NEW.seller_member_id);
  PERFORM public.sacco_share_withholding_event(
    NEW.withholding_id, 'unlisted', v_out, NEW.price_per_share, NEW.id, NULL,
    COALESCE(NEW.cancel_reason, 'Sale order ' || NEW.status::text));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_share_withholding_unlist ON public.sacco_share_listings;
CREATE TRIGGER sacco_share_withholding_unlist
  AFTER UPDATE ON public.sacco_share_listings
  FOR EACH ROW EXECUTE FUNCTION public.sacco_share_withholding_unlist();

-- ----------------------------------------------------------------------------
-- 8. A withholding's sale settling (or being reversed)
--
-- Settlement has already moved the shares and released the escrow; all that is
-- left is to discharge that many from the withholding and book the proceeds
-- net of the seller's commission. A reversal puts them back under withholding,
-- because the debt they were securing is live again.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wh    uuid;
  v_qty   integer;
  v_net   numeric;
BEGIN
  IF NEW.status <> 'settled' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_qty := GREATEST(COALESCE(NEW.shares, 0), 0);
  IF v_qty = 0 THEN RETURN NEW; END IF;

  IF NEW.reversed_of IS NOT NULL THEN
    -- The mirror leg of a reversal carries no listing of its own, so the
    -- withholding is resolved through the trade it undoes.
    SELECT l.withholding_id INTO v_wh
      FROM public.sacco_share_transfers t0
      JOIN public.sacco_share_listings l ON l.id = t0.listing_id
     WHERE t0.id = NEW.reversed_of;
    IF v_wh IS NULL THEN RETURN NEW; END IF;

    -- The member has the shares again, so the withholding is restored by the
    -- quantity it was discharged by — the debt it secured is live again.
    UPDATE public.sacco_share_withholdings
       SET sold_shares = GREATEST(sold_shares - v_qty, 0),
           proceeds    = GREATEST(proceeds - round(v_qty * NEW.price_per_share, 2), 0),
           closed_on   = NULL,
           updated_at  = now()
     WHERE id = v_wh;

    PERFORM public.sacco_share_withholding_sync(NEW.sacco_id, NEW.buyer_member_id);
    PERFORM public.sacco_share_withholding_event(
      v_wh, 'reversed', v_qty, NEW.price_per_share, NULL, NEW.id,
      COALESCE(NEW.reason, 'Trade reversed'));
    RETURN NEW;
  END IF;

  IF NEW.listing_id IS NULL THEN RETURN NEW; END IF;
  SELECT l.withholding_id INTO v_wh
    FROM public.sacco_share_listings l WHERE l.id = NEW.listing_id;
  IF v_wh IS NULL THEN RETURN NEW; END IF;

  v_net := GREATEST(round(v_qty * NEW.price_per_share, 2) - COALESCE(NEW.seller_fee, 0), 0);

  UPDATE public.sacco_share_withholdings
     SET sold_shares   = sold_shares + v_qty,
         listed_shares = GREATEST(listed_shares - v_qty, 0),
         proceeds      = proceeds + v_net,
         updated_at    = now()
   WHERE id = v_wh;

  PERFORM public.sacco_share_withholding_sync(NEW.sacco_id, NEW.seller_member_id);
  PERFORM public.sacco_share_withholding_event(
    v_wh, 'sold', v_qty, NEW.price_per_share, NEW.listing_id, NEW.id,
    'Sold on the internal market');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_share_withholding_settle ON public.sacco_share_transfers;
CREATE TRIGGER sacco_share_withholding_settle
  AFTER UPDATE ON public.sacco_share_transfers
  FOR EACH ROW EXECUTE FUNCTION public.sacco_share_withholding_settle();

-- ----------------------------------------------------------------------------
-- 9. RPCs
-- ----------------------------------------------------------------------------

-- Withhold shares from a member's holding.
--
-- A withholding outranks the order book: if the member has the shares but has
-- them out on sell orders, those orders come off the book (newest first, only
-- as many as needed) to make room. That mirrors sacco_share_freeze_member,
-- which also cancels live orders — a court order does not wait for a trade.
CREATE OR REPLACE FUNCTION public.sacco_share_withhold(
  p_member_id   uuid,
  p_shares      integer,
  p_reason_type text,
  p_reason      text DEFAULT NULL,
  p_reference   text DEFAULT NULL,
  p_notes       text DEFAULT NULL
)
RETURNS public.sacco_share_withholdings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco  uuid := public.sacco_active_sacco_id();
  v_admin  uuid;
  h        public.sacco_shares%ROWTYPE;
  m        public.sacco_members%ROWTYPE;
  l        RECORD;
  w        public.sacco_share_withholdings%ROWTYPE;
  v_need   integer;
  v_free   integer;
  v_unit   numeric;
  v_id     uuid;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);

  IF COALESCE(p_shares, 0) <= 0 THEN
    RAISE EXCEPTION 'Withhold at least one share';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Withholding a member''s shares needs a reason';
  END IF;

  SELECT * INTO m FROM public.sacco_members WHERE id = p_member_id AND sacco_id = v_sacco;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;

  SELECT * INTO h FROM public.sacco_share_holding(v_sacco, p_member_id);

  -- Cannot withhold more than the member owns, on top of what is already held.
  IF p_shares > h.shares_held - COALESCE((
       SELECT SUM(w2.outstanding_shares) FROM public.sacco_share_withholdings w2
        WHERE w2.sacco_id = v_sacco AND w2.member_id = p_member_id AND w2.status <> 'closed'), 0)
  THEN
    RAISE EXCEPTION 'This member holds % shares, of which % are already withheld — cannot withhold % more',
      h.shares_held,
      COALESCE((SELECT SUM(w2.outstanding_shares) FROM public.sacco_share_withholdings w2
                 WHERE w2.sacco_id = v_sacco AND w2.member_id = p_member_id AND w2.status <> 'closed'), 0),
      p_shares;
  END IF;

  -- Free up escrow if the member has shares out on the market.
  v_free := h.shares_held - h.locked_shares - h.withheld_shares;
  IF v_free < p_shares THEN
    v_need := p_shares - v_free;
    FOR l IN SELECT * FROM public.sacco_share_listings
              WHERE sacco_id = v_sacco AND seller_member_id = p_member_id
                AND side = 'sell' AND status = 'open' AND withholding_id IS NULL
              ORDER BY created_at DESC LOOP
      EXIT WHEN v_need <= 0;
      PERFORM public.sacco_share_cancel_order(l.id, 'Shares withheld by the society');
      v_need := v_need - GREATEST(l.shares - l.filled_shares, 0);
    END LOOP;

    -- Escrow can also sit behind a part-filled buy order the member sold into,
    -- which has no sell listing to cancel. Rather than corrupt the counters,
    -- say plainly what is in the way.
    SELECT * INTO h FROM public.sacco_share_holding(v_sacco, p_member_id);
    IF h.shares_held - h.locked_shares - h.withheld_shares < p_shares THEN
      RAISE EXCEPTION 'Only % shares are free to withhold — % of this member''s % are committed to trades already in flight',
        GREATEST(h.shares_held - h.locked_shares - h.withheld_shares, 0),
        h.locked_shares, h.shares_held;
    END IF;
  END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;
  v_unit := public.sacco_share_unit_value(v_sacco);

  INSERT INTO public.sacco_share_withholdings
    (admin_id, sacco_id, member_id, ref_no, shares, reason_type, reason,
     reference, unit_value, notes, created_by)
  VALUES
    (v_admin, v_sacco, p_member_id,
     'WH-' || lpad(nextval('public.sacco_share_withholding_seq')::text, 6, '0'),
     p_shares, COALESCE(NULLIF(trim(p_reason_type), ''), 'other'), trim(p_reason),
     NULLIF(trim(COALESCE(p_reference, '')), ''), COALESCE(v_unit, 0),
     NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid())
  RETURNING * INTO w;
  v_id := w.id;

  PERFORM public.sacco_share_withholding_sync(v_sacco, p_member_id);
  PERFORM public.sacco_share_withholding_event(v_id, 'withheld', p_shares, v_unit, NULL, NULL, trim(p_reason));
  PERFORM public.sacco_share_log(v_sacco, 'withholding', v_id, 'withheld', p_member_id,
    NULL, to_jsonb(w), trim(p_reason));

  -- sync() has just set the status, so return the row as it now stands.
  SELECT * INTO w FROM public.sacco_share_withholdings WHERE id = v_id;
  RETURN w;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withhold(uuid, integer, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_withhold(uuid, integer, text, text, text, text)
  TO authenticated;

-- Release withheld shares back to the member — in part or in full.
-- Anything currently on the market has to come off the book first, so the
-- released figure can never exceed what the society is actually still holding.
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_release(
  p_id     uuid,
  p_shares integer DEFAULT NULL,     -- NULL = release everything outstanding
  p_reason text    DEFAULT NULL
)
RETURNS public.sacco_share_withholdings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w      public.sacco_share_withholdings%ROWTYPE;
  v_qty  integer;
  v_old  jsonb;
  v_held integer;
  v_id   uuid;
BEGIN
  SELECT * INTO w FROM public.sacco_share_withholdings WHERE id = p_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Withholding not found'; END IF;
  PERFORM public.sacco_share_require_staff(w.sacco_id);

  IF w.status = 'closed' THEN
    RAISE EXCEPTION 'Withholding % is already closed', w.ref_no;
  END IF;

  v_held := GREATEST(w.outstanding_shares - w.listed_shares, 0);
  v_qty  := LEAST(COALESCE(NULLIF(p_shares, 0), v_held), v_held);

  IF v_qty <= 0 THEN
    IF w.listed_shares > 0 THEN
      RAISE EXCEPTION 'All % outstanding shares on % are on the market — cancel the sale order first',
        w.outstanding_shares, w.ref_no;
    END IF;
    RAISE EXCEPTION 'Nothing left to release on %', w.ref_no;
  END IF;

  v_old := to_jsonb(w);

  v_id := w.id;

  UPDATE public.sacco_share_withholdings
     SET released_shares = released_shares + v_qty, updated_at = now()
   WHERE id = v_id
  RETURNING * INTO w;

  PERFORM public.sacco_share_withholding_sync(w.sacco_id, w.member_id);
  PERFORM public.sacco_share_withholding_event(v_id, 'released', v_qty, w.unit_value, NULL, NULL, p_reason);
  PERFORM public.sacco_share_log(w.sacco_id, 'withholding', v_id, 'released', w.member_id,
    v_old, to_jsonb(w), p_reason);

  SELECT * INTO w FROM public.sacco_share_withholdings WHERE id = v_id;
  RETURN w;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withholding_release(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_withholding_release(uuid, integer, text)
  TO authenticated;

-- Place withheld shares for sale on the society's own market.
--
-- The shares move from withheld_shares into locked_shares — still reserved,
-- now as ordinary order-book escrow — and the listing carries the withholding
-- id so settlement can discharge it. From here the engine handles matching,
-- settlement, cost basis, certificates and the ledger with no special cases.
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_list(
  p_id     uuid,
  p_shares integer DEFAULT NULL,     -- NULL = offer everything still held
  p_price  numeric DEFAULT NULL,     -- NULL = the current unit value
  p_expiry date    DEFAULT NULL
)
RETURNS public.sacco_share_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w       public.sacco_share_withholdings%ROWTYPE;
  s       public.sacco_share_settings%ROWTYPE;
  h       public.sacco_shares%ROWTYPE;
  v_row   public.sacco_share_listings%ROWTYPE;
  v_qty   integer;
  v_price numeric;
  v_held  integer;
BEGIN
  SELECT * INTO w FROM public.sacco_share_withholdings WHERE id = p_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Withholding not found'; END IF;
  PERFORM public.sacco_share_require_staff(w.sacco_id);

  IF w.status = 'closed' THEN
    RAISE EXCEPTION 'Withholding % is closed', w.ref_no;
  END IF;

  SELECT * INTO s FROM public.sacco_share_settings_row(w.sacco_id);
  IF s.trading_suspended THEN
    RAISE EXCEPTION 'Trading is suspended%', COALESCE(' — ' || s.suspension_reason, '');
  END IF;

  v_held := GREATEST(w.outstanding_shares - w.listed_shares, 0);
  v_qty  := LEAST(COALESCE(NULLIF(p_shares, 0), v_held), v_held);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'All % outstanding shares on % are already on the market',
      w.outstanding_shares, w.ref_no;
  END IF;

  v_price := COALESCE(NULLIF(p_price, 0), NULLIF(public.sacco_share_unit_value(w.sacco_id), 0), w.unit_value);
  IF COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION 'Set a price — the society has published neither a market value nor a par value';
  END IF;
  IF s.price_floor_is_par AND v_price < s.par_value THEN
    RAISE EXCEPTION 'Price may not be below par value (%)', s.par_value;
  END IF;

  SELECT * INTO h FROM public.sacco_share_holding(w.sacco_id, w.member_id);
  IF h.shares_held < w.outstanding_shares THEN
    RAISE EXCEPTION 'This member now holds only % shares — % are withheld. Reconcile the register first',
      h.shares_held, w.outstanding_shares;
  END IF;

  -- Reserve as order-book escrow, then release the same count from withheld so
  -- the total reserved against the holding is unchanged. Order matters: the
  -- guard permits escrow rising only while the sum still fits the holding.
  UPDATE public.sacco_share_withholdings
     SET listed_shares = listed_shares + v_qty, updated_at = now()
   WHERE id = w.id;
  PERFORM public.sacco_share_withholding_sync(w.sacco_id, w.member_id);

  UPDATE public.sacco_shares
     SET locked_shares = locked_shares + v_qty, updated_at = now()
   WHERE id = h.id;

  INSERT INTO public.sacco_share_listings
    (admin_id, sacco_id, side, seller_member_id, seller_is_treasury,
     shares, price_per_share, status, expiry_date, created_by, withholding_id)
  VALUES
    (w.admin_id, w.sacco_id, 'sell', w.member_id, false,
     v_qty, round(v_price, 2), 'open', p_expiry, auth.uid(), w.id)
  RETURNING * INTO v_row;

  PERFORM public.sacco_share_withholding_event(w.id, 'listed', v_qty, v_price, v_row.id, NULL,
    'Placed for sale on the internal market');
  PERFORM public.sacco_share_log(w.sacco_id, 'listing', v_row.id, 'withholding_listed',
    w.member_id, NULL, to_jsonb(v_row), 'Withheld shares placed for sale (' || w.ref_no || ')');

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withholding_list(uuid, integer, numeric, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_withholding_list(uuid, integer, numeric, date)
  TO authenticated;

-- The society's withholding position right now: how many shares are held back,
-- what they are worth today, and what has become of the rest. One query so the
-- stat card, the report and the register can never disagree.
CREATE OR REPLACE FUNCTION public.sacco_share_withholding_summary()
RETURNS TABLE (
  unit_value        numeric,
  withheld_shares   integer,   -- outstanding, not yet on the market
  listed_shares     integer,   -- outstanding and currently for sale
  outstanding_shares integer,  -- the two above, together
  withheld_value    numeric,   -- outstanding valued at today's unit value
  book_value        numeric,   -- outstanding valued at the day each was withheld
  members_affected  integer,
  live_count        integer,
  released_shares   integer,   -- lifetime
  sold_shares       integer,   -- lifetime
  proceeds          numeric,   -- lifetime, net of commission
  ownership_pct     numeric    -- outstanding as a share of everything in issue
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  v_unit  numeric;
  v_total bigint;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);

  v_unit := public.sacco_share_unit_value(v_sacco);

  SELECT COALESCE(SUM(sh.shares_held), 0)
         + COALESCE((SELECT t.treasury_shares FROM public.sacco_share_treasury t
                      WHERE t.sacco_id = v_sacco), 0)
    INTO v_total
    FROM public.sacco_shares sh WHERE sh.sacco_id = v_sacco;

  RETURN QUERY
  SELECT
    COALESCE(v_unit, 0),
    -- GREATEST per row, not on the total: one record with a stale listed_shares
    -- must not net off against another record's genuinely held shares.
    COALESCE(SUM(GREATEST(w.outstanding_shares - w.listed_shares, 0))
             FILTER (WHERE w.status <> 'closed'), 0)::integer,
    COALESCE(SUM(w.listed_shares) FILTER (WHERE w.status <> 'closed'), 0)::integer,
    COALESCE(SUM(w.outstanding_shares) FILTER (WHERE w.status <> 'closed'), 0)::integer,
    round(COALESCE(SUM(w.outstanding_shares) FILTER (WHERE w.status <> 'closed'), 0)
          * COALESCE(v_unit, 0), 2),
    round(COALESCE(SUM(w.outstanding_shares * w.unit_value)
                   FILTER (WHERE w.status <> 'closed'), 0), 2),
    COALESCE(COUNT(DISTINCT w.member_id) FILTER (WHERE w.status <> 'closed'), 0)::integer,
    COALESCE(COUNT(*) FILTER (WHERE w.status <> 'closed'), 0)::integer,
    COALESCE(SUM(w.released_shares), 0)::integer,
    COALESCE(SUM(w.sold_shares), 0)::integer,
    round(COALESCE(SUM(w.proceeds), 0), 2),
    CASE WHEN COALESCE(v_total, 0) > 0
         THEN round(COALESCE(SUM(w.outstanding_shares) FILTER (WHERE w.status <> 'closed'), 0)::numeric
                    * 100 / v_total, 3)
         ELSE 0 END
  FROM public.sacco_share_withholdings w
  WHERE w.sacco_id = v_sacco;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_withholding_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_withholding_summary() TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RLS, TRIGGERS, GRANTS, REALTIME
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['sacco_share_withholdings', 'sacco_share_withholding_events'];
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

    -- A member is entitled to see their own shares being held back, and why.
    EXECUTE format('DROP POLICY IF EXISTS "member_read_own_%1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "member_read_own_%1$s" ON public.%1$s
         FOR SELECT TO authenticated
         USING (member_id = public.current_sacco_member_id());', t);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['sacco_share_withholdings', 'sacco_share_withholding_events'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
             WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- The reference sequence is deliberately NOT reset here: CREATE SEQUENCE IF NOT
-- EXISTS keeps its position, and re-running this file must never hand out a
-- WH- number that has already been issued.
