-- Merge existing animal-specific direct messages into one conversation
-- per pair of participants, preserving messages and read cursors.
begin;

lock table conversations, conversation_participants, messages in access exclusive mode;

create temporary table dm_pair_canonical on commit drop as
with participant_pairs as (
  select conversation_id, array_agg(user_id order by user_id) as participant_ids
  from conversation_participants
  group by conversation_id
  having count(*) = 2
),
ranked as (
  select
    c.id as conversation_id,
    first_value(c.id) over (
      partition by pp.participant_ids
      order by c.created_at, c.id
    ) as canonical_id
  from conversations c
  join participant_pairs pp on pp.conversation_id = c.id
)
select conversation_id, canonical_id from ranked;

update messages m
set conversation_id = mapping.canonical_id
from dm_pair_canonical mapping
where m.conversation_id = mapping.conversation_id
  and mapping.conversation_id <> mapping.canonical_id;

with merged_read_cursors as (
  select mapping.canonical_id, p.user_id, max(p.last_read_at) as last_read_at
  from dm_pair_canonical mapping
  join conversation_participants p
    on p.conversation_id = mapping.conversation_id
  group by mapping.canonical_id, p.user_id
)
update conversation_participants canonical
set last_read_at = merged.last_read_at
from merged_read_cursors merged
where canonical.conversation_id = merged.canonical_id
  and canonical.user_id = merged.user_id;

delete from conversation_participants p
using dm_pair_canonical mapping
where p.conversation_id = mapping.conversation_id
  and mapping.conversation_id <> mapping.canonical_id;

delete from conversations c
using dm_pair_canonical mapping
where c.id = mapping.conversation_id
  and mapping.conversation_id <> mapping.canonical_id;

-- A unified conversation is about its participants, not a single animal.
update conversations c
set animal_id = null, report_id = null
where exists (
  select 1 from dm_pair_canonical mapping
  where mapping.canonical_id = c.id
);

create or replace function get_or_create_dm(other_user uuid, p_animal_id text default null, p_report_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  pair_key text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if other_user = auth.uid() then raise exception 'cannot DM yourself'; end if;

  pair_key := least(auth.uid()::text, other_user::text) || ':' ||
              greatest(auth.uid()::text, other_user::text);
  perform pg_advisory_xact_lock(hashtextextended(pair_key, 0));

  select c.id into cid
  from conversations c
  where exists (
      select 1 from conversation_participants p
      where p.conversation_id = c.id and p.user_id = auth.uid()
    )
    and exists (
      select 1 from conversation_participants p
      where p.conversation_id = c.id and p.user_id = other_user
    )
    and (select count(*) from conversation_participants p
         where p.conversation_id = c.id) = 2
  order by c.created_at, c.id
  limit 1;

  if cid is null then
    insert into conversations (created_by)
    values (auth.uid()) returning id into cid;
    insert into conversation_participants (conversation_id, user_id)
    values (cid, auth.uid()), (cid, other_user);
  end if;
  return cid;
end; $$;

commit;
