-- ===========================================================================
-- SACCO ASSET REGISTER
--
-- A SACCO owns things — the plot the office sits on, the branch vehicle, the
-- server the core system runs on, the chairs in the AGM hall — and until now
-- the only place any of that could be written down was
-- public.sacco_fixed_assets: a handful of columns created by the accounting
-- engine (20260725120000) purely so the depreciation batch job had something
-- to depreciate, reachable only from a modal buried in Finance Hub → Periods.
--
-- It has no category, no description, no location, no status, no way to attach
-- the logbook or the title deed, and no idea what anything is worth today. It
-- is a depreciation input, not a register.
--
-- THIS MIGRATION MAKES IT A REGISTER — and does it by GROWING THAT TABLE
-- rather than adding a second one.
--
--   A parallel `sacco_assets` table would have been quicker to write and wrong
--   the day it shipped: the Balance Sheet's Property, Plant & Equipment line
--   and the period-end depreciation job both read sacco_fixed_assets. A
--   register the SACCO fills in that the statements do not read is a register
--   that disagrees with the accounts, and the two would drift apart from the
--   first asset entered. One table, one truth.
--
-- COST vs BOOK VALUE vs CURRENT VALUE — three different numbers, kept apart:
--
--   cost          what was paid. Never changes. Already here.
--   book_value    cost − accumulated depreciation. GENERATED, so it is always
--                 whatever the ledger says and can never be typed over.
--   current_value what the asset is worth NOW: a valuation the SACCO records
--                 (market, insurance or professional), with the date and basis
--                 beside it so a stale figure identifies itself. Optional —
--                 where it is absent the register reports book value, and says
--                 which of the two it is showing.
--
--   Recording a valuation deliberately does NOT post to the ledger. Revaluing
--   an asset upward is an equity movement under IAS 16 and needs a treasurer's
--   judgement and a journal, not a side effect of typing in a text box.
--
-- Five parts:
--
--   1. Register columns on sacco_fixed_assets, plus asset tagging.
--   2. status ⇄ is_disposed kept in lockstep, so the depreciation job (which
--      reads is_disposed) can never charge depreciation on a sold vehicle.
--   3. sacco_asset_documents — the supporting file cabinet, in a private,
--      tenant-scoped storage bucket.
--   4. sacco_asset_events — who moved it, who revalued it, who wrote it off.
--   5. sacco_asset_register_summary() — whole-book totals in one round trip,
--      so the KPI cards never reduce over a paged array.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE REGISTER COLUMNS
--
-- Added nullable first, backfilled, and only then given a default and NOT
-- NULL. Adding them WITH a default would stamp every legacy row with that
-- default and leave the backfill below nothing to recognise — a re-run would
-- then overwrite a category an operator had deliberately corrected.
-- ---------------------------------------------------------------------------

alter table public.sacco_fixed_assets
  add column if not exists asset_tag         text,
  add column if not exists category          text,
  add column if not exists description       text,
  add column if not exists location          text,
  add column if not exists status            text,
  add column if not exists serial_number     text,
  add column if not exists supplier          text,
  add column if not exists current_value     decimal(15,2),
  add column if not exists valuation_date    date,
  add column if not exists valuation_basis   text,
  add column if not exists disposal_proceeds decimal(15,2),
  add column if not exists disposal_reason   text,
  add column if not exists registered_by     uuid references public.user_profiles(id) on delete set null;

-- Net book value, owned by the ledger. GENERATED rather than a plain column
-- precisely so that no form, import or well-meaning UPDATE can set it to a
-- figure the accumulated depreciation does not support.
alter table public.sacco_fixed_assets
  add column if not exists book_value decimal(15,2)
    generated always as (coalesce(cost, 0) - coalesce(accumulated_depreciation, 0)) stored;

-- ── Backfill: category from the GL code it was already posted to ────────────
-- The chart of accounts already separates PPE into 1300/1310/1320/1330/1400,
-- so every legacy row can name its own category without anyone re-keying it.
update public.sacco_fixed_assets
   set category = case gl_code
         when '1300' then 'land_buildings'
         when '1310' then 'furniture_fittings'
         when '1320' then 'computer_equipment'
         when '1330' then 'motor_vehicles'
         when '1400' then 'intangible_software'
         else 'other'
       end
 where category is null;

-- ── Backfill: status from the disposal flag ─────────────────────────────────
update public.sacco_fixed_assets
   set status = case when is_disposed then 'disposed' else 'in_use' end
 where status is null;

alter table public.sacco_fixed_assets alter column category set default 'other';
alter table public.sacco_fixed_assets alter column status   set default 'in_use';
alter table public.sacco_fixed_assets alter column category set not null;
alter table public.sacco_fixed_assets alter column status   set not null;

-- ── Vocabulary ─────────────────────────────────────────────────────────────
-- Categories mirror the PPE section of the chart of accounts, plus the two
-- kinds of thing a SACCO owns that the chart lumps into 1310 (plant, and
-- general office equipment) so the register can still tell them apart.
alter table public.sacco_fixed_assets drop constraint if exists sacco_fixed_assets_category_chk;
alter table public.sacco_fixed_assets add constraint sacco_fixed_assets_category_chk
  check (category in (
    'land_buildings', 'motor_vehicles', 'furniture_fittings', 'computer_equipment',
    'office_equipment', 'plant_machinery', 'intangible_software', 'other'
  ));

-- Three terminal states, not one: an asset SOLD, an asset WRITTEN OFF as
-- worthless and an asset LOST are different facts about the SACCO's money, and
-- a register that spells all three "disposed" cannot answer for any of them.
alter table public.sacco_fixed_assets drop constraint if exists sacco_fixed_assets_status_chk;
alter table public.sacco_fixed_assets add constraint sacco_fixed_assets_status_chk
  check (status in (
    'in_use', 'in_storage', 'under_maintenance', 'impaired',
    'disposed', 'written_off', 'lost'
  ));

alter table public.sacco_fixed_assets drop constraint if exists sacco_fixed_assets_valuation_chk;
alter table public.sacco_fixed_assets add constraint sacco_fixed_assets_valuation_chk
  check (current_value is null or current_value >= 0);

-- ── Asset tags ─────────────────────────────────────────────────────────────
-- The label physically stuck on the thing. Unique per tenant, never reused.
create unique index if not exists idx_sacco_fixed_assets_tag
  on public.sacco_fixed_assets (admin_id, asset_tag)
  where asset_tag is not null;

create index if not exists idx_sacco_fixed_assets_status
  on public.sacco_fixed_assets (admin_id, status);
create index if not exists idx_sacco_fixed_assets_category
  on public.sacco_fixed_assets (admin_id, category);

-- Next free asset tag for a tenant, as FA-0001.
--
-- max()+1 rather than a sequence, so the numbers stay dense and readable on a
-- printed label even after a deleted draft. Two cases lose to that choice —
-- two people registering an asset in the same instant, and a single multi-row
-- INSERT, which cannot see its own earlier rows — and in both the unique index
-- above turns it into a plain error rather than two assets quietly sharing a
-- tag. For a register that grows by a handful of rows a month, entered one at a
-- time through a form, that trade is worth the readability. A bulk import
-- should supply its own tags rather than lean on this.
create or replace function public.sacco_next_asset_tag(p_admin uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin uuid := coalesce(p_admin, public.current_admin_id());
  v_next  integer;
begin
  select coalesce(max(substring(asset_tag from '^FA-([0-9]+)$')::integer), 0) + 1
    into v_next
    from public.sacco_fixed_assets
   where admin_id = v_admin
     and asset_tag ~ '^FA-[0-9]+$';

  return 'FA-' || lpad(v_next::text, 4, '0');
end;
$fn$;

revoke all on function public.sacco_next_asset_tag(uuid) from public;
revoke all on function public.sacco_next_asset_tag(uuid) from anon;
grant execute on function public.sacco_next_asset_tag(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. status ⇄ is_disposed, AND THE TAG STAMP
--
-- is_disposed is not decoration: computeDepreciation() in
-- src/utils/saccoAccounting.js filters on it, and it is what stops the
-- period-end job charging depreciation on something the SACCO no longer owns.
-- Now that a human sets `status` instead, the two must never disagree — so
-- neither is trusted to be set by hand. The trigger derives one from the other
-- in whichever direction the caller wrote, which also means every pre-existing
-- caller (the Finance Hub asset modal, an import, a manual SQL fix) keeps
-- working untouched.
-- ---------------------------------------------------------------------------

create or replace function public.sacco_asset_normalise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_terminal constant text[] := array['disposed', 'written_off', 'lost'];
begin
  if tg_op = 'INSERT' then
    new.asset_tag     := coalesce(nullif(trim(new.asset_tag), ''), public.sacco_next_asset_tag(new.admin_id));
    new.registered_by := coalesce(new.registered_by, auth.uid());
  end if;

  -- Which side moved? A caller that set status wins; a caller that only knows
  -- about is_disposed (everything written before this migration) still gets a
  -- consistent row.
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.is_disposed := new.status = any (v_terminal);
  elsif tg_op = 'UPDATE' and new.is_disposed is distinct from old.is_disposed then
    if new.is_disposed and not (new.status = any (v_terminal)) then
      new.status := 'disposed';
    elsif not new.is_disposed and new.status = any (v_terminal) then
      new.status := 'in_use';
    end if;
  else
    new.is_disposed := coalesce(new.status = any (v_terminal), false);
  end if;

  -- A terminal status without a date is unanswerable at audit; default it to
  -- today rather than leaving the register unable to say when.
  if new.is_disposed then
    new.disposal_date := coalesce(new.disposal_date, current_date);
  else
    new.disposal_date    := null;
    new.disposal_reason  := null;
    new.disposal_proceeds := null;
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_sacco_asset_normalise on public.sacco_fixed_assets;
create trigger trg_sacco_asset_normalise
  before insert or update on public.sacco_fixed_assets
  for each row execute function public.sacco_asset_normalise();

-- Legacy rows predate the tag; give them one now so the register has no blanks.
-- Ordered by acquisition so the oldest asset is FA-0001, which is what an
-- operator numbering a shelf of existing kit would have done by hand.
do $do$
declare
  r record;
begin
  for r in
    select id,
           'FA-' || lpad(row_number() over (
             partition by admin_id order by acquisition_date, created_at, id
           )::text, 4, '0') as tag
      from public.sacco_fixed_assets
     where asset_tag is null
  loop
    update public.sacco_fixed_assets set asset_tag = r.tag where id = r.id;
  end loop;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. SUPPORTING DOCUMENTS
--
-- The title deed, the logbook, the purchase invoice, the valuation report, the
-- insurance certificate, the photograph taken at the AGM. Files live in a
-- PRIVATE bucket keyed by tenant (see §6); this table is the index over them,
-- because a bucket listing cannot say which asset a PDF belongs to, when the
-- cover expires, or who uploaded it.
-- ---------------------------------------------------------------------------

create table if not exists public.sacco_asset_documents (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid,
  sacco_id    uuid references public.saccos(id) on delete cascade,
  asset_id    uuid not null references public.sacco_fixed_assets(id) on delete cascade,

  doc_type    text not null default 'other',
  title       text,
  file_name   text not null,
  file_url    text not null,
  mime_type   text,
  size_bytes  bigint,

  -- Insurance lapses and valuations go stale. A register that cannot say when
  -- is a register nobody can act on.
  issued_on   date,
  expires_on  date,

  notes       text,
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table public.sacco_asset_documents drop constraint if exists sacco_asset_documents_type_chk;
alter table public.sacco_asset_documents add constraint sacco_asset_documents_type_chk
  check (doc_type in (
    'invoice', 'receipt', 'title_deed', 'logbook', 'warranty',
    'valuation_report', 'insurance', 'photo', 'disposal_note', 'other'
  ));

create index if not exists idx_sacco_asset_docs_asset
  on public.sacco_asset_documents (asset_id, created_at desc);
create index if not exists idx_sacco_asset_docs_admin
  on public.sacco_asset_documents (admin_id);
create index if not exists idx_sacco_asset_docs_expiry
  on public.sacco_asset_documents (admin_id, expires_on)
  where expires_on is not null;

-- A document inherits its asset's tenant. Doing this in the database rather
-- than the browser means an upload cannot be filed against another tenant's
-- asset even if the client sends one.
create or replace function public.sacco_asset_document_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin uuid;
  v_sacco uuid;
begin
  select a.admin_id, a.sacco_id into v_admin, v_sacco
    from public.sacco_fixed_assets a
   where a.id = new.asset_id;

  if v_admin is null then
    raise exception 'Asset % does not exist', new.asset_id using errcode = '23503';
  end if;

  new.admin_id    := v_admin;
  new.sacco_id    := v_sacco;
  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  new.updated_at  := now();
  return new;
end;
$fn$;

drop trigger if exists trg_sacco_asset_document_stamp on public.sacco_asset_documents;
create trigger trg_sacco_asset_document_stamp
  before insert or update on public.sacco_asset_documents
  for each row execute function public.sacco_asset_document_stamp();

-- ---------------------------------------------------------------------------
-- 4. THE MOVEMENT TRAIL
--
-- Status and location are the two fields on this register that CHANGE, and a
-- register that only knows the current answer cannot survive an audit: "the
-- laptop is at Head Office" is worth little without "moved there from Nakuru
-- branch on 12 March, by the operations officer". Written by trigger, never by
-- the browser, so a change made through any route is recorded.
-- ---------------------------------------------------------------------------

create table if not exists public.sacco_asset_events (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid,
  sacco_id   uuid,
  asset_id   uuid not null references public.sacco_fixed_assets(id) on delete cascade,
  event_type text not null,
  field      text,
  from_value text,
  to_value   text,
  note       text,
  actor_id   uuid,
  created_at timestamptz default now()
);

alter table public.sacco_asset_events drop constraint if exists sacco_asset_events_type_chk;
alter table public.sacco_asset_events add constraint sacco_asset_events_type_chk
  check (event_type in ('registered', 'status_changed', 'moved', 'revalued', 'disposed'));

create index if not exists idx_sacco_asset_events_asset
  on public.sacco_asset_events (asset_id, created_at desc);
create index if not exists idx_sacco_asset_events_admin
  on public.sacco_asset_events (admin_id, created_at desc);

create or replace function public.sacco_asset_log_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.sacco_asset_events
      (admin_id, sacco_id, asset_id, event_type, field, to_value, note, actor_id)
    values
      (new.admin_id, new.sacco_id, new.id, 'registered', null, new.asset_tag,
       new.asset_name, v_actor);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.sacco_asset_events
      (admin_id, sacco_id, asset_id, event_type, field, from_value, to_value, note, actor_id)
    values
      (new.admin_id, new.sacco_id, new.id,
       case when new.is_disposed then 'disposed' else 'status_changed' end,
       'status', old.status, new.status, new.disposal_reason, v_actor);
  end if;

  if coalesce(new.location, '') is distinct from coalesce(old.location, '') then
    insert into public.sacco_asset_events
      (admin_id, sacco_id, asset_id, event_type, field, from_value, to_value, actor_id)
    values
      (new.admin_id, new.sacco_id, new.id, 'moved', 'location',
       old.location, new.location, v_actor);
  end if;

  if new.current_value is distinct from old.current_value then
    insert into public.sacco_asset_events
      (admin_id, sacco_id, asset_id, event_type, field, from_value, to_value, note, actor_id)
    values
      (new.admin_id, new.sacco_id, new.id, 'revalued', 'current_value',
       old.current_value::text, new.current_value::text, new.valuation_basis, v_actor);
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_sacco_asset_log_event on public.sacco_fixed_assets;
create trigger trg_sacco_asset_log_event
  after insert or update on public.sacco_fixed_assets
  for each row execute function public.sacco_asset_log_event();

-- ---------------------------------------------------------------------------
-- 5. WHOLE-BOOK TOTALS
--
-- SECURITY INVOKER, so RLS below decides which rows it sees and the function
-- cannot become a way to read another tenant's register. The KPI cards read
-- this instead of reducing over the page of rows on screen — a total computed
-- from a paged array is a total of the page, which is the one number a
-- treasurer must never be shown.
-- ---------------------------------------------------------------------------

create or replace function public.sacco_asset_register_summary()
returns table (
  total_assets          bigint,
  in_service            bigint,
  disposed_assets       bigint,
  needs_attention       bigint,
  total_cost            numeric,
  total_depreciation    numeric,
  total_book_value      numeric,
  total_current_value   numeric,
  valued_assets         bigint,
  undocumented_assets   bigint,
  expiring_documents    bigint,
  by_category           jsonb,
  by_status             jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with live as (
    select a.*,
           -- What the register reports an asset is worth today: the recorded
           -- valuation where there is one, book value where there is not.
           coalesce(a.current_value, a.book_value, 0) as reported_value,
           -- Resolved here rather than inside a FILTER clause below, so the
           -- correlation is a plain per-row expression the planner can hash-
           -- join instead of a subquery buried in an aggregate.
           exists (select 1 from public.sacco_asset_documents d where d.asset_id = a.id) as has_documents
      from public.sacco_fixed_assets a
  )
  select
    count(*)::bigint,
    count(*) filter (where status = 'in_use')::bigint,
    count(*) filter (where is_disposed)::bigint,
    count(*) filter (where status in ('under_maintenance', 'impaired'))::bigint,
    coalesce(sum(cost) filter (where not is_disposed), 0)::numeric,
    coalesce(sum(accumulated_depreciation) filter (where not is_disposed), 0)::numeric,
    coalesce(sum(book_value) filter (where not is_disposed), 0)::numeric,
    coalesce(sum(reported_value) filter (where not is_disposed), 0)::numeric,
    count(*) filter (where current_value is not null)::bigint,
    count(*) filter (where not is_disposed and not has_documents)::bigint,
    (select count(*) from public.sacco_asset_documents d
      where d.expires_on is not null
        and d.expires_on <= current_date + 60)::bigint,
    coalesce(
      (select jsonb_object_agg(t.category, t.agg)
         from (
           select category,
                  jsonb_build_object(
                    'count', count(*),
                    'cost',  coalesce(sum(cost), 0),
                    'value', coalesce(sum(coalesce(current_value, book_value, 0)), 0)
                  ) as agg
             from live
            where not is_disposed
            group by category
         ) t),
      '{}'::jsonb),
    coalesce(
      (select jsonb_object_agg(t.status, t.n)
         from (select status, count(*) as n from live group by status) t),
      '{}'::jsonb)
  from live;
$fn$;

revoke all on function public.sacco_asset_register_summary() from public;
revoke all on function public.sacco_asset_register_summary() from anon;
grant execute on function public.sacco_asset_register_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS, GRANTS, REALTIME
--
-- Same tenant model as every other sacco_* table: the tenant's staff manage
-- their own rows, the platform operator can look. sacco_fixed_assets already
-- carries this policy from 20260725120000 and is untouched here.
-- ---------------------------------------------------------------------------

do $do$
declare
  t text;
begin
  foreach t in array array['sacco_asset_documents', 'sacco_asset_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "tenant_manage_%s" on public.%I', t, t);
    execute format(
      'create policy "tenant_manage_%s" on public.%I
         for all to authenticated
         using      ((admin_id = public.current_admin_id() and public.is_staff_member()) or public.is_global_viewer())
         with check  ((admin_id = public.current_admin_id() and public.is_staff_member()) or public.is_global_viewer())',
      t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- Supabase's default privileges hand `anon` a grant on every new public
    -- table. Every policy above is `to authenticated`, so anon is already
    -- blocked by RLS — but a title deed's index is not the place to rely on
    -- one layer. Same reasoning as 20260802140000.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$do$;

-- The movement trail is written by trigger and read by people. Letting a
-- browser INSERT or UPDATE into it would make it forgeable, which is the one
-- property an audit trail cannot lose.
revoke insert, update, delete on public.sacco_asset_events from authenticated;

do $do$ begin
  alter publication supabase_realtime add table public.sacco_fixed_assets;
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter publication supabase_realtime add table public.sacco_asset_documents;
exception when duplicate_object then null; end $do$;

-- ---------------------------------------------------------------------------
-- 7. THE MODULE
--
-- Mirrored in src/config/modules.js — the database owns the key list, that
-- file owns label, icon and which preset offers it. Change one, change both.
--
-- The write gate is attached to sacco_asset_documents ONLY, deliberately NOT
-- to sacco_fixed_assets: that table is also the depreciation job's input, and
-- gating it would mean a tenant who froze the register broke their period-end
-- close in the `accounting` module. Freezing this module hides the register;
-- it does not stop the books from balancing.
-- ---------------------------------------------------------------------------

create or replace function public.module_catalogue()
returns table (module_key text, requires text[])
language sql
immutable
as $fn$
  select * from (values
    -- key              requires (must be enabled for this module to work)
    ('assets',          '{}'::text[]),
    ('clients',         '{}'::text[]),
    ('pos',             array['assets']),
    ('hire_purchase',   array['clients']),
    ('payments',        '{}'::text[]),
    ('mpesa',           array['payments']),
    ('kyc',             array['clients']),
    ('esign',           '{}'::text[]),
    ('contracts',       '{}'::text[]),
    ('crm',             array['clients']),
    ('hr',              '{}'::text[]),
    ('payroll',         array['hr']),
    ('reports',         '{}'::text[]),
    ('accounting',      '{}'::text[]),
    -- sacco / chama
    ('members',         '{}'::text[]),
    ('contributions',   array['members']),
    ('loans',           array['members']),
    ('shares',          array['members']),
    ('voting',          array['members']),
    ('welfare',         array['members']),
    ('mgr',             array['members']),
    ('fixed_assets',    '{}'::text[])
  ) as t(module_key, requires);
$fn$;

drop trigger if exists trg_module_gate on public.sacco_asset_documents;
create trigger trg_module_gate
  before insert or update or delete on public.sacco_asset_documents
  for each row execute function public.enforce_module_write('fixed_assets');

-- Existing tenants get the new module switched on, exactly as the original
-- entitlements migration did: nothing about their portal narrows on the day
-- this runs. module_enabled() also fails open for a missing row, so this is
-- belt and braces rather than the thing that makes it work.
insert into public.tenant_modules
  (admin_id, module_key, status, enabled_at, changed_by)
select up.id, 'fixed_assets', 'enabled', now(), null
  from public.user_profiles up
 where up.role::text in ('admin', 'sacco_admin')
on conflict (admin_id, module_key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. THE DOCUMENT BUCKET
--
-- Private from the first day — a title deed and a logbook are exactly the kind
-- of document the 20260731091000 lockdown was written about. Objects are
-- pathed `<admin_id>/<asset_id>/<file>`, which is what
-- storage_path_is_own_tenant() reads, and served only through signed URLs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sacco-asset-documents', 'sacco-asset-documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sacco_asset_docs_tenant_read"   on storage.objects;
drop policy if exists "sacco_asset_docs_tenant_insert" on storage.objects;
drop policy if exists "sacco_asset_docs_tenant_update" on storage.objects;
drop policy if exists "sacco_asset_docs_tenant_delete" on storage.objects;

create policy "sacco_asset_docs_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'sacco-asset-documents'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "sacco_asset_docs_tenant_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sacco-asset-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "sacco_asset_docs_tenant_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'sacco-asset-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
)
with check (
  bucket_id = 'sacco-asset-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "sacco_asset_docs_tenant_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'sacco-asset-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- ---------------------------------------------------------------------------
-- 9. DOCUMENTATION
-- ---------------------------------------------------------------------------

comment on table public.sacco_fixed_assets is
  'The SACCO asset register. Also the depreciation job''s input and the source of the Balance Sheet PPE line — one table so the register and the accounts can never disagree.';
comment on column public.sacco_fixed_assets.cost is
  'What was paid at acquisition. Never revalued.';
comment on column public.sacco_fixed_assets.book_value is
  'GENERATED: cost − accumulated depreciation. Owned by the ledger; cannot be written.';
comment on column public.sacco_fixed_assets.current_value is
  'A valuation the SACCO recorded, with valuation_date and valuation_basis. NULL means "not valued" — the register then reports book_value. Does not post to the ledger.';
comment on column public.sacco_fixed_assets.is_disposed is
  'Derived from status by trg_sacco_asset_normalise. Read by computeDepreciation(); do not set by hand.';
comment on table public.sacco_asset_documents is
  'Index over the supporting files for an asset. The files themselves live in the private sacco-asset-documents bucket, pathed <admin_id>/<asset_id>/<file>.';
comment on table public.sacco_asset_events is
  'Append-only movement trail: status changes, relocations and revaluations. Written by trigger only — authenticated has SELECT and nothing else.';

notify pgrst, 'reload schema';

commit;
