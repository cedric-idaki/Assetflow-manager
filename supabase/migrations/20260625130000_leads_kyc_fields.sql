-- Migration: add KYC / contact-detail columns to leads.
--
-- The sales-agent "Register Lead" flow (registerLead in useSalesAgentPortal.js)
-- writes a set of KYC fields when capturing a lead so the details carry over
-- when the lead is later converted. Those columns never existed on the table,
-- so the insert failed with:
--   PGRST204: Could not find the 'kra_pin' column of 'leads' in the schema cache
--
-- Stored as plain nullable text — the lead form does not require them, and rows
-- created before this field existed stay valid.
--
-- ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run.

alter table public.leads add column if not exists physical_address          text;
alter table public.leads add column if not exists kra_pin                   text;
alter table public.leads add column if not exists postal_address            text;
alter table public.leads add column if not exists next_of_kin_name          text;
alter table public.leads add column if not exists next_of_kin_phone         text;
alter table public.leads add column if not exists next_of_kin_relationship  text;
