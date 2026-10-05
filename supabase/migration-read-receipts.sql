-- FeedTheAnimalsMap — read receipts, and a badge that actually clears
-- Run in Supabase Dashboard > SQL Editor > New Query > Run.  Safe to re-run.
--
-- WHY YOU MAY NEED THIS
-- --------------------
-- The unread badge is derived from conversation_participants.last_read_at.
-- Clearing it needs an UPDATE on that table, and on a database created
-- before the "participants mark read" policy existed, every attempt fails
-- with a permission error the frontend swallows - so the number climbs and
-- never comes down, even after you have read the thread.
--
-- This script is idempotent and only adds what is missing. Run it if the
-- badge does not clear after you open a conversation.
--
-- NO SCHEMA CHANGE is needed for the read receipts themselves: the other
-- person's cursor already lives in last_read_at, and the client reads it
-- through sbDmPeers(). This file only guarantees the policy that lets you
-- move YOUR OWN cursor.
-- ============================================================================

-- 1. The read-cursor policy. Scoped to user_id = auth.uid(), so a volunteer
--    can only advance their own cursor - they cannot mark somebody else's
--    conversation read, and cannot touch the other participant's row.
drop policy if exists "participants mark read" on conversation_participants;
create policy "participants mark read" on conversation_participants for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. The SECURITY DEFINER helper. A SELECT policy on
--    conversation_participants that queried that same table recursed into
--    itself forever ("infinite recursion detected in policy"), which blocks
--    reads of messages and conversations entirely - the badge would have
--    nothing to count. SECURITY DEFINER runs as the owner and bypasses RLS,
--    so there is no re-entry. Kept in step with schema-chat.sql.
create or replace function is_conversation_participant(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conversation_id and user_id = auth.uid()
  );
$$;

-- 3. A NULL cursor reads as "never read" and makes the timestamp comparison
--    undefined. Backfill any that predate the column, so a thread can never
--    get stuck permanently unread for no reason.
update conversation_participants
   set last_read_at = now()
 where last_read_at is null;

-- ---------------------------------------------------------------------------
--  Verify after running:
--    select policyname, cmd from pg_policies
--     where tablename = 'conversation_participants' order by policyname;
--    -- expect an UPDATE row named "participants mark read"
--
--  Re-test the badge and the ticks:
--    1. npx serve .  ->  http://localhost:3000
--    2. Sign in as volunteer A in one browser, volunteer B in another
--    3. B sends a message  ->  A's Chats badge shows 1
--    4. A opens the thread  ->  the badge clears immediately
--    5. A sends a reply      ->  B sees ONE tick (sent)
--    6. B opens the thread   ->  A's tick becomes TWO (read)
-- ---------------------------------------------------------------------------
