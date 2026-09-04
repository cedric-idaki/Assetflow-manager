-- ============================================================================
-- Certificate serial numbers & authenticity verification
--
-- The system prints three things that call themselves certificates:
--
--   1. SACCO share certificate       — sacco_share_certificates
--   2. Certificate of Full Settlement & Ownership Transfer — printed straight
--                                      off an installment_plans row
--   3. Electronic Signature Certificate — the page appended to every sealed PDF
--
-- None of them could be verified, for three different reasons:
--
--   * The share certificate's certificate_no (CERT-000001) is unique only
--     within one society — uq_sacco_share_cert_no is on (sacco_id,
--     certificate_no). Two saccos on this platform both hand out CERT-000001,
--     so the number on the paper does not identify a certificate.
--   * The settlement letter's reference was SL-${Date.now().toString(36)},
--     minted in the browser and stored nowhere. Re-opening the same settled
--     plan produced a DIFFERENT reference every time, and no reference on any
--     letter ever issued could be looked up, because none was ever recorded.
--   * The e-signature certificate page carried a hash but no serial, and that
--     hash is a base64 slice of the signer's own inputs — not a lookup key.
--
-- This migration gives every one of them a single, globally unique, system-
-- generated serial, held in one registry that any authorised user can query.
--
--   1. system_certificates          — one row per certificate ever issued,
--                                     whatever kind. Serial is unique
--                                     platform-wide, not per tenant.
--   2. system_certificate_verifications — append-only log of who checked what.
--   3. system_certificate_issue()   — the only writer. Internal: no role holds
--                                     EXECUTE on it. Idempotent per source row.
--   4. Three thin per-type issuers  — each loads the facts from the database
--                                     itself and calls (3). Nothing a browser
--                                     sends can end up on a certificate face.
--   5. system_certificate_verify()  — the query. An unknown serial returns zero
--                                     rows; a known one returns the face of the
--                                     certificate plus a digest check.
--   6. system_certificate_revoke()  — staff of the issuing tenant only.
--
-- SERIAL FORMAT
--   ARA-SHR-2026-000412-7QK3
--    |   |    |     |     |
--    |   |    |     |     +-- 4 random chars: makes serials unguessable, so
--    |   |    |     |         holding one is not a licence to walk the rest
--    |   |    |     +-------- platform-wide sequence, never reused
--    |   |    +-------------- year of issue
--    |   +------------------- kind: SHR | STL | ESG
--    +----------------------- platform prefix
--
--   Lookup is forgiving: serial_key strips every non-alphanumeric and upper-
--   cases, so "ara shr 2026 000412 7qk3" finds the same row as the printed
--   form. The unique index is on serial_key, so no two serials can collide
--   after normalisation either.
--
-- WHY A DIGEST
--   Every row stores sha256 over its own identifying facts. Nothing outside a
--   SECURITY DEFINER function can write this table — RLS grants SELECT only —
--   so the digest is not the access control. It is the tamper-EVIDENCE: a row
--   edited by anything that bypasses these functions (a service-role script, a
--   restore of a doctored dump) stops matching its own digest, and verify()
--   reports digest_ok = false instead of quietly blessing it.
--
-- IDEMPOTENCE
--   (source_table, source_id) is unique. Issuing twice for the same record
--   returns the serial already on it. That is what makes the settlement letter
--   stable: the same settled plan yields the same serial forever, however many
--   times the letter is reprinted, from whichever portal.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. THE REGISTRY
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.system_certificate_seq;

CREATE TABLE IF NOT EXISTS public.system_certificates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial         TEXT NOT NULL,
  -- Normalised lookup key. Generated, so it can never drift from serial.
  serial_key     TEXT GENERATED ALWAYS AS
                   (regexp_replace(upper(serial), '[^A-Z0-9]', '', 'g')) STORED,

  cert_type      TEXT NOT NULL,          -- share | settlement | esignature
  admin_id       UUID,                   -- issuing tenant
  sacco_id       UUID,                   -- set when a society issued it

  -- What record this certificate certifies. Unique together: one serial per
  -- certified record, for the life of that record.
  source_table   TEXT NOT NULL,
  source_id      UUID NOT NULL,

  title          TEXT NOT NULL,          -- "Share Certificate"
  issuer_name    TEXT,                   -- the society / company on the face
  subject_name   TEXT,                   -- who it was issued to
  subject_ref    TEXT,                   -- member no. / account no.

  -- The figures printed on the face, exactly as issued. Kept so verification
  -- can answer "does this paper say what the registry says", not merely
  -- "does this serial exist".
  facts          JSONB NOT NULL DEFAULT '{}'::jsonb,
  digest         TEXT NOT NULL,

  issued_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by      UUID,

  status         TEXT NOT NULL DEFAULT 'active',  -- active | superseded | revoked
  superseded_by  UUID,
  revoked_at     TIMESTAMPTZ,
  revoked_by     UUID,
  revoked_reason TEXT,

  verify_count     INTEGER NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.system_certificates
    ADD CONSTRAINT system_certificates_status_chk
    CHECK (status IN ('active', 'superseded', 'revoked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_cert_serial_key
  ON public.system_certificates(serial_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_cert_source
  ON public.system_certificates(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_system_cert_admin
  ON public.system_certificates(admin_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_cert_type
  ON public.system_certificates(cert_type, status);
CREATE INDEX IF NOT EXISTS idx_system_cert_sacco
  ON public.system_certificates(sacco_id) WHERE sacco_id IS NOT NULL;

COMMENT ON TABLE public.system_certificates IS
  'One row per certificate the platform has ever issued, of any kind. serial is '
  'unique platform-wide, unlike sacco_share_certificates.certificate_no which is '
  'unique only within one society. Written exclusively by SECURITY DEFINER '
  'functions; RLS grants SELECT only.';

COMMENT ON COLUMN public.system_certificates.digest IS
  'sha256 over the identifying facts. Tamper-evidence, not access control: a row '
  'altered outside system_certificate_issue() stops matching and verify() flags it.';

-- ----------------------------------------------------------------------------
-- 2. VERIFICATION LOG — append-only. Who asked about which serial, and what
--    they were told. A run of failed lookups is the signal that somebody is
--    guessing at serials.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_certificate_verifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id   UUID REFERENCES public.system_certificates(id) ON DELETE SET NULL,
  serial_query     TEXT NOT NULL,        -- what was typed, normalised
  found            BOOLEAN NOT NULL,
  result_status    TEXT,                 -- status at the moment of the check
  checked_by       UUID,
  checked_by_admin UUID,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_cert_verif_cert
  ON public.system_certificate_verifications(certificate_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_cert_verif_admin
  ON public.system_certificate_verifications(checked_by_admin, checked_at DESC);

-- ----------------------------------------------------------------------------
-- 3. SERIAL MINTING
--    The random tail comes from an alphabet with I, O, 0, 1 and U removed:
--    nothing a person reading a printed certificate aloud can confuse, and no
--    accidental words in the tail.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. THE ONLY WRITER
--    Idempotent on (source_table, source_id): a second call for a record that
--    already holds a serial returns that serial and changes nothing. Its
--    callers are the per-type issuers in section 5, which is why this one is
--    granted to no role at all — a browser can never choose what a certificate
--    says about itself.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_certificate_issue(
  p_cert_type    text,
  p_source_table text,
  p_source_id    uuid,
  p_title        text,
  p_admin_id     uuid,
  p_sacco_id     uuid    DEFAULT NULL,
  p_issuer_name  text    DEFAULT NULL,
  p_subject_name text    DEFAULT NULL,
  p_subject_ref  text    DEFAULT NULL,
  p_facts        jsonb   DEFAULT '{}'::jsonb,
  p_issued_on    date    DEFAULT NULL,
  p_issued_by    uuid    DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_serial text;
  v_on     date  := COALESCE(p_issued_on, CURRENT_DATE);
  v_facts  jsonb := COALESCE(p_facts, '{}'::jsonb);
  v_digest text;
  v_tries  integer := 0;
BEGIN
  IF p_source_id IS NULL OR COALESCE(p_source_table, '') = '' THEN
    RAISE EXCEPTION 'A certificate must certify a record.';
  END IF;

  -- Already serialised? Hand back the same number — reprints must not mint.
  SELECT serial INTO v_serial
    FROM public.system_certificates
   WHERE source_table = p_source_table AND source_id = p_source_id;
  IF v_serial IS NOT NULL THEN RETURN v_serial; END IF;

  -- The random tail makes a collision vanishingly unlikely, but the unique
  -- index is the authority, so retry rather than fail the caller's certificate.
  LOOP
    v_tries  := v_tries + 1;
    v_serial := public.system_certificate_next_serial(p_cert_type);
    -- jsonb renders with sorted keys, so this digest input is canonical.
    v_digest := encode(extensions.digest(
      v_serial || '|' || COALESCE(p_subject_name, '') || '|' || COALESCE(p_subject_ref, '')
                || '|' || v_on::text || '|' || v_facts::text, 'sha256'), 'hex');

    BEGIN
      INSERT INTO public.system_certificates
        (serial, cert_type, admin_id, sacco_id, source_table, source_id, title,
         issuer_name, subject_name, subject_ref, facts, digest, issued_on, issued_by)
      VALUES
        (v_serial, lower(p_cert_type), p_admin_id, p_sacco_id, p_source_table, p_source_id,
         p_title, p_issuer_name, p_subject_name, p_subject_ref, v_facts, v_digest,
         v_on, COALESCE(p_issued_by, auth.uid()));
      RETURN v_serial;
    EXCEPTION
      WHEN unique_violation THEN
        -- Lost a race on (source_table, source_id)? The other transaction's
        -- serial is the right answer for both of us. Otherwise the serial
        -- itself collided, so mint another.
        SELECT serial INTO v_serial
          FROM public.system_certificates
         WHERE source_table = p_source_table AND source_id = p_source_id;
        IF v_serial IS NOT NULL THEN RETURN v_serial; END IF;
        IF v_tries >= 5 THEN RAISE; END IF;
    END;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_certificate_issue(text, text, uuid, text, uuid, uuid, text, text, text, jsonb, date, uuid)
  FROM PUBLIC, anon, authenticated;

-- Mark a certificate superseded when its record is reissued. Same rule as the
-- share register: history is kept, never deleted.
CREATE OR REPLACE FUNCTION public.system_certificate_supersede(
  p_source_table text,
  p_source_id    uuid,
  p_new_serial   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_new uuid;
BEGIN
  IF p_new_serial IS NOT NULL THEN
    SELECT id INTO v_new FROM public.system_certificates WHERE serial = p_new_serial;
  END IF;

  UPDATE public.system_certificates
     SET status = 'superseded',
         superseded_by = COALESCE(v_new, superseded_by),
         updated_at = now()
   WHERE source_table = p_source_table
     AND source_id = p_source_id
     AND status = 'active';
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_certificate_supersede(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4b. SHARE CERTIFICATES CARRY THEIR SERIAL ON THE REGISTER
--     Denormalised so the member portal and the printed certificate read it
--     straight off the row they already hold, without a registry lookup.
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_share_certificates
  ADD COLUMN IF NOT EXISTS serial TEXT;

CREATE INDEX IF NOT EXISTS idx_sacco_share_certs_serial
  ON public.sacco_share_certificates(serial) WHERE serial IS NOT NULL;

COMMENT ON COLUMN public.sacco_share_certificates.serial IS
  'Platform-wide serial from system_certificates. certificate_no stays the '
  'society''s own running number; this is the one that identifies the document.';

-- ----------------------------------------------------------------------------
-- 5. PER-TYPE ISSUERS
--    Each one is the entry point for its kind of certificate, and each reads
--    every fact it records from the database. The browser passes an id and
--    nothing else, so no caller can talk a serial onto a record it does not
--    own, nor make the registry disagree with the books.
-- ----------------------------------------------------------------------------

-- 5a. Share certificate — two entry points, because the engine and a person
--     need different answers to "may you serialise this".
--
--     sacco_share_reissue_certificate reissues for BOTH sides of a trade. The
--     member who executed the order is not staff and is not the counterparty,
--     so a permission check on that path would refuse the seller's certificate
--     and take the whole settled trade down with it. The internal form below
--     therefore has no check and is granted to nobody; the public form checks
--     and delegates.
CREATE OR REPLACE FUNCTION public.sacco_share_certificate_serial_internal(p_certificate_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c        record;
  v_serial text;
BEGIN
  SELECT sc.id, sc.certificate_no, sc.member_id, sc.sacco_id, sc.admin_id,
         sc.shares, sc.par_value, sc.issue_date, sc.status, sc.serial,
         sc.created_at,
         s.name        AS sacco_name,
         m.full_name   AS member_name,
         m.member_no   AS member_no
    INTO c
    FROM public.sacco_share_certificates sc
    LEFT JOIN public.saccos        s ON s.id = sc.sacco_id
    LEFT JOIN public.sacco_members m ON m.id = sc.member_id
   WHERE sc.id = p_certificate_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.serial IS NOT NULL THEN RETURN c.serial; END IF;

  v_serial := public.system_certificate_issue(
    p_cert_type    => 'share',
    p_source_table => 'sacco_share_certificates',
    p_source_id    => c.id,
    p_title        => 'Share Certificate',
    p_admin_id     => c.admin_id,
    p_sacco_id     => c.sacco_id,
    p_issuer_name  => c.sacco_name,
    p_subject_name => c.member_name,
    p_subject_ref  => c.member_no,
    p_facts        => jsonb_build_object(
                        'certificate_no', c.certificate_no,
                        'shares',         COALESCE(c.shares, 0),
                        'par_value',      COALESCE(c.par_value, 0),
                        'issue_date',     c.issue_date
                      ),
    p_issued_on    => COALESCE(c.issue_date, c.created_at::date)
  );

  UPDATE public.sacco_share_certificates SET serial = v_serial WHERE id = c.id;

  -- A certificate that is already superseded on the register is superseded in
  -- the registry too, so a backfilled old copy never verifies as current.
  IF c.status <> 'active' THEN
    UPDATE public.system_certificates
       SET status = CASE WHEN c.status = 'cancelled' THEN 'revoked' ELSE 'superseded' END,
           revoked_reason = CASE WHEN c.status = 'cancelled'
                                 THEN 'Certificate cancelled on the share register' END,
           updated_at = now()
     WHERE source_table = 'sacco_share_certificates' AND source_id = c.id;
  END IF;

  RETURN v_serial;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_share_certificate_serial_internal(uuid)
  FROM PUBLIC, anon, authenticated;

-- The form a person calls: staff of the society, a global viewer, or the member
-- the certificate belongs to. The member portal uses it to mint a serial on
-- first download for certificates issued before this migration.
CREATE OR REPLACE FUNCTION public.sacco_share_certificate_serial(p_certificate_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin  uuid;
  v_member uuid;
  v_serial text;
BEGIN
  SELECT sc.admin_id, sc.member_id, sc.serial INTO v_admin, v_member, v_serial
    FROM public.sacco_share_certificates sc WHERE sc.id = p_certificate_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_serial IS NOT NULL THEN RETURN v_serial; END IF;

  IF NOT (
    (v_admin = public.current_admin_id() AND public.is_staff_member())
    OR public.is_global_viewer()
    OR v_member = public.current_sacco_member_id()
  ) THEN
    RAISE EXCEPTION 'Not permitted to serialise this certificate.';
  END IF;

  RETURN public.sacco_share_certificate_serial_internal(p_certificate_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_share_certificate_serial(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_certificate_serial(uuid) TO authenticated;

-- 5b. Certificate of Full Settlement & Ownership Transfer.
--     The letter used to invent its own reference in the browser on every
--     render. This mints one serial per plan, once, and refuses to mint at all
--     unless the plan really is settled — a settlement certificate for a plan
--     still being paid is exactly the document that must not exist.
CREATE OR REPLACE FUNCTION public.settlement_certificate_issue(p_plan_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  p        record;
  v_admin  uuid;
  v_issuer text;
  v_serial text;
BEGIN
  SELECT ip.id, ip.plan_name, ip.total_amount, ip.installment_amount,
         ip.total_installments, ip.installments_paid, ip.frequency::text AS frequency,
         ip.start_date, ip.end_date, ip.plan_status::text AS plan_status,
         COALESCE(cl.admin_id, a.admin_id) AS plan_admin_id,
         cl.full_name      AS client_name,
         cl.account_number AS account_number,
         a.description     AS asset_description,
         a.asset_code      AS asset_code,
         a.plate_number    AS plate_number,
         COALESCE(a.chassis_number, a.serial_number) AS asset_serial
    INTO p
    FROM public.installment_plans ip
    LEFT JOIN public.clients cl ON cl.id = ip.client_id
    LEFT JOIN public.assets  a  ON a.id  = ip.asset_id
   WHERE ip.id = p_plan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such payment plan.';
  END IF;

  -- installment_plans carries no admin_id of its own, so the tenant comes from
  -- the client, falling back to the asset. Both can still be NULL on rows that
  -- predate 20260628120000_tenant_isolation and were never backfilled — and
  -- there is a difference between "this plan belongs to another tenant" and
  -- "nothing here says which tenant it belongs to". Only the first is a
  -- violation; refusing the second would lock staff out of settled plans over a
  -- missing column, so an untenanted plan is attributed to the caller.
  IF NOT public.is_staff_member() AND NOT public.is_global_viewer() THEN
    RAISE EXCEPTION 'Only staff may issue a settlement certificate.';
  END IF;

  IF p.plan_admin_id IS NOT NULL
     AND p.plan_admin_id <> public.current_admin_id()
     AND NOT public.is_global_viewer() THEN
    RAISE EXCEPTION 'Not permitted to issue a settlement certificate for this plan.';
  END IF;

  v_admin := COALESCE(p.plan_admin_id, public.current_admin_id());

  IF NOT (p.plan_status = 'completed'
          OR COALESCE(p.installments_paid, 0) >= COALESCE(p.total_installments, 0)) THEN
    RAISE EXCEPTION 'This plan is not settled — % of % installments paid.',
      COALESCE(p.installments_paid, 0), COALESCE(p.total_installments, 0);
  END IF;

  -- company_profiles predates the migration history and is absent in some
  -- environments, so read it the way resolve_signup_code() does.
  IF to_regclass('public.company_profiles') IS NOT NULL THEN
    EXECUTE 'select cp.company_name::text from public.company_profiles cp
              where cp.admin_id = $1 limit 1'
      INTO v_issuer USING v_admin;
  END IF;

  v_serial := public.system_certificate_issue(
    p_cert_type    => 'settlement',
    p_source_table => 'installment_plans',
    p_source_id    => p.id,
    p_title        => 'Certificate of Full Settlement & Ownership Transfer',
    p_admin_id     => v_admin,
    p_issuer_name  => v_issuer,
    p_subject_name => p.client_name,
    p_subject_ref  => p.account_number,
    p_facts        => jsonb_build_object(
                        'plan_name',          p.plan_name,
                        'total_amount',       COALESCE(p.total_amount, 0),
                        'installment_amount', COALESCE(p.installment_amount, 0),
                        'total_installments', COALESCE(p.total_installments, 0),
                        'frequency',          p.frequency,
                        'asset_description',  p.asset_description,
                        'asset_code',         p.asset_code,
                        'asset_serial',       p.asset_serial,
                        'plate_number',       p.plate_number,
                        'settled_on',         COALESCE(p.end_date, CURRENT_DATE)
                      ),
    p_issued_on    => COALESCE(p.end_date, CURRENT_DATE)
  );

  RETURN v_serial;
END;
$fn$;

REVOKE ALL ON FUNCTION public.settlement_certificate_issue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settlement_certificate_issue(uuid) TO authenticated;

-- 5c. Electronic Signature Certificate — the page appended to a sealed PDF.
--     p_source names which of the three signable tables the document lives in,
--     matching the `source` the e-signature screen already carries.
CREATE OR REPLACE FUNCTION public.esign_certificate_serial(p_source text, p_document_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_table   text;
  v_admin   uuid;
  v_name    text;
  v_client  text;
  v_issuer  text;
  v_serial  text;
BEGIN
  v_table := CASE lower(COALESCE(p_source, ''))
               WHEN 'company'   THEN 'company_contracts'
               WHEN 'esign_doc' THEN 'esign_documents'
               WHEN 'contract'  THEN 'generated_contracts'
               ELSE NULL
             END;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'Unknown document source: %', p_source;
  END IF;

  IF v_table = 'company_contracts' THEN
    SELECT c.admin_id, c.contract_name, cl.full_name
      INTO v_admin, v_name, v_client
      FROM public.company_contracts c
      LEFT JOIN public.clients cl ON cl.id = c.client_id
     WHERE c.id = p_document_id;
  ELSIF v_table = 'esign_documents' THEN
    SELECT d.admin_id, d.name, NULL::text
      INTO v_admin, v_name, v_client
      FROM public.esign_documents d
     WHERE d.id = p_document_id;
  ELSE
    SELECT g.admin_id, COALESCE(g.invoice_number, 'Contract'),
           COALESCE(g.client_name, cl.full_name)
      INTO v_admin, v_name, v_client
      FROM public.generated_contracts g
      LEFT JOIN public.clients cl ON cl.id = g.client_id
     WHERE g.id = p_document_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such document.';
  END IF;

  IF NOT (
    (v_admin = public.current_admin_id() AND public.is_esign_staff())
    OR public.is_global_viewer()
  ) THEN
    RAISE EXCEPTION 'Not permitted to serialise this document.';
  END IF;

  IF to_regclass('public.company_profiles') IS NOT NULL THEN
    EXECUTE 'select cp.company_name::text from public.company_profiles cp
              where cp.admin_id = $1 limit 1'
      INTO v_issuer USING v_admin;
  END IF;

  v_serial := public.system_certificate_issue(
    p_cert_type    => 'esignature',
    p_source_table => v_table,
    p_source_id    => p_document_id,
    p_title        => 'Electronic Signature Certificate',
    p_admin_id     => v_admin,
    p_issuer_name  => v_issuer,
    p_subject_name => v_client,
    p_subject_ref  => NULL,
    -- Only what is true at the moment of minting. The serial is minted as the
    -- PDF is sealed — the document is not "signed" yet when we mint, so a
    -- status recorded here would be a lie locked under a digest. Who signed,
    -- when, from where already lives in esign_audit, and the certificate page
    -- itself prints it.
    p_facts        => jsonb_build_object(
                        'document', v_name,
                        'source',   lower(p_source)
                      )
  );

  RETURN v_serial;
END;
$fn$;

REVOKE ALL ON FUNCTION public.esign_certificate_serial(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_certificate_serial(text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. THE QUERY — is this certificate real?
--
--    Returns at most one row. An unknown serial returns NO rows rather than a
--    "not found" row, so the endpoint cannot be used as an oracle to sweep the
--    space for valid serials; the 4 random characters in every serial make that
--    sweep impractical to begin with.
--
--    Deliberately NOT scoped to the caller's tenant: verifying a certificate is
--    something a person holding the paper does, and the holder is very often
--    not of the tenant that issued it — a bank shown a settlement certificate,
--    a society checking a transferring member's shares. What comes back is only
--    what is already printed on the face they are holding, and every check is
--    written to system_certificate_verifications with the caller's identity.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_certificate_verify(p_serial text)
RETURNS TABLE (
  serial_no            text,
  certificate_type     text,
  certificate_title    text,
  issuer               text,
  subject              text,
  subject_reference    text,
  detail               jsonb,
  issued_on_date       date,
  certificate_status   text,
  revoked_reason_text  text,
  revoked_on           timestamptz,
  superseded_by_serial text,
  digest_ok            boolean,
  times_verified       integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key      text;
  c          record;
  v_expected text;
BEGIN
  v_key := regexp_replace(upper(COALESCE(p_serial, '')), '[^A-Z0-9]', '', 'g');

  IF v_key = '' THEN RETURN; END IF;

  SELECT * INTO c FROM public.system_certificates sc WHERE sc.serial_key = v_key;

  IF NOT FOUND THEN
    INSERT INTO public.system_certificate_verifications
      (certificate_id, serial_query, found, checked_by, checked_by_admin)
    VALUES (NULL, v_key, false, auth.uid(), public.current_admin_id());
    RETURN;
  END IF;

  -- Recompute the digest from what the row says now. A row that was edited by
  -- anything other than system_certificate_issue() no longer matches.
  v_expected := encode(extensions.digest(
    c.serial || '|' || COALESCE(c.subject_name, '') || '|' || COALESCE(c.subject_ref, '')
             || '|' || c.issued_on::text || '|' || c.facts::text, 'sha256'), 'hex');

  UPDATE public.system_certificates
     SET verify_count = verify_count + 1, last_verified_at = now()
   WHERE id = c.id;

  INSERT INTO public.system_certificate_verifications
    (certificate_id, serial_query, found, result_status, checked_by, checked_by_admin)
  VALUES (c.id, v_key, true, c.status, auth.uid(), public.current_admin_id());

  RETURN QUERY
  SELECT c.serial,
         c.cert_type,
         c.title,
         c.issuer_name,
         c.subject_name,
         c.subject_ref,
         c.facts,
         c.issued_on,
         c.status,
         c.revoked_reason,
         c.revoked_at,
         (SELECT n.serial FROM public.system_certificates n WHERE n.id = c.superseded_by),
         (v_expected = c.digest),
         c.verify_count + 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_certificate_verify(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_certificate_verify(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. REVOCATION — a certificate issued in error stays on file and stops
--    verifying. Staff of the issuing tenant only; a global viewer reads across
--    tenants but does not get to void another tenant's paper.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.system_certificate_revoke(p_serial text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_key text;
  c     record;
BEGIN
  v_key := regexp_replace(upper(COALESCE(p_serial, '')), '[^A-Z0-9]', '', 'g');

  SELECT sc.id, sc.admin_id, sc.status INTO c
    FROM public.system_certificates sc WHERE sc.serial_key = v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No certificate with that serial.';
  END IF;

  IF NOT (c.admin_id IS NOT NULL
          AND c.admin_id = public.current_admin_id()
          AND public.is_staff_member()) THEN
    RAISE EXCEPTION 'Only the issuing organisation may revoke a certificate.';
  END IF;

  IF c.status = 'revoked' THEN RETURN false; END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A revocation needs a reason.';
  END IF;

  UPDATE public.system_certificates
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = btrim(p_reason), updated_at = now()
   WHERE id = c.id;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.system_certificate_revoke(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_certificate_revoke(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. THE SHARE ENGINE MINTS A SERIAL ON EVERY REISSUE
--
-- Re-declared from 20260801200000_sacco_share_engine.sql. Body is unchanged
-- except that the new certificate is registered for a serial, and the one it
-- replaces is marked superseded in the registry as well as on the register.
CREATE OR REPLACE FUNCTION public.sacco_share_reissue_certificate(
  p_sacco_id  uuid,
  p_member_id uuid,
  p_txn_id    uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_admin  uuid;
  v_shares integer;
  v_par    numeric;
  v_no     integer;
  v_prefix text;
  v_new    uuid;
  v_old    uuid;
  v_serial text;
BEGIN
  IF p_member_id IS NULL THEN RETURN NULL; END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = p_sacco_id;
  SELECT COALESCE(shares_held, 0) INTO v_shares
    FROM public.sacco_shares WHERE sacco_id = p_sacco_id AND member_id = p_member_id;

  -- Claim the next certificate number atomically.
  UPDATE public.sacco_share_settings
     SET next_certificate_no = next_certificate_no + 1, updated_at = now()
   WHERE sacco_id = p_sacco_id
  RETURNING next_certificate_no - 1, certificate_prefix, par_value
       INTO v_no, v_prefix, v_par;

  SELECT id INTO v_old
    FROM public.sacco_share_certificates
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id AND status = 'active'
   LIMIT 1;

  UPDATE public.sacco_share_certificates
     SET status = 'superseded'
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id AND status = 'active';

  -- A member who has sold out keeps their history but holds no live certificate.
  IF COALESCE(v_shares, 0) <= 0 THEN
    IF v_old IS NOT NULL THEN
      PERFORM public.system_certificate_supersede('sacco_share_certificates', v_old);
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.sacco_share_certificates
    (admin_id, sacco_id, certificate_no, member_id, shares, par_value,
     transaction_id, issued_by, status)
  VALUES
    (v_admin, p_sacco_id,
     COALESCE(v_prefix, 'CERT') || '-' || lpad(COALESCE(v_no, 1)::text, 6, '0'),
     p_member_id, v_shares, COALESCE(v_par, 0), p_txn_id, auth.uid(), 'active')
  RETURNING id INTO v_new;

  UPDATE public.sacco_share_certificates
     SET superseded_by = v_new
   WHERE sacco_id = p_sacco_id AND member_id = p_member_id
     AND status = 'superseded' AND superseded_by IS NULL;

  -- Serialise the new certificate, then retire the registry entry of the one it
  -- replaced, pointing it at its successor.
  v_serial := public.sacco_share_certificate_serial_internal(v_new);
  IF v_old IS NOT NULL THEN
    PERFORM public.system_certificate_supersede('sacco_share_certificates', v_old, v_serial);
  END IF;

  RETURN v_new;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sacco_share_reissue_certificate(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_share_reissue_certificate(uuid, uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. BACKFILL — every certificate already on the register gets a serial, so
--    "every certificate the system has generated" is true of the ones printed
--    before today too. Oldest first, so the sequence runs in issue order.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT sc.id
      FROM public.sacco_share_certificates sc
     WHERE sc.serial IS NULL
     ORDER BY COALESCE(sc.issue_date, sc.created_at::date), sc.created_at
  LOOP
    PERFORM public.sacco_share_certificate_serial_internal(r.id);
  END LOOP;
END $$;

-- Link the backfilled history. The loop above runs oldest-first, so when an old
-- certificate was serialised its successor had no serial yet and there was
-- nothing to point at. Now that every row has one, join the chain the share
-- register already records through sacco_share_certificates.superseded_by, so a
-- reader who verifies a retired certificate is told which one replaced it
-- rather than just that one did.
UPDATE public.system_certificates old_c
   SET superseded_by = new_reg.id, updated_at = now()
  FROM public.sacco_share_certificates old_s
  JOIN public.sacco_share_certificates new_s ON new_s.id = old_s.superseded_by
  JOIN public.system_certificates new_reg
    ON new_reg.source_table = 'sacco_share_certificates' AND new_reg.source_id = new_s.id
 WHERE old_c.source_table = 'sacco_share_certificates'
   AND old_c.source_id    = old_s.id
   AND old_c.superseded_by IS NULL;

-- ----------------------------------------------------------------------------
-- 10. RLS AND GRANTS
--     Both tables are read-only to every role. Everything that writes them is
--     SECURITY DEFINER above, which is what lets the digest mean something.
-- ----------------------------------------------------------------------------
ALTER TABLE public.system_certificates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_certificate_verifications ENABLE ROW LEVEL SECURITY;

-- Staff browse their own tenant's certificate register; the certificate a
-- sacco member holds reaches them through sacco_share_certificates.serial,
-- which their existing member_read_own_certificates policy already covers.
DROP POLICY IF EXISTS "tenant_read_system_certificates" ON public.system_certificates;
CREATE POLICY "tenant_read_system_certificates" ON public.system_certificates
  FOR SELECT TO authenticated
  USING ((admin_id = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer());

DROP POLICY IF EXISTS "tenant_read_cert_verifications" ON public.system_certificate_verifications;
CREATE POLICY "tenant_read_cert_verifications" ON public.system_certificate_verifications
  FOR SELECT TO authenticated
  USING ((checked_by_admin = public.current_admin_id() AND public.is_staff_member())
         OR public.is_global_viewer()
         OR EXISTS (SELECT 1 FROM public.system_certificates sc
                     WHERE sc.id = certificate_id
                       AND sc.admin_id = public.current_admin_id()
                       AND public.is_staff_member()));

-- Supabase's default privileges hand every new table in `public` ALL to anon
-- and authenticated, so a bare GRANT SELECT would only add to a grant of
-- everything. RLS already refuses the writes — there is no INSERT/UPDATE/DELETE
-- policy on either table — but the digest is only worth reading if nothing
-- outside the SECURITY DEFINER functions above can write here, and that should
-- be true at the grant layer too, not by RLS alone. Revoke first, then grant
-- back exactly the read the app needs.
REVOKE ALL ON public.system_certificates              FROM anon, authenticated;
REVOKE ALL ON public.system_certificate_verifications FROM anon, authenticated;

GRANT SELECT ON public.system_certificates              TO authenticated;
GRANT SELECT ON public.system_certificate_verifications TO authenticated;
