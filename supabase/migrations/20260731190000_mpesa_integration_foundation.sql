-- ============================================================================
-- M-PESA INTEGRATION — FOUNDATION
-- ----------------------------------------------------------------------------
-- Three distinct money flows, and they must not be conflated:
--
--   1. SUBSCRIPTION  (purpose='subscription')
--      A company/sacco admin pays the PLATFORM OWNER to get portal access.
--      Collected on the super admin's paybill, using the platform-level
--      MPESA_* function secrets. No portal access until this clears.
--
--   2. TENANT COLLECTION  (purpose='collection')
--      A company/sacco collects from its OWN clients/members, into its OWN
--      paybill. Opt-in: the tenant must complete Safaricom Go-Live themselves
--      and supply their own Daraja credentials (see mpesa_tenant_credentials).
--      Knowing a paybill number is NOT enough to collect into it.
--
--   3. AGENT PAYOUT  (agent_withdrawals)
--      Money leaves the platform owner's paybill to a sales agent's phone.
--      Agent requests -> super admin approves -> paid. This is B2C, a separate
--      Daraja product with its own Safaricom approval, so the table supports a
--      manual payout method until that approval lands.
--
-- Prior state this migration corrects:
--   * mpesa_transactions and mpesa_subscription_payments existed ONLY in the
--     live database — no migration defined them, so a fresh environment had
--     neither. Defined idempotently here.
--   * mpesa_transactions had no admin_id and an RLS policy of
--     USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid())),
--     i.e. every authenticated user of every tenant could read and write every
--     other tenant's M-Pesa transactions. Replaced with tenant-scoped policies.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mpesa_transactions — STK push attempts and their outcome
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_transactions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_request_id  text,
  merchant_request_id  text,
  phone_number         text,
  amount               numeric,
  account_reference    text,
  client_id            uuid,
  plan_id              uuid,
  charge_id            uuid,
  status               text DEFAULT 'pending',
  mpesa_receipt_number text,
  result_desc          text,
  completed_at         timestamptz,
  created_at           timestamptz DEFAULT now()
);

-- Tenant owner of the row. For purpose='subscription' this is the admin who is
-- PAYING the platform (so they can watch their own payment complete); the super
-- admin sees it too via is_global_viewer().
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS admin_id    uuid;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS purpose     text NOT NULL DEFAULT 'collection';
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS result_code text;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS shortcode   text;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS environment text DEFAULT 'sandbox';
-- Set once the callback (or the status-query reconciler) has applied its side
-- effects. The guard that makes replayed callbacks harmless.
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS settled_at  timestamptz;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS last_query_at timestamptz;
ALTER TABLE public.mpesa_transactions ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- 'test' is a live KES 1 STK push a super admin fires at their own phone to
-- prove the paybill works. It moves real money like any other push, but the
-- callback deliberately applies NO side effects to it — no payment record, no
-- subscription activation — so proving the wiring never mutates business data.
ALTER TABLE public.mpesa_transactions DROP CONSTRAINT IF EXISTS mpesa_transactions_purpose_check;
ALTER TABLE public.mpesa_transactions
  ADD CONSTRAINT mpesa_transactions_purpose_check
  CHECK (purpose IN ('subscription', 'collection', 'test'));

DO $$
BEGIN
  ALTER TABLE public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'timeout'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The callback looks rows up by CheckoutRequestID, so it must be unique —
-- this is also what lets the callback upsert safely under Safaricom's retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_txn_checkout_request_id
  ON public.mpesa_transactions(checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mpesa_txn_admin_id ON public.mpesa_transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_status   ON public.mpesa_transactions(status);
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_client   ON public.mpesa_transactions(client_id);
-- Drives the reconciliation sweep: pending rows old enough that the callback
-- has probably been lost.
CREATE INDEX IF NOT EXISTS idx_mpesa_txn_pending_sweep
  ON public.mpesa_transactions(created_at)
  WHERE status = 'pending';

-- Backfill the tenant for any pre-existing rows from the client they belong to.
UPDATE public.mpesa_transactions t
   SET admin_id = c.admin_id
  FROM public.clients c
 WHERE t.client_id = c.id
   AND t.admin_id IS NULL
   AND c.admin_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_admin_id_mpesa_transactions ON public.mpesa_transactions;
CREATE TRIGGER set_admin_id_mpesa_transactions BEFORE INSERT ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;

-- The cross-tenant hole.
DROP POLICY IF EXISTS "Staff can manage mpesa transactions" ON public.mpesa_transactions;

-- Read-only for tenants: rows are created and mutated exclusively by the edge
-- functions under the service role, which bypasses RLS. Nothing in the app has
-- any business writing a payment record directly from the browser.
DROP POLICY IF EXISTS mpesa_txn_tenant_read ON public.mpesa_transactions;
CREATE POLICY mpesa_txn_tenant_read ON public.mpesa_transactions
  FOR SELECT TO authenticated
  USING (
    (admin_id = public.current_admin_id() AND public.is_staff_member())
    OR public.is_global_viewer()
    -- A client-portal user may watch their own payment complete.
    OR client_id IN (
      SELECT c.id FROM public.clients c
      JOIN public.user_profiles up ON up.id = auth.uid()
      WHERE c.email = up.email
    )
  );

-- ----------------------------------------------------------------------------
-- 2. mpesa_subscription_payments — platform subscription payments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mpesa_subscription_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             uuid,
  subscription_id      uuid,
  phone_number         text,
  amount               numeric,
  merchant_request_id  text,
  checkout_request_id  text,
  mpesa_receipt_number text,
  transaction_date     timestamptz,
  status               text DEFAULT 'pending',
  result_code          text,
  result_desc          text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_sub_checkout_request_id
  ON public.mpesa_subscription_payments(checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mpesa_sub_admin ON public.mpesa_subscription_payments(admin_id);

ALTER TABLE public.mpesa_subscription_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can manage mpesa subscription payments" ON public.mpesa_subscription_payments;
-- FOR ALL TO authenticated USING (true) WITH CHECK (true). Policies are OR'd, so
-- leaving this in place would make the tenant-scoped policy below decorative —
-- any signed-in user could read and rewrite every admin's subscription payments.
DROP POLICY IF EXISTS authenticated_access_mpesa_payments ON public.mpesa_subscription_payments;
DROP POLICY IF EXISTS mpesa_sub_tenant_read ON public.mpesa_subscription_payments;
CREATE POLICY mpesa_sub_tenant_read ON public.mpesa_subscription_payments
  FOR SELECT TO authenticated
  USING (admin_id = public.current_admin_id() OR public.is_global_viewer());

-- ----------------------------------------------------------------------------
-- 3. mpesa_tenant_credentials — a tenant's OWN Daraja app (flow 2, opt-in)
-- ----------------------------------------------------------------------------
-- Secrets are stored as AES-256-GCM ciphertext produced by the edge function
-- using MPESA_CRED_ENC_KEY, which lives only in Supabase function secrets. The
-- database never holds the key, so a database compromise alone does not expose
-- a tenant's Daraja credentials.
CREATE TABLE IF NOT EXISTS public.mpesa_tenant_credentials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              uuid NOT NULL UNIQUE,
  -- Non-secret, safe to show the tenant back.
  shortcode             text NOT NULL,
  account_type          text NOT NULL DEFAULT 'paybill',
  environment           text NOT NULL DEFAULT 'sandbox',
  -- AES-GCM ciphertext, never returned to any client.
  consumer_key_enc      text NOT NULL,
  consumer_secret_enc   text NOT NULL,
  passkey_enc           text NOT NULL,
  is_active             boolean NOT NULL DEFAULT false,
  -- Stamped when we have successfully fetched a Daraja token with these creds.
  verified_at           timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mpesa_tenant_credentials_account_type_check
    CHECK (account_type IN ('paybill', 'till')),
  CONSTRAINT mpesa_tenant_credentials_environment_check
    CHECK (environment IN ('sandbox', 'production'))
);

-- Buy Goods only: STK authenticates against the head office shortcode while the
-- money lands on the till, so both numbers are needed. Null for paybill.
ALTER TABLE public.mpesa_tenant_credentials
  ADD COLUMN IF NOT EXISTS head_office_shortcode text;

ALTER TABLE public.mpesa_tenant_credentials ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies for `authenticated`. RLS with zero policies denies
-- everything, so only the service role (which bypasses RLS) can read or write
-- this table. Tenants manage their credentials through the mpesa-credentials
-- edge function and read status through mpesa_credentials_status() below.
-- Do not add a SELECT policy here — it would expose the ciphertext.

-- Non-secret status for the calling tenant. SECURITY DEFINER so it can read a
-- table the caller has no policy on, but it never selects a *_enc column.
CREATE OR REPLACE FUNCTION public.mpesa_credentials_status()
RETURNS TABLE (
  admin_id     uuid,
  shortcode    text,
  account_type text,
  environment  text,
  is_active    boolean,
  verified_at  timestamptz,
  last_error   text,
  updated_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.admin_id, c.shortcode, c.account_type, c.environment,
         c.is_active, c.verified_at, c.last_error, c.updated_at
  FROM public.mpesa_tenant_credentials c
  WHERE c.admin_id = public.current_admin_id()
     OR public.is_global_viewer();
$$;

-- A SECURITY DEFINER function is PUBLIC-executable by default, and revoking
-- from PUBLIC alone leaves anon/authenticated holding EXECUTE through default
-- privileges — they must be revoked explicitly before re-granting.
REVOKE ALL ON FUNCTION public.mpesa_credentials_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mpesa_credentials_status() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. agent_withdrawals — request -> super admin approval -> payout
-- ----------------------------------------------------------------------------
-- Replaces the previous client-side "withdrawal", which inserted a negative
-- agent_wallets row directly: no approval, no payout, and the balance was
-- debited the instant the agent clicked.
CREATE TABLE IF NOT EXISTS public.agent_withdrawals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  admin_id            uuid,
  amount              numeric NOT NULL CHECK (amount > 0),
  -- Snapshot of agents.phone at request time: the destination must not silently
  -- change between request and payout.
  phone_number        text NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  notes               text,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_notes        text,
  -- 'mpesa_b2c' once Safaricom approves B2C; 'manual' until then, where the
  -- super admin sends the money themselves and records the reference.
  payout_method       text,
  mpesa_conversation_id            text,
  mpesa_originator_conversation_id text,
  mpesa_receipt_number             text,
  paid_at             timestamptz,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_withdrawals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'paid', 'failed')),
  CONSTRAINT agent_withdrawals_payout_method_check
    CHECK (payout_method IS NULL OR payout_method IN ('mpesa_b2c', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_agent  ON public.agent_withdrawals(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_status ON public.agent_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_agent_withdrawals_admin  ON public.agent_withdrawals(admin_id);

-- What the agent may actually draw down: everything credited, minus what has
-- already been paid out, minus anything reserved by a request that is still in
-- flight. Without the in-flight term an agent could submit their full balance
-- several times before the first payout settles.
CREATE OR REPLACE FUNCTION public.agent_available_balance(p_agent_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT SUM(w.total_earned)    FROM public.agent_wallets w WHERE w.agent_id = p_agent_id), 0)
  - COALESCE((SELECT SUM(w.total_withdrawn) FROM public.agent_wallets w WHERE w.agent_id = p_agent_id), 0)
  - COALESCE((SELECT SUM(aw.amount)         FROM public.agent_withdrawals aw
               WHERE aw.agent_id = p_agent_id
                 AND aw.status IN ('pending', 'approved', 'processing')), 0);
$$;

REVOKE ALL ON FUNCTION public.agent_available_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_available_balance(uuid) TO authenticated;

-- Enforce the balance in the database, not just the form: the browser check in
-- CommissionWallet.jsx is a convenience, not a control.
CREATE OR REPLACE FUNCTION public.check_agent_withdrawal_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_available numeric;
BEGIN
  v_available := public.agent_available_balance(NEW.agent_id);
  IF NEW.amount > v_available THEN
    RAISE EXCEPTION 'Withdrawal of % exceeds available balance of %', NEW.amount, v_available
      USING ERRCODE = 'check_violation';
  END IF;
  -- Agents belong to the super admin who created them; that is who approves.
  IF NEW.admin_id IS NULL THEN
    SELECT a.admin_id INTO NEW.admin_id FROM public.agents a WHERE a.id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_agent_withdrawal_balance_trg ON public.agent_withdrawals;
CREATE TRIGGER check_agent_withdrawal_balance_trg BEFORE INSERT ON public.agent_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.check_agent_withdrawal_balance();

ALTER TABLE public.agent_withdrawals ENABLE ROW LEVEL SECURITY;

-- An agent sees and creates only their own requests.
DROP POLICY IF EXISTS agent_withdrawals_own_read ON public.agent_withdrawals;
CREATE POLICY agent_withdrawals_own_read ON public.agent_withdrawals
  FOR SELECT TO authenticated
  USING (
    agent_id IN (SELECT a.id FROM public.agents a WHERE a.user_id = auth.uid())
    OR public.is_global_viewer()
  );

DROP POLICY IF EXISTS agent_withdrawals_own_insert ON public.agent_withdrawals;
CREATE POLICY agent_withdrawals_own_insert ON public.agent_withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (
    agent_id IN (SELECT a.id FROM public.agents a WHERE a.user_id = auth.uid())
    -- An agent may only ever open a request; they cannot self-approve or
    -- self-mark-paid by writing a different status on insert.
    AND status = 'pending'
  );

-- Only the platform owner moves a request forward. Approval and payout happen
-- through an edge function under the service role, but this keeps the direct
-- table path honest as well.
DROP POLICY IF EXISTS agent_withdrawals_admin_update ON public.agent_withdrawals;
CREATE POLICY agent_withdrawals_admin_update ON public.agent_withdrawals
  FOR UPDATE TO authenticated
  USING (public.is_global_viewer())
  WITH CHECK (public.is_global_viewer());

-- ----------------------------------------------------------------------------
-- 5. Keep updated_at honest on the new tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_mpesa_transactions ON public.mpesa_transactions;
CREATE TRIGGER touch_mpesa_transactions BEFORE UPDATE ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_mpesa_tenant_credentials ON public.mpesa_tenant_credentials;
CREATE TRIGGER touch_mpesa_tenant_credentials BEFORE UPDATE ON public.mpesa_tenant_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_agent_withdrawals ON public.agent_withdrawals;
CREATE TRIGGER touch_agent_withdrawals BEFORE UPDATE ON public.agent_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_mpesa_subscription_payments ON public.mpesa_subscription_payments;
CREATE TRIGGER touch_mpesa_subscription_payments BEFORE UPDATE ON public.mpesa_subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';
