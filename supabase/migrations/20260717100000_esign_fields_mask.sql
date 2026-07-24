-- Migration: esign_fields.mask — paint over the source text under a field.
--
-- The SignNow-style auto-detector places fields on top of {{anchor tags}} and
-- checkbox glyphs embedded in the document text. Those characters must not
-- show through in the final sealed PDF, so fields created from them carry
-- mask=true and the burn step draws a white rectangle over the field box
-- before drawing the field's content. Idempotent — safe to re-run.

alter table public.esign_fields add column if not exists mask boolean default false;

notify pgrst, 'reload schema';
