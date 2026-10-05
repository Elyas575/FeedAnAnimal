-- ============================================================================
--  RESET EVERYTHING — wipe all data for a from-scratch test
--  Supabase Dashboard > SQL Editor > New Query > Run
--
--  The existing cleanup-seed-data.sql only removes the 48 demo animals.
--  This one empties the WHOLE database: activity, reports, chat, forum,
--  photos and (optionally) every account - so the two-browser test starts
--  from zero.
--
--  WHAT IT DELETES
--    Block 1: events, reports, animals, stations, all chat tables, forum
--             tables, blocks  (and with them the leaderboard, which is
--             derived from events - nothing to do there)
--    Block 2: every auth account (email AND anonymous) -> profiles follow
--             automatically (FK on delete cascade) and every open session
--             is signed out on its next refresh
--    Block 3: uploaded report photos - NOT possible in SQL (Supabase blocks
--             it by design); use the dashboard or tools/clear-storage.js,
--             see Block 3 below
--
--  WHAT IT DOES NOT TOUCH
--    * schema: tables, columns, RLS policies, RPCs, triggers all stay
--    * the two migrations (migration-drop-events-fk.sql,
--      migration-read-receipts.sql). A data wipe does NOT undo them and does
--      NOT replace them - run them first if you have not yet, otherwise the
--      fresh test hits the old foreign-key bug and looks like a new bug.
--
--  AFTER RUNNING — clear browser storage in EVERY browser/origin you test
--  with, or the old overlay log re-appears and (FK now dropped) re-syncs into
--  the empty database: F12 -> Application -> Local Storage -> right-click the
--  origin -> Clear All, or in the console: localStorage.clear()
--
--  Safe to re-run: truncating an empty table is a no-op.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BLOCK 1 (always): the app's content.
-- One TRUNCATE ... CASCADE statement - Postgres resolves the foreign-key
-- order itself (messages -> conversations, replies -> topics, ...), so the
-- "delete children first" dance cleanup-seed-data.sql needed is unnecessary
-- here. RESTART IDENTITY resets any serial/sequence back to 1.
-- ---------------------------------------------------------------------------
truncate table
  public.events,
  public.reports,
  public.animals,
  public.stations,
  public.conversations,
  public.conversation_participants,
  public.messages,
  public.blocks,
  public.topics,
  public.replies,
  public.topic_likes
restart identity cascade;

-- ---------------------------------------------------------------------------
-- BLOCK 2 (recommended): the accounts themselves.
-- Deleting auth.users cascades into profiles (schema-core.sql declares
-- profiles.id references auth.users(id) on delete cascade), and profiles in
-- turn cascade into participants/blocks/likes; events.reporter FKs go null -
-- those tables are already empty from Block 1.
--
-- SKIP THIS BLOCK if you want to keep your logins. Profiles then survive
-- too, which is correct: a surviving account with a missing profile row
-- would break chat, and only the signup trigger (handle_new_user) recreates
-- profiles - it never fires for existing users.
--
-- Fresh accounts after this block are created by just signing up again
-- (Auth -> Providers -> Email -> Confirm email OFF makes it instant) and the
-- handle_new_user() trigger rebuilds each profile row automatically.
-- ---------------------------------------------------------------------------
delete from auth.users;

-- ---------------------------------------------------------------------------
-- BLOCK 3 (optional): uploaded photos - deliberately NOT a SQL statement.
-- Supabase installs the storage.protect_delete() trigger on storage.objects,
-- so "delete from storage.objects" always fails with:
--   42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
-- That is not a privileges problem and has no SQL workaround - and because
-- the SQL editor runs this whole file as ONE transaction, that error rolls
-- back Blocks 1+2 as well. Files must go through the Storage API. Pick one:
--
--   a) Dashboard: Storage -> animal-photos -> reports -> select all -> Delete.
--   b) Storage API with the service key (same env as tools/seed-supabase.js):
--        $env:SUPABASE_URL="https://xyz.supabase.co"
--        $env:SUPABASE_SERVICE_KEY="eyJ...service_role..."
--        node tools/clear-storage.js
--
-- Photos are cosmetic anyway: with `reports` emptied nothing links to them,
-- so a from-scratch test passes even if you skip this block entirely.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Sanity check — every count must be 0 after a full reset.
-- ---------------------------------------------------------------------------
select (select count(*) from events)     as events,
       (select count(*) from reports)    as reports,
       (select count(*) from animals)    as animals,
       (select count(*) from stations)   as stations,
       (select count(*) from messages)   as messages,
       (select count(*) from topics)     as topics,
       (select count(*) from profiles)   as profiles,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from storage.objects where bucket_id = 'animal-photos') as photos;

-- ---------------------------------------------------------------------------
-- Afterwards: the map is empty on purpose (it grows from real reports), the
-- leaderboard is empty because events feed it, and both browsers must sign
-- up fresh accounts for the two-browser test in MVP_FULL_STEPS.md.
-- ---------------------------------------------------------------------------
