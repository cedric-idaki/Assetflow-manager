-- ============================================================================
-- SACCO / CHAMA FINANCIAL ACCOUNTING ENGINE
-- ----------------------------------------------------------------------------
-- Implements the "SACCO / Chama Financial Accounting System" specification:
-- a fund-accounting ledger core on top of double entry, able to produce a
-- statutory Income Statement, Balance Sheet and Cash Flow Statement for a
-- deposit-taking SACCO, a BOSA-only SACCO, or any Chama variant from ONE
-- configurable core (spec §9/§10.5 "Society Type" switch).
--
-- SACCO/CHAMA ONLY. Companies keep using public.chart_of_accounts /
-- public.journal_entries — nothing in this migration touches those tables.
--
-- Key design points carried over from the spec:
--   §2.3  Share Capital is EQUITY, member Savings/Deposits are a LIABILITY.
--         Enforced by the seeded chart of accounts (3010 vs 2010–2013).
--   §4    Every posting goes through a JournalTemplate, never raw Dr/Cr picked
--         in the UI. Templates are data (sacco_journal_templates), not code.
--   §10.2 Σdebits = Σcredits enforced at the DATABASE-TRANSACTION level by a
--         deferred constraint trigger, not just UI validation.
--   §10.2 Postings into a CLOSED period are rejected; corrections happen via an
--         auto-generated reversing entry in the current open period.
--   §10.4 Period-end close is a guided checklist persisted on the period row.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.sacco_account_class AS ENUM
    ('asset', 'liability', 'equity', 'income', 'expense', 'memo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_normal_balance AS ENUM ('debit', 'credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- §2.2 BOSA / FOSA segment tagging on every account and every posting.
DO $$ BEGIN
  CREATE TYPE public.sacco_segment AS ENUM ('bosa', 'fosa', 'both', 'chama');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_period_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sacco_je_status AS ENUM ('posted', 'reversed', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- §9 configuration matrix.
DO $$ BEGIN
  CREATE TYPE public.sacco_society_type AS ENUM
    ('sacco_dt', 'sacco_bosa', 'chama_investment', 'chama_mgr', 'chama_welfare');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- §2.5 loan classification buckets.
DO $$ BEGIN
  CREATE TYPE public.sacco_loan_class AS ENUM
    ('performing', 'watch', 'substandard', 'doubtful', 'loss');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------

-- §10.1 Society — by-law parameters + the module switches of the §9 matrix.
CREATE TABLE IF NOT EXISTS public.sacco_society_config (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                  UUID,
  sacco_id                  UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  society_type              public.sacco_society_type DEFAULT 'sacco_bosa',
  base_currency             TEXT    DEFAULT 'KES',
  fiscal_year_start_month   INTEGER DEFAULT 1,          -- 1 = January
  -- by-law parameters (§2.4 — configurable, never hard-coded)
  statutory_reserve_pct     DECIMAL(6,3) DEFAULT 20,
  loanable_funds_multiple   DECIMAL(6,2) DEFAULT 3,     -- §9.2 BOSA ceiling
  dividend_rate_pct         DECIMAL(6,3) DEFAULT 0,
  iod_rate_pct              DECIMAL(6,3) DEFAULT 0,     -- interest on deposits
  deposit_interest_rate_pct DECIMAL(6,3) DEFAULT 0,     -- accrual on 2010–2013
  -- module switches (§9)
  share_capital_enabled     BOOLEAN DEFAULT true,
  loan_book_enabled         BOOLEAN DEFAULT true,
  fosa_enabled              BOOLEAN DEFAULT false,
  provisioning_enabled      BOOLEAN DEFAULT true,
  statutory_reserve_enabled BOOLEAN DEFAULT true,
  dividends_enabled         BOOLEAN DEFAULT true,
  sasra_returns_enabled     BOOLEAN DEFAULT false,
  welfare_fund_enabled      BOOLEAN DEFAULT false,
  mgr_enabled               BOOLEAN DEFAULT false,      -- merry-go-round cycles
  coa_seeded_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_society_config_admin
  ON public.sacco_society_config(admin_id);

-- §3 Chart of Accounts. 4-digit hierarchical code, first digit = class.
CREATE TABLE IF NOT EXISTS public.sacco_chart_of_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID,
  sacco_id        UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  account_code    TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  account_class   public.sacco_account_class   NOT NULL,
  normal_balance  public.sacco_normal_balance  NOT NULL,
  segment         public.sacco_segment DEFAULT 'both',
  parent_code     TEXT,
  is_contra       BOOLEAN DEFAULT false,   -- 1190, 1390 — credit-balance assets
  is_system       BOOLEAN DEFAULT false,   -- seeded from the spec; not deletable
  is_active       BOOLEAN DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_coa_admin_code
  ON public.sacco_chart_of_accounts(admin_id, account_code);

-- §10.1 Period / FiscalYear.
CREATE TABLE IF NOT EXISTS public.sacco_fiscal_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID,
  sacco_id      UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  fiscal_year   INTEGER NOT NULL,
  period_no     INTEGER NOT NULL,          -- 1..12 within the fiscal year
  label         TEXT,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        public.sacco_period_status DEFAULT 'open',
  checklist     JSONB DEFAULT '{}'::jsonb, -- §10.4 guided close workflow state
  closed_at     TIMESTAMPTZ,
  closed_by     UUID,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_periods_admin_year_no
  ON public.sacco_fiscal_periods(admin_id, fiscal_year, period_no);
CREATE INDEX IF NOT EXISTS idx_sacco_periods_dates
  ON public.sacco_fiscal_periods(admin_id, start_date, end_date);

-- §4 JournalTemplate — the codified debit/credit table, as DATA.
CREATE TABLE IF NOT EXISTS public.sacco_journal_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID,
  sacco_id          UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  template_code     TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT,                 -- member | loan | period_end | equity | chama | ops
  debit_account     TEXT NOT NULL,
  credit_account    TEXT NOT NULL,
  -- Spec writes "1010/1020 Cash/Bank" — one side is selectable at posting time.
  variable_side     TEXT,                 -- 'debit' | 'credit' | NULL
  variable_options  TEXT[] DEFAULT '{}',
  trigger_hint      TEXT,                 -- the spec's "Trigger" column
  requires_member   BOOLEAN DEFAULT false,
  is_automated      BOOLEAN DEFAULT false,-- produced by a period-end batch job
  is_active         BOOLEAN DEFAULT true,
  sort_order        INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_jtemplates_admin_code
  ON public.sacco_journal_templates(admin_id, template_code);

-- §10.1 JournalEntry (header).
CREATE TABLE IF NOT EXISTS public.sacco_journal_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  sacco_id       UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  entry_no       TEXT,
  entry_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  period_id      UUID REFERENCES public.sacco_fiscal_periods(id) ON DELETE RESTRICT,
  template_code  TEXT,
  description    TEXT,
  reference      TEXT,
  member_id      UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  -- Dedupe key for auto-posting from operational tables (contributions, loans…)
  source_table   TEXT,
  source_id      UUID,
  batch_ref      TEXT,                    -- groups one batch job's entries
  status         public.sacco_je_status DEFAULT 'posted',
  is_automated   BOOLEAN DEFAULT false,
  reversal_of    UUID REFERENCES public.sacco_journal_entries(id) ON DELETE SET NULL,
  reversed_by    UUID REFERENCES public.sacco_journal_entries(id) ON DELETE SET NULL,
  total_amount   DECIMAL(15,2) DEFAULT 0,
  created_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sacco_je_admin_date
  ON public.sacco_journal_entries(admin_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_sacco_je_period ON public.sacco_journal_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_sacco_je_member ON public.sacco_journal_entries(member_id);
-- One live auto-posted entry per source row per template. This is what makes
-- the operations sync and the period-end batch jobs idempotent. Reversed
-- entries drop out of the index so a corrected batch can be re-run.
DROP INDEX IF EXISTS public.idx_sacco_je_source;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_je_source
  ON public.sacco_journal_entries(admin_id, source_table, source_id, template_code)
  WHERE source_id IS NOT NULL AND status <> 'reversed';

-- §10.1 JournalEntry lines. Multi-line so one economic event = one entry.
CREATE TABLE IF NOT EXISTS public.sacco_journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID,
  entry_id      UUID NOT NULL REFERENCES public.sacco_journal_entries(id) ON DELETE CASCADE,
  line_no       INTEGER DEFAULT 1,
  account_code  TEXT NOT NULL,
  account_name  TEXT,
  debit         DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit        DECIMAL(15,2) NOT NULL DEFAULT 0,
  segment       public.sacco_segment DEFAULT 'both',
  member_id     UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  memo          TEXT,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sacco_jl_amounts_nonneg CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT sacco_jl_one_side       CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT sacco_jl_not_empty      CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_sacco_jl_entry   ON public.sacco_journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_sacco_jl_account ON public.sacco_journal_lines(admin_id, account_code);

-- §10.1 ProvisionPolicy — drives the automated 5300/1190 entries.
CREATE TABLE IF NOT EXISTS public.sacco_provision_policy (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  sacco_id       UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  classification public.sacco_loan_class NOT NULL,
  min_days       INTEGER NOT NULL DEFAULT 0,
  max_days       INTEGER,                       -- NULL = open-ended (loss)
  provision_pct  DECIMAL(6,3) NOT NULL DEFAULT 0,
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_provision_admin_class
  ON public.sacco_provision_policy(admin_id, classification);

-- Result of each provisioning run — auditable, per loan per period.
CREATE TABLE IF NOT EXISTS public.sacco_loan_classifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID,
  sacco_id         UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  period_id        UUID REFERENCES public.sacco_fiscal_periods(id) ON DELETE CASCADE,
  loan_id          UUID REFERENCES public.sacco_loans(id) ON DELETE CASCADE,
  member_id        UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  outstanding      DECIMAL(15,2) DEFAULT 0,
  days_in_arrears  INTEGER DEFAULT 0,
  classification   public.sacco_loan_class DEFAULT 'performing',
  provision_pct    DECIMAL(6,3) DEFAULT 0,
  provision_amount DECIMAL(15,2) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_loanclass_period_loan
  ON public.sacco_loan_classifications(period_id, loan_id);

-- §10.1 AppropriationRule — the §2.4 surplus waterfall, ordered.
CREATE TABLE IF NOT EXISTS public.sacco_appropriation_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID,
  sacco_id       UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  rule_type      TEXT NOT NULL,     -- statutory_reserve | education | development |
                                    -- welfare | honoraria | dividend | iod
  name           TEXT NOT NULL,
  percent        DECIMAL(6,3) NOT NULL DEFAULT 0,
  target_account TEXT NOT NULL,
  is_mandatory   BOOLEAN DEFAULT false,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_approp_admin_type
  ON public.sacco_appropriation_rules(admin_id, rule_type);

-- Property/equipment register — feeds the depreciation batch job (§10.4 step 3)
-- and the Balance Sheet PPE line (§6.1).
CREATE TABLE IF NOT EXISTS public.sacco_fixed_assets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                 UUID,
  sacco_id                 UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  asset_name               TEXT NOT NULL,
  gl_code                  TEXT NOT NULL DEFAULT '1310',  -- 1300–1330 or 1400
  acquisition_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  cost                     DECIMAL(15,2) NOT NULL DEFAULT 0,
  residual_value           DECIMAL(15,2) DEFAULT 0,
  useful_life_years        DECIMAL(6,2) DEFAULT 4,
  method                   TEXT DEFAULT 'straight_line',   -- straight_line | reducing
  accumulated_depreciation DECIMAL(15,2) DEFAULT 0,
  last_depreciated_period  UUID REFERENCES public.sacco_fiscal_periods(id) ON DELETE SET NULL,
  is_disposed              BOOLEAN DEFAULT false,
  disposal_date            DATE,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sacco_fixed_assets_admin
  ON public.sacco_fixed_assets(admin_id);

-- §9.4 Merry-go-round: cycles + per-member contribution/payout grid.
CREATE TABLE IF NOT EXISTS public.sacco_mgr_cycles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                 UUID,
  sacco_id                 UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  cycle_no                 INTEGER NOT NULL DEFAULT 1,
  label                    TEXT,
  cycle_date               DATE DEFAULT CURRENT_DATE,
  contribution_per_member  DECIMAL(15,2) DEFAULT 0,
  beneficiary_member_id    UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  payout_amount            DECIMAL(15,2) DEFAULT 0,
  payout_date              DATE,
  status                   TEXT DEFAULT 'open',  -- open | collecting | paid | closed
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_mgr_cycles_admin_no
  ON public.sacco_mgr_cycles(admin_id, cycle_no);

CREATE TABLE IF NOT EXISTS public.sacco_mgr_contributions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID,
  cycle_id    UUID NOT NULL REFERENCES public.sacco_mgr_cycles(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES public.sacco_members(id) ON DELETE CASCADE,
  amount      DECIMAL(15,2) DEFAULT 0,
  paid        BOOLEAN DEFAULT false,
  paid_date   DATE,
  reference   TEXT,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_mgr_contrib_cycle_member
  ON public.sacco_mgr_contributions(cycle_id, member_id);

-- §9.5 Welfare Chama claims register — posts against the fund, not the P&L.
CREATE TABLE IF NOT EXISTS public.sacco_welfare_claims (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID,
  sacco_id         UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  claim_no         TEXT,
  member_id        UUID REFERENCES public.sacco_members(id) ON DELETE SET NULL,
  claim_date       DATE DEFAULT CURRENT_DATE,
  category         TEXT,                 -- bereavement | medical | education | other
  reason           TEXT,
  amount_requested DECIMAL(15,2) DEFAULT 0,
  amount_approved  DECIMAL(15,2) DEFAULT 0,
  amount_paid      DECIMAL(15,2) DEFAULT 0,
  status           TEXT DEFAULT 'pending', -- pending | approved | rejected | paid
  approved_by      UUID,
  approved_at      TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sacco_welfare_claims_admin
  ON public.sacco_welfare_claims(admin_id);

-- ----------------------------------------------------------------------------
-- 3. AUTO-TAG admin_id + RLS (same tenant model as every other sacco_* table)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  fin_tables text[] := ARRAY[
    'sacco_society_config','sacco_chart_of_accounts','sacco_fiscal_periods',
    'sacco_journal_templates','sacco_journal_entries','sacco_journal_lines',
    'sacco_provision_policy','sacco_loan_classifications',
    'sacco_appropriation_rules','sacco_fixed_assets','sacco_mgr_cycles',
    'sacco_mgr_contributions','sacco_welfare_claims'
  ];
BEGIN
  FOREACH t IN ARRAY fin_tables LOOP
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
         WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());',
      t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. INTEGRITY TRIGGERS
--    (a) Σdebits = Σcredits per entry, checked at COMMIT (§10.2).
--    (b) No posting into a closed period (§10.2).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sacco_je_balance_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry uuid;
  v_dr numeric;
  v_cr numeric;
  v_n  integer;
BEGIN
  -- NEW is unassigned on DELETE, OLD is unassigned on INSERT.
  IF TG_OP = 'DELETE' THEN v_entry := OLD.entry_id; ELSE v_entry := NEW.entry_id; END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
    INTO v_dr, v_cr, v_n
    FROM public.sacco_journal_lines
   WHERE entry_id = v_entry;

  -- Entry fully deleted (cascade) — nothing left to balance.
  IF v_n = 0 THEN RETURN NULL; END IF;

  IF round(v_dr, 2) <> round(v_cr, 2) THEN
    RAISE EXCEPTION
      'Journal entry % is out of balance: debits %, credits %',
      v_entry, round(v_dr, 2), round(v_cr, 2)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sacco_jl_balance_check ON public.sacco_journal_lines;
CREATE CONSTRAINT TRIGGER sacco_jl_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON public.sacco_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.sacco_je_balance_check();

CREATE OR REPLACE FUNCTION public.sacco_je_period_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.sacco_period_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.period_id IS NOT DISTINCT FROM OLD.period_id
     AND NEW.entry_date IS NOT DISTINCT FROM OLD.entry_date THEN
    RETURN NEW;   -- status/reversal bookkeeping updates stay allowed
  END IF;

  SELECT status INTO v_status
    FROM public.sacco_fiscal_periods
   WHERE id = NEW.period_id;

  IF v_status = 'closed' THEN
    RAISE EXCEPTION
      'Accounting period is closed — post a reversing entry in the current open period instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_je_period_guard ON public.sacco_journal_entries;
CREATE TRIGGER sacco_je_period_guard
  BEFORE INSERT OR UPDATE ON public.sacco_journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.sacco_je_period_guard();

-- Entry numbering.
CREATE SEQUENCE IF NOT EXISTS public.sacco_journal_entry_seq;

-- ----------------------------------------------------------------------------
-- 5. PERIOD HELPERS
-- ----------------------------------------------------------------------------

-- Creates the 12 monthly periods of a fiscal year (idempotent) and returns the
-- number created. fiscal_year_start_month comes from sacco_society_config.
CREATE OR REPLACE FUNCTION public.sacco_ensure_periods(
  p_sacco_id uuid,
  p_fiscal_year integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid := public.current_admin_id();
  v_start_month integer;
  v_start date;
  v_i integer;
  v_created integer := 0;
  v_ps date;
  v_pe date;
BEGIN
  SELECT COALESCE(fiscal_year_start_month, 1) INTO v_start_month
    FROM public.sacco_society_config WHERE admin_id = v_admin;
  v_start_month := COALESCE(v_start_month, 1);

  v_start := make_date(p_fiscal_year, v_start_month, 1);

  FOR v_i IN 0..11 LOOP
    v_ps := (v_start + (v_i || ' month')::interval)::date;
    v_pe := (v_ps + interval '1 month - 1 day')::date;

    INSERT INTO public.sacco_fiscal_periods
      (admin_id, sacco_id, fiscal_year, period_no, label, start_date, end_date, status)
    VALUES
      (v_admin, p_sacco_id, p_fiscal_year, v_i + 1,
       to_char(v_ps, 'Mon YYYY'), v_ps, v_pe, 'open')
    ON CONFLICT (admin_id, fiscal_year, period_no) DO NOTHING;

    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  RETURN v_created;
END;
$$;

-- Resolves (creating on demand) the period covering a date.
CREATE OR REPLACE FUNCTION public.sacco_period_for_date(
  p_sacco_id uuid,
  p_date date
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid := public.current_admin_id();
  v_id uuid;
  v_ps date := date_trunc('month', p_date)::date;
  v_pe date := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  v_start_month integer;
  v_fy integer;
  v_no integer;
BEGIN
  SELECT id INTO v_id
    FROM public.sacco_fiscal_periods
   WHERE admin_id = v_admin AND p_date BETWEEN start_date AND end_date
   ORDER BY start_date LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT COALESCE(fiscal_year_start_month, 1) INTO v_start_month
    FROM public.sacco_society_config WHERE admin_id = v_admin;
  v_start_month := COALESCE(v_start_month, 1);

  -- Period number within the fiscal year, and the year that fiscal year is named for.
  v_no := ((EXTRACT(MONTH FROM p_date)::int - v_start_month + 12) % 12) + 1;
  v_fy := EXTRACT(YEAR FROM p_date)::int
          - CASE WHEN EXTRACT(MONTH FROM p_date)::int < v_start_month THEN 1 ELSE 0 END;

  INSERT INTO public.sacco_fiscal_periods
    (admin_id, sacco_id, fiscal_year, period_no, label, start_date, end_date, status)
  VALUES
    (v_admin, p_sacco_id, v_fy, v_no, to_char(v_ps, 'Mon YYYY'), v_ps, v_pe, 'open')
  ON CONFLICT (admin_id, fiscal_year, period_no) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.sacco_fiscal_periods
     WHERE admin_id = v_admin AND fiscal_year = v_fy AND period_no = v_no;
  END IF;

  RETURN v_id;
END;
$$;

-- §10.4 step 6 — lock a period. Refuses if it would leave the ledger unbalanced.
CREATE OR REPLACE FUNCTION public.sacco_close_period(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_dr numeric;
  v_cr numeric;
BEGIN
  SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0)
    INTO v_dr, v_cr
    FROM public.sacco_journal_lines l
    JOIN public.sacco_journal_entries e ON e.id = l.entry_id
   WHERE e.period_id = p_period_id;

  IF round(v_dr, 2) <> round(v_cr, 2) THEN
    RAISE EXCEPTION 'Cannot close: period trial balance is out of balance (Dr %, Cr %)',
      round(v_dr, 2), round(v_cr, 2) USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.sacco_fiscal_periods
     SET status = 'closed', closed_at = now(), closed_by = auth.uid()
   WHERE id = p_period_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sacco_reopen_period(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.sacco_fiscal_periods
     SET status = 'open', closed_at = NULL, closed_by = NULL
   WHERE id = p_period_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. POSTING ENGINE (§10.2)
--    SECURITY INVOKER on purpose — RLS is what scopes every write to the tenant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_post_journal(
  p_sacco_id     uuid,
  p_entry_date   date,
  p_description  text,
  p_lines        jsonb,               -- [{account_code, debit, credit, member_id, memo, segment}]
  p_template_code text DEFAULT NULL,
  p_reference    text    DEFAULT NULL,
  p_member_id    uuid    DEFAULT NULL,
  p_source_table text    DEFAULT NULL,
  p_source_id    uuid    DEFAULT NULL,
  p_is_automated boolean DEFAULT false,
  p_batch_ref    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin  uuid := public.current_admin_id();
  v_period uuid;
  v_entry  uuid;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_line jsonb;
  v_i integer := 0;
  v_code text;
  v_name text;
  v_seg  public.sacco_segment;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry needs at least two lines';
  END IF;

  v_period := public.sacco_period_for_date(p_sacco_id, p_entry_date);
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'No accounting period covers %', p_entry_date;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_dr := v_dr + COALESCE((v_line ->> 'debit')::numeric, 0);
    v_cr := v_cr + COALESCE((v_line ->> 'credit')::numeric, 0);
  END LOOP;

  IF round(v_dr, 2) <> round(v_cr, 2) THEN
    RAISE EXCEPTION 'Entry does not balance: debits %, credits %', round(v_dr, 2), round(v_cr, 2);
  END IF;
  IF round(v_dr, 2) = 0 THEN
    RAISE EXCEPTION 'Entry amount cannot be zero';
  END IF;

  INSERT INTO public.sacco_journal_entries
    (admin_id, sacco_id, entry_no, entry_date, period_id, template_code, description,
     reference, member_id, source_table, source_id, batch_ref, status, is_automated,
     total_amount, created_by)
  VALUES
    (v_admin, p_sacco_id,
     'JE-' || lpad(nextval('public.sacco_journal_entry_seq')::text, 6, '0'),
     p_entry_date, v_period, p_template_code, p_description, p_reference, p_member_id,
     p_source_table, p_source_id, p_batch_ref, 'posted', p_is_automated,
     round(v_dr, 2), auth.uid())
  RETURNING id INTO v_entry;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    v_code := v_line ->> 'account_code';

    SELECT account_name, segment INTO v_name, v_seg
      FROM public.sacco_chart_of_accounts
     WHERE admin_id = v_admin AND account_code = v_code;

    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Account % is not in this society''s chart of accounts', v_code;
    END IF;

    INSERT INTO public.sacco_journal_lines
      (admin_id, entry_id, line_no, account_code, account_name, debit, credit, segment, member_id, memo)
    VALUES
      (v_admin, v_entry, v_i, v_code, v_name,
       round(COALESCE((v_line ->> 'debit')::numeric, 0), 2),
       round(COALESCE((v_line ->> 'credit')::numeric, 0), 2),
       COALESCE((v_line ->> 'segment')::public.sacco_segment, v_seg),
       NULLIF(v_line ->> 'member_id', '')::uuid,
       v_line ->> 'memo');
  END LOOP;

  RETURN v_entry;
END;
$$;

-- §4 design rule: corrections are reversing entries, never edits to history.
CREATE OR REPLACE FUNCTION public.sacco_reverse_journal(
  p_entry_id uuid,
  p_reason   text DEFAULT NULL,
  p_date     date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid := public.current_admin_id();
  v_src   public.sacco_journal_entries%ROWTYPE;
  v_date  date := COALESCE(p_date, CURRENT_DATE);
  v_period uuid;
  v_new   uuid;
BEGIN
  SELECT * INTO v_src FROM public.sacco_journal_entries WHERE id = p_entry_id;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF v_src.status = 'reversed' THEN RAISE EXCEPTION 'Entry is already reversed'; END IF;

  v_period := public.sacco_period_for_date(v_src.sacco_id, v_date);

  INSERT INTO public.sacco_journal_entries
    (admin_id, sacco_id, entry_no, entry_date, period_id, template_code, description,
     reference, member_id, batch_ref, status, is_automated, reversal_of, total_amount, created_by)
  VALUES
    (v_admin, v_src.sacco_id,
     'JE-' || lpad(nextval('public.sacco_journal_entry_seq')::text, 6, '0'),
     v_date, v_period, v_src.template_code,
     'REVERSAL of ' || COALESCE(v_src.entry_no, '') ||
       COALESCE(' — ' || p_reason, '') || ' | ' || COALESCE(v_src.description, ''),
     v_src.reference, v_src.member_id, v_src.batch_ref, 'reversal', v_src.is_automated,
     v_src.id, v_src.total_amount, auth.uid())
  RETURNING id INTO v_new;

  INSERT INTO public.sacco_journal_lines
    (admin_id, entry_id, line_no, account_code, account_name, debit, credit, segment, member_id, memo)
  SELECT v_admin, v_new, line_no, account_code, account_name,
         credit, debit, segment, member_id, 'reversal'
    FROM public.sacco_journal_lines WHERE entry_id = v_src.id;

  UPDATE public.sacco_journal_entries
     SET status = 'reversed', reversed_by = v_new
   WHERE id = v_src.id;

  RETURN v_new;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. TRIAL BALANCE (§10.3 — the single source of truth for every statement)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_trial_balance(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  account_code   text,
  account_name   text,
  account_class  public.sacco_account_class,
  normal_balance public.sacco_normal_balance,
  is_contra      boolean,
  segment        public.sacco_segment,
  total_debit    numeric,
  total_credit   numeric,
  balance        numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.account_code,
    a.account_name,
    a.account_class,
    a.normal_balance,
    a.is_contra,
    a.segment,
    COALESCE(SUM(l.debit),  0)::numeric  AS total_debit,
    COALESCE(SUM(l.credit), 0)::numeric  AS total_credit,
    CASE WHEN a.normal_balance = 'debit'
         THEN COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
         ELSE COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
    END::numeric AS balance
  FROM public.sacco_chart_of_accounts a
  LEFT JOIN public.sacco_journal_lines l
         ON l.account_code = a.account_code
        AND l.admin_id     = a.admin_id
  LEFT JOIN public.sacco_journal_entries e
         ON e.id = l.entry_id
        AND (p_from IS NULL OR e.entry_date >= p_from)
        AND (p_to   IS NULL OR e.entry_date <= p_to)
  WHERE a.admin_id = public.current_admin_id()
    AND (l.id IS NULL OR e.id IS NOT NULL)
  GROUP BY a.account_code, a.account_name, a.account_class,
           a.normal_balance, a.is_contra, a.segment
  ORDER BY a.account_code;
$$;

-- ----------------------------------------------------------------------------
-- 8. SEED — chart of accounts, journal templates, provisioning policy and the
--    appropriation waterfall, straight from the specification.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_fin_seed(p_sacco_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_admin uuid := public.current_admin_id();
BEGIN
  -- ── §3 / §11 Chart of Accounts ─────────────────────────────────────────────
  INSERT INTO public.sacco_chart_of_accounts
    (admin_id, sacco_id, account_code, account_name, account_class, normal_balance,
     segment, is_contra, is_system, notes)
  SELECT v_admin, p_sacco_id, x.code, x.name,
         x.klass::public.sacco_account_class,
         x.nb::public.sacco_normal_balance,
         x.seg::public.sacco_segment, x.contra, true, x.notes
  FROM (VALUES
    -- Assets 1000–1999
    ('1010','Cash in Hand – BOSA','asset','debit','bosa',false,'Till cash'),
    ('1011','Cash in Hand – FOSA','asset','debit','fosa',false,'Teller cash, if FOSA licensed'),
    ('1020','Bank – Operations Account','asset','debit','both',false,'Main transactional bank account'),
    ('1021','Bank – Mobile Money Collection (M-Pesa/Paybill)','asset','debit','both',false,'Reconciles to Paybill statement'),
    ('1030','Short-Term Investments / Fixed Deposits Held','asset','debit','both',false,'Society''s own placements'),
    ('1100','Loans to Members – Development Loans','asset','debit','bosa',false,'Principal outstanding, by product'),
    ('1101','Loans to Members – Emergency Loans','asset','debit','bosa',false,NULL),
    ('1102','Loans to Members – School Fees Loans','asset','debit','bosa',false,NULL),
    ('1103','Loans to Members – FOSA Overdraft/Salary Advance','asset','debit','fosa',false,NULL),
    ('1150','Interest Receivable on Loans (accrued)','asset','debit','bosa',false,'Accrued not yet collected'),
    ('1190','Provision for Loan Losses (contra-asset)','asset','credit','bosa',true,'Credit balance; net against 1100–1103'),
    ('1200','Other Receivables – Staff','asset','debit','both',false,NULL),
    ('1201','Other Receivables – Sundry Debtors','asset','debit','both',false,NULL),
    ('1210','Prepaid Expenses','asset','debit','both',false,'Insurance, rent paid in advance'),
    ('1300','Land and Buildings','asset','debit','both',false,'At cost'),
    ('1310','Furniture, Fittings & Equipment','asset','debit','both',false,'At cost'),
    ('1320','Computers & IT Equipment','asset','debit','both',false,'At cost'),
    ('1330','Motor Vehicles','asset','debit','both',false,'At cost'),
    ('1390','Accumulated Depreciation (contra-asset)','asset','credit','both',true,'Credit balance'),
    ('1400','Intangible Assets – Software / Core Banking System','asset','debit','both',false,'Capitalised software licences'),
    -- Liabilities 2000–2999
    ('2010','Member Savings – Regular Savings','liability','credit','bosa',false,'Withdrawable per by-laws; LIABILITY not equity'),
    ('2011','Member Deposits – Fixed/Term Deposits','liability','credit','both',false,'Locked for a term, higher rate'),
    ('2012','Member Deposits – FOSA Current/Savings Account','liability','credit','fosa',false,'Bank-like withdrawable account'),
    ('2013','Junior/Children''s Savings Accounts','liability','credit','both',false,'Often restricted-withdrawal product'),
    ('2020','Interest Payable on Deposits (accrued)','liability','credit','both',false,'Accrued interest owed to members'),
    ('2100','Borrowings – Bank Loans / Apex Facilities','liability','credit','bosa',false,'External funding lines'),
    ('2110','Borrowings – Development Partner/Grant Liability','liability','credit','both',false,'If restricted-use funds'),
    ('2200','Statutory Deductions Payable (PAYE, NSSF, SHIF)','liability','credit','both',false,'Payroll-related'),
    ('2210','Dividends Payable (declared, unpaid)','liability','credit','both',false,'After AGM declaration'),
    ('2211','Interest on Deposits Payable (declared, unpaid)','liability','credit','both',false,NULL),
    ('2300','Trade & Sundry Creditors','liability','credit','both',false,'Supplier payables'),
    ('2310','Welfare/Benevolent Fund Payable','liability','credit','chama',false,'Claims approved, not yet paid'),
    ('2320','Members'' Contribution Payable (Merry-go-round payout due)','liability','credit','chama',false,'Current cycle beneficiary payout'),
    -- Equity 3000–3999
    ('3010','Members'' Share Capital','equity','credit','both',false,'Permanent, non-withdrawable while a member'),
    ('3020','Share Capital – Application/Not Yet Allotted','equity','credit','both',false,'Suspense until formally allotted'),
    ('3100','Statutory Reserve Fund','equity','credit','both',false,'Mandatory appropriation, by-law/SASRA %'),
    ('3200','Retained Surplus / Accumulated Fund','equity','credit','both',false,'Cumulative undistributed surplus'),
    ('3300','Education Fund (Reserve)','equity','credit','both',false,'Optional appropriation'),
    ('3310','Development Fund (Reserve)','equity','credit','both',false,'Optional appropriation for capital projects'),
    ('3320','Welfare/Benevolent Reserve','equity','credit','both',false,'Welfare set-asides'),
    ('3330','Honoraria/AGM Reserve','equity','credit','both',false,'Optional, common in Chamas'),
    ('3400','Revaluation Reserve','equity','credit','both',false,'Property revaluation surplus'),
    -- Income 4000–4999
    ('4010','Interest Income – Development Loans','income','credit','bosa',false,'Accrual basis, declining balance'),
    ('4011','Interest Income – Emergency Loans','income','credit','bosa',false,NULL),
    ('4012','Interest Income – FOSA Overdraft/Advances','income','credit','fosa',false,NULL),
    ('4020','Loan Appraisal / Processing Fees','income','credit','both',false,'Upfront or amortised per policy'),
    ('4030','Membership/Registration Fees','income','credit','both',false,'One-off, recognised on receipt'),
    ('4040','Withdrawal/Penalty Fees','income','credit','both',false,NULL),
    ('4050','Commission Income','income','credit','both',false,'Bill pay, insurance agency, etc.'),
    ('4100','Investment Income – Fixed Deposit Interest Earned','income','credit','both',false,'Society''s own placements'),
    ('4110','Investment Income – Dividends Received','income','credit','both',false,NULL),
    ('4200','Other Income – Rental Income','income','credit','both',false,'If the society owns investment property'),
    ('4210','Other Income – Grants/Donations (unrestricted)','income','credit','both',false,NULL),
    ('4300','Bad Debts Recovered','income','credit','bosa',false,'Previously written-off loans recovered'),
    -- Expenses 5000–5999
    ('5010','Interest Expense – Member Savings/Deposits','expense','debit','both',false,'Accrued periodically'),
    ('5011','Interest Expense – Borrowed Funds','expense','debit','both',false,NULL),
    ('5100','Staff Salaries & Wages','expense','debit','both',false,NULL),
    ('5110','Staff Statutory Contributions (NSSF/SHIF)','expense','debit','both',false,NULL),
    ('5120','Staff Training','expense','debit','both',false,'May be charged against the Education Fund'),
    ('5200','Rent & Utilities','expense','debit','both',false,NULL),
    ('5210','Office Supplies & Printing','expense','debit','both',false,NULL),
    ('5220','Audit & Professional Fees','expense','debit','both',false,NULL),
    ('5230','SASRA Supervision Fees / Regulatory Levies','expense','debit','both',false,'Deposit-taking SACCOs only'),
    ('5240','IT/Core Banking System Costs','expense','debit','both',false,'Hosting, licences, support'),
    ('5250','Board & Committee Expenses','expense','debit','both',false,'Allowances, AGM costs'),
    ('5260','Insurance','expense','debit','both',false,'Fidelity, deposit insurance levy'),
    ('5300','Provision for Loan Losses (P&L charge)','expense','debit','bosa',false,'Movement in provision 1190'),
    ('5310','Bad Debts Written Off','expense','debit','bosa',false,'Board-approved'),
    ('5400','Depreciation – Property & Equipment','expense','debit','both',false,NULL),
    ('5410','Amortisation – Intangible Assets','expense','debit','both',false,NULL),
    ('5500','Marketing & Member Mobilisation','expense','debit','both',false,NULL),
    ('5600','Welfare Claims Paid','expense','debit','chama',false,'Fund-based societies charge 2310 instead'),
    -- Memo 9000–9999
    ('9010','Loan Guarantees (memo)','memo','debit','bosa',false,'Off-balance-sheet'),
    ('9020','Committed but Undisbursed Loans (memo)','memo','debit','bosa',false,'Off-balance-sheet')
  ) AS x(code, name, klass, nb, seg, contra, notes)
  ON CONFLICT (admin_id, account_code) DO NOTHING;

  -- ── §4 Journal templates ───────────────────────────────────────────────────
  INSERT INTO public.sacco_journal_templates
    (admin_id, sacco_id, template_code, name, category, debit_account, credit_account,
     variable_side, variable_options, trigger_hint, requires_member, is_automated, sort_order)
  SELECT v_admin, p_sacco_id, t.code, t.name, t.cat, t.dr, t.cr,
         t.vside, t.vopts, t.trig, t.needs_member, t.auto, t.ord
  FROM (VALUES
    ('MEMBER_SHARE_PURCHASE','Member registration & share capital purchase','member','1020','3010','debit',ARRAY['1010','1020','1021'],'Receipt',true,false,10),
    ('MEMBERSHIP_FEE','Membership/registration fee received','member','1020','4030','debit',ARRAY['1010','1020','1021'],'Receipt',true,false,20),
    ('SAVINGS_DEPOSIT','Savings deposit received','member','1020','2010','debit',ARRAY['1010','1020','1021'],'Receipt',true,false,30),
    ('SAVINGS_WITHDRAWAL','Savings withdrawal paid','member','2010','1020','credit',ARRAY['1010','1020','1021'],'Payment',true,false,40),
    ('LOAN_DISBURSEMENT','Loan disbursed to member','loan','1100','1020','debit',ARRAY['1100','1101','1102','1103'],'Disbursement approval',true,false,50),
    ('LOAN_PROCESSING_FEE','Loan processing fee charged','loan','1020','4020','debit',ARRAY['1010','1020','1021'],'Disbursement',true,false,60),
    ('LOAN_REPAY_PRINCIPAL','Loan repayment received – principal','loan','1020','1100','credit',ARRAY['1100','1101','1102','1103'],'Repayment per schedule',true,false,70),
    ('LOAN_REPAY_INTEREST','Loan repayment received – interest','loan','1020','4010','credit',ARRAY['4010','4011','4012'],'Repayment per schedule',true,false,80),
    ('INTEREST_ACCRUAL_LOANS','Interest accrual on performing loans','period_end','1150','4010','credit',ARRAY['4010','4011','4012'],'Month-end batch job',false,true,90),
    ('INTEREST_ACCRUAL_DEPOSITS','Interest accrual on member deposits','period_end','5010','2020',NULL,'{}','Month-end batch job',false,true,100),
    ('PROVISION_INCREASE','Loan loss provision – increase','period_end','5300','1190',NULL,'{}','Month-end, per aging policy',false,true,110),
    ('PROVISION_RELEASE','Loan loss provision – release','period_end','1190','5300',NULL,'{}','Month-end, per aging policy',false,true,120),
    ('LOAN_WRITE_OFF','Loan written off (board approved)','loan','1190','1100','credit',ARRAY['1100','1101','1102','1103'],'Board resolution',true,false,130),
    ('BAD_DEBT_RECOVERED','Bad debt recovered after write-off','loan','1020','4300','debit',ARRAY['1010','1020','1021'],'Receipt',true,false,140),
    ('FIXED_ASSET_PURCHASE','Fixed asset purchased','ops','1310','1020','debit',ARRAY['1300','1310','1320','1330','1400'],'Purchase',false,false,150),
    ('DEPRECIATION','Depreciation charge','period_end','5400','1390',NULL,'{}','Month-end batch job',false,true,160),
    ('AMORTISATION','Amortisation of intangibles','period_end','5410','1400',NULL,'{}','Month-end batch job',false,true,165),
    ('STATUTORY_RESERVE','Statutory reserve appropriation','equity','3200','3100',NULL,'{}','AGM/board resolution',false,true,170),
    ('EDUCATION_FUND','Education fund appropriation','equity','3200','3300',NULL,'{}','AGM/board resolution',false,true,180),
    ('DEVELOPMENT_FUND','Development fund appropriation','equity','3200','3310',NULL,'{}','AGM/board resolution',false,true,190),
    ('WELFARE_RESERVE','Welfare reserve appropriation','equity','3200','3320',NULL,'{}','AGM/board resolution',false,true,200),
    ('DIVIDEND_DECLARED','Dividend declared on share capital','equity','3200','2210',NULL,'{}','AGM resolution',false,true,210),
    ('DIVIDEND_PAID','Dividend paid to member','equity','2210','1020','credit',ARRAY['1010','1020','1021'],'Payment run',true,false,220),
    ('IOD_DECLARED','Interest on deposits declared','equity','3200','2211',NULL,'{}','AGM/board resolution',false,true,230),
    ('IOD_PAID','Interest on deposits paid','equity','2211','1020','credit',ARRAY['1010','1020','1021'],'Payment run',true,false,240),
    ('BORROWING_DRAWDOWN','External borrowing drawn down','ops','1020','2100','debit',ARRAY['1010','1020','1021'],'Drawdown',false,false,250),
    ('BORROWING_REPAY_PRINCIPAL','External borrowing repaid – principal','ops','2100','1020','credit',ARRAY['1010','1020','1021'],'Repayment',false,false,260),
    ('BORROWING_REPAY_INTEREST','External borrowing repaid – interest','ops','5011','1020','credit',ARRAY['1010','1020','1021'],'Repayment',false,false,270),
    ('PAYROLL_NET_PAY','Payroll run – net pay','ops','5100','1020','credit',ARRAY['1010','1020','1021'],'Payroll',false,false,280),
    ('PAYROLL_STATUTORY','Payroll run – statutory deductions','ops','5100','2200',NULL,'{}','Payroll',false,false,290),
    ('OPERATING_EXPENSE','Operating expense paid','ops','5200','1020','debit',ARRAY['5100','5110','5120','5200','5210','5220','5230','5240','5250','5260','5500'],'Payment',false,false,300),
    ('FIXED_DEPOSIT_PLACEMENT','Fixed deposit / investment placed','ops','1030','1020','credit',ARRAY['1010','1020','1021'],'Placement',false,false,310),
    ('INVESTMENT_INCOME','Investment income received','ops','1020','4100','credit',ARRAY['4100','4110'],'Receipt',false,false,320),
    ('OTHER_INCOME','Other income received','ops','1020','4200','credit',ARRAY['4200','4210','4040','4050'],'Receipt',false,false,330),
    ('MGR_CONTRIBUTION','Merry-go-round: contribution collected','chama','1020','2320','debit',ARRAY['1010','1020','1021'],'Cycle collection',true,false,340),
    ('MGR_PAYOUT','Merry-go-round: payout to beneficiary','chama','2320','1020','credit',ARRAY['1010','1020','1021'],'Cycle payout',true,false,350),
    ('WELFARE_CONTRIBUTION','Welfare contribution received','chama','1020','2310','debit',ARRAY['1010','1020','1021'],'Receipt',true,false,360),
    ('WELFARE_CLAIM_PAID','Welfare claim paid out','chama','2310','1020','credit',ARRAY['1010','1020','1021'],'Approved claim payment',true,false,370)
  ) AS t(code, name, cat, dr, cr, vside, vopts, trig, needs_member, auto, ord)
  ON CONFLICT (admin_id, template_code) DO NOTHING;

  -- ── §2.5 Provisioning policy (SASRA-style default ladder) ─────────────────
  INSERT INTO public.sacco_provision_policy
    (admin_id, sacco_id, classification, min_days, max_days, provision_pct, sort_order)
  SELECT v_admin, p_sacco_id, p.cls::public.sacco_loan_class, p.mn, p.mx, p.pct, p.ord
  FROM (VALUES
    ('performing',    0,  30,   1.0, 1),
    ('watch',        31, 180,   5.0, 2),
    ('substandard', 181, 360,  25.0, 3),
    ('doubtful',    361, 540,  50.0, 4),
    ('loss',        541, NULL,100.0, 5)
  ) AS p(cls, mn, mx, pct, ord)
  ON CONFLICT (admin_id, classification) DO NOTHING;

  -- ── §2.4 Appropriation waterfall ──────────────────────────────────────────
  INSERT INTO public.sacco_appropriation_rules
    (admin_id, sacco_id, sort_order, rule_type, name, percent, target_account, is_mandatory)
  SELECT v_admin, p_sacco_id, r.ord, r.rtype, r.name, r.pct, r.acct, r.mand
  FROM (VALUES
    (1,'statutory_reserve','Statutory Reserve Fund',20.0,'3100',true),
    (2,'education','Education Fund',            5.0,'3300',false),
    (3,'development','Development Fund',        5.0,'3310',false),
    (4,'welfare','Welfare/Benevolent Reserve',  0.0,'3320',false),
    (5,'honoraria','Honoraria/AGM Reserve',     0.0,'3330',false),
    (6,'dividend','Dividend on Share Capital',  0.0,'2210',false),
    (7,'iod','Interest on Member Deposits',     0.0,'2211',false)
  ) AS r(ord, rtype, name, pct, acct, mand)
  ON CONFLICT (admin_id, rule_type) DO NOTHING;

  -- ── Config row + seed stamp ───────────────────────────────────────────────
  INSERT INTO public.sacco_society_config (admin_id, sacco_id, coa_seeded_at)
  VALUES (v_admin, p_sacco_id, now())
  ON CONFLICT (admin_id) DO UPDATE SET coa_seeded_at = now(), updated_at = now();
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. GRANTS. These are SECURITY INVOKER functions (RLS still applies), but the
--    anon role has no business calling any of them — see the project's
--    "function grants gotcha": REVOKE FROM PUBLIC alone is not enough.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'public.sacco_ensure_periods(uuid, integer)',
    'public.sacco_period_for_date(uuid, date)',
    'public.sacco_close_period(uuid)',
    'public.sacco_reopen_period(uuid)',
    'public.sacco_post_journal(uuid, date, text, jsonb, text, text, uuid, text, uuid, boolean, text)',
    'public.sacco_reverse_journal(uuid, text, date)',
    'public.sacco_trial_balance(date, date)',
    'public.sacco_fin_seed(uuid)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon;', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated;', f);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.sacco_journal_entry_seq TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Refresh PostgREST's schema cache so the new tables/RPCs are visible.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
