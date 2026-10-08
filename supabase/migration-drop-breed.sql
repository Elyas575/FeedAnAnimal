-- ============================================================================
--  DROP BREED - breed was removed from the UI and the data model
--  FeedTheAnimalsMap. Run once in Supabase Dashboard > SQL Editor > New Query > Run.
--
--  The app never fills this column in: the report form has no breed field and
--  the map used to print the placeholder "Cat (breed unknown)" everywhere.
--  Safe to re-run - `if exists` makes a second run a no-op.
-- ============================================================================

alter table animals drop column if exists breed;

-- Verify (expect 0 rows):
--   select column_name from information_schema.columns
--    where table_name = 'animals' and column_name = 'breed';