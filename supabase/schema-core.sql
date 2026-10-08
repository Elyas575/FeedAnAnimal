-- FeedTheAnimalsMap CORE schema
-- Paste into Supabase Dashboard > SQL Editor > New Query > Run
-- Safe to re-run (uses IF NOT EXISTS)

-- 1. Profiles (1 row per auth user)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- 2. Animals (seeded from data/animals.json, 48 rows)
create table if not exists animals (
  id text primary key,
  name text not null,
  species text not null,
  sex text,
  age_class text,
  color text,
  description text,
  temperament text default 'unknown',
  health text default 'healthy' check (health in ('healthy','monitor','treatment','critical')),
  sterilized boolean default false,
  vaccinated boolean default false,
  microchipped boolean default false,
  caretakers text[] default '{}',
  tags text[] default '{}',
  notes text,
  photo_url text,
  station_id text,
  lat double precision not null,
  lng double precision not null,
  location_label text,
  location_area text,
  feed_count int default 0,
  water_count int default 0,
  last_fed_at timestamptz,
  last_watered_at timestamptz,
  reported_at timestamptz,
  created_at timestamptz default now()
);

-- 3. Stations (6 rows)
create table if not exists stations (
  id text primary key,
  name text not null,
  ref text,
  type text,
  status text,
  capacity_pct int default 50,
  caretaker text,
  notes text,
  lat double precision not null,
  lng double precision not null,
  location_label text,
  location_area text,
  last_serviced_at timestamptz default now()
);

-- 4. Events = replaces localStorage log (feed/water/check/vet/report)
--
--    animal_id and station_id are PLAIN text, deliberately not foreign keys.
--    They were originally `references animals(id)`, but the animals table is
--    intentionally empty now (see cleanup-seed-data.sql) because the map grows
--    from real community reports instead of the 48 seeded animals. With the FK
--    in place every shared write was rejected by Postgres - the feed looked
--    like it worked (localStorage first) but never reached the database, and
--    Phase 5 chat could find no caretaker at all.
--    Run supabase/migration-drop-events-fk.sql if you are upgrading an
--    existing database that still has the constraint.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  animal_id text,
  station_id text,
  kind text not null check (kind in ('feed','water','check','vet','report','rescue','medicine','station')),
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  note text,
  place text,
  created_at timestamptz default now()
);

-- 4b. Avatar columns (safe to re-run: only added when missing).
-- events.actor_avatar snapshots the volunteer's photo at the moment they fed,
-- so the ticker can still show a face if they later change their profile pic.
alter table events add column if not exists actor_avatar text;
alter table profiles add column if not exists avatar_url text;

-- 5. Reports = + Report a Stray form
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles(id) on delete set null,
  name text,
  species text,
  lat double precision,
  lng double precision,
  location_label text,
  photo_url text,
  description text,
  status text default 'open' check (status in ('open','verified','closed')),
  created_at timestamptz default now()
);

-- Enable RLS
alter table profiles enable row level security;
alter table animals enable row level security;
alter table stations enable row level security;
alter table events enable row level security;
alter table reports enable row level security;

-- Policies: drop if re-running, then create
drop policy if exists "public read animals" on animals;
create policy "public read animals" on animals for select using (true);

drop policy if exists "public read stations" on stations;
create policy "public read stations" on stations for select using (true);

drop policy if exists "public read events" on events;
create policy "public read events" on events for select using (true);

drop policy if exists "auth insert events" on events;
create policy "auth insert events" on events for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "public read open reports" on reports;
create policy "public read open reports" on reports for select using (true);

drop policy if exists "auth insert reports" on reports;
create policy "auth insert reports" on reports for insert
  with check (auth.role() = 'authenticated');

-- Editing a report: ONLY the volunteer who filed it (reporter_id) may change
-- it. index.js hides the Edit button for everyone else (canManageReport) and
-- this policy is the database-side enforcement - sbUpdateReport() writes
-- through it. Without it every shared edit is rejected by RLS and the
-- correction silently lives on one device. Same shape as the other owner
-- policies in this file. Also shipped as supabase/migration-report-edit.sql
-- for databases created before this block existed.
drop policy if exists "reporter update reports" on reports;
create policy "reporter update reports" on reports for update
  using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

drop policy if exists "public read profiles" on profiles;
create policy "public read profiles" on profiles for select using (true);

drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "users insert own profile" on profiles;
create policy "users insert own profile" on profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Trigger: keep animals.last_fed_at in sync when feed event arrives
create or replace function public.touch_animal_on_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.animal_id is null then return new; end if;
  if new.kind = 'feed' then
    update animals set last_fed_at = new.created_at, feed_count = feed_count + 1 where id = new.animal_id;
  elsif new.kind = 'water' then
    update animals set last_watered_at = new.created_at, water_count = water_count + 1 where id = new.animal_id;
  end if;
  return new;
end; $$;

drop trigger if exists on_event_touch_animal on events;
create trigger on_event_touch_animal
  after insert on events for each row execute function public.touch_animal_on_event();
