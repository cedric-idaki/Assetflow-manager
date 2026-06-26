-- 20260626140000_staff_delete_audit_retention.sql
-- Guarantees that permanently deleting a staff/employee account (see the
-- delete-staff-user edge function) NEVER destroys their audit trail.
--
-- audit_logs.user_id was already declared ON DELETE SET NULL in the original
-- schema, but that is the single most important behaviour behind the
-- "an employee's audit is a must to be kept" requirement, so we re-assert it
-- here explicitly and idempotently. When the profile is removed, the cascade
-- only nulls the link on each historical row — the rows themselves survive.

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  -- Find the foreign key on audit_logs.user_id (auto-named audit_logs_user_id_fkey
  -- when created inline, but resolve it dynamically to be safe).
  SELECT con.conname
    INTO fk_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'public.audit_logs'::regclass
    AND con.contype  = 'f'
    AND att.attname  = 'user_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_logs DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL;
END $$;

COMMENT ON COLUMN public.audit_logs.user_id IS
  'Actor who performed the action. ON DELETE SET NULL: when the actor''s profile '
  'is permanently deleted, this is nulled but the audit row is retained. The '
  'deleted actor''s identity is preserved separately in the delete snapshot entry '
  '(action = delete, table_name = user_profiles) written by delete-staff-user.';
