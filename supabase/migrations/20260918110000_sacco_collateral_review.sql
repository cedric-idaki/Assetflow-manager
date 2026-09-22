-- SACCO collateral review: a pledge is evidence submitted by a member, not
-- security accepted by the society until an authorised officer reviews it.

begin;

alter table public.sacco_loan_collateral
  add column if not exists reviewed_by uuid references public.user_profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.sacco_loan_collateral
  drop constraint if exists sacco_loan_collateral_status_chk;

alter table public.sacco_loan_collateral
  add constraint sacco_loan_collateral_status_chk
  check (status in ('pledged', 'approved', 'rejected', 'released', 'realised'));

create index if not exists idx_sacco_collateral_review_queue
  on public.sacco_loan_collateral (sacco_id, status, created_at desc)
  where status = 'pledged';

create or replace function public.sacco_review_loan_collateral(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns public.sacco_loan_collateral
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sacco_loan_collateral%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  select * into v_row from public.sacco_loan_collateral where id = p_id for update;
  if v_row.id is null then
    raise exception 'Collateral record not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.saccos s
     where s.id = v_row.sacco_id
       and (s.admin_id = public.current_admin_id() or public.is_global_viewer())
  ) then
    raise exception 'Only an authorised SACCO administrator may review collateral.' using errcode = '42501';
  end if;

  if v_decision not in ('approved', 'rejected') then
    raise exception 'Collateral review must be approved or rejected.' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pledged' then
    raise exception 'Only collateral awaiting review can be decided; this record is %.', v_row.status using errcode = 'P0001';
  end if;
  if v_decision = 'rejected' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Give the member a reason when rejecting collateral.' using errcode = 'P0001';
  end if;

  update public.sacco_loan_collateral
     set status = v_decision,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_values, description, severity, admin_id)
  values (
    auth.uid(), 'update'::public.audit_action, 'sacco_loan_collateral', v_row.id,
    jsonb_build_object('decision', v_decision, 'note', v_row.review_note, 'loan_id', v_row.loan_id),
    format('SACCO collateral %s: %s', v_decision, v_row.asset_reference),
    case when v_decision = 'rejected' then 'warning' else 'info' end,
    v_row.admin_id
  );

  return v_row;
end;
$$;

revoke execute on function public.sacco_review_loan_collateral(uuid, text, text) from public, anon;
grant  execute on function public.sacco_review_loan_collateral(uuid, text, text) to authenticated;

comment on function public.sacco_review_loan_collateral(uuid, text, text) is
  'Authorised SACCO administrator accepts or rejects a member collateral pledge. A rejected pledge must retain the reviewer reason.';

notify pgrst, 'reload schema';
commit;
