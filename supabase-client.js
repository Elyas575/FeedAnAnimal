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
    window.sbDisplayName = sbDisplayName;
  }
} catch (e) { /* ignore */ }

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

async function sbUploadReportPhoto(file) {
  await sbEnsureAuth();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
  const key = 'reports/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const { error } = await sb.storage.from('animal-photos').upload(key, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return sb.storage.from('animal-photos').getPublicUrl(key).data.publicUrl;
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

