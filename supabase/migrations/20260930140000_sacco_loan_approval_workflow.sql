-- ============================================================================
-- SACCO LOAN APPROVAL WORKFLOW — configurable levels, named approvers, OTP
-- ============================================================================
-- Until now a loan went pending → active on one click by any staff user. A
-- society's credit policy is rarely that: a credit officer reviews, a manager
-- signs off, the credit committee approves the large ones. This migration lets
-- each sacco define that chain itself.
--
--   * LEVELS    — the sacco lists its approval levels in order ("Credit
--                 Officer", "Manager", "Credit Committee") and names the person
--                 who approves at each, with an email and/or phone for the OTP.
--   * MODE      — sequential: level 2 cannot act until level 1 has approved.
--                 parallel:   every level may act at once; all must approve.
--                 Either way ONE rejection rejects the loan.
--   * OTP       — every decision is confirmed with a one-time code sent to the
--                 named approver's own email/phone. Whoever is logged in to the
--                 dashboard cannot decide for a level without that code, which
--                 is what makes the name on the level mean something.
--
-- HOW THE CHAIN ATTACHES TO A LOAN
--   A loan inserted as pending while the sacco has active levels gets one step
--   per level, SNAPSHOTTING the level name and approver details. Editing the
--   levels later changes future loans only — an in-flight loan is decided by
--   the people it was sent to. Pending loans that pre-date the configuration
--   are attached on demand with sacco_loan_approval_start().
--
-- WHERE THE RULE IS ENFORCED
--   Here, not in the browser. Staff hold UPDATE on sacco_loans, so the gate is
--   a trigger: a pending loan cannot become approved/active while any of its
--   steps is not approved, nor while the sacco has levels but the loan has no
--   steps. Steps, levels and settings are SELECT-only to clients; every write
--   goes through the SECURITY DEFINER functions below. The OTP hash lives in a
--   table no client role can read at all — a SHA-256 of a six-digit code is
--   brute-forced in under a second, so exposing it would expose the code.
--
-- A sacco with NO active levels keeps the old single-click behaviour.
--
-- The code itself is generated and delivered by the Edge Function
-- sacco-loan-approval-otp; it never passes through the browser.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.sacco_loans ADD COLUMN IF NOT EXISTS approval_mode TEXT;

-- ----------------------------------------------------------------------------
-- 1. CONFIGURATION
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_loan_approval_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  sacco_id    UUID NOT NULL UNIQUE REFERENCES public.saccos(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'sequential'
              CHECK (mode IN ('sequential', 'parallel')),
  updated_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sacco_loan_approval_levels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  level_no        INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 10),
  level_name      TEXT NOT NULL CHECK (length(trim(level_name)) > 0),
  approver_name   TEXT NOT NULL CHECK (length(trim(approver_name)) > 0),
  approver_email  TEXT,
  approver_phone  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The OTP has to reach somebody.
  CONSTRAINT sacco_loan_approval_levels_contact_chk
    CHECK (approver_email IS NOT NULL OR approver_phone IS NOT NULL),
  CONSTRAINT sacco_loan_approval_levels_order_uniq UNIQUE (sacco_id, level_no)
);

-- ----------------------------------------------------------------------------
-- 2. PER-LOAN STEPS (snapshot of the chain at submission)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_loan_approval_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  loan_id         UUID NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE,
  level_id        UUID REFERENCES public.sacco_loan_approval_levels(id) ON DELETE SET NULL,
  level_no        INTEGER NOT NULL,
  level_name      TEXT NOT NULL,
  approver_name   TEXT NOT NULL,
  approver_email  TEXT,
  approver_phone  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  comment         TEXT,
  verified_via    TEXT,            -- 'email' | 'sms' — where the confirming OTP went
  decided_at      TIMESTAMPTZ,
  recorded_by     UUID,            -- the logged-in user who entered the code
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sacco_loan_approval_steps_uniq UNIQUE (loan_id, level_no),
  -- A decision is only a decision once it has been OTP-verified and dated.
  CONSTRAINT sacco_loan_approval_steps_decided_chk
    CHECK (status IN ('pending', 'cancelled')
           OR (decided_at IS NOT NULL AND verified_via IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS sacco_loan_approval_steps_loan_idx
  ON public.sacco_loan_approval_steps (loan_id, level_no);
CREATE INDEX IF NOT EXISTS sacco_loan_approval_steps_pending_idx
  ON public.sacco_loan_approval_steps (sacco_id) WHERE status = 'pending';

-- The secret half. RLS on, no policies: only SECURITY DEFINER code reads it.
CREATE TABLE IF NOT EXISTS public.sacco_loan_approval_otps (
  step_id      UUID PRIMARY KEY REFERENCES public.sacco_loan_approval_steps(id) ON DELETE CASCADE,
  otp_hash     TEXT,
  channel      TEXT,
  expires_at   TIMESTAMPTZ,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_count   INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ
);
ALTER TABLE public.sacco_loan_approval_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sacco_loan_approval_otps FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS — staff read; writes only through the functions below
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['sacco_loan_approval_settings', 'sacco_loan_approval_levels',
                       'sacco_loan_approval_steps'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_admin_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_admin_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();', t);

    EXECUTE format('ALTER TABLE public.%1$s ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_read_%1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "tenant_read_%1$s" ON public.%1$s
         FOR SELECT TO authenticated
         USING ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());', t);
    EXECUTE format('REVOKE ALL ON public.%1$s FROM anon;', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%1$s FROM authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%1$s TO authenticated;', t);
  END LOOP;
END $$;

-- Staff of the sacco's own tenant (or a global viewer). Built NULL-safe: the
-- shared sacco_share_require_staff() compares against current_admin_id(),
-- which can be NULL, and `IF NOT (NULL)` does not raise.
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_require_staff(p_sacco_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin   uuid;
  v_allowed boolean;
BEGIN
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Sacco not found'; END IF;
  v_allowed := COALESCE(public.is_global_viewer(), false)
            OR (COALESCE(public.is_staff_member(), false)
                AND COALESCE(v_admin = public.current_admin_id(), false));
  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'Only sacco staff can manage loan approvals';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_require_staff(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. ATTACHING THE CHAIN TO A LOAN
-- ----------------------------------------------------------------------------
-- Internal: create the steps for one loan from the sacco's active levels.
-- Returns how many steps the loan now has. Not granted to any client role.
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_seed_steps(p_loan_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loan  public.sacco_loans%ROWTYPE;
  v_mode  text;
  v_count integer;
BEGIN
  SELECT * INTO v_loan FROM public.sacco_loans WHERE id = p_loan_id;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Loan not found'; END IF;

  SELECT count(*) INTO v_count FROM public.sacco_loan_approval_steps WHERE loan_id = p_loan_id;
  IF v_count > 0 THEN RETURN v_count; END IF;

  INSERT INTO public.sacco_loan_approval_steps
    (admin_id, sacco_id, loan_id, level_id, level_no, level_name,
     approver_name, approver_email, approver_phone)
  SELECT l.admin_id, l.sacco_id, v_loan.id, l.id,
         -- renumber 1..n so "sequential" never waits on a gap
         row_number() OVER (ORDER BY l.level_no)::int,
         l.level_name, l.approver_name, l.approver_email, l.approver_phone
    FROM public.sacco_loan_approval_levels l
   WHERE l.sacco_id = v_loan.sacco_id AND l.is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    SELECT COALESCE(s.mode, 'sequential') INTO v_mode
      FROM (SELECT 1) one
      LEFT JOIN public.sacco_loan_approval_settings s ON s.sacco_id = v_loan.sacco_id;
    UPDATE public.sacco_loans SET approval_mode = v_mode WHERE id = p_loan_id;
  END IF;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_seed_steps(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sacco_loan_approval_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM public.sacco_loan_approval_seed_steps(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_loan_approval_seed ON public.sacco_loans;
CREATE TRIGGER trg_sacco_loan_approval_seed
  AFTER INSERT ON public.sacco_loans
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_approval_on_insert();

-- ----------------------------------------------------------------------------
-- 5. THE GATE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_steps    integer;
  v_open     integer;
  v_levels   integer;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'active') THEN
    SELECT count(*), count(*) FILTER (WHERE status <> 'approved')
      INTO v_steps, v_open
      FROM public.sacco_loan_approval_steps WHERE loan_id = NEW.id;

    IF v_steps > 0 AND v_open > 0 THEN
      RAISE EXCEPTION 'This loan has % approval level(s) still to sign off. Complete the approval workflow first.', v_open
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_steps = 0 THEN
      SELECT count(*) INTO v_levels FROM public.sacco_loan_approval_levels
       WHERE sacco_id = NEW.sacco_id AND is_active;
      IF v_levels > 0 THEN
        RAISE EXCEPTION 'This sacco requires loan approvals. Start the approval workflow for this loan first.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_loan_approval_gate ON public.sacco_loans;
CREATE TRIGGER trg_sacco_loan_approval_gate
  BEFORE UPDATE OF status ON public.sacco_loans
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_approval_gate();

-- A loan rejected (or closed) by any route leaves no step waiting on anyone.
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_on_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('rejected', 'closed') THEN
    UPDATE public.sacco_loan_approval_steps
       SET status = 'cancelled'
     WHERE loan_id = NEW.id AND status = 'pending';
    DELETE FROM public.sacco_loan_approval_otps o
     USING public.sacco_loan_approval_steps s
     WHERE o.step_id = s.id AND s.loan_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sacco_loan_approval_status ON public.sacco_loans;
CREATE TRIGGER trg_sacco_loan_approval_status
  AFTER UPDATE OF status ON public.sacco_loans
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_approval_on_status();

-- ----------------------------------------------------------------------------
-- 6. SAVING THE CONFIGURATION
--    p_levels: [{ level_name, approver_name, approver_email, approver_phone }]
--    in approval order. The list replaces the sacco's levels wholesale.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_save_config(
  p_sacco_id uuid,
  p_mode     text,
  p_levels   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin  uuid;
  v_lvl    jsonb;
  v_i      integer := 0;
  v_name   text;
  v_appr   text;
  v_email  text;
  v_phone  text;
BEGIN
  PERFORM public.sacco_loan_approval_require_staff(p_sacco_id);
  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;

  IF p_mode NOT IN ('sequential', 'parallel') THEN
    RAISE EXCEPTION 'Approval mode must be sequential or parallel';
  END IF;
  IF p_levels IS NULL OR jsonb_typeof(p_levels) <> 'array' THEN
    RAISE EXCEPTION 'Levels must be a list';
  END IF;
  IF jsonb_array_length(p_levels) > 10 THEN
    RAISE EXCEPTION 'At most 10 approval levels are supported';
  END IF;

  DELETE FROM public.sacco_loan_approval_levels WHERE sacco_id = p_sacco_id;

  FOR v_lvl IN SELECT * FROM jsonb_array_elements(p_levels) LOOP
    v_i     := v_i + 1;
    v_name  := NULLIF(trim(COALESCE(v_lvl->>'level_name', '')), '');
    v_appr  := NULLIF(trim(COALESCE(v_lvl->>'approver_name', '')), '');
    v_email := NULLIF(lower(trim(COALESCE(v_lvl->>'approver_email', ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(v_lvl->>'approver_phone', ''), '[^0-9+]', '', 'g'), '');

    IF v_name IS NULL THEN RAISE EXCEPTION 'Level % needs a name', v_i; END IF;
    IF v_appr IS NULL THEN RAISE EXCEPTION 'Level % (%) needs an approver name', v_i, v_name; END IF;
    IF v_email IS NULL AND v_phone IS NULL THEN
      RAISE EXCEPTION 'Level % (%) needs an email or phone so the approver can receive the OTP', v_i, v_name;
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Level % (%): "%" is not a valid email', v_i, v_name, v_email;
    END IF;
    IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) < 9 THEN
      RAISE EXCEPTION 'Level % (%): "%" is not a valid phone number', v_i, v_name, v_phone;
    END IF;

    INSERT INTO public.sacco_loan_approval_levels
      (admin_id, sacco_id, level_no, level_name, approver_name, approver_email, approver_phone)
    VALUES (v_admin, p_sacco_id, v_i, v_name, v_appr, v_email, v_phone);
  END LOOP;

  INSERT INTO public.sacco_loan_approval_settings (admin_id, sacco_id, mode, updated_by, updated_at)
  VALUES (v_admin, p_sacco_id, p_mode, auth.uid(), now())
  ON CONFLICT (sacco_id) DO UPDATE
    SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = now();

  RETURN jsonb_build_object('mode', p_mode, 'levels', v_i);
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_save_config(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_save_config(uuid, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. STARTING THE WORKFLOW FOR A LOAN THAT PRE-DATES THE CONFIGURATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_start(p_loan_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loan  public.sacco_loans%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_loan FROM public.sacco_loans WHERE id = p_loan_id FOR UPDATE;
  IF v_loan.id IS NULL THEN RAISE EXCEPTION 'Loan not found'; END IF;
  PERFORM public.sacco_loan_approval_require_staff(v_loan.sacco_id);
  IF v_loan.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending loan can enter the approval workflow';
  END IF;

  v_count := public.sacco_loan_approval_seed_steps(p_loan_id);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No approval levels are configured for this sacco';
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_start(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. WHOSE TURN IS IT
-- ----------------------------------------------------------------------------
-- Raises unless this step may be decided right now. Shared by the OTP send
-- (via sacco_loan_approval_otp_context) and by decide().
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_assert_actionable(p_step_id uuid)
RETURNS public.sacco_loan_approval_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step    public.sacco_loan_approval_steps%ROWTYPE;
  v_loan    public.sacco_loans%ROWTYPE;
  v_blocker text;
BEGIN
  SELECT * INTO v_step FROM public.sacco_loan_approval_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RAISE EXCEPTION 'Approval step not found'; END IF;
  PERFORM public.sacco_loan_approval_require_staff(v_step.sacco_id);

  SELECT * INTO v_loan FROM public.sacco_loans WHERE id = v_step.loan_id;
  IF v_loan.status <> 'pending' THEN
    RAISE EXCEPTION 'This loan is % and is no longer awaiting approval', v_loan.status;
  END IF;
  IF v_step.status <> 'pending' THEN
    RAISE EXCEPTION 'This level has already been %', v_step.status;
  END IF;

  IF COALESCE(v_loan.approval_mode, 'sequential') = 'sequential' THEN
    SELECT level_name INTO v_blocker
      FROM public.sacco_loan_approval_steps
     WHERE loan_id = v_step.loan_id AND level_no < v_step.level_no AND status <> 'approved'
     ORDER BY level_no LIMIT 1;
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION 'Sequential approval: "%" must approve before "%"', v_blocker, v_step.level_name;
    END IF;
  END IF;

  RETURN v_step;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_assert_actionable(uuid) FROM PUBLIC, anon, authenticated;

-- What the OTP function needs to address the code. Called with the STAFF
-- user's JWT, so the tenant and turn checks above run as that user.
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_otp_context(p_step_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_step  public.sacco_loan_approval_steps%ROWTYPE;
  v_ctx   jsonb;
BEGIN
  v_step := public.sacco_loan_approval_assert_actionable(p_step_id);

  SELECT jsonb_build_object(
           'step_id',        v_step.id,
           'level_name',     v_step.level_name,
           'approver_name',  v_step.approver_name,
           'approver_email', v_step.approver_email,
           'approver_phone', v_step.approver_phone,
           'principal',      l.principal,
           'member_name',    m.full_name,
           'sacco_name',     s.name)
    INTO v_ctx
    FROM public.sacco_loans l
    LEFT JOIN public.sacco_members m ON m.id = l.member_id
    LEFT JOIN public.saccos s        ON s.id = l.sacco_id
   WHERE l.id = v_step.loan_id;

  RETURN v_ctx;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_otp_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_otp_context(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. STORING A CODE — service role only (the Edge Function)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_store_otp(
  p_step_id uuid,
  p_hash    text,
  p_channel text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sent integer;
BEGIN
  SELECT sent_count INTO v_sent FROM public.sacco_loan_approval_otps
   WHERE step_id = p_step_id FOR UPDATE;

  -- 10 codes × 5 guesses each caps total guesses per step at 50 in 900,000.
  IF COALESCE(v_sent, 0) >= 10 THEN
    RAISE EXCEPTION 'Too many codes have been requested for this level'
      USING ERRCODE = 'P0001', HINT = 'otp_send_cap';
  END IF;

  INSERT INTO public.sacco_loan_approval_otps
    (step_id, otp_hash, channel, expires_at, attempts, sent_count, last_sent_at)
  VALUES (p_step_id, p_hash, p_channel, now() + interval '10 minutes', 0, 1, now())
  ON CONFLICT (step_id) DO UPDATE
    SET otp_hash = EXCLUDED.otp_hash, channel = EXCLUDED.channel,
        expires_at = EXCLUDED.expires_at, attempts = 0,
        sent_count = public.sacco_loan_approval_otps.sent_count + 1,
        last_sent_at = now()
  RETURNING sent_count INTO v_sent;

  RETURN v_sent;
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_store_otp(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_store_otp(uuid, text, text) TO service_role;

-- Burn a code that could not be delivered (the send count stays spent).
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_clear_otp(p_step_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.sacco_loan_approval_otps
     SET otp_hash = NULL, expires_at = NULL
   WHERE step_id = p_step_id;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_clear_otp(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_clear_otp(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 10. THE DECISION
--     Returns { ok, error?, attempts_left?, step_status?, loan_status? }.
--     A wrong code RETURNS rather than raises, so the attempt counter that
--     was just incremented is committed — raising would roll it back and
--     make the guess free.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_approval_decide(
  p_step_id  uuid,
  p_code     text,
  p_decision text,
  p_comment  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_step     public.sacco_loan_approval_steps%ROWTYPE;
  v_otp      public.sacco_loan_approval_otps%ROWTYPE;
  v_loan_id  uuid;
  v_code     text := regexp_replace(COALESCE(p_code, ''), '\D', '', 'g');
  v_comment  text := NULLIF(trim(COALESCE(p_comment, '')), '');
  v_open     integer;
  v_loan_st  text;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;
  IF p_decision = 'rejected' AND v_comment IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the loan';
  END IF;

  -- Lock the loan first so two parallel approvers finishing together cannot
  -- both miss (or both perform) the final transition.
  SELECT loan_id INTO v_loan_id FROM public.sacco_loan_approval_steps WHERE id = p_step_id;
  IF v_loan_id IS NULL THEN RAISE EXCEPTION 'Approval step not found'; END IF;
  PERFORM 1 FROM public.sacco_loans WHERE id = v_loan_id FOR UPDATE;
  PERFORM 1 FROM public.sacco_loan_approval_steps WHERE id = p_step_id FOR UPDATE;

  v_step := public.sacco_loan_approval_assert_actionable(p_step_id);

  SELECT * INTO v_otp FROM public.sacco_loan_approval_otps WHERE step_id = p_step_id FOR UPDATE;
  IF v_otp.otp_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Send a verification code to the approver first.');
  END IF;
  IF v_otp.expires_at < now() THEN
    UPDATE public.sacco_loan_approval_otps SET otp_hash = NULL, expires_at = NULL WHERE step_id = p_step_id;
    RETURN jsonb_build_object('ok', false, 'error', 'The code has expired. Send a new one.');
  END IF;

  UPDATE public.sacco_loan_approval_otps SET attempts = attempts + 1
   WHERE step_id = p_step_id RETURNING attempts INTO v_otp.attempts;

  IF v_otp.attempts > 5 THEN
    UPDATE public.sacco_loan_approval_otps SET otp_hash = NULL, expires_at = NULL WHERE step_id = p_step_id;
    RETURN jsonb_build_object('ok', false, 'error', 'Too many wrong codes. Send a new one.');
  END IF;

  IF length(v_code) <> 6
     OR encode(digest(p_step_id::text || ':' || v_code, 'sha256'), 'hex') <> v_otp.otp_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That code is not correct.',
                              'attempts_left', GREATEST(5 - v_otp.attempts, 0));
  END IF;

  -- Verified. The code is single-use.
  DELETE FROM public.sacco_loan_approval_otps WHERE step_id = p_step_id;

  UPDATE public.sacco_loan_approval_steps
     SET status = p_decision, comment = v_comment, verified_via = v_otp.channel,
         decided_at = now(), recorded_by = auth.uid()
   WHERE id = p_step_id;

  IF p_decision = 'rejected' THEN
    -- The status trigger cancels the remaining steps.
    UPDATE public.sacco_loans SET status = 'rejected', updated_at = now() WHERE id = v_loan_id;
  ELSE
    SELECT count(*) INTO v_open FROM public.sacco_loan_approval_steps
     WHERE loan_id = v_loan_id AND status <> 'approved';
    IF v_open = 0 THEN
      UPDATE public.sacco_loans
         SET status = 'approved', approved_by = auth.uid(), updated_at = now()
       WHERE id = v_loan_id;
    END IF;
  END IF;

  SELECT status::text INTO v_loan_st FROM public.sacco_loans WHERE id = v_loan_id;
  RETURN jsonb_build_object('ok', true, 'step_status', p_decision, 'loan_status', v_loan_st);
END;
$$;
REVOKE ALL ON FUNCTION public.sacco_loan_approval_decide(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_approval_decide(uuid, text, text, text) TO authenticated;

COMMENT ON TABLE public.sacco_loan_approval_levels IS
  'Per-sacco loan approval chain: ordered levels, each with a named approver who receives the OTP.';
COMMENT ON TABLE public.sacco_loan_approval_steps IS
  'One row per level per loan, snapshotted when the loan enters approval. Written only by SECURITY DEFINER functions.';

-- New tables and RPCs are invisible to PostgREST until its schema cache reloads.
NOTIFY pgrst, 'reload schema';
