-- FeedTheAnimalsMap: city/country auto-detect for reports
-- Run once in Supabase Dashboard > SQL Editor > New Query > Run.
-- Safe to re-run (uses IF NOT EXISTS).
--
-- Why: the report form captures exact lat/lng but no city. These columns
-- store the reverse-geocoded city + country so index.html#cities can group
-- reports without asking the volunteer to type anything.

alter table reports add column if not exists city text;
alter table reports add column if not exists country text;
alter table reports add column if not exists city_slug text;

-- Speed up the Cities grouping: filter + order by city_slug.
create index if not exists reports_city_slug_idx on reports (city_slug);
