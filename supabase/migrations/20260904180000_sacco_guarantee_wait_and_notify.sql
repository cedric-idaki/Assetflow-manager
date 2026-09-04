-- ============================================================================
-- SACCO GUARANTEES — the third answer, and telling people it happened
-- ============================================================================
-- Two gaps in 20260904160000_sacco_loan_guarantees, both about the moment a
-- member is asked to stand behind somebody else's debt:
--
--   1. There were only two answers. A guarantor could confirm or decline, and
--      most people asked to guarantee a loan can honestly do neither on the
--      day. "Not yet — ask me after payday" is the commonest real answer, and
--      with nowhere to put it the request just sat at 'requested' looking
--      identical to one the member had never opened. The borrower could not
--      tell "hasn't seen it" from "has seen it and is thinking".
--
--   2. Nobody was told anything. The guarantee register had no notification of
--      any kind: no bell entry, no email. A member found out they had been
--      nominated only if they happened to open the Guarantees tab and notice
--      the badge. A request nobody hears about is not a request.
--
-- WHY 'wait' IS NOT A STATUS
--   The obvious move is a sixth value in sacco_loan_guarantees_status_chk. It
--   is the wrong one. 'wait' is not a state the agreement is in — the request
--   is still open, still counts against the loan's cover, still blocks a
--   second ask to the same member, and can still be reviewed, confirmed or
--   declined. Everything true of 'requested' stays true. Making it a status
--   would mean adding it to the live-status list in FIVE places
--   (_request twice, _review, _decline, _cancel and the loan-status sweep),
--   which is five copies to keep in step for a flag that changes no rule.
--
--   So Wait is recorded ON the open request: when they asked for time, and
--   what they said. The status machine is untouched.
--
-- WHY THE BELL IS A TRIGGER
--   Notifying from inside each RPC would mean re-declaring four long functions
--   this migration otherwise leaves alone. A trigger sees every write to the
--   register whatever produced it, and cannot be forgotten by a future RPC.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BELL VOCABULARY
--    The Header bell renders audit_logs and titles each entry from `action`,
--    so a nomination arriving as 'create' would announce itself as "Create".
--    These two read as "Guarantor Request" and "Guarantor Response".
--
--    ADD VALUE is transaction-safe on PG12+ provided the new value is not USED
--    in the same transaction. It is not: the only uses are inside the function
--    bodies below, which are parsed now and executed long after this commits.
-- ----------------------------------------------------------------------------
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'guarantor_request';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'guarantor_response';

-- ----------------------------------------------------------------------------
-- 2. THE DEFERRAL
--    Two columns on the open request. waited_at is the answer; wait_note is
--    the only part of it worth anything to the borrower.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_loan_guarantees
  ADD COLUMN IF NOT EXISTS waited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wait_note TEXT;

COMMENT ON COLUMN public.sacco_loan_guarantees.waited_at IS
  'When the guarantor last answered "not yet". The request stays open and fully live — this only records that they have seen it and asked for time.';
COMMENT ON COLUMN public.sacco_loan_guarantees.wait_note IS
  'The guarantor''s own words on why they need more time. Optional, and the only thing that makes a deferral more useful to the borrower than silence.';

-- ----------------------------------------------------------------------------
-- 3. WAIT — the third answer
--    Available for as long as the request is open, and repeatable: a member
--    who needs another week after the first week may say so again. It is not
--    available once the guarantee binds, is refused, or is withdrawn — there
--    is nothing left to wait for.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_wait(
  p_guarantee_id uuid,
  p_note         text DEFAULT NULL
)
RETURNS public.sacco_loan_guarantees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.current_sacco_member_id();
  g    public.sacco_loan_guarantees%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees
   WHERE id = p_guarantee_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found'; END IF;
  IF v_me IS NULL OR g.guarantor_member_id <> v_me THEN
    RAISE EXCEPTION 'Only the nominated guarantor can answer this request';
  END IF;
  IF g.status = 'accepted' THEN
    RAISE EXCEPTION 'You have already confirmed this guarantee — there is nothing left to decide';
  END IF;
  IF g.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'This request is already %', g.status;
  END IF;

  -- status is deliberately untouched: the request is still open, and a member
  -- who had already reviewed the terms keeps that review.
  UPDATE public.sacco_loan_guarantees
     SET waited_at  = now(),
         wait_note  = NULLIF(trim(COALESCE(p_note, '')), ''),
         updated_at = now()
   WHERE id = p_guarantee_id
  RETURNING * INTO g;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'deferred', NULL,
    COALESCE(g.wait_note, 'Asked for more time'));
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_wait(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_wait(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.sacco_loan_guarantee_wait(uuid, text) IS
  'The guarantor''s "not yet" answer, with an optional note. Leaves the request open and every rule about it intact.';

-- ----------------------------------------------------------------------------
-- 4. THE BELL
--    audit_logs is what the Header notification bell reads. Both columns are
--    set on purpose: user_id is what self_view_own_audit_logs matches for the
--    recipient, admin_id is what tenant_view_audit_logs matches for the
--    society's staff. A nomination is the member's business AND the sacco's.
--
--    A member with no portal login gets no bell — there is no session to show
--    it in. That is a silent no-op rather than a failure, because the sacco
--    may legitimately nominate a member whose login is still being set up, and
--    the register itself is not damaged by the absence of a notification.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_notify(
  p_recipient_member_id uuid,
  p_action              public.audit_action,
  p_guarantee_id        uuid,
  p_description         text,
  p_severity            text DEFAULT 'info'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  uuid;
  v_admin uuid;
BEGIN
  SELECT m.user_id, m.admin_id INTO v_user, v_admin
    FROM public.sacco_members m WHERE m.id = p_recipient_member_id;

  IF v_user IS NULL THEN RETURN; END IF;

  INSERT INTO public.audit_logs
    (user_id, admin_id, action, table_name, record_id, description, severity)
  VALUES
    (v_user, v_admin, p_action, 'sacco_loan_guarantees', p_guarantee_id,
     p_description, p_severity);
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_notify(uuid, public.audit_action, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- A nomination lands in the guarantor's bell the moment it is written.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_notify_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_borrower text;
BEGIN
  SELECT full_name INTO v_borrower FROM public.sacco_members
   WHERE id = NEW.borrower_member_id;

  PERFORM public.sacco_loan_guarantee_notify(
    NEW.guarantor_member_id, 'guarantor_request', NEW.id,
    format('%s has asked you to guarantee KES %s of their loan (%s). Open the Guarantees tab to answer.',
           COALESCE(v_borrower, 'A member'),
           to_char(NEW.amount_guaranteed, 'FM999,999,999,990.00'),
           NEW.ref_no),
    'info');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notify_sacco_loan_guarantee_requested ON public.sacco_loan_guarantees;
CREATE TRIGGER notify_sacco_loan_guarantee_requested
  AFTER INSERT ON public.sacco_loan_guarantees
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_guarantee_notify_requested();

-- Every answer goes back to whoever is waiting on it.
--
-- The loan-status sweep in sacco_loan_guarantees_on_loan_status() also lands
-- here, cancelling open requests when a loan closes or is rejected. That is
-- not a withdrawal by the borrower and must not be announced as one, so the
-- cancel branch fires only when the borrower themself is the caller —
-- current_sacco_member_id() is NULL for the staff member closing the loan.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_notify_answered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guarantor text;
  v_borrower  text;
  v_amount    text := to_char(NEW.amount_guaranteed, 'FM999,999,999,990.00');
BEGIN
  SELECT full_name INTO v_guarantor FROM public.sacco_members WHERE id = NEW.guarantor_member_id;
  SELECT full_name INTO v_borrower  FROM public.sacco_members WHERE id = NEW.borrower_member_id;

  -- Confirmed.
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    PERFORM public.sacco_loan_guarantee_notify(
      NEW.borrower_member_id, 'guarantor_response', NEW.id,
      format('%s has confirmed a guarantee of KES %s on your loan (%s).',
             COALESCE(v_guarantor, 'A member'), v_amount, NEW.ref_no),
      'info');

  -- Refused.
  ELSIF NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined' THEN
    PERFORM public.sacco_loan_guarantee_notify(
      NEW.borrower_member_id, 'guarantor_response', NEW.id,
      format('%s has declined to guarantee KES %s on your loan (%s).%s',
             COALESCE(v_guarantor, 'A member'), v_amount, NEW.ref_no,
             CASE WHEN NEW.decline_reason IS NULL THEN ''
                  ELSE ' Reason: ' || NEW.decline_reason END),
      'warning');

  -- Withdrawn by the borrower — never by the loan-status sweep.
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
        AND public.current_sacco_member_id() = NEW.borrower_member_id THEN
    PERFORM public.sacco_loan_guarantee_notify(
      NEW.guarantor_member_id, 'guarantor_response', NEW.id,
      format('%s has withdrawn the guarantee request they sent you (%s).',
             COALESCE(v_borrower, 'A member'), NEW.ref_no),
      'info');

  -- Not yet. Checked last so a deferral recorded in the same statement as a
  -- status change never speaks over the status change itself.
  ELSIF NEW.waited_at IS NOT NULL AND NEW.waited_at IS DISTINCT FROM OLD.waited_at THEN
    PERFORM public.sacco_loan_guarantee_notify(
      NEW.borrower_member_id, 'guarantor_response', NEW.id,
      format('%s has asked for more time on the KES %s guarantee you requested (%s).%s',
             COALESCE(v_guarantor, 'A member'), v_amount, NEW.ref_no,
             CASE WHEN NEW.wait_note IS NULL THEN ''
                  ELSE ' They said: ' || NEW.wait_note END),
      'info');
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notify_sacco_loan_guarantee_answered ON public.sacco_loan_guarantees;
CREATE TRIGGER notify_sacco_loan_guarantee_answered
  AFTER UPDATE ON public.sacco_loan_guarantees
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_guarantee_notify_answered();
