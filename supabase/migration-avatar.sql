-- FeedTheAnimalsMap — avatar migration (safe to re-run)
-- Run this in Supabase Dashboard > SQL Editor > New Query > Run.
--
-- Adds the two columns the activity feed needs so notifications can show
--   * the animal's photo (already stored on animals.photo_url)
--   * the volunteer's photo (snapshotted onto each event)
--
-- Both use "add column if not exists", so running it twice is harmless.

-- Snapshot of the volunteer's profile photo on each logged care event.
alter table events add column if not exists actor_avatar text;

-- The signed-in volunteer's own photo, reused across events.
alter table profiles add column if not exists avatar_url text;

-- Verify:
select column_name, data_type
from information_schema.columns
where table_name = 'events' and column_name = 'actor_avatar';