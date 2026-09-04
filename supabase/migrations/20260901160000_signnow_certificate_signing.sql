-- ============================================================================
-- SIGNNOW — SIGNATURE BEFORE ISSUANCE
--
-- WHAT WAS WRONG
-- --------------
-- Every certificate this platform prints leaves blank lines where a signature
-- belongs:
--
--   * the share certificate draws three of them — Chairperson, Treasurer,
--     Secretary — and hands the holder the paper regardless;
--   * the Certificate of Full Settlement & Ownership Transfer prints
--     "Signature: ________" and an empty Designation;
--   * an asset valuation is a figure typed into the register by whoever had
--     the screen open, with nothing on the face saying who stands behind it.
--
-- So the document a member takes to a bank, or a buyer takes to a registry,
-- asserts something no officer has ever attested to. The serial registry
-- (20260901140000) fixed IDENTITY — this serial is ours, and the record is
-- unaltered. It says nothing about AUTHORITY, and those are different claims.
--
-- WHAT THIS ADDS
-- --------------
-- A signing step between "the document has been generated" and "the document
-- has been issued", carried out through SignNow using the tenant's own
-- account:
--
--   generate PDF ──► signing_requests(sent) ──► SignNow invite ──► officers
--   sign ──► callback ──► signed PDF stored ──► RELEASED as the issued
--   certificate.
--
-- Until the last step the only thing obtainable is a copy watermarked
-- DRAFT — NOT YET ISSUED. The issued certificate is, by construction, the file
-- SignNow returned with the signatures burned into it.
--
-- WHY AN EXTERNAL PROVIDER WHEN WE ALREADY SIGN PDFs
-- --------------------------------------------------
-- The in-house engine (/e-signature) signs documents a tenant sends to THEIR
-- customers, and its evidence is evidence we produced about ourselves. A
-- certificate is the other direction: the tenant's own officers attesting, on
-- a document later shown to a third party who has no reason to take our word
-- for the audit trail. Both engines stay — this adds a provider column, it
-- does not replace anything.
--
-- WHAT IS HERE
--   1. signnow_connections        — per-tenant SignNow credentials, encrypted,
--                                   written only by the edge function.
--   2. signing_policies           — per (tenant, document kind): is a signature
--                                   required, and who signs.
--   3. signing_requests           — one row per document sent for signature.
--   4. signing_request_signers    — one row per signatory on a request.
--   5. signing_request_events     — append-only trail, ours and SignNow's.
--   6. signing_webhook_deliveries — raw callbacks, for de-dupe and replay.
--   7. RPCs — open a request, cancel one, read status in bulk, and the two the
--      edge function calls to record and release a completed signature.
--   8. signed-certificates        — private storage bucket for the PDFs.
--
-- TENANCY
--   Every table carries admin_id and is scoped by public.current_admin_id(),
--   the rule the rest of the platform uses. A request may only be opened
--   against a record of the caller's own tenant, and that is checked in the
--   database against the source row rather than taken from the browser.
--
-- SAFE ON A LIVE PLATFORM
--   An absent signing_policies row means "not required". Nothing about any
--   existing certificate changes until a tenant switches a document kind on.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. VOCABULARY
--
-- Four document kinds, each bound to the table whose rows it certifies. The
-- pairing is enforced below, so a request can never claim to be a share
-- certificate while pointing at an installment plan.
--
--   share_certificate      → sacco_share_certificates
--   settlement_certificate → installment_plans
--   asset_valuation        → sacco_fixed_assets
--   contract               → generated_contracts | company_contracts
--                            | esign_documents
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. SIGNNOW CONNECTIONS — the tenant's own SignNow account
--
-- Credentials are AES-256-GCM ciphertext produced by the edge function using
-- SIGNNOW_CRED_ENC_KEY, which lives only in Supabase function secrets. Same
-- rule as mpesa_tenant_credentials: the database never holds the key, so a
-- database compromise alone does not hand anyone a tenant's SignNow account —
-- and that account can send legally binding invites in the tenant's name.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signnow_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL UNIQUE,

  -- Non-secret, and shown back to the operator: which SignNow environment, and
  -- which login the invites appear to come from. Seeing "sandbox" while
  -- expecting production is the commonest reason a "working" integration sends
  -- nothing anybody receives.
  environment           TEXT NOT NULL DEFAULT 'sandbox',
  account_email         TEXT,

  -- AES-GCM ciphertext. Never returned to any client, at any privilege.
  client_id_enc         TEXT NOT NULL,
  client_secret_enc     TEXT NOT NULL,
  username_enc          TEXT NOT NULL,
  password_enc          TEXT NOT NULL,

  -- The webhook shared secret we generated and registered with SignNow, used
  -- to verify the HMAC on every callback. Encrypted for the same reason.
  webhook_secret_enc    TEXT,
  webhook_registered_at TIMESTAMPTZ,
  -- Subscription ids returned by POST /api/v2/events, so re-registering
  -- replaces rather than duplicates.
  webhook_event_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Set only when SignNow has actually issued a token for these credentials.
  is_active             BOOLEAN NOT NULL DEFAULT false,
  verified_at           TIMESTAMPTZ,
  last_error            TEXT,

  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signnow_connections_env_chk
    CHECK (environment IN ('sandbox', 'production'))
);

ALTER TABLE public.signnow_connections ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies. RLS with zero policies denies everything, so only
-- the service role — the signnow-credentials edge function — reads or writes
-- this table. Nothing in a browser can reach a ciphertext column.

COMMENT ON TABLE public.signnow_connections IS
  'A tenant SignNow API credential set, AES-256-GCM sealed with SIGNNOW_CRED_ENC_KEY. '
  'RLS on with zero policies: the signnow-credentials edge function is the only door.';

-- ---------------------------------------------------------------------------
-- 2. SIGNING POLICIES — what must be signed, and by whom
--
-- `signatories` is the standing panel for that document kind:
--   [{"role":"Chairperson","name":"…","email":"…","order":1},
--    {"role":"Treasurer",  "name":"…","email":"…","order":2}]
-- A default, not a lock: a request may name different people, and whoever was
-- actually invited is recorded per-request in signing_request_signers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signing_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID NOT NULL,
  doc_kind          TEXT NOT NULL,

  require_signature BOOLEAN NOT NULL DEFAULT false,
  provider          TEXT NOT NULL DEFAULT 'signnow',
  signatories       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Sequential mirrors how a board actually signs: the Secretary countersigns
  -- what the Chairperson has already signed. Parallel is faster, and is the
  -- right default for two peers.
  signing_order     TEXT NOT NULL DEFAULT 'sequential',
  -- Days before an unsigned invite lapses. NULL leaves it to SignNow.
  expires_days      INTEGER,
  -- Release the certificate the moment the last signature lands, rather than
  -- waiting for someone to press a button.
  auto_release      BOOLEAN NOT NULL DEFAULT true,

  updated_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signing_policies_kind_chk CHECK (doc_kind IN (
    'share_certificate', 'settlement_certificate', 'asset_valuation', 'contract')),
  CONSTRAINT signing_policies_provider_chk CHECK (provider IN ('signnow', 'internal')),
  CONSTRAINT signing_policies_order_chk    CHECK (signing_order IN ('sequential', 'parallel')),
  CONSTRAINT signing_policies_expiry_chk   CHECK (expires_days IS NULL OR expires_days BETWEEN 1 AND 180)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_policy_tenant_kind
  ON public.signing_policies(admin_id, doc_kind);

-- ---------------------------------------------------------------------------
-- 3. SIGNING REQUESTS — one per document sent for signature
--
-- STATUS LIFECYCLE
--   draft      created, PDF stored, nothing sent yet
--   sent       uploaded to SignNow, invite issued
--   viewed     at least one signatory has opened it
--   signed     every signatory signed; the signed PDF has been retrieved
--   released   that signed PDF IS the issued certificate (terminal, good)
--   declined   a signatory refused (terminal)
--   cancelled  withdrawn by staff (terminal)
--   expired    the invite lapsed unsigned (terminal)
--   failed     SignNow was unreachable, or rejected the document
--
-- `released` is deliberately distinct from `signed`: signed is a fact about
-- the paper, released is a decision about the register. auto_release collapses
-- the two; a tenant that wants a human to look first can have that instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signing_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL,
  sacco_id              UUID,

  doc_kind              TEXT NOT NULL,
  source_table          TEXT NOT NULL,
  source_id             UUID NOT NULL,

  provider              TEXT NOT NULL DEFAULT 'signnow',
  -- SignNow's document id. NULL until the upload succeeds — which is exactly
  -- how a request that failed before reaching them identifies itself.
  provider_document_id  TEXT,
  provider_environment  TEXT,

  document_name         TEXT NOT NULL,
  -- The unsigned PDF we sent and the signed one SignNow returned. Bare paths
  -- in the private `signed-certificates` bucket, not URLs — see storageUrl.js.
  draft_path            TEXT,
  signed_path           TEXT,
  -- SHA-256 of the bytes we uploaded. If a returned document is not built on
  -- the one we sent, this is the number that says so.
  draft_digest          TEXT,

  -- The platform certificate serial this document carries. Minted BEFORE
  -- sending, so the serial is printed on the page the officers actually sign.
  certificate_serial    TEXT,

  status                TEXT NOT NULL DEFAULT 'draft',
  signing_order         TEXT NOT NULL DEFAULT 'sequential',

  message               TEXT,
  decline_reason        TEXT,
  last_error            TEXT,

  requested_by          UUID,
  sent_at               TIMESTAMPTZ,
  first_viewed_at       TIMESTAMPTZ,
  signed_at             TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  released_by           UUID,
  expires_at            TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signing_requests_kind_chk CHECK (doc_kind IN (
    'share_certificate', 'settlement_certificate', 'asset_valuation', 'contract')),
  CONSTRAINT signing_requests_status_chk CHECK (status IN (
    'draft', 'sent', 'viewed', 'signed', 'released',
    'declined', 'cancelled', 'expired', 'failed')),
  CONSTRAINT signing_requests_provider_chk CHECK (provider IN ('signnow', 'internal')),
  CONSTRAINT signing_requests_order_chk CHECK (signing_order IN ('sequential', 'parallel')),

  -- A request must certify the kind of record its doc_kind names. Without this
  -- a caller could open a "settlement certificate" against a share row, and the
  -- release path would then read its facts off the wrong table.
  CONSTRAINT signing_requests_kind_source_chk CHECK (
    (doc_kind = 'share_certificate'      AND source_table = 'sacco_share_certificates')
 OR (doc_kind = 'settlement_certificate' AND source_table = 'installment_plans')
 OR (doc_kind = 'asset_valuation'        AND source_table = 'sacco_fixed_assets')
 OR (doc_kind = 'contract'               AND source_table IN
       ('generated_contracts', 'company_contracts', 'esign_documents'))
  )
);

-- One LIVE request per record. Re-sending after a decline or a cancellation is
-- allowed — history is kept — but two open invites for one certificate means
-- two different documents in circulation claiming to be the same one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_request_open_source
  ON public.signing_requests(source_table, source_id)
  WHERE status IN ('draft', 'sent', 'viewed', 'signed');

CREATE INDEX IF NOT EXISTS idx_signing_requests_tenant
  ON public.signing_requests(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signing_requests_source
  ON public.signing_requests(source_table, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signing_requests_status
  ON public.signing_requests(admin_id, status);
-- A callback arrives knowing only SignNow's document id, so that lookup is the
-- hottest one in the table and must not be a sequential scan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_requests_provider_doc
  ON public.signing_requests(provider_document_id)
  WHERE provider_document_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. SIGNERS — who was asked, and what they did
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signing_request_signers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL REFERENCES public.signing_requests(id) ON DELETE CASCADE,
  admin_id           UUID NOT NULL,

  -- The office, not the person: "Chairperson". This is what the signature
  -- block on the certificate is labelled with, and what SignNow calls a role.
  role_name          TEXT NOT NULL,
  signer_name        TEXT,
  signer_email       TEXT NOT NULL,
  signing_order      INTEGER NOT NULL DEFAULT 1,

  provider_role_id   TEXT,
  provider_invite_id TEXT,

  status             TEXT NOT NULL DEFAULT 'pending',
  viewed_at          TIMESTAMPTZ,
  signed_at          TIMESTAMPTZ,
  declined_at        TIMESTAMPTZ,
  decline_reason     TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signing_signers_status_chk CHECK (status IN
    ('pending', 'sent', 'viewed', 'signed', 'declined', 'cancelled')),
  CONSTRAINT signing_signers_order_chk CHECK (signing_order BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_signing_signers_request
  ON public.signing_request_signers(request_id, signing_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_signers_request_role
  ON public.signing_request_signers(request_id, role_name);

-- ---------------------------------------------------------------------------
-- 5. EVENTS — append-only, ours and theirs interleaved
--
-- The value of this table is that it holds OUR side of the story beside
-- SignNow's. When a certificate is questioned two years from now, "we produced
-- this digest, sent it at 14:02, they returned this document id" is the part
-- SignNow's own audit trail cannot supply.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signing_request_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES public.signing_requests(id) ON DELETE CASCADE,
  admin_id     UUID NOT NULL,

  -- opened|sent|viewed|signed|completed|declined|cancelled|expired|released|
  -- error|webhook
  event_type   TEXT NOT NULL,
  actor        TEXT,            -- a person's name, or 'SignNow', or 'system'
  actor_email  TEXT,
  detail       TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signing_events_request
  ON public.signing_request_events(request_id, created_at);

-- ---------------------------------------------------------------------------
-- 6. WEBHOOK DELIVERIES — raw callbacks
--
-- Stored before anything is interpreted, and keyed so a redelivery of an event
-- already applied is recognised rather than applied twice. SignNow retries on
-- any non-2xx, so duplicates are the normal case, not the exception.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signing_webhook_deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       TEXT NOT NULL DEFAULT 'signnow',
  event_name     TEXT,
  -- SignNow's own delivery id where it sends one; otherwise a hash of the
  -- body, which de-dupes identical retries just as well.
  delivery_key   TEXT NOT NULL,
  document_id    TEXT,
  request_id     UUID REFERENCES public.signing_requests(id) ON DELETE SET NULL,
  signature_ok   BOOLEAN,
  handled        BOOLEAN NOT NULL DEFAULT false,
  handling_error TEXT,
  body           JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_webhook_delivery
  ON public.signing_webhook_deliveries(provider, delivery_key);
CREATE INDEX IF NOT EXISTS idx_signing_webhook_doc
  ON public.signing_webhook_deliveries(document_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- 7. updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_signing_requests_touch ON public.signing_requests;
CREATE TRIGGER trg_signing_requests_touch
  BEFORE UPDATE ON public.signing_requests
  FOR EACH ROW EXECUTE FUNCTION public.signing_touch_updated_at();

DROP TRIGGER IF EXISTS trg_signing_signers_touch ON public.signing_request_signers;
CREATE TRIGGER trg_signing_signers_touch
  BEFORE UPDATE ON public.signing_request_signers
  FOR EACH ROW EXECUTE FUNCTION public.signing_touch_updated_at();

DROP TRIGGER IF EXISTS trg_signing_policies_touch ON public.signing_policies;
CREATE TRIGGER trg_signing_policies_touch
  BEFORE UPDATE ON public.signing_policies
  FOR EACH ROW EXECUTE FUNCTION public.signing_touch_updated_at();

COMMIT;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 8. WHO OWNS THE SOURCE RECORD
--
-- The one question the browser must never be trusted to answer. Given a
-- (table, id) it returns the owning tenant, the society where there is one, and
-- a display name for the document — read from the record itself.
--
-- resolved=false means no such record. A record whose own
-- admin_id is NULL (rows predating 20260628120000_tenant_isolation that were
-- never backfilled) resolves to the caller's tenant, matching the judgement
-- settlement_certificate_issue() already makes: "belongs to another tenant" and
-- "does not say which tenant" are different, and only the first is a violation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_source_owner(
  p_source_table text,
  p_source_id    uuid,
  OUT admin_id   uuid,
  OUT sacco_id   uuid,
  OUT label      text,
  OUT resolved   boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  resolved := false;
  admin_id := NULL;
  sacco_id := NULL;
  label    := NULL;

  IF p_source_id IS NULL THEN RETURN; END IF;

  IF p_source_table = 'sacco_share_certificates' THEN
    SELECT sc.admin_id, sc.sacco_id,
           'Share Certificate ' || COALESCE(sc.certificate_no, '') ||
             COALESCE(' — ' || m.full_name, ''),
           true
      INTO admin_id, sacco_id, label, resolved
      FROM public.sacco_share_certificates sc
      LEFT JOIN public.sacco_members m ON m.id = sc.member_id
     WHERE sc.id = p_source_id;

  ELSIF p_source_table = 'installment_plans' THEN
    -- installment_plans carries no admin_id of its own; the tenant comes from
    -- the client, falling back to the asset. Same chain as
    -- settlement_certificate_issue().
    SELECT COALESCE(cl.admin_id, a.admin_id), NULL::uuid,
           'Certificate of Full Settlement — ' || COALESCE(cl.full_name, ip.plan_name, ''),
           true
      INTO admin_id, sacco_id, label, resolved
      FROM public.installment_plans ip
      LEFT JOIN public.clients cl ON cl.id = ip.client_id
      LEFT JOIN public.assets  a  ON a.id  = ip.asset_id
     WHERE ip.id = p_source_id;

  ELSIF p_source_table = 'sacco_fixed_assets' THEN
    SELECT fa.admin_id, fa.sacco_id,
           'Valuation Certificate — ' || COALESCE(fa.asset_name, ''),
           true
      INTO admin_id, sacco_id, label, resolved
      FROM public.sacco_fixed_assets fa
     WHERE fa.id = p_source_id;

  ELSIF p_source_table = 'generated_contracts' THEN
    SELECT gc.admin_id, NULL::uuid,
           COALESCE('Contract ' || gc.invoice_number, 'Contract') ||
             COALESCE(' — ' || gc.client_name, ''),
           true
      INTO admin_id, sacco_id, label, resolved
      FROM public.generated_contracts gc
     WHERE gc.id = p_source_id;

  ELSIF p_source_table = 'esign_documents' THEN
    SELECT ed.admin_id, NULL::uuid, COALESCE(ed.name, 'Document'), true
      INTO admin_id, sacco_id, label, resolved
      FROM public.esign_documents ed
     WHERE ed.id = p_source_id;

  ELSIF p_source_table = 'company_contracts' THEN
    -- company_contracts predates the migration history and its columns differ
    -- between environments, so it is read dynamically rather than referenced —
    -- a hard reference would make this whole migration fail to parse where the
    -- table is absent.
    IF to_regclass('public.company_contracts') IS NOT NULL THEN
      EXECUTE 'select cc.admin_id, null::uuid, coalesce(cc.contract_name, ''Contract''), true
                 from public.company_contracts cc where cc.id = $1'
        INTO admin_id, sacco_id, label, resolved USING p_source_id;
    END IF;
  END IF;

  IF resolved AND admin_id IS NULL THEN
    admin_id := public.current_admin_id();
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.signing_source_owner(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signing_source_owner(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. IS A SIGNATURE REQUIRED
--
-- Answers for the CALLER's tenant. Absent policy = not required, which is what
-- keeps this migration inert until somebody opts in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_required(p_doc_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT sp.require_signature
       FROM public.signing_policies sp
      WHERE sp.admin_id = public.current_admin_id()
        AND sp.doc_kind = p_doc_kind),
    false);
$fn$;

GRANT EXECUTE ON FUNCTION public.signing_required(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. OPEN A REQUEST
--
-- Called once the browser has generated the PDF. It records intent only: the upload to SignNow is the edge function's job, and
-- until that succeeds the row sits at 'draft' with no provider_document_id,
-- which is how a send that never left the building is told apart from one that
-- did.
--
-- p_signers is [{"role":…,"name":…,"email":…,"order":…}, …]. When empty, the
-- tenant's standing panel from signing_policies is used. A request with no
-- signatory at all is refused — an unsigned "signing request" is just a file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_request_open(
  p_doc_kind      text,
  p_source_table  text,
  p_source_id     uuid,
  p_document_name text,
  p_draft_digest  text    DEFAULT NULL,
  p_serial        text    DEFAULT NULL,
  p_signers       jsonb   DEFAULT '[]'::jsonb,
  p_message       text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_owner    record;
  v_admin    uuid := public.current_admin_id();
  v_policy   record;
  v_request  uuid;
  v_signers  jsonb;
  v_count    integer;
  s          jsonb;
  v_order    text;
  v_expires  timestamptz;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff may send a document for signature.';
  END IF;

  SELECT * INTO v_owner FROM public.signing_source_owner(p_source_table, p_source_id);
  IF NOT v_owner.resolved THEN
    RAISE EXCEPTION 'No such record to certify.';
  END IF;

  IF v_owner.admin_id <> v_admin AND NOT public.is_global_viewer() THEN
    RAISE EXCEPTION 'Not permitted to send this document for signature.';
  END IF;

  SELECT * INTO v_policy
    FROM public.signing_policies
   WHERE admin_id = v_owner.admin_id AND doc_kind = p_doc_kind;

  -- The panel: whoever the caller named, else the tenant's standing one.
  v_signers := CASE
    WHEN p_signers IS NOT NULL AND jsonb_typeof(p_signers) = 'array'
         AND jsonb_array_length(p_signers) > 0 THEN p_signers
    ELSE COALESCE(v_policy.signatories, '[]'::jsonb)
  END;

  SELECT count(*) INTO v_count
    FROM jsonb_array_elements(v_signers) e
   WHERE COALESCE(e->>'email', '') <> '';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Name at least one signatory, with an email address, before sending.';
  END IF;

  v_order := COALESCE(v_policy.signing_order, 'sequential');
  IF v_policy.expires_days IS NOT NULL THEN
    v_expires := now() + make_interval(days => v_policy.expires_days);
  END IF;

  -- A document that has already been signed but not yet released is NOT stale,
  -- and must not be swept aside to make room for a new attempt: that would
  -- discard a document real people have already put their names to. Releasing
  -- it or withdrawing it is a decision for a person.
  IF EXISTS (
    SELECT 1 FROM public.signing_requests
     WHERE source_table = p_source_table
       AND source_id    = p_source_id
       AND status = 'signed'
  ) THEN
    RAISE EXCEPTION
      'This document has already been signed and is waiting to be issued. Issue or withdraw it before sending another.';
  END IF;

  -- Anything still merely OUTSTANDING is superseded. The partial unique index
  -- would refuse the insert otherwise, and "the previous attempt is stale" is a
  -- better answer to the operator than a constraint violation.
  UPDATE public.signing_requests
     SET status = 'cancelled',
         last_error = 'Replaced by a newer signing request.',
         updated_at = now()
   WHERE source_table = p_source_table
     AND source_id    = p_source_id
     AND status IN ('draft', 'sent', 'viewed');

  INSERT INTO public.signing_requests
    (admin_id, sacco_id, doc_kind, source_table, source_id, provider,
     document_name, draft_digest, certificate_serial,
     status, signing_order, message, requested_by, expires_at)
  VALUES
    (v_owner.admin_id, v_owner.sacco_id, p_doc_kind, p_source_table, p_source_id,
     COALESCE(v_policy.provider, 'signnow'),
     COALESCE(NULLIF(trim(p_document_name), ''), v_owner.label, 'Document'),
     p_draft_digest, p_serial,
     'draft', v_order, p_message, auth.uid(), v_expires)
  RETURNING id INTO v_request;

  -- The storage path is DERIVED, never supplied. It contains the request id, so
  -- it cannot be known before the insert — and deriving it here rather than
  -- accepting it means a caller cannot point a request at another tenant's
  -- file. The browser recomputes the same string to upload to, and the edge
  -- function reads this column; one formula, three readers.
  UPDATE public.signing_requests
     SET draft_path = v_owner.admin_id::text || '/' || p_doc_kind || '/' || v_request::text || '-draft.pdf'
   WHERE id = v_request;

  FOR s IN SELECT * FROM jsonb_array_elements(v_signers) LOOP
    CONTINUE WHEN COALESCE(s->>'email', '') = '';
    INSERT INTO public.signing_request_signers
      (request_id, admin_id, role_name, signer_name, signer_email, signing_order)
    VALUES
      (v_request, v_owner.admin_id,
       COALESCE(NULLIF(trim(s->>'role'), ''), 'Signer ' || COALESCE(s->>'order', '1')),
       NULLIF(trim(s->>'name'), ''),
       lower(trim(s->>'email')),
       COALESCE((s->>'order')::integer, 1))
    ON CONFLICT (request_id, role_name) DO NOTHING;
  END LOOP;

  INSERT INTO public.signing_request_events (request_id, admin_id, event_type, actor, detail, payload)
  VALUES (v_request, v_owner.admin_id, 'opened',
          COALESCE((SELECT full_name FROM public.user_profiles WHERE id = auth.uid()), 'Staff'),
          'Signing request created for ' || p_doc_kind,
          jsonb_build_object('signers', v_count, 'serial', p_serial));

  RETURN v_request;
END;
$fn$;

REVOKE ALL ON FUNCTION public.signing_request_open(text, text, uuid, text, text, text, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signing_request_open(text, text, uuid, text, text, text, jsonb, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. CANCEL
--
-- Withdraws OUR side. Cancelling the invite at SignNow is the edge function's
-- job and happens first; this is what records it. Terminal states are left
-- alone so a released certificate can never be walked back to cancelled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_request_cancel(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin FROM public.signing_requests WHERE id = p_request_id;
  IF v_admin IS NULL THEN RETURN false; END IF;

  IF NOT ((v_admin = public.current_admin_id() AND public.is_staff_member())
          OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not permitted to cancel this signing request.';
  END IF;

  UPDATE public.signing_requests
     SET status = 'cancelled',
         decline_reason = COALESCE(p_reason, decline_reason),
         updated_at = now()
   WHERE id = p_request_id
     AND status IN ('draft', 'sent', 'viewed');

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.signing_request_signers
     SET status = 'cancelled', updated_at = now()
   WHERE request_id = p_request_id AND status IN ('pending', 'sent', 'viewed');

  INSERT INTO public.signing_request_events (request_id, admin_id, event_type, actor, detail)
  VALUES (p_request_id, v_admin, 'cancelled',
          COALESCE((SELECT full_name FROM public.user_profiles WHERE id = auth.uid()), 'Staff'),
          COALESCE(p_reason, 'Withdrawn by staff.'));

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.signing_request_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signing_request_cancel(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. STATUS IN BULK
--
-- The certificate register renders a page of rows at a time and needs a signing
-- state for each. One call per row is the shape that turns a 50-row table into
-- 50 round trips, so this answers for a whole page at once — the same reason
-- the dashboards use an aggregate RPC rather than reducing over an array.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_status_for(
  p_source_table text,
  p_source_ids   uuid[]
)
RETURNS TABLE (
  source_id        uuid,
  request_id       uuid,
  status           text,
  doc_kind         text,
  document_name    text,
  signed_path      text,
  certificate_serial text,
  signers_total    integer,
  signers_signed   integer,
  sent_at          timestamptz,
  signed_at        timestamptz,
  released_at      timestamptz,
  decline_reason   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT DISTINCT ON (r.source_id)
         r.source_id, r.id, r.status, r.doc_kind, r.document_name,
         r.signed_path, r.certificate_serial,
         (SELECT count(*)::integer FROM public.signing_request_signers s WHERE s.request_id = r.id),
         (SELECT count(*)::integer FROM public.signing_request_signers s
           WHERE s.request_id = r.id AND s.status = 'signed'),
         r.sent_at, r.signed_at, r.released_at, r.decline_reason
    FROM public.signing_requests r
   WHERE r.source_table = p_source_table
     AND r.source_id = ANY(p_source_ids)
     AND ((r.admin_id = public.current_admin_id() AND public.is_staff_member())
          OR public.is_global_viewer())
   ORDER BY r.source_id,
            -- The newest attempt is the current one, EXCEPT that a released
            -- certificate outranks anything opened after it: releasing is
            -- terminal, and a later draft must not make an issued certificate
            -- look pending.
            (r.status = 'released') DESC,
            r.created_at DESC;
$fn$;

GRANT EXECUTE ON FUNCTION public.signing_status_for(text, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. RELEASE — the moment a signed document becomes the issued certificate
--
-- Called by the edge function under the service role once SignNow reports the
-- document complete and the signed PDF is in the bucket. It is idempotent: a
-- redelivered callback finds the request already released and changes nothing,
-- which matters because SignNow retries.
--
-- The serial is minted here if it was not minted at send time, so a released
-- certificate always carries one — the registry entry and the signed paper are
-- created in the same transaction or not at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_request_release(
  p_request_id  uuid,
  p_signed_path text,
  p_actor       text DEFAULT 'SignNow'
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r        record;
  v_serial text;
BEGIN
  SELECT * INTO r FROM public.signing_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such signing request.';
  END IF;

  IF r.status = 'released' THEN
    RETURN r.certificate_serial;      -- redelivery; nothing to do
  END IF;

  IF r.status NOT IN ('signed', 'sent', 'viewed') THEN
    RAISE EXCEPTION 'A % request cannot be released.', r.status;
  END IF;

  v_serial := r.certificate_serial;

  -- Mint the serial if the send path did not — a last resort, because the
  -- serial is supposed to be ON the page the officers signed. Only the share
  -- issuer is reachable from here: settlement_certificate_issue() gates on
  -- is_staff_member(), and this function runs under the service role with no
  -- auth.uid(), so calling it would raise rather than mint.
  --
  -- asset_valuation and contract have no per-type issuer of their own. The
  -- contract path already mints through esign_certificate_serial() when the PDF
  -- is sealed, and a valuation certificate is evidence for the register rather
  -- than an instrument. Both release without a serial.
  --
  -- Whatever happens here, it must not fail the release. The signatures are
  -- the thing being protected; a certificate that is signed and stored but
  -- unserialised is recoverable, and a webhook that 500s because minting threw
  -- is not — SignNow would retry it into the same failure forever.
  IF v_serial IS NULL AND r.doc_kind = 'share_certificate' THEN
    BEGIN
      v_serial := public.sacco_share_certificate_serial_internal(r.source_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.signing_request_events
        (request_id, admin_id, event_type, actor, detail)
      VALUES (p_request_id, r.admin_id, 'error', 'system',
              'Released without a serial: ' || SQLERRM);
    END;
  END IF;

  UPDATE public.signing_requests
     SET status = 'released',
         signed_path = COALESCE(p_signed_path, signed_path),
         certificate_serial = COALESCE(v_serial, certificate_serial),
         signed_at = COALESCE(signed_at, now()),
         released_at = now(),
         released_by = auth.uid(),
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.signing_request_events (request_id, admin_id, event_type, actor, detail, payload)
  VALUES (p_request_id, r.admin_id, 'released', p_actor,
          'Signed document stored and issued as the certificate of record.',
          jsonb_build_object('signed_path', p_signed_path, 'serial', v_serial));

  RETURN v_serial;
END;
$fn$;

-- Service role only: this is the function that turns a file into an issued
-- certificate, and nothing holding a user JWT gets to call it.
REVOKE ALL ON FUNCTION public.signing_request_release(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signing_request_release(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 14. MANUAL RELEASE — for tenants that turned auto_release off
--
-- Same operation, but performed by a person, and only once every signatory has
-- actually signed. The staff-facing wrapper exists so the service-role function
-- above never needs to be granted to authenticated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_request_release_manual(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.signing_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such signing request.'; END IF;

  IF NOT ((r.admin_id = public.current_admin_id() AND public.is_staff_member())
          OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not permitted to release this certificate.';
  END IF;

  IF r.status <> 'signed' OR r.signed_path IS NULL THEN
    RAISE EXCEPTION 'This document has not been fully signed yet.';
  END IF;

  RETURN public.signing_request_release(p_request_id, r.signed_path,
    COALESCE((SELECT full_name FROM public.user_profiles WHERE id = auth.uid()), 'Staff'));
END;
$fn$;

REVOKE ALL ON FUNCTION public.signing_request_release_manual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signing_request_release_manual(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 15. POLICY UPSERT — tenant owner only
--
-- Turning a signature requirement on changes what the tenant's staff are
-- allowed to hand out, so it is an owner decision, not a staff one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signing_policy_upsert(
  p_doc_kind      text,
  p_require       boolean,
  p_signatories   jsonb   DEFAULT '[]'::jsonb,
  p_signing_order text    DEFAULT 'sequential',
  p_expires_days  integer DEFAULT NULL,
  p_auto_release  boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin uuid := public.current_admin_id();
  v_role  text;
  v_id    uuid;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
  IF COALESCE(v_role, '') NOT IN ('admin', 'sacco_admin', 'super_admin', 'director') THEN
    RAISE EXCEPTION 'Only the account owner can change signing requirements.';
  END IF;

  INSERT INTO public.signing_policies
    (admin_id, doc_kind, require_signature, signatories, signing_order,
     expires_days, auto_release, updated_by)
  VALUES
    (v_admin, p_doc_kind, COALESCE(p_require, false),
     COALESCE(p_signatories, '[]'::jsonb),
     COALESCE(p_signing_order, 'sequential'), p_expires_days,
     COALESCE(p_auto_release, true), auth.uid())
  ON CONFLICT (admin_id, doc_kind) DO UPDATE
    SET require_signature = EXCLUDED.require_signature,
        signatories       = EXCLUDED.signatories,
        signing_order     = EXCLUDED.signing_order,
        expires_days      = EXCLUDED.expires_days,
        auto_release      = EXCLUDED.auto_release,
        updated_by        = EXCLUDED.updated_by,
        updated_at        = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.signing_policy_upsert(text, boolean, jsonb, text, integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signing_policy_upsert(text, boolean, jsonb, text, integer, boolean)
  TO authenticated;

COMMIT;

-- ============================================================================
-- RLS, GRANTS, STORAGE
-- ============================================================================

BEGIN;

ALTER TABLE public.signing_policies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_request_signers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_request_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_webhook_deliveries  ENABLE ROW LEVEL SECURITY;

-- Read-only to staff of the owning tenant. Every write goes through a
-- SECURITY DEFINER function above or the service role, which is what makes
-- "released" mean something: no session can set that column directly.
DROP POLICY IF EXISTS "tenant_read_signing_policies" ON public.signing_policies;
CREATE POLICY "tenant_read_signing_policies" ON public.signing_policies
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer());

DROP POLICY IF EXISTS "tenant_read_signing_requests" ON public.signing_requests;
CREATE POLICY "tenant_read_signing_requests" ON public.signing_requests
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer());

DROP POLICY IF EXISTS "tenant_read_signing_signers" ON public.signing_request_signers;
CREATE POLICY "tenant_read_signing_signers" ON public.signing_request_signers
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer());

DROP POLICY IF EXISTS "tenant_read_signing_events" ON public.signing_request_events;
CREATE POLICY "tenant_read_signing_events" ON public.signing_request_events
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer());

-- Raw callbacks stay service-role only. They carry SignNow's payload verbatim,
-- including invite ids and signer emails, and nothing in the app needs them —
-- signing_request_events is the readable trail.

GRANT SELECT ON public.signing_policies        TO authenticated;
GRANT SELECT ON public.signing_requests        TO authenticated;
GRANT SELECT ON public.signing_request_signers TO authenticated;
GRANT SELECT ON public.signing_request_events  TO authenticated;

-- ---------------------------------------------------------------------------
-- 16. STORAGE — signed-certificates
--
-- PRIVATE. A certificate names a member, their holding and their member
-- number; the esign-documents bucket was made private in 20260731091000 for
-- exactly that reason and this one is born that way. Reads go through a
-- short-lived signed URL (see src/lib/storageUrl.js).
--
-- Paths are `<admin_id>/<doc_kind>/<request_id>-<draft|signed>.pdf`, so the
-- leading folder is the tenant and the policies below can compare it to
-- current_admin_id() without a join.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-certificates', 'signed-certificates', false, 26214400,
        ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "signed_certs_tenant_read" ON storage.objects;
CREATE POLICY "signed_certs_tenant_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'signed-certificates'
         AND ((storage.foldername(name))[1] = public.current_admin_id()::text
              OR public.is_global_viewer()));

-- Staff upload the DRAFT they are about to send. The signed copy is written by
-- the edge function under the service role, which bypasses RLS entirely.
--
-- The global-viewer arm mirrors signing_request_open(), which lets a platform
-- operator open a request against another tenant's record. Without it that path
-- half-works: the row is created with a path in the other tenant's folder, and
-- then the upload is refused — leaving a draft request pointing at a file that
-- was never written.
DROP POLICY IF EXISTS "signed_certs_tenant_write" ON storage.objects;
CREATE POLICY "signed_certs_tenant_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'signed-certificates'
              AND (((storage.foldername(name))[1] = public.current_admin_id()::text
                    AND public.is_staff_member())
                   OR public.is_global_viewer()));

-- No UPDATE or DELETE policy, deliberately. A signed certificate is evidence;
-- overwriting one in place would destroy the only copy of what was signed.

COMMIT;

-- ============================================================================
-- 17. COMMENTS — what a reader of the schema needs to know
-- ============================================================================
COMMENT ON TABLE public.signing_requests IS
  'One document sent for signature before issuance. status=released is the only '
  'state in which signed_path is the issued certificate of record.';

COMMENT ON COLUMN public.signing_requests.draft_digest IS
  'SHA-256 of the PDF bytes uploaded to the provider. Lets a returned document be '
  'checked against the one we sent, rather than trusted because it came back.';

COMMENT ON COLUMN public.signing_requests.certificate_serial IS
  'Platform serial (system_certificates) printed on the page the signatories sign. '
  'Minted before sending where the issuer allows it, at release otherwise.';

COMMENT ON TABLE public.signing_policies IS
  'Per-tenant, per-document-kind signature requirement. An absent row means not '
  'required — which is why applying this migration changes nothing until a tenant opts in.';
