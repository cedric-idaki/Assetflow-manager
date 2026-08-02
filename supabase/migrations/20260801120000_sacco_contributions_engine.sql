-- ============================================================================
-- SACCO CONTRIBUTIONS ENGINE
-- ----------------------------------------------------------------------------
-- Turns the thin `sacco_contributions` savings ledger into a real collections
-- system: member self-service payment, a receipt number on every entry, the
-- officer who took the money, approve / edit / reverse with a full audit trail,
-- and the derived figures (expected, outstanding, missed months) that a sacco
-- actually runs on.
--
-- Design decisions worth knowing:
--
--  * STATUS became TEXT.  The old enum was (pending | paid | overdue | waived)
--    and could not express failed or reversed. `ALTER TYPE ... ADD VALUE` may
--    not be used in the same transaction that then writes the new value, which
--    makes it useless inside a migration, so the column is converted to TEXT
--    with a CHECK. 'paid' is migrated to 'completed'; the frontend treats both
--    as settled so a partially-migrated environment still totals correctly.
--
--  * MONEY IS NEVER EDITED IN PLACE once settled.  A completed contribution can
--    only be corrected by reversing it (which writes a `reversed` marker and
--    keeps the original row) — the same rule the journal engine already uses.
--    Pending rows are still freely editable, because nothing has been counted.
--
--  * THE OBLIGATION IS MONTHLY, the CADENCE is free.  `monthly_contribution` is
--    what the member owes per month; weekly / daily / one-off are just ways of
--    paying it. Expected-to-date is therefore months-elapsed × monthly amount,
--    regardless of how many individual payments made it up.
--
--  * MEMBERS WRITE THROUGH AN RPC, never directly.  There is deliberately no
--    member INSERT policy on sacco_contributions: a member who could insert
--    rows could insert a completed one. sacco_member_submit_contribution() is
--    the only door, and it hard-codes status='pending'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MEMBER: the contribution profile set at registration
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_members
  ADD COLUMN IF NOT EXISTS monthly_contribution     DECIMAL(15,2) DEFAULT 0,
  -- How the member prefers to pay it. Display/scheduling only — the amount owed
  -- is always the monthly figure above.
  ADD COLUMN IF NOT EXISTS contribution_frequency   TEXT DEFAULT 'monthly',
  -- When the obligation starts running. Defaults to the registration date.
  ADD COLUMN IF NOT EXISTS contribution_start_date  DATE,
  -- The two member accounts every sacco keeps. Derived from member_no so they
  -- are stable, searchable and recognisable on a statement.
  ADD COLUMN IF NOT EXISTS share_capital_account_no TEXT,
  ADD COLUMN IF NOT EXISTS deposit_account_no       TEXT;

DO $$ BEGIN
  ALTER TABLE public.sacco_members
    ADD CONSTRAINT sacco_members_contribution_frequency_check
    CHECK (contribution_frequency IN ('monthly', 'weekly', 'daily'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Assign the two account numbers and the start date. Runs on insert and on any
-- update that changes member_no, so a renumbered member keeps consistent
-- accounts rather than silently drifting from their statement history.
CREATE OR REPLACE FUNCTION public.sacco_member_accounts_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := upper(regexp_replace(COALESCE(NULLIF(trim(NEW.member_no), ''),
                                         left(NEW.id::text, 8)), '\s+', '', 'g'));

  IF NEW.share_capital_account_no IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.member_no IS DISTINCT FROM OLD.member_no) THEN
    NEW.share_capital_account_no := v_key || '-SC';
  END IF;

  IF NEW.deposit_account_no IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.member_no IS DISTINCT FROM OLD.member_no) THEN
    NEW.deposit_account_no := v_key || '-DEP';
  END IF;

  IF NEW.contribution_start_date IS NULL THEN
    NEW.contribution_start_date := COALESCE(NEW.joined_at, CURRENT_DATE);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_member_accounts_default_trg ON public.sacco_members;
CREATE TRIGGER sacco_member_accounts_default_trg
  BEFORE INSERT OR UPDATE ON public.sacco_members
  FOR EACH ROW EXECUTE FUNCTION public.sacco_member_accounts_default();

-- Backfill everyone who registered before this migration.
UPDATE public.sacco_members
   SET share_capital_account_no = upper(regexp_replace(COALESCE(NULLIF(trim(member_no), ''), left(id::text, 8)), '\s+', '', 'g')) || '-SC',
       deposit_account_no       = upper(regexp_replace(COALESCE(NULLIF(trim(member_no), ''), left(id::text, 8)), '\s+', '', 'g')) || '-DEP',
       contribution_start_date  = COALESCE(contribution_start_date, joined_at, created_at::date)
 WHERE share_capital_account_no IS NULL
    OR deposit_account_no IS NULL
    OR contribution_start_date IS NULL;

-- A member editing their own profile must not be able to raise or lower what
-- they owe, or rewrite their account numbers. Re-declared from
-- 20260708130000_sacco_member_portal.sql with the new columns pinned.
CREATE OR REPLACE FUNCTION public.sacco_member_protect_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.user_id = auth.uid()
     AND NOT public.is_staff_member() THEN
    NEW.member_no   := OLD.member_no;
    NEW.member_role := OLD.member_role;
    NEW.status      := OLD.status;
    NEW.kyc_status  := OLD.kyc_status;
    NEW.sacco_id    := OLD.sacco_id;
    NEW.admin_id    := OLD.admin_id;
    NEW.user_id     := OLD.user_id;
    NEW.joined_at   := OLD.joined_at;
    -- Contribution profile: set by the sacco at registration, never self-served.
    NEW.monthly_contribution     := OLD.monthly_contribution;
    NEW.contribution_start_date  := OLD.contribution_start_date;
    NEW.share_capital_account_no := OLD.share_capital_account_no;
    NEW.deposit_account_no       := OLD.deposit_account_no;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. CONTRIBUTION: everything a receipt has to carry
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_contributions
  -- Unique, human-quotable receipt number. Assigned by trigger, never by a client.
  ADD COLUMN IF NOT EXISTS txn_no            TEXT,
  -- Date AND time of payment. `paid_date` stays as the accounting date the rest
  -- of the app (GL posting, statements) already reads.
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method    TEXT DEFAULT 'cash',
  -- Which member account this credits.
  ADD COLUMN IF NOT EXISTS account           TEXT DEFAULT 'deposits',
  -- The officer who received the money (user_profiles.id) + a name snapshot, so
  -- a deleted staff account does not erase who took the cash.
  ADD COLUMN IF NOT EXISTS received_by       UUID,
  ADD COLUMN IF NOT EXISTS received_by_name  TEXT,
  -- How the row got here: admin capture, member self-service, or M-Pesa auto-match.
  ADD COLUMN IF NOT EXISTS channel           TEXT DEFAULT 'admin',
  -- The month this payment is credited to. Drives "this month" and missed months.
  ADD COLUMN IF NOT EXISTS period_month      DATE,
  ADD COLUMN IF NOT EXISTS submitted_by      UUID,
  ADD COLUMN IF NOT EXISTS mpesa_transaction_id UUID,
  ADD COLUMN IF NOT EXISTS approved_by       UUID,
  ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by       UUID,
  ADD COLUMN IF NOT EXISTS reversed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason   TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason    TEXT;

-- ── status: enum -> text ────────────────────────────────────────────────────
-- The enum is used by this column and nothing else (verified against every
-- migration), so the conversion is local.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sacco_contributions'
      AND column_name = 'status' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE public.sacco_contributions ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.sacco_contributions ALTER COLUMN status TYPE TEXT USING status::text;
    ALTER TABLE public.sacco_contributions ALTER COLUMN status SET DEFAULT 'pending';
  END IF;
END $$;

UPDATE public.sacco_contributions SET status = 'completed' WHERE status = 'paid';

ALTER TABLE public.sacco_contributions DROP CONSTRAINT IF EXISTS sacco_contributions_status_check;
ALTER TABLE public.sacco_contributions
  ADD CONSTRAINT sacco_contributions_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'reversed', 'overdue', 'waived'));

ALTER TABLE public.sacco_contributions DROP CONSTRAINT IF EXISTS sacco_contributions_payment_method_check;
ALTER TABLE public.sacco_contributions
  ADD CONSTRAINT sacco_contributions_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('cash', 'bank', 'mpesa', 'card', 'cheque', 'other'));

ALTER TABLE public.sacco_contributions DROP CONSTRAINT IF EXISTS sacco_contributions_account_check;
ALTER TABLE public.sacco_contributions
  ADD CONSTRAINT sacco_contributions_account_check
  CHECK (account IS NULL OR account IN ('deposits', 'share_capital', 'other'));

ALTER TABLE public.sacco_contributions DROP CONSTRAINT IF EXISTS sacco_contributions_channel_check;
ALTER TABLE public.sacco_contributions
  ADD CONSTRAINT sacco_contributions_channel_check
  CHECK (channel IS NULL OR channel IN ('admin', 'member_portal', 'mpesa_auto', 'import'));

-- ── receipt numbers ─────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.sacco_contribution_txn_seq;

CREATE OR REPLACE FUNCTION public.sacco_contribution_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settled boolean;
BEGIN
  IF NEW.txn_no IS NULL OR trim(NEW.txn_no) = '' THEN
    NEW.txn_no := 'CTR-' || lpad(nextval('public.sacco_contribution_txn_seq')::text, 8, '0');
  END IF;

  v_settled := NEW.status = 'completed';

  -- Time of payment. A settled row always has one; a pending row gets one only
  -- once it settles, so "pending since" stays readable from created_at.
  IF v_settled AND NEW.paid_at IS NULL THEN
    NEW.paid_at := COALESCE(NEW.paid_date::timestamptz, now());
  END IF;

  -- Keep the accounting date the GL engine reads in step with paid_at.
  IF v_settled AND NEW.paid_date IS NULL THEN
    NEW.paid_date := COALESCE(NEW.paid_at, now())::date;
  END IF;

  IF NEW.period_month IS NULL THEN
    NEW.period_month := date_trunc('month',
      COALESCE(NEW.paid_date, NEW.due_date, COALESCE(NEW.paid_at, now())::date))::date;
  END IF;

  -- Whoever is signed in took the money, unless a specific officer was named.
  IF NEW.received_by IS NULL AND v_settled AND public.is_staff_member() THEN
    NEW.received_by := auth.uid();
  END IF;

  IF NEW.received_by IS NOT NULL AND (NEW.received_by_name IS NULL OR trim(NEW.received_by_name) = '') THEN
    SELECT up.full_name INTO NEW.received_by_name
      FROM public.user_profiles up WHERE up.id = NEW.received_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_contribution_defaults_trg ON public.sacco_contributions;
CREATE TRIGGER sacco_contribution_defaults_trg
  BEFORE INSERT OR UPDATE ON public.sacco_contributions
  FOR EACH ROW EXECUTE FUNCTION public.sacco_contribution_defaults();

-- Backfill rows that pre-date the trigger.
UPDATE public.sacco_contributions
   SET txn_no = 'CTR-' || lpad(nextval('public.sacco_contribution_txn_seq')::text, 8, '0')
 WHERE txn_no IS NULL;

UPDATE public.sacco_contributions
   SET paid_at      = COALESCE(paid_at, paid_date::timestamptz, created_at),
       period_month = COALESCE(period_month,
                        date_trunc('month', COALESCE(paid_date, due_date, created_at::date))::date),
       payment_method = COALESCE(payment_method, 'cash'),
       account        = COALESCE(account, 'deposits'),
       channel        = COALESCE(channel, 'admin')
 WHERE period_month IS NULL OR payment_method IS NULL OR account IS NULL OR channel IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_contrib_txn_no
  ON public.sacco_contributions(txn_no);

-- M-Pesa receipts are globally unique at Safaricom, so the same code arriving
-- twice for a tenant is a duplicate, not a second payment. This is the hard
-- guard behind requirement 8 ("prevent duplicate transactions") — the callback
-- relies on the database rejecting it rather than on its own bookkeeping.
DO $$
BEGIN
  CREATE UNIQUE INDEX idx_sacco_contrib_mpesa_receipt
    ON public.sacco_contributions(admin_id, upper(reference))
    WHERE payment_method = 'mpesa' AND reference IS NOT NULL AND reference <> '';
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN
    RAISE WARNING 'Duplicate M-Pesa references already exist in sacco_contributions; '
                  'the duplicate guard was NOT created. Clean them up, then re-run this index.';
END $$;

CREATE INDEX IF NOT EXISTS idx_sacco_contrib_status       ON public.sacco_contributions(status);
CREATE INDEX IF NOT EXISTS idx_sacco_contrib_period_month ON public.sacco_contributions(period_month);
CREATE INDEX IF NOT EXISTS idx_sacco_contrib_paid_at      ON public.sacco_contributions(paid_at);
CREATE INDEX IF NOT EXISTS idx_sacco_contrib_method       ON public.sacco_contributions(payment_method);

-- ----------------------------------------------------------------------------
-- 3. AUDIT LOG (requirement 9)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_contribution_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID,
  -- Deliberately NOT a cascading FK: deleting a contribution must not delete
  -- the record that it was deleted.
  contribution_id UUID,
  txn_no          TEXT,
  member_id       UUID,
  action          TEXT NOT NULL,          -- created | updated | approved | reversed | failed | deleted
  actor_id        UUID,
  actor_name      TEXT,
  actor_role      TEXT,
  old_values      JSONB,
  new_values      JSONB,
  changed_fields  TEXT[],
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_contrib_audit_admin  ON public.sacco_contribution_audit(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_contrib_audit_contrib ON public.sacco_contribution_audit(contribution_id);
CREATE INDEX IF NOT EXISTS idx_sacco_contrib_audit_created ON public.sacco_contribution_audit(created_at DESC);

-- The columns worth logging. Timestamps that merely echo a status change are
-- left out so a reversal reads as one meaningful change, not eight.
CREATE OR REPLACE FUNCTION public.sacco_contribution_audit_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action  text;
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[] := '{}';
  v_key     text;
  v_actor   uuid := auth.uid();
  v_name    text;
  v_role    text;
  v_tracked text[] := ARRAY[
    'amount', 'status', 'contribution_type', 'account', 'payment_method',
    'reference', 'due_date', 'paid_date', 'paid_at', 'period_month',
    'penalty_amount', 'notes', 'received_by', 'received_by_name', 'member_id'
  ];
BEGIN
  SELECT up.full_name, up.role::text INTO v_name, v_role
    FROM public.user_profiles up WHERE up.id = v_actor;

  -- Service-role writes (the M-Pesa callback) have no auth.uid(). Name them so
  -- the log never shows a blank actor next to a money movement.
  IF v_actor IS NULL THEN
    v_name := COALESCE(v_name, 'System');
    v_role := COALESCE(v_role, 'system');
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_old := to_jsonb(OLD);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOREACH v_key IN ARRAY v_tracked LOOP
      IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_changed := array_append(v_changed, v_key);
      END IF;
    END LOOP;
    -- Nothing a human would recognise as a change.
    IF array_length(v_changed, 1) IS NULL THEN RETURN NULL; END IF;

    v_action := CASE
      WHEN NEW.status = 'reversed'  AND OLD.status <> 'reversed'  THEN 'reversed'
      WHEN NEW.status = 'completed' AND OLD.status =  'pending'   THEN 'approved'
      WHEN NEW.status = 'failed'    AND OLD.status <> 'failed'    THEN 'failed'
      ELSE 'updated'
    END;

    -- Log only the fields that moved, not the whole row.
    v_old := (SELECT jsonb_object_agg(k, v_old -> k) FROM unnest(v_changed) k);
    v_new := (SELECT jsonb_object_agg(k, v_new -> k) FROM unnest(v_changed) k);
  END IF;

  INSERT INTO public.sacco_contribution_audit
    (admin_id, sacco_id, contribution_id, txn_no, member_id, action,
     actor_id, actor_name, actor_role, old_values, new_values, changed_fields, reason)
  VALUES (
    COALESCE(NEW.admin_id, OLD.admin_id),
    COALESCE(NEW.sacco_id, OLD.sacco_id),
    COALESCE(NEW.id, OLD.id),
    COALESCE(NEW.txn_no, OLD.txn_no),
    COALESCE(NEW.member_id, OLD.member_id),
    v_action, v_actor, v_name, v_role, v_old, v_new,
    NULLIF(v_changed, '{}'),
    CASE WHEN TG_OP = 'UPDATE' AND NEW.status = 'reversed' THEN NEW.reversal_reason
         WHEN TG_OP = 'UPDATE' AND NEW.status = 'failed'   THEN NEW.failure_reason
         ELSE NULL END
  );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sacco_contribution_audit_ins ON public.sacco_contributions;
CREATE TRIGGER sacco_contribution_audit_ins
  AFTER INSERT OR UPDATE OR DELETE ON public.sacco_contributions
  FOR EACH ROW EXECUTE FUNCTION public.sacco_contribution_audit_trg();

ALTER TABLE public.sacco_contribution_audit ENABLE ROW LEVEL SECURITY;

-- Append-only from the application's point of view: rows arrive through the
-- SECURITY DEFINER trigger, and nobody gets UPDATE or DELETE.
DROP POLICY IF EXISTS tenant_read_contribution_audit ON public.sacco_contribution_audit;
CREATE POLICY tenant_read_contribution_audit ON public.sacco_contribution_audit
  FOR SELECT TO authenticated
  USING (
    (admin_id = public.current_admin_id() AND public.is_staff_member())
    OR public.is_global_viewer()
    -- A member can see the history of their own money.
    OR member_id = public.current_sacco_member_id()
  );

-- ----------------------------------------------------------------------------
-- 4. MEMBER SELF-SERVICE (requirement 2)
-- ----------------------------------------------------------------------------
-- The only write path a member has. Always lands as 'pending' — cash, bank and
-- card declarations wait for the treasurer to confirm the money arrived, and
-- M-Pesa rows are completed by the callback, never by the payer's browser.
CREATE OR REPLACE FUNCTION public.sacco_member_submit_contribution(
  p_amount            numeric,
  p_contribution_type text    DEFAULT 'monthly',
  p_account           text    DEFAULT 'deposits',
  p_payment_method    text    DEFAULT 'mpesa',
  p_reference         text    DEFAULT NULL,
  p_notes             text    DEFAULT NULL,
  p_period_month      date    DEFAULT NULL
)
RETURNS public.sacco_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member public.sacco_members%ROWTYPE;
  v_row    public.sacco_contributions%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.sacco_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'No member record is linked to this login';
  END IF;
  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Your membership is % — contributions are not accepted', v_member.status;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_payment_method NOT IN ('cash', 'bank', 'mpesa', 'card', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method %', p_payment_method;
  END IF;
  IF p_account NOT IN ('deposits', 'share_capital', 'other') THEN
    RAISE EXCEPTION 'Unsupported account %', p_account;
  END IF;

  INSERT INTO public.sacco_contributions
    (admin_id, sacco_id, member_id, amount, contribution_type, account,
     payment_method, reference, notes, status, channel, submitted_by,
     period_month, due_date)
  VALUES
    (v_member.admin_id, v_member.sacco_id, v_member.id,
     round(p_amount, 2), COALESCE(NULLIF(trim(p_contribution_type), ''), 'monthly'),
     p_account, p_payment_method, NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''),
     'pending', 'member_portal', auth.uid(),
     COALESCE(p_period_month, date_trunc('month', CURRENT_DATE)::date),
     CURRENT_DATE)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_member_submit_contribution(numeric, text, text, text, text, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_member_submit_contribution(numeric, text, text, text, text, text, date)
  TO authenticated;

-- A member may withdraw a declaration they made in error, while it is still
-- pending and nothing has been counted.
CREATE OR REPLACE FUNCTION public.sacco_member_cancel_contribution(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.sacco_contributions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.sacco_contributions WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contribution not found'; END IF;
  IF v_row.member_id IS DISTINCT FROM public.current_sacco_member_id() THEN
    RAISE EXCEPTION 'Not your contribution';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending contribution can be withdrawn';
  END IF;

  UPDATE public.sacco_contributions
     SET status = 'failed',
         failure_reason = 'Withdrawn by the member',
         updated_at = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_member_cancel_contribution(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_member_cancel_contribution(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. ADMIN ACTIONS (requirement 6)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_approve_contribution(
  p_id             uuid,
  p_paid_at        timestamptz DEFAULT NULL,
  p_payment_method text        DEFAULT NULL,
  p_reference      text        DEFAULT NULL
)
RETURNS public.sacco_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.sacco_contributions%ROWTYPE;
  v_at  timestamptz := COALESCE(p_paid_at, now());
BEGIN
  SELECT * INTO v_row FROM public.sacco_contributions WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contribution not found'; END IF;
  IF NOT (public.is_staff_member() AND (v_row.admin_id = public.current_admin_id() OR public.is_global_viewer())) THEN
    RAISE EXCEPTION 'Only sacco staff can approve contributions';
  END IF;
  IF v_row.status NOT IN ('pending', 'overdue') THEN
    RAISE EXCEPTION 'Contribution % is already %', v_row.txn_no, v_row.status;
  END IF;

  UPDATE public.sacco_contributions
     SET status         = 'completed',
         paid_at        = v_at,
         paid_date      = v_at::date,
         payment_method = COALESCE(NULLIF(trim(p_payment_method), ''), payment_method),
         reference      = COALESCE(NULLIF(trim(p_reference), ''), reference),
         received_by    = COALESCE(received_by, auth.uid()),
         approved_by    = auth.uid(),
         approved_at    = now(),
         updated_at     = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_approve_contribution(uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_approve_contribution(uuid, timestamptz, text, text) TO authenticated;

-- Reversal, not deletion. The original row stays exactly as it was recorded and
-- is flipped to 'reversed'; the audit trigger captures who, when and why.
CREATE OR REPLACE FUNCTION public.sacco_reverse_contribution(
  p_id     uuid,
  p_reason text
)
RETURNS public.sacco_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.sacco_contributions%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reversal needs a reason';
  END IF;

  SELECT * INTO v_row FROM public.sacco_contributions WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contribution not found'; END IF;
  IF NOT (public.is_staff_member() AND (v_row.admin_id = public.current_admin_id() OR public.is_global_viewer())) THEN
    RAISE EXCEPTION 'Only sacco staff can reverse contributions';
  END IF;
  IF v_row.status = 'reversed' THEN
    RAISE EXCEPTION 'Contribution % is already reversed', v_row.txn_no;
  END IF;

  UPDATE public.sacco_contributions
     SET status          = 'reversed',
         reversed_by     = auth.uid(),
         reversed_at     = now(),
         reversal_reason = trim(p_reason),
         updated_at      = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_reverse_contribution(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_reverse_contribution(uuid, text) TO authenticated;

-- Correcting a mis-keyed entry. Settled money is immutable — once a
-- contribution is completed the only correction is a reversal, so this refuses
-- to touch anything that is not still pending.
CREATE OR REPLACE FUNCTION public.sacco_edit_contribution(
  p_id      uuid,
  p_patch   jsonb
)
RETURNS public.sacco_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.sacco_contributions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.sacco_contributions WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contribution not found'; END IF;
  IF NOT (public.is_staff_member() AND (v_row.admin_id = public.current_admin_id() OR public.is_global_viewer())) THEN
    RAISE EXCEPTION 'Only sacco staff can edit contributions';
  END IF;
  IF v_row.status NOT IN ('pending', 'overdue', 'waived') THEN
    RAISE EXCEPTION
      'Contribution % is % and cannot be edited. Reverse it and record a corrected entry.',
      v_row.txn_no, v_row.status;
  END IF;

  UPDATE public.sacco_contributions SET
    amount            = COALESCE((p_patch ->> 'amount')::numeric, amount),
    member_id         = COALESCE(NULLIF(p_patch ->> 'member_id', '')::uuid, member_id),
    contribution_type = COALESCE(NULLIF(p_patch ->> 'contribution_type', ''), contribution_type),
    account           = COALESCE(NULLIF(p_patch ->> 'account', ''), account),
    payment_method    = COALESCE(NULLIF(p_patch ->> 'payment_method', ''), payment_method),
    reference         = CASE WHEN p_patch ? 'reference' THEN NULLIF(p_patch ->> 'reference', '') ELSE reference END,
    notes             = CASE WHEN p_patch ? 'notes'     THEN NULLIF(p_patch ->> 'notes', '')     ELSE notes END,
    due_date          = CASE WHEN p_patch ? 'due_date'  THEN NULLIF(p_patch ->> 'due_date', '')::date ELSE due_date END,
    paid_date         = CASE WHEN p_patch ? 'paid_date' THEN NULLIF(p_patch ->> 'paid_date', '')::date ELSE paid_date END,
    period_month      = COALESCE(NULLIF(p_patch ->> 'period_month', '')::date, period_month),
    penalty_amount    = COALESCE((p_patch ->> 'penalty_amount')::numeric, penalty_amount),
    received_by       = COALESCE(NULLIF(p_patch ->> 'received_by', '')::uuid, received_by),
    updated_at        = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_edit_contribution(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_edit_contribution(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. DERIVED FIGURES (requirement 4) — one source of truth, used by both portals
-- ----------------------------------------------------------------------------
-- Months between two dates, counting both endpoints' months.
CREATE OR REPLACE FUNCTION public.sacco_months_inclusive(p_from date, p_to date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    0,
    ( (EXTRACT(YEAR FROM p_to)::int * 12 + EXTRACT(MONTH FROM p_to)::int)
    - (EXTRACT(YEAR FROM p_from)::int * 12 + EXTRACT(MONTH FROM p_from)::int) ) + 1
  );
$$;

CREATE OR REPLACE FUNCTION public.sacco_member_contribution_stats(
  p_member_id uuid DEFAULT NULL,
  p_as_of     date DEFAULT NULL
)
RETURNS TABLE (
  member_id             uuid,
  monthly_contribution  numeric,
  total_contributions   numeric,
  total_deposits        numeric,
  total_share_capital   numeric,
  this_month            numeric,
  expected_to_date      numeric,
  outstanding           numeric,
  missed_months         integer,
  missed_month_list     date[],
  pending_count         integer,
  pending_amount        numeric,
  last_contribution_at  timestamptz,
  last_contribution_amount numeric,
  next_due_date         date,
  contributions_count   integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
-- The OUT parameters share names with columns in the query below; resolve any
-- collision in favour of the column, never the (unwritten) output variable.
#variable_conflict use_column
DECLARE
  v_member public.sacco_members%ROWTYPE;
  v_asof   date := COALESCE(p_as_of, CURRENT_DATE);
  v_start  date;
  v_months integer;
  v_missed date[];
BEGIN
  SELECT * INTO v_member FROM public.sacco_members
   WHERE id = COALESCE(p_member_id, public.current_sacco_member_id());
  IF v_member.id IS NULL THEN RETURN; END IF;

  -- Either you are that member, or you are staff of the sacco they belong to.
  IF NOT (
    v_member.user_id = auth.uid()
    OR public.is_global_viewer()
    OR (public.is_staff_member() AND v_member.admin_id = public.current_admin_id())
  ) THEN
    RAISE EXCEPTION 'Not authorised to read this member''s contributions';
  END IF;

  v_start  := COALESCE(v_member.contribution_start_date, v_member.joined_at, v_member.created_at::date);
  v_months := public.sacco_months_inclusive(v_start, v_asof);

  -- Elapsed months (excluding the one still running) where the member did not
  -- cover their monthly obligation.
  SELECT COALESCE(array_agg(g.m::date ORDER BY g.m), '{}'::date[])
    INTO v_missed
    FROM generate_series(date_trunc('month', v_start),
                         date_trunc('month', v_asof) - interval '1 month',
                         interval '1 month') AS g(m)
   WHERE COALESCE(v_member.monthly_contribution, 0) > 0
     AND COALESCE((
           SELECT SUM(c.amount) FROM public.sacco_contributions c
            WHERE c.member_id = v_member.id
              AND c.status = 'completed'
              AND COALESCE(c.account, 'deposits') <> 'share_capital'
              AND c.period_month = g.m::date
         ), 0) < v_member.monthly_contribution;

  RETURN QUERY
  WITH settled AS (
    SELECT c.* FROM public.sacco_contributions c
     WHERE c.member_id = v_member.id AND c.status = 'completed'
  ),
  agg AS (
    SELECT
      COALESCE(SUM(s.amount), 0)                                                   AS total_all,
      COALESCE(SUM(s.amount) FILTER (WHERE COALESCE(s.account,'deposits') = 'deposits'), 0)      AS total_dep,
      COALESCE(SUM(s.amount) FILTER (WHERE s.account = 'share_capital'), 0)         AS total_sc,
      COALESCE(SUM(s.amount) FILTER (WHERE s.period_month = date_trunc('month', v_asof)::date), 0) AS month_total,
      -- Only what counts against the monthly obligation: share capital is a
      -- separate, permanent account, not this month's savings.
      COALESCE(SUM(s.amount) FILTER (WHERE s.period_month = date_trunc('month', v_asof)::date
                                       AND COALESCE(s.account, 'deposits') <> 'share_capital'), 0) AS month_deposits,
      COUNT(*)::int                                                                 AS n
    FROM settled s
  ),
  last_one AS (
    SELECT s.paid_at, s.amount FROM settled s
     ORDER BY s.paid_at DESC NULLS LAST, s.created_at DESC LIMIT 1
  ),
  pend AS (
    SELECT COUNT(*)::int AS n, COALESCE(SUM(c.amount), 0) AS amt
      FROM public.sacco_contributions c
     WHERE c.member_id = v_member.id AND c.status = 'pending'
  )
  SELECT
    v_member.id,
    COALESCE(v_member.monthly_contribution, 0),
    agg.total_all,
    agg.total_dep,
    agg.total_sc,
    agg.month_total,
    round(COALESCE(v_member.monthly_contribution, 0) * v_months, 2),
    GREATEST(round(COALESCE(v_member.monthly_contribution, 0) * v_months, 2) - agg.total_dep, 0),
    COALESCE(array_length(v_missed, 1), 0),
    v_missed,
    pend.n,
    pend.amt,
    last_one.paid_at,
    last_one.amount,
    -- The NEXT payment due, which is always today or later: the end of this
    -- month while it is still short, otherwise the end of next month. Arrears
    -- are reported separately (missed_month_list / outstanding) rather than
    -- being folded in here as a date in the past.
    (CASE
       WHEN COALESCE(v_member.monthly_contribution, 0) <= 0 THEN NULL
       WHEN agg.month_deposits >= v_member.monthly_contribution
         THEN (date_trunc('month', v_asof) + interval '2 months - 1 day')::date
       ELSE (date_trunc('month', v_asof) + interval '1 month - 1 day')::date
     END),
    agg.n
  FROM agg
  CROSS JOIN pend
  LEFT JOIN last_one ON true;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_member_contribution_stats(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_member_contribution_stats(uuid, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. REPORTS (requirement 7)
-- ----------------------------------------------------------------------------
-- Daily / monthly / annual collections, split by the payment channels a
-- treasurer has to reconcile against.
CREATE OR REPLACE FUNCTION public.sacco_contribution_collections(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_bucket text DEFAULT 'day'
)
RETURNS TABLE (
  bucket        date,
  entries       integer,
  members       integer,
  total         numeric,
  cash          numeric,
  bank          numeric,
  mpesa         numeric,
  card          numeric,
  other         numeric,
  deposits      numeric,
  share_capital numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_admin  uuid := public.current_admin_id();
  v_unit   text;
  v_from   date := COALESCE(p_from, (CURRENT_DATE - interval '30 days')::date);
  v_to     date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  IF NOT (public.is_staff_member() OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Only sacco staff can run collection reports';
  END IF;

  v_unit := CASE lower(COALESCE(p_bucket, 'day'))
              WHEN 'month' THEN 'month'
              WHEN 'year'  THEN 'year'
              ELSE 'day'
            END;

  RETURN QUERY
  SELECT
    date_trunc(v_unit, c.paid_at)::date                                   AS bucket,
    COUNT(*)::int                                                          AS entries,
    COUNT(DISTINCT c.member_id)::int                                       AS members,
    COALESCE(SUM(c.amount), 0)                                             AS total,
    COALESCE(SUM(c.amount) FILTER (WHERE c.payment_method = 'cash'), 0)    AS cash,
    COALESCE(SUM(c.amount) FILTER (WHERE c.payment_method = 'bank'), 0)    AS bank,
    COALESCE(SUM(c.amount) FILTER (WHERE c.payment_method = 'mpesa'), 0)   AS mpesa,
    COALESCE(SUM(c.amount) FILTER (WHERE c.payment_method = 'card'), 0)    AS card,
    COALESCE(SUM(c.amount) FILTER (WHERE c.payment_method NOT IN ('cash','bank','mpesa','card')
                                      OR c.payment_method IS NULL), 0)     AS other,
    COALESCE(SUM(c.amount) FILTER (WHERE COALESCE(c.account,'deposits') = 'deposits'), 0) AS deposits,
    COALESCE(SUM(c.amount) FILTER (WHERE c.account = 'share_capital'), 0)  AS share_capital
  FROM public.sacco_contributions c
  WHERE c.status = 'completed'
    AND c.paid_at IS NOT NULL
    AND c.paid_at >= v_from::timestamptz
    AND c.paid_at <  (v_to + 1)::timestamptz
    AND (public.is_global_viewer() OR c.admin_id = v_admin)
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_contribution_collections(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_contribution_collections(date, date, text) TO authenticated;

-- Members behind on their monthly obligation, worst first.
CREATE OR REPLACE FUNCTION public.sacco_contribution_defaulters(
  p_as_of date DEFAULT NULL
)
RETURNS TABLE (
  member_id            uuid,
  member_no            text,
  full_name            text,
  phone                text,
  email                text,
  monthly_contribution numeric,
  expected             numeric,
  contributed          numeric,
  outstanding          numeric,
  missed_months        integer,
  last_paid_at         timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_admin uuid := public.current_admin_id();
  v_asof  date := COALESCE(p_as_of, CURRENT_DATE);
BEGIN
  IF NOT (public.is_staff_member() OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Only sacco staff can run the defaulters report';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      m.id, m.member_no, m.full_name, m.phone, m.email,
      COALESCE(m.monthly_contribution, 0) AS monthly,
      public.sacco_months_inclusive(
        COALESCE(m.contribution_start_date, m.joined_at, m.created_at::date), v_asof) AS months
    FROM public.sacco_members m
    WHERE m.status = 'active'
      AND COALESCE(m.monthly_contribution, 0) > 0
      AND (public.is_global_viewer() OR m.admin_id = v_admin)
  ),
  paid AS (
    SELECT c.member_id,
           COALESCE(SUM(c.amount), 0) AS total,
           MAX(c.paid_at)             AS last_at
      FROM public.sacco_contributions c
     WHERE c.status = 'completed'
       AND COALESCE(c.account, 'deposits') <> 'share_capital'
     GROUP BY c.member_id
  ),
  missed AS (
    SELECT b.id AS member_id, COUNT(*)::int AS n
      FROM base b
      CROSS JOIN LATERAL generate_series(
        date_trunc('month', v_asof) - ((b.months - 1) || ' months')::interval,
        date_trunc('month', v_asof) - interval '1 month',
        interval '1 month') AS g(m)
     WHERE COALESCE((
             SELECT SUM(c2.amount) FROM public.sacco_contributions c2
              WHERE c2.member_id = b.id
                AND c2.status = 'completed'
                AND COALESCE(c2.account, 'deposits') <> 'share_capital'
                AND c2.period_month = g.m::date
           ), 0) < b.monthly
     GROUP BY b.id
  )
  SELECT
    b.id, b.member_no, b.full_name, b.phone, b.email,
    b.monthly,
    round(b.monthly * b.months, 2),
    COALESCE(p.total, 0),
    GREATEST(round(b.monthly * b.months, 2) - COALESCE(p.total, 0), 0),
    COALESCE(mi.n, 0),
    p.last_at
  FROM base b
  LEFT JOIN paid   p  ON p.member_id  = b.id
  LEFT JOIN missed mi ON mi.member_id = b.id
  WHERE GREATEST(round(b.monthly * b.months, 2) - COALESCE(p.total, 0), 0) > 0
  ORDER BY 9 DESC, 10 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_contribution_defaulters(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sacco_contribution_defaulters(date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. M-PESA (requirement 8)
-- ----------------------------------------------------------------------------
-- A fourth purpose on the shared transaction table. It settles onto
-- sacco_contributions instead of payments, and it collects on the SACCO's own
-- paybill (flow 2), never the platform's.
ALTER TABLE public.mpesa_transactions
  ADD COLUMN IF NOT EXISTS member_id       UUID,
  ADD COLUMN IF NOT EXISTS contribution_id UUID;

CREATE INDEX IF NOT EXISTS idx_mpesa_txn_member ON public.mpesa_transactions(member_id);

ALTER TABLE public.mpesa_transactions DROP CONSTRAINT IF EXISTS mpesa_transactions_purpose_check;
ALTER TABLE public.mpesa_transactions
  ADD CONSTRAINT mpesa_transactions_purpose_check
  CHECK (purpose IN ('subscription', 'collection', 'test', 'sacco_contribution'));

-- A member watching their own STK push complete. Without this the portal spins
-- forever: the row is theirs, but no existing policy reaches it.
DROP POLICY IF EXISTS mpesa_txn_member_read ON public.mpesa_transactions;
CREATE POLICY mpesa_txn_member_read ON public.mpesa_transactions
  FOR SELECT TO authenticated
  USING (member_id IS NOT NULL AND member_id = public.current_sacco_member_id());

-- ----------------------------------------------------------------------------
-- 9. Realtime — the member portal and the sacco dashboard both watch these
-- ----------------------------------------------------------------------------
-- supabase_realtime is per-table; sacco_contributions is already published by
-- the base schema, the audit log is new.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sacco_contribution_audit;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
