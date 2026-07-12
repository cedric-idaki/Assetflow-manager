-- Migration: add 'sacco_admin' to the user_role enum.
--
-- A person registering an organisation of type "Sacco" (chosen in the admin
-- registration wizard) becomes a sacco_admin instead of a normal company admin.
-- On login they are routed to the dedicated /sacco-dashboard (see
-- ROLE_REDIRECT_MAP in src/contexts/AuthContext.jsx).
--
-- This value MUST be committed in its own migration before any later migration
-- references it in an RLS policy or default — Postgres rejects "unsafe use of a
-- new enum value" within the same transaction that added it. The sacco tables
-- and policies therefore live in the following migration (20260701140000).
--
-- ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sacco_admin';
