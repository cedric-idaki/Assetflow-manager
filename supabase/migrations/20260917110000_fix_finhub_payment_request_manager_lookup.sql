-- Fix the manager lookup used when an agent submits a FinHub payment request.
--
-- `agent_manager_assignments` stores the manager in `manager_id`; the original
-- FinHub function accidentally queried a non-existent `manager_agent_id`.
-- Recreate the function for databases where the original migration has already
-- been applied, while preserving its API, privileges and security settings.

create or replace function public.finhub_submit_payment_request(
  p_amount         numeric,
  p_request_type   public.payment_request_kind default 'agent_commission',
  p_narrative      text default null,
  p_client_id      uuid default null,
  p_invoice_id     uuid default null,
  p_payment_method text default null,
  p_payee_name     text default null,
  p_payee_account  text default null,
  p_payee_phone    text default null,
  p_submit_now     boolean default true
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       public.payment_requests;
  v_agent     uuid := public.get_agent_id_for_user(auth.uid());
  v_manager   uuid;
  v_inv_ref   text;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may raise a payment request.' using errcode = '42501';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A payment request needs an amount greater than zero.' using errcode = 'P0001';
  end if;

  if v_agent is not null and to_regclass('public.agent_manager_assignments') is not null then
    select manager_id into v_manager
      from public.agent_manager_assignments
     where agent_id = v_agent and is_active and is_primary
     limit 1;
  end if;

  if p_invoice_id is not null then
    select invoice_no into v_inv_ref from public.company_invoices where id = p_invoice_id;
  end if;

  insert into public.payment_requests
    (request_type, status, agent_id, manager_id, client_id, invoice_id, invoice_ref,
     amount, payment_method, payee_name, payee_account, payee_phone, narrative,
     submitted_by, submitted_at)
  values
    (p_request_type, 'draft', v_agent, v_manager, p_client_id, p_invoice_id, v_inv_ref,
     round(p_amount, 2), p_payment_method, p_payee_name, p_payee_account, p_payee_phone,
     nullif(btrim(coalesce(p_narrative, '')), ''),
     auth.uid(), case when p_submit_now then now() else null end)
  returning * into v_row;

  insert into public.payment_request_events
    (request_id, admin_id, event_type, to_status, actor_id, actor_name, actor_role, amount, detail)
  select v_row.id, v_row.admin_id, 'created', 'draft', auth.uid(), up.full_name, up.role::text, v_row.amount,
         jsonb_build_object('request_no', v_row.request_no)
    from public.user_profiles up where up.id = auth.uid();

  if p_submit_now then
    v_row := public.payment_request_move(v_row.id, 'submitted', 'submitted', null,
               jsonb_build_object('request_no', v_row.request_no));
  end if;

  return v_row;
end;
$$;

revoke execute on function public.finhub_submit_payment_request(numeric, public.payment_request_kind, text, uuid, uuid, text, text, text, text, boolean) from public, anon;
grant  execute on function public.finhub_submit_payment_request(numeric, public.payment_request_kind, text, uuid, uuid, text, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
