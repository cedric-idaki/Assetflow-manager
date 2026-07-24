-- ============================================================================
-- SACCO MOTIONS — GOVERNANCE ESSENTIALS (BRS §6) + THE AUTO-CLOSE WORKER
-- ----------------------------------------------------------------------------
-- Brings the Voting & Governance engine up to its BRS "core" bar and wires the
-- system worker that drives BOTH motions and elections on a schedule:
--
--   * VT1.7 Deadline enforcement — a motion vote is refused at the DB the
--     instant now() passes voting_end (tightened member RLS below). This holds
--     even before the worker flips the motion to passed/rejected.
--   * VT1.9 Quorum validation   — sacco_motion_close computes turnout against
--     the count of active members and only passes a motion when quorum is met
--     AND yes > no. Replaces the old client-side "yes > no" publish.
--   * Auto-close                — sacco_governance_run_due (system authority,
--     service_role only) closes every due motion and advances every due
--     election, returning the events the notifier should email on.
--   * Realtime                  — sacco_motions / sacco_votes join the realtime
--     publication so an auto-close reflects live in the member portals (only
--     election tables were published before).
--
-- Depends on 20260718090000_sacco_election_scheduling.sql (the _sacco_election_*
-- helpers and the *_scheduled_at columns). Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VT1.7 — MOTION VOTING DEADLINE, ENFORCED IN RLS
--    Re-declare the two member vote policies from 20260708130000 with a
--    now() < voting_end guard so a ballot is refused once the window ends.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "member_cast_vote" ON public.sacco_votes;
CREATE POLICY "member_cast_vote" ON public.sacco_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.current_sacco_member_id()
    AND EXISTS (
      SELECT 1 FROM public.sacco_motions m
      WHERE m.id = motion_id
        AND m.sacco_id = public.current_member_sacco_id()
        AND m.status = 'open'
        AND (m.voting_end IS NULL OR now() < m.voting_end)
    )
  );

DROP POLICY IF EXISTS "member_change_vote" ON public.sacco_votes;
CREATE POLICY "member_change_vote" ON public.sacco_votes
  FOR UPDATE TO authenticated
  USING (
    member_id = public.current_sacco_member_id()
    AND EXISTS (
      SELECT 1 FROM public.sacco_motions m
      WHERE m.id = motion_id
        AND m.status = 'open'
        AND (m.voting_end IS NULL OR now() < m.voting_end)
    )
  )
  WITH CHECK (member_id = public.current_sacco_member_id());

-- ----------------------------------------------------------------------------
-- 2. MOTION CLOSE (quorum-aware). Internal helper takes the loaded, locked
--    motion and does the work with NO auth check; the public wrapper checks the
--    acting admin. Both are SECURITY DEFINER and bypass RLS on sacco_votes to
--    count secret ballots without exposing individual choices.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sacco_motion_close(m public.sacco_motions)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_yes int; v_no int; v_abstain int; v_total int; v_eligible int;
  v_quorum_met boolean; v_passed boolean;
  v_status public.motion_status;
BEGIN
  IF m.status <> 'open' THEN
    RAISE EXCEPTION 'Motion is not open (current: %)', m.status;
  END IF;

  SELECT COUNT(*) FILTER (WHERE choice = 'yes'),
         COUNT(*) FILTER (WHERE choice = 'no'),
         COUNT(*) FILTER (WHERE choice = 'abstain'),
         COUNT(*)
    INTO v_yes, v_no, v_abstain, v_total
  FROM public.sacco_votes WHERE motion_id = m.id;

  SELECT COUNT(*) INTO v_eligible
  FROM public.sacco_members WHERE sacco_id = m.sacco_id AND status = 'active';

  v_quorum_met := (COALESCE(m.quorum_percent, 0) = 0)
                  OR (v_eligible > 0 AND (v_total::numeric * 100.0 / v_eligible) >= m.quorum_percent);
  v_passed := v_quorum_met AND v_yes > v_no;
  v_status := CASE WHEN v_passed THEN 'passed' ELSE 'rejected' END;

  UPDATE public.sacco_motions
     SET status = v_status, voting_end = COALESCE(voting_end, now()), updated_at = now()
   WHERE id = m.id;

  RETURN jsonb_build_object(
    'yes', v_yes, 'no', v_no, 'abstain', v_abstain, 'total', v_total,
    'eligible', v_eligible, 'quorum_percent', COALESCE(m.quorum_percent, 0),
    'quorum_met', v_quorum_met, 'passed', v_passed, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_motion_close(p_motion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE m public.sacco_motions;
BEGIN
  SELECT * INTO m FROM public.sacco_motions WHERE id = p_motion_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Motion not found'; END IF;
  IF NOT ((m.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN public._sacco_motion_close(m);
END;
$$;

-- _sacco_motion_close has NO auth check — revoke from the auto-granted roles
-- (see the note in the election-scheduling migration), leaving it owner-only.
REVOKE ALL ON FUNCTION public._sacco_motion_close(public.sacco_motions) FROM PUBLIC, anon, authenticated;
-- The public wrapper checks the acting admin, so authenticated may call it.
REVOKE ALL ON FUNCTION public.sacco_motion_close(uuid)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_motion_close(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE SYSTEM WORKER — advances every DUE election and motion in one txn and
--    returns the notify events. SERVICE-ROLE ONLY: it acts with system
--    authority (no auth.uid()), so it must never be reachable by a client.
--    Rows are locked SKIP LOCKED so overlapping ticks don't fight; the status
--    check inside each helper makes a double-transition a no-op.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_governance_run_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_events jsonb := '[]'::jsonb;
  e public.sacco_elections;
  m public.sacco_motions;
  v_missing text;
  v_count int;
BEGIN
  -- Elections: one scheduled transition per election per tick (a 1-minute
  -- cadence makes the at-most-one-step latency negligible).
  FOR e IN
    SELECT * FROM public.sacco_elections
    WHERE status IN ('nominations_open', 'nominations_closed', 'voting_open')
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    IF e.status = 'nominations_open'
       AND e.nominations_close_scheduled_at IS NOT NULL
       AND now() >= e.nominations_close_scheduled_at THEN
      PERFORM public._sacco_election_close_nominations(e);
      v_events := v_events || jsonb_build_object(
        'kind','election','id',e.id,'sacco_id',e.sacco_id,'admin_id',e.admin_id,
        'title',e.title,'event','nominations_closed');

    ELSIF e.status = 'nominations_closed'
       AND e.voting_open_scheduled_at IS NOT NULL
       AND now() >= e.voting_open_scheduled_at THEN
      -- Only auto-open if every position has an approved candidate; otherwise
      -- leave it for the admin (no repeated logging/noise).
      SELECT p.title INTO v_missing
      FROM public.sacco_election_positions p
      WHERE p.election_id = e.id
        AND NOT EXISTS (
          SELECT 1 FROM public.sacco_election_candidates c
          WHERE c.position_id = p.id AND c.status = 'approved')
      LIMIT 1;
      IF v_missing IS NULL THEN
        v_count := public._sacco_election_open_voting(e);
        v_events := v_events || jsonb_build_object(
          'kind','election','id',e.id,'sacco_id',e.sacco_id,'admin_id',e.admin_id,
          'title',e.title,'event','voting_opened','register_size',v_count);
      END IF;

    ELSIF e.status = 'voting_open'
       AND e.voting_close_scheduled_at IS NOT NULL
       AND now() >= e.voting_close_scheduled_at THEN
      PERFORM public._sacco_election_close_voting(e);
      v_events := v_events || jsonb_build_object(
        'kind','election','id',e.id,'sacco_id',e.sacco_id,'admin_id',e.admin_id,
        'title',e.title,'event','voting_closed');
    END IF;
  END LOOP;

  -- Motions: close every open motion whose voting_end has passed.
  FOR m IN
    SELECT * FROM public.sacco_motions
    WHERE status = 'open' AND voting_end IS NOT NULL AND now() >= voting_end
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_events := v_events || (jsonb_build_object(
      'kind','motion','id',m.id,'sacco_id',m.sacco_id,'admin_id',m.admin_id,
      'title',m.title,'ballot_type',m.ballot_type::text,'event','motion_closed')
      || public._sacco_motion_close(m));
  END LOOP;

  RETURN v_events;
END;
$$;

-- System-authority worker: acts with no auth check, so it must be service-role
-- only. Revoke the auto-granted anon/authenticated EXECUTE, not just PUBLIC.
REVOKE ALL ON FUNCTION public.sacco_governance_run_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_governance_run_due() TO service_role;

-- ----------------------------------------------------------------------------
-- 4. REALTIME — publish the motion tables the portals watch (base migration
--    only published the election tables). RLS still applies to realtime, so
--    members receive only rows they may read.
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_motions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_votes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
