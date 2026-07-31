-- ═══════════════════════════════════════════════════════════════════════════════
-- Storage lockdown: private buckets + tenant-scoped object policies
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Four buckets holding the platform's most sensitive documents were created with
-- `public = true` AND granted `for select to public` on storage.objects:
--
--     kyc-documents       national ID / passport scans
--     contracts           signed contracts, including sealed signed_*.pdf
--     esign-documents     e-signature sources and sealed copies
--     employee-documents  HR files
--
-- `to public` includes the anon role, so anyone holding the anon key — which
-- ships inside the frontend bundle by design — could list every object in those
-- buckets and download each one over its public URL. No login, no tenant check.
--
-- Separately, the *_authenticated_insert/update policies checked only bucket_id:
-- no path check, no tenant check, no role check. Any authenticated account,
-- including a `client`-role user, could overwrite another tenant's files. The
-- 2026-07-27 hardening blocked DELETE of signed_* objects but left UPDATE open,
-- so a sealed contract could still be replaced with a forged PDF.
--
-- This migration makes all four buckets private and scopes every operation to
-- the owning tenant by the object's first path segment:
--
--     contracts, esign-documents   <admin_id>/...
--     kyc-documents                <clients.id>/...
--     employee-documents           <user_profiles.id>/...
--
-- Reads now require a signed URL minted by an authorised session (or by the
-- service role, which is how the unauthenticated external-signer flow in
-- esign-public serves documents to a signer who has no account).
--
-- NOT covered here: client-photos and asset-images remain public. Their objects
-- are stored on flat paths with no tenant segment, so they cannot be scoped
-- without re-pathing existing files, and they are embedded as plain <img src>
-- across ~27 render sites. Lower sensitivity (headshots, asset photos) but still
-- personal data — tracked as follow-up work, not closed by this migration.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Ownership helpers ──────────────────────────────────────────────────────
-- SECURITY DEFINER so the lookup is not itself filtered by RLS on clients /
-- user_profiles — a storage policy subquery runs as the querying user, and an
-- RLS-filtered probe would produce false negatives and lock people out of their
-- own files. Comparison is text-on-text so a non-uuid path segment simply fails
-- to match instead of raising.

create or replace function public.can_access_client_file(p_client_segment text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clients c
    where c.id::text = p_client_segment
      and (
        (c.admin_id = public.current_admin_id() and public.is_staff_member())
        or c.client_auth_id = auth.uid()
        -- Email match requires a real address on both sides. Without the
        -- nullif guard a client row with an empty email would match any caller
        -- whose auth.email() is also empty, across tenants.
        or (
          nullif(trim(coalesce(c.email, '')), '') is not null
          and lower(trim(c.email)) = lower(trim(coalesce(auth.email(), '')))
          and nullif(trim(coalesce(auth.email(), '')), '') is not null
        )
      )
  );
$$;

-- Revoking from PUBLIC alone leaves anon/authenticated holding EXECUTE through
-- default privileges, so revoke those explicitly before granting back only the
-- role that needs it.
revoke all on function public.can_access_client_file(text) from public;
revoke all on function public.can_access_client_file(text) from anon;
revoke all on function public.can_access_client_file(text) from authenticated;
grant execute on function public.can_access_client_file(text) to authenticated;

create or replace function public.can_access_employee_file(p_employee_segment text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.id::text = p_employee_segment
      and (
        (up.admin_id = public.current_admin_id() and public.is_staff_member())
        or up.id = auth.uid()
      )
  );
$$;

revoke all on function public.can_access_employee_file(text) from public;
revoke all on function public.can_access_employee_file(text) from anon;
revoke all on function public.can_access_employee_file(text) from authenticated;
grant execute on function public.can_access_employee_file(text) to authenticated;

-- Tenant match on the leading path segment, for the admin_id-keyed buckets.
create or replace function public.storage_path_is_own_tenant(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (storage.foldername(p_name))[1] = public.current_admin_id()::text;
$$;

revoke all on function public.storage_path_is_own_tenant(text) from public;
revoke all on function public.storage_path_is_own_tenant(text) from anon;
revoke all on function public.storage_path_is_own_tenant(text) from authenticated;
grant execute on function public.storage_path_is_own_tenant(text) to authenticated;

-- ── 2. Close the buckets ──────────────────────────────────────────────────────
-- A public bucket serves objects over an unauthenticated URL without consulting
-- storage.objects policies at all, so this flag is what actually shuts the door.
update storage.buckets
   set public = false
 where id in ('kyc-documents', 'contracts', 'esign-documents', 'employee-documents');

-- ── 3. contracts ──────────────────────────────────────────────────────────────
drop policy if exists "contracts_public_read"          on storage.objects;
drop policy if exists "contracts_authenticated_read"   on storage.objects;
drop policy if exists "contracts_authenticated_insert" on storage.objects;
drop policy if exists "contracts_authenticated_update" on storage.objects;
drop policy if exists "contracts_authenticated_delete" on storage.objects;
drop policy if exists "contracts_tenant_read"   on storage.objects;
drop policy if exists "contracts_tenant_insert" on storage.objects;
drop policy if exists "contracts_tenant_update" on storage.objects;
drop policy if exists "contracts_tenant_delete" on storage.objects;

create policy "contracts_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'contracts'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "contracts_tenant_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'contracts'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "contracts_tenant_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'contracts'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
)
with check (
  bucket_id = 'contracts'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- Sealed copies stay undeletable by app users (carried over from the 2026-07-27
-- hardening); re-sealing happens through the service role.
create policy "contracts_tenant_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'contracts'
  and public.is_staff_member()
  and name not like '%signed\_%' escape '\'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- ── 4. esign-documents ────────────────────────────────────────────────────────
drop policy if exists "esign_docs_public_read"          on storage.objects;
drop policy if exists "esign_docs_authenticated_read"   on storage.objects;
drop policy if exists "esign_docs_authenticated_insert" on storage.objects;
drop policy if exists "esign_docs_authenticated_update" on storage.objects;
drop policy if exists "esign_docs_authenticated_delete" on storage.objects;
drop policy if exists "esign_docs_tenant_read"   on storage.objects;
drop policy if exists "esign_docs_tenant_insert" on storage.objects;
drop policy if exists "esign_docs_tenant_update" on storage.objects;
drop policy if exists "esign_docs_tenant_delete" on storage.objects;

create policy "esign_docs_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'esign-documents'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "esign_docs_tenant_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'esign-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "esign_docs_tenant_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'esign-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
)
with check (
  bucket_id = 'esign-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "esign_docs_tenant_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'esign-documents'
  and public.is_staff_member()
  and name not like '%signed\_%' escape '\'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- ── 5. kyc-documents ──────────────────────────────────────────────────────────
-- Path segment is the client id, so ownership resolves through public.clients:
-- the client themselves, or staff of the tenant that owns the client.
drop policy if exists "kyc_public_read"          on storage.objects;
drop policy if exists "kyc_authenticated_read"   on storage.objects;
drop policy if exists "kyc_authenticated_insert" on storage.objects;
drop policy if exists "kyc_authenticated_update" on storage.objects;
drop policy if exists "kyc_authenticated_delete" on storage.objects;
drop policy if exists "kyc_scoped_read"   on storage.objects;
drop policy if exists "kyc_scoped_insert" on storage.objects;
drop policy if exists "kyc_scoped_update" on storage.objects;
drop policy if exists "kyc_scoped_delete" on storage.objects;

create policy "kyc_scoped_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'kyc-documents'
  and (public.can_access_client_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "kyc_scoped_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kyc-documents'
  and (public.can_access_client_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "kyc_scoped_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'kyc-documents'
  and (public.can_access_client_file((storage.foldername(name))[1]) or public.is_global_viewer())
)
with check (
  bucket_id = 'kyc-documents'
  and (public.can_access_client_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "kyc_scoped_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'kyc-documents'
  and public.is_staff_member()
  and (public.can_access_client_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

-- ── 6. employee-documents ─────────────────────────────────────────────────────
-- HR records live under the employee's user_profiles id.
drop policy if exists "employee_docs_public_read"          on storage.objects;
drop policy if exists "employee_docs_authenticated_read"   on storage.objects;
drop policy if exists "employee_docs_authenticated_insert" on storage.objects;
drop policy if exists "employee_docs_authenticated_update" on storage.objects;
drop policy if exists "employee_docs_authenticated_delete" on storage.objects;
drop policy if exists "employee_docs_scoped_read"   on storage.objects;
drop policy if exists "employee_docs_scoped_insert" on storage.objects;
drop policy if exists "employee_docs_scoped_update" on storage.objects;
drop policy if exists "employee_docs_scoped_delete" on storage.objects;

create policy "employee_docs_scoped_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and (public.can_access_employee_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "employee_docs_scoped_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-documents'
  and (public.can_access_employee_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "employee_docs_scoped_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'employee-documents'
  and (public.can_access_employee_file((storage.foldername(name))[1]) or public.is_global_viewer())
)
with check (
  bucket_id = 'employee-documents'
  and (public.can_access_employee_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

create policy "employee_docs_scoped_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-documents'
  and public.is_staff_member()
  and (public.can_access_employee_file((storage.foldername(name))[1]) or public.is_global_viewer())
);

-- ── 7. Refresh PostgREST schema cache ─────────────────────────────────────────
notify pgrst, 'reload schema';
