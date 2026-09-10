-- ===========================================================================
-- OPPORTUNITIES: PUT MONEY IN THE PIPELINE
--
-- THE GAP
--
-- The agent portal could say WHERE a deal was (leads.stage), WHEN it would next
-- be touched (follow_ups), WHAT had been said (crm_interactions) and WHY it
-- died (leads.lost_reason). It could not say WHAT IT WAS WORTH.
--
-- The only money-shaped column on a lead was `budget_range`, and it is free
-- text: an agent types "2,000,000 - 5,000,000", or "under 500k", or "5M", or
-- leaves it blank. That is fine as a note and useless as a number — it cannot
-- be summed, sorted, forecast or compared. So the two questions every sales
-- person is actually asked had no answer anywhere in this system:
--
--     "How much is in your pipeline?"
--     "What is going to close this month?"
--
-- An agent working a KES 12M deal and an agent working forty KES 200k deals
-- had identical dashboards. Commission is paid on sales value, and the portal
-- could not show the value of the work in progress that produces it.
--
-- WHAT THIS ADDS
--
--   deal_value          what this deal is worth if it lands
--   expected_close_date when the agent thinks it lands
--   win_probability     an override on the stage's default odds
--
-- Together those are an opportunity. `useCrmOversight` has been deriving the
-- WORD from the stage column ("qualified or proposal out") since 20260820120000
-- precisely because there was nothing else to derive it from; that stays true —
-- the stage is still what makes a lead an opportunity — but now it has a size.
--
-- WHY NO BACKFILL FROM budget_range
--
-- It is tempting: most leads have one, and a regex could take the first number.
-- It is also fabrication. "under 500k" is a CEILING, "2,000,000 - 5,000,000" is
-- a RANGE the agent never committed to, and both would land in the database as
-- a flat figure indistinguishable from one an agent actually typed — then get
-- summed into a forecast, quoted in a review, and compared against commission.
-- Money nobody stated must not appear as money somebody stated.
--
-- So the columns start NULL and the FRONTEND does the reading instead: it
-- parses budget_range, shows the result as a clearly-labelled ESTIMATE, and
-- offers it as a one-click suggestion the agent confirms into deal_value.
-- The pipeline figure is useful on day one and the two kinds of number are
-- never mixed up. See src/utils/pipelineValue.js.
--
-- WHY win_probability IS NULLABLE AND NOT DEFAULTED
--
-- NULL means "use the stage's odds", which is the right answer for almost every
-- deal and the only honest one for a lead nobody has assessed. A stored default
-- would make every untouched lead look deliberately assessed at 40%, and the
-- day the stage weights are retuned, every one of those rows would silently
-- keep the old number. The default belongs in one list
-- (src/config/crmVocabulary.js), not copied across every row.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------------

alter table public.leads add column if not exists deal_value          numeric(14,2);
alter table public.leads add column if not exists expected_close_date date;
alter table public.leads add column if not exists win_probability     smallint;

comment on column public.leads.deal_value is
  'What this deal is worth if it lands, in KES. NULL means nobody has said — never inferred from budget_range, which is free text and often a range or a ceiling. The frontend offers a parsed suggestion the agent confirms.';
comment on column public.leads.expected_close_date is
  'When the agent expects it to land. Drives the "closing this month" list and flags deals whose date has passed while they sat open.';
comment on column public.leads.win_probability is
  'Per-deal odds, 0-100, overriding the stage default. NULL means use the stage — see PIPELINE_STAGES in src/config/crmVocabulary.js.';

-- Guardrails, not business rules. A negative deal value or 150% odds is a typo
-- or a bad write, and either one poisons a forecast that gets read as fact.
alter table public.leads drop constraint if exists leads_deal_value_check;
alter table public.leads add constraint leads_deal_value_check
  check (deal_value is null or deal_value >= 0);

alter table public.leads drop constraint if exists leads_win_probability_check;
alter table public.leads add constraint leads_win_probability_check
  check (win_probability is null or win_probability between 0 and 100);

-- ---------------------------------------------------------------------------
-- 2. INDEXES
--
--    Two different questions, two different orders.
--
--    The forecast reads the OPEN book by date ("what closes this month"), so it
--    is partial on stage <> 'closed' — on a healthy pipeline the closed rows
--    are the majority of the table and none of them belong in a forecast.
--
--    The value list reads the open book by size ("what are my biggest deals"),
--    and skips rows with no value because those are shown as a separate
--    "needs a value" nag, never sorted among the priced ones.
-- ---------------------------------------------------------------------------

create index if not exists idx_leads_agent_expected_close
  on public.leads (agent_id, expected_close_date)
  where stage <> 'closed'::public.lead_stage;

create index if not exists idx_leads_agent_deal_value
  on public.leads (agent_id, deal_value desc)
  where deal_value is not null and stage <> 'closed'::public.lead_stage;

-- ---------------------------------------------------------------------------
-- 3. NOTHING TO CLEAR ON LOSS OR CONVERSION
--
--    Worth stating, because trg_leads_stamp_lost (20260828140000) wipes the
--    whole lost_* set when a lead stops being lost, and the obvious next
--    thought is that deal_value needs the same treatment. It does not, and
--    must not.
--
--    lost_reason describes a STATE that stopped being true. deal_value
--    describes the DEAL, and the deal was worth what it was worth whether it
--    was won, lost or is still open — that is the whole point of being able to
--    ask "how much did we lose on price this quarter". Clearing it on close
--    would empty out won-value and lost-value reporting the moment either
--    became answerable.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

commit;
