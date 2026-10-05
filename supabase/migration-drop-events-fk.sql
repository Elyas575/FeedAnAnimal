-- ============================================================================
--  DROP THE EVENTS FOREIGN KEYS  (safe to re-run)
--  Supabase Dashboard > SQL Editor > New Query > Run.
--
--  WHY THIS IS NEEDED
--
--  `events.animal_id` was declared `references animals(id)`. That was correct
--  while the 48 demo animals lived in the `animals` table. They don't any more
--  - cleanup-seed-data.sql emptied it on purpose, because the app now grows
--  from real community reports instead.
--
--  The result is a silent, total failure of every shared write:
--
--    * the map renders animals from data/animals.json, a local file, so ids
--      like 'milo' exist in the browser but NOT in the `animals` table
--    * sbLogEvent() inserts those ids into `events`
--    * Postgres rejects the row: violates foreign key constraint
--    * the feed appears to work (it is saved to localStorage first) but never
--      reaches the database, so no other volunteer sees it
--    * and Phase 5 chat cannot work at all, because sbCaretakerFor() looks up
--      the recent `events` rows and finds none
--
--  The symptom is a volunteer saying "I fed it but nobody else can see that I
--  did" - which is the exact trust problem this app exists to solve.
--
--  Dropping the constraint is the right fix, not seeding the demo animals back.
--  The app's model is now: animals come from reports, and `events.animal_id` is
--  a label pointing at whichever record the frontend is showing (a report id
--  like 'report-<uuid>', or a seeded slug like 'milo'). There is nothing for
--  the FK to protect.
--
--  The leaderboard (schema-leaderboard.sql) reads `events`, not `animals`, so
--  dropping this does not affect ranks or points.
-- ============================================================================

-- Both are "if exists", so re-running after a fresh setup is harmless.
alter table events drop constraint if exists events_animal_id_fkey;
alter table events drop constraint if exists events_station_id_fkey;

-- ============================================================================
--  SAME TRAP, SECOND TABLE (Phase 5)
--
--  `conversations.animal_id` was ALSO declared `references animals(id)`, for
--  the same reason, and it breaks DMs the same way. The insert inside the
--  get_or_create_dm RPC is rejected by Postgres, sbOpenDm() catches it and
--  returns null, and the volunteer sees:
--
--      "That conversation could not be opened. Try again in a moment."
--
--  The first version of this migration only covered `events`, which is why the
--  shared feed started working while chat still failed. Both tables are fixed
--  together here so one paste covers everything.
--
--  Note the UI deliberately does NOT show the database error - a volunteer
--  cannot act on "violates foreign key constraint". The generic message is the
--  user-facing symptom of this bug.
-- ============================================================================
alter table conversations drop constraint if exists conversations_animal_id_fkey;

-- ============================================================================
--  ALLOW MARKING A THREAD AS READ  (Phase 5.7 - the inbox badge)
--
--  conversation_participants.last_read_at is what the unread badge counts
--  from, but the table only had SELECT and INSERT policies. Without an
--  UPDATE policy every attempt to clear the badge failed with a permission
--  error, so the number would climb forever and never come down.
--
--  Scoped to the row's own user_id, so a volunteer can only advance their
--  OWN read cursor - they cannot mark somebody else's conversation read, and
--  cannot touch the other participant's row.
-- ============================================================================
drop policy if exists "participants mark read" on conversation_participants;
create policy "participants mark read" on conversation_participants for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Verify: should return 0 rows once the constraints are gone.
-- select conname from pg_constraint
-- where conrelid in ('events'::regclass, 'conversations'::regclass) and contype = 'f';

-- ---------------------------------------------------------------------------
--  After running this, re-test the shared feed:
--    1. npx serve .  ->  http://localhost:3000
--    2. Sign in (two different browsers), feed the same animal from each
--    3. Reload the other browser - the feed count must go up by 1
--    4. node tools/db-status.js - `events` should no longer be 0 rows
-- ---------------------------------------------------------------------------