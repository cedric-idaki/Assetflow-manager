-- ============================================================================
-- TENANT BRANDING — LOGO, MOTTO AND CONTACT DETAILS ON EVERY DOCUMENT
-- ============================================================================
-- WHAT WAS THERE
-- --------------
-- Every receipt, invoice, voucher, payslip and statement the app produces heads
-- itself with a company name read off `company_profiles` (or `saccos`), and
-- nothing else a business would call its identity: no logo, no motto, no
-- website, no postal address. `company_profiles.logo_url` exists live but no
-- screen writes it (0 of 11 rows set) and no document reads it.
--
-- Worse, the name itself is missing from most documents in practice. The live
-- policy on company_profiles is
--
--     scoped_company_profiles_access:  admin_id = auth.uid()  OR  super_admin
--
-- so only the tenant OWNER can read the row. A cashier printing a till receipt,
-- an accountant downloading a voucher, a client downloading their own payment
-- receipt: each of them reads nothing, and every generator falls back to its
-- default — so the customer's receipt says "Ararat", the platform, instead of
-- the business that sold to them.
--
-- WHAT THIS ADDS
-- --------------
--   tenant_branding          One row per tenant (company OR sacco — both are
--                            keyed by admin_id): the logo, motto and contact
--                            details the business wants on its paperwork.
--   tenant-branding bucket   PUBLIC, because a logo is printed on documents
--                            handed to the public and has to load in an email
--                            client that has no session. Nothing else is ever
--                            stored here. Writes are the tenant admin's only.
--   get_tenant_letterhead()  The whole letterhead in one call — branding over
--                            the registration record — readable by EVERYONE in
--                            the tenant (staff, clients, sacco members), which
--                            is what finally lets their documents carry it.
--                            It returns only what is printed on a document.
--   save_tenant_branding()   The one write path. Tenant admins only; validates;
--                            writes the audit trail itself.
--
-- WHY A NEW TABLE AND NOT MORE COLUMNS ON company_profiles
-- --------------------------------------------------------
--   * A tenant is a company OR a sacco, in two different tables. One branding
--     row keyed by admin_id serves both, and one set of rules polices it.
--   * company_profiles is created by a migration this repo does not hold, so
--     its policies cannot be read or reasoned about here — and an UPDATE that
--     RLS declines matches zero rows and returns NO ERROR (see
--     20260830220000). The save goes through an RPC that raises instead.
--   * The legal identity (name, registration number) stays where registration
--     and KYC put it. Branding cannot rename a business.
--
-- Idempotent — safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE BRANDING ROW
--
--    Every text column is optional. Blank means "use what registration
--    captured" — get_tenant_letterhead() falls back per field — so a tenant
--    who only uploads a logo still gets their phone and email printed.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_branding (
  admin_id          uuid primary key,

  -- Object path in the tenant-branding bucket: "<admin_id>/<file>". The URL
  -- is derived from it on the client, so moving the project to another host
  -- does not strand a stored URL.
  logo_path         text,
  motto             text,

  phone             text,
  email             text,
  website           text,
  physical_address  text,
  postal_address    text,

  -- The seller PIN a tax receipt has to carry. Every document template already
  -- has a slot for it (`co.kra_pin`) that nothing ever filled.
  kra_pin           text,

  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tenant_branding_motto_len    check (motto            is null or char_length(motto)            <= 120),
  constraint tenant_branding_phone_len    check (phone            is null or char_length(phone)            <= 40),
  constraint tenant_branding_email_len    check (email            is null or char_length(email)            <= 120),
  constraint tenant_branding_website_len  check (website          is null or char_length(website)          <= 120),
  constraint tenant_branding_physical_len check (physical_address is null or char_length(physical_address) <= 160),
  constraint tenant_branding_postal_len   check (postal_address   is null or char_length(postal_address)   <= 80),
  constraint tenant_branding_kra_pin_chk  check (kra_pin is null or kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  -- A logo lives in its own tenant's folder and nowhere else. This is what
  -- stops a row from pointing at another business's logo.
  constraint tenant_branding_logo_path_chk check (
    logo_path is null
    or logo_path ~ ('^' || admin_id::text || '/[A-Za-z0-9_-]{1,80}\.(png|jpg|jpeg)$')
  )
);

comment on table public.tenant_branding is
  'Per-tenant document branding (logo, motto, contact details). Written only through save_tenant_branding(); read through get_tenant_letterhead().';

alter table public.tenant_branding enable row level security;

-- Reads for the tenant's own people and the platform operator. Nobody writes
-- directly: the grants below take INSERT/UPDATE/DELETE away entirely, so the
-- RPC is the only door and its validation cannot be skipped.
drop policy if exists tenant_branding_read on public.tenant_branding;
create policy tenant_branding_read on public.tenant_branding
  for select to authenticated
  using (admin_id = public.current_admin_id() or public.is_global_viewer());

revoke all on public.tenant_branding from anon;
revoke insert, update, delete, truncate on public.tenant_branding from authenticated;
grant select on public.tenant_branding to authenticated;

-- ---------------------------------------------------------------------------
-- 2. WHO MAY CHANGE IT
--
--    The tenant's administrators: `admin` for a company, `sacco_admin` for a
--    society — the two roles System Administration opens for. The tenant is
--    always current_admin_id(), never a parameter, so no caller can brand
--    somebody else's documents.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_tenant_branding()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
     where up.id = auth.uid()
       and up.role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
  );
$$;

revoke all on function public.can_manage_tenant_branding() from public;
revoke all on function public.can_manage_tenant_branding() from anon;
revoke all on function public.can_manage_tenant_branding() from authenticated;
grant execute on function public.can_manage_tenant_branding() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE LOGO BUCKET
--
--    Public read: the logo goes out on every receipt, and an emailed or
--    printed document cannot carry a session to sign a URL with. The public
--    URL bypasses storage policies entirely, so what those policies govern is
--    the API — listing, uploading, replacing, deleting — and all of it is
--    confined to "<own admin_id>/..." and to the tenant's administrators.
--
--    1 MB and PNG/JPEG only. The settings screen resizes every upload to at
--    most 512px PNG before sending it, and PNG/JPEG are the two formats every
--    renderer here (jsPDF included) can embed.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-branding', 'tenant-branding', true, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tenant_branding_objects_read"   on storage.objects;
drop policy if exists "tenant_branding_objects_insert" on storage.objects;
drop policy if exists "tenant_branding_objects_update" on storage.objects;
drop policy if exists "tenant_branding_objects_delete" on storage.objects;

create policy "tenant_branding_objects_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'tenant-branding'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "tenant_branding_objects_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'tenant-branding'
  and public.storage_path_is_own_tenant(name)
  and public.can_manage_tenant_branding()
);

create policy "tenant_branding_objects_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'tenant-branding'
  and public.storage_path_is_own_tenant(name)
  and public.can_manage_tenant_branding()
)
with check (
  bucket_id = 'tenant-branding'
  and public.storage_path_is_own_tenant(name)
  and public.can_manage_tenant_branding()
);

create policy "tenant_branding_objects_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'tenant-branding'
  and public.storage_path_is_own_tenant(name)
  and public.can_manage_tenant_branding()
);

-- ---------------------------------------------------------------------------
-- 4. THE LETTERHEAD
--
--    Resolves WHICH tenant, checks the caller belongs to it, and returns the
--    printed identity: branding where the tenant set it, the registration
--    record where they did not. `defaults` carries the registration values on
--    their own so the settings screen can say what prints when a field is left
--    blank.
--
--    Tenant resolution:
--      p_admin_id given   that tenant — the caller must belong to it, or be the
--                         platform operator (a super admin downloading a
--                         tenant's invoice gets THAT tenant's letterhead).
--      p_admin_id null    the caller's own tenant. For a sacco member that is
--                         their society; for everyone else current_admin_id().
--
--    Returns NULL for an account that is not a tenant at all (the platform
--    operator's own login), so callers simply print without a letterhead.
-- ---------------------------------------------------------------------------
-- "Westlands, Nairobi" from a location and a city — without printing the
-- city twice when registration already typed it into the location, which is
-- how most rows were filled in ("Westlands,Nairobi" + "Nairobi").
create or replace function public.letterhead_address(p_location text, p_city text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(case
    when nullif(btrim(p_city), '') is null then btrim(coalesce(p_location, ''))
    when nullif(btrim(p_location), '') is null then btrim(p_city)
    when position(lower(btrim(p_city)) in lower(p_location)) > 0 then btrim(p_location)
    else btrim(p_location) || ', ' || btrim(p_city)
  end, '');
$$;

revoke all on function public.letterhead_address(text, text) from public;
revoke all on function public.letterhead_address(text, text) from anon;
grant execute on function public.letterhead_address(text, text) to authenticated;

create or replace function public.get_tenant_letterhead(p_admin_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self     uuid := public.current_admin_id();
  v_member   uuid;
  v_target   uuid;
  v_kind     text;
  v_name     text;
  v_reg      text;
  v_phone    text;
  v_email    text;
  v_address  text;
  v_pin      text;
  b          public.tenant_branding%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- A member's society. user_profiles.admin_id already points every member at
  -- it today; this covers a member whose profile predates that.
  select s.admin_id into v_member
    from public.saccos s
   where s.id = public.current_member_sacco_id();

  v_target := coalesce(p_admin_id, v_member, v_self);

  if v_target is distinct from v_self
     and v_target is distinct from v_member
     and not public.is_global_viewer() then
    raise exception 'not permitted to read another business''s letterhead'
      using errcode = '42501';
  end if;

  -- ── The registration record: a company first, then a society ─────────────
  -- company_profiles is guarded by to_regclass for the same reason as in
  -- 20260830220000: it is created outside this repo's migration history.
  if to_regclass('public.company_profiles') is not null then
    execute
      'select cp.company_name::text,
              cp.business_registration_number::text,
              cp.phone::text,
              cp.email::text,
              public.letterhead_address(cp.location::text, cp.city::text)
         from public.company_profiles cp
        where cp.admin_id = $1
        limit 1'
      into v_name, v_reg, v_phone, v_email, v_address
      using v_target;
    if v_name is not null then
      v_kind := 'company';
    end if;
  end if;

  if v_kind is null then
    select s.name,
           coalesce(nullif(btrim(s.registration_no), ''), nullif(btrim(s.sasra_licence_no), '')),
           s.phone,
           s.email,
           public.letterhead_address(s.location, s.city)
      into v_name, v_reg, v_phone, v_email, v_address
      from public.saccos s
     where s.admin_id = v_target
     order by s.created_at
     limit 1;
    if found then
      v_kind := 'sacco';
    end if;
  end if;

  -- The PIN a tenant filing with KRA already confirmed on its eTIMS device.
  if to_regclass('public.etims_credentials') is not null then
    execute 'select ec.kra_pin::text from public.etims_credentials ec where ec.admin_id = $1 limit 1'
      into v_pin
      using v_target;
  end if;

  select * into b from public.tenant_branding tb where tb.admin_id = v_target;

  if v_kind is null and b.admin_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'admin_id',         v_target,
    'kind',             coalesce(v_kind, 'company'),
    'name',             v_name,
    'registration_no',  v_reg,
    'motto',            b.motto,
    'logo_path',        b.logo_path,
    'phone',            coalesce(b.phone, v_phone),
    'email',            coalesce(b.email, v_email),
    'website',          b.website,
    'physical_address', coalesce(b.physical_address, v_address),
    'postal_address',   b.postal_address,
    'kra_pin',          coalesce(b.kra_pin, v_pin),
    'configured',       b.admin_id is not null,
    'updated_at',       b.updated_at,
    'defaults', jsonb_build_object(
      'phone',            v_phone,
      'email',            v_email,
      'physical_address', v_address,
      'kra_pin',          v_pin
    ),
    'branding', case when b.admin_id is null then null else jsonb_build_object(
      'motto',            b.motto,
      'logo_path',        b.logo_path,
      'phone',            b.phone,
      'email',            b.email,
      'website',          b.website,
      'physical_address', b.physical_address,
      'postal_address',   b.postal_address,
      'kra_pin',          b.kra_pin
    ) end
  );
end;
$$;

revoke all on function public.get_tenant_letterhead(uuid) from public;
revoke all on function public.get_tenant_letterhead(uuid) from anon;
grant execute on function public.get_tenant_letterhead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE SAVE
--
--    Every field is a full replacement: blank clears it back to the
--    registration default. The logo is the exception, because it is a file:
--      p_remove_logo = true    no logo
--      p_logo_path given       the newly uploaded file (must already exist in
--                              this tenant's folder)
--      neither                 keep the current logo
--
--    Returns the new letterhead plus `previous_logo_path` when the logo
--    changed, so the client can delete the file nothing points at any more.
--    It is not deleted here: a row in storage.objects removed by SQL leaves the
--    file itself behind in the object store.
-- ---------------------------------------------------------------------------
create or replace function public.save_tenant_branding(
  p_motto            text    default null,
  p_phone            text    default null,
  p_email            text    default null,
  p_website          text    default null,
  p_physical_address text    default null,
  p_postal_address   text    default null,
  p_kra_pin          text    default null,
  p_logo_path        text    default null,
  p_remove_logo      boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin    uuid := public.current_admin_id();
  v_old      public.tenant_branding%rowtype;
  v_new      public.tenant_branding%rowtype;
  v_motto    text := nullif(btrim(regexp_replace(coalesce(p_motto, ''), '\s+', ' ', 'g')), '');
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_website  text := nullif(regexp_replace(btrim(coalesce(p_website, '')), '/+$', ''), '');
  v_physical text := nullif(btrim(regexp_replace(coalesce(p_physical_address, ''), '\s+', ' ', 'g')), '');
  v_postal   text := nullif(btrim(regexp_replace(coalesce(p_postal_address, ''), '\s+', ' ', 'g')), '');
  v_pin      text := nullif(upper(regexp_replace(coalesce(p_kra_pin, ''), '\s+', '', 'g')), '');
  v_logo     text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_letter   jsonb;
begin
  if auth.uid() is null or v_admin is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not public.can_manage_tenant_branding() then
    raise exception 'Only an administrator can change the business branding.'
      using errcode = '42501';
  end if;

  -- ── Validation, with messages a person can act on ────────────────────────
  if v_motto is not null and char_length(v_motto) > 120 then
    raise exception 'The motto can be at most 120 characters.' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+() /,.-]{7,40}$' then
    raise exception 'The phone number should contain only digits, spaces and + ( ) - / , characters.'
      using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;
  if v_website is not null and (
       char_length(v_website) > 120
       or v_website !~* '^(https?://)?[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?(/[^\s]*)?$'
     ) then
    raise exception 'That website address does not look right.' using errcode = '22023';
  end if;
  if v_physical is not null and char_length(v_physical) > 160 then
    raise exception 'The physical address can be at most 160 characters.' using errcode = '22023';
  end if;
  if v_postal is not null and char_length(v_postal) > 80 then
    raise exception 'The postal address can be at most 80 characters.' using errcode = '22023';
  end if;
  if v_pin is not null and v_pin !~ '^[AP][0-9]{9}[A-Z]$' then
    raise exception 'A KRA PIN is A or P, nine digits and a letter, e.g. P051234567X.'
      using errcode = '22023';
  end if;

  if v_logo is not null then
    if v_logo !~ ('^' || v_admin::text || '/[A-Za-z0-9_-]{1,80}\.(png|jpg|jpeg)$') then
      raise exception 'That logo is not in this business''s folder.' using errcode = '42501';
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'tenant-branding' and o.name = v_logo
    ) then
      raise exception 'The logo upload did not finish. Please upload it again.'
        using errcode = '22023';
    end if;
  end if;

  select * into v_old from public.tenant_branding where admin_id = v_admin for update;

  insert into public.tenant_branding as tb (
    admin_id, logo_path, motto, phone, email, website,
    physical_address, postal_address, kra_pin, updated_by, updated_at
  ) values (
    v_admin,
    case when p_remove_logo then null else coalesce(v_logo, v_old.logo_path) end,
    v_motto, v_phone, v_email, v_website,
    v_physical, v_postal, v_pin, auth.uid(), now()
  )
  on conflict (admin_id) do update set
    logo_path        = excluded.logo_path,
    motto            = excluded.motto,
    phone            = excluded.phone,
    email            = excluded.email,
    website          = excluded.website,
    physical_address = excluded.physical_address,
    postal_address   = excluded.postal_address,
    kra_pin          = excluded.kra_pin,
    updated_by       = excluded.updated_by,
    updated_at       = excluded.updated_at
  returning * into v_new;

  -- The audit trail is written here, where it cannot be skipped. A logo or a
  -- PIN on a tax receipt is exactly the kind of change somebody later asks
  -- "who did that" about. It must not cost the save, though.
  begin
    insert into public.audit_logs (
      user_id, action, table_name, record_id, old_values, new_values,
      description, severity, admin_id
    ) values (
      auth.uid(),
      (case when v_old.admin_id is null then 'create' else 'update' end)::public.audit_action,
      'tenant_branding',
      v_admin,
      case when v_old.admin_id is null then null else to_jsonb(v_old) end,
      to_jsonb(v_new),
      'Document branding updated',
      'info',
      v_admin
    );
  exception when others then
    raise notice 'tenant_branding audit row not written: %', sqlerrm;
  end;

  v_letter := public.get_tenant_letterhead(v_admin);

  return coalesce(v_letter, '{}'::jsonb) || jsonb_build_object(
    'previous_logo_path',
    case when v_old.logo_path is distinct from v_new.logo_path then v_old.logo_path else null end
  );
end;
$$;

revoke all on function public.save_tenant_branding(text, text, text, text, text, text, text, text, boolean) from public;
revoke all on function public.save_tenant_branding(text, text, text, text, text, text, text, text, boolean) from anon;
grant execute on function public.save_tenant_branding(text, text, text, text, text, text, text, text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
