-- ═══════════════════════════════════════════════════════════════════════════════
-- Reusable e-signature templates + decline-to-sign
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- TEMPLATES
-- Until now every document had its fields placed by hand, because esign_fields
-- rows bind to a concrete signer_id — a layout could not outlive the one
-- document it was drawn on. A template stores the same geometry bound to a ROLE
-- INDEX instead ("Landlord" = 0, "Tenant" = 1). Sending from a template maps
-- real people onto those roles and materialises the stored geometry into normal
-- esign_fields rows against the new signer ids, so everything downstream — the
-- filler, the sealer, the audit trail — is unchanged and sees an ordinary
-- document.
--
-- The template references the PDF already in the esign-documents bucket rather
-- than copying it per send. Sealed output is always written to a separate
-- signed_<id>.pdf path, so the source object is only ever read.
--
-- DECLINE-TO-SIGN
-- esign_signers.status only ever held 'pending' | 'viewed' | 'signed', so a
-- signer who disagreed had no way to say so — they simply abandoned the link and
-- the document sat pending until it expired. Refusal is a real outcome and in
-- most compliance regimes it has to be recorded, with a reason and a timestamp.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. esign_templates ────────────────────────────────────────────────────────
create table if not exists public.esign_templates (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null,
  name          text not null,
  description   text,
  file_url      text not null,            -- source PDF in the esign-documents bucket
  file_type     text default 'PDF',
  -- Ordered role definitions: [{"index":0,"label":"Landlord"}, …]. The index is
  -- what esign_template_fields.role_index points at.
  roles         jsonb not null default '[]'::jsonb,
  signing_order text  not null default 'sequential',   -- sequential | parallel
  message       text,                                  -- default invite message
  use_count     integer not null default 0,
  last_used_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_esign_templates_admin on public.esign_templates(admin_id);

alter table public.esign_templates enable row level security;

drop policy if exists "staff_manage_esign_templates" on public.esign_templates;
create policy "staff_manage_esign_templates"
on public.esign_templates for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- ── 2. esign_template_fields ──────────────────────────────────────────────────
-- Mirrors esign_fields, except the owner is a role index rather than a signer.
-- Geometry stays normalized 0..1 of the page with a top-left origin, the same
-- convention the editor, filler and PDF burner already use.
create table if not exists public.esign_template_fields (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null,
  template_id  uuid not null references public.esign_templates(id) on delete cascade,
  role_index   integer not null default 0,
  field_type   text not null,
  page_index   integer not null default 0,
  pos_x        numeric not null default 0,
  pos_y        numeric not null default 0,
  width        numeric not null default 0.2,
  height       numeric not null default 0.05,
  required     boolean not null default true,
  mask         boolean not null default false,
  placeholder  text,
  created_at   timestamptz default now()
);

create index if not exists idx_esign_template_fields_tpl on public.esign_template_fields(template_id);

alter table public.esign_template_fields enable row level security;

drop policy if exists "staff_manage_esign_template_fields" on public.esign_template_fields;
create policy "staff_manage_esign_template_fields"
on public.esign_template_fields for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- ── 3. Decline-to-sign ────────────────────────────────────────────────────────
-- A signing request can hang off three different parent tables, so all three
-- need somewhere to record the refusal — otherwise declining an uploaded company
-- contract would be logged against the signer but leave the contract itself
-- looking like it were still out for signature.
alter table public.esign_signers        add column if not exists declined_at     timestamptz;
alter table public.esign_signers        add column if not exists decline_reason  text;
alter table public.esign_documents      add column if not exists declined_at     timestamptz;
alter table public.esign_documents      add column if not exists decline_reason  text;
alter table public.company_contracts    add column if not exists declined_at     timestamptz;
alter table public.company_contracts    add column if not exists decline_reason  text;
alter table public.generated_contracts  add column if not exists declined_at     timestamptz;
alter table public.generated_contracts  add column if not exists decline_reason  text;

-- ── 4. Bump use_count when a template is sent ─────────────────────────────────
-- Called by the app right after a document is created from a template. Runs as
-- definer so the counter cannot be skewed by a caller who can read the template
-- but should not rewrite arbitrary columns on it.
create or replace function public.esign_template_mark_used(p_template uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.esign_templates
     set use_count    = coalesce(use_count, 0) + 1,
         last_used_at = now(),
         updated_at   = now()
   where id = p_template
     and (admin_id = public.current_admin_id() or public.is_global_viewer());
end;
$$;

revoke all on function public.esign_template_mark_used(uuid) from public;
revoke all on function public.esign_template_mark_used(uuid) from anon;
grant execute on function public.esign_template_mark_used(uuid) to authenticated;
grant execute on function public.esign_template_mark_used(uuid) to service_role;

-- ── 5. Refresh PostgREST schema cache ─────────────────────────────────────────
notify pgrst, 'reload schema';
