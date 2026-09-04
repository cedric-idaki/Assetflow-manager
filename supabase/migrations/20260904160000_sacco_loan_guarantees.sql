-- ============================================================================
-- SACCO LOAN GUARANTEES — two-step verification before an agreement binds
-- ============================================================================
-- A guarantee is the most consequential thing a member can do in the portal.
-- Voting spends a ballot; buying shares spends money the member chose to
-- spend. A guarantee is an unconditional promise to repay somebody ELSE'S debt
-- out of your own deposits and shares, enforceable without further notice
-- (see the Guarantor Form clauses in src/components/contracts/TemplatesSection).
-- One click is not informed consent to that.
--
-- So acceptance is split in two, and the split is enforced HERE, not in the
-- browser:
--
--   Step 1  review   — the guarantor is shown the agreement as it stands and
--                      acknowledges it. The exact terms they saw are recorded
--                      as a hash, with the moment they saw them.
--   Step 2  confirm  — a separate, deliberate act. The agreement is finalized
--                      only if the terms are STILL the ones that were
--                      reviewed, the review is still fresh, and the guarantor
--                      signs their own name.
--
-- WHY THE HASH IS THE WHOLE POINT
--   Two modals in a row is theatre: the client could call confirm directly, or
--   the borrower could raise the guaranteed amount between the two screens and
--   bind the guarantor to terms they never read. sacco_loan_guarantee_terms()
--   is the single authority that renders the agreement, and it hashes what it
--   rendered. review() refuses a hash that is not current; confirm() refuses
--   unless the hash matches BOTH what was reviewed AND what the agreement says
--   right now. Change the amount, the loan, or the clause text, and every
--   outstanding review is void — the guarantor has to read it again.
--
--   That also means the client never authors the terms. It displays what the
--   server rendered and echoes the hash back. There is no second copy of the
--   wording in JavaScript to drift out of step.
--
-- STATUS FLOW
--   requested ──review──> under_review ──confirm──> accepted ──> released
--       │                      │                        (loan closed/rejected)
--       ├────── declined ──────┤
--       └────── cancelled (borrower withdraws the request)
--
--   There is no "accepted but not final" state. Until confirm() succeeds the
--   row is under_review and binds nobody.
--
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. THE REGISTER
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.sacco_loan_guarantee_seq;

CREATE TABLE IF NOT EXISTS public.sacco_loan_guarantees (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID,
  sacco_id             UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  loan_id              UUID NOT NULL REFERENCES public.sacco_loans(id) ON DELETE CASCADE,
  borrower_member_id   UUID NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  guarantor_member_id  UUID NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  ref_no               TEXT NOT NULL,
  amount_guaranteed    DECIMAL(15,2) NOT NULL CHECK (amount_guaranteed > 0),
  status               TEXT NOT NULL DEFAULT 'requested',

  -- Step 1: what was shown, and when.
  terms_version        TEXT,
  reviewed_terms_hash  TEXT,
  reviewed_at          TIMESTAMPTZ,

  -- Step 2: what was actually signed, and when. accepted_terms_hash is the
  -- evidential record — the agreement this member is bound by is the one that
  -- reproduces this hash, and nothing else.
  accepted_terms_hash  TEXT,
  accepted_at          TIMESTAMPTZ,
  signature_name       TEXT,

  declined_at          TIMESTAMPTZ,
  decline_reason       TEXT,
  cancelled_at         TIMESTAMPTZ,
  released_at          TIMESTAMPTZ,
  release_reason       TEXT,

  requested_by         UUID,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sacco_loan_guarantees_status_chk
    CHECK (status IN ('requested', 'under_review', 'accepted', 'declined', 'cancelled', 'released')),
  -- A member cannot stand surety for their own borrowing.
  CONSTRAINT sacco_loan_guarantees_not_self_chk
    CHECK (guarantor_member_id <> borrower_member_id),
  -- Belt and braces on the two-step rule: a bound row must carry both the
  -- review it came from and the confirmation that finalized it, in that order.
  -- No application path can produce an acceptance without a prior review, and
  -- no direct UPDATE can either.
  CONSTRAINT sacco_loan_guarantees_two_step_chk
    CHECK (status NOT IN ('accepted', 'released')
           OR (reviewed_at IS NOT NULL
               AND accepted_at IS NOT NULL
               AND accepted_terms_hash IS NOT NULL
               AND accepted_at >= reviewed_at))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_loan_guarantee_ref
  ON public.sacco_loan_guarantees(sacco_id, ref_no);
-- One live request per (loan, guarantor): asking the same member twice while
-- the first ask is still open is a mistake, not a second guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_loan_guarantee_live
  ON public.sacco_loan_guarantees(loan_id, guarantor_member_id)
  WHERE status IN ('requested', 'under_review', 'accepted');
CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantees_admin
  ON public.sacco_loan_guarantees(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantees_loan
  ON public.sacco_loan_guarantees(loan_id, status);
-- "What is waiting for me?" — the query the member portal runs on every load.
CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantees_guarantor
  ON public.sacco_loan_guarantees(guarantor_member_id, status);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantees_borrower
  ON public.sacco_loan_guarantees(borrower_member_id, status);

COMMENT ON TABLE public.sacco_loan_guarantees IS
  'Guarantee agreements on sacco loans. Acceptance is two-step: review (terms hashed) '
  'then confirm (hash re-verified). A row only binds the guarantor at status = accepted.';
COMMENT ON COLUMN public.sacco_loan_guarantees.accepted_terms_hash IS
  'SHA-256 of the exact agreement the guarantor confirmed. The binding terms are the '
  'ones that reproduce this hash — see sacco_loan_guarantee_terms().';

-- ----------------------------------------------------------------------------
-- 2. THE HISTORY
--    Append-only. Every step of the two-step flow lands here with the hash in
--    force at that moment, so the sequence can be re-read years later.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_loan_guarantee_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID,
  sacco_id      UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  guarantee_id  UUID NOT NULL REFERENCES public.sacco_loan_guarantees(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,   -- requested | reviewed | confirmed | declined | deferred | cancelled | released
  terms_hash    TEXT,
  status_after  TEXT,
  detail        TEXT,
  actor_id      UUID,
  actor_name    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantee_events_guarantee
  ON public.sacco_loan_guarantee_events(guarantee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_guarantee_events_admin
  ON public.sacco_loan_guarantee_events(admin_id);

COMMENT ON TABLE public.sacco_loan_guarantee_events IS
  'Append-only audit of a guarantee: requested, reviewed, confirmed, declined, cancelled, released.';

CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_event(
  p_guarantee_id uuid,
  p_event_type   text,
  p_terms_hash   text DEFAULT NULL,
  p_detail       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g public.sacco_loan_guarantees%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = p_guarantee_id;
  IF g.id IS NULL THEN RETURN; END IF;

  INSERT INTO public.sacco_loan_guarantee_events
    (admin_id, sacco_id, guarantee_id, event_type, terms_hash, status_after, detail,
     actor_id, actor_name)
  VALUES
    (g.admin_id, g.sacco_id, g.id, p_event_type, p_terms_hash, g.status, p_detail,
     auth.uid(),
     (SELECT full_name FROM public.sacco_members WHERE user_id = auth.uid() LIMIT 1));
END;
$$;

-- Internal only. The history is written BY the flow, never by a caller: an
-- authenticated user must not be able to post an event of their own choosing
-- into an audit trail. The SECURITY DEFINER RPCs above run as the owner, so
-- they keep their access.
REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_event(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. THE AGREEMENT ITSELF
--    One authority for the wording, the figures and the hash. The portal
--    renders what this returns; it never composes terms of its own.
-- ----------------------------------------------------------------------------

-- Bump this whenever a clause below changes. The bump invalidates every
-- outstanding review, which is the correct behaviour: nobody should be bound
-- by wording they did not read.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_terms_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 'GT-1.0'::text $$;

-- The clauses, in the same voice as the Guarantor Form contract template so a
-- member reads the same undertaking in the portal and on paper.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_clauses()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object(
      'heading', 'What you are undertaking',
      'body',    'The Guarantor guarantees repayment of the Borrower''s facility to the extent of the amount guaranteed, and consents to their deposits and shares being attached to that extent.'),
    jsonb_build_object(
      'heading', 'If the borrower defaults',
      'body',    'On default by the Borrower, the Sacco may recover the guaranteed amount from the Guarantor''s deposits, shares and future contributions without further notice.'),
    jsonb_build_object(
      'heading', 'Penalties',
      'body',    'Amounts recovered from the Guarantor attract the same penalty terms as the underlying facility.'),
    jsonb_build_object(
      'heading', 'Loan protection cover',
      'body',    'The Guarantor shall be notified of any loan protection cover applying to the guaranteed facility.'),
    jsonb_build_object(
      'heading', 'When the guarantee ends',
      'body',    'The guarantee is released once the underlying facility is repaid in full or the Sacco accepts a substitute guarantor.'),
    jsonb_build_object(
      'heading', 'While the guarantee stands',
      'body',    'The Guarantor may not withdraw the guarantee once confirmed. Deposits and shares up to the guaranteed amount may be held back by the Sacco until the facility is settled.')
  );
$$;

-- ----------------------------------------------------------------------------
-- 3a. THE SOCIETY'S LENDING POLICY
--     How much a member may stand behind is a society decision, not ours. One
--     row per sacco, created with defaults on first save, so a society that
--     never opens this screen still gets a sane rule: a member may guarantee
--     up to the value of their own deposits and shares, and no more.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sacco_guarantee_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID,
  sacco_id              UUID UNIQUE NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,

  -- The gate. Off means the portal still shows the figures but refuses nothing.
  enforce_exposure_cap  BOOLEAN       NOT NULL DEFAULT true,
  -- Multiple of the member's own security they may guarantee. 1.00 = "no more
  -- than you are worth to the society"; 3.00 is common where deposits are thin.
  max_exposure_multiple DECIMAL(6,2)  NOT NULL DEFAULT 1.00,
  -- Whether share value counts as security at all. Some societies back
  -- guarantees on deposits alone, since shares are harder to realise.
  count_share_value     BOOLEAN       NOT NULL DEFAULT true,
  -- How many live guarantees one member may carry. 0 = no limit.
  max_active_guarantees INTEGER       NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT sacco_guarantee_settings_multiple_chk CHECK (max_exposure_multiple > 0),
  CONSTRAINT sacco_guarantee_settings_active_chk   CHECK (max_active_guarantees >= 0)
);

COMMENT ON TABLE public.sacco_guarantee_settings IS
  'Per-sacco guarantee policy: how much of their own security a member may stand behind, '
  'and how many loans at once. Read by sacco_loan_guarantee_capacity().';

-- Defaults on first touch, so the save RPC can assume a row exists. Callers
-- that only READ the policy must not use this (it writes) — they read the
-- table with COALESCE defaults instead, which is why the gate already works
-- for a society that has never saved a setting.
CREATE OR REPLACE FUNCTION public.sacco_guarantee_settings_row(p_sacco_id uuid)
RETURNS public.sacco_guarantee_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r public.sacco_guarantee_settings%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.sacco_guarantee_settings WHERE sacco_id = p_sacco_id;
  IF r.id IS NULL THEN
    INSERT INTO public.sacco_guarantee_settings (admin_id, sacco_id)
    VALUES ((SELECT admin_id FROM public.saccos WHERE id = p_sacco_id), p_sacco_id)
    ON CONFLICT (sacco_id) DO UPDATE SET updated_at = now()
    RETURNING * INTO r;
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_guarantee_settings_row(uuid) FROM PUBLIC, anon, authenticated;

-- Staff edit the policy through here, one column at a time out of a patch, so
-- a stray key in the payload can never write a column this function does not
-- own.
CREATE OR REPLACE FUNCTION public.sacco_guarantee_save_settings(p_patch jsonb)
RETURNS public.sacco_guarantee_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sacco uuid := public.sacco_active_sacco_id();
  r       public.sacco_guarantee_settings%ROWTYPE;
BEGIN
  PERFORM public.sacco_share_require_staff(v_sacco);
  r := public.sacco_guarantee_settings_row(v_sacco);

  UPDATE public.sacco_guarantee_settings SET
    enforce_exposure_cap  = COALESCE((p_patch->>'enforce_exposure_cap')::boolean,  enforce_exposure_cap),
    max_exposure_multiple = COALESCE((p_patch->>'max_exposure_multiple')::numeric, max_exposure_multiple),
    count_share_value     = COALESCE((p_patch->>'count_share_value')::boolean,     count_share_value),
    max_active_guarantees = COALESCE((p_patch->>'max_active_guarantees')::integer, max_active_guarantees),
    updated_at            = now()
  WHERE id = r.id
  RETURNING * INTO r;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_guarantee_save_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_guarantee_save_settings(jsonb) TO authenticated;

-- The member's position against that policy, in one place: what they are worth
-- to the society, what they already stand behind, and what is left.
--
-- Reads the policy with COALESCE defaults rather than through
-- sacco_guarantee_settings_row() — this function is STABLE and must stay so
-- (terms() calls it), and a society that has never saved a policy still has
-- one: the defaults on the table.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_capacity(
  p_sacco_id  uuid,
  p_member_id uuid
)
RETURNS TABLE (
  deposits      numeric,
  share_value   numeric,
  security      numeric,
  committed     numeric,
  active_count  integer,
  cap           numeric,
  headroom      numeric,
  cap_enforced  boolean,
  cap_multiple  numeric,
  max_active    integer,
  counts_shares boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH policy AS (
    SELECT
      COALESCE(gs.enforce_exposure_cap,  true) AS p_enforce,
      COALESCE(gs.max_exposure_multiple, 1.00) AS p_multiple,
      COALESCE(gs.count_share_value,     true) AS p_counts_shares,
      COALESCE(gs.max_active_guarantees, 0)    AS p_max_active
    FROM (SELECT 1) z
    LEFT JOIN public.sacco_guarantee_settings gs ON gs.sacco_id = p_sacco_id
  ),
  pos AS (
    SELECT
      COALESCE((SELECT SUM(c.amount) FROM public.sacco_contributions c
                 WHERE c.member_id = p_member_id
                   AND c.status IN ('completed', 'paid')), 0)::numeric AS p_deposits,
      COALESCE((SELECT sh.shares_held * COALESCE(
                         (SELECT sp.market_value FROM public.sacco_share_prices sp
                           WHERE sp.sacco_id = p_sacco_id
                           ORDER BY sp.effective_date DESC LIMIT 1),
                         sh.par_value, 0)
                  FROM public.sacco_shares sh
                 WHERE sh.member_id = p_member_id LIMIT 1), 0)::numeric AS p_share_value,
      -- Everything this member already stands behind.
      COALESCE((SELECT SUM(g.amount_guaranteed) FROM public.sacco_loan_guarantees g
                 WHERE g.guarantor_member_id = p_member_id
                   AND g.status = 'accepted'), 0)::numeric AS p_committed,
      COALESCE((SELECT COUNT(*) FROM public.sacco_loan_guarantees g
                 WHERE g.guarantor_member_id = p_member_id
                   AND g.status = 'accepted'), 0)::integer AS p_active_count
  ),
  joined AS (
    SELECT
      pos.*, policy.*,
      (pos.p_deposits
       + CASE WHEN policy.p_counts_shares THEN pos.p_share_value ELSE 0 END) AS p_security
    FROM pos, policy
  )
  SELECT
    joined.p_deposits,
    joined.p_share_value,
    joined.p_security,
    joined.p_committed,
    joined.p_active_count,
    ROUND(joined.p_security * joined.p_multiple, 2),
    GREATEST(ROUND(joined.p_security * joined.p_multiple, 2) - joined.p_committed, 0),
    joined.p_enforce,
    joined.p_multiple,
    joined.p_max_active,
    joined.p_counts_shares
  FROM joined;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_capacity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_capacity(uuid, uuid) TO authenticated;

-- THE EXPOSURE CAP GATE.
--
-- Returns NULL when this member may take this guarantee on, or the sentence
-- explaining why not. A sentence rather than an exception, because terms()
-- needs to SHOW the refusal on step 1 — a guarantor should learn they are over
-- their limit before reading six clauses, not after typing their name.
-- _review() and _confirm() turn the same sentence into a hard refusal, so the
-- rule is stated once and enforced everywhere.
--
-- Only ever bites on a guarantee that is not yet binding. The cap governs
-- taking ON new exposure; an accepted guarantee is already a commitment of the
-- member's and is not re-litigated here, nor released if their deposits later
-- fall — that is a supervisory matter, not this gate's.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_capacity_block(p_guarantee_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g       public.sacco_loan_guarantees%ROWTYPE;
  c       RECORD;
  v_total numeric;
  v_name  text;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = p_guarantee_id;
  IF g.id IS NULL THEN RETURN NULL; END IF;
  IF g.status NOT IN ('requested', 'under_review') THEN RETURN NULL; END IF;

  SELECT * INTO c FROM public.sacco_loan_guarantee_capacity(g.sacco_id, g.guarantor_member_id);
  IF NOT c.cap_enforced THEN RETURN NULL; END IF;

  SELECT COALESCE(name, 'this sacco') INTO v_name FROM public.saccos WHERE id = g.sacco_id;

  IF c.max_active > 0 AND c.active_count >= c.max_active THEN
    RETURN format('You already guarantee %s loan%s, which is the most %s allows one member to carry.',
      c.active_count,
      CASE WHEN c.active_count = 1 THEN '' ELSE 's' END,
      COALESCE(v_name, 'this sacco'));
  END IF;

  v_total := c.committed + g.amount_guaranteed;
  IF v_total > c.cap THEN
    RETURN format(
      'This would take what you guarantee to KES %s, past your limit of KES %s. %s',
      to_char(v_total, 'FM999,999,999,990.00'),
      to_char(c.cap,   'FM999,999,999,990.00'),
      CASE WHEN c.headroom > 0
        THEN format('You have KES %s left to give.', to_char(c.headroom, 'FM999,999,999,990.00'))
        ELSE 'You have nothing left to give.'
      END);
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_capacity_block(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_capacity_block(uuid) TO authenticated;


-- Render the agreement AND hash it.
--
-- The hash covers every figure a guarantor would care about — who is
-- borrowing, how much, on what terms, and how much of it this guarantor is
-- carrying — plus the clause text and its version. Anything that would change
-- the meaning of the promise changes the hash, which voids a review that has
-- not yet been confirmed.
--
-- Deliberately NOT hashed: the capacity figures (deposits, share value, other
-- commitments). Those move with every contribution and every trade; hashing
-- them would void a review because somebody else paid their monthly savings.
-- They are context for the decision, not a term of the agreement.
--
-- Readable by the guarantor, the borrower and sacco staff — the parties to the
-- agreement, and nobody else.
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_terms(p_guarantee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g        public.sacco_loan_guarantees%ROWTYPE;
  l        public.sacco_loans%ROWTYPE;
  s        public.saccos%ROWTYPE;
  borrower public.sacco_members%ROWTYPE;
  guarant  public.sacco_members%ROWTYPE;
  v_me     uuid := public.current_sacco_member_id();
  v_prod   text;
  v_canon  text;
  v_hash   text;
  v_cap    RECORD;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees WHERE id = p_guarantee_id;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found'; END IF;

  IF NOT (v_me IN (g.guarantor_member_id, g.borrower_member_id)
          OR public.is_global_viewer()
          OR (public.is_staff_member() AND g.admin_id = public.current_admin_id())) THEN
    RAISE EXCEPTION 'This guarantee is not addressed to you';
  END IF;

  SELECT * INTO l        FROM public.sacco_loans   WHERE id = g.loan_id;
  SELECT * INTO s        FROM public.saccos        WHERE id = g.sacco_id;
  SELECT * INTO borrower FROM public.sacco_members WHERE id = g.borrower_member_id;
  SELECT * INTO guarant  FROM public.sacco_members WHERE id = g.guarantor_member_id;
  SELECT name INTO v_prod FROM public.sacco_loan_products WHERE id = l.product_id;
  SELECT * INTO v_cap FROM public.sacco_loan_guarantee_capacity(g.sacco_id, g.guarantor_member_id);

  -- Canonical form. Field order and separators are fixed and every value is
  -- normalised, so the same agreement always produces the same digest.
  v_canon := concat_ws('|',
    public.sacco_loan_guarantee_terms_version(),
    g.id::text,
    g.sacco_id::text,
    COALESCE(s.name, ''),
    g.loan_id::text,
    to_char(COALESCE(l.principal, 0), 'FM9999999999990.00'),
    to_char(COALESCE(l.annual_interest_rate, 0), 'FM9990.000'),
    COALESCE(l.term_months, 0)::text,
    COALESCE(l.method::text, ''),
    COALESCE(l.purpose, ''),
    g.borrower_member_id::text,
    COALESCE(borrower.full_name, ''),
    COALESCE(borrower.member_no, ''),
    g.guarantor_member_id::text,
    COALESCE(guarant.full_name, ''),
    COALESCE(guarant.member_no, ''),
    to_char(g.amount_guaranteed, 'FM9999999999990.00'),
    public.sacco_loan_guarantee_clauses()::text
  );
  v_hash := encode(extensions.digest(v_canon, 'sha256'), 'hex');

  RETURN jsonb_build_object(
    'guarantee_id',      g.id,
    'ref_no',            g.ref_no,
    'version',           public.sacco_loan_guarantee_terms_version(),
    'hash',              v_hash,
    'status',            g.status,
    'sacco_name',        s.name,
    'amount_guaranteed', g.amount_guaranteed,
    'requested_at',      g.created_at,
    'reviewed_at',       g.reviewed_at,
    'accepted_at',       g.accepted_at,
    'review_valid_until',
      CASE WHEN g.reviewed_at IS NULL THEN NULL
           ELSE g.reviewed_at + interval '30 minutes' END,
    'terms_changed_since_review',
      (g.reviewed_terms_hash IS NOT NULL AND g.reviewed_terms_hash <> v_hash),
    'loan', jsonb_build_object(
      'id',          l.id,
      'ref',         'LN-' || upper(substr(l.id::text, 1, 8)),
      'product',     COALESCE(v_prod, l.method::text),
      'principal',   l.principal,
      'rate',        l.annual_interest_rate,
      'term_months', l.term_months,
      'method',      l.method,
      'purpose',     l.purpose,
      'status',      l.status),
    'borrower', jsonb_build_object(
      'name', borrower.full_name, 'member_no', borrower.member_no),
    'guarantor', jsonb_build_object(
      'name', guarant.full_name, 'member_no', guarant.member_no),
    'capacity', jsonb_build_object(
      'deposits',          v_cap.deposits,
      'share_value',       v_cap.share_value,
      'already_committed', v_cap.committed,
      'security',          v_cap.security),
    -- The society's rule, and where this member stands against it. Sent so the
    -- portal can refuse on step 1 with the same sentence the RPCs would raise.
    'cap', jsonb_build_object(
      'enforced',      v_cap.cap_enforced,
      'multiple',      v_cap.cap_multiple,
      'counts_shares', v_cap.counts_shares,
      'limit',         v_cap.cap,
      'headroom',      v_cap.headroom,
      'active_count',  v_cap.active_count,
      'max_active',    v_cap.max_active),
    'blocked_reason', public.sacco_loan_guarantee_capacity_block(p_guarantee_id),
    'clauses', public.sacco_loan_guarantee_clauses()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_terms(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. REQUEST — the borrower nominates a guarantor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_request(
  p_loan_id             uuid,
  p_guarantor_member_id uuid,
  p_amount              numeric,
  p_notes               text DEFAULT NULL
)
RETURNS public.sacco_loan_guarantees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me      uuid := public.current_sacco_member_id();
  v_sacco   uuid;
  v_admin   uuid;
  l         public.sacco_loans%ROWTYPE;
  gm        public.sacco_members%ROWTYPE;
  g         public.sacco_loan_guarantees%ROWTYPE;
  v_covered numeric;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Only a sacco member can request a guarantor'; END IF;

  SELECT * INTO l FROM public.sacco_loans WHERE id = p_loan_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Loan not found'; END IF;
  IF l.member_id <> v_me THEN
    RAISE EXCEPTION 'You can only request guarantors for your own loan';
  END IF;
  IF l.status IN ('closed', 'rejected') THEN
    RAISE EXCEPTION 'This loan is % — it can no longer take guarantors', l.status;
  END IF;

  IF p_guarantor_member_id = v_me THEN
    RAISE EXCEPTION 'You cannot guarantee your own loan';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Enter the amount you are asking this member to guarantee';
  END IF;

  v_sacco := l.sacco_id;
  SELECT * INTO gm FROM public.sacco_members
   WHERE id = p_guarantor_member_id AND sacco_id = v_sacco;
  IF gm.id IS NULL THEN RAISE EXCEPTION 'That member is not in your sacco'; END IF;
  IF gm.status <> 'active' THEN
    RAISE EXCEPTION '% is not an active member and cannot guarantee a loan', gm.full_name;
  END IF;

  -- The guarantees on one loan cannot promise more than the loan itself.
  SELECT COALESCE(SUM(amount_guaranteed), 0) INTO v_covered
    FROM public.sacco_loan_guarantees
   WHERE loan_id = p_loan_id AND status IN ('requested', 'under_review', 'accepted');
  IF v_covered + p_amount > COALESCE(l.principal, 0) THEN
    RAISE EXCEPTION 'That would guarantee % against a loan of % — % is already requested or accepted',
      to_char(v_covered + p_amount, 'FM999,999,999,990.00'),
      to_char(COALESCE(l.principal, 0), 'FM999,999,999,990.00'),
      to_char(v_covered, 'FM999,999,999,990.00');
  END IF;

  IF EXISTS (SELECT 1 FROM public.sacco_loan_guarantees
              WHERE loan_id = p_loan_id
                AND guarantor_member_id = p_guarantor_member_id
                AND status IN ('requested', 'under_review', 'accepted')) THEN
    RAISE EXCEPTION 'You have already asked % to guarantee this loan', gm.full_name;
  END IF;

  SELECT admin_id INTO v_admin FROM public.saccos WHERE id = v_sacco;

  -- The check above loses a race between two concurrent requests; the unique
  -- index settles it, and this turns that into the same sentence.
  BEGIN
    INSERT INTO public.sacco_loan_guarantees
      (admin_id, sacco_id, loan_id, borrower_member_id, guarantor_member_id,
       ref_no, amount_guaranteed, notes, requested_by)
    VALUES
      (v_admin, v_sacco, p_loan_id, v_me, p_guarantor_member_id,
       'GT-' || lpad(nextval('public.sacco_loan_guarantee_seq')::text, 6, '0'),
       p_amount, NULLIF(trim(COALESCE(p_notes, '')), ''), auth.uid())
    RETURNING * INTO g;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You have already asked % to guarantee this loan', gm.full_name;
  END;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'requested', NULL,
    'Requested from ' || gm.full_name);
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_request(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_request(uuid, uuid, numeric, text)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. STEP 1 — REVIEW THE TERMS
--    The guarantor states that they have been shown the agreement. The hash
--    they echo back must be the one the agreement produces right now, so a
--    stale or fabricated screen cannot count as a review.
--
--    Re-reviewing is always allowed while the row is still open: that is how
--    a guarantor recovers from an expired review or from terms that moved
--    under them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_review(
  p_guarantee_id uuid,
  p_terms_hash   text
)
RETURNS public.sacco_loan_guarantees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := public.current_sacco_member_id();
  g       public.sacco_loan_guarantees%ROWTYPE;
  v_terms jsonb;
  v_hash  text;
  v_block text;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees
   WHERE id = p_guarantee_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found'; END IF;
  IF v_me IS NULL OR g.guarantor_member_id <> v_me THEN
    RAISE EXCEPTION 'Only the nominated guarantor can review this agreement';
  END IF;
  IF g.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'This guarantee is % — there is nothing left to review', g.status;
  END IF;

  -- Eligibility comes before the terms: there is no point recording that
  -- somebody read an agreement they are not allowed to take on.
  v_block := public.sacco_loan_guarantee_capacity_block(p_guarantee_id);
  IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;

  v_terms := public.sacco_loan_guarantee_terms(p_guarantee_id);
  v_hash  := v_terms->>'hash';

  IF p_terms_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'The agreement changed while you were reading it. Reopen it and read the current terms.';
  END IF;

  UPDATE public.sacco_loan_guarantees
     SET status              = 'under_review',
         terms_version       = v_terms->>'version',
         reviewed_terms_hash = v_hash,
         reviewed_at         = now(),
         updated_at          = now()
   WHERE id = p_guarantee_id
  RETURNING * INTO g;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'reviewed', v_hash,
    'Terms ' || COALESCE(g.terms_version, '') || ' reviewed');
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_review(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. STEP 2 — CONFIRM, AND ONLY THEN IS IT BINDING
--
--    Every one of these refusals is a way the two-step check could otherwise
--    be reduced to one:
--      • status must be under_review     — confirm cannot be called cold
--      • review must exist and be fresh  — a review from last week is not consent now
--      • hash must match the review      — the terms have not moved since
--      • hash must match the agreement   — and they are still current
--      • signature must be the guarantor — the person confirming is the person bound
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_confirm(
  p_guarantee_id uuid,
  p_terms_hash   text,
  p_signature    text
)
RETURNS public.sacco_loan_guarantees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := public.current_sacco_member_id();
  g       public.sacco_loan_guarantees%ROWTYPE;
  gm      public.sacco_members%ROWTYPE;
  l       public.sacco_loans%ROWTYPE;
  v_terms jsonb;
  v_hash  text;
  v_norm  text;
  v_block text;
BEGIN
  SELECT * INTO g FROM public.sacco_loan_guarantees
   WHERE id = p_guarantee_id FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Guarantee not found'; END IF;
  IF v_me IS NULL OR g.guarantor_member_id <> v_me THEN
    RAISE EXCEPTION 'Only the nominated guarantor can confirm this agreement';
  END IF;

  IF g.status = 'accepted' THEN
    RAISE EXCEPTION 'You have already confirmed this guarantee — it is final';
  END IF;
  IF g.status = 'requested' THEN
    RAISE EXCEPTION 'Read the agreement first — a guarantee cannot be confirmed unread';
  END IF;
  IF g.status <> 'under_review' THEN
    RAISE EXCEPTION 'This guarantee is % and can no longer be confirmed', g.status;
  END IF;
  IF g.reviewed_at IS NULL OR g.reviewed_terms_hash IS NULL THEN
    RAISE EXCEPTION 'Read the agreement first — a guarantee cannot be confirmed unread';
  END IF;
  IF g.reviewed_at < now() - interval '30 minutes' THEN
    RAISE EXCEPTION 'You read these terms more than 30 minutes ago. Read them again, then confirm.';
  END IF;

  -- The loan can move on while a request sits unanswered.
  SELECT * INTO l FROM public.sacco_loans WHERE id = g.loan_id;
  IF l.status IN ('closed', 'rejected') THEN
    RAISE EXCEPTION 'This loan is % — it no longer needs a guarantee', l.status;
  END IF;

  -- And so can the guarantor's position. Checked again at the binding moment,
  -- not just at step 1: between the two steps they may have confirmed another
  -- guarantee in another tab, or had a contribution reversed. The cap has to
  -- hold at the instant the commitment is made, or it is not a cap.
  v_block := public.sacco_loan_guarantee_capacity_block(p_guarantee_id);
  IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;

  v_terms := public.sacco_loan_guarantee_terms(p_guarantee_id);
  v_hash  := v_terms->>'hash';

  -- Same digest on both sides of the two steps, and still current.
  IF g.reviewed_terms_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'The agreement has changed since you read it. Read the new terms before confirming.';
  END IF;
  IF p_terms_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'These are not the terms you were shown. Reopen the agreement and read it again.';
  END IF;

  SELECT * INTO gm FROM public.sacco_members WHERE id = v_me;
  v_norm := lower(regexp_replace(COALESCE(p_signature, ''), '\s+', ' ', 'g'));
  v_norm := trim(v_norm);
  IF v_norm = '' OR v_norm <> trim(lower(regexp_replace(COALESCE(gm.full_name, ''), '\s+', ' ', 'g'))) THEN
    RAISE EXCEPTION 'Sign with your full name exactly as the sacco holds it: %', gm.full_name;
  END IF;

  UPDATE public.sacco_loan_guarantees
     SET status              = 'accepted',
         accepted_terms_hash = v_hash,
         accepted_at         = now(),
         signature_name      = trim(p_signature),
         updated_at          = now()
   WHERE id = p_guarantee_id
  RETURNING * INTO g;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'confirmed', v_hash,
    'Signed as ' || g.signature_name);
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_confirm(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_confirm(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. DECLINE / CANCEL
--    A guarantor may decline right up to the moment they confirm — including
--    after reviewing. A borrower may withdraw a request that is not yet bound.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_decline(
  p_guarantee_id uuid,
  p_reason       text DEFAULT NULL
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
    RAISE EXCEPTION 'Only the nominated guarantor can decline this request';
  END IF;
  IF g.status = 'accepted' THEN
    RAISE EXCEPTION 'You have already confirmed this guarantee — it cannot be withdrawn';
  END IF;
  IF g.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'This request is already %', g.status;
  END IF;

  UPDATE public.sacco_loan_guarantees
     SET status = 'declined', declined_at = now(),
         decline_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
         updated_at = now()
   WHERE id = p_guarantee_id
  RETURNING * INTO g;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'declined', NULL, g.decline_reason);
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_decline(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_decline(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sacco_loan_guarantee_cancel(
  p_guarantee_id uuid
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
  IF v_me IS NULL OR g.borrower_member_id <> v_me THEN
    RAISE EXCEPTION 'Only the borrower can withdraw this request';
  END IF;
  IF g.status = 'accepted' THEN
    RAISE EXCEPTION 'This guarantee is already confirmed — ask the sacco to release it';
  END IF;
  IF g.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'This request is already %', g.status;
  END IF;

  UPDATE public.sacco_loan_guarantees
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = p_guarantee_id
  RETURNING * INTO g;

  PERFORM public.sacco_loan_guarantee_event(g.id, 'cancelled', NULL, 'Withdrawn by the borrower');
  RETURN g;
END;
$$;

REVOKE ALL ON FUNCTION public.sacco_loan_guarantee_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sacco_loan_guarantee_cancel(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RELEASE
--    "The guarantee is released once the underlying facility is repaid in
--    full" is a clause the guarantor was shown, so the register has to honour
--    it without waiting for anyone to remember. Closing or rejecting the loan
--    releases every guarantee standing on it; open requests lapse.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_loan_guarantees_on_loan_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('closed', 'rejected') THEN

    UPDATE public.sacco_loan_guarantees
       SET status = 'released', released_at = now(),
           release_reason = 'Loan ' || NEW.status::text,
           updated_at = now()
     WHERE loan_id = NEW.id AND status = 'accepted';

    UPDATE public.sacco_loan_guarantees
       SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE loan_id = NEW.id AND status IN ('requested', 'under_review');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_loan_guarantees_loan_status ON public.sacco_loans;
CREATE TRIGGER sacco_loan_guarantees_loan_status
  AFTER UPDATE OF status ON public.sacco_loans
  FOR EACH ROW EXECUTE FUNCTION public.sacco_loan_guarantees_on_loan_status();

-- ----------------------------------------------------------------------------
-- 9. NO SIDE DOOR
--    Everything above runs SECURITY DEFINER. Members get SELECT only, so the
--    two-step flow cannot be bypassed with a direct PostgREST write — an
--    UPDATE that set status='accepted' has no policy to pass, and would trip
--    sacco_loan_guarantees_two_step_chk even if it did.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['sacco_loan_guarantees', 'sacco_loan_guarantee_events',
                       'sacco_guarantee_settings'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_admin_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_admin_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();', t);

    EXECUTE format('ALTER TABLE public.%1$s ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_manage_%1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "tenant_manage_%1$s" ON public.%1$s
         FOR ALL TO authenticated
         USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
         WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());', t);
  END LOOP;
END $$;

-- Both parties to an agreement can read it — the guarantor because they are
-- bound by it, the borrower because they need to know who has answered.
DROP POLICY IF EXISTS "member_read_own_sacco_loan_guarantees" ON public.sacco_loan_guarantees;
CREATE POLICY "member_read_own_sacco_loan_guarantees" ON public.sacco_loan_guarantees
  FOR SELECT TO authenticated
  USING (guarantor_member_id = public.current_sacco_member_id()
         OR borrower_member_id = public.current_sacco_member_id());

-- A member is entitled to see the rule they are being held to, even though
-- terms() already spells it out for the agreement in front of them.
DROP POLICY IF EXISTS "member_read_sacco_guarantee_settings" ON public.sacco_guarantee_settings;
CREATE POLICY "member_read_sacco_guarantee_settings" ON public.sacco_guarantee_settings
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

DROP POLICY IF EXISTS "member_read_own_sacco_loan_guarantee_events" ON public.sacco_loan_guarantee_events;
CREATE POLICY "member_read_own_sacco_loan_guarantee_events" ON public.sacco_loan_guarantee_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sacco_loan_guarantees g
     WHERE g.id = public.sacco_loan_guarantee_events.guarantee_id
       AND (g.guarantor_member_id = public.current_sacco_member_id()
            OR g.borrower_member_id = public.current_sacco_member_id())));

DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['sacco_loan_guarantees', 'sacco_loan_guarantee_events',
                       'sacco_guarantee_settings'];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
             WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- The reference sequence is deliberately NOT reset here: CREATE SEQUENCE IF NOT
-- EXISTS keeps its position, and re-running this file must never hand out a
-- GT- number that has already been issued.
