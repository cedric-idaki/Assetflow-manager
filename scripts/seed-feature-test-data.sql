-- ===========================================================================
-- ARARAT FEATURE TEST FIXTURES
--
-- Run this AFTER scripts/seed-demo-data.sql and the migrations that introduce
-- the tables below. It is intentionally separate from the broad demo seed so
-- these newer workflow fixtures can be removed without touching the main demo.
--
-- Replace REPLACE_WITH_ADMIN_EMAIL when more than one company admin exists.
-- All files are placeholder paths in private storage; no real document is sent
-- or uploaded by this SQL.
--
-- Remove with scripts/seed-feature-test-data-teardown.sql.
-- ===========================================================================

begin;

drop table if exists _feature_ctx;
create temporary table _feature_ctx as
select up.id as admin_id
  from public.user_profiles up
 where up.role = 'admin'
   and ('REPLACE_WITH_ADMIN_EMAIL' = 'REPLACE_WITH_ADMIN_EMAIL'
        or lower(up.email) = lower('REPLACE_WITH_ADMIN_EMAIL'));

do $$
declare n integer;
begin
  select count(*) into n from _feature_ctx;
  if n <> 1 then
    raise exception 'Feature fixture needs exactly one company admin. Matched % row(s).', n;
  end if;
end $$;

-- ── 1. STATUTORY RETURNS AND REMINDER HISTORY ─────────────────────────────
insert into public.statutory_reminder_settings (admin_id, enabled, vat_registered, extra_recipients)
select admin_id, true, true, array['demo.accountant@example.com']::text[]
  from _feature_ctx
on conflict (admin_id) do update set enabled = true, vat_registered = true;

insert into public.statutory_return_filings
  (id, admin_id, return_key, period, due_date, amount, filed_at, reference, notes)
select v.id::uuid, c.admin_id, v.return_key, v.period, v.due_date::date, v.amount,
       v.filed_at::timestamptz, v.reference, 'Feature fixture — safe to delete.'
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00000101', 'paye',         '2026-07', '2026-08-09', 84250,  '2026-08-08T16:00:00Z', 'DEMO-P10-2026-07'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00000201', 'nssf',         '2026-08', '2026-09-09', 18600,  null,                    null),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00000301', 'shif',         '2026-08', '2026-09-09', 26400,  null,                    null),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00000401', 'housing_levy', '2026-08', '2026-09-09', 12600,  null,                    null),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00000501', 'vat',         '2026-08', '2026-09-20', 318400, null,                    null)
  ) as v(id, return_key, period, due_date, amount, filed_at, reference)
on conflict (admin_id, return_key, period) do nothing;

insert into public.statutory_reminder_logs
  (id, admin_id, return_key, period, due_date, lead_days, channel, recipient, status, sent_at)
select v.id::uuid, c.admin_id, v.return_key, v.period, v.due_date::date, v.lead_days,
       v.channel, v.recipient, v.status, v.sent_at::timestamptz
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00001101', 'paye', '2026-08', '2026-09-09', 7, 'email', 'demo.accountant@example.com', 'sent',   '2026-09-02T08:00:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00001102', 'paye', '2026-08', '2026-09-09', 1, 'in_app','demo.accountant@example.com', 'sent',   '2026-09-08T08:00:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00001103', 'shif', '2026-08', '2026-09-09', 0, 'email', 'demo.finance@example.com',    'failed', '2026-09-09T08:00:00Z')
  ) as v(id, return_key, period, due_date, lead_days, channel, recipient, status, sent_at)
on conflict do nothing;

-- ── 2. SALES MANAGER HIERARCHY ────────────────────────────────────────────
-- The existing demo agents are retained; one additional manager is added.
insert into public.agents
  (id, user_id, admin_id, agent_code, full_name, email, phone, agent_status,
   commission_rate, target_amount, region, agent_role)
select '5f58c19a-8e55-5c22-8d5e-1f1e00002001'::uuid,
       '46313f2a-9f03-5d66-923a-7b7dfca1e3b5'::uuid, c.admin_id,
       'DEMO-MGR-01', 'Brian Otieno — Sales Manager', 'demo.manager@example.com',
       '+254700009901', 'active'::public.agent_status, 6.0, 12000000, 'Nairobi', 'manager'
  from _feature_ctx c
on conflict (id) do nothing;

insert into public.agent_manager_assignments
  (id, agent_id, manager_id, admin_id, is_primary, is_active, authorized_by, assigned_by)
select v.id::uuid, v.agent_id::uuid, v.manager_id::uuid, c.admin_id, true, true,
       '46313f2a-9f03-5d66-923a-7b7dfca1e3b5'::uuid,
       '46313f2a-9f03-5d66-923a-7b7dfca1e3b5'::uuid
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00002101', '19ca52bf-6418-5091-ab63-14535c1ea30f', '5f58c19a-8e55-5c22-8d5e-1f1e00002001'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00002102', '96cec2d6-8a1f-5a48-9201-86741d59dc42', '5f58c19a-8e55-5c22-8d5e-1f1e00002001'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00002103', '1475e1bf-e981-5b37-a990-fbbae59ad0fa', '5f58c19a-8e55-5c22-8d5e-1f1e00002001')
  ) as v(id, agent_id, manager_id)
on conflict (id) do nothing;

-- ── 3. FINHUB APPROVAL CASES, DOCUMENTS AND EVENTS ────────────────────────
insert into public.payment_requests
  (id, admin_id, agent_id, manager_id, client_id, invoice_id, invoice_ref,
   request_type, status, amount, currency, payment_method, payee_name,
   payee_account, narrative, submitted_by, submitted_at, validation_passed,
   validation_result, decision, decision_reason, decided_at, verified_at,
   bank_confirmed, bank_reference, reconciled_at, reconciliation_note)
select v.id::uuid, c.admin_id, v.agent_id::uuid, v.manager_id::uuid, v.client_id::uuid,
       v.invoice_id::uuid, v.invoice_ref, v.request_type::public.payment_request_kind,
       v.status::public.payment_request_status, v.amount, 'KES', v.method, v.payee,
       v.account, v.narrative, '8e62ba22-e93b-548a-878c-5af33e05cf11'::uuid,
       v.submitted_at::timestamptz, v.validation_passed, v.validation_result::jsonb,
       v.decision::public.payment_request_decision, v.decision_reason,
       v.decided_at::timestamptz, v.verified_at::timestamptz,
       v.bank_confirmed, v.bank_reference, v.reconciled_at::timestamptz, v.reconciliation_note
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003001','19ca52bf-6418-5091-ab63-14535c1ea30f','5f58c19a-8e55-5c22-8d5e-1f1e00002001','94e53e2b-883e-5b8b-a4d3-005a93348b37','79299b75-c4a8-5a9d-91aa-c494433f6cb5','DEMO-CI-0001','agent_commission','pending_approval',185000,'bank_transfer','Caroline Njeri','KE-DEMO-001','Needs validation: invoice, balance and duplicate checks.','2026-09-10T09:00:00Z',null,'{}',null,null,null,false,null,null,null),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003002','96cec2d6-8a1f-5a48-9201-86741d59dc42','5f58c19a-8e55-5c22-8d5e-1f1e00002001','e0130fdc-7194-5d06-9e0d-1b8b05ab745f','e9705d5c-20dd-5779-bab5-c8dabb75b8df','DEMO-CI-0002','supplier_payment','on_hold',340000,'bank_transfer','Mombasa Traders Ltd','KE-DEMO-002','WAIT: delivery evidence needs review.','2026-09-08T11:00:00Z',true,'{"documents":true,"duplicate":false}','hold','Awaiting delivery evidence','2026-09-09T10:00:00Z',null,false,null,null,null),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003003','1475e1bf-e981-5b37-a990-fbbae59ad0fa','5f58c19a-8e55-5c22-8d5e-1f1e00002001','6875f7d1-6a0b-5710-817b-cabd47efff17','3d16b327-065b-5f83-8e73-bb505a142729','DEMO-CI-0003','client_refund','completed',42500,'mpesa','Ibrahim Noor','254700000103','Completed and reconciled demo refund.','2026-08-28T09:00:00Z',true,'{"invoice":true,"amount":true,"documents":true}','approve','Verified and released','2026-08-29T09:00:00Z','2026-08-29T09:05:00Z',true,'DEMO-BANK-REF-003','2026-08-30T12:00:00Z','Matched to bank statement'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003004','19ca52bf-6418-5091-ab63-14535c1ea30f','5f58c19a-8e55-5c22-8d5e-1f1e00002001','cc15082f-26f0-5c73-90dd-59f88bfb8ecd','960f7e10-c393-5f36-bf21-3b4d305ce2bb','DEMO-CI-0004','expense_reimbursement','rejected',96000,'bank_transfer','Patrick Omondi','KE-DEMO-004','Rejected: invoice is cancelled.','2026-09-05T09:00:00Z',false,'{"invoice":false,"reason":"Invoice is cancelled"}','reject','Cancelled invoice reference','2026-09-05T15:00:00Z',null,false,null,null,null)
  ) as v(id, agent_id, manager_id, client_id, invoice_id, invoice_ref, request_type, status, amount, method, payee, account, narrative, submitted_at, validation_passed, validation_result, decision, decision_reason, decided_at, verified_at, bank_confirmed, bank_reference, reconciled_at, reconciliation_note)
on conflict (id) do nothing;

insert into public.payment_request_documents
  (id, request_id, admin_id, document_type, file_name, file_path, mime_type, file_size, uploaded_by)
select v.id::uuid, v.request_id::uuid, c.admin_id, v.document_type,
       v.file_name, v.file_path, 'application/pdf', v.file_size,
       '8e62ba22-e93b-548a-878c-5af33e05cf11'::uuid
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003101','5f58c19a-8e55-5c22-8d5e-1f1e00003001','invoice','DEMO-INVOICE-0001.pdf','demo/feature/payment-requests/0001/invoice.pdf',48200),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003102','5f58c19a-8e55-5c22-8d5e-1f1e00003001','contract','DEMO-CONTRACT-0001.pdf','demo/feature/payment-requests/0001/contract.pdf',76100),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003103','5f58c19a-8e55-5c22-8d5e-1f1e00003002','delivery_evidence','DEMO-DELIVERY-0002.pdf','demo/feature/payment-requests/0002/delivery.pdf',55400)
  ) as v(id, request_id, document_type, file_name, file_path, file_size)
on conflict (id) do nothing;

insert into public.payment_request_events
  (id, request_id, admin_id, event_type, from_status, to_status, actor_id, actor_name, actor_role, reason, detail, amount, occurred_at)
select v.id::uuid, v.request_id::uuid, c.admin_id, v.event_type,
       v.from_status::public.payment_request_status, v.to_status::public.payment_request_status,
       '8e62ba22-e93b-548a-878c-5af33e05cf11'::uuid, 'Grace Wanjiru', 'finance', v.reason,
       v.detail::jsonb, v.amount, v.occurred_at::timestamptz
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003201','5f58c19a-8e55-5c22-8d5e-1f1e00003001','created',null,'draft','Request created','{}',185000,'2026-09-10T09:00:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003202','5f58c19a-8e55-5c22-8d5e-1f1e00003001','submitted','draft','submitted','Submitted by agent portal','{}',185000,'2026-09-10T09:02:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003203','5f58c19a-8e55-5c22-8d5e-1f1e00003001','validated','under_validation','pending_approval','Invoice, amount and documents checked','{"passed":true}',185000,'2026-09-10T11:00:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00003204','5f58c19a-8e55-5c22-8d5e-1f1e00003003','verified','approved','processing','Second verification completed','{"two_step":true}',42500,'2026-08-29T09:05:00Z')
  ) as v(id, request_id, event_type, from_status, to_status, reason, detail, amount, occurred_at)
on conflict (id) do nothing;

-- ── 4. SEARCHABLE PDF INDEX AND BANK RECONCILIATION ───────────────────────
insert into public.document_archive
  (id, admin_id, doc_type, module, title, reference, client_id, client_name,
   amount, file_path, file_name, mime_type, file_size, issued_at, created_by)
select v.id::uuid, c.admin_id, v.doc_type, v.module, v.title, v.reference,
       v.client_id::uuid, v.client_name, v.amount, v.file_path, v.file_name,
       'application/pdf', v.file_size, v.issued_at::timestamptz,
       '8e62ba22-e93b-548a-878c-5af33e05cf11'::uuid
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00004001','receipt','pos','POS receipt — DEMO-RCP-FEATURE-001','DEMO-RCP-FEATURE-001','94e53e2b-883e-5b8b-a4d3-005a93348b37','Joseph Mwangi',125000,'demo/archive/2026/09/12/DEMO-RCP-FEATURE-001__receipt.pdf','DEMO-RCP-FEATURE-001.pdf',28000,'2026-09-12T10:15:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00004002','voucher','finhub','Payment voucher — PR-FEATURE-0002','PR-FEATURE-0002','e0130fdc-7194-5d06-9e0d-1b8b05ab745f','Lilian Achieng',340000,'demo/archive/2026/09/09/PR-FEATURE-0002__voucher.pdf','PR-FEATURE-0002.pdf',31000,'2026-09-09T14:20:00Z'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00004003','payslip','hr','PAYE payslip — August 2026','DEMO-PAYREG-2026-08',null,null,347800,'demo/archive/2026/08/26/DEMO-PAYREG-2026-08__payslip.pdf','payroll-2026-08.pdf',63200,'2026-08-26T18:00:00Z')
  ) as v(id, doc_type, module, title, reference, client_id, client_name, amount, file_path, file_name, file_size, issued_at)
on conflict (id) do nothing;

insert into public.bank_transactions
  (id, admin_id, bank_account, txn_date, value_date, description, bank_reference,
   amount, direction, running_balance, status, matched_payment_id, matched_at,
   match_method, review_note, fingerprint)
select v.id::uuid, c.admin_id, 'DEMO-EQUITY-001', v.txn_date::date, v.txn_date::date,
       v.description, v.bank_reference, v.amount, v.direction, v.running_balance,
       v.status, v.payment_id::uuid, v.matched_at::timestamptz, v.match_method,
       v.review_note, v.fingerprint
  from _feature_ctx c
  cross join (values
    ('5f58c19a-8e55-5c22-8d5e-1f1e00005001','2026-09-09','PAYMENT PR-FEATURE-0003','DEMO-BANK-REF-003',42500,'credit',8124500,'matched','e4a7372a-2bda-5e57-accf-d644cc5dcc63','2026-09-09T13:00:00Z','reference',null,'feature-bank-001'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00005002','2026-09-11','EFT CREDIT UNKNOWN CUSTOMER','DEMO-BANK-REF-UNKNOWN',75000,'credit',8199500,'review',null,null,'manual','Amount and reference need investigation','feature-bank-002'),
    ('5f58c19a-8e55-5c22-8d5e-1f1e00005003','2026-09-10','SUPPLIER PAYMENT NOT FOUND','DEMO-BANK-REF-PENDING',340000,'credit',8165500,'unmatched',null,null,null,'Expected payment not yet identified','feature-bank-003')
  ) as v(id, txn_date, description, bank_reference, amount, direction, running_balance, status, payment_id, matched_at, match_method, review_note, fingerprint)
on conflict (id) do nothing;

commit;