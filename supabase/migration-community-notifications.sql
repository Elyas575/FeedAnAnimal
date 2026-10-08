-- Enable live notifications for new community topics.
-- Safe to run more than once on an existing Supabase project.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'topics'
  ) then
    alter publication supabase_realtime add table public.topics;
  end if;
end $$;
