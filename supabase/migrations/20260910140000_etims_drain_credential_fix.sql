-- ===========================================================================
-- THE eTIMS DRAIN HAS NEVER SENT A SINGLE REQUEST
--
-- 20260905130000 scheduled etims-transmit every five minutes and reads its
-- credential from Vault, which is right. It reads it from the name
-- `etims_cron_secret`, and no such Vault row has ever existed.
--
-- The job's own `where s.secret is not null` guard then does exactly what it
-- was designed to do: no row, no HTTP call. Quietly. So the schedule has been
-- running 288 times a day since 5 September, making zero calls, while
-- `net._http_response` recorded nothing at all for it. A queued KRA document
-- only ever moved when somebody opened the compliance screen and pressed
-- "Send queued now" -- which is precisely the state 20260905130000 was written
-- to end.
--
-- That is the failure mode of a well-behaved guard: it is indistinguishable
-- from working until you go looking. Anything reading a credential from Vault
-- should be checked against net._http_response, not against cron.job_run_details
-- -- the job "succeeds" every time, because running a SELECT that returns no
-- rows is a success.
--
-- WHAT CHANGES
--
-- The job now reads `cron_secret`, the single Vault row the scheduled jobs
-- share, created on 2026-09-10. Nothing else moves: same schedule, same
-- endpoint, same body, same 55-second timeout, same quiet-when-unconfigured
-- guard.
--
-- VERIFIED BEFORE APPLYING, on two counts:
--
--   1. The credential works. The job body was run by hand against
--      `cron_secret` and etims-transmit answered 200 with ok:true.
--   2. Nothing gets filed by surprise. Every eTIMS table -- invoices,
--      purchases, stock movements AND credentials -- is empty, so no tenant has
--      connected a KRA account and there is no backlog waiting to transmit the
--      moment this starts working. A tax document filed wrongly is the tenant's
--      liability and cannot be quietly withdrawn, so switching this on with a
--      months-old backlog behind it would have been the wrong order of
--      operations.
--
-- Idempotent: cron.schedule upserts on the job name.
-- ===========================================================================

begin;

select cron.schedule(
  'etims-transmit-drain',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://ektyvejahnkxqumeibke.supabase.co/functions/v1/etims-transmit',
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-cron-secret',  s.secret
               ),
    body    := jsonb_build_object('action', 'drain'),
    timeout_milliseconds := 55000
  )
  from (
    select decrypted_secret as secret
      from vault.decrypted_secrets
     where name = 'cron_secret'
     limit 1
  ) s
  where s.secret is not null
    and s.secret <> '';
  $job$
);

commit;
