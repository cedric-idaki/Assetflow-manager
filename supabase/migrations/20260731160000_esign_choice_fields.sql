-- ═══════════════════════════════════════════════════════════════════════════════
-- Choice fields: radio groups and dropdowns
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- The field palette was signature | initials | date | text | checkbox. A checkbox
-- can express "tick to agree" but not "pick exactly one of these", which is what
-- most real contracts need — payment terms, title, tenancy type, consent choices.
-- Modelling that as several independent checkboxes lets a signer tick two
-- mutually exclusive answers, so it needs its own type.
--
-- Both new types are single fields carrying their own choice list rather than a
-- cluster of separately placed boxes: one placement, one stored value, and
-- "exactly one" is enforced by construction instead of by validation. `options`
-- holds an ordered array of labels, e.g. ["Monthly","Quarterly","Annually"], and
-- the stored value is the chosen label.
--
-- Existing rows get an empty array, which the renderers treat the same as a
-- field with no choices — nothing about the current five types changes.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.esign_fields
  add column if not exists options jsonb not null default '[]'::jsonb;

alter table public.esign_template_fields
  add column if not exists options jsonb not null default '[]'::jsonb;

-- Guard the value space at the database rather than trusting each writer: the
-- editor, the template materialiser, the public signing function and the REST
-- API all insert into esign_fields, and a typo'd field_type in any one of them
-- would otherwise surface as a silently unrendered box in a signed contract.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'esign_fields_field_type_check'
  ) then
    alter table public.esign_fields
      add constraint esign_fields_field_type_check
      check (field_type in ('signature','initials','date','text','checkbox','radio','dropdown'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'esign_template_fields_field_type_check'
  ) then
    alter table public.esign_template_fields
      add constraint esign_template_fields_field_type_check
      check (field_type in ('signature','initials','date','text','checkbox','radio','dropdown'));
  end if;
end $$;

notify pgrst, 'reload schema';
