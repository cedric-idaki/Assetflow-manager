-- ============================================================================
-- Remove the KYC gate from SACCO share trading
--
-- Buying (or selling) shares no longer requires the member's KYC to have been
-- verified by the society. The `require_kyc_to_trade` switch and every check
-- that read it are removed:
--   * sacco_share_place_order   — no KYC check when a member places an order
--   * sacco_share_execute_order — no KYC check on the buying member at fill
--   * sacco_share_save_settings — the switch is no longer a writable setting
--   * sacco_share_alerts        — drops the "holds shares but KYC is pending"
--                                 compliance alert, which only fired when the
--                                 gate was on
--   * sacco_share_settings.require_kyc_to_trade — column dropped
--
-- Membership status, frozen holdings, market hours, lock-in, ownership
-- ceilings and the trading-suspension switch are all untouched. Member KYC
-- records themselves are untouched — they are simply no longer a precondition
-- for trading.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Placing an order no longer checks KYC
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 2. Filling an order no longer checks the buyer's KYC
-- ----------------------------------------------------------------------------

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

  -- Compliance on the buying member: active membership, ownership ceiling.
  IF v_buyer IS NOT NULL THEN
    SELECT * INTO v_member_row FROM public.sacco_members WHERE id = v_buyer;
    IF v_member_row.id IS NULL THEN RAISE EXCEPTION 'Buyer not found'; END IF;
    IF v_member_row.status <> 'active' THEN
      RAISE EXCEPTION 'That membership is % — trading is not available', v_member_row.status;
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

-- ----------------------------------------------------------------------------
-- 3. The KYC switch is no longer a saveable setting
-- ----------------------------------------------------------------------------

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
    'market_close_time','market_days','large_trade_threshold',
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
-- 4. Compliance alerts no longer flag unverified shareholders
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
     AND sh.shares_held >= s.max_holding_shares * 0.9;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_share_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_share_alerts(integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Drop the switch itself, now that nothing reads it
-- ----------------------------------------------------------------------------

ALTER TABLE public.sacco_share_settings DROP COLUMN IF EXISTS require_kyc_to_trade;
