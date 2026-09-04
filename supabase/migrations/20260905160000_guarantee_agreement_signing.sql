-- ============================================================================
-- THE GUARANTEE AGREEMENT, EXECUTED THROUGH SIGNNOW  (SACCOS ONLY)
--
-- WHAT WAS MISSING
-- ----------------
-- A member who confirms a guarantee (20260904160000) pledges their own
-- deposits and shares against somebody else's debt, "without further notice".
-- What that act leaves behind is a row: status='accepted', a hash, a typed
-- name. Every one of those facts is ours. When the society later has to
-- recover from that guarantor — or defend the recovery to a tribunal, a
-- co-operative auditor or the guarantor's own advocate — the only paper it can
-- produce is a screen this platform drew about itself.
--
-- The two-step flow is strong evidence of INTENT: the wording was hashed, the
-- review was fresh, the signature matched the register. It is not an executed
-- instrument. Nothing carries the society's countersignature, and nothing was
-- witnessed anywhere the guarantor could not later say we controlled.
--
-- WHAT THIS ADDS
-- --------------
-- A fifth document kind for the signing layer built in 20260901160000:
--
--   guarantee_agreement  ->  sacco_loan_guarantees
--
-- so a CONFIRMED guarantee can be rendered as the agreement it actually is,
-- sent through the society's own SignNow account, signed by the guarantor and
-- countersigned by the society's officer, and stored as the executed copy.
-- Everything else — the upload, the invite, the callback, the release, the
-- private bucket — is machinery that already exists. This file teaches it one
-- more kind and states the rules peculiar to that kind.
--
-- WHY IT IS SACCO-ONLY BY CONSTRUCTION, NOT BY UI
-- -----------------------------------------------
-- The kind is welded to sacco_loan_guarantees by
-- signing_requests_kind_source_chk. Every row in that table has a NOT NULL
-- sacco_id and cascades from a sacco. So there is no request of this kind that
-- is not a sacco's, whatever a screen offers or a client posts.
--
-- THE TWO RULES THAT ARE NOT IN THE GENERIC LAYER
-- -----------------------------------------------
--   1. FINALIZED ONLY. A request may be opened only against status='accepted'.
--      Sending the agreement for a guarantee the member has not confirmed — or
--      has declined — would put a document in front of them for signature that
--      they never agreed to, which is the one thing the two-step flow exists
--      to prevent.
--
--   2. THE SAME AGREEMENT THEY CONFIRMED. accepted_terms_hash must still equal
--      the hash sacco_loan_guarantee_terms() renders now. If the loan was
--      edited after acceptance, or the clauses were versioned up, the current
--      wording is NOT what was agreed and must not go out under the
--      guarantor's name. Refused, with a sentence saying so.
--
-- Both are enforced in signing_request_open(), so they hold for a caller who
-- never opens the screen.
--
-- WHAT THE MEMBER GETS
-- --------------------
-- Members are not staff: is_staff_member() excludes 'sacco_member', so they
-- cannot read signing_requests and signing_status_for() answers them nothing.
-- sacco_guarantee_signing_states() is their window — the parties to an
-- agreement, and only they, see where its execution has got to and open the
-- executed copy.
--
-- SAFE ON A LIVE PLATFORM
--   Nothing changes for any existing guarantee or certificate. An absent
--   signing_policies row still means "not required", and a society that never
--   turns this on keeps exactly the flow it has today.
--
-- DEPENDS ON  20260901160000_signnow_certificate_signing
--             20260904160000_sacco_loan_guarantees
-- Idempotent throughout: safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. VOCABULARY — the fifth kind
--
-- Re-stated in full rather than patched, because a CHECK constraint is a
-- sentence: reading the whole list is how the next person learns what may be
-- signed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.signing_policies
  DROP CONSTRAINT IF EXISTS signing_policies_kind_chk;
ALTER TABLE public.signing_policies
  ADD CONSTRAINT signing_policies_kind_chk CHECK (doc_kind IN (
    'share_certificate', 'settlement_certificate', 'asset_valuation',
    'contract', 'guarantee_agreement'));

ALTER TABLE public.signing_requests
  DROP CONSTRAINT IF EXISTS signing_requests_kind_chk;
ALTER TABLE public.signing_requests
  ADD CONSTRAINT signing_requests_kind_chk CHECK (doc_kind IN (
    'share_certificate', 'settlement_certificate', 'asset_valuation',
    'contract', 'guarantee_agreement'));

-- The pairing is what makes this kind sacco-only: sacco_loan_guarantees is the
-- only table it may point at, and that table is a sacco's by definition.
ALTER TABLE public.signing_requests
  DROP CONSTRAINT IF EXISTS signing_requests_kind_source_chk;
ALTER TABLE public.signing_requests
  ADD CONSTRAINT signing_requests_kind_source_chk CHECK (
    (doc_kind = 'share_certificate'      AND source_table = 'sacco_share_certificates')
 OR (doc_kind = 'settlement_certificate' AND source_table = 'installment_plans')
 OR (doc_kind = 'asset_valuation'        AND source_table = 'sacco_fixed_assets')
 OR (doc_kind = 'guarantee_agreement'    AND source_table = 'sacco_loan_guarantees')
 OR (doc_kind = 'contract'               AND source_table IN
       ('generated_contracts', 'company_contracts', 'esign_documents'))
  );

COMMIT;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 2. WHO OWNS THE SOURCE RECORD — plus guarantees
--
-- Unchanged from 20260901160000 except for the sacco_loan_guarantees branch.
-- The label is what an officer sees in their SignNow inbox and on the request
-- row, so it names both parties: who is standing behind whom is the only thing
-- that distinguishes two guarantees on the same loan.
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

  ELSIF p_source_table = 'sacco_loan_guarantees' THEN
    SELECT g.admin_id, g.sacco_id,
           'Guarantee Agreement ' || COALESCE(g.ref_no, '') ||
             COALESCE(' — ' || gm.full_name, '') ||
             COALESCE(' for ' || bm.full_name, ''),
           true
      INTO admin_id, sacco_id, label, resolved
      FROM public.sacco_loan_guarantees g
      LEFT JOIN public.sacco_members gm ON gm.id = g.guarantor_member_id
      LEFT JOIN public.sacco_members bm ON bm.id = g.borrower_member_id
     WHERE g.id = p_source_id;

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
-- 3. MAY THIS GUARANTEE BE SENT FOR SIGNATURE?
--
-- A SENTENCE, NOT AN EXCEPTION — the same shape as
-- sacco_loan_guarantee_capacity_block(), and for the same reason: the screen
-- needs to grey a button out and say why, while signing_request_open() needs
-- to refuse. Two readings of one rule drift; this is the rule, stated once,
-- and both callers use it.
--
-- Returns NULL when the agreement may be sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_guarantee_signing_block(p_guarantee_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  g      public.sacco_loan_guarantees%ROWTYPE;
  v_live text;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = p_guarantee_id;
  IF g.id IS NULL THEN
    RETURN 'That guarantee no longer exists.';
  END IF;

  -- RULE 1 — finalized only. Each refusal names the state it is refusing,
  -- because "not accepted" covers four different situations and an officer
  -- needs to know which one they are looking at.
  IF g.status IN ('requested', 'under_review') THEN
    RETURN 'The guarantor has not confirmed this agreement yet. Only a confirmed guarantee can be sent for signature.';
  END IF;
  IF g.status = 'declined' THEN
    RETURN 'The guarantor declined this request, so there is no agreement to execute.';
  END IF;
  IF g.status = 'cancelled' THEN
    RETURN 'This request was withdrawn, so there is no agreement to execute.';
  END IF;
  IF g.status = 'released' THEN
    RETURN 'This guarantee has already been released — the facility it stood behind is settled.';
  END IF;
  IF g.status <> 'accepted' THEN
    RETURN format('This guarantee is %s and cannot be sent for signature.', g.status);
  END IF;

  -- One executed agreement per guarantee. Re-sending after a decline or a
  -- withdrawal is allowed, and is how a stalled invite is recovered; producing
  -- a SECOND executed copy is not, because then two signed documents claim to
  -- be the same undertaking and nothing says which one binds.
  IF EXISTS (
    SELECT 1 FROM public.signing_requests r
     WHERE r.source_table = 'sacco_loan_guarantees'
       AND r.source_id    = p_guarantee_id
       AND r.status       = 'released'
  ) THEN
    RETURN 'The executed agreement for this guarantee has already been issued.';
  END IF;

  -- RULE 2 — the same agreement they confirmed.
  --
  -- terms() re-renders from the loan and the member records as they stand NOW.
  -- If that no longer hashes to what the guarantor put their name to, the
  -- document this would send is not the one they agreed to: the loan was
  -- edited, or the clauses were versioned up. Sending it anyway would collect a
  -- signature on terms nobody consented to.
  v_live := public.sacco_loan_guarantee_terms(p_guarantee_id) ->> 'hash';
  IF g.accepted_terms_hash IS NULL OR g.accepted_terms_hash IS DISTINCT FROM v_live THEN
    RETURN 'The loan or the agreement wording has changed since the guarantor confirmed it, so the agreement they accepted can no longer be reproduced. Ask them to confirm the current terms before sending it out.';
  END IF;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_guarantee_signing_block(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_guarantee_signing_block(uuid) TO authenticated;

COMMENT ON FUNCTION public.sacco_guarantee_signing_block(uuid) IS
  'Why this guarantee cannot be sent for e-signature, as a sentence, or NULL when it can. '
  'Shown by the screen and enforced by signing_request_open() — one rule, two readers.';

-- ---------------------------------------------------------------------------
-- 4. OPEN A REQUEST — now with the guarantee gate
--
-- Unchanged from 20260901160000 except for the guarantee_agreement branch. It
-- sits immediately after the ownership check and before anything is written,
-- so a refusal leaves no row behind.
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
  v_block    text;
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

  -- A guarantee agreement is an executed instrument, not a certificate about a
  -- record: it may only be raised on a guarantee the member has actually
  -- confirmed, in the wording they confirmed. See §3.
  IF p_doc_kind = 'guarantee_agreement' THEN
    v_block := public.sacco_guarantee_signing_block(p_source_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION '%', v_block;
    END IF;
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
-- 4b. A SERIAL, SO A STRANGER CAN CHECK IT
--
-- The document this produces is shown to people with no account here — a bank
-- asked to lend against the security, an advocate acting for the guarantor, a
-- co-operative officer auditing the society's exposure. The serial registry
-- (20260901140000) exists precisely for that reader: it is the one number on
-- the page they can bring back to /verify-certificate and have answered
-- without taking the society's word for anything.
--
-- 'GTE' is added to the serial's type code so the number itself says what kind
-- of document it belongs to. The registry's writer, its verifier and the desk
-- are all type-agnostic already, so this is the whole of the change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_certificate_next_serial(p_cert_type text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';
  v_code   text;
  v_seq    bigint;
  v_tail   text := '';
  i        integer;
BEGIN
  v_code := CASE lower(COALESCE(p_cert_type, ''))
              WHEN 'share'      THEN 'SHR'
              WHEN 'settlement' THEN 'STL'
              WHEN 'esignature' THEN 'ESG'
              WHEN 'guarantee'  THEN 'GTE'
              ELSE 'GEN'
            END;

  v_seq := nextval('public.system_certificate_seq');

  FOR i IN 1..4 LOOP
    v_tail := v_tail || substr(
      c_alphabet,
      1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(c_alphabet)),
      1);
  END LOOP;

  RETURN 'ARA-' || v_code || '-' || to_char(CURRENT_DATE, 'YYYY') || '-'
         || lpad(v_seq::text, 6, '0') || '-' || v_tail;
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_certificate_next_serial(text)
  FROM PUBLIC, anon, authenticated;

-- The per-type issuer, in the shape of sacco_share_certificate_serial(): staff
-- of the owning society only, idempotent on the guarantee, and refusing to
-- serialise anything the guarantor has not confirmed.
--
-- WHAT GOES IN `facts` IS WHAT A VERIFIER SEES. The amount, the parties, the
-- facility and the digest of the agreed terms — enough for the reader to check
-- that the paper in their hand says what the registry says, which is the
-- difference between "this serial exists" and "this document is genuine".
CREATE OR REPLACE FUNCTION public.sacco_guarantee_agreement_serial(p_guarantee_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  g        public.sacco_loan_guarantees%ROWTYPE;
  l        public.sacco_loans%ROWTYPE;
  s        public.saccos%ROWTYPE;
  borrower public.sacco_members%ROWTYPE;
  guarant  public.sacco_members%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = p_guarantee_id;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found'; END IF;

  -- `admin_id IS NOT NULL` is not belt-and-braces. Without it a row whose
  -- tenant was never stamped makes the whole comparison NULL, NOT NULL is
  -- NULL, and an IF on NULL does not fire — so the refusal would silently
  -- become permission for exactly the rows that can least afford it.
  IF NOT ((g.admin_id IS NOT NULL
           AND g.admin_id = public.current_admin_id()
           AND public.is_staff_member())
          OR public.is_global_viewer()) THEN
    RAISE EXCEPTION 'Not permitted to serialise this agreement.';
  END IF;

  -- A serial is the platform asserting "this document is ours and it is
  -- unaltered". Minting one for an agreement nobody has confirmed would assert
  -- it about a draft.
  IF g.status NOT IN ('accepted', 'released') THEN
    RAISE EXCEPTION 'Only a confirmed guarantee agreement can be serialised.';
  END IF;

  SELECT * INTO l        FROM public.sacco_loans   WHERE id = g.loan_id;
  SELECT * INTO s        FROM public.saccos        WHERE id = g.sacco_id;
  SELECT * INTO borrower FROM public.sacco_members WHERE id = g.borrower_member_id;
  SELECT * INTO guarant  FROM public.sacco_members WHERE id = g.guarantor_member_id;

  RETURN public.system_certificate_issue(
    'guarantee',
    'sacco_loan_guarantees',
    g.id,
    'Loan Guarantee Agreement',
    g.admin_id,
    g.sacco_id,
    s.name,
    guarant.full_name,
    guarant.member_no,
    jsonb_build_object(
      'reference',         g.ref_no,
      'amount_guaranteed', g.amount_guaranteed,
      'borrower',          borrower.full_name,
      'borrower_no',       borrower.member_no,
      'loan_principal',    l.principal,
      'loan_term_months',  l.term_months,
      'terms_version',     g.terms_version,
      'terms_digest',      g.accepted_terms_hash,
      'confirmed_at',      g.accepted_at,
      'signed_as',         g.signature_name),
    COALESCE(g.accepted_at::date, CURRENT_DATE),
    auth.uid()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_guarantee_agreement_serial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_guarantee_agreement_serial(uuid) TO authenticated;

COMMENT ON FUNCTION public.sacco_guarantee_agreement_serial(uuid) IS
  'Mint (or return) the platform serial printed on a guarantee agreement. Idempotent per '
  'guarantee, so a re-send after a declined invite reuses the number already on the register.';

-- ---------------------------------------------------------------------------
-- 5. THE MEMBER'S WINDOW
--
-- A guarantor is the person being asked to sign, and the borrower is the
-- person whose facility depends on it — but neither is staff, so neither can
-- read signing_requests at all. Without this they would receive a SignNow
-- invite for a document their own portal knows nothing about.
--
-- Answers for a whole page in one call, the same shape and for the same reason
-- as signing_status_for(): a member with eight guarantees is eight round trips
-- otherwise.
--
-- `required` travels with each row because "nothing has been sent" means two
-- different things — the society does not require execution, or it does and
-- has not got to it yet — and the portal has to say which.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_guarantee_signing_states(p_guarantee_ids uuid[])
RETURNS TABLE (
  guarantee_id   uuid,
  required       boolean,
  request_id     uuid,
  status         text,
  document_name  text,
  signed_path    text,
  signers_total  integer,
  signers_signed integer,
  sent_at        timestamptz,
  signed_at      timestamptz,
  released_at    timestamptz,
  decline_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH mine AS (
    SELECT g.id, g.admin_id
      FROM public.sacco_loan_guarantees g
     WHERE g.id = ANY(p_guarantee_ids)
       -- The parties to the agreement, and the society's own staff. Nobody
       -- else, at any privilege short of a platform operator.
       AND (g.guarantor_member_id = public.current_sacco_member_id()
            OR g.borrower_member_id = public.current_sacco_member_id()
            OR (public.is_staff_member() AND g.admin_id = public.current_admin_id())
            OR public.is_global_viewer())
  )
  SELECT DISTINCT ON (m.id)
         m.id,
         COALESCE((SELECT sp.require_signature
                     FROM public.signing_policies sp
                    WHERE sp.admin_id = m.admin_id
                      AND sp.doc_kind = 'guarantee_agreement'), false),
         r.id, r.status, r.document_name, r.signed_path,
         (SELECT count(*)::integer FROM public.signing_request_signers s WHERE s.request_id = r.id),
         (SELECT count(*)::integer FROM public.signing_request_signers s
           WHERE s.request_id = r.id AND s.status = 'signed'),
         r.sent_at, r.signed_at, r.released_at, r.decline_reason
    FROM mine m
    LEFT JOIN public.signing_requests r
      ON r.source_table = 'sacco_loan_guarantees'
     AND r.source_id    = m.id
     AND r.doc_kind     = 'guarantee_agreement'
   -- Same precedence as signing_status_for(): an executed agreement outranks
   -- anything opened after it, so a later draft cannot make a document that
   -- has been issued look pending.
   ORDER BY m.id, (r.status = 'released') DESC NULLS LAST, r.created_at DESC NULLS LAST;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_guarantee_signing_states(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_guarantee_signing_states(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.sacco_guarantee_signing_states(uuid[]) IS
  'Execution state of guarantee agreements, readable by the parties themselves — '
  'members are not staff, so signing_status_for() answers them nothing.';

-- ---------------------------------------------------------------------------
-- 6. THE GUARANTEE'S OWN HISTORY LEARNS ABOUT THE SIGNATURE
--
-- sacco_loan_guarantee_events is the trail somebody reads when the agreement is
-- questioned. It would be a strange trail that recorded the member confirming
-- the terms and then went silent on the document that was executed off the back
-- of it — the reader would have to know signing_requests exists, and to think
-- to look there.
--
-- Written by trigger rather than by the release path, because release happens
-- under the service role inside a webhook. A callback that 500s is retried into
-- the same failure forever, so nothing here may raise: the FK is checked before
-- the insert, and the whole body is exception-guarded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_guarantee_signing_trail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  g      public.sacco_loan_guarantees%ROWTYPE;
  v_type text;
  v_text text;
BEGIN
  IF NEW.doc_kind <> 'guarantee_agreement' OR NEW.source_table <> 'sacco_loan_guarantees' THEN
    RETURN NEW;
  END IF;

  -- Nested rather than ANDed: OLD is unassigned on INSERT, and PostgreSQL does
  -- not promise to short-circuit the second operand before evaluating it.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Only the four that change what the society knows about the agreement.
  -- 'viewed' is noise here: it says an officer opened their email.
  v_type := CASE NEW.status
    WHEN 'sent'     THEN 'signature_sent'
    WHEN 'released' THEN 'executed'
    WHEN 'declined' THEN 'signature_declined'
    WHEN 'expired'  THEN 'signature_expired'
    ELSE NULL END;
  IF v_type IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = NEW.source_id;
  IF g.id IS NULL THEN RETURN NEW; END IF;

  v_text := CASE NEW.status
    WHEN 'sent'     THEN 'Sent for e-signature through SignNow.'
    WHEN 'released' THEN 'Executed agreement returned by SignNow and stored as the copy of record.'
    WHEN 'declined' THEN COALESCE('A signatory declined: ' || NEW.decline_reason,
                                  'A signatory declined to sign.')
    WHEN 'expired'  THEN 'The signing invite lapsed before everyone signed.'
    END;

  BEGIN
    INSERT INTO public.sacco_loan_guarantee_events
      (admin_id, sacco_id, guarantee_id, event_type, terms_hash, status_after,
       detail, actor_id, actor_name)
    VALUES
      (g.admin_id, g.sacco_id, g.id, v_type, g.accepted_terms_hash, g.status,
       v_text, auth.uid(), 'SignNow');
  EXCEPTION WHEN OTHERS THEN
    -- The signature is the thing being protected. A trail entry that could not
    -- be written is recoverable from signing_request_events; a webhook that
    -- fails because of one is not.
    NULL;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_signing_requests_guarantee_trail ON public.signing_requests;
CREATE TRIGGER trg_signing_requests_guarantee_trail
  AFTER INSERT OR UPDATE OF status ON public.signing_requests
  FOR EACH ROW EXECUTE FUNCTION public.sacco_guarantee_signing_trail();

COMMIT;

-- ============================================================================
-- STORAGE — the parties may read their own executed agreement
-- ============================================================================

BEGIN;

-- The bucket's standing read policy is tenant-wide and reaches nothing a
-- member can name. This one is narrow on purpose: EXACTLY the signed file of
-- EXACTLY the guarantees this member is a party to, and only once released.
-- A draft is not readable by a member at all — an unexecuted agreement is not
-- theirs to hold, and a DRAFT watermark is a weaker answer than nothing.
DROP POLICY IF EXISTS "guarantee_agreement_party_read" ON storage.objects;
CREATE POLICY "guarantee_agreement_party_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'signed-certificates'
    AND EXISTS (
      SELECT 1
        FROM public.signing_requests r
        JOIN public.sacco_loan_guarantees g ON g.id = r.source_id
       WHERE r.doc_kind     = 'guarantee_agreement'
         AND r.source_table = 'sacco_loan_guarantees'
         AND r.status       = 'released'
         AND r.signed_path  = storage.objects.name
         AND (g.guarantor_member_id = public.current_sacco_member_id()
              OR g.borrower_member_id = public.current_sacco_member_id())
    )
  );

COMMIT;

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================
COMMENT ON CONSTRAINT signing_requests_kind_source_chk ON public.signing_requests IS
  'A request must certify the kind of record its doc_kind names. guarantee_agreement is '
  'welded to sacco_loan_guarantees, which is what makes that kind sacco-only in the database '
  'rather than only in the screens.';
