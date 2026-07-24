-- ============================================================================
-- SACCO TENANT ROW HEALING
-- ============================================================================
-- Root cause (found 2026-07-17): the self-registration flow's saccos INSERT is
-- fire-and-forget client-side, so when it fails (e.g. the signup has no active
-- session yet) a sacco_admin ends up with NO saccos row at all. Every row that
-- tenant creates afterwards gets sacco_id = NULL (set_sacco_id_default finds
-- no sacco), and the member-portal policies match on sacco_id — so members see
-- no loan products, contribution types, or sacco header.
--
-- 1) Heal-on-arrival trigger: whenever a saccos row is inserted, adopt the
--    tenant's orphaned (sacco_id IS NULL) rows across every sacco_* table.
-- 2) Ensure-tenant trigger: whenever a sacco_admin profile is inserted or
--    activated without a saccos row, create a stub one (renameable later).
-- 3) Backfill now: stub saccos for existing orphaned sacco_admins + adopt all
--    NULL sacco_id rows (dynamic table list — covers elections, contribution
--    types and anything added since the 20260708140000 hardcoded backfill).
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HEAL ORPHANED ROWS WHEN A SACCOS ROW APPEARS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_heal_null_sacco_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t text;
  has_orphans boolean;
BEGIN
  IF NEW.admin_id IS NULL THEN RETURN NEW; END IF;
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'sacco_id'
      AND c.table_name LIKE 'sacco\_%'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = c.table_name
          AND c2.column_name = 'admin_id')
  LOOP
    -- Precheck so append-only tables (e.g. sacco_election_audit, whose
    -- UPDATE-blocking trigger raises even for zero-row statements) are left
    -- alone unless they actually hold orphans; the exception guard keeps one
    -- immutable table from aborting the whole heal (and the saccos insert).
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE sacco_id IS NULL AND admin_id = $1)', t)
      INTO has_orphans USING NEW.admin_id;
    IF has_orphans THEN
      BEGIN
        EXECUTE format(
          'UPDATE public.%I SET sacco_id = $1 WHERE sacco_id IS NULL AND admin_id = $2', t)
          USING NEW.id, NEW.admin_id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'sacco_heal_null_sacco_ids: skipped % (%)', t, SQLERRM;
      END;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sacco_heal_null_sacco_ids ON public.saccos;
CREATE TRIGGER sacco_heal_null_sacco_ids
  AFTER INSERT ON public.saccos
  FOR EACH ROW EXECUTE FUNCTION public.sacco_heal_null_sacco_ids();

-- ----------------------------------------------------------------------------
-- 2. EVERY sacco_admin PROFILE GETS A TENANT ROW
--    Fires on insert/activation; skips when a saccos row already exists, so
--    the registration flow's own insert (which carries the real name and
--    registration number) still wins when it runs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_sacco_admin_tenant_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role = 'sacco_admin'
     AND COALESCE(NEW.is_active, false)
     AND NOT EXISTS (SELECT 1 FROM public.saccos s WHERE s.admin_id = NEW.id) THEN
    INSERT INTO public.saccos (admin_id, name, email, phone, kyc_status)
    VALUES (
      NEW.id,
      COALESCE(NULLIF(trim(NEW.full_name), ''), split_part(NEW.email, '@', 1)) || ' Sacco',
      NEW.email, NEW.phone, 'pending'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_sacco_admin_tenant_row ON public.user_profiles;
CREATE TRIGGER ensure_sacco_admin_tenant_row
  AFTER INSERT OR UPDATE OF role, is_active ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sacco_admin_tenant_row();

-- ----------------------------------------------------------------------------
-- 3. BACKFILL NOW
-- ----------------------------------------------------------------------------
-- Stub saccos for existing orphaned sacco_admins (active or not — a
-- sacco_admin without a tenant row is broken either way). The insert fires
-- the heal trigger above, which adopts their NULL sacco_id rows.
INSERT INTO public.saccos (admin_id, name, email, phone, kyc_status)
SELECT p.id,
       COALESCE(NULLIF(trim(p.full_name), ''), split_part(p.email, '@', 1)) || ' Sacco',
       p.email, p.phone, 'pending'
FROM public.user_profiles p
WHERE p.role = 'sacco_admin'
  AND NOT EXISTS (SELECT 1 FROM public.saccos s WHERE s.admin_id = p.id);

-- Adopt NULL sacco_id rows for tenants whose saccos row already existed
-- (earliest sacco wins, matching the dashboard's fetchSacco).
DO $$
DECLARE
  t text;
  has_orphans boolean;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'sacco_id'
      AND c.table_name LIKE 'sacco\_%'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c2
        WHERE c2.table_schema = 'public' AND c2.table_name = c.table_name
          AND c2.column_name = 'admin_id')
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I WHERE sacco_id IS NULL)', t)
      INTO has_orphans;
    IF has_orphans THEN
      BEGIN
        EXECUTE format(
          'UPDATE public.%1$I tgt SET sacco_id = s.id
             FROM (SELECT DISTINCT ON (admin_id) admin_id, id
                     FROM public.saccos ORDER BY admin_id, created_at) s
            WHERE tgt.sacco_id IS NULL AND s.admin_id = tgt.admin_id;', t);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'sacco_id backfill: skipped % (%)', t, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;
