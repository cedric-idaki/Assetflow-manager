-- ============================================================================
-- THE BUYER'S KRA PIN
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- Every receipt and invoice this system prints carries the SELLER's KRA PIN,
-- taken from the company profile. None of them carries the BUYER's, and there
-- was nowhere to put one: `clients` has no such column and neither does
-- `sales`. A VAT-registered customer cannot claim input tax on a tax invoice
-- that does not name them, so the paper this platform hands out is, for that
-- customer, not a tax invoice at all.
--
-- It is also the field eTIMS wants. 20260902160000 stores the tenant's own PIN
-- for filing; a supply to a registered buyer is supposed to carry theirs.
--
-- WHY THE PIN SITS IN THREE PLACES AND NOT ONE
-- --------------------------------------------
--   clients.kra_pin            The customer's PIN on file. What the till
--                              prefills from, and what a returning customer
--                              should not have to read out twice.
--
--   sales.buyer_kra_pin        THE PIN THAT WAS ON THAT RECEIPT. Not a lookup.
--                              A reprint two years later must reproduce the
--                              document the customer was handed, and joining
--                              to `clients` would print whatever the record
--                              says today — including a PIN corrected since,
--                              or none at all if the client row was deleted.
--                              Same reason `sales` already snapshots
--                              vat_percent and receipt_number.
--
--   company_invoices.client_kra_pin
--                              Identical argument on the invoice side, where
--                              the bill-to block is already a snapshot
--                              (client_name, client_email, account_no).
--
-- NO VALIDATION CONSTRAINT, DELIBERATELY. A Kenyan PIN is A + 9 digits + a
-- letter, and a CHECK enforcing that would reject the paste-with-spaces and
-- lowercase forms people actually type, at the till, mid-sale, with a customer
-- waiting. The format is checked in the UI where it can be corrected; the
-- column stores what was captured.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

alter table public.clients
  add column if not exists kra_pin text;

alter table public.sales
  add column if not exists buyer_kra_pin text;

alter table public.company_invoices
  add column if not exists client_kra_pin text;

comment on column public.clients.kra_pin is
  'The customer''s own KRA PIN, kept so the till and the invoice screen can prefill it. Not authoritative for any document already issued -- see sales.buyer_kra_pin.';
comment on column public.sales.buyer_kra_pin is
  'The buyer PIN AS PRINTED on that sale''s receipt. A snapshot, never a lookup: a reprint must reproduce the document the customer was handed, not today''s client record.';
comment on column public.company_invoices.client_kra_pin is
  'The buyer PIN as printed on that invoice. Snapshot, for the same reason as client_name and account_no beside it.';

notify pgrst, 'reload schema';

commit;
