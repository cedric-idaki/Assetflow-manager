-- ============================================================================
-- SACCO MEMBER PORTAL FIXES
-- ============================================================================
-- Members created BEFORE the tenant's saccos row existed were saved with
-- sacco_id = NULL (the dashboard's addMember passes the then-missing sacco id).
-- The member RLS policies match on sacco_id, so such a member could not even
-- see their own record ("Your membership record is not linked yet").
--
-- 1) Backfill sacco_id across all sacco_* rows from the tenant's saccos row.
-- 2) Default sacco_id on INSERT via trigger so it can never be NULL again.
-- 3) Let a member always read their own sacco_members row (user_id match),
--    independent of sacco_id state.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BACKFILL
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  sacco_tables text[] := ARRAY[
    'sacco_members','sacco_contributions','sacco_loan_products','sacco_loans',
    'sacco_shares','sacco_share_listings','sacco_share_transfers',
    'sacco_motions','sacco_documents','sacco_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY sacco_tables LOOP
    EXECUTE format(
      'UPDATE public.%1$s tgt SET sacco_id = s.id
         FROM public.saccos s
        WHERE tgt.sacco_id IS NULL AND s.admin_id = tgt.admin_id;', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. DEFAULT sacco_id ON INSERT (mirrors set_admin_id_default)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_sacco_id_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.sacco_id IS NULL THEN
    SELECT s.id INTO NEW.sacco_id
    FROM public.saccos s
    WHERE s.admin_id = COALESCE(NEW.admin_id, public.current_admin_id())
    ORDER BY s.created_at
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
  sacco_tables text[] := ARRAY[
    'sacco_members','sacco_contributions','sacco_loan_products','sacco_loans',
    'sacco_shares','sacco_share_listings','sacco_share_transfers',
    'sacco_motions','sacco_documents','sacco_invoices'
  ];
BEGIN
  FOREACH t IN ARRAY sacco_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_sacco_id_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER set_sacco_id_%1$s BEFORE INSERT ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_sacco_id_default();', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. A member can ALWAYS read their own row, even if sacco_id is unset.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "member_read_members" ON public.sacco_members;
CREATE POLICY "member_read_members" ON public.sacco_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR sacco_id = public.current_member_sacco_id()
  );
