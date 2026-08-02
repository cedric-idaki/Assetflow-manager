-- ============================================================================
-- Company Finance Hub — make the journal actually postable.
--
-- The Manual Entries tab has always offered "Depreciation", "Accrual" and
-- "Closing Entry" as entry types, but journal_entries.entry_type only allowed
-- general/expense/revenue/adjustment — so picking any of those three made the
-- insert fail with a check-constraint error and the entry was never created.
--
-- This migration:
--   1. widens entry_type to the set the UI offers,
--   2. adds a 'reversal' status so a reversing entry is distinguishable from
--      the original it cancels (both are excluded from the statement maths),
--   3. gives staff UPDATE rights, without which flipping an original entry to
--      'reversed' silently affected zero rows for every non-admin accountant,
--   4. closes the portal read/write drift on this table — the previous staff
--      policies used `admin_id IN (SELECT admin_id FROM user_profiles ...)`,
--      which matches clients too (they carry admin_id as well), exposing the
--      whole accounting ledger to any logged-in client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. entry_type — allow the types the Finance Hub UI has always listed.
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_entry_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'general', 'expense', 'revenue', 'adjustment',
    'depreciation', 'accrual', 'closing'
  ]));

-- ----------------------------------------------------------------------------
-- 2. status — 'reversal' marks the mirrored entry posted to cancel another.
--    The original becomes 'reversed'. Neither counts towards the financial
--    statements, which only sum status = 'posted', so a reversal nets to zero.
-- ----------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_status_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_status_check
  CHECK (status = ANY (ARRAY['draft', 'posted', 'reversed', 'reversal']));

-- ----------------------------------------------------------------------------
-- 3. entry_no groups the lines of one multi-line entry. Look-ups are always
--    scoped to a tenant.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS journal_entries_admin_entry_no_idx
  ON public.journal_entries (admin_id, entry_no);

-- ----------------------------------------------------------------------------
-- 4. Policies — staff of the tenant, not "anyone carrying the tenant's
--    admin_id" (which includes clients).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff sees admin journal entries" ON public.journal_entries;
CREATE POLICY "Staff sees admin journal entries"
ON public.journal_entries FOR SELECT
USING (admin_id = public.current_admin_id() AND public.is_staff_member());

DROP POLICY IF EXISTS "Staff can insert journal entries" ON public.journal_entries;
CREATE POLICY "Staff can insert journal entries"
ON public.journal_entries FOR INSERT
WITH CHECK (admin_id = public.current_admin_id() AND public.is_staff_member());

-- Reversing an entry updates the original's status; without this the update
-- matched no rows for staff and the reversal looked like it worked while the
-- original stayed live in the ledger.
DROP POLICY IF EXISTS "Staff can reverse journal entries" ON public.journal_entries;
CREATE POLICY "Staff can reverse journal entries"
ON public.journal_entries FOR UPDATE
USING      (admin_id = public.current_admin_id() AND public.is_staff_member())
WITH CHECK (admin_id = public.current_admin_id() AND public.is_staff_member());
