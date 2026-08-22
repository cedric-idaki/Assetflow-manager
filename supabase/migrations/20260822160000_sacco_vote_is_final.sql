-- ============================================================================
-- MOTION VOTES ARE FINAL — ONE MEMBER, ONE BALLOT
-- ----------------------------------------------------------------------------
-- The member portal now walks a member through a confirmation step before the
-- ballot is sent ("you chose Yes — confirm?"), and the promise made there is
-- that the vote cannot be changed or withdrawn afterwards. Until now the DB
-- disagreed: "member_change_vote" (20260708130000, retightened in
-- 20260718091000) let a member UPDATE their own row for as long as the motion
-- stayed open, and the client used an upsert that silently rewrote the choice.
--
-- This migration makes the DB the authority on finality:
--   * the member UPDATE policy is dropped — members may INSERT their ballot and
--     read it back, nothing more;
--   * the UNIQUE (motion_id, member_id) pair is re-asserted, so a second
--     INSERT is refused with 23505 (the portal maps that to "you have already
--     voted on this motion") even if two devices race.
--
-- Members never had a DELETE policy, so a ballot cannot be withdrawn either.
-- The tenant's own "tenant_manage_sacco_votes" policy (FOR ALL, from
-- 20260701140000) is deliberately left alone: the sacco office still records
-- ballots on a member's behalf from the dashboard and needs to be able to fix
-- a mis-keyed entry. Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A member can no longer change a cast vote.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "member_change_vote" ON public.sacco_votes;

-- ----------------------------------------------------------------------------
-- 2. Belt and braces: guarantee the one-ballot-per-member uniqueness the
--    finality rule rests on, in case an environment drifted from the schema
--    migration that first declared it inline.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c   ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'sacco_votes'
      AND i.indisunique
      AND i.indnatts = 2
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
             FROM unnest(i.indkey::int[]) AS k(attnum)
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum)
          = ARRAY['member_id','motion_id']
  ) THEN
    -- Collapse any pre-existing duplicates to the first ballot cast, otherwise
    -- the index build fails on legacy data.
    DELETE FROM public.sacco_votes v
     WHERE EXISTS (
       SELECT 1 FROM public.sacco_votes w
        WHERE w.motion_id = v.motion_id
          AND w.member_id = v.member_id
          AND (w.created_at, w.id) < (v.created_at, v.id)
     );
    CREATE UNIQUE INDEX sacco_votes_motion_member_uniq
      ON public.sacco_votes (motion_id, member_id);
  END IF;
END $$;
