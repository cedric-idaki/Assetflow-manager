-- ============================================================================
-- THE DOCUMENT ARCHIVE
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- Every PDF this system produces -- journal vouchers, receipts, invoices,
-- payslips, contribution advices, share certificates, dividend notices -- was
-- rendered in the browser, handed to the download folder, and forgotten. The
-- filename carried the reference (Receipt_INV-2291_Nyeri_Traders.pdf) and that
-- was the whole filing system.
--
-- Which means: nobody can find last March's receipts, there is no way to prove
-- what was issued to whom, a re-issue produces a second document with no link
-- to the first, and an auditor asking for "everything for this client in Q2"
-- gets a shrug. The documents exist only on whichever laptop pressed the
-- button.
--
-- WHAT THIS ADDS
-- --------------
-- One registry over one private bucket. A document is filed under
--
--     <admin_id>/<yyyy>/<mm>/<dd>/<reference>__<filename>
--
-- and a row records the year, month, day, time, reference, module, kind,
-- client and amount -- which is what makes it findable at all. The path is
-- date-partitioned as well as indexed because a bucket listing is the fallback
-- when everything else fails, and a flat bucket of 40,000 PDFs is not one.
--
-- ---------------------------------------------------------------------------
-- WHY THE ROW IS NOT JUST A POINTER
--
-- client_name, title and amount are copied in rather than joined. A document is
-- a historical fact: the receipt says "Nyeri Traders" whatever the client
-- record says today, and a client row deleted next year must not make its
-- receipts unfindable or unlabelled. Same stance as the invoice bill-to block
-- and sales.buyer_kra_pin.
--
-- ---------------------------------------------------------------------------
-- ARCHIVING NEVER BLOCKS THE DOWNLOAD
--
-- The browser gets the file first and the upload happens after. A storage
-- outage must cost the archive copy, not the document the person is standing
-- there waiting for. See src/utils/documentArchive.js.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. THE REGISTRY
-- ---------------------------------------------------------------------------
create table if not exists public.document_archive (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid,

  -- WHAT IT IS
  doc_type      text not null default 'other',
  module        text not null default 'other',
  title         text not null,
  reference     text,

  -- WHO IT IS ABOUT. Names copied, not joined -- see the header.
  client_id     uuid,
  client_name   text,
  member_id     uuid,

  amount        numeric(15,2),
  currency      text default 'KES',

  -- WHERE THE FILE IS. A bare object name, never a URL.
  file_path     text not null,
  file_name     text not null,
  mime_type     text default 'application/pdf',
  file_size     bigint,

  -- WHEN. issued_at is the document's own moment (the transaction date), which
  -- is not the same as created_at (when it was filed) -- a receipt reprinted in
  -- June for a March sale is a March document.
  issued_at     timestamptz not null default now(),
  -- Bucketed in Africa/Nairobi rather than UTC: a receipt issued at 01:00 EAT
  -- on 1 March belongs to March, not to the previous month. The explicit zone
  -- is also what makes these expressions IMMUTABLE -- extract() straight off a
  -- timestamptz reads the session TimeZone, so Postgres refuses it in a stored
  -- generated column (42P17).
  issued_year   integer generated always as (extract(year  from (issued_at at time zone 'Africa/Nairobi'))::integer) stored,
  issued_month  integer generated always as (extract(month from (issued_at at time zone 'Africa/Nairobi'))::integer) stored,

  created_by    uuid,
  created_at    timestamptz not null default now(),

  constraint document_archive_type_chk check (doc_type in (
    'receipt', 'invoice', 'voucher', 'statement', 'payslip', 'certificate',
    'contract', 'advice', 'report', 'other'))
);

create index if not exists idx_docarch_admin_issued on public.document_archive (admin_id, issued_at desc);
create index if not exists idx_docarch_type         on public.document_archive (admin_id, doc_type);
create index if not exists idx_docarch_module       on public.document_archive (admin_id, module);
create index if not exists idx_docarch_client       on public.document_archive (client_id);
create index if not exists idx_docarch_period       on public.document_archive (admin_id, issued_year, issued_month);

-- Search runs over three columns at once, so it gets a trigram index rather
-- than three prefix indexes an ILIKE '%...%' would not use anyway.
create index if not exists idx_docarch_search
  on public.document_archive
  using gin ((coalesce(title, '') || ' ' || coalesce(reference, '') || ' ' || coalesce(client_name, '')) extensions.gin_trgm_ops);

comment on table public.document_archive is
  'Every PDF the system has issued, filed by date and reference. The files live in the private document-archive bucket, pathed <admin_id>/<yyyy>/<mm>/<dd>/<ref>__<file>.';
comment on column public.document_archive.issued_at is
  'The document''s own moment -- the transaction date, not the filing date. A receipt reprinted in June for a March sale is a March document.';
comment on column public.document_archive.client_name is
  'Copied, not joined. A receipt says what it said; deleting the client row must not make its documents unlabelled.';

-- ---------------------------------------------------------------------------
-- 2. RLS
--     Tenant-scoped read. A client sees their own documents too -- they are
--     the other party to every one of them.
-- ---------------------------------------------------------------------------
alter table public.document_archive enable row level security;

drop policy if exists document_archive_select on public.document_archive;
create policy document_archive_select on public.document_archive
  for select to authenticated
  using (
    public.is_global_viewer()
    or (admin_id is not null and admin_id = public.current_admin_id())
    or (client_id is not null and client_id = public.get_client_id_for_user())
  );

revoke all on public.document_archive from anon;
grant select on public.document_archive to authenticated;

-- ---------------------------------------------------------------------------
-- 3. FILING
--
--     Idempotent on file_path: a retry after a network wobble must not put the
--     same document in the register twice. The path carries a timestamp, so
--     two genuine issues of the same receipt still get two rows -- which is
--     correct, because two copies were issued.
-- ---------------------------------------------------------------------------
create or replace function public.archive_document(
  p_title       text,
  p_file_path   text,
  p_file_name   text,
  p_doc_type    text default 'other',
  p_module      text default 'other',
  p_reference   text default null,
  p_client_id   uuid default null,
  p_client_name text default null,
  p_member_id   uuid default null,
  p_amount      numeric default null,
  p_issued_at   timestamptz default null,
  p_file_size   bigint default null
)
returns public.document_archive
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.document_archive%rowtype;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may file a document.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_file_path, '')), '') is null then
    raise exception 'A filed document needs a path.' using errcode = 'P0001';
  end if;

  select * into v_row from public.document_archive where file_path = p_file_path;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.document_archive
    (admin_id, doc_type, module, title, reference, client_id, client_name,
     member_id, amount, file_path, file_name, file_size, issued_at, created_by)
  values
    (public.current_admin_id(),
     coalesce(nullif(btrim(p_doc_type), ''), 'other'),
     coalesce(nullif(btrim(p_module), ''), 'other'),
     coalesce(nullif(btrim(p_title), ''), p_file_name),
     nullif(btrim(coalesce(p_reference, '')), ''),
     p_client_id, nullif(btrim(coalesce(p_client_name, '')), ''),
     p_member_id, p_amount, btrim(p_file_path), p_file_name, p_file_size,
     coalesce(p_issued_at, now()), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.archive_document(text, text, text, text, text, text, uuid, text, uuid, numeric, timestamptz, bigint) from public, anon;
grant  execute on function public.archive_document(text, text, text, text, text, text, uuid, text, uuid, numeric, timestamptz, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. WHAT IS IN THE ARCHIVE
--
--     SECURITY INVOKER, so the counts a client sees are their own documents
--     and the counts staff see are the tenant's. Same rule as the other
--     dashboard aggregates: the figure comes from SQL, not from reducing over
--     a fetched page.
-- ---------------------------------------------------------------------------
create or replace function public.document_archive_summary()
returns table (
  doc_type       text,
  document_count bigint,
  earliest       timestamptz,
  latest         timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select d.doc_type, count(*)::bigint, min(d.issued_at), max(d.issued_at)
    from public.document_archive d
   group by d.doc_type;
$$;

revoke execute on function public.document_archive_summary() from public, anon;
grant  execute on function public.document_archive_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE BUCKET
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-archive', 'document-archive', false, 26214400,
  array['application/pdf', 'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "document_archive_read"   on storage.objects;
drop policy if exists "document_archive_insert" on storage.objects;

create policy "document_archive_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'document-archive'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "document_archive_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'document-archive'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- Deliberately NO delete policy. An archive somebody can quietly empty is not
-- an archive, and nothing in the app has a reason to remove a filed document.

notify pgrst, 'reload schema';

commit;
