-- ============================================================================
-- SACCO MEMBER SELF-SERVICE PORTAL (BRS v3.0 Section 5)
-- ============================================================================
-- A sacco_admin creates a login for a sacco_members row. The member signs in
-- with the new 'sacco_member' user_role (added in 20260708120000) and lands on
-- /sacco-member-portal where they can:
--   • see their own contributions, loans + amortization schedules, shares
--   • trade shares on the internal marketplace (list / buy, admin settles)
--   • propose, second and vote on motions (visible + secret ballots)
--   • read the governance document library and their assigned contracts
--   • download statements and manage their own contact / next-of-kin details
--
-- Everything here is ADDITIVE RLS: the existing tenant_manage_* policies from
-- 20260701140000 keep working for the sacco_admin; members get narrow
-- own-data policies. Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LOGIN LINK COLUMN
-- ----------------------------------------------------------------------------
ALTER TABLE public.sacco_members ADD COLUMN IF NOT EXISTS user_id UUID;

-- One auth account maps to at most one member row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sacco_members_user_id
  ON public.sacco_members(user_id) WHERE user_id IS NOT NULL;

-- Members can be named on a contract (loan agreement etc.); this is what the
-- member portal's Contracts tab reads. Nullable — company contracts keep
-- using client_id.
ALTER TABLE public.company_contracts ADD COLUMN IF NOT EXISTS member_id UUID
  REFERENCES public.sacco_members(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- CRITICAL: is_staff_member() gates the broad tenant_manage_* policies. It was
-- "any role except client"; sacco_member must ALSO be excluded, otherwise a
-- member whose user_profiles.admin_id points at the sacco admin would inherit
-- full manage rights over every tenant table (members, loans, clients, …).
CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role NOT IN ('client'::public.user_role, 'sacco_member'::public.user_role)
  );
$$;

-- The sacco_members.id of the logged-in member (NULL for non-members).
-- SECURITY DEFINER so it can read sacco_members without tripping RLS.
CREATE OR REPLACE FUNCTION public.current_sacco_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sm.id FROM public.sacco_members sm
  WHERE sm.user_id = auth.uid()
  LIMIT 1;
$$;

-- The sacco the logged-in member belongs to (NULL for non-members).
CREATE OR REPLACE FUNCTION public.current_member_sacco_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sm.sacco_id FROM public.sacco_members sm
  WHERE sm.user_id = auth.uid()
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 3. SELF-UPDATE COLUMN PROTECTION
--    Members may edit their own contact / next-of-kin details (BRS FR1.2) but
--    must never change privileged fields. RLS is row-level only, so a trigger
--    pins the protected columns whenever the updater is the member themself.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_member_protect_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.user_id = auth.uid()
     AND NOT public.is_staff_member() THEN
    NEW.member_no   := OLD.member_no;
    NEW.member_role := OLD.member_role;
    NEW.status      := OLD.status;
    NEW.kyc_status  := OLD.kyc_status;
    NEW.sacco_id    := OLD.sacco_id;
    NEW.admin_id    := OLD.admin_id;
    NEW.user_id     := OLD.user_id;
    NEW.joined_at   := OLD.joined_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_sacco_member_columns ON public.sacco_members;
CREATE TRIGGER protect_sacco_member_columns
  BEFORE UPDATE ON public.sacco_members
  FOR EACH ROW EXECUTE FUNCTION public.sacco_member_protect_columns();

-- ----------------------------------------------------------------------------
-- 4. MEMBER RLS POLICIES (additive to tenant_manage_*)
-- ----------------------------------------------------------------------------

-- Own sacco record (name, tier — shown in the portal header).
DROP POLICY IF EXISTS "member_read_sacco" ON public.saccos;
CREATE POLICY "member_read_sacco" ON public.saccos
  FOR SELECT TO authenticated
  USING (id = public.current_member_sacco_id());

-- Fellow members: names are needed for the marketplace (seller), voting
-- (proposer/seconder, visible ballots) and governance displays.
DROP POLICY IF EXISTS "member_read_members" ON public.sacco_members;
CREATE POLICY "member_read_members" ON public.sacco_members
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Own profile self-service (columns pinned by the trigger above).
DROP POLICY IF EXISTS "member_update_own_profile" ON public.sacco_members;
CREATE POLICY "member_update_own_profile" ON public.sacco_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Own contributions ledger.
DROP POLICY IF EXISTS "member_read_contributions" ON public.sacco_contributions;
CREATE POLICY "member_read_contributions" ON public.sacco_contributions
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

-- Loan products (needed for the apply form + repayment preview).
DROP POLICY IF EXISTS "member_read_loan_products" ON public.sacco_loan_products;
CREATE POLICY "member_read_loan_products" ON public.sacco_loan_products
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Own loans: read + apply. Applications are always 'pending' — approval /
-- disbursement stays with the sacco_admin (multi-stage workflow, FR3.2).
DROP POLICY IF EXISTS "member_read_own_loans" ON public.sacco_loans;
CREATE POLICY "member_read_own_loans" ON public.sacco_loans
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

DROP POLICY IF EXISTS "member_apply_loan" ON public.sacco_loans;
CREATE POLICY "member_apply_loan" ON public.sacco_loans
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.current_sacco_member_id()
    AND sacco_id = public.current_member_sacco_id()
    AND status = 'pending'
  );

-- Own amortization schedules.
DROP POLICY IF EXISTS "member_read_own_schedule" ON public.sacco_loan_schedule;
CREATE POLICY "member_read_own_schedule" ON public.sacco_loan_schedule
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sacco_loans l
    WHERE l.id = loan_id AND l.member_id = public.current_sacco_member_id()
  ));

-- Own share holdings.
DROP POLICY IF EXISTS "member_read_own_shares" ON public.sacco_shares;
CREATE POLICY "member_read_own_shares" ON public.sacco_shares
  FOR SELECT TO authenticated
  USING (member_id = public.current_sacco_member_id());

-- Marketplace: every member sees all listings in their sacco (BRS 5.3.2 step 2).
DROP POLICY IF EXISTS "member_read_listings" ON public.sacco_share_listings;
CREATE POLICY "member_read_listings" ON public.sacco_share_listings
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Sellers list their own shares.
DROP POLICY IF EXISTS "member_create_listing" ON public.sacco_share_listings;
CREATE POLICY "member_create_listing" ON public.sacco_share_listings
  FOR INSERT TO authenticated
  WITH CHECK (
    seller_member_id = public.current_sacco_member_id()
    AND sacco_id = public.current_member_sacco_id()
  );

-- Open listings may move to pending_approval (buyer interest) or cancelled
-- (seller withdraws). Settlement stays admin-only via tenant_manage.
DROP POLICY IF EXISTS "member_update_open_listing" ON public.sacco_share_listings;
CREATE POLICY "member_update_open_listing" ON public.sacco_share_listings
  FOR UPDATE TO authenticated
  USING (sacco_id = public.current_member_sacco_id() AND status = 'open')
  WITH CHECK (
    sacco_id = public.current_member_sacco_id()
    AND status IN ('pending_approval', 'cancelled')
  );

-- Transfers: parties see their own; buyers create pending requests
-- (funds/settlement handled on admin approval — BRS 5.3.2 steps 3-5).
DROP POLICY IF EXISTS "member_read_own_transfers" ON public.sacco_share_transfers;
CREATE POLICY "member_read_own_transfers" ON public.sacco_share_transfers
  FOR SELECT TO authenticated
  USING (
    seller_member_id = public.current_sacco_member_id()
    OR buyer_member_id = public.current_sacco_member_id()
  );

DROP POLICY IF EXISTS "member_request_transfer" ON public.sacco_share_transfers;
CREATE POLICY "member_request_transfer" ON public.sacco_share_transfers
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_member_id = public.current_sacco_member_id()
    AND sacco_id = public.current_member_sacco_id()
    AND status = 'pending'
  );

-- Motions: all members read; any member proposes (BRS 6.1 stage 1-2); a
-- DIFFERENT member seconds (stage 3). Opening/closing stays with the admin.
DROP POLICY IF EXISTS "member_read_motions" ON public.sacco_motions;
CREATE POLICY "member_read_motions" ON public.sacco_motions
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

DROP POLICY IF EXISTS "member_propose_motion" ON public.sacco_motions;
CREATE POLICY "member_propose_motion" ON public.sacco_motions
  FOR INSERT TO authenticated
  WITH CHECK (
    sacco_id = public.current_member_sacco_id()
    AND proposer_id = public.current_sacco_member_id()
    AND status IN ('draft', 'proposed')
  );

DROP POLICY IF EXISTS "member_second_motion" ON public.sacco_motions;
CREATE POLICY "member_second_motion" ON public.sacco_motions
  FOR UPDATE TO authenticated
  USING (sacco_id = public.current_member_sacco_id() AND status = 'proposed')
  WITH CHECK (
    sacco_id = public.current_member_sacco_id()
    AND status = 'seconded'
    AND seconder_id = public.current_sacco_member_id()
    AND seconder_id IS DISTINCT FROM proposer_id
  );

-- Votes: cast/change own vote while the motion is open. Reading: own vote
-- always; other members' votes only on VISIBLE ballots (VT1.4). Secret ballot
-- totals come from the sacco_motion_results() RPC below (VT1.5).
DROP POLICY IF EXISTS "member_read_votes" ON public.sacco_votes;
CREATE POLICY "member_read_votes" ON public.sacco_votes
  FOR SELECT TO authenticated
  USING (
    member_id = public.current_sacco_member_id()
    OR EXISTS (
      SELECT 1 FROM public.sacco_motions m
      WHERE m.id = motion_id
        AND m.sacco_id = public.current_member_sacco_id()
        AND m.ballot_type = 'visible'
    )
  );

DROP POLICY IF EXISTS "member_cast_vote" ON public.sacco_votes;
CREATE POLICY "member_cast_vote" ON public.sacco_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = public.current_sacco_member_id()
    AND EXISTS (
      SELECT 1 FROM public.sacco_motions m
      WHERE m.id = motion_id
        AND m.sacco_id = public.current_member_sacco_id()
        AND m.status = 'open'
    )
  );

DROP POLICY IF EXISTS "member_change_vote" ON public.sacco_votes;
CREATE POLICY "member_change_vote" ON public.sacco_votes
  FOR UPDATE TO authenticated
  USING (
    member_id = public.current_sacco_member_id()
    AND EXISTS (
      SELECT 1 FROM public.sacco_motions m
      WHERE m.id = motion_id AND m.status = 'open'
    )
  )
  WITH CHECK (member_id = public.current_sacco_member_id());

-- Governance library: constitution, bylaws, policies, minutes (BRS 5.5).
DROP POLICY IF EXISTS "member_read_documents" ON public.sacco_documents;
CREATE POLICY "member_read_documents" ON public.sacco_documents
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

-- Contracts assigned to the member (loan agreements etc.).
DROP POLICY IF EXISTS "member_read_own_contracts" ON public.company_contracts;
CREATE POLICY "member_read_own_contracts" ON public.company_contracts
  FOR SELECT TO authenticated
  USING (
    member_id IS NOT NULL
    AND member_id = public.current_sacco_member_id()
  );

-- ----------------------------------------------------------------------------
-- 5. SECRET BALLOT RESULTS RPC
--    Members must see aggregate totals of secret ballots without any path to
--    individual votes. SECURITY DEFINER bypasses the vote RLS; access is
--    guarded to the member's own sacco (or tenant staff / global viewers).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sacco_motion_results(p_motion_id uuid)
RETURNS TABLE (yes_count int, no_count int, abstain_count int, total_votes int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*) FILTER (WHERE v.choice = 'yes')::int,
    COUNT(*) FILTER (WHERE v.choice = 'no')::int,
    COUNT(*) FILTER (WHERE v.choice = 'abstain')::int,
    COUNT(*)::int
  FROM public.sacco_votes v
  JOIN public.sacco_motions m ON m.id = v.motion_id
  WHERE v.motion_id = p_motion_id
    AND (
      m.sacco_id = public.current_member_sacco_id()
      OR (m.admin_id = public.current_admin_id() AND public.is_staff_member())
      OR public.is_global_viewer()
    );
$$;

GRANT EXECUTE ON FUNCTION public.sacco_motion_results(uuid) TO authenticated;
