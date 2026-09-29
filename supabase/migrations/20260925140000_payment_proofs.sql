-- ============================================================================
-- PROOF OF PAYMENT
--
-- A payment that did not arrive through M-Pesa — a bank deposit, a transfer, a
-- cheque, cash banked at a branch — has, until now, been a reference number
-- typed into a box. Nobody could see the slip. The treasurer confirming a
-- member's "I paid at the bank" declaration and the accountant reconciling a
-- company installment were both taking the number on trust.
--
-- This adds ONE register for supporting documents that serves both sides:
--
--   module = 'company' → attached to public.payments            (payment_id)
--   module = 'sacco'   → attached to public.sacco_contributions (contribution_id)
--
-- Design points:
--
--   * The file goes to a PRIVATE bucket first, the row is written second, by
--     the same rule as the collateral register: an orphan file is recoverable,
--     a row pointing at a file that was never uploaded is a claim with nothing
--     behind it. attach_payment_proof() checks that the object really exists.
--
--   * Objects are pathed <admin_id>/<uploader uid>/<file>. The tenant segment
--     keeps tenants apart; the uploader segment means a SACCO member (whose
--     admin_id is the sacco's admin, exactly like staff) can only ever write
--     into their own folder and can never list or read another member's slips.
--
--   * Proofs are append-only evidence. There is no update and no remove: a
--     wrong slip is answered by uploading the right one, and both stay on the
--     record. The only delete the bucket allows is an uploader clearing an
--     object that no row references — the cleanup after a failed attach.
--
--   * Members may attach only while their declaration is still pending. Once
--     the treasurer has decided, the evidence they decided on is frozen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE REGISTER
-- ---------------------------------------------------------------------------
create table if not exists public.payment_proofs (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null,
  module           text not null check (module in ('company', 'sacco')),
  payment_id       uuid references public.payments(id)            on delete cascade,
  contribution_id  uuid references public.sacco_contributions(id) on delete cascade,
  storage_path     text not null unique,
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint,
  note             text,
  uploaded_by      uuid not null,
  created_at       timestamptz not null default now(),
  constraint payment_proofs_one_target check (
    (module = 'company' and payment_id is not null and contribution_id is null)
    or
    (module = 'sacco' and contribution_id is not null and payment_id is null)
  )
);

comment on table public.payment_proofs is
  'Supporting documents (deposit slips, transfer confirmations) behind a company payment or a SACCO contribution. Files live in the private payment-proofs bucket, pathed <admin_id>/<uploader>/<file>. Append-only; written through attach_payment_proof().';

create index if not exists payment_proofs_payment_idx      on public.payment_proofs (payment_id)      where payment_id is not null;
create index if not exists payment_proofs_contribution_idx on public.payment_proofs (contribution_id) where contribution_id is not null;
create index if not exists payment_proofs_admin_idx        on public.payment_proofs (admin_id, created_at desc);

alter table public.payment_proofs enable row level security;

-- Reads: tenant staff and platform viewers see everything in the tenant; the
-- uploader sees their own; a client sees proofs on their own payments; a
-- member sees proofs on their own contributions. Writes go through the RPC,
-- so there is no INSERT/UPDATE/DELETE policy at all.
drop policy if exists payment_proofs_select on public.payment_proofs;
create policy payment_proofs_select on public.payment_proofs
for select to authenticated
using (
  public.is_global_viewer()
  or (admin_id = public.current_admin_id() and public.is_staff_member())
  or uploaded_by = auth.uid()
  or (payment_id is not null and exists (
        select 1 from public.payments p
         where p.id = payment_proofs.payment_id
           and p.client_id = public.get_client_id_for_user()))
  or (contribution_id is not null and exists (
        select 1 from public.sacco_contributions c
          join public.sacco_members m on m.id = c.member_id
         where c.id = payment_proofs.contribution_id
           and m.user_id = auth.uid()))
);

revoke insert, update, delete on public.payment_proofs from anon, authenticated;
grant select on public.payment_proofs to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ATTACH
-- ---------------------------------------------------------------------------
create or replace function public.attach_payment_proof(
  p_module     text,
  p_record_id  uuid,
  p_path       text,
  p_file_name  text,
  p_mime_type  text   default null,
  p_size_bytes bigint default null,
  p_note       text   default null
)
returns public.payment_proofs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid;
  v_allowed boolean := false;
  v_staff   boolean := public.is_staff_member();
  v_global  boolean := public.is_global_viewer();
  v_pay     public.payments%rowtype;
  v_con     public.sacco_contributions%rowtype;
  v_count   int;
  v_row     public.payment_proofs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_module not in ('company', 'sacco') then
    raise exception 'Unknown module %', p_module;
  end if;
  if p_record_id is null or coalesce(trim(p_path), '') = '' or coalesce(trim(p_file_name), '') = '' then
    raise exception 'A record and an uploaded file are required';
  end if;

  if p_module = 'company' then
    select * into v_pay from public.payments where id = p_record_id;
    if v_pay.id is null then
      raise exception 'Payment not found';
    end if;
    v_admin := v_pay.admin_id;
    v_allowed := v_global
      or (v_staff and v_pay.admin_id = public.current_admin_id())
      or (v_pay.client_id is not null and v_pay.client_id = public.get_client_id_for_user());
  else
    select * into v_con from public.sacco_contributions where id = p_record_id;
    if v_con.id is null then
      raise exception 'Contribution not found';
    end if;
    v_admin := v_con.admin_id;
    if v_global or (v_staff and v_con.admin_id = public.current_admin_id()) then
      v_allowed := true;
      if v_con.status = 'reversed' then
        raise exception 'This contribution was reversed — proof can no longer be attached';
      end if;
    elsif exists (select 1 from public.sacco_members m
                   where m.id = v_con.member_id and m.user_id = auth.uid()) then
      v_allowed := true;
      if v_con.status <> 'pending' then
        raise exception 'This contribution has already been reviewed — proof can only be added while it is pending';
      end if;
    end if;
  end if;

  if not v_allowed then
    raise exception 'You cannot attach proof to this payment';
  end if;
  if v_admin is null then
    raise exception 'This record has no owning tenant — it cannot carry a document';
  end if;

  -- The object must be the caller's own upload, in the record's tenant, and it
  -- must actually be there.
  if (storage.foldername(p_path))[1] is distinct from v_admin::text
     or (storage.foldername(p_path))[2] is distinct from auth.uid()::text then
    raise exception 'The document path does not belong to this payment';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'payment-proofs' and o.name = p_path) then
    raise exception 'The document was not uploaded';
  end if;

  select count(*) into v_count from public.payment_proofs
   where (p_module = 'company' and payment_id = p_record_id)
      or (p_module = 'sacco'   and contribution_id = p_record_id);
  if v_count >= 10 then
    raise exception 'This payment already has the maximum of 10 supporting documents';
  end if;

  insert into public.payment_proofs
    (admin_id, module, payment_id, contribution_id, storage_path, file_name,
     mime_type, size_bytes, note, uploaded_by)
  values
    (v_admin, p_module,
     case when p_module = 'company' then p_record_id end,
     case when p_module = 'sacco'   then p_record_id end,
     p_path, left(trim(p_file_name), 255),
     nullif(trim(p_mime_type), ''), p_size_bytes,
     nullif(left(trim(p_note), 500), ''), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attach_payment_proof(text, uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.attach_payment_proof(text, uuid, text, text, text, bigint, text) to authenticated;

comment on function public.attach_payment_proof(text, uuid, text, text, text, bigint, text) is
  'Register an uploaded proof-of-payment document against a company payment (module company) or a SACCO contribution (module sacco). Upload to payment-proofs/<admin_id>/<auth.uid()>/... first.';

-- ---------------------------------------------------------------------------
-- 3. THE BUCKET
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "payment_proofs_read"   on storage.objects;
drop policy if exists "payment_proofs_insert" on storage.objects;
drop policy if exists "payment_proofs_delete" on storage.objects;

-- Read: platform viewers, tenant staff, the uploader, and anyone who can see
-- the register row that points at the object (a client or member reading the
-- slip on their own payment, uploaded by staff).
create policy "payment_proofs_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_global_viewer()
    or (public.storage_path_is_own_tenant(name) and public.is_staff_member())
    or (storage.foldername(name))[2] = auth.uid()::text
    or exists (select 1 from public.payment_proofs pp where pp.storage_path = name)
  )
);

-- Write: only into <my tenant>/<me>/.
create policy "payment_proofs_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- Delete: the uploader, and only an object no register row points at.
create policy "payment_proofs_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[2] = auth.uid()::text
  and not exists (
    select 1 from public.payment_proofs pp where pp.storage_path = storage.objects.name
  )
);
