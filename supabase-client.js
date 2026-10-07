/* FeedTheAnimalsMap — Supabase client (Phase 4: shared feeds)
 * Public publishable key ONLY. Never put sb_secret here.
 */
const SB_URL = 'https://wtmcviupbcmcffamyslb.supabase.co';
const SB_ANON = 'sb_publishable_As7cS21usw4DV3MtKdLnEw_op6mSBXb';

const sb = (window.supabase && SB_URL.indexOf('YOUR-PROJECT') === -1 && SB_ANON.indexOf('PASTE-YOUR') === -1)
  ? window.supabase.createClient(SB_URL, SB_ANON)
  : null;

if (!sb) {
  console.warn('[sb] Supabase not configured yet — running on localStorage only. Paste SB_ANON in supabase-client.js');
}

// expose for index.js IIFE (top-level const/let are not on window)
// NOTE: sbAuth is assigned at the bottom after its definition (see end of file).
try {
  if (typeof window !== 'undefined') {
    window.sb = sb;
    window.sbEnsureAuth = sbEnsureAuth;
    window.sbLogEvent = sbLogEvent;
    window.sbLoadRecentEvents = sbLoadRecentEvents;
    window.sbLiveTicker = sbLiveTicker;
    window.sbUploadReportPhoto = sbUploadReportPhoto;
    window.sbSubmitReport = sbSubmitReport;
    window.sbLoadReports = sbLoadReports;
    window.sbCompressImage = sbCompressImage;
    window.sbFormatBytes = sbFormatBytes;
    window.sbDisplayName = sbDisplayName;
    window.sbLeaderboard = sbLeaderboard;
    window.sbMyRank = sbMyRank;
    window.sbForumTopics = sbForumTopics;
    window.sbForumCreateTopic = sbForumCreateTopic;
    window.sbForumReplies = sbForumReplies;
    window.sbForumCreateReply = sbForumCreateReply;
    window.sbForumToggleLike = sbForumToggleLike;
    window.sbRequireEmail = sbRequireEmail;
    window.sbCaretakerFor = sbCaretakerFor;
    window.sbOpenDm = sbOpenDm;
    window.sbListMessages = sbListMessages;
    window.sbSendMessage = sbSendMessage;
    window.sbDmPeers = sbDmPeers;
    window.sbSetBlock = sbSetBlock;
    window.sbSubscribeDm = sbSubscribeDm;
    window.sbInbox = sbInbox;
    window.sbMarkConversationRead = sbMarkConversationRead;
  }
} catch (e) { /* ignore */ }

/* ------------------------------------------------------------------ *
 * Community forum (see supabase/schema-forum.sql)
 *
 * Wakie-style topics: volunteers post a title + body, others reply.
 * Every function returns null when the forum tables are not installed
 * yet, so forum.js can fall back to localStorage and the page still
 * works before the SQL has been run.
 * ------------------------------------------------------------------ */

/* Newest-first topic list. sort: 'recent' | 'top' | 'active'. */
async function sbForumTopics(sort) {
  if (!sb) return null;
  try {
    let q = sb.from('topics').select('*');
    if (sort === 'top') q = q.order('like_count', { ascending: false }).order('created_at', { ascending: false });
    else if (sort === 'active') q = q.order('last_reply_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    else q = q.order('created_at', { ascending: false });
    const { data, error } = await q.limit(100);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[sb] forum topics unavailable (run supabase/schema-forum.sql):', err.message);
    return null;
  }
}

async function sbForumCreateTopic(title, body) {
  if (!sb) return null;
  try {
    const user = await sbEnsureAuth();
    if (!user || user.is_anonymous) return { error: 'signin' };
    const cleanTitle = String(title || '').trim().slice(0, 140);
    const cleanBody = String(body || '').trim().slice(0, 4000);
    if (cleanTitle.length < 3 || !cleanBody) return { error: 'invalid' };
    const { data, error } = await sb.from('topics').insert([{
      author_id: user.id,
      author_name: await sbDisplayName('Volunteer'),
      author_avatar: await sbAvatarUrl(),
      title: cleanTitle,
      body: cleanBody,
    }]).select().single();
    if (error) throw error;
    return { topic: data };
  } catch (err) {
    console.warn('[sb] forum create topic failed:', err.message);
    return (/relation|table|schema cache/i.test(err.message || '')) ? null : { error: 'failed' };
  }
}

async function sbForumReplies(topicId) {
  if (!sb) return null;
  try {
    const { data, error } = await sb.from('replies').select('*')
      .eq('topic_id', topicId).order('created_at', { ascending: true }).limit(200);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[sb] forum replies unavailable:', err.message);
    return null;
  }
}

async function sbForumCreateReply(topicId, body) {
  if (!sb) return null;
  try {
    const user = await sbEnsureAuth();
    if (!user || user.is_anonymous) return { error: 'signin' };
    const clean = String(body || '').trim().slice(0, 2000);
    if (!clean) return { error: 'invalid' };
    const { data, error } = await sb.from('replies').insert([{
      topic_id: topicId,
      author_id: user.id,
      author_name: await sbDisplayName('Volunteer'),
      author_avatar: await sbAvatarUrl(),
      body: clean,
    }]).select().single();
    if (error) throw error;
    return { reply: data };
  } catch (err) {
    console.warn('[sb] forum create reply failed:', err.message);
    return (/relation|table|schema cache/i.test(err.message || '')) ? null : { error: 'failed' };
  }
}

/* Toggles the signed-in volunteer's like. Returns { liked, like_count }
   or { error: 'signin' } / null when the tables are missing. */
async function sbForumToggleLike(topicId) {
  if (!sb) return null;
  try {
    const user = await sbEnsureAuth();
    if (!user || user.is_anonymous) return { error: 'signin' };
    const existing = await sb.from('topic_likes')
      .select('topic_id').eq('topic_id', topicId).eq('user_id', user.id).maybeSingle();
    if (existing.error && !/no rows|PGRST116/i.test(existing.error.message || '')) throw existing.error;
    if (existing.data) {
      const del = await sb.from('topic_likes').delete().eq('topic_id', topicId).eq('user_id', user.id);
      if (del.error) throw del.error;
      await sb.rpc('forum_like_delta', { p_topic: topicId, p_delta: -1 }).then(
        function () {}, function () { /* trigger-less fallback below */ });
      return { liked: false };
    }
    const ins = await sb.from('topic_likes').insert([{ topic_id: topicId, user_id: user.id }]);
    if (ins.error) throw ins.error;
    await sb.rpc('forum_like_delta', { p_topic: topicId, p_delta: 1 }).then(
      function () {}, function () { /* trigger-less fallback below */ });
    return { liked: true };
  } catch (err) {
    console.warn('[sb] forum like failed:', err.message);
    return (/relation|table|schema cache/i.test(err.message || '')) ? null : { error: 'failed' };
  }
}

/* ------------------------------------------------------------------ *
 * Community ladder (see supabase/schema-leaderboard.sql)
 *
 * Points are computed in Postgres from the events table, never in the
 * browser - otherwise anyone could edit a number in devtools and top the
 * board. These wrappers degrade to [] when the RPC is not installed yet,
 * so the community page still renders if the SQL has not been run.
 * ------------------------------------------------------------------ */
async function sbLeaderboard(span) {
  const win = ['week', 'month', 'all'].indexOf(span) === -1 ? 'all' : span;
  try {
    if (!sb) return [];
    const { data, error } = await sb.rpc('leaderboard', { p_window: win });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[sb] leaderboard unavailable (run supabase/schema-leaderboard.sql):', err.message);
    return [];
  }
}

async function sbMyRank() {
  try {
    if (!sb) return null;
    const { data, error } = await sb.rpc('my_rank');
    if (error) throw error;
    // Supabase returns a single row as an array for set-returning functions.
    return (data && data[0]) || null;
  } catch (err) {
    console.warn('[sb] my_rank unavailable:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * INBOX (Phase 5.7)
 *
 * Every conversation the signed-in volunteer is part of, newest first,
 * with the peer, the animal it is about, the last message and an unread
 * count. This is what the header badge and the inbox page both read, so
 * the two can never disagree.
 *
 * All three tables are already RLS-scoped to participants, so a plain
 * select only ever returns the caller's own conversations - no policy
 * change is needed for the read path.
 * ------------------------------------------------------------------ */
async function sbInbox(limit) {
  if (!sb) return [];
  const me = await sbRequireEmail();
  if (!me) return [];

  try {
    /* Step 1: my conversations, newest activity first. `created_at` is the
       only ordering column conversations has, so threads are re-sorted on
       the last message below - that is what "recent" means to a volunteer. */
    const { data: convos, error: cerr } = await sb.from('conversations')
      .select('id, animal_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 50);
    if (cerr) throw cerr;
    if (!convos || !convos.length) return [];

    const ids = convos.map((c) => c.id);

    /* Step 2: the other person in each thread. Participant rows are
       readable by members, so this stays inside RLS. */
    const { data: parts, error: perr } = await sb.from('conversation_participants')
      .select('conversation_id, user_id, last_read_at')
      .in('conversation_id', ids);
    if (perr) throw perr;

    const peerOf = {};
    const readOf = {};
    const allPeers = [];
    (parts || []).forEach((p) => {
      if (p.user_id === me.id) readOf[p.conversation_id] = p.last_read_at;
      else { peerOf[p.conversation_id] = p.user_id; allPeers.push(p.user_id); }
    });

    /* Step 3: names in ONE query. profiles is publicly readable. */
    const names = {};
    if (allPeers.length) {
      const { data: profiles } = await sb.from('profiles')
        .select('id, display_name')
        .in('id', allPeers);
      (profiles || []).forEach((p) => { names[p.id] = p.display_name; });
    }

    /* Step 4: last message + unread per thread. Fetching the recent slice
       of each conversation is cheaper and far more robust than a per-thread
       aggregate query, and 50 threads x 1 row is trivial at this scale. */
    const lastOf = {};
    const unreadOf = {};
    await Promise.all(ids.map(async (cid) => {
      const { data: msgs } = await sb.from('messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', cid)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(25);
      const rows = msgs || [];
      if (rows.length) lastOf[cid] = rows[0];
      /* Unread = someone else's messages newer than my last_read_at. My own
         messages never count, so sending does not mark the thread unread. */
      const since = Date.parse(readOf[cid] || '') || 0;
      unreadOf[cid] = rows.filter((m) =>
        m.sender_id !== me.id && Date.parse(m.created_at) > since).length;
    }));

    /* Step 5: animal names, so a row says "about Milo" not "about report-x". */
    const animalIds = convos.map((c) => c.animal_id).filter(Boolean);
    const animalNames = {};
    if (animalIds.length) {
      /* Reports use ids of the form 'report-<uuid>' and live in `reports`,
         not `animals`, so both are read and matched by suffix. */
      const seedIds = animalIds.filter((a) => a.indexOf('report-') !== 0);
      if (seedIds.length) {
        const { data: animals } = await sb.from('animals')
          .select('id, name').in('id', seedIds);
        (animals || []).forEach((a) => { animalNames[a.id] = a.name; });
      }
      const reportUuids = animalIds
        .filter((a) => a.indexOf('report-') === 0)
        .map((a) => a.slice('report-'.length));
      if (reportUuids.length) {
        const { data: reports } = await sb.from('reports')
          .select('id, name').in('id', reportUuids);
        (reports || []).forEach((r) => {
          animalNames['report-' + r.id] = r.name || 'Reported stray';
        });
      }
    }

    return convos.map((c) => {
      const peerId = peerOf[c.id] || null;
      const last = lastOf[c.id] || null;
      return {
        id: c.id,
        animalId: c.animal_id || null,
        animalName: animalNames[c.animal_id] || null,
        peerId: peerId,
        peerName: peerId ? (names[peerId] || 'Volunteer') : null,
        lastBody: last ? last.body : '',
        lastAt: last ? last.created_at : c.created_at,
        lastMine: last ? last.sender_id === me.id : false,
        unread: unreadOf[c.id] || 0,
      };
    }).sort((a, b) => (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0));
  } catch (err) {
    console.warn('[sb] inbox unavailable:', err.message);
    return [];
  }
}

/* Clears the unread badge for one thread. Reads a row only ever visible to
    its owner (user_id = auth.uid()), so a forged id cannot touch anyone
    else's state. Returns true on success, false when the server refused.

    `upToIso` MUST be the newest message timestamp the client actually saw,
    which is a value the SERVER wrote. The obvious implementation -
    `new Date().toISOString()` - stamps the cursor with the browser clock,
    and the unread test compares that against server `created_at`. Any device
    whose clock runs even slightly fast then leaves every message sorting
    after its own read cursor, so the badge climbs forever and never clears.
    Taking the newest observed server timestamp makes both sides directly
    comparable, and a message that lands mid-request is not swallowed: it is
    newer than the cursor we wrote, so it correctly stays unread. */
async function sbMarkConversationRead(conversationId, upToIso) {
  if (!sb || !conversationId) return false;
  const me = await sbRequireEmail();
  if (!me) return false;
  /* With no observed timestamp there is nothing to mark, so leave the
     cursor alone - that is both safe and correct for an empty thread. */
  const stamp = String(upToIso || '');
  if (!stamp || !isFinite(Date.parse(stamp))) return true;
  try {
    const { error } = await sb.from('conversation_participants')
      .update({ last_read_at: stamp })
      .eq('conversation_id', conversationId)
      .eq('user_id', me.id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[sb] mark read failed:', err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Chat DMs (see supabase/schema-chat.sql)
 *
 * Unlike the forum, chat cannot fall back to localStorage: a message
 * is only useful if the OTHER volunteer receives it. So these wrappers
 * never fake success - they return null when the chat tables are not
 * installed yet and { error: 'signin' } when the visitor has no real
 * account, and index.js surfaces both states to the user.
 *
 * Why a real account is required (step 5.2): an anonymous session is a
 * throwaway id. It can log a feed, but it cannot be replied to and it
 * disappears on sign-out, which would leave orphan conversations other
 * people can see and never answer. Feeds stay anonymous on purpose;
 * only chat asks for an email.
 * ------------------------------------------------------------------ */

/* The signed-in volunteer with a real address, or null. The caller
   decides whether that is fatal (chat) or fine (feeds). */
async function sbRequireEmail() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user || user.is_anonymous || !user.email) return null;
    return user;
  } catch (e) { return null; }
}

/* The most recent volunteer who has cared for this animal, newest first.
   Step 5.3 needs a user id to DM, and the events table is the only
   place one exists - the caretakers on the animal record are display
   names from the seed data, not accounts.

   Returns { userId, name } or null. Events with a null actor_id
   (anonymous feeders) are skipped: there is nobody to reply to.
   `excludeId` is the current volunteer so you never DM yourself - the
   RPC rejects that anyway, but failing early gives a readable message
   instead of a raw database error. */
async function sbCaretakerFor(animalId, excludeId) {
  if (!sb || !animalId) return null;
  try {
    const { data, error } = await sb.from('events')
      .select('actor_id, actor_name, created_at')
      .eq('animal_id', animalId)
      .not('actor_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw error;
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) {
      if (excludeId && rows[i].actor_id === excludeId) continue;
      return { userId: rows[i].actor_id, name: rows[i].actor_name || 'Volunteer' };
    }
    return null;
  } catch (err) {
    console.warn('[sb] caretaker lookup failed:', err.message);
    return null;
  }
}

/* Find the existing 1-to-1 thread about this animal, or open one.
   The RPC is SECURITY DEFINER, so it can match the two participants
   without re-entering the RLS policy that used to recurse.
   Returns the conversation id, { error: 'signin' }, or null. */
async function sbOpenDm(otherUserId, animalId, reportId) {
  if (!sb) return null;
  const user = await sbRequireEmail();
  if (!user) return { error: 'signin' };
  if (!otherUserId || otherUserId === user.id) return { error: 'self' };
  try {
    const { data, error } = await sb.rpc('get_or_create_dm', {
      other_user: otherUserId,
      p_animal_id: animalId || null,
      p_report_id: reportId || null,
    });
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.warn('[sb] open DM failed:', err.message);
    return null;
  }
}

/* The NEWEST `limit` messages, returned oldest-first so the thread reads top
   to bottom. Deleted rows are filtered out in the query rather than rendered
   as tombstones.

   Newest-first in the QUERY, then reversed here. Ordering ascending and
   applying .limit() returns the OLDEST `limit` rows, not the newest - so on a
   thread longer than the limit the volunteer never saw the latest messages,
   and markThreadRead() stamped a cursor from the middle of the conversation.
   Every message after that point stayed permanently unread, which is a badge
   that survives reading the thread. Reversing a bounded newest-first page is
   the only way to get "the most recent N, in reading order". */
async function sbListMessages(conversationId, limit) {
  if (!sb || !conversationId) return null;
  try {
    const { data, error } = await sb.from('messages')
      .select('id, conversation_id, sender_id, body, created_at, is_deleted')
      .eq('conversation_id', conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit || 100);
    if (error) throw error;
    return (data || []).slice().reverse();
  } catch (err) {
    console.warn('[sb] list messages failed:', err.message);
    return null;
  }
}

/* sender_id is NOT optional here (step 5.4).

   The "participants send messages" policy checks
   sender_id = auth.uid(), so an insert that leaves it null is rejected
   by the database even though the column itself is nullable. The
   chat-snippets.js reference version omits it, which is why every send
   written from that snippet fails. */
async function sbSendMessage(conversationId, body) {
  if (!sb) return null;
  const user = await sbRequireEmail();
  if (!user) return { error: 'signin' };
  const clean = String(body || '').trim().slice(0, 2000);
  if (!clean) return { error: 'empty' };
  try {
    const { data, error } = await sb.from('messages')
      .insert([{ conversation_id: conversationId, sender_id: user.id, body: clean }])
      .select('id, conversation_id, sender_id, body, created_at, is_deleted')
      .single();
    if (error) throw error;
    return data || true;
  } catch (err) {
    /* The block check lives in the same INSERT policy, so a blocked
       sender gets an RLS error indistinguishable from any other. Say so
       plainly rather than showing a failure they cannot act on. */
    if (/row-level security|violates/i.test(err.message || '')) {
      return { error: 'blocked' };
    }
    console.warn('[sb] send message failed:', err.message);
    return { error: 'failed' };
  }
}

/* Everyone you share a conversation with, so the thread header can name
   them. Participant rows are readable by members, so this stays inside
   RLS. Returns [{ userId, name }]. */
async function sbDmPeers(conversationId, myId) {
  if (!sb || !conversationId) return [];
  try {
    const { data, error } = await sb.from('conversation_participants')
      .select('user_id, last_read_at')
      .eq('conversation_id', conversationId);
    if (error) throw error;
    const others = (data || []).filter((row) => row.user_id && row.user_id !== myId);
    if (!others.length) return [];
    const ids = others.map((row) => row.user_id);

    /* profiles is publicly readable (schema-core.sql), so every name
       comes from one query instead of one per participant. */
    const { data: profiles, error: perr } = await sb.from('profiles')
      .select('id, display_name')
      .in('id', ids);
    if (perr) throw perr;
    const names = {};
    (profiles || []).forEach((p) => { names[p.id] = p.display_name; });
    /* lastReadAt is carried through, not dropped: it is the ONLY evidence a
       message was actually read (the double tick), and it is the same column
       the unread badge counts from - so one query answers both questions and
       they can never disagree. */
    return others.map((row) => ({
      userId: row.user_id,
      name: names[row.user_id] || 'Volunteer',
      lastReadAt: row.last_read_at || null,
    }));
  } catch (err) {
    console.warn('[sb] DM peers failed:', err.message);
    return [];
  }
}

/* Block or unblock a volunteer (step 5.5).

   blocks has a single "own blocks" policy covering all commands for
   blocker_id = auth.uid(), so one wrapper does both directions: insert
   (via upsert, so blocking twice cannot throw duplicate-key) to block,
   delete to unblock. Deleting the row also re-enables sending straight
   away, because the INSERT policy on messages re-checks for a block on
   every send. */
async function sbSetBlock(otherUserId, blocked) {
  if (!sb) return null;
  const user = await sbRequireEmail();
  if (!user) return { error: 'signin' };
  if (!otherUserId || otherUserId === user.id) return { error: 'self' };
  try {
    if (blocked) {
      const { error } = await sb.from('blocks')
        .upsert({ blocker_id: user.id, blocked_id: otherUserId },
          { onConflict: 'blocker_id,blocked_id' });
      if (error) throw error;
    } else {
      const { error } = await sb.from('blocks').delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', otherUserId);
      if (error) throw error;
    }
    return { blocked: !!blocked };
  } catch (err) {
    console.warn('[sb] block failed:', err.message);
    return { error: 'failed' };
  }
}

/* Live append (step 5.4). Requires messages to be in the
   supabase_realtime publication (step 2.8). Returns the channel so the
   caller can unsubscribe when the modal closes - a leaked channel keeps
   delivering into a detached DOM node for the life of the page. */
function sbSubscribeDm(conversationId, onMsg) {
  if (!sb || !conversationId) return null;
  try {
    return sb.channel('dm:' + conversationId)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'conversation_id=eq.' + conversationId
      }, (payload) => {
        if (onMsg) {
          try { onMsg(payload.new); } catch (e) { console.warn('[sb] DM handler failed', e.message); }
        }
      })
      .subscribe();
  } catch (err) {
    console.warn('[sb] DM subscribe failed:', err.message);
    return null;
  }
}

async function sbEnsureAuth() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session.user;
    const { data: anon, error } = await sb.auth.signInAnonymously();
    if (error) { console.warn('[sb] anon auth failed', error.message); return null; }
    return anon.user || null;
  } catch (err) {
    console.warn('[sb] auth failed (kept locally):', err.message);
    return null;
  }
}

async function sbDisplayName(fallback) {
  try {
    if (!sb) return fallback || 'Guest volunteer';
    const { data } = await sb.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user) return fallback || 'Guest volunteer';
    if (user.is_anonymous) return fallback || 'Guest volunteer';
    const meta = user.user_metadata || {};
    return meta.display_name || meta.full_name || meta.name ||
      (user.email ? user.email.split('@')[0] : null) ||
      fallback || 'Guest volunteer';
  } catch (e) { return fallback || 'Guest volunteer'; }
}

/* Real profile photo when the provider gave us one (Google sets
   user_metadata.avatar_url / picture). Returns null for anonymous
   visitors and for email-only signups, so callers can fall back to
   colour-coded initials. */
async function sbAvatarUrl() {
  try {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user || user.is_anonymous) return null;
    const meta = user.user_metadata || {};
    const url = meta.avatar_url || meta.picture || meta.photo_url || null;
    return url ? String(url) : null;
  } catch (e) { return null; }
}

/* Posts one care event.

   The events table gains its columns over time (actor_avatar was added after
   the first release), so a plain insert can fail on a column that does not
   exist yet on an older database. Rather than lose the feed silently, we
   retry without the optional columns. The volunteer always keeps their
   local copy either way. */
async function sbLogEvent({ animalId, stationId, kind, note, place }) {
  try {
    if (!sb) return false;
    const user = await sbEnsureAuth();
    const actorName = await sbDisplayName('Volunteer');
    const actorAvatar = await sbAvatarUrl();
    const base = {
      animal_id: animalId || null,
      station_id: stationId || null,
      kind: kind,
      note: note || null,
      place: place || null,
      actor_id: (user && !user.is_anonymous) ? user.id : null,
      actor_name: actorName,
    };

    let result = await sb.from('events').insert([Object.assign({ actor_avatar: actorAvatar }, base)]);
    if (result.error && /column|schema cache|actor_avatar/i.test(result.error.message || '')) {
      console.warn('[sb] events.actor_avatar missing - run supabase/migration-avatar.sql; retrying without it');
      result = await sb.from('events').insert([base]);
    }
    if (result.error) throw result.error;
    return true;
  } catch (err) {
    console.warn('[sb] log failed (kept locally):', err.message);
    return false;
  }
}

async function sbLoadRecentEvents(limit = 30) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[sb] load events failed:', err.message);
    return [];
  }
}

function sbLiveTicker(onEvent) {
  if (!sb) return null;
  try {
    return sb.channel('ticker')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => {
        if (onEvent) { try { onEvent(p.new); } catch (e) { console.warn('[sb] ticker handler failed', e.message); } }
      })
      .subscribe();
  } catch (err) {
    console.warn('[sb] live ticker failed:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Image compression (Phase 4.6)
 *
 * Why this exists: the animal-photos bucket rejects anything over 500KB,
 * and a modern phone photo is 4-12MB. So every image is re-encoded in the
 * browser before upload.
 *
 * "Smallest possible" needs a real strategy rather than one fixed quality
 * setting, because quality maps to bytes very differently per photo (a
 * leafy park scene costs far more than a close-up of a cat). So we:
 *
 *   1. pick the best format the browser can actually encode (AVIF is ~30%
 *      smaller than WebP at equal quality, JPEG is the last resort);
 *   2. binary-search the highest quality that still fits the byte budget,
 *      instead of guessing a single number;
 *   3. if even the minimum quality overflows, step the dimensions down and
 *      search again;
 *   4. keep a hard ceiling so we never emit something the bucket will reject.
 *
 * Re-encoding through <canvas> also strips EXIF, which quietly removes the
 * GPS coordinates and camera serial a stray photo would otherwise carry.
 * ------------------------------------------------------------------ */
const SB_IMAGE_DEFAULTS = {
  maxEdge: 1200,             // longest edge, in px
  targetBytes: 110 * 1024,   // aim here (~113KB: sharp on phones, tiny on disk)
  hardCapBytes: 460 * 1024,  // never emit above this (bucket limit is 500KB)
  minQuality: 0.45,          // below this the photo turns to mush
  maxQuality: 0.92,
  dimensionSteps: [1200, 900, 700, 520],
};

/* Which formats can this browser actually encode? AVIF support is still
   partial, so probe once with a 1x1 canvas and remember the answer. */
let sbImageFormatPromise = null;
function sbBestImageFormat() {
  if (sbImageFormatPromise) return sbImageFormatPromise;
  sbImageFormatPromise = (async () => {
    try {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const order = [
        { type: 'image/avif', ext: 'avif' },
        { type: 'image/webp', ext: 'webp' },
      ];
      for (const candidate of order) {
        const blob = await new Promise((resolve) => probe.toBlob(resolve, candidate.type, 0.5));
        // Some browsers silently fall back to PNG; only accept a real match.
        if (blob && blob.type === candidate.type) return candidate;
      }
    } catch (e) { /* fall through to jpeg */ }
    return { type: 'image/jpeg', ext: 'jpg' };
  })();
  return sbImageFormatPromise;
}

function sbEncodeCanvas(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/* Highest quality whose encoded size still fits `budget`, found by binary
   search. Keeps the smallest encode we saw, so we degrade gracefully when
   even the minimum quality overflows. */
async function sbSearchQuality(canvas, format, budget, minQuality, maxQuality) {
  let best = null;
  let lo = minQuality;
  let hi = maxQuality;

  for (let attempt = 0; attempt < 7; attempt++) {
    const mid = (lo + hi) / 2;
    const blob = await sbEncodeCanvas(canvas, format.type, mid);
    if (!blob) break;
    if (!best || blob.size < best.blob.size) best = { blob: blob, quality: mid };
    if (blob.size <= budget) {
      lo = mid;   // room to spare: try richer
    } else {
      hi = mid;   // too big: back off
    }
    if (hi - lo < 0.02) break;
  }
  return best;
}

/* Compress an image File down to a small AVIF/WebP/JPEG. Returns the
   original File untouched when the browser cannot rasterise it (SVG/GIF)
   or when compression would not actually help. */
async function sbCompressImage(file, options = {}) {
  const cfg = Object.assign({}, SB_IMAGE_DEFAULTS, options || {});
  try {
    if (!file || !file.type || !/^image\//.test(file.type)) return file;

    // SVG/GIF have no meaningful canvas raster; send them as-is.
    if (/svg|gif/.test(file.type)) return file;

    // Already tiny and in a modern format: re-encoding cannot beat it.
    if (file.size && file.size <= cfg.targetBytes && /(webp|avif)/.test(file.type)) return file;

    const bitmap = await createImageBitmap(file);
    const sourceLongEdge = Math.max(bitmap.width, bitmap.height);
    const format = await sbBestImageFormat();

    // Never upscale a small image.
    const cap = Math.min(cfg.maxEdge, sourceLongEdge);
    // Descending: try the largest step first, because that keeps the most
    // detail. We only step DOWN when the current size still overflows the
    // budget, so ordinary photos encode once at full quality and stop.
    const steps = cfg.dimensionSteps
      .filter((edge) => edge <= cap)
      .sort((a, b) => b - a);
    if (steps[0] !== cap) steps.unshift(cap);

    let smallest = null;
    for (const edge of steps) {
      const scale = Math.min(1, edge / sourceLongEdge);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);

      const found = await sbSearchQuality(canvas, format, cfg.targetBytes, cfg.minQuality, cfg.maxQuality);
      if (found && (!smallest || found.blob.size < smallest.blob.size)) smallest = found;
      // Only stop shrinking once we are genuinely inside the budget. An
      // encode that still overflows means this dimension is too large, so
      // step down and try again rather than settling for an oversized file.
      if (found && found.blob.size <= cfg.targetBytes) break;
    }

    try { bitmap.close(); } catch (e) { /* older browsers */ }

    if (!smallest || !smallest.blob) return file;
    if (file.size && smallest.blob.size >= file.size) return file;

    // Still over the bucket limit after shrinking: retry once at the smallest
    // step with a lower floor so we never emit something Storage rejects.
    // Guarded by `options` so a pathological input cannot recurse forever.
    if (smallest.blob.size > cfg.hardCapBytes && !cfg.retrying) {
      const retry = await sbCompressImage(file, {
        dimensionSteps: [520, 380],
        targetBytes: Math.floor(cfg.targetBytes * 0.6),
        minQuality: 0.35,
        retrying: true,
      });
      if (retry !== file) return retry;
    }

    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([smallest.blob], base + '.' + format.ext, {
      type: format.type,
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn('[sb] image compression skipped:', err.message);
    return file;
  }
}

/* Human-readable "4.2 MB -> 96 KB (98% smaller)" for the upload UI. */
function sbFormatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* Compress then upload a report photo to the public animal-photos bucket.
   Returns the public URL, or null when there is no photo to upload. */
async function sbUploadReportPhoto(file) {
  if (!file) return null;
  if (!sb) throw new Error('Supabase is not configured yet.');
  await sbEnsureAuth();
  let payload = await sbCompressImage(file);

  // Last-resort guard: the bucket rejects anything over its file_size_limit,
  // so drop to the smallest step rather than fail the whole report.
  const cap = SB_IMAGE_DEFAULTS.hardCapBytes;
  if (payload.size > cap) {
    console.warn('[sb] photo still ' + sbFormatBytes(payload.size) + ' - retrying at minimum size');
    payload = await sbCompressImage(payload, {
      dimensionSteps: [520, 380],
      targetBytes: 70 * 1024,
      minQuality: 0.4,
    });
  }
  if (payload.size > cap) throw new Error('Photo is too large even after compression.');

  const ext = (payload.name.split('.').pop() || 'webp').toLowerCase().slice(0, 5);
  const key = 'reports/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const { error } = await sb.storage.from('animal-photos')
    .upload(key, payload, { contentType: payload.type || 'image/webp', upsert: false });
  if (error) throw error;
  return sb.storage.from('animal-photos').getPublicUrl(key).data.publicUrl;
}

/* Per-species urgency thresholds, mirroring meta.urgencyPolicy in
   data/animals.json. Kept as a local copy (not fetched) because sbLoadReports
   maps DB rows BEFORE index.js has loaded the dataset, and the values must
   match levelMinutes() exactly or a cloud report and a local one would compute
   different statuses from identical answers.

   Returns the minutes to backdate lastFedAt/lastWateredAt by: 5 when it looks
   fed (matching levelMinutes 'ok'), or urgentHours*60+120 when it does not
   (matching levelMinutes 'urgent'). */
function speciesRule(species) {
  var HOURS = {
    cat: { food: 14, water: 10 },
    dog: { food: 16, water: 12 },
    rabbit: { food: 14, water: 10 },
    bird: { food: 12, water: 8 },
    'guinea-pig': { food: 10, water: 8 }
  };
  var h = HOURS[species] || { food: 14, water: 10 };
  return { food: h.food * 60 + 120, water: h.water * 60 + 120 };
}

/* Loads community reports so everyone sees every stray, not just the ones they
   reported themselves.

   This is the read half of sbSubmitReport(). Without it `reports` was
   write-only: a report was inserted and then never read by anybody, so the map
   stayed empty for every visitor.

   The DB stores snake_case columns (location_label / photo_url) while the app
   models an animal with location.label / photoUrl, so the row is mapped here
   instead of leaking the column names into index.js.

   Returns [] when Supabase is not configured or the table is missing, so the
   app keeps working offline exactly as before. */
async function sbLoadReports(limit = 200) {
  if (!sb) return [];
  try {
    const { data, error } = await sb.from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(function (row) {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      const label = row.location_label || 'Community report pin';
      /* Undo the markers sbSubmitReport() writes, so the report's real needs survive
         the round trip. Without this a starving stray arrives at every other
         user looking freshly fed and watered - the map would show it as the
         one animal nobody needs to help.

         Order is load-bearing. sbSubmitReport() PREPENDS, so the last marker
         written ends up FIRST in the string. They must therefore be stripped in
         that same order (vet, then water, then food) - checking food first
         silently lost the food/water flags whenever all three were set, and
         leaked the raw markers into the description. */
      const rawText = row.description || '';
      const needsVet = rawText.indexOf('[NEEDS_VET]') === 0;
      const afterVet = needsVet ? rawText.slice('[NEEDS_VET]'.length).trim() : rawText;
      const needsWater = afterVet.indexOf('[NEEDS_WATER]') === 0;
      const afterWater = needsWater ? afterVet.slice('[NEEDS_WATER]'.length).trim() : afterVet;
      const needsFood = afterWater.indexOf('[NEEDS_FOOD]') === 0;
      const description = (needsFood ? afterWater.slice('[NEEDS_FOOD]'.length).trim() : afterWater)
        || 'Reported by a community volunteer.';
      /* Backdate exactly like the local path (levelMinutes 'urgent' vs 'ok'),
         so a cloud report and a local one compute the same status. */
      const nowMs = Date.now();
      const MIN = 60000;
      const rule = speciesRule(row.species || 'cat');
      return {
        /* Stable id so the same report dedupes instead of pinning twice. */
        id: 'report-' + String(row.id),
        name: row.name || 'Unnamed stray',
        species: row.species || 'cat',
        breed: (row.species || 'cat') + ' (reported)',
        description: description,
        health: needsVet ? 'critical' : 'healthy',
        lastFedAt: new Date(nowMs - (needsFood ? rule.food : 5) * MIN).toISOString(),
        lastWateredAt: new Date(nowMs - (needsWater ? rule.water : 5) * MIN).toISOString(),
        notes: 'Reported by the community - log what you see here.',
        caretakers: ['Community'],
        tags: ['community-report'],
        photoUrl: row.photo_url || null,
        reportedAt: row.created_at || new Date().toISOString(),
        location: {
          lat: isFinite(lat) ? lat : 0,
          lng: isFinite(lng) ? lng : 0,
          label: label,
          area: row.city || 'Reported area',
          city: row.city || '',
          country: row.country || '',
          citySlug: row.city_slug || ''
        },
        source: 'report'
      };
    }).filter(function (animal) {
      /* A report with no usable coordinates cannot be pinned; drop it rather
         than dropping a pin at null island (0,0). */
      return isFinite(animal.location.lat) && isFinite(animal.location.lng) &&
        !(animal.location.lat === 0 && animal.location.lng === 0);
    });
  } catch (err) {
    console.warn('[sb] load reports failed:', err.message);
    return [];
  }
}

/* Insert a community report so the whole team sees it, not just this device.
   Returns the new row's id so the caller can adopt it, which keeps the local
   pin and the cloud row the SAME animal instead of two pins for one report. */
async function sbSubmitReport(report) {
  if (!sb) return false;
  try {
    const user = await sbEnsureAuth();
    /* The reports table has no food/water/health columns, so these three
       answers are encoded as markers in the description. Without this a
       starving stray would reach every other user looking freshly fed.

       Order is fixed and the markers are stripped again in sbLoadReports(). */
    let description = report.description || '';
    if (report.needsFood) description = '[NEEDS_FOOD] ' + description;
    if (report.needsWater) description = '[NEEDS_WATER] ' + description;
    if (report.needsVet) description = '[NEEDS_VET] ' + description;
    description = description || null;
    /* City/country are optional: old databases without migration-report-city.sql
       still accept the insert via the lean retry below. */
    const city = (report.city || '').slice(0, 80) || null;
    const country = (report.country || '').slice(0, 80) || null;
    const citySlug = (report.citySlug || '').slice(0, 80) || null;
    const payload = {
      reporter_id: (user && !user.is_anonymous) ? user.id : null,
      name: report.name || null,
      species: report.species || null,
      lat: Number.isFinite(report.lat) ? report.lat : null,
      lng: Number.isFinite(report.lng) ? report.lng : null,
      location_label: report.place || null,
      city: city,
      country: country,
      city_slug: citySlug,
      photo_url: report.photoUrl || null,
      description: description,
      status: 'open',
    };
    let result = await sb.from('reports').insert([payload]).select('id').single();
    // Older databases may not have every optional column yet - retry leaner.
    if (result.error && /column|schema cache/i.test(result.error.message || '')) {
      result = await sb.from('reports').insert([{
        reporter_id: payload.reporter_id,
        name: payload.name,
        species: payload.species,
        lat: payload.lat,
        lng: payload.lng,
        location_label: payload.location_label,
        photo_url: payload.photo_url,
        description: payload.description,
      }]).select('id').single();
    }
    if (result.error) throw result.error;
    /* The id, so the caller can use the same one sbLoadReports() will hand
       back later. Falls back to true if the database returns no row. */
    return (result.data && result.data.id) || true;
  } catch (err) {
    console.warn('[sb] report submit failed (kept locally):', err.message);
    return false;
  }
}

/* ---------- Auth helpers used by auth.html + header account button ---------- */
const sbAuth = {
  client() { return sb; },
  async currentUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.user) || null;
  },
  onChange(cb) {
    if (!sb) return () => {};
    const { data } = sb.auth.onAuthStateChange((_evt, session) => cb(session && session.user ? session.user : null));
    return () => { try { data.subscription.unsubscribe(); } catch (e) {} };
  },
  // Magic-link (works NOW — you already enabled Email provider)
  async signInWithEmailLink(email) {
    const clean = String(email || '').trim();
    if (!clean) throw new Error('Enter your email first.');
    const { error } = await sb.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: window.location.origin + '/auth.html' },
    });
    if (error) throw error;
    return true;
  },
  // Email + password (requires Supabase Auth > Providers > Email > Confirm OFF for instant login,
  // or user clicks confirm link if Confirm ON)
  async signUpWithPassword(email, password, displayName) {
    const { data, error } = await sb.auth.signUp({
      email: String(email).trim(),
      password: String(password),
      options: { data: { display_name: displayName || String(email).split('@')[0] } },
    });
    if (error) throw error;
    return data.user;
  },
  async signInWithPassword(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password: String(password) });
    if (error) throw error;
    return data.user;
  },
  // Forgot password: emails a recovery link back to auth.html. Supabase answers
  // the same whether or not the address exists, so callers should not promise
  // that an account was found — just that a link may be on its way.
  // Requires the site origin to be allowed under Authentication > URL Config.
  async resetPassword(email) {
    const clean = String(email || '').trim();
    if (!clean) throw new Error('Enter your email first.');
    const { error } = await sb.auth.resetPasswordForEmail(clean, {
      redirectTo: window.location.origin + '/auth.html',
    });
    if (error) throw error;
    return true;
  },
  // Only usable while the session from the emailed recovery link is active.
  async updatePassword(newPassword) {
    const pw = String(newPassword || '');
    if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
    const { data, error } = await sb.auth.updateUser({ password: pw });
    if (error) throw error;
    return data.user;
  },
  // Gmail / Google OAuth — requires one-time setup in Supabase (see auth.html instructions).
  // If not configured yet, this throws a clear message instead of hanging.
  async signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth.html' },
    });
    if (error) throw error;
  },
  async signOut() {
    if (!sb) return;
    await sb.auth.signOut();
  },
};

// assigned here (after definition) so plain <script> load order never throws
try {
  if (typeof window !== 'undefined') {
    window.sbAuth = sbAuth;
    window.sbDisplayName = (typeof sbDisplayName === 'function') ? sbDisplayName : window.sbDisplayName;
  }
} catch (e) { /* ignore */ }

