-- ============================================================================
-- SACCO TENANT ROW DEDUPE
-- ============================================================================
-- Root cause (found 2026-07-31): handle_new_user creates the user_profiles row
-- at signup with is_active defaulting to TRUE, so ensure_sacco_admin_tenant_row
-- (20260717130000) fires immediately and creates the "<full name> Sacco" stub
-- BEFORE the registration flow's own saccos insert lands seconds later. The
-- tenant ends up with two saccos rows, and every earliest-wins consumer
-- (fetchSacco, set_sacco_id_default, the sacco_id backfills) picks the stub —
-- the dashboard header greets the admin with their own name instead of the
-- sacco's, while the real row (name, registration no) dangles unused.
--
-- 1) Merge: fold each admin's newest row (the real registration insert) into
--    the earliest row (the one everything references), then drop the extras.
-- 2) Enforce one saccos row per admin with a unique index.
-- 3) Teach ensure_sacco_admin_tenant_row to yield on conflict; the client
--    registration flow and create-staff-user now UPSERT on admin_id, so the
--    real details land on the stub instead of beside it.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MERGE EXISTING DUPLICATES (earliest row is canonical; newest row carries
--    the registration truth — the stub always precedes the real insert)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  dup      RECORD;
  keep_id  uuid;
  donor_id uuid;
  t        text;
  has_refs boolean;
BEGIN
  FOR dup IN
    SELECT admin_id FROM public.saccos
    WHERE admin_id IS NOT NULL
    GROUP BY admin_id HAVING count(*) > 1
  LOOP
    SELECT id INTO keep_id  FROM public.saccos WHERE admin_id = dup.admin_id ORDER BY created_at ASC  LIMIT 1;
    SELECT id INTO donor_id FROM public.saccos WHERE admin_id = dup.admin_id ORDER BY created_at DESC LIMIT 1;

    UPDATE public.saccos keep SET
      name             = donor.name,
      registration_no  = COALESCE(donor.registration_no,  keep.registration_no),
      sasra_licence_no = COALESCE(donor.sasra_licence_no, keep.sasra_licence_no),
      business_type    = COALESCE(donor.business_type,    keep.business_type),
      email            = COALESCE(donor.email,            keep.email),
      phone            = COALESCE(donor.phone,            keep.phone),
      location         = COALESCE(donor.location,         keep.location),
      city             = COALESCE(donor.city,             keep.city),
      tier             = COALESCE(donor.tier,             keep.tier),
      member_cap       = COALESCE(donor.member_cap,       keep.member_cap),
      updated_at       = now()
    FROM public.saccos donor
    WHERE keep.id = keep_id AND donor.id = donor_id;

    -- Repoint anything referencing a doomed duplicate (normally nothing — the
    -- duplicates dangle — but heal any strays). Exception guard mirrors
    -- 20260717130000: append-only tables raise on UPDATE even for zero rows.
    FOR t IN
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
       AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'sacco_id'
        AND c.table_name <> 'saccos'
    LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I r WHERE r.sacco_id IN
           (SELECT s.id FROM public.saccos s WHERE s.admin_id = $1 AND s.id <> $2))', t)
        INTO has_refs USING dup.admin_id, keep_id;
      IF has_refs THEN
        BEGIN
          EXECUTE format(
            'UPDATE public.%I r SET sacco_id = $2 WHERE r.sacco_id IN
               (SELECT s.id FROM public.saccos s WHERE s.admin_id = $1 AND s.id <> $2)', t)
            USING dup.admin_id, keep_id;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'sacco dedupe: skipped repoint on % (%)', t, SQLERRM;
        END;
      END IF;
    END LOOP;

    DELETE FROM public.saccos WHERE admin_id = dup.admin_id AND id <> keep_id;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. ONE SACCOS ROW PER ADMIN (NULL admin_id rows stay unconstrained)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_saccos_admin_id ON public.saccos(admin_id);

-- ----------------------------------------------------------------------------
-- 3. STUB TRIGGER YIELDS TO A CONCURRENT REAL INSERT
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
    )
    ON CONFLICT (admin_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
