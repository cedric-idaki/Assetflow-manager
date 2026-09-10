-- ===========================================================================
-- eTIMS CREDIT NOTES — RAISING ONE
--
-- WHAT WAS MISSING
--
-- 20260902160000 built credit notes everywhere except at the start. The table
-- accepts doc_type 'credit_note' and carries reverses_id; the document builder
-- negates every figure and sets rcptTyCd/rfdDt/rfdRsnCd; the transmit function
-- resolves the parent's invoice number into orgInvcNo. But NOTHING EVER
-- INSERTED ONE. The only writer of etims_invoices is the enqueue trigger, and
-- it writes doc_type 'sale', always. So a filed invoice could never be
-- reversed, which is not a cosmetic gap: a refund or a return against a filed
-- tax invoice requires a credit note, and without one the tenant's KRA position
-- overstates their sales for as long as the error stands.
--
-- WHY AN RPC RATHER THAN AN INSERT POLICY
--
-- etims_invoices is deliberately read-only to a tenant (20260902160000 §3):
-- nothing in a browser may write a row that a receipt will later assert to a
-- customer. That rule is not relaxed here. What the browser supplies is a
-- REASON, which is an input to filing in the same way a classification is; the
-- figures are never sent from the client. They are rebuilt server-side at
-- transmit time by buildFromSale() out of the original sale, and negated by the
-- shared builder. So the client cannot state an amount to credit even if it
-- wanted to.
--
-- WHY A FULL REVERSAL AND NOTHING ELSE
--
-- The credit note reverses the WHOLE sale. A partial credit would mean choosing
-- lines and quantities, and the POS has no concept of a partial return to build
-- that from -- there is no returns flow, so there is no record of what came
-- back. Offering a partial credit note here would mean inventing the figures in
-- the UI, which is exactly what the paragraph above forbids. Full reversal is
-- the case the data actually supports; a partial one waits for a returns flow.
--
-- WHY THE PARENT MUST ALREADY BE 'sent'
--
-- KRA identifies the reversed document by orgInvcNo, the device sequence number
-- of the original. A document that was never accepted has no such number, so
-- there is nothing to reverse and the credit note would be rejected. A pending
-- or rejected invoice should be cancelled or re-sent, not credited.
--
-- Idempotent and transactional.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. WHAT A CREDIT NOTE CARRIES BEYOND A SALE
--
-- rfdRsnCd is a two-digit KRA code. There is no picker for it in the UI and
-- that is honest rather than lazy: the authoritative list comes from KRA's own
-- selectCodeList endpoint, which this system fetches nowhere yet
-- (_shared/etimsClient.ts exports fetchCodeList and nothing calls it). Until it
-- does, offering a hand-written dropdown would be presenting guesses as KRA's
-- vocabulary, and a wrong code is a rejected filing.
--
-- So the column is nullable and the builder already defaults a null to '05'
-- ("other"), which is always accepted. A tenant whose KRA agent has told them
-- to use a specific code can type it; everyone else leaves it alone and
-- explains themselves in the remark, which rides along as KRA's `remark` field.
-- ---------------------------------------------------------------------------
alter table public.etims_invoices
  add column if not exists refund_reason_code text,
  add column if not exists remark             text,
  add column if not exists raised_by          uuid;

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'etims_invoices_rfd_rsn_chk'
  ) then
    alter table public.etims_invoices
      add constraint etims_invoices_rfd_rsn_chk
      check (refund_reason_code is null or refund_reason_code ~ '^[0-9]{2}$');
  end if;
end
$do$;

comment on column public.etims_invoices.refund_reason_code is
  'KRA rfdRsnCd. NULL means the builder sends 05 (other), which is always valid.';
comment on column public.etims_invoices.remark is
  'Free text sent to KRA as `remark`. How a tenant explains a reversal.';
comment on column public.etims_invoices.raised_by is
  'auth.uid() of whoever raised a credit note. NULL on trigger-enqueued sales.';

-- ---------------------------------------------------------------------------
-- 2. RAISING ONE
--
-- SECURITY DEFINER because the table has no insert policy for anybody, by
-- design. Every tenant check is therefore made explicitly here, against
-- current_admin_id() and never against an admin id passed in.
--
-- Note what is NOT a parameter: no amount, no lines, no invoice number, no
-- date. Supplying any of those from a browser is the thing this design exists
-- to prevent.
-- ---------------------------------------------------------------------------
create or replace function public.etims_raise_credit_note(
  p_invoice     uuid,
  p_reason_code text default null,
  p_remark      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin  uuid := public.current_admin_id();
  v_parent public.etims_invoices;
  v_new    uuid;
begin
  if v_admin is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- The module gate is applied by hand because etims_invoices carries no
  -- enforce_module_write trigger: one there would fire inside the transaction
  -- that records a sale and could abort it (20260902160000 §5).
  if not public.module_enabled('etims', v_admin) then
    raise exception 'The KRA eTIMS module is not enabled for this account.'
      using errcode = 'P0001';
  end if;

  select * into v_parent
    from public.etims_invoices
   where id = p_invoice
     and admin_id = v_admin;

  if not found then
    raise exception 'That document does not exist.' using errcode = 'P0002';
  end if;

  if v_parent.doc_type <> 'sale' then
    raise exception 'A credit note can only reverse an invoice, not another credit note.'
      using errcode = 'P0001';
  end if;

  if v_parent.status <> 'sent' or v_parent.invoice_number is null then
    raise exception
      'That invoice has not been filed with KRA yet, so there is nothing to reverse. Cancel or re-send it instead.'
      using errcode = 'P0001';
  end if;

  if p_reason_code is not null and p_reason_code !~ '^[0-9]{2}$' then
    raise exception 'A KRA refund reason code is two digits.' using errcode = 'P0001';
  end if;

  -- prices_include_tax and environment are copied from the parent rather than
  -- read from anywhere current: a reversal must be computed on the same basis
  -- as the document it reverses, and must belong to the same KRA environment.
  -- The transmit function rejects an environment mismatch, so copying keeps a
  -- sandbox invoice from being credited against a production device.
  begin
    insert into public.etims_invoices
      (admin_id, sale_id, source, doc_type, reverses_id, status,
       prices_include_tax, environment, refund_reason_code, remark, raised_by)
    values
      (v_admin, v_parent.sale_id, v_parent.source, 'credit_note', v_parent.id, 'pending',
       v_parent.prices_include_tax, v_parent.environment,
       nullif(btrim(coalesce(p_reason_code, '')), ''),
       nullif(btrim(coalesce(p_remark, '')), ''),
       auth.uid())
    returning id into v_new;
  exception when unique_violation then
    -- etims_invoices_sale_doc_idx is unique on (sale_id, doc_type) for every
    -- status but 'cancelled'. Reaching here means this sale already has a live
    -- credit note, which is the constraint doing its job: filing a second
    -- reversal of one invoice would credit the customer twice at KRA.
    raise exception 'This invoice has already been credited.' using errcode = 'P0001';
  end;

  return v_new;
end;
$fn$;

revoke execute on function public.etims_raise_credit_note(uuid, text, text) from public, anon;
grant  execute on function public.etims_raise_credit_note(uuid, text, text) to authenticated;

comment on function public.etims_raise_credit_note(uuid, text, text) is
  'Queue a full reversal of a filed eTIMS invoice. Figures are rebuilt at transmit time, never supplied by the caller.';

commit;
