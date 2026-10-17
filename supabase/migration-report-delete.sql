-- Report DELETE for owners (FeedAnAnimalMap)
-- Run in Supabase Dashboard > SQL Editor AFTER schema-core.sql.
-- Safe to re-run.
--
-- WHY THIS IS NEEDED
-- A volunteer can remove their OWN stray report from the map: the pin, the
-- shared row and its photo (index.js deleteThisReport() -> window.sbDeleteReport()).
-- The row delete needs this owner-only policy; the photo delete rides on the
-- existing "auth delete animal-photos" storage policy from schema-storage.sql.
-- No other table references reports by foreign key (events.animal_id is plain
-- text), so deleting the row orphans nothing that Postgres must cascade.

drop policy if exists "reporter delete reports" on reports;
create policy "reporter delete reports" on reports for delete
  using (auth.uid() = reporter_id);
