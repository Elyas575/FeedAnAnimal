-- FeedTheAnimalsMap — monthly cleanup (Phase 6.3)
-- Run once a month in Supabase Dashboard > SQL Editor > New Query > Run.
--
-- The `events` table grows by one row per feed/water/report. That is cheap
-- (a row is roughly 200-300 bytes), but the raw log is only interesting for
-- a few months and the free tier is shared.
--
-- IMPORTANT: animals.feed_count / water_count are maintained by the
-- touch_animal_on_event() trigger, and those counts are what the map shows.
-- Deleting old event rows does NOT reset those totals, so the app keeps
-- working exactly as before.

-- 1. See what would be removed (run this first, read-only)
select count(*) as rows_older_than_90_days,
       min(created_at) as oldest,
       pg_size_pretty(sum(pg_column_size(e.*))::bigint) as reclaimable
from events e
where created_at < now() - interval '90 days';

-- 2. Show the table size overall
select pg_size_pretty(pg_total_relation_size('events')) as events_table_size,
       (select count(*) from events) as total_rows,
       (select count(*) from profiles) as profiles,
       (select count(*) from reports) as reports;

-- 3. Do the cleanup (uncomment to run)
-- delete from events where created_at < now() - interval '90 days';

-- 4. Confirm counts survived (feed_count is untouched by the delete)
-- select sum(feed_count) as total_feeds_logged from animals;

-- If photos ever fill the bucket, list the oldest to delete manually:
-- select name, (storage.file_metadata->>'size')::bigint as bytes, created_at
-- from storage.objects
-- where bucket_id = 'animal-photos'
-- order by created_at
-- limit 50;