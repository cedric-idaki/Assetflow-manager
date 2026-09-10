-- ===========================================================================
-- WHY WE LOSE: lost_reason on public.leads
--
-- THE GAP
--
-- "Lost" was never recorded — it was INFERRED: stage = 'closed' AND
-- converted_at IS NULL. That is enough to COUNT losses and useless for
-- DIAGNOSING them. An admin could see "11 lost" and had no way on earth to find
-- out whether the team is losing on price, on financing, or because there was
-- never anything in stock to sell. Three completely different problems, three
-- completely different responses, one indistinguishable number.
--
-- WHY A CONSTRAINED VOCABULARY AND NOT FREE TEXT
--
-- The entire question is an aggregation. Free text cannot be aggregated: one
-- agent writes "too pricey", the next "expensive", the third "cost" and the
-- report has three rows where it should have one. leads.notes already exists
-- for the story; this column exists to be COUNTED. Same reasoning that put a
-- CHECK constraint on crm_interactions.outcome.
--
-- The vocabulary is deliberately ACTIONABLE — each value implies a different
-- response. 'price' means re-look at the offer, 'financing' means the lender
-- step is the bottleneck, 'no_stock' means the problem is inventory and not the
-- agent at all. A taxonomy that cannot change what anybody does is just a
-- tidier way of recording failure.
--
-- Mirrored in src/config/crmVocabulary.js. Adding a value means adding it in
-- BOTH places, or the UI offers something the database rejects.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------------

alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists lost_notes  text;
alter table public.leads add column if not exists lost_at     timestamptz;

comment on column public.leads.lost_reason is
  'Controlled vocabulary — the loss report aggregates on it. NULL means nobody said. See src/config/crmVocabulary.js.';
comment on column public.leads.lost_notes is
  'The free-text half. Says what actually happened; never counted, only read.';
comment on column public.leads.lost_at is
  'Stamped by trg_leads_stamp_lost when a lead first becomes lost, and cleared if it is later revived or converted.';

-- Kept in step with src/config/crmVocabulary.js LOST_REASONS.
alter table public.leads drop constraint if exists leads_lost_reason_check;
alter table public.leads add constraint leads_lost_reason_check
  check (lost_reason is null or lost_reason in (
    'price', 'financing', 'competitor', 'no_response', 'not_ready',
    'no_stock', 'unqualified', 'changed_mind', 'other'
  ));

-- Partial: the loss report only ever reads rows that HAVE a reason, and on a
-- healthy pipeline those are a small minority of the table.
create index if not exists idx_leads_lost_reason
  on public.leads (agent_id, lost_reason) where lost_reason is not null;

-- ---------------------------------------------------------------------------
-- 2. STAMP / UNSTAMP lost_at
--
--    A lead is lost when it reached 'closed' WITHOUT converting. Stage alone
--    cannot say it: 'closed' is where winners and losers both come to rest, and
--    converted_at is the only thing separating them.
--
--    The un-stamping half matters as much as the stamping half. A lead that is
--    revived (dragged back to an open stage) or that later converts is NO
--    LONGER LOST, and leaving lost_at and lost_reason behind would leave it
--    counted in the loss report forever — a permanent phantom failure that also
--    double-counts against the win it became.
-- ---------------------------------------------------------------------------

create or replace function public.leads_stamp_lost()
returns trigger
language plpgsql
as $$
declare
  is_lost boolean;
begin
  is_lost := (new.stage = 'closed'::public.lead_stage) and (new.converted_at is null);

  if is_lost then
    -- First time only: re-closing a lead that was already lost must not move
    -- the date forward and rewrite when the loss actually happened.
    if new.lost_at is null then
      new.lost_at := now();
    end if;
  else
    -- No longer lost. Clear the whole set together so a half-cleared row cannot
    -- show up in the report with a reason but no date, or vice versa.
    new.lost_at     := null;
    new.lost_reason := null;
    new.lost_notes  := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leads_stamp_lost on public.leads;
create trigger trg_leads_stamp_lost
  before insert or update on public.leads
  for each row execute function public.leads_stamp_lost();

comment on function public.leads_stamp_lost() is
  'Maintains leads.lost_at, and clears the lost_* set when a lead stops being lost. A revived or converted lead must not stay in the loss report.';

-- ---------------------------------------------------------------------------
-- 3. BACKFILL
--
--    Existing losses get their date from the best evidence available, so the
--    report is not blank for everything that happened before today. The REASON
--    stays NULL on purpose — nobody recorded it, and inventing one would be
--    fabricating the very data this migration exists to start collecting.
--    They show up as "Not recorded", which is the truth.
-- ---------------------------------------------------------------------------

update public.leads
   set lost_at = coalesce(updated_at, created_at, now())
 where stage = 'closed'::public.lead_stage
   and converted_at is null
   and lost_at is null;

notify pgrst, 'reload schema';

commit;
