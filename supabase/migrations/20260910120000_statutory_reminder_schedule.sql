-- ===========================================================================
-- SCHEDULING THE STATUTORY RETURN REMINDERS
--
-- statutory-return-reminders was written on 2026-09-03 and deployed on
-- 2026-09-10, and until this migration nothing ever called it. A deadline
-- reminder that only fires when somebody remembers to fire it is not a
-- reminder; the whole point is that PAYE, NSSF, SHIF, the housing levy and VAT
-- are chased BEFORE they become penalties.
--
-- CADENCE
--
-- Once a day at 06:00 UTC, which is 09:00 in Nairobi -- inside the working
-- morning, and early enough that a return due on the 9th can still be filed the
-- day it is chased. The function decides for itself which tenants owe what: it
-- fires on lead days 7, 3, 1 and 0, then chases daily for a fortnight once a
-- return is overdue, then stops. So one run a day is the whole schedule; the
-- lead-day logic does not belong in a cron expression.
--
-- WHY THE CREDENTIAL COMES FROM VAULT
--
-- The function accepts a scheduled caller two ways: a service-role bearer
-- token, or an x-cron-secret header matching CRON_SECRET. Either one is a
-- credential, and a credential does not belong in a migration file that lives
-- in git -- nor in cron.job.command, which any database reader can select.
-- Both of the jobs that pre-date this one carry their credential inline. This
-- one reads it from Vault at run time and this file holds only the NAME.
--
-- WHY THE HEADER AND NOT A BEARER TOKEN
--
-- The bearer route was tried first and does not work on this project. The
-- legacy service_role JWT reaches the function and fails its own comparison,
-- so SUPABASE_SERVICE_ROLE_KEY was explicitly set to something other than the
-- project's published key; the newer sb_secret_ key is rejected by the gateway
-- before the function is even reached. The x-cron-secret header answers 200.
-- Do not "simplify" this back to a bearer without re-testing both.
--
-- The project URL is hardcoded because it is not a secret: it is in .env as
-- VITE_SUPABASE_URL and ships to every browser already.
--
-- WHY IT DOES NOTHING WHEN THE SECRET IS ABSENT
--
-- `from (...) where secret is not null` means no Vault row produces no HTTP
-- call, rather than a POST with an empty Authorization header and a daily 401
-- in the logs. An unconfigured schedule should be quiet, not noisy. The row is
-- created out of band -- it is a credential, so it is not seeded here.
--
-- WHY THE TIMEOUT IS SET EXPLICITLY
--
-- pg_net defaults to 5000 ms. Both existing jobs leave it at the default and
-- both record nothing but `Timeout of 5000 ms reached` -- so neither has a
-- single confirmed successful call, and whether their work runs at all is
-- unknown from this side. This function reads a workload across every tenant
-- and groups the returns falling due on one day into one email, which is not
-- five-second work. 55 seconds leaves room and still returns inside the edge
-- runtime's own wall clock.
--
-- Idempotent: cron.schedule upserts on the job name, so re-running replaces the
-- schedule rather than stacking a second one.
-- ===========================================================================

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'statutory-return-reminders-daily',
  '0 6 * * *',
  $job$
  select net.http_post(
    url     := 'https://ektyvejahnkxqumeibke.supabase.co/functions/v1/statutory-return-reminders',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', s.secret
               ),
    body    := '{}'::jsonb,
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
