-- Persist feed and water activity on community reports.
-- Run after schema-core.sql and after migration-drop-events-fk.sql.

alter table public.reports
  add column if not exists feed_count int not null default 0,
  add column if not exists water_count int not null default 0,
  add column if not exists last_fed_at timestamptz,
  add column if not exists last_watered_at timestamptz;

-- Recover totals and latest care times from any report events already logged.
update public.reports r
set feed_count = care.feed_count,
    water_count = care.water_count,
    last_fed_at = care.last_fed_at,
    last_watered_at = care.last_watered_at
from (
  select r0.id,
    count(e.id) filter (where e.kind = 'feed')::int as feed_count,
    count(e.id) filter (where e.kind = 'water')::int as water_count,
    max(e.created_at) filter (where e.kind = 'feed') as last_fed_at,
    max(e.created_at) filter (where e.kind = 'water') as last_watered_at
  from public.reports r0
  left join public.events e on e.animal_id = 'report-' || r0.id::text
  group by r0.id
) care
where r.id = care.id;

create or replace function public.touch_animal_on_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  report_id uuid;
begin
  if new.animal_id is null then return new; end if;
  if left(new.animal_id, 7) = 'report-' then
    begin
      report_id := substring(new.animal_id from 8)::uuid;
    exception when invalid_text_representation then
      return new;
    end;
    if new.kind = 'feed' then
      update public.reports
      set last_fed_at = new.created_at, feed_count = coalesce(feed_count, 0) + 1
      where id = report_id;
    elsif new.kind = 'water' then
      update public.reports
      set last_watered_at = new.created_at, water_count = coalesce(water_count, 0) + 1
      where id = report_id;
    end if;
    return new;
  end if;
  if new.kind = 'feed' then
    update public.animals
    set last_fed_at = new.created_at, feed_count = feed_count + 1
    where id = new.animal_id;
  elsif new.kind = 'water' then
    update public.animals
    set last_watered_at = new.created_at, water_count = water_count + 1
    where id = new.animal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_event_touch_animal on public.events;
create trigger on_event_touch_animal
  after insert on public.events
  for each row execute function public.touch_animal_on_event();
