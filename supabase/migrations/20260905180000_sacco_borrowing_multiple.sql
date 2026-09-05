-- ============================================================================
-- SACCO BORROWING MULTIPLE — how much a member may borrow against their shares
-- ============================================================================
-- Every sacco has the same rule and a different number for it: you may borrow
-- up to N times what you hold. Three times shares is the common one; some
-- societies lend two, some five, some count deposits alongside shares. Until
-- now this app had nowhere to put that number, so the ceiling lived in the
-- loans officer's head and a member applying in the portal had no way to know
-- what they were entitled to before they asked.
--
-- This migration gives the society the number, and gives the member the answer.
--
-- WHERE THE RULE LIVES
--   Server-side, and only server-side. Members insert their own applications
--   straight into sacco_loans under the member_apply_loan RLS policy (see
--   20260708130000), so a check in the browser is a suggestion, not a limit —
--   anything holding a session token can post a row past it. The ceiling is
--   therefore enforced by a BEFORE INSERT trigger, and the member portal shows
--   the member the same figures the trigger will use. One rule, computed once,
--   in sacco_member_borrowing_capacity().
--
-- WHOSE INSERTS IT GOVERNS
--   The member's own applications. A loans officer booking a loan from the
--   sacco dashboard is the society exercising its own discretion — committees
--   lend over the multiple on security, on guarantors, on a board resolution —
--   and blocking staff would make legacy and restructured loans unbookable.
--   The trigger tests that the inserting user IS the member the loan is for,
--   which is exactly the member-portal path and nothing else.
--
-- OFF BY DEFAULT, AND DELIBERATELY SO
--   enforce_borrowing_limit defaults to FALSE. A society that has never
--   maintained a share register has every member sitting at shares_held = 0;
--   switching a live ceiling on for them at deploy time would refuse every
--   loan application in the portal, with no warning and no way for a member to
--   understand why. So the figures appear first, the society sets its multiple,
--   and enforcement is a separate decision it makes when the register is ready.
--   The number is configured on the Loans tab of the sacco dashboard.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE POLICY
--    One row per sacco, defaults on first touch, same shape as the guarantee
--    policy next door (20260904160000) so the two screens read alike.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_borrowing_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                UUID,
  sacco_id                UUID UNIQUE NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,

  -- The gate. Off shows the member their entitlement and refuses nothing; on
  -- turns the same figure into a hard ceiling on their own applications.
  enforce_borrowing_limit BOOLEAN      NOT NULL DEFAULT false,
  -- The multiple itself: max eligible = shares (plus deposits, if counted) x this.
  borrowing_multiple      DECIMAL(6,2) NOT NULL DEFAULT 3.00,
  -- Whether savings count towards the basis, or shares alone do. Off is the
  -- plain reading of "shares x multiple"; societies that lend against deposits
  -- turn it on.
  count_deposits          BOOLEAN      NOT NULL DEFAULT false,
  -- Whether what a member already owes eats into the ceiling. On is the honest
  -- answer to "how much more may I borrow"; off treats the multiple as a
  -- per-loan size limit instead.
  net_off_existing_loans  BOOLEAN      NOT NULL DEFAULT true,

  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT sacco_borrowing_settings_multiple_chk CHECK (borrowing_multiple > 0)
);

CREATE INDEX IF NOT EXISTS idx_sacco_borrowing_settings_admin
  ON public.sacco_borrowing_settings(admin_id);

COMMENT ON TABLE public.sacco_borrowing_settings IS
  'Per-sacco borrowing policy: the multiple of a member''s shares (and optionally '
  'deposits) they may borrow. Read by sacco_member_borrowing_capacity().';
COMMENT ON COLUMN public.sacco_borrowing_settings.borrowing_multiple IS
  'Max eligible loan = security x this. 3.00 means "three times your shares".';

-- Defaults on first touch, so the save RPC can assume a row exists. Readers
-- must NOT use this — it writes. They read the table with COALESCE defaults,
-- which is why the figures are already right for a society that has never
-- opened the policy screen.
CREATE OR REPLACE FUNCTION public.sacco_borrowing_settings_row(p_sacco_id uuid)
RETURNS public.sacco_borrowing_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r public.sacco_borrowing_settings%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.sacco_borrowing_settings WHERE sacco_id = p_sacco_id;
  IF r.id IS NULL THEN
    INSERT INTO public.sacco_borrowing_settings (admin_id, sacco_id)
    VALUES ((SELECT admin_id FROM public.saccos WHERE id = p_sacco_id), p_sacco_id)
    ON CONFLICT (sacco_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO r;
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_borrowing_settings_row(uuid) FROM PUBLIC, anon, authenticated;

-- Staff edit the policy through here, one column at a time out of the patch,
-- so a stray key in the payload can never write a column this function does
-- not own.
CREATE OR REPLACE FUNCTION public.sacco_borrowing_save_settings(p_patch jsonb)
RETURNS public.sacco_borrowing_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  r       public.sacco_borrowing_settings%ROWTYPE;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  r := public.sacco_borrowing_settings_row(v_sacco);

  UPDATE public.sacco_borrowing_settings SET
    enforce_borrowing_limit = COALESCE((p_patch->>'enforce_borrowing_limit')::boolean, enforce_borrowing_limit),
    borrowing_multiple      = COALESCE((p_patch->>'borrowing_multiple')::numeric,      borrowing_multiple),
    count_deposits          = COALESCE((p_patch->>'count_deposits')::boolean,          count_deposits),
    net_off_existing_loans  = COALESCE((p_patch->>'net_off_existing_loans')::boolean,  net_off_existing_loans),
    updated_at              = now()
  WHERE id = r.id
  RETURNING * INTO r;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_borrowing_save_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_borrowing_save_settings(jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE MEMBER'S POSITION AGAINST THAT POLICY
--
--    What they hold, what that entitles them to, what they have already used,
--    and what is left. The apply screen prints these; the trigger judges by
--    them. Neither computes anything of its own.
--
--    Reads the policy with COALESCE defaults rather than through
--    sacco_borrowing_settings_row() — that one writes, and this must stay
--    STABLE so the trigger can call it.
--
--    SECURITY DEFINER, so it is guarded: a member may ask about themselves,
--    anybody else must be staff of the sacco. Without that guard an
--    authenticated member could read every other member's savings and
--    shareholding by id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_member_borrowing_capacity(
  p_sacco_id  uuid,
  p_member_id uuid
)
RETURNS TABLE (
  shares_held       integer,
  share_price       numeric,
  share_value       numeric,
  deposits          numeric,
  security          numeric,
  multiple          numeric,
  ceiling           numeric,
  existing_exposure numeric,
  available         numeric,
  limit_enforced    boolean,
  counts_deposits   boolean,
  nets_off_loans    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_member_id IS DISTINCT FROM public.current_sacco_member_id() THEN
    PERFORM public.sacco_share_require_staff(p_sacco_id);
  END IF;

  RETURN QUERY
  WITH policy AS (
    SELECT
      COALESCE(bs.enforce_borrowing_limit, false) AS p_enforce,
      COALESCE(bs.borrowing_multiple,      3.00)  AS p_multiple,
      COALESCE(bs.count_deposits,          false) AS p_counts_deposits,
      COALESCE(bs.net_off_existing_loans,  true)  AS p_nets_off
    FROM (SELECT 1) z
    LEFT JOIN public.sacco_borrowing_settings bs ON bs.sacco_id = p_sacco_id
  ),
  -- The share register, valued the way the guarantee cap values it: at the
  -- society's latest quoted price, falling back to the holding's own par
  -- value. Two screens quoting a member different numbers for the same shares
  -- is worse than either number being wrong.
  holding AS (
    SELECT
      COALESCE((SELECT sh.shares_held FROM public.sacco_shares sh
                 WHERE sh.member_id = p_member_id AND sh.sacco_id = p_sacco_id
                 LIMIT 1), 0)::integer AS h_shares,
      COALESCE(
        (SELECT sp.market_value FROM public.sacco_share_prices sp
          WHERE sp.sacco_id = p_sacco_id
          ORDER BY sp.effective_date DESC LIMIT 1),
        (SELECT sh.par_value FROM public.sacco_shares sh
          WHERE sh.member_id = p_member_id AND sh.sacco_id = p_sacco_id
          LIMIT 1),
        0)::numeric AS h_price
  ),
  -- Savings, excluding share capital: those contributions bought the shares
  -- already counted above, and a basis that counted both would lend twice on
  -- the same money.
  savings AS (
    SELECT COALESCE((
      SELECT SUM(c.amount) FROM public.sacco_contributions c
       WHERE c.member_id = p_member_id
         AND c.status IN ('completed', 'paid')
         AND COALESCE(c.account, 'deposits') <> 'share_capital'
    ), 0)::numeric AS s_deposits
  ),
  -- What the member has already drawn against the ceiling. A live application
  -- counts at its full principal — otherwise five applications at the limit
  -- all pass and the society finds out at approval. A running loan counts at
  -- the principal still outstanding on its schedule, because the ceiling is a
  -- principal ceiling; a loan approved but not yet scheduled falls back to its
  -- full principal.
  exposure AS (
    SELECT COALESCE((
      SELECT SUM(
        CASE WHEN l.status IN ('pending', 'approved') THEN l.principal
             ELSE COALESCE((
               SELECT SUM(sc.principal) FROM public.sacco_loan_schedule sc
                WHERE sc.loan_id = l.id AND COALESCE(sc.paid, false) = false
             ), l.principal)
        END)
      FROM public.sacco_loans l
      WHERE l.member_id = p_member_id
        AND l.sacco_id  = p_sacco_id
        AND l.status IN ('pending', 'approved', 'active')
    ), 0)::numeric AS e_used
  ),
  joined AS (
    SELECT
      holding.*, savings.*, exposure.*, policy.*,
      ROUND(holding.h_shares * holding.h_price, 2) AS j_share_value
    FROM holding, savings, exposure, policy
  ),
  based AS (
    SELECT
      joined.*,
      (joined.j_share_value
       + CASE WHEN joined.p_counts_deposits THEN joined.s_deposits ELSE 0 END) AS j_security
    FROM joined
  ),
  capped AS (
    SELECT based.*, ROUND(based.j_security * based.p_multiple, 2) AS j_ceiling
    FROM based
  )
  SELECT
    capped.h_shares,
    capped.h_price,
    capped.j_share_value,
    capped.s_deposits,
    capped.j_security,
    capped.p_multiple,
    capped.j_ceiling,
    capped.e_used,
    GREATEST(capped.j_ceiling - CASE WHEN capped.p_nets_off THEN capped.e_used ELSE 0 END, 0),
    capped.p_enforce,
    capped.p_counts_deposits,
    capped.p_nets_off
  FROM capped;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_member_borrowing_capacity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_member_borrowing_capacity(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.sacco_member_borrowing_capacity(uuid, uuid) IS
  'One member''s borrowing entitlement: shares, security, ceiling, what is already '
  'drawn, and what is left. The apply screen shows it; the insert trigger enforces it.';

-- ----------------------------------------------------------------------------
-- 3. THE GATE
--
--    Returns NULL when this member may borrow this much, or the sentence
--    explaining why not — a sentence rather than an exception, so the apply
--    screen can show the refusal before the member fills the form in, and the
--    trigger can raise the very same words when they submit anyway. Stated
--    once, enforced everywhere.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_member_borrowing_block(
  p_sacco_id  uuid,
  p_member_id uuid,
  p_principal numeric
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.sacco_member_borrowing_capacity(p_sacco_id, p_member_id);

  IF NOT FOUND OR NOT c.limit_enforced THEN
    RETURN NULL;
  END IF;

  -- A member with nothing on the register has no entitlement to compute, and
  -- "you may borrow 0" is a confusing way to say "you have no shares yet".
  IF c.security <= 0 THEN
    RETURN format(
      'You have no %s on record yet, so no borrowing limit can be worked out. '
      || 'Speak to your sacco before applying.',
      CASE WHEN c.counts_deposits THEN 'shares or savings' ELSE 'shares' END);
  END IF;

  IF COALESCE(p_principal, 0) > c.available THEN
    RETURN format(
      'This society lends up to %s times a member''s %s. Yours are worth %s, '
      || 'which entitles you to %s%s. You applied for %s.',
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM to_char(c.multiple, 'FM999990.00'))),
      CASE WHEN c.counts_deposits THEN 'shares and savings' ELSE 'shares' END,
      to_char(c.security, 'FM999,999,999,990.00'),
      to_char(c.ceiling,  'FM999,999,999,990.00'),
      CASE WHEN c.nets_off_loans AND c.existing_exposure > 0
           THEN format(', of which %s is already committed to loans — leaving %s',
                       to_char(c.existing_exposure, 'FM999,999,999,990.00'),
                       to_char(c.available,         'FM999,999,999,990.00'))
           ELSE '' END,
      to_char(COALESCE(p_principal, 0), 'FM999,999,999,990.00'));
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_member_borrowing_block(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_member_borrowing_block(uuid, uuid, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. ENFORCEMENT
--
--    On the member's own applications only — see the header. Staff-booked
--    loans pass straight through, because the committee is allowed to lend
--    against a board resolution and because refusing them would make legacy
--    and restructured loans unbookable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_enforce_borrowing_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := public.current_sacco_member_id();
  v_block text;
BEGIN
  -- Not a member applying for themselves: the society is booking this loan.
  IF v_me IS NULL OR NEW.member_id IS DISTINCT FROM v_me THEN
    RETURN NEW;
  END IF;

  v_block := public.sacco_member_borrowing_block(NEW.sacco_id, NEW.member_id, NEW.principal);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_loan_borrowing_limit ON public.sacco_loans;
CREATE TRIGGER trg_sacco_loan_borrowing_limit
  BEFORE INSERT ON public.sacco_loans
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_enforce_borrowing_limit();

COMMENT ON FUNCTION public.sacco_loan_enforce_borrowing_limit() IS
  'Refuses a member''s own loan application above their borrowing multiple. '
  'Staff-booked loans are not affected.';

-- ----------------------------------------------------------------------------
-- 5. RLS
--    Staff of the tenant manage the policy. A member may read the rule they
--    are held to — the apply screen already gets the arithmetic from the
--    capacity RPC, but a member is entitled to see the number itself.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_borrowing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_manage_sacco_borrowing_settings" ON public.sacco_borrowing_settings;
CREATE POLICY "tenant_manage_sacco_borrowing_settings" ON public.sacco_borrowing_settings
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

DROP POLICY IF EXISTS "member_read_sacco_borrowing_settings" ON public.sacco_borrowing_settings;
CREATE POLICY "member_read_sacco_borrowing_settings" ON public.sacco_borrowing_settings
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- ----------------------------------------------------------------------------
-- 6. BACKFILL admin_id
--    Same drift guard the rest of the sacco schema carries: a settings row
--    whose admin_id never got written is invisible to its own tenant.
-- ----------------------------------------------------------------------------
UPDATE public.sacco_borrowing_settings bs
   SET admin_id = s.admin_id
  FROM public.saccos s
 WHERE s.id = bs.sacco_id
   AND bs.admin_id IS DISTINCT FROM s.admin_id;
