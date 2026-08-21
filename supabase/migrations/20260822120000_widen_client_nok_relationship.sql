-- ===========================================================================
-- CLIENTS -- WIDEN THE NEXT-OF-KIN RELATIONSHIP VOCABULARY
--
-- What broke
-- ----------
-- `clients_nok_relationship_check` allowed five codes: parent, spouse, sibling,
-- child, other. The admin registration form drove the field from a <select>
-- built on exactly those, so it never noticed the ceiling. The sales agent
-- portal used a free-text box, so an agent typing "Cousin" or "Guardian" got
-- the raw Postgres error `new row for relation "clients" violates check
-- constraint "clients_nok_relationship_check"` and the client was never
-- created. The portal now posts codes instead of prose
-- (src/utils/nokRelationship.js), which stops the crash -- but it stops it by
-- flattening "Cousin" to 'other', which throws away a KYC answer the client
-- actually gave. This migration widens the column so the real answer fits.
--
-- Where the constraint came from
-- ------------------------------
-- Nowhere in this directory. `clients.nok_name` / `nok_phone` /
-- `nok_relationship` and their CHECK were added straight to the live project
-- through the dashboard and never written down --
-- 20260226133431_assetflow_schema.sql still shows the short original `clients`
-- table. That is why this file starts by creating the columns `if not exists`:
-- on the live database that is a no-op, and on a database rebuilt from this
-- directory alone it is the only thing that puts the columns there at all.
--
-- Why codes and not words
-- -----------------------
-- A constrained vocabulary is what makes next-of-kin data readable in
-- aggregate. Free text gives you "Wife", "wife", "WIFE", "Mrs" and "spouse " as
-- five different relationships and no way to count them. The list below is the
-- whole vocabulary, and src/utils/nokRelationship.js is its mirror on the
-- client -- the two must be changed together, or the picker offers something
-- the database rejects, which is the bug that started this.
--
-- Applying it
-- -----------
-- Do NOT `supabase db push` -- the migration history on this project is drifted
-- in both directions and a push would replay ~57 already-live migrations,
-- including ones that delete rows. Run this ONE file through the dashboard SQL
-- editor, then optionally
-- `supabase migration repair --status applied 20260822120000`.
-- ===========================================================================

-- ----------------------------------------------------------------------------
-- 1. The columns themselves -- present live, absent from this directory.
-- ----------------------------------------------------------------------------
alter table public.clients add column if not exists nok_name         text;
alter table public.clients add column if not exists nok_phone        text;
alter table public.clients add column if not exists nok_relationship text;

-- ----------------------------------------------------------------------------
-- 2. Fold any legacy value into the new vocabulary BEFORE re-adding the check.
--
-- `add constraint` validates every existing row, so a single row holding
-- 'Spouse' from before the constraint existed would abort the whole migration.
-- Rows already holding a valid code are untouched: the WHERE clause makes this
-- a no-op on a clean table rather than a rewrite of it. Anything unrecognisable
-- lands on 'other' -- that information was already unusable, and 'other' at
-- least puts it somewhere the constraint accepts.
-- ----------------------------------------------------------------------------
update public.clients
set nok_relationship = case lower(trim(nok_relationship))
    when ''                then null
    when 'father'          then 'parent'
    when 'mother'          then 'parent'
    when 'mum'             then 'parent'
    when 'mom'             then 'parent'
    when 'dad'             then 'parent'
    when 'husband'         then 'spouse'
    when 'wife'            then 'spouse'
    when 'partner'         then 'spouse'
    when 'brother'         then 'sibling'
    when 'sister'          then 'sibling'
    when 'son'             then 'child'
    when 'daughter'        then 'child'
    when 'grandfather'     then 'grandparent'
    when 'grandmother'     then 'grandparent'
    when 'grandpa'         then 'grandparent'
    when 'grandma'         then 'grandparent'
    when 'grandson'        then 'grandchild'
    when 'granddaughter'   then 'grandchild'
    when 'aunt'            then 'aunt_uncle'
    when 'auntie'          then 'aunt_uncle'
    when 'uncle'           then 'aunt_uncle'
    when 'niece'           then 'niece_nephew'
    when 'nephew'          then 'niece_nephew'
    when 'father-in-law'   then 'in_law'
    when 'mother-in-law'   then 'in_law'
    when 'brother-in-law'  then 'in_law'
    when 'sister-in-law'   then 'in_law'
    when 'son-in-law'      then 'in_law'
    when 'daughter-in-law' then 'in_law'
    -- A value already in the vocabulary but wrongly cased survives as itself.
    when 'parent'          then 'parent'
    when 'spouse'          then 'spouse'
    when 'sibling'         then 'sibling'
    when 'child'           then 'child'
    when 'grandparent'     then 'grandparent'
    when 'grandchild'      then 'grandchild'
    when 'aunt_uncle'      then 'aunt_uncle'
    when 'niece_nephew'    then 'niece_nephew'
    when 'cousin'          then 'cousin'
    when 'in_law'          then 'in_law'
    when 'guardian'        then 'guardian'
    when 'friend'          then 'friend'
    else 'other'
  end
where nok_relationship is not null
  and nok_relationship <> all (array[
    'parent', 'spouse', 'sibling', 'child',
    'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew',
    'cousin', 'in_law', 'guardian', 'friend', 'other'
  ]);

-- ----------------------------------------------------------------------------
-- 3. Drop the old check -- by whatever it is actually called.
--
-- The constraint was created by hand, so `clients_nok_relationship_check` is
-- the name the error message reported, not a name this repo chose. Match on
-- what a constraint DOES rather than on what it is called, so a hand-named
-- duplicate cannot survive underneath and keep rejecting the new codes.
-- ----------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.clients'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%nok_relationship%'
  loop
    execute format('alter table public.clients drop constraint %I', c.conname);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. The widened check.
--
-- NULL stays valid: next of kin is optional in the agent portal, and a CHECK
-- passes on NULL anyway -- spelling it out keeps the intent readable.
-- ----------------------------------------------------------------------------
alter table public.clients
  add constraint clients_nok_relationship_check
  check (nok_relationship is null or nok_relationship = any (array[
    'parent', 'spouse', 'sibling', 'child',
    'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew',
    'cousin', 'in_law', 'guardian', 'friend', 'other'
  ]));

comment on column public.clients.nok_relationship is
  'Next-of-kin relationship code. The vocabulary is fixed by clients_nok_relationship_check and mirrored in src/utils/nokRelationship.js - change both together.';
