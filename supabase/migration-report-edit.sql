-- ============================================================================
--  REPORT EDITING - owner-only updates  (safe to re-run)
--  FeedTheAnimalsMap. Run once in Supabase Dashboard > SQL Editor > Run.
--
--  WHY THIS IS NEEDED
--  A volunteer can correct their OWN report from the map: photo, name,
--  species, description, needs flags and location (index.js openEditReport()
--  -> window.sbUpdateReport()). Two database-side things must exist for that
--  correction to land:
--
--    1. reports.reporter_id - who filed the row. schema-core.sql creates the
--       table WITH the column, but a database created before it was added
--       will never get it from `create table if not exists`.
--
--    2. An UPDATE policy scoped to that owner. Without it Postgres rejects
--       every edit (RLS), the shared copy never changes, and the next reload
--       brings the old photo and name back while the UI claims it saved.
--
--  Every statement below is idempotent - run it as often as you like.
-- ============================================================================

alter table public.reports add column if not exists reporter_id uuid;

drop policy if exists "reporter update reports" on reports;
create policy "reporter update reports" on reports for update
  using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);

-- OPTIONAL backfill. Rows filed before the report form required a signed-in
-- account have reporter_id = NULL, and nobody can edit those - by design: we
-- cannot know who filed them, so the Edit button never renders for them. If
-- you DO know which account owns them, claim them explicitly:
--
--   update public.reports
--      set reporter_id = '<uuid-of-that-user>'
--    where reporter_id is null;
