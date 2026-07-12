-- Live storage-usage metering (BRS §7.5).
--
-- tenant_storage_bytes() sums the size of every file in storage.objects that
-- was uploaded by anyone belonging to the caller's tenant (the admin plus all
-- profiles whose admin_id points at them). SECURITY DEFINER because the
-- storage schema is not readable by app users directly. Used by the My Profile
-- storage gauge; the profile also writes the result back to
-- saccos.storage_used_gb so the sacco dashboard gauge and monthly-bill excess
-- calculation stay in sync.

CREATE OR REPLACE FUNCTION public.tenant_storage_bytes()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  WITH tenant_users AS (
    SELECT public.current_admin_id() AS id
    UNION
    SELECT up.id FROM public.user_profiles up
    WHERE up.admin_id = public.current_admin_id()
  )
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
  FROM storage.objects o
  WHERE o.owner IN (SELECT id FROM tenant_users)
     OR o.owner_id IN (SELECT id::text FROM tenant_users);
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_storage_bytes() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tenant_storage_bytes() TO authenticated;
