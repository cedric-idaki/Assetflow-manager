-- Sacco registration now captures an optional SASRA licence number alongside
-- the registration/certificate number. Apply manually like the other sacco
-- migrations.
ALTER TABLE public.saccos
  ADD COLUMN IF NOT EXISTS sasra_licence_no TEXT;
