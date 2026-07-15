-- ============================================================================
-- SACCO ELECTIONS ("POLLING STATION")
-- ----------------------------------------------------------------------------
-- Candidate elections for office bearers (chairman, treasurer, committee...),
-- built so results are structurally indisputable:
--
--   * Frozen voter register  — active members are snapshotted the instant
--     voting opens (sacco_election_voters); later joiners cannot vote and the
--     register survives member edits.
--   * One member one vote    — UNIQUE(election_id, member_id) + an atomic
--     voted_at claim inside sacco_election_cast_ballot.
--   * Secret, final ballots  — sacco_election_ballots carries NO voter
--     identity and has RLS enabled with ZERO policies (deny-all, admin
--     included). The only link between a voter and their ballot is the
--     anonymous receipt code returned once at cast time.
--   * Verifiability          — sacco_election_verify_receipt(code) shows what
--     a ballot recorded, without revealing whose it is.
--   * Deterministic results  — sacco_election_tally computes counts, ranked
--     winners per seat, and explicit ties (a tied seat is flagged for a
--     runoff, never silently resolved). publish freezes a JSONB snapshot.
--   * Tamper-proofing        — status changes, register writes and ballot
--     inserts are blocked (even for the sacco admin) unless they happen
--     inside the official RPCs, which set a transaction-local GUC. Ballots
--     and audit rows are append-only; the candidate list locks when voting
--     opens; an append-only audit trail records every lifecycle event.
--
-- Lifecycle: draft → nominations_open → nominations_closed → voting_open
--            → voting_closed → results_published   (+ cancelled)
--
-- Mirrors the tenant/member RLS patterns of 20260701140000_sacco_schema.sql
-- and 20260708130000_sacco_member_portal.sql. Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES (new types — safe to create in this migration)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.sacco_election_status AS ENUM
    ('draft', 'nominations_open', 'nominations_closed', 'voting_open',
     'voting_closed', 'results_published', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_candidate_status AS ENUM
    ('pending', 'approved', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_elections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID,
  sacco_id             UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  status               public.sacco_election_status DEFAULT 'draft',
  quorum_percent       INTEGER DEFAULT 0 CHECK (quorum_percent BETWEEN 0 AND 100),
  nominations_open_at  TIMESTAMPTZ,
  nominations_close_at TIMESTAMPTZ,
  voting_open_at       TIMESTAMPTZ,
  voting_close_at      TIMESTAMPTZ,
  results_published_at TIMESTAMPTZ,
  register_size        INTEGER,            -- frozen by sacco_election_open_voting
  results              JSONB,              -- frozen by sacco_election_publish_results
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.sacco_election_positions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID,
  sacco_id      UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  election_id   UUID NOT NULL REFERENCES public.sacco_elections(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,             -- Chairman, Treasurer, Committee Member...
  description   TEXT,
  seats         INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (election_id, title)
);

CREATE TABLE IF NOT EXISTS public.sacco_election_candidates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID,
  sacco_id     UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  election_id  UUID NOT NULL REFERENCES public.sacco_elections(id) ON DELETE CASCADE,
  position_id  UUID NOT NULL REFERENCES public.sacco_election_positions(id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  nominated_by UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL, -- NULL = admin direct add
  status       public.sacco_candidate_status DEFAULT 'pending',
  manifesto    TEXT,
  vetted_by    UUID,                       -- auth.uid() of the vetting admin
  vetted_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (position_id, member_id)          -- one candidacy per member per position
);

-- The frozen register. member_no / full_name are snapshots taken at the
-- freeze so the record survives later member edits (dispute-proof).
CREATE TABLE IF NOT EXISTS public.sacco_election_voters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID,
  sacco_id      UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  election_id   UUID NOT NULL REFERENCES public.sacco_elections(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES public.sacco_members(id),
  member_no     TEXT,
  full_name     TEXT,
  registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  voted_at      TIMESTAMPTZ,               -- NULL until a ballot is cast (= turnout)
  UNIQUE (election_id, member_id)          -- the one-member-one-ballot constraint
);

-- Anonymous ballots: NO voter identity, ever. All rows of one voter share the
-- one receipt code returned to them at cast time — that code, in the voter's
-- hands, is the only link between a person and their ballot.
CREATE TABLE IF NOT EXISTS public.sacco_election_ballots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID,
  sacco_id     UUID,
  election_id  UUID NOT NULL REFERENCES public.sacco_elections(id) ON DELETE CASCADE,
  position_id  UUID NOT NULL REFERENCES public.sacco_election_positions(id),
  candidate_id UUID NOT NULL REFERENCES public.sacco_election_candidates(id),
  receipt_code TEXT NOT NULL,
  cast_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (election_id, position_id, receipt_code)  -- one vote per position per receipt
);

CREATE TABLE IF NOT EXISTS public.sacco_election_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  sacco_id    UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  election_id UUID NOT NULL REFERENCES public.sacco_elections(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  actor_id    UUID,
  actor_label TEXT,
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sacco_elections_admin_id           ON public.sacco_elections(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_positions_admin_id  ON public.sacco_election_positions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_positions_election  ON public.sacco_election_positions(election_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_candidates_admin_id ON public.sacco_election_candidates(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_candidates_election ON public.sacco_election_candidates(election_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_voters_admin_id     ON public.sacco_election_voters(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_voters_election     ON public.sacco_election_voters(election_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_ballots_tally       ON public.sacco_election_ballots(election_id, position_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_sacco_election_ballots_receipt     ON public.sacco_election_ballots(election_id, receipt_code);
CREATE INDEX IF NOT EXISTS idx_sacco_election_audit_election      ON public.sacco_election_audit(election_id);

-- ----------------------------------------------------------------------------
-- 4. AUTO-STAMP admin_id / sacco_id on admin-facing tables (same pattern as
--    the core schema). Voters/ballots/audit get theirs explicitly inside the
--    RPCs, copied from the election row.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['sacco_elections', 'sacco_election_positions', 'sacco_election_candidates'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_admin_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_admin_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();', t);
    EXECUTE format('DROP TRIGGER IF EXISTS set_sacco_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_sacco_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_sacco_id_default();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--    Tenant policy on elections/positions/candidates/voters only.
--    BALLOTS: RLS enabled with ZERO policies — nobody, including the sacco
--    admin, can read or write ballots directly. Every access path is a
--    SECURITY DEFINER function below. (If the admin could read ballots they
--    could correlate cast_at with the register's voted_at and deanonymize.)
--    AUDIT: read-only to the tenant + the sacco's members; no write policies.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sacco_elections', 'sacco_election_positions',
    'sacco_election_candidates', 'sacco_election_voters'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%1$s ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_manage_%1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "tenant_manage_%1$s" ON public.%1$s
         FOR ALL TO authenticated
         USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
         WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());',
      t);
  END LOOP;
END $$;

ALTER TABLE public.sacco_election_ballots ENABLE ROW LEVEL SECURITY;  -- deny-all: no policies
ALTER TABLE public.sacco_election_audit   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_election_audit" ON public.sacco_election_audit;
CREATE POLICY "staff_read_election_audit" ON public.sacco_election_audit
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

DROP POLICY IF EXISTS "member_read_election_audit" ON public.sacco_election_audit;
CREATE POLICY "member_read_election_audit" ON public.sacco_election_audit
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Members read their sacco's elections, positions and candidates.
DROP POLICY IF EXISTS "member_read_elections" ON public.sacco_elections;
CREATE POLICY "member_read_elections" ON public.sacco_elections
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

DROP POLICY IF EXISTS "member_read_election_positions" ON public.sacco_election_positions;
CREATE POLICY "member_read_election_positions" ON public.sacco_election_positions
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

DROP POLICY IF EXISTS "member_read_election_candidates" ON public.sacco_election_candidates;
CREATE POLICY "member_read_election_candidates" ON public.sacco_election_candidates
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Nominations: self-nominate or nominate a fellow active member, only while
-- nominations are open; always lands as 'pending' with the caller recorded.
DROP POLICY IF EXISTS "member_nominate_candidate" ON public.sacco_election_candidates;
CREATE POLICY "member_nominate_candidate" ON public.sacco_election_candidates
  FOR INSERT TO authenticated
  WITH CHECK (
    sacco_id = public.current_member_sacco_id()
    AND nominated_by = public.current_sacco_member_id()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.sacco_elections e
      WHERE e.id = election_id
        AND e.sacco_id = public.current_member_sacco_id()
        AND e.status = 'nominations_open'
    )
    AND EXISTS (
      SELECT 1 FROM public.sacco_members m
      WHERE m.id = member_id
        AND m.sacco_id = public.current_member_sacco_id()
        AND m.status = 'active'
    )
  );

-- A nominee may withdraw their own candidacy before voting opens.
DROP POLICY IF EXISTS "member_withdraw_candidacy" ON public.sacco_election_candidates;
CREATE POLICY "member_withdraw_candidacy" ON public.sacco_election_candidates
  FOR UPDATE TO authenticated
  USING (
    member_id = public.current_sacco_member_id()
    AND EXISTS (
      SELECT 1 FROM public.sacco_elections e
      WHERE e.id = election_id
        AND e.status IN ('nominations_open', 'nominations_closed')
    )
  )
  WITH CHECK (
    member_id = public.current_sacco_member_id()
    AND status = 'withdrawn'
  );

-- Register: a member sees ONLY their own row (am I registered? have I voted?).
-- The full register is admin/tenant-only via tenant_manage_*.
DROP POLICY IF EXISTS "member_read_own_voter_row" ON public.sacco_election_voters;
CREATE POLICY "member_read_own_voter_row" ON public.sacco_election_voters
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

-- ----------------------------------------------------------------------------
-- 6. INTEGRITY GUARDS
--    A transaction-local GUC set only by the official RPCs gates every write
--    that could alter an election's outcome. Direct writes — even by the
--    sacco admin through the tenant policy — are refused at trigger level.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_election_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.sacco_election_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'This change must go through the official election functions';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Ballots and audit rows are append-only forever.
CREATE OR REPLACE FUNCTION public.sacco_election_block_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

-- Elections may only be deleted while still draft; anything later is history
-- and must be cancelled instead (the record stays, with its audit trail).
CREATE OR REPLACE FUNCTION public.sacco_election_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft elections can be deleted — cancel this election instead';
  END IF;
  RETURN OLD;
END;
$$;

-- The ballot paper is locked once voting opens: no candidate or position may
-- be added, edited or removed from that point on (it would corrupt the tally).
CREATE OR REPLACE FUNCTION public.sacco_election_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status public.sacco_election_status;
BEGIN
  SELECT status INTO v_status FROM public.sacco_elections
  WHERE id = COALESCE(NEW.election_id, OLD.election_id);
  IF v_status IN ('voting_open', 'voting_closed', 'results_published') THEN
    RAISE EXCEPTION 'The ballot is locked — candidates and positions cannot change once voting opens';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

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
     OR (OLD.quorum_percent IS DISTINCT FROM NEW.quorum_percent AND OLD.status <> 'draft'))
  EXECUTE FUNCTION public.sacco_election_guard();

DROP TRIGGER IF EXISTS guard_delete_sacco_elections ON public.sacco_elections;
CREATE TRIGGER guard_delete_sacco_elections
  BEFORE DELETE ON public.sacco_elections
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_delete_guard();

DROP TRIGGER IF EXISTS guard_write_sacco_election_voters ON public.sacco_election_voters;
CREATE TRIGGER guard_write_sacco_election_voters
  BEFORE INSERT OR UPDATE OR DELETE ON public.sacco_election_voters
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_guard();

DROP TRIGGER IF EXISTS guard_insert_sacco_election_ballots ON public.sacco_election_ballots;
CREATE TRIGGER guard_insert_sacco_election_ballots
  BEFORE INSERT ON public.sacco_election_ballots
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_guard();

DROP TRIGGER IF EXISTS block_write_sacco_election_ballots ON public.sacco_election_ballots;
CREATE TRIGGER block_write_sacco_election_ballots
  BEFORE UPDATE OR DELETE ON public.sacco_election_ballots
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_block_write();

DROP TRIGGER IF EXISTS block_update_sacco_election_audit ON public.sacco_election_audit;
CREATE TRIGGER block_update_sacco_election_audit
  BEFORE UPDATE ON public.sacco_election_audit
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_block_write();

DROP TRIGGER IF EXISTS freeze_sacco_election_candidates ON public.sacco_election_candidates;
CREATE TRIGGER freeze_sacco_election_candidates
  BEFORE INSERT OR UPDATE OR DELETE ON public.sacco_election_candidates
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_freeze_guard();

DROP TRIGGER IF EXISTS freeze_sacco_election_positions ON public.sacco_election_positions;
CREATE TRIGGER freeze_sacco_election_positions
  BEFORE INSERT OR UPDATE OR DELETE ON public.sacco_election_positions
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_freeze_guard();

-- ----------------------------------------------------------------------------
-- 7. AUDIT TRAIL
-- ----------------------------------------------------------------------------
-- Internal writer (NOT callable by clients — execute is revoked below).
CREATE OR REPLACE FUNCTION public.sacco_election_log(
  p_election_id uuid, p_event text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid; v_sacco uuid; v_label text;
BEGIN
  SELECT admin_id, sacco_id INTO v_admin, v_sacco
  FROM public.sacco_elections WHERE id = p_election_id;

  SELECT full_name INTO v_label FROM public.sacco_members
  WHERE user_id = auth.uid() LIMIT 1;
  IF v_label IS NULL THEN
    SELECT COALESCE(full_name, email) INTO v_label FROM public.user_profiles
    WHERE id = auth.uid();
  END IF;

  INSERT INTO public.sacco_election_audit
    (admin_id, sacco_id, election_id, event, actor_id, actor_label, details)
  VALUES
    (v_admin, v_sacco, p_election_id, p_event, auth.uid(),
     COALESCE(v_label, 'system'), COALESCE(p_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_election_log(uuid, text, jsonb) FROM PUBLIC;

-- 'created' is logged automatically the moment an election row appears.
CREATE OR REPLACE FUNCTION public.sacco_election_created_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sacco_election_log(NEW.id, 'created',
    jsonb_build_object('title', NEW.title, 'quorum_percent', NEW.quorum_percent));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_created_sacco_elections ON public.sacco_elections;
CREATE TRIGGER audit_created_sacco_elections
  AFTER INSERT ON public.sacco_elections
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_created_audit();

-- Every candidacy event is logged: nominated / added directly / approved /
-- rejected / withdrawn.
CREATE OR REPLACE FUNCTION public.sacco_election_candidate_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text; v_pos text; v_event text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN RETURN NEW; END IF;

  SELECT m.full_name INTO v_name FROM public.sacco_members m WHERE m.id = NEW.member_id;
  SELECT p.title INTO v_pos FROM public.sacco_election_positions p WHERE p.id = NEW.position_id;

  IF TG_OP = 'INSERT' THEN
    v_event := CASE WHEN NEW.status = 'approved' THEN 'candidate_added' ELSE 'candidate_nominated' END;
  ELSE
    v_event := 'candidate_' || NEW.status::text;
  END IF;

  PERFORM public.sacco_election_log(NEW.election_id, v_event,
    jsonb_build_object('candidate', v_name, 'position', v_pos));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_sacco_election_candidates ON public.sacco_election_candidates;
CREATE TRIGGER audit_sacco_election_candidates
  AFTER INSERT OR UPDATE ON public.sacco_election_candidates
  FOR EACH ROW EXECUTE FUNCTION public.sacco_election_candidate_audit();

-- ----------------------------------------------------------------------------
-- 8. LIFECYCLE RPCs
--    All SECURITY DEFINER. Admin-only ones share the sacco_motion_results
--    guard expression (tenant staff or global viewer). Each sets the
--    transaction-local GUC that the integrity triggers require, and writes
--    its audit row in the same transaction — the trail cannot have gaps.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sacco_election_open_nominations(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF e.status <> 'draft' THEN
    RAISE EXCEPTION 'Nominations can only be opened from draft (current: %)', e.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sacco_election_positions p WHERE p.election_id = e.id) THEN
    RAISE EXCEPTION 'Add at least one position before opening nominations';
  END IF;

  UPDATE public.sacco_elections
     SET status = 'nominations_open', nominations_open_at = now(), updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'nominations_opened', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_election_close_nominations(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
  v_approved int; v_pending int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
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

-- THE REGISTER FREEZE. Snapshots every currently-active member as an eligible
-- voter and stamps the register size on the election. Refuses to open if any
-- position lacks an approved candidate.
CREATE OR REPLACE FUNCTION public.sacco_election_open_voting(p_election_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
  v_missing text;
  v_count int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
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

-- CAST A BALLOT (members only). p_choices: [{"position_id": "...",
-- "candidate_id": "..."}]; a skipped position is an abstention. Everything —
-- the double-vote claim, validation, ballot rows — is one transaction: it all
-- lands or none of it does. Returns the voter's anonymous receipt code (the
-- only time it is ever revealed).
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

  -- FOR SHARE serializes casting against close_voting's FOR UPDATE lock:
  -- no ballot can land in the same instant the election closes.
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR SHARE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF e.sacco_id IS DISTINCT FROM public.current_member_sacco_id() THEN
    RAISE EXCEPTION 'This election is not in your sacco';
  END IF;
  IF e.status <> 'voting_open' THEN
    RAISE EXCEPTION 'Voting is not open (current: %)', e.status;
  END IF;

  -- Atomic double-vote claim: the row lock means a concurrent second call
  -- finds voted_at already set and gets nothing back.
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

  -- Validate the choices payload.
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

  -- Crypto-secure, human-friendly receipt (collision-checked per election).
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

CREATE OR REPLACE FUNCTION public.sacco_election_close_voting(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
  v_voted int;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
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

CREATE OR REPLACE FUNCTION public.sacco_election_cancel(p_election_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF e.status IN ('results_published', 'cancelled') THEN
    RAISE EXCEPTION 'This election can no longer be cancelled (current: %)', e.status;
  END IF;

  UPDATE public.sacco_elections
     SET status = 'cancelled', updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'cancelled',
    jsonb_build_object('previous_status', e.status));
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. RESULTS
-- ----------------------------------------------------------------------------

-- Deterministic tally. Aggregate-only — individual ballots stay unreadable.
-- Visibility: members of the sacco see it only once results are published;
-- tenant staff / global viewers also see it after voting closes (preview).
-- While voting is open it returns NOTHING for anyone: no early counts.
--
-- Winner/tie semantics per position with S seats: a candidate whose whole
-- equal-votes group fits inside the S seats wins; a group that straddles the
-- seat boundary is flagged is_tie (runoff needed) and takes no seat.
CREATE OR REPLACE FUNCTION public.sacco_election_tally(p_election_id uuid)
RETURNS TABLE (
  position_id uuid, position_title text, seats int, display_order int,
  candidate_id uuid, candidate_name text, votes int,
  vote_rank int, is_winner boolean, is_tie boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH gate AS (
    SELECT e.id FROM public.sacco_elections e
    WHERE e.id = p_election_id
      AND (
        (e.status = 'results_published' AND e.sacco_id = public.current_member_sacco_id())
        OR (e.status IN ('voting_closed', 'results_published')
            AND ((e.admin_id = public.current_admin_id() AND public.is_staff_member())
                 OR public.is_global_viewer()))
      )
  ),
  counts AS (
    SELECT p.id AS position_id, p.title AS position_title, p.seats, p.display_order,
           c.id AS candidate_id, m.full_name AS candidate_name,
           COUNT(b.id)::int AS votes
    FROM gate g
    JOIN public.sacco_election_positions p ON p.election_id = g.id
    JOIN public.sacco_election_candidates c ON c.position_id = p.id AND c.status = 'approved'
    JOIN public.sacco_members m ON m.id = c.member_id
    LEFT JOIN public.sacco_election_ballots b
      ON b.election_id = g.id AND b.position_id = p.id AND b.candidate_id = c.id
    GROUP BY p.id, p.title, p.seats, p.display_order, c.id, m.full_name
  ),
  ranked AS (
    SELECT *,
           rank() OVER (PARTITION BY position_id ORDER BY votes DESC)::int AS rnk,
           COUNT(*)  OVER (PARTITION BY position_id, votes)::int           AS peers
    FROM counts
  )
  SELECT r.position_id, r.position_title, r.seats, r.display_order,
         r.candidate_id, r.candidate_name, r.votes,
         r.rnk AS vote_rank,
         (r.rnk - 1 + r.peers) <= r.seats                            AS is_winner,
         (r.rnk - 1) < r.seats AND (r.rnk - 1 + r.peers) > r.seats   AS is_tie
  FROM ranked r
  ORDER BY r.display_order, r.votes DESC, r.candidate_name;
$$;

-- Live turnout — the ONLY number visible while voting is open. Gated on the
-- election row (GROUP BY) so unauthorized callers get zero rows, not zeros.
CREATE OR REPLACE FUNCTION public.sacco_election_turnout(p_election_id uuid)
RETURNS TABLE (registered int, voted int, percent numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(v.id)::int,
         COUNT(v.voted_at)::int,
         CASE WHEN COUNT(v.id) > 0
              THEN round(COUNT(v.voted_at) * 100.0 / COUNT(v.id), 1)
              ELSE 0 END
  FROM public.sacco_elections e
  LEFT JOIN public.sacco_election_voters v ON v.election_id = e.id
  WHERE e.id = p_election_id
    AND (
      e.sacco_id = public.current_member_sacco_id()
      OR (e.admin_id = public.current_admin_id() AND public.is_staff_member())
      OR public.is_global_viewer()
    )
  GROUP BY e.id;
$$;

-- Publish: compute the final tally + turnout, freeze them into the election
-- row as JSONB, and log the totals. After this the numbers can never drift —
-- recomputing the tally will always match because ballots are immutable.
CREATE OR REPLACE FUNCTION public.sacco_election_publish_results(p_election_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.sacco_elections;
  v_reg int; v_voted int; v_pct numeric;
  v_positions jsonb; v_ties boolean;
  v_results jsonb;
BEGIN
  PERFORM set_config('app.sacco_election_rpc', '1', true);
  SELECT * INTO e FROM public.sacco_elections WHERE id = p_election_id FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Election not found'; END IF;
  IF NOT ((e.admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF e.status <> 'voting_closed' THEN
    RAISE EXCEPTION 'Close voting before publishing results (current: %)', e.status;
  END IF;

  SELECT COUNT(*)::int, COUNT(voted_at)::int INTO v_reg, v_voted
  FROM public.sacco_election_voters WHERE election_id = e.id;
  v_pct := CASE WHEN v_reg > 0 THEN round(v_voted * 100.0 / v_reg, 1) ELSE 0 END;

  SELECT COALESCE(jsonb_agg(pos.obj ORDER BY pos.display_order), '[]'::jsonb),
         COALESCE(bool_or(pos.tie), false)
    INTO v_positions, v_ties
  FROM (
    SELECT t.display_order,
           bool_or(t.is_tie) AS tie,
           jsonb_build_object(
             'position_id', t.position_id,
             'title',       t.position_title,
             'seats',       t.seats,
             'tie',         bool_or(t.is_tie),
             'candidates',  jsonb_agg(jsonb_build_object(
                              'candidate_id', t.candidate_id,
                              'name',         t.candidate_name,
                              'votes',        t.votes,
                              'is_winner',    t.is_winner,
                              'is_tie',       t.is_tie
                            ) ORDER BY t.votes DESC, t.candidate_name)
           ) AS obj
    FROM public.sacco_election_tally(p_election_id) t
    GROUP BY t.position_id, t.position_title, t.seats, t.display_order
  ) pos;

  v_results := jsonb_build_object(
    'positions',       v_positions,
    'registered',      v_reg,
    'voted',           v_voted,
    'turnout_percent', v_pct,
    'quorum_percent',  e.quorum_percent,
    'quorum_met',      v_pct >= e.quorum_percent,
    'has_ties',        v_ties,
    'published_at',    now()
  );

  UPDATE public.sacco_elections
     SET status = 'results_published', results = v_results,
         results_published_at = now(), updated_at = now()
   WHERE id = e.id;

  PERFORM public.sacco_election_log(e.id, 'results_published',
    jsonb_build_object('registered', v_reg, 'voted', v_voted,
                       'turnout_percent', v_pct,
                       'quorum_met', v_pct >= e.quorum_percent,
                       'has_ties', v_ties));
  RETURN v_results;
END;
$$;

-- Receipt verification: any holder of a receipt code can confirm what that
-- ballot recorded. Unknown codes return zero rows (no probing oracle).
CREATE OR REPLACE FUNCTION public.sacco_election_verify_receipt(p_election_id uuid, p_receipt text)
RETURNS TABLE (position_title text, candidate_name text, cast_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pp.title, m.full_name, b.cast_at
  FROM public.sacco_election_ballots b
  JOIN public.sacco_elections e            ON e.id = b.election_id
  JOIN public.sacco_election_positions pp  ON pp.id = b.position_id
  JOIN public.sacco_election_candidates c  ON c.id = b.candidate_id
  JOIN public.sacco_members m              ON m.id = c.member_id
  WHERE b.election_id = p_election_id
    AND b.receipt_code = upper(trim(COALESCE(p_receipt, '')))
    AND (
      e.sacco_id = public.current_member_sacco_id()
      OR (e.admin_id = public.current_admin_id() AND public.is_staff_member())
      OR public.is_global_viewer()
    )
  ORDER BY pp.display_order;
$$;

-- ----------------------------------------------------------------------------
-- 10. GRANTS
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sacco_election_open_nominations(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_close_nominations(uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_open_voting(uuid)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_cast_ballot(uuid, jsonb)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_close_voting(uuid)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_cancel(uuid)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_publish_results(uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_tally(uuid)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_turnout(uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sacco_election_verify_receipt(uuid, text)  FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 10a. REALTIME
--     The project's supabase_realtime publication is per-table (and was empty
--     before this). Publish the three tables the dashboards watch live —
--     turnout on voting day comes from voter-row events. Ballots and audit
--     stay unpublished (ballots are deny-all anyway; realtime enforces RLS).
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_elections;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_election_candidates;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_election_voters;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT EXECUTE ON FUNCTION public.sacco_election_open_nominations(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_close_nominations(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_open_voting(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_cast_ballot(uuid, jsonb)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_close_voting(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_cancel(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_publish_results(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_tally(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_turnout(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_election_verify_receipt(uuid, text) TO authenticated;
