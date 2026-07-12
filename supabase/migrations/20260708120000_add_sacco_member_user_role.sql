-- Migration: add 'sacco_member' to the user_role enum.
--
-- A sacco/chama member gets their own login (created by the sacco_admin from
-- the Members tab). On login they are routed to /sacco-member-portal — the
-- BRS v3.0 Member Self-Service Portal (shares, voting, contracts, loans,
-- contributions, statements, bylaws).
--
-- Like 20260701130000_add_sacco_role.sql, the enum value MUST be committed in
-- its own migration before any later migration references it — Postgres
-- rejects "unsafe use of a new enum value" within the transaction that added
-- it. All sacco_member RLS policies live in 20260708130000.
--
-- ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sacco_member';
