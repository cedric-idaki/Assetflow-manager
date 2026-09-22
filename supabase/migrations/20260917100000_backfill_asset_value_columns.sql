begin;

-- Older deployments already had public.assets, so the original CREATE TABLE
-- migration could not add these columns when it was replayed against them.
alter table public.assets
  add column if not exists purchase_price decimal(15,2) default 0,
  add column if not exists selling_price  decimal(15,2) default 0,
  add column if not exists current_value   decimal(15,2) default 0;

commit;