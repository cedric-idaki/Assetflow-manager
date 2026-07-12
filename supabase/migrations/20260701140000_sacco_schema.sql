-- ============================================================================
-- SACCO / CHAMA MANAGEMENT SCHEMA
-- ----------------------------------------------------------------------------
-- Backs the dedicated Sacco dashboard (/sacco-dashboard). A sacco is a tenant
-- owned by a sacco_admin auth user, mirroring how company_profiles is owned by
-- an admin. Every table carries admin_id and is isolated with the same RLS
-- helpers introduced in 20260628120000_tenant_isolation.sql
-- (current_admin_id / is_staff_member / is_global_viewer) plus a BEFORE INSERT
-- trigger that stamps admin_id = current_admin_id() when the app omits it.
--
-- Modules (per Chama Management System BRS v3.0):
--   members, contributions, loans (+ amortization schedule), shares (+ internal
--   marketplace), voting/governance, bylaws documents, tiered billing invoices.
--
-- The 'sacco_admin' enum value is added separately in 20260701130000 and MUST be
-- committed before this migration runs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. HELPERS (idempotent re-declare so this migration is self-contained even if
--    run before/independently of the tenant-isolation migration).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT up.admin_id FROM public.user_profiles up WHERE up.id = auth.uid()),
    auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_global_viewer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role IN ('super_admin'::public.user_role, 'director'::public.user_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role <> 'client'::public.user_role
  );
$$;

CREATE OR REPLACE FUNCTION public.set_admin_id_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.admin_id IS NULL THEN
    NEW.admin_id := public.current_admin_id();
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.sacco_member_role AS ENUM ('member', 'treasurer', 'chairman', 'secretary', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_member_status AS ENUM ('active', 'inactive', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.amortization_method AS ENUM
    ('reducing_balance', 'equal_principal', 'flat_rate', 'interest_only', 'balloon');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_loan_status AS ENUM ('pending', 'approved', 'active', 'closed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_contribution_status AS ENUM ('pending', 'paid', 'overdue', 'waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.motion_status AS ENUM ('draft', 'proposed', 'seconded', 'open', 'closed', 'passed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ballot_type AS ENUM ('visible', 'secret');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.vote_choice AS ENUM ('yes', 'no', 'abstain');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_doc_type AS ENUM ('constitution', 'bylaws', 'policy', 'minutes', 'resolution', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.share_listing_status AS ENUM ('open', 'pending_approval', 'settled', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------

-- Sacco tenant record (one per sacco_admin).
CREATE TABLE IF NOT EXISTS public.saccos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  name               TEXT NOT NULL,
  registration_no    TEXT,
  business_type      TEXT,
  email              TEXT,
  phone              TEXT,
  location           TEXT,
  city               TEXT,
  tier               TEXT DEFAULT 'bronze',          -- bronze | silver | gold (see saccoTiers.js)
  member_cap         INTEGER,
  storage_used_gb    DECIMAL(10,2) DEFAULT 0,
  kyc_status         TEXT DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Members of a sacco (managed by the sacco_admin in this phase — the member
-- self-service portal is Phase 2).
CREATE TABLE IF NOT EXISTS public.sacco_members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  member_no          TEXT,
  full_name          TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  national_id        TEXT,
  gender             TEXT,
  member_role        public.sacco_member_role   DEFAULT 'member',
  status             public.sacco_member_status DEFAULT 'active',
  kyc_status         TEXT DEFAULT 'pending',
  next_of_kin_name   TEXT,
  next_of_kin_relationship TEXT,
  next_of_kin_phone  TEXT,
  next_of_kin_id     TEXT,
  joined_at          DATE DEFAULT CURRENT_DATE,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Contributions / savings ledger.
CREATE TABLE IF NOT EXISTS public.sacco_contributions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  member_id          UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  amount             DECIMAL(15,2) NOT NULL DEFAULT 0,
  contribution_type  TEXT DEFAULT 'monthly',         -- monthly | weekly | project | other
  due_date           DATE,
  paid_date          DATE,
  status             public.sacco_contribution_status DEFAULT 'pending',
  penalty_amount     DECIMAL(15,2) DEFAULT 0,
  reference          TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Loan products (define the amortization method + rate).
CREATE TABLE IF NOT EXISTS public.sacco_loan_products (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID,
  sacco_id             UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  amortization_method  public.amortization_method DEFAULT 'reducing_balance',
  annual_interest_rate DECIMAL(6,3) DEFAULT 12,       -- percent per annum
  max_term_months      INTEGER DEFAULT 12,
  penalty_rate         DECIMAL(6,3) DEFAULT 0,         -- percent per overdue period
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Loan applications / loans.
CREATE TABLE IF NOT EXISTS public.sacco_loans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID,
  sacco_id             UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  member_id            UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  product_id           UUID REFERENCES public.sacco_loan_products(id) ON DELETE SET NULL,
  principal            DECIMAL(15,2) NOT NULL DEFAULT 0,
  annual_interest_rate DECIMAL(6,3) DEFAULT 12,
  term_months          INTEGER DEFAULT 12,
  method               public.amortization_method DEFAULT 'reducing_balance',
  balloon_amount       DECIMAL(15,2) DEFAULT 0,        -- only for the balloon method
  purpose              TEXT,
  status               public.sacco_loan_status DEFAULT 'pending',
  disbursed_at         TIMESTAMPTZ,
  approved_by          UUID,
  created_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Amortization schedule rows (generated from the engine on approval).
CREATE TABLE IF NOT EXISTS public.sacco_loan_schedule (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  loan_id            UUID REFERENCES public.sacco_loans(id) ON DELETE CASCADE,
  period_no          INTEGER NOT NULL,
  due_date           DATE,
  opening_balance    DECIMAL(15,2) DEFAULT 0,
  interest           DECIMAL(15,2) DEFAULT 0,
  principal          DECIMAL(15,2) DEFAULT 0,
  payment            DECIMAL(15,2) DEFAULT 0,
  closing_balance    DECIMAL(15,2) DEFAULT 0,
  paid               BOOLEAN DEFAULT false,
  paid_date          DATE,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Share holdings.
CREATE TABLE IF NOT EXISTS public.sacco_shares (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  member_id          UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  shares_held        INTEGER DEFAULT 0,
  par_value          DECIMAL(15,2) DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Internal share marketplace listings.
CREATE TABLE IF NOT EXISTS public.sacco_share_listings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  seller_member_id   UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  shares             INTEGER NOT NULL DEFAULT 0,
  price_per_share    DECIMAL(15,2) NOT NULL DEFAULT 0,
  status             public.share_listing_status DEFAULT 'open',
  expiry_date        DATE,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Share transfers (buyer expression of interest → admin approval → settlement).
CREATE TABLE IF NOT EXISTS public.sacco_share_transfers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  listing_id         UUID REFERENCES public.sacco_share_listings(id) ON DELETE SET NULL,
  seller_member_id   UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  buyer_member_id    UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  shares             INTEGER NOT NULL DEFAULT 0,
  price              DECIMAL(15,2) NOT NULL DEFAULT 0,
  status             TEXT DEFAULT 'pending',           -- pending | approved | settled | rejected
  approved_by        UUID,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Motions (voting & governance).
CREATE TABLE IF NOT EXISTS public.sacco_motions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  ballot_type        public.ballot_type DEFAULT 'visible',
  proposer_id        UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  seconder_id        UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  status             public.motion_status DEFAULT 'draft',
  voting_start       TIMESTAMPTZ,
  voting_end         TIMESTAMPTZ,
  quorum_percent     INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Individual votes. For secret ballots the app never exposes per-member choices
-- in the UI (only aggregate totals). NOTE: this is not cryptographic secrecy —
-- real encrypted ballots are a Phase 2 item.
CREATE TABLE IF NOT EXISTS public.sacco_votes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  motion_id          UUID REFERENCES public.sacco_motions(id) ON DELETE CASCADE,
  member_id          UUID REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  choice             public.vote_choice NOT NULL,
  is_secret          BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (motion_id, member_id)
);

-- Governance document library (constitution, bylaws, policies, minutes).
CREATE TABLE IF NOT EXISTS public.sacco_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID,
  sacco_id           UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  doc_type           public.sacco_doc_type DEFAULT 'other',
  version            TEXT DEFAULT 'v1.0',
  file_url           TEXT,
  effective_date     DATE,
  uploaded_by        UUID,
  motion_ref         UUID REFERENCES public.sacco_motions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Monthly tiered-billing invoices (base + per-member + storage).
CREATE TABLE IF NOT EXISTS public.sacco_invoices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id               UUID,
  sacco_id               UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  period                 DATE NOT NULL,
  tier                   TEXT,
  active_members         INTEGER DEFAULT 0,
  base_fee               DECIMAL(15,2) DEFAULT 0,
  per_member_fee_total   DECIMAL(15,2) DEFAULT 0,
  storage_fee            DECIMAL(15,2) DEFAULT 0,
  total                  DECIMAL(15,2) DEFAULT 0,
  status                 public.sacco_invoice_status DEFAULT 'draft',
  created_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saccos_admin_id                ON public.saccos(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_members_admin_id         ON public.sacco_members(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_members_sacco_id         ON public.sacco_members(sacco_id);
CREATE INDEX IF NOT EXISTS idx_sacco_contributions_admin_id   ON public.sacco_contributions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_contributions_member_id  ON public.sacco_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_products_admin_id   ON public.sacco_loan_products(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loans_admin_id           ON public.sacco_loans(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loans_member_id          ON public.sacco_loans(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_schedule_admin_id   ON public.sacco_loan_schedule(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_loan_schedule_loan_id    ON public.sacco_loan_schedule(loan_id);
CREATE INDEX IF NOT EXISTS idx_sacco_shares_admin_id          ON public.sacco_shares(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_shares_member_id         ON public.sacco_shares(member_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_listings_admin_id  ON public.sacco_share_listings(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_share_transfers_admin_id ON public.sacco_share_transfers(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_motions_admin_id         ON public.sacco_motions(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_votes_admin_id           ON public.sacco_votes(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_votes_motion_id          ON public.sacco_votes(motion_id);
CREATE INDEX IF NOT EXISTS idx_sacco_documents_admin_id       ON public.sacco_documents(admin_id);
CREATE INDEX IF NOT EXISTS idx_sacco_invoices_admin_id        ON public.sacco_invoices(admin_id);

-- ----------------------------------------------------------------------------
-- 4. AUTO-TAG admin_id ON INSERT (per-tenant stamping) + updated_at not managed
--    here (app sets it). One trigger per table, all using set_admin_id_default().
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  sacco_tables text[] := ARRAY[
    'saccos','sacco_members','sacco_contributions','sacco_loan_products',
    'sacco_loans','sacco_loan_schedule','sacco_shares','sacco_share_listings',
    'sacco_share_transfers','sacco_motions','sacco_votes','sacco_documents',
    'sacco_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY sacco_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_admin_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_admin_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY — one per-tenant policy per table.
--    A sacco_admin (or its future staff) sees only its own rows; super_admin and
--    director keep a global read/manage view via is_global_viewer().
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  sacco_tables text[] := ARRAY[
    'saccos','sacco_members','sacco_contributions','sacco_loan_products',
    'sacco_loans','sacco_loan_schedule','sacco_shares','sacco_share_listings',
    'sacco_share_transfers','sacco_motions','sacco_votes','sacco_documents',
    'sacco_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY sacco_tables LOOP
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
