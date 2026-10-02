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

/* Insert a community report so the whole team sees it, not just this device. */
async function sbSubmitReport(report) {
  if (!sb) return false;
  try {
    const user = await sbEnsureAuth();
    const payload = {
      reporter_id: (user && !user.is_anonymous) ? user.id : null,
      name: report.name || null,
      species: report.species || null,
      lat: Number.isFinite(report.lat) ? report.lat : null,
      lng: Number.isFinite(report.lng) ? report.lng : null,
      location_label: report.place || null,
      photo_url: report.photoUrl || null,
      description: report.description || null,
      status: 'open',
    };
    let result = await sb.from('reports').insert([payload]);
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
      }]);
    }
    if (result.error) throw result.error;
    return true;
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

