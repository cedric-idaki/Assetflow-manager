-- Remove the rows created by seed-feature-test-data.sql only.
begin;

delete from public.payment_request_events where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00003201'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003202'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003203'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003204'::uuid);
delete from public.payment_request_documents where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00003101'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003102'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003103'::uuid);
delete from public.payment_requests where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00003001'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003002'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003003'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00003004'::uuid);

delete from public.agent_manager_assignments where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00002101'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00002102'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00002103'::uuid);
delete from public.agents where id = '5f58c19a-8e55-5c22-8d5e-1f1e00002001'::uuid;

delete from public.statutory_reminder_logs where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00001101'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00001102'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00001103'::uuid);
delete from public.statutory_return_filings where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00000101'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00000201'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00000301'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00000401'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00000501'::uuid);
delete from public.statutory_reminder_settings
 where extra_recipients = array['demo.accountant@example.com']::text[]
   and admin_id in (select id from public.user_profiles where role = 'admin');

delete from public.document_archive where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00004001'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00004002'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00004003'::uuid);
delete from public.bank_transactions where id in (
  '5f58c19a-8e55-5c22-8d5e-1f1e00005001'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00005002'::uuid,
  '5f58c19a-8e55-5c22-8d5e-1f1e00005003'::uuid);

commit;