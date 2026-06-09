-- Migration: add 'hr' to the user_role enum.
--
-- The admin (CEO) can now assign an "HR" role to a staff member. HR is the only
-- role — besides the admin/CEO — permitted into the HR segment (/hr-management).
-- Without this value, creating an HR user fails with:
--   ERROR 22P02: invalid input value for enum user_role: "hr"
--
-- ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'hr';
