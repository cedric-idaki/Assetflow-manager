-- ═══════════════════════════════════════════════════════════════════════════════
-- Client portal: browse the company's market assets + open own documents
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1. Browse Assets was always empty for a logged-in client. The only
--    client-facing SELECT policy on assets is clients_read_own_assets
--    (linked_client_id = self), so every "available" asset the company put on
--    the market was filtered out by RLS before the portal ever saw it. Add a
--    policy that lets a client read the AVAILABLE assets of their own company
--    (tenant resolved through the registrant's user_profiles row, the same way
--    assets_tenant_manage does for staff).
--
-- 2. The storage lockdown (20260731091000) scoped contracts / esign-documents
--    reads with storage_path_is_own_tenant(), which resolves the tenant via
--    current_admin_id(). A client login's user_profiles row has no admin_id, so
--    that resolves to the client's own auth id — never the company folder — and
--    every View/Download in the client portal's Document Centre failed to sign.
--    Add a client branch that allows reading exactly the objects referenced by
--    the client's own generated_contracts / company_contracts rows.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1a. Helper: the company (tenant admin id) the calling client belongs to ────
-- SECURITY DEFINER so the lookup is not filtered by RLS on clients. Resolves by
-- the hard auth link first, then by a non-empty case-insensitive email match
-- (same semantics as get_my_client_profile / clients_self_read).
create or replace function public.get_client_admin_id_for_user()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.admin_id
  from public.clients c
  where c.client_auth_id = auth.uid()
     or (
       nullif(trim(coalesce(c.email, '')), '') is not null
       and nullif(trim(coalesce(auth.email(), '')), '') is not null
       and lower(trim(c.email)) = lower(trim(auth.email()))
     )
  order by (c.client_auth_id = auth.uid()) desc nulls last, c.created_at
  limit 1;
$$;

revoke all on function public.get_client_admin_id_for_user() from public;
revoke all on function public.get_client_admin_id_for_user() from anon;
revoke all on function public.get_client_admin_id_for_user() from authenticated;
grant execute on function public.get_client_admin_id_for_user() to authenticated;

-- ── 1b. Helper: does this asset belong to the calling client's company? ────────
-- An asset's tenant is its registrant's admin (COALESCE(admin_id, id) on
-- user_profiles) — assets carry no tenant column of their own on this project.
create or replace function public.client_can_browse_asset(p_registered_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_registered_by is null then false
    else coalesce(
      (select coalesce(up.admin_id, up.id)
         from public.user_profiles up
        where up.id = p_registered_by)
      = public.get_client_admin_id_for_user(),
      false)
  end;
$$;

revoke all on function public.client_can_browse_asset(uuid) from public;
revoke all on function public.client_can_browse_asset(uuid) from anon;
revoke all on function public.client_can_browse_asset(uuid) from authenticated;
grant execute on function public.client_can_browse_asset(uuid) to authenticated;

-- ── 1c. Policies on assets ─────────────────────────────────────────────────────
-- Market visibility: only assets currently on the market ('available').
drop policy if exists "clients_browse_company_market_assets" on public.assets;
create policy "clients_browse_company_market_assets"
on public.assets for select
to authenticated
using (
  asset_status = 'available'
  and public.client_can_browse_asset(registered_by)
);

-- Re-assert the self-read policy the portal's My Assets tab depends on, so this
-- migration leaves a known-good state regardless of which historical variant of
-- it the live DB carries.
drop policy if exists "clients_read_own_assets" on public.assets;
create policy "clients_read_own_assets"
on public.assets for select
to authenticated
using (linked_client_id = public.get_client_id_for_user());

-- ── 2a. Helper: object is referenced by one of the calling client's contracts ──
-- Exact path comparison against the stored file_url (legacy public URL, signed
-- URL, or bare path), so a client can sign only the objects their own contract
-- rows point at — not everything under the company folder.
create or replace function public.client_can_read_contract_object(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (select public.get_client_id_for_user() as cid)
  select exists (
    select 1
    from public.generated_contracts gc, me
    where me.cid is not null
      and gc.client_id = me.cid
      and (
        gc.file_url = p_name
        or split_part(split_part(gc.file_url, '/' || p_bucket || '/', 2), '?', 1) = p_name
      )
  )
  or exists (
    select 1
    from public.company_contracts cc, me
    where me.cid is not null
      and cc.client_id = me.cid
      and (
        cc.file_url = p_name
        or split_part(split_part(cc.file_url, '/' || p_bucket || '/', 2), '?', 1) = p_name
      )
  );
$$;

revoke all on function public.client_can_read_contract_object(text, text) from public;
revoke all on function public.client_can_read_contract_object(text, text) from anon;
revoke all on function public.client_can_read_contract_object(text, text) from authenticated;
grant execute on function public.client_can_read_contract_object(text, text) to authenticated;

-- ── 2b. Extend the read policies on the two contract buckets ───────────────────
drop policy if exists "contracts_tenant_read" on storage.objects;
create policy "contracts_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'contracts'
  and (
    public.storage_path_is_own_tenant(name)
    or public.client_can_read_contract_object('contracts', name)
    or public.is_global_viewer()
  )
);

drop policy if exists "esign_docs_tenant_read" on storage.objects;
create policy "esign_docs_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'esign-documents'
  and (
    public.storage_path_is_own_tenant(name)
    or public.client_can_read_contract_object('esign-documents', name)
    or public.is_global_viewer()
  )
);

-- ── 3. Safety net: stamp admin_id on new clients when the app omits it ─────────
-- The set_admin_id_clients trigger from the tenant-isolation design was never
-- applied to this database. A client row with a NULL admin_id has no company,
-- so the market policy above (and the admin's own client list) would miss it.
-- set_admin_id_default() only fills NULL, so callers that set admin_id
-- explicitly are unaffected.
drop trigger if exists set_admin_id_clients on public.clients;
create trigger set_admin_id_clients before insert on public.clients
  for each row execute function public.set_admin_id_default();

-- ── 4. Refresh PostgREST schema cache ──────────────────────────────────────────
notify pgrst, 'reload schema';
