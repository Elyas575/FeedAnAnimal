-- ============================================================================
--  REMOVE THE DEMO / SEED DATA
--  Supabase Dashboard > SQL Editor > New Query > Run
--
--  The app no longer ships with sample animals. The `animals` and `stations`
--  tables may still hold the 48 animals / 6 stations written by
--  tools/seed-supabase.js, so this empties them.
--
--  ORDER MATTERS: events and reports point at animals(id), so they are
--  deleted first. Without this the deletes below would fail on the foreign key.
--  Safe to re-run - DELETE removes nothing when the table is already empty.
-- ============================================================================

-- 1. Activity written against the demo animals.
--    NOTE: `events` is also the leaderboard's source data (see
--    schema-leaderboard.sql), so this wipes ranks and points too. That is
--    expected on a demo reset. Want to keep the leaderboard? Delete only the
--    rows whose animal_id is not null (the demo ones) and leave real ones.
delete from events;

-- 2. Photos uploaded for the demo reports live in Supabase Storage and are
--    NOT removed by a SQL delete. Remove them by hand:
--    Storage > animal-photos (or whatever bucket you created) > delete files.
--    The table rows are dropped here; the orphaned files have to go via the UI.

-- 3. Community reports about the demo animals.
delete from reports;

-- 4. The demo animals and stations themselves.
delete from animals;
delete from stations;

-- 5. Forum demo content (only if you want a clean community too).
--    delete from topic_likes;
--    delete from replies;
--    delete from topics;

-- 6. Profiles are kept: they are tied to auth.users and hold real (or
--    anonymous) sessions, not demo content. Leave them alone.

-- ---------------------------------------------------------------------------
--  Afterwards you have an empty app. Animals appear only when a real person
--  taps "Report a Stray" - that writes to `reports` (and an `events` row),
--  which the frontend merges into the map on load.
-- ---------------------------------------------------------------------------

-- Optional sanity check - should return 0 rows each.
-- select count(*) from animals;
-- select count(*) from stations;
-- select count(*) from events;
-- select count(*) from reports;