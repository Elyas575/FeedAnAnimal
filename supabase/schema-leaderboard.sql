-- FeedTheAnimalsMap — COMMUNITY LEADERBOARD + RANKS (Phase 6 extra)
-- Run this in Supabase Dashboard > SQL Editor > New Query > Run.
-- Safe to re-run.
--
-- Builds a Dota-style competitive ladder out of real care activity.
-- Points come from the `events` table, so the ladder can never drift from
-- what actually happened: there is no client-side tally to fake.
--
--   feed 10 · water 8 · station check 12 · vet 20
--   medicine 18 · rescue 30 · report 25 · check 6
--
-- Ranks (Dota ladder shape, re-themed for animal rescue):
--   1 Stray · 2 Scout · 3 Feeder · 4 Carer · 5 Guardian
--   6 Angel · 7 Saint · 8 Legend

/* ------------------------------------------------------------------ *
 * 1. leaderboard() — ranked volunteers for a time window
 * ------------------------------------------------------------------ */
create or replace function public.leaderboard(
  p_window text default 'all'          -- 'week' | 'month' | 'all'
)
returns table (
  rank         bigint,
  user_id      uuid,
  display_name text,
  avatar_url   text,
  points       bigint,
  feeds        bigint,
  waters       bigint,
  reports      bigint,
  checks       bigint,
  animals      bigint,
  last_seen    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select e.actor_id, e.actor_name, e.actor_avatar, e.kind,
           e.animal_id, e.created_at
    from events e
    where e.actor_id is not null                      -- named volunteers only
      and (
        p_window = 'all'
        or (p_window = 'week'  and e.created_at >= now() - interval '7 days')
        or (p_window = 'month' and e.created_at >= now() - interval '30 days')
      )
  )
  select
    row_number() over (order by t.points desc, t.last_seen desc nulls last),
    t.actor_id,
    t.display_name,
    t.avatar_url,
    t.points,
    t.feeds,
    t.waters,
    t.reports,
    t.checks,
    t.animals,
    t.last_seen
  from (
    select
      s.actor_id,
      max(coalesce(s.actor_name, 'Volunteer'))::text as display_name,
      max(s.actor_avatar)::text                      as avatar_url,
      sum(case s.kind
            when 'feed' then 10 when 'water' then 8 when 'station' then 12
            when 'vet' then 20 when 'medicine' then 18 when 'rescue' then 30
            when 'report' then 25 else 6 end)::bigint as points,
      count(*) filter (where s.kind = 'feed')::bigint    as feeds,
      count(*) filter (where s.kind = 'water')::bigint   as waters,
      count(*) filter (where s.kind = 'report')::bigint  as reports,
      count(*) filter (where s.kind = 'station')::bigint as checks,
      count(distinct s.animal_id)::bigint                as animals,
      max(s.created_at)                                  as last_seen
    from scoped s
    group by s.actor_id
  ) t
  order by t.points desc, t.last_seen desc nulls last
  limit 100;
$$;

-- Anyone signed in (or anonymous) may read the ladder. It exposes no
-- private data beyond a display name and an avatar the volunteer chose.
grant execute on function public.leaderboard(text) to anon, authenticated;

/* ------------------------------------------------------------------ *
 * 2. my_rank() — where the signed-in volunteer sits, even if unranked.
 *    Returns a full row even with zero events, so the UI can show
 *    "0 points to go" instead of an empty state.
 * ------------------------------------------------------------------ */
create or replace function public.my_rank()
returns table (
  points    bigint,
  rank      bigint,
  tier      int,
  tier_name text,
  to_next   bigint,
  feeds     bigint,
  waters    bigint,
  reports   bigint,
  animals   bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select
      e.actor_id,
      sum(case e.kind
            when 'feed' then 10 when 'water' then 8 when 'station' then 12
            when 'vet' then 20 when 'medicine' then 18 when 'rescue' then 30
            when 'report' then 25 else 6 end)::bigint as points,
      count(*) filter (where e.kind = 'feed')::bigint    as feeds,
      count(*) filter (where e.kind = 'water')::bigint   as waters,
      count(*) filter (where e.kind = 'report')::bigint  as reports,
      count(distinct e.animal_id)::bigint                as animals
    from events e
    where e.actor_id = (select auth.uid())
    group by e.actor_id
  ),
  scored as (
    select coalesce(m.points, 0)::bigint as points,
           coalesce(m.feeds, 0)::bigint  as feeds,
           coalesce(m.waters, 0)::bigint as waters,
           coalesce(m.reports, 0)::bigint as reports,
           coalesce(m.animals, 0)::bigint as animals
    from (select 1) seed
    left join mine m on true
  )
  select
    p.points,
    (select count(*) + 1 from leaderboard('all') l where l.points > p.points)::bigint,
    (case when p.points >= 4000 then 8 when p.points >= 2500 then 7
          when p.points >= 1500 then 6 when p.points >= 900  then 5
          when p.points >= 500  then 4 when p.points >= 250  then 3
          when p.points >= 100  then 2 else 1 end),
    (case when p.points >= 4000 then 'Legend' when p.points >= 2500 then 'Saint'
          when p.points >= 1500 then 'Angel'  when p.points >= 900  then 'Guardian'
          when p.points >= 500  then 'Carer'  when p.points >= 250  then 'Feeder'
          when p.points >= 100  then 'Scout'  else 'Stray' end),
    (case when p.points >= 4000 then 0 when p.points >= 2500 then 4000 - p.points
          when p.points >= 1500 then 2500 - p.points when p.points >= 900  then 1500 - p.points
          when p.points >= 500  then 900 - p.points  when p.points >= 250  then 500 - p.points
          when p.points >= 100  then 250 - p.points  else 100 - p.points end),
    p.feeds, p.waters, p.reports, p.animals
  from scored p;
$$;

grant execute on function public.my_rank() to anon, authenticated;

-- Verify both work:
-- select * from public.leaderboard('all') limit 10;
-- select * from public.my_rank();