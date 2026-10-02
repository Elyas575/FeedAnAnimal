-- FeedTheAnimalsMap STORAGE schema (animal photos for reports)
-- Paste into Supabase Dashboard > SQL Editor > New Query > Run AFTER schema-core.sql
-- Safe to re-run (uses upserts / IF NOT EXISTS / DROP IF EXISTS)
-- Creates public bucket `animal-photos`: 500KB limit, image/* only

-- 1. Create bucket (public read, 500KB limit ~ 5000 photos in 1GB free tier)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'animal-photos',
  'animal-photos',
  true,
  512000,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Policies on storage.objects (drop first so re-runs work)
drop policy if exists "public read animal-photos" on storage.objects;
create policy "public read animal-photos" on storage.objects
  for select using (bucket_id = 'animal-photos');

drop policy if exists "auth insert animal-photos" on storage.objects;
create policy "auth insert animal-photos" on storage.objects
  for insert with check (
    bucket_id = 'animal-photos'
    and auth.role() = 'authenticated'
  );

drop policy if exists "auth update animal-photos" on storage.objects;
create policy "auth update animal-photos" on storage.objects
  for update using (
    bucket_id = 'animal-photos'
    and auth.role() = 'authenticated'
  ) with check (bucket_id = 'animal-photos');

drop policy if exists "auth delete animal-photos" on storage.objects;
create policy "auth delete animal-photos" on storage.objects
  for delete using (
    bucket_id = 'animal-photos'
    and auth.role() = 'authenticated'
  );
