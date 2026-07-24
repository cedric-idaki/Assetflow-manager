-- ============================================================================
-- SACCO ELECTIONS — SCHEDULED WINDOWS & AUTO-CLOSE
-- ----------------------------------------------------------------------------
-- Extends 20260715120000_sacco_elections.sql so an election can run on a
-- pre-set clock instead of only manual admin clicks:
--
--   * The admin sets planned times up front (nominations close, voting open,
--     voting close) via sacco_election_set_schedule. These are stored in NEW
--     *_scheduled_at columns, kept distinct from the existing "actual event"
--     stamps (nominations_close_at / voting_open_at / voting_close_at).
--   * A system worker (sacco_governance_run_due, defined in the motion-
--     governance migration) advances every DUE election with system authority.
--   * CORRECTNESS NEVER DEPENDS ON THE WORKER FIRING ON TIME: cast_ballot now
--     refuses a ballot the instant now() passes voting_close_scheduled_at, so a
--     late or missed tick can never let a late vote through.
--
-- The transition logic that used to live inside the public RPCs is factored
-- into internal helpers (_sacco_election_*), so both the user-facing RPC (after
-- its auth check) and the system worker can reuse it without duplication. The
-- helpers keep setting the app.sacco_election_rpc GUC the integrity triggers
-- require, and keep writing the audit trail. Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEDULED-TIME COLUMNS (planned; the *_at columns remain the actuals)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_elections
  ADD COLUMN IF NOT EXISTS nominations_close_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voting_open_scheduled_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voting_close_scheduled_at       TIMESTAMPTZ;

-- The scheduled times drive auto-transitions, so gate them behind the official
-- RPCs too (defense-in-depth) — re-declare the status guard with them added to
-- the WHEN list. (Same trigger as the base migration, three columns richer.)
DROP TRIGGER IF EXISTS guard_status_sacco_elections ON public.sacco_elections;
CREATE TRIGGER guard_status_sacco_elections
  BEFORE UPDATE ON public.sacco_elections
  FOR EACH ROW
  WHEN (OLD.status               IS DISTINCT FROM NEW.status
     OR OLD.results              IS DISTINCT FROM NEW.results
     OR OLD.register_size        IS DISTINCT FROM NEW.register_size
     OR OLD.nominations_open_at  IS DISTINCT FROM NEW.nominations_open_at
     OR OLD.nominations_close_at IS DISTINCT FROM NEW.nominations_close_at
     OR OLD.voting_open_at       IS DISTINCT FROM NEW.voting_open_at
     OR OLD.voting_close_at      IS DISTINCT FROM NEW.voting_close_at
     OR OLD.results_published_at IS DISTINCT FROM NEW.results_published_at
     OR OLD.nominations_close_scheduled_at IS DISTINCT FROM NEW.nominations_close_scheduled_at
     OR OLD.voting_open_scheduled_at       IS DISTINCT FROM NEW.voting_open_scheduled_at
     OR OLD.voting_close_scheduled_at      IS DISTINCT FROM NEW.voting_close_scheduled_at
     OR (OLD.quorum_percent IS DISTINCT FROM NEW.quorum_percent AND OLD.status <> 'draft'))
  EXECUTE FUNCTION public.sacco_election_guard();

-- ----------------------------------------------------------------------------
-- 2. INTERNAL TRANSITION HELPERS
--    Each takes the ALREADY-LOADED, row-locked election record, sets the GUC,
--    re-checks the precondition, does the work and writes the audit row. NO
--    authorization check — the caller is responsible for that (the public RPC
--    checks the acting admin; the system worker acts with system authority).
--    Revoked from PUBLIC so a client can never call them directly.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._sacco_election_close_nominations(e public.sacco_elections)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_approved int; v_pending int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  IF e.status <> 'nominations_open' THEN
    RAISE EXCEPTION 'Nominations are not open (current: %)', e.status;
  END IF;

  SELECT COUNT(*) FILTER (WHERE status = 'approved'),
         COUNT(*) FILTER (WHERE status = 'pending')
    INTO v_approved, v_pending
  FROM public.sacco_election_candidates WHERE election_id = e.id;

  UPDATE public.sacco_elections
     SET status = 'nominations_closed', nominations_close_at = now(), updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'nominations_closed',
    jsonb_build_object('approved_candidates', v_approved, 'pending_candidates', v_pending));
END;
$$;

-- Freezes the voter register and returns its size. Refuses if any position
-- still lacks an approved candidate.
CREATE OR REPLACE FUNCTION public._sacco_election_open_voting(e public.sacco_elections)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_missing text;
  v_count int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  IF e.status <> 'nominations_closed' THEN
    RAISE EXCEPTION 'Close nominations before opening voting (current: %)', e.status;
  END IF;

  SELECT p.title INTO v_missing
  FROM public.sacco_election_positions p
  WHERE p.election_id = e.id
    AND NOT EXISTS (
      SELECT 1 FROM public.sacco_election_candidates c
      WHERE c.position_id = p.id AND c.status = 'approved'
    )
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Position "%" has no approved candidate', v_missing;
  END IF;

  INSERT INTO public.sacco_election_voters
    (admin_id, sacco_id, election_id, member_id, member_no, full_name)
  SELECT e.admin_id, e.sacco_id, e.id, m.id, m.member_no, m.full_name
  FROM public.sacco_members m
  WHERE m.sacco_id = e.sacco_id AND m.status = 'active';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No active members to register as voters';
  END IF;

  UPDATE public.sacco_elections
     SET status = 'voting_open', voting_open_at = now(),
         register_size = v_count, updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'voting_opened',
    jsonb_build_object('register_size', v_count));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public._sacco_election_close_voting(e public.sacco_elections)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_voted int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  IF e.status <> 'voting_open' THEN
    RAISE EXCEPTION 'Voting is not open (current: %)', e.status;
  END IF;

  SELECT COUNT(voted_at) INTO v_voted
  FROM public.sacco_election_voters WHERE election_id = e.id;

  UPDATE public.sacco_elections
     SET status = 'voting_closed', voting_close_at = now(), updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'voting_closed',
    jsonb_build_object('registered', e.register_size, 'voted', v_voted));
END;
$$;

-- These internal helpers carry NO authorization check, so they must be
-- unreachable by clients. REVOKE FROM PUBLIC alone is NOT enough on Supabase:
-- default privileges grant EXECUTE on new public functions to anon +
-- authenticated explicitly, so revoke those roles too. Only the owner (and thus
-- the SECURITY DEFINER callers owned by it) can reach them.
REVOKE ALL ON FUNCTION public._sacco_election_close_nominations(public.sacco_elections) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sacco_election_open_voting(public.sacco_elections)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sacco_election_close_voting(public.sacco_elections)      FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. PUBLIC LIFECYCLE RPCs — now thin: load + lock, authorize, delegate.
--    Signatures and behaviour are unchanged for existing callers.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sacco_election_close_nominations(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.sacco_elections;
BEGIN
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  PERFORM public._sacco_election_close_nominations(e);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_election_open_voting(p_election_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.sacco_elections;
BEGIN
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN public._sacco_election_open_voting(e);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_election_close_voting(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.sacco_elections;
BEGIN
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  PERFORM public._sacco_election_close_voting(e);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. SET / CLEAR THE SCHEDULE (staff only). Pass NULL for any leg to leave that
--    transition manual. Editable until voting is open; blocked afterwards.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_election_set_schedule(
  p_election_id       uuid,
  p_nominations_close timestamptz,
  p_voting_open       timestamptz,
  p_voting_close      timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE e public.sacco_elections;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF e.status IN ('voting_open', 'voting_closed', 'results_published', 'cancelled') THEN
    RAISE EXCEPTION 'The schedule can no longer be changed (current: %)', e.status;
  END IF;
  IF p_voting_open IS NOT NULL AND p_voting_close IS NOT NULL AND p_voting_close <= p_voting_open THEN
    RAISE EXCEPTION 'Voting close time must be after the voting open time';
  END IF;
  IF p_nominations_close IS NOT NULL AND p_voting_open IS NOT NULL AND p_voting_open < p_nominations_close THEN
    RAISE EXCEPTION 'Voting cannot open before nominations close';
  END IF;

  UPDATE public.sacco_elections
     SET nominations_close_scheduled_at = p_nominations_close,
         voting_open_scheduled_at       = p_voting_open,
         voting_close_scheduled_at      = p_voting_close,
         updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'schedule_set',
    jsonb_build_object('nominations_close', p_nominations_close,
                       'voting_open', p_voting_open,
                       'voting_close', p_voting_close));
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_election_set_schedule(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_set_schedule(uuid, timestamptz, timestamptz, timestamptz) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. CAST BALLOT — re-declared to add DEFENSIVE DEADLINE ENFORCEMENT.
--    Identical to the base migration except for the voting_close_scheduled_at
--    guard: once the scheduled close time passes, no ballot is accepted even if
--    the worker has not yet flipped the status to voting_closed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_election_cast_ballot(p_election_id uuid, p_choices jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
  v_member uuid;
  v_reg uuid;
  v_n int; v_np int; v_bad int;
  v_receipt text;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);

  v_member := public.current_sacco_member_id();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Only sacco members can vote';
  END IF;

  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR SHARE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF e.sacco_id IS DISTINCT FROM public.current_member_sacco_id() THEN
    RAISE EXCEPTION 'This election is not in your sacco';
  END IF;
  IF e.status <> 'voting_open' THEN
    RAISE EXCEPTION 'Voting is not open (current: %)', e.status;
  END IF;
  -- Hard deadline: correctness cannot depend on the auto-close worker running.
  IF e.voting_close_scheduled_at IS NOT NULL AND now() >= e.voting_close_scheduled_at THEN
    RAISE EXCEPTION 'Voting has closed — the voting window ended at %', e.voting_close_scheduled_at;
  END IF;

  UPDATE public.sacco_election_voters
     SET voted_at = now()
   WHERE election_id = e.id AND member_id = v_member AND voted_at IS NULL
   RETURNING id INTO v_reg;

  IF v_reg IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.sacco_election_voters
               WHERE election_id = e.id AND member_id = v_member) THEN
      RAISE EXCEPTION 'You have already voted in this election — votes are final';
    ELSE
      RAISE EXCEPTION 'You are not on the voter register for this election';
    END IF;
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT (c->>'position_id'))
    INTO v_n, v_np
  FROM jsonb_array_elements(COALESCE(p_choices, '[]'::jsonb)) c;
  IF v_n = 0 THEN RAISE EXCEPTION 'Select at least one candidate'; END IF;
  IF v_n <> v_np THEN RAISE EXCEPTION 'The ballot selects the same position twice'; END IF;

  SELECT COUNT(*) INTO v_bad
  FROM jsonb_array_elements(p_choices) c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.sacco_election_candidates cc
    JOIN public.sacco_election_positions pp ON pp.id = cc.position_id
    WHERE cc.id = (c->>'candidate_id')::uuid
      AND cc.position_id = (c->>'position_id')::uuid
      AND cc.status = 'approved'
      AND pp.election_id = e.id
  );
  IF v_bad > 0 THEN RAISE EXCEPTION 'The ballot contains an invalid selection'; END IF;

  LOOP
    v_receipt := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.sacco_election_ballots
      WHERE election_id = e.id AND receipt_code = v_receipt
    );
  END LOOP;

  INSERT INTO public.sacco_election_ballots
    (admin_id, sacco_id, election_id, position_id, candidate_id, receipt_code)
  SELECT e.admin_id, e.sacco_id, e.id,
         (c->>'position_id')::uuid, (c->>'candidate_id')::uuid, v_receipt
  FROM jsonb_array_elements(p_choices) c;

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_election_cast_ballot(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_election_cast_ballot(uuid, jsonb) TO authenticated;
