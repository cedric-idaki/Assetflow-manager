-- ===========================================================================
-- SCHEDULING THE eTIMS DRAIN
--
-- Filing is asynchronous by design: a sale enqueues a row and commits, and
-- something else has to come along and send it (20260902160000, header). Until
-- this migration that "something else" did not exist. etims-transmit was
-- deployed and correct, but nothing ever called it, so a queued document sat at
-- 'pending' forever unless a human opened the compliance screen and pressed
-- Send queued now. A tax filing that only happens when somebody remembers is
-- not a filing system.
--
-- WHY THE SECRET COMES FROM VAULT
--
-- etims-transmit accepts a scheduled caller two ways: a service-role bearer
-- token, or an x-cron-secret header matching CRON_SECRET. Either one is a
-- credential, and a credential does not belong in a migration file that lives
-- in git. So the job reads it from Vault at run time, and this migration
-- contains only the NAME of the secret.
--
-- The project URL is hardcoded rather than vaulted because it is not a secret:
-- it is in .env as VITE_SUPABASE_URL and ships to every browser already.
--
-- WHY THE JOB DOES NOTHING WHEN THE SECRET IS ABSENT
--
-- The `from (...) where secret is not null` shape means no Vault row produces
-- no HTTP call at all, rather than a POST with an empty header that KRA-facing
-- logs would fill with 401s every five minutes. An unconfigured schedule should
-- be quiet, not noisy.
--
-- CADENCE
--
-- Five minutes. The drain takes a capped batch per run (DEFAULT_BATCH, ceiling
-- of 100) and retries carry their own backoff via next_attempt_at, so a backlog
-- drains over several runs instead of one long request. KRA's own guidance
-- contemplates offline transmission, so minutes of latency are normal and
-- expected; nothing here is in the path of taking money.
--
-- Idempotent: cron.schedule upserts on the job name, so re-running replaces the
-- schedule rather than stacking a second one.
-- ===========================================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

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
     where name = 'etims_cron_secret'
     limit 1
  ) s
  where s.secret is not null
    and s.secret <> '';
  $job$
);

commit;
