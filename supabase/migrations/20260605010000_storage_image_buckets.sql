-- Migration: Storage buckets + RLS for client photos and asset images
-- Creates two PUBLIC buckets and the policies that let authenticated staff upload,
-- replace and delete images while anyone can read them via the public URL.
-- Idempotent: safe to run multiple times.

-- ── Buckets ────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('client-photos', 'client-photos', true, 2097152,  array['image/jpeg','image/jpg','image/png','image/webp']),
  ('asset-images',  'asset-images',  true, 10485760, array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Policies on storage.objects ────────────────────────────────────────────────
-- (RLS is already enabled on storage.objects in Supabase by default.)

-- Public read
drop policy if exists "img_public_read" on storage.objects;
create policy "img_public_read"
on storage.objects for select
to public
using (bucket_id in ('client-photos', 'asset-images'));

-- Authenticated upload
drop policy if exists "img_authenticated_insert" on storage.objects;
create policy "img_authenticated_insert"
on storage.objects for insert
to authenticated
with check (bucket_id in ('client-photos', 'asset-images'));

-- Authenticated replace (needed for x-upsert)
drop policy if exists "img_authenticated_update" on storage.objects;
create policy "img_authenticated_update"
on storage.objects for update
to authenticated
using      (bucket_id in ('client-photos', 'asset-images'))
with check (bucket_id in ('client-photos', 'asset-images'));

-- Authenticated delete
drop policy if exists "img_authenticated_delete" on storage.objects;
create policy "img_authenticated_delete"
on storage.objects for delete
to authenticated
using (bucket_id in ('client-photos', 'asset-images'));
