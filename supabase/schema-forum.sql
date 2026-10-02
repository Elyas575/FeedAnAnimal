-- FeedAnAnimalMap — COMMUNITY FORUM (topics + replies + likes)
-- Run this in Supabase Dashboard > SQL Editor > New Query > Run.
-- Safe to re-run (uses IF NOT EXISTS).
--
-- Wakie-style: volunteers post a topic (title + body), others reply.
-- The page works on localStorage BEFORE this SQL is run; after you run it,
-- forum.js switches to these tables automatically.
--
--   topics  : one row per discussion topic
--   replies : one row per reply to a topic
--   topic_likes : one row per (user, topic) like

-- 1. Topics ----------------------------------------------------------
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  author_avatar text,
  title text not null check (char_length(title) between 3 and 140),
  body text not null check (char_length(body) between 1 and 4000),
  reply_count int not null default 0,
  like_count int not null default 0,
  last_reply_at timestamptz,
  created_at timestamptz default now()
);

-- 2. Replies ---------------------------------------------------------
create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  author_avatar text,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now()
);
create index if not exists replies_topic_idx on replies (topic_id, created_at asc);

-- 3. Likes (one per volunteer per topic) ------------------------------
create table if not exists topic_likes (
  topic_id uuid not null references topics(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (topic_id, user_id)
);

-- 4. Keep topics.reply_count / last_reply_at in sync ------------------
create or replace function public.touch_topic_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update topics
     set reply_count = reply_count + 1,
         last_reply_at = new.created_at
   where id = new.topic_id;
  return new;
end; $$;

drop trigger if exists on_reply_touch_topic on replies;
create trigger on_reply_touch_topic
  after insert on replies for each row execute function public.touch_topic_on_reply();

create or replace function public.untouch_topic_on_reply_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update topics
     set reply_count = greatest(reply_count - 1, 0)
   where id = old.topic_id;
  return old;
end; $$;

drop trigger if exists on_reply_untouch_topic on replies;
create trigger on_reply_untouch_topic
  after delete on replies for each row execute function public.untouch_topic_on_reply_delete();

-- 4b. Keep topics.like_count in sync (called best-effort from the client) --
create or replace function public.forum_like_delta(p_topic uuid, p_delta int)
returns void language sql security definer set search_path = public as $$
  update topics set like_count = greatest(like_count + p_delta, 0) where id = p_topic;
$$;

grant execute on function public.forum_like_delta(uuid, int) to anon, authenticated;

-- 5. RLS --------------------------------------------------------------
alter table topics enable row level security;
alter table replies enable row level security;
alter table topic_likes enable row level security;

drop policy if exists "public read topics" on topics;
create policy "public read topics" on topics for select using (true);

drop policy if exists "auth insert topics" on topics;
create policy "auth insert topics" on topics for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authors update own topics" on topics;
create policy "authors update own topics" on topics for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "authors delete own topics" on topics;
create policy "authors delete own topics" on topics for delete
  using (auth.uid() = author_id);

drop policy if exists "public read replies" on replies;
create policy "public read replies" on replies for select using (true);

drop policy if exists "auth insert replies" on replies;
create policy "auth insert replies" on replies for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "authors delete own replies" on replies;
create policy "authors delete own replies" on replies for delete
  using (auth.uid() = author_id);

drop policy if exists "public read topic likes" on topic_likes;
create policy "public read topic likes" on topic_likes for select using (true);

drop policy if exists "auth manage own topic likes" on topic_likes;
create policy "auth manage own topic likes" on topic_likes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Verify:
-- select * from topics order by created_at desc limit 10;
-- select * from replies order by created_at asc limit 20;
