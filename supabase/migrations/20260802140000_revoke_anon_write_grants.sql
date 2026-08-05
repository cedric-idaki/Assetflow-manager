-- ===========================================================================
-- Revoke anon write privileges across the public schema.
--
-- A `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon` was applied at some
-- point, so the anon role (the key shipped in the public JS bundle) held
-- INSERT/UPDATE/DELETE/TRUNCATE on ~105 tables — including kyc_documents,
-- company_kyc_documents and user_profiles. RLS was the only thing in front of
-- it, which makes every one of those tables a single careless `{public}`
-- policy away from unauthenticated writes.
--
-- TRUNCATE matters even with correct RLS: it is a table-level operation that
-- RLS does NOT filter. No end-user role should ever hold it, so it is revoked
-- from `authenticated` as well.
--
-- SELECT is deliberately left alone — some reads are legitimately public, and
-- narrowing them is a separate decision with its own blast radius.
--
-- Verified before writing this: of the tables with an anon-reachable policy,
-- every one requires an auth.uid()-derived value (so anon can never satisfy
-- it) EXCEPT payment_alert_configs / payment_alerts_log, whose open_access_*
-- policies are themselves a separate open finding. No legitimate anon write
-- path exists, so this revoke breaks nothing.
-- ===========================================================================

begin;

revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke truncate                        on all tables in schema public from authenticated;

-- Sequences: writing is gone, so the sequence usage that backed it goes too.
revoke usage, update on all sequences in schema public from anon;

-- Stop the same grants reappearing on every new table. ALTER DEFAULT
-- PRIVILEGES only applies to objects created by the role that owns the
-- default, so this covers tables created by `postgres` — which is what
-- migrations run as (verified: current_user = session_user = postgres).
--
-- LIMITATION: the connecting role is not a member of supabase_admin, so the
-- equivalent default for objects created by supabase_admin (i.e. tables made
-- through the dashboard UI rather than a migration) cannot be set from here.
-- Re-run the revoke above after creating tables that way, or create them via
-- a migration instead.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon;
alter default privileges in schema public
  revoke truncate on tables from authenticated;

commit;
