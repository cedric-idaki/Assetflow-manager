-- ===========================================================================
-- POS RECEIPT REPRINT -- PERSIST WHAT THE RECEIPT SAID
--
-- WHY THIS EXISTS
--
-- A customer who loses their receipt has, until now, no way to get another
-- one. The POS prints a receipt at the moment of sale and the document exists
-- only while that modal is open; close it and the receipt is gone. The sale is
-- still on record -- public.sales carries every figure -- but two of the things
-- PRINTED ON THE RECEIPT were never stored, so nothing could reproduce it:
--
--   receipt_number  Generated client-side by genReceiptNo() in src/hooks/usePOS.js
--                   and used only for display. It reached the database at most
--                   as payments.reference_number, and only when the sale had no
--                   M-Pesa or bank reference to put there instead -- so for the
--                   common case (an M-Pesa sale) it was discarded outright.
--
--                   A receipt number is the customer's handle on the
--                   transaction. Reissuing a receipt under a NEW number would
--                   put two different numbers against one payment, which is
--                   exactly the confusion a receipt number exists to prevent.
--
--   vat_percent     sales.vat_amount is stored; the RATE it was computed at is
--                   not. Deriving it back out of the amount is arithmetic on a
--                   rounded figure, and the regime table (src/config/
--                   taxRegulations.js, migration 20260902120000) means the rate
--                   in force moves over time. A tax receipt has to state the
--                   rate its own figures were charged at, so that rate is now
--                   recorded on the sale rather than inferred at print time.
--
-- BOTH COLUMNS ARE NULLABLE, AND THE READER FALLS BACK
--
--   Sales already on record cannot be given a receipt number retroactively --
--   the number they were issued under is not recoverable from anything stored,
--   and inventing one would be worse than having none. So a reprint of a
--   legacy sale prints its INVOICE number as the document reference and omits
--   the receipt line, rather than asserting a number that was never issued.
--   vat_percent falls back to the rate in force on sale_date, which is what the
--   sale was computed with. See reprintArgsFromSale() in
--   src/utils/posReceiptDocument.js.
--
-- NO UNIQUE INDEX ON receipt_number, DELIBERATELY
--
--   genReceiptNo() builds the number from the last six digits of Date.now(),
--   which is a counter that wraps every 16m40s -- two sales that land the same
--   millisecond within any 16-minute cycle receive the SAME number. A unique
--   index would turn that collision into a failed sale at the till, which is a
--   far worse outcome than a repeated number on a document. The reprint keys
--   off sales.id and is unaffected either way. The generator is worth fixing on
--   its own terms; this migration deliberately does not smuggle that in.
--
-- Additive and idempotent: two nullable columns and one index. No policy
-- changes -- the columns inherit whatever RLS public.sales already enforces.
-- ===========================================================================

begin;

alter table public.sales
  add column if not exists receipt_number text,
  add column if not exists vat_percent    numeric(6,3);

comment on column public.sales.receipt_number is
  'Receipt number printed at the till. Null on sales recorded before reprinting existed; a reprint then falls back to invoice_number.';
comment on column public.sales.vat_percent is
  'VAT rate the sale was charged at, as a percentage. Null on older rows; a reprint then resolves the rate in force on sale_date.';

-- The reprint screen reads one tenant's sales newest-first, a page at a time.
-- Without this the count and the range both fall back to a sequential scan of
-- every sale on the platform.
create index if not exists sales_admin_sale_date_idx
  on public.sales (admin_id, sale_date desc);

-- Looking a receipt up by the number on the customer's paper.
create index if not exists sales_receipt_number_idx
  on public.sales (receipt_number)
  where receipt_number is not null;

commit;
