-- FeedTheAnimalsMap CHAT schema (DMs)
-- Paste into Supabase SQL Editor AFTER schema-core.sql > Run

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  animal_id text references animals(id) on delete set null,
  report_id uuid references reports(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists conversation_participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  last_read_at timestamptz default now(),
  primary key (conversation_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now(),
  is_deleted boolean default false
);

create table if not exists blocks (
  blocker_id uuid references profiles(id) on delete cascade,
  blocked_id uuid references profiles(id) on delete cascade,
  primary key (blocker_id, blocked_id)
);

alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;
alter table blocks enable row level security;

-- Participants can read their own convos
drop policy if exists "participants read convo" on conversations;
create policy "participants read convo" on conversations for select using (
  exists (select 1 from conversation_participants where conversation_id = conversations.id and user_id = auth.uid())
);

drop policy if exists "auth create convo" on conversations;
create policy "auth create convo" on conversations for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

drop policy if exists "participants read participants" on conversation_participants;
create policy "participants read participants" on conversation_participants for select using (
  exists (select 1 from conversation_participants p where p.conversation_id = conversation_participants.conversation_id and p.user_id = auth.uid())
);

drop policy if exists "auth join convo" on conversation_participants;
create policy "auth join convo" on conversation_participants for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "participants read messages" on messages;
create policy "participants read messages" on messages for select using (
  exists (select 1 from conversation_participants where conversation_id = messages.conversation_id and user_id = auth.uid())
);

drop policy if exists "participants send messages" on messages;
create policy "participants send messages" on messages for insert with check (
  sender_id = auth.uid() and
  exists (select 1 from conversation_participants where conversation_id = messages.conversation_id and user_id = auth.uid()) and
  not exists (
    select 1 from blocks
    where blocker_id in (select user_id from conversation_participants where conversation_id = messages.conversation_id)
    and blocked_id = auth.uid()
  )
);

drop policy if exists "own blocks" on blocks;
create policy "own blocks" on blocks for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- RPC: find existing 1-to-1 DM about same animal, or create it
create or replace function get_or_create_dm(other_user uuid, p_animal_id text default null, p_report_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if other_user = auth.uid() then raise exception 'cannot DM yourself'; end if;

  -- find convo with exactly these 2 participants + same context
  select c.id into cid
  from conversations c
  join conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = auth.uid()
  join conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = other_user
  where coalesce(c.animal_id, '') = coalesce(p_animal_id, '')
    and coalesce(c.report_id::text, '') = coalesce(p_report_id::text, '')
  limit 1;

  if cid is null then
    insert into conversations (animal_id, report_id, created_by)
    values (p_animal_id, p_report_id, auth.uid()) returning id into cid;
    insert into conversation_participants (conversation_id, user_id)
    values (cid, auth.uid()), (cid, other_user);
  end if;
  return cid;
end; $$;
