/* FeedTheAnimalsMap — drop-in Supabase snippets for index.js / index.html
 * STEP A: in index.html BEFORE index.js add:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 */

const SB_URL = 'https://YOUR-PROJECT.supabase.co';
const SB_ANON = 'eyJ...YOUR-ANON-KEY';
const sb = (window.supabase && SB_URL.indexOf('YOUR-PROJECT') === -1)
  ? window.supabase.createClient(SB_URL, SB_ANON)
  : null;

async function sbEnsureAuth() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user;
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error) { console.warn('[sb] anon auth failed', error.message); return null; }
  return anon.user;
}

async function sbLogEvent({ animalId, stationId, kind, note, place }) {
  try {
    await sbEnsureAuth();
    if (!sb) return false;
    const { error } = await sb.from('events').insert([{
      animal_id: animalId || null, station_id: stationId || null,
      kind, note: note || null, place: place || null,
      actor_name: 'Volunteer',
    }]);
    if (error) throw error;
    return true;
  } catch (err) { console.warn('[sb] log failed (kept locally):', err.message); return false; }
}

function sbLiveTicker(onEvent) {
  if (!sb) return;
  sb.channel('ticker')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (p) => onEvent && onEvent(p.new))
    .subscribe();
}

async function sbUploadReportPhoto(file) {
  await sbEnsureAuth();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
  const key = 'reports/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const { error } = await sb.storage.from('animal-photos').upload(key, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return sb.storage.from('animal-photos').getPublicUrl(key).data.publicUrl;
}
