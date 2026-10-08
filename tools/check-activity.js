const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const ah = fs.readFileSync(path.join(ROOT, 'activity.html'), 'utf8');

const rows = [];
const check = (label, needle, hay) => rows.push([hay.includes(needle) ? 'OK  ' : 'MISS', label]);

check('ticker renders a "View all" link to activity.html', 'href="activity.html"', js);
check('wireDeepLink() is defined', 'function wireDeepLink', js);
check('wireDeepLink() is called from boot()', 'wireDeepLink();', js);
check('deep link listens for hashchange', "addEventListener('hashchange'", js);
check('deep link reads the #animal= param', "params.get('animal')", js);
check('footer links to activity.html', 'href="activity.html"', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
check('activity.html deep-links to #animal=', '#animal=', ah);
check('activity.html deep-links to #station=', '#station=', ah);
check('activity.html has pretty() helper', 'var pretty =', ah);
check('activity.html has when() helper', 'var when =', ah);

// negative assertions: these must NOT be present
rows.push([js.indexOf('eval(') === -1 ? 'OK  ' : 'MISS', 'dead eval() removed from getFn']);
rows.push([/\n\s{6,}sbLogEvent\(/.test(js) === false ? 'OK  ' : 'MISS', 'no bare global sbLogEvent() call']);

// --- avatars / photos -------------------------------------------------
check('personAvatarHtml() defined', 'function personAvatarHtml', js);
check('animalThumbHtml() defined', 'function animalThumbHtml', js);
check('nameInitials() defined', 'function nameInitials', js);
check('nameHue() defined', 'function nameHue', js);
check('ticker renders the person avatar', 'personAvatarHtml(actor', js);
check('ticker renders the animal thumbnail', 'animalThumbHtml(animal', js);
check('cloud events carry actorAvatar', 'actorAvatar: r.actor_avatar', js);
check('realtime events carry actorAvatar', 'actorAvatar: row.actor_avatar', js);
check('normalizeActivity keeps actorAvatar', 'raw.actorAvatar', js);
check('local feed entries store actorAvatar', 'state.profile.avatarUrl', js);
check('syncAvatar() mirrors photo to profiles', 'function syncAvatar', js);
check('syncAvatar writes profiles.avatar_url', "avatar_url: clean", js);
check('display name is requested once for new signed-in accounts', '!metadata.fta_display_name && !metadata.fta_display_name_prompted', js);
check('display name prompt is wired into the map', 'wireDisplayNameModal();', js);
check('display name can be edited from account menu', 'edit-display-name', js);
check('display name saves through Supabase profile/auth metadata', 'window.sbSaveDisplayName', js);
check('display name has an app-specific persisted metadata field', 'fta_display_name: cleanName', fs.readFileSync(path.join(ROOT, 'supabase-client.js'), 'utf8'));
check('photos fall back when the URL is dead', 'this.remove()', js);

const sc = fs.readFileSync(path.join(ROOT, 'supabase-client.js'), 'utf8');
check('sbAvatarUrl() helper defined', 'async function sbAvatarUrl', sc);
check('events insert snapshots the avatar', 'actor_avatar: actorAvatar', sc);

check('activity.html personAvatar()', 'function personAvatar', ah);
check('activity.html animalThumb()', 'function animalThumb', ah);
check('activity.html loads the dataset for photos', 'async function loadAnimals', ah);
check('activity.html boot awaits loadAnimals', 'await loadAnimals()', ah);
check('activity.html rows show both faces', "personAvatar(r.actor, r.actorAvatar)", ah);
check('activity.html has .thumb styles', '.thumb{', ah);
check('activity.html has .initials styles', '.initials{', ah);

const core = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-core.sql'), 'utf8');
check('schema-core adds events.actor_avatar', 'alter table events add column if not exists actor_avatar', core);
check('schema-core adds profiles.avatar_url', 'alter table profiles add column if not exists avatar_url', core);
check('schema-core routes care events for community reports', "left(new.animal_id, 7) = 'report-'", core);
check('schema-core persists report feed timestamps', 'last_fed_at = new.created_at, feed_count = coalesce(feed_count, 0) + 1', core);

const careMig = path.join(ROOT, 'supabase', 'migration-report-care.sql');
const careSql = fs.existsSync(careMig) ? fs.readFileSync(careMig, 'utf8') : '';
check('report care migration exists', '', fs.existsSync(careMig) ? 'ok' : 'missing');
check('report care migration backfills existing feed events', "e.animal_id = 'report-' || r0.id::text", careSql);
check('report care migration stores feed and water history', 'last_watered_at timestamptz', careSql);
check('cloud reports load saved care times', 'row.last_fed_at ||', sc);
check('cloud reports load saved care counts', 'feedCount: Number(row.feed_count) || 0', sc);
check('cloud refresh replaces stale cached report data', 'Object.assign({}, local, animal)', js);

const mig = path.join(ROOT, 'supabase', 'migration-avatar.sql');
check('migration-avatar.sql exists', '', fs.existsSync(mig) ? 'ok' : 'missing');

/* --- inline <script> syntax ------------------------------------------ *
 * The pages ship their logic in inline <script> blocks, which node --check
 * never sees. Pull each one out and compile it to catch typos. */
const vm = require('vm');
const checkInline = (file) => {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const blocks = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi));
  let bad = 0;
  blocks.forEach((b, i) => {
    const code = b[1];
    if (!code.trim()) return;
    try { new vm.Script(code); }
    catch (e) { bad++; console.log('SYNTAX  ' + file + ' inline block #' + (i + 1) + ': ' + e.message); }
  });
  rows.push([bad ? 'MISS' : 'OK  ', file + ' inline <script> blocks compile (' + blocks.length + ' found)']);
};
checkInline('activity.html');
checkInline('auth.html');
checkInline('activity.html');
checkInline('auth.html');

/* --- magic-link login removed ---------------------------------------- *
 * Sign-in is password / OAuth only now. The Magic Link tab, the emailed
 * code fallback and the OTP helper they called are all gone, and the page
 * must open on the Sign In tab with the password field showing. */
const authPage = fs.readFileSync(path.join(ROOT, 'auth.html'), 'utf8');
rows.push([authPage.indexOf('tab-magic') === -1 ? 'OK  ' : 'MISS', 'auth.html has no Magic Link tab']);
rows.push([authPage.indexOf('btn-magic') === -1 ? 'OK  ' : 'MISS', 'auth.html has no "Send magic link" button']);
rows.push([authPage.indexOf('id="group-code"') === -1 ? 'OK  ' : 'MISS', 'auth.html has no emailed-code box']);
rows.push([authPage.indexOf('toggleCodeSection') === -1 ? 'OK  ' : 'MISS', 'auth.html dropped the code toggle helper']);
rows.push([authPage.indexOf('verifyOtp') === -1 ? 'OK  ' : 'MISS', 'auth.html never calls verifyOtp']);
rows.push([authPage.indexOf('signInWithEmailLink') === -1 ? 'OK  ' : 'MISS', 'auth.html never calls signInWithEmailLink']);
check('auth.html opens on the Sign In tab', 'id="tab-login" class="segment-btn active"', authPage);
check('auth.html shows the password field up front', '<div id="group-password" class="fa-input-group">', authPage);
check('auth.html shows the Sign In button up front', 'class="fa-btn-primary">Sign In to Account', authPage);
check('auth.html keeps password sign-in', 'signInWithPassword', authPage);
check('auth.html keeps forgot-password recovery', 'resetPassword', authPage);
rows.push([/provider:\s*'google'[\s\S]*?queryParams:\s*\{\s*prompt:\s*'select_account'/.test(sc) ? 'OK  ' : 'MISS',
  'Google OAuth asks the user to choose an account']);
rows.push([/@media \(max-width: 600px\)\s*\{\s*#toast-wrap\s*\{[^}]*left:\s*50%;[^}]*right:\s*auto;[^}]*transform:\s*translateX\(-50%\)/s.test(authPage) ? 'OK  ' : 'MISS',
  'auth toast notifications are centered on mobile']);
rows.push([sc.indexOf('signInWithEmailLink') === -1 ? 'OK  ' : 'MISS', 'supabase-client.js no longer defines signInWithEmailLink']);
rows.push([sc.indexOf('signInWithOtp') === -1 ? 'OK  ' : 'MISS', 'supabase-client.js never calls signInWithOtp']);
const chatSnip = fs.readFileSync(path.join(ROOT, 'supabase', 'chat-snippets.js'), 'utf8');
rows.push([chatSnip.indexOf('signInWithOtp') === -1 ? 'OK  ' : 'MISS', 'chat-snippets.js no longer sends a chat magic link']);


/* --- layering regression --------------------------------------------- *
 * Bug: the fallback (species emoji / initials) was painted ON TOP of the
 * real photo because it was emitted after the <img>. Both children are
 * absolutely positioned, so DOM order decides who wins. Assert the fallback
 * always comes FIRST and the photo SECOND in every avatar helper. */
/* --- layering: run the real helpers and inspect the emitted markup ---- *
 * Bug: the species emoji / initials fallback was painted ON TOP of the real
 * photo, because it was emitted after the <img> and both layers are
 * absolutely positioned. Assert on the ACTUAL returned HTML string rather
 * than on source order (the photo is built into a variable before the
 * return, so source position is not the same thing as paint order). */
const photoIndex = (html) => html.indexOf('<img');
const fallbackIndex = (html, needle) => html.indexOf(needle);
const layerCheck = (label, html, fallbackNeedle) => {
  const p = photoIndex(html);
  const f = fallbackIndex(html, fallbackNeedle);
  if (p === -1) { rows.push(['MISS', label + ': no photo layer emitted']); return; }
  if (f === -1) { rows.push(['MISS', label + ': no fallback layer emitted']); return; }
  if (p > f) rows.push(['OK  ', label + ': photo paints above fallback']);
  else rows.push(['MISS', label + ': FALLBACK COVERS THE PHOTO (bug)']);
};

// index.js helpers, invoked for real
const lunaLike = { id: 'luna', name: 'Luna', species: 'cat', photoUrl: 'https://example.test/luna.jpg' };
const noPhoto = { id: 'x', name: 'X', species: 'dog', photoUrl: null };
const deadPhoto = { id: 'd', name: 'D', species: 'cat', photoUrl: 'https://lh3.googleusercontent.com/aida/dead' };

const app = require(path.join(ROOT, 'index.js'));
layerCheck('index.js animalThumbHtml() with photo', app.animalThumbHtml(lunaLike, 'w-9 h-9'), 'text-lg');
layerCheck('index.js animalThumbHtml() dead url still layers', app.animalThumbHtml(deadPhoto, 'w-9 h-9'), 'text-lg');
layerCheck('index.js personAvatarHtml() with photo', app.personAvatarHtml('Lirah575', 'https://example.test/a.jpg'), 'font-bold');
rows.push([/onerror="this\.remove\(\)"/.test(app.animalThumbHtml(lunaLike)) ? 'OK  ' : 'MISS', 'index.js animalThumbHtml() has dead-link onerror']);
rows.push([app.animalThumbHtml(noPhoto).indexOf('<img') === -1 ? 'OK  ' : 'MISS', 'index.js animalThumbHtml() omits <img> when no photo']);
rows.push([/text-lg/.test(app.animalThumbHtml(noPhoto)) ? 'OK  ' : 'MISS', 'index.js animalThumbHtml() still shows emoji fallback']);

// activity.html helpers: evaluate them in a tiny sandbox
const vmMod = require('vm');
const ahFn = (name) => {
  const i = ah.indexOf(name);
  if (i === -1) return null;
  const body = ah.slice(i, ah.indexOf('\n}', i) + 2);
  return body;
};
const escFn = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const buildActivity = () => {
  const parts = [ahFn('function initialsOf('), ahFn('function hueOf('), ahFn('function personAvatar('), ahFn('function animalThumb(')];
  if (parts.some((p) => !p)) return null;
  const sandbox = {
    esc: escFn, HUES: ['#a03b0e', '#7c4a21'], SPECIES_EMOJI: { cat: 'CAT', dog: 'DOG' },
    animalsById: { luna: { name: 'Luna', species: 'cat', photoUrl: 'https://example.test/luna.jpg' },
                   nobody: { name: 'NB', species: 'dog', photoUrl: null },
                   dead: { name: 'D', species: 'cat', photoUrl: 'https://dead.test/x.jpg' } },
  };
  const ctx = vmMod.createContext(sandbox);
  parts.forEach((p) => vmMod.runInContext(p, ctx));
  return sandbox;
};
const ahBox = buildActivity();
if (!ahBox) {
  rows.push(['MISS', 'activity.html avatar helpers could not be evaluated']);
} else {
  layerCheck('activity.html animalThumb() with photo', ahBox.animalThumb('luna'), 'class="emoji"');
  layerCheck('activity.html animalThumb() dead url still layers', ahBox.animalThumb('dead'), 'class="emoji"');
  layerCheck('activity.html personAvatar() with photo', ahBox.personAvatar('Lirah575', 'https://example.test/a.jpg'), 'class="initials"');
  rows.push([ahBox.animalThumb('nobody').indexOf('<img') === -1 ? 'OK  ' : 'MISS', 'activity.html animalThumb() omits <img> when no photo']);
  rows.push([/class="emoji"/.test(ahBox.animalThumb('nobody')) ? 'OK  ' : 'MISS', 'activity.html animalThumb() still shows emoji fallback']);
}
/* explicit z-index guards, so a future DOM reorder cannot regress this */
check('activity.html .thumb img is above the emoji', '.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2}', ah);
check('activity.html .thumb emoji is below the photo', '.thumb .emoji{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;z-index:1}', ah);
check('activity.html .avatar img is above the initials', 'height:100%;object-fit:cover;z-index:2}', ah);
check('index.js photo img carries z-[2]', 'object-cover z-[2]', js);
check('index.js fallback span carries z-[1]', 'z-[1] flex items-center', js);

/* --- Phase 4.6: report photo upload ---------------------------------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('report form has a gallery image picker', 'id="report-photo-gallery-file"', html);
check('camera action retains the desktop file picker', 'id="report-photo-camera-file"', html);
check('native camera input requests the rear camera on mobile', 'capture="environment"', html);
check('gallery picker accepts images', 'accept="image/*"', html);
check('report form has a separate gallery picker', 'id="report-photo-gallery-file"', html);
check('gallery upload has a clearly labelled visible action', 'Choose from gallery', html);
check('gallery action is prominent alongside the camera action', 'bg-primary px-2 py-2 text-xs font-semibold text-on-primary', html);
check('take-photo action opens a camera dialog', 'id="report-camera-modal"', html);
check('camera dialog has a live video preview', 'id="report-camera-video"', html);
check('camera capture button is available', 'id="report-camera-capture"', html);
check('take-photo action uses the in-page camera API', 'navigator.mediaDevices.getUserMedia', js);
check('desktop camera action keeps its existing file-picker flow', 'cameraInput.click();', js);
check('mobile device detection selects the low-resolution camera', 'if (isMobilePhotoDevice() && supportsLiveCamera)', js);
check('camera frame is reduced before it becomes a photo', '960 / Math.max(video.videoWidth, video.videoHeight)', js);
check('camera tracks stop when its modal closes', "if (id === 'report-camera-modal') stopReportCamera();", js);
check('report form has a preview box', 'id="report-photo-preview"', html);
check('report form has a remove-photo button', 'id="report-photo-clear"', html);
rows.push([html.indexOf('id="report-photo"') === -1 ? 'OK  ' : 'MISS', 'the old "paste a photo URL" box is gone']);

check('wireReportPhoto() defined', 'function wireReportPhoto', js);
check('resetReportPhoto() defined', 'function resetReportPhoto', js);
check('wireReportPhoto() called from boot()', 'wireReportPhoto();', js);
check('submitReport is async (awaits the upload)', 'async function submitReport', js);
check('submitReport uploads via sbUploadReportPhoto', 'window.sbUploadReportPhoto(pendingReportPhoto)', js);
check('submitReport shares via sbSubmitReport', 'window.sbSubmitReport(', js);
rows.push([js.indexOf('sbUploadReportPhoto(pendingReportPhoto)') < js.indexOf('state.animals.push(animal)') ? 'OK  ' : 'MISS', 'submitReport uploads the photo before saving it locally']);
check('submit button shows upload progress', 'Uploading photo', js);
check('submit reports shared vs local-only', 'is now on the map for everyone', js);
check('reports are announced to the shared feed', "kind: 'report'", js);
check('picker resets after a successful report', 'resetReportPhoto();', js);
check('selected original photo is not decoded for the preview',
  'Do not preview the original file', js);
rows.push([/URL\.createObjectURL\(file\)/.test(js) ? 'MISS' : 'OK  ',
  'selected photo preview avoids full-resolution decoding']);
check('failed photo upload explains the report can still be saved without a photo',
  'The report will be saved on this device without its photo.', js);

/* --- city/country auto-detect + search -------------------------------- *
 * The report pin reverse-geocodes to city/country (no typing), stores it
 * on the report, and the sidebar search matches it — so "Istanbul" shows
 * every stray reported there. These pin the wiring so it cannot regress. */
check('report form has hidden city field', 'id="report-city"', html);
check('report form has hidden country field', 'id="report-country"', html);
check('report form shows detected city line', 'id="report-geo"', html);
check('reverse-geocode helper defined', 'async function reverseGeocode(lat, lng)', js);
check('reverse-geocode uses keyless client endpoint', 'api.bigdatacloud.net/data/reverse-geocode-client', js);
check('geo lookups are cached per neighbourhood', 'fta.geo.v1', js);
check('pin drop triggers city detection', 'fillReportGeo(lat, lng)', js);
check('moved pin clears stale city', "cityInput.value = ''", js);
check('submit resolves city before sharing', 'await fillReportGeo(lat, lng)', js);
check('city is sent to Supabase', 'city: geoCity', js);
check('city slug is sent to Supabase', 'citySlug: geoSlug', js);
check('cloud reports map city back to location', "city: row.city || ''", sc);
check('cloud reports group area by city', "area: row.city || 'Reported area'", sc);
check('sbSubmitReport payload carries city', 'city: city,', sc);
check('search matches city', 'loc.city, loc.country,', js);
check('search placeholder mentions city', 'Search city, country', html);
check('city slug helper exported for tests', 'slugifyCity: slugifyCity', js);

/* The sidebar card answers "where" at a glance: a small place line under the
   description. New reports carry city + country; seed animals only have a
   label/area, so the line degrades and is skipped when nothing is known. */
const cardBlock = js.slice(js.indexOf('function cardHtml'), js.indexOf('function renderFeed'));
rows.push([cardBlock.indexOf('loc.city, loc.country') !== -1 ? 'OK  ' : 'MISS', 'card shows city + country']);
rows.push([cardBlock.indexOf('loc.label || loc.area') !== -1 ? 'OK  ' : 'MISS', 'card place falls back to the seed label']);
rows.push([cardBlock.indexOf('location_on') !== -1 ? 'OK  ' : 'MISS', 'card place line uses a pin icon']);
rows.push([cardBlock.indexOf("if (!place) return ''") !== -1 ? 'OK  ' : 'MISS', 'card skips the place line when nothing is known']);


/* --- report location pinning (GPS-only in-form flow) ----------------- *
 * "Report a stray" opens the FORM directly and the pin comes from the device
 * GPS only: the lat/lng inputs are hidden (never shown to the user), there is
 * no "Pick on map" flow, and "Use my location" re-pins (watchPosition warm-up). */
rows.push([html.indexOf('id="report-use-center"') === -1 ? 'OK  ' : 'MISS', '"Use park centre" button removed from the form']);
rows.push([js.indexOf('report-use-center') === -1 ? 'OK  ' : 'MISS', 'no orphaned handler for the removed button']);
rows.push([html.indexOf('report-pick-map') === -1 ? 'OK  ' : 'MISS', '"Pick on map" removed from the form']);
check('"Use my location" is offered', 'id="report-use-location"', html);
check('the form keeps the hidden lat input', 'id="report-lat"', html);
check('the form keeps the hidden lng input', 'id="report-lng"', html);
rows.push([html.indexOf('id="report-lat" type="hidden"') !== -1 &&
  html.indexOf('id="report-lng" type="hidden"') !== -1 ? 'OK  ' : 'MISS',
  'lat/lng inputs are hidden from the user']);
check('the form shows a pick hint', 'id="report-pick-hint"', html);
/* Species: the select was cut down to Cat / Dog / Other. "Other" is the
   catch-all - unknown species already fall back to the default urgency
   policy (speciesRule) and the generic paw emoji (speciesInfo). */
const speciesSelStart = html.indexOf('id="report-species"');
const speciesSel = speciesSelStart === -1 ? '' : html.slice(speciesSelStart, html.indexOf('</select>', speciesSelStart));
rows.push([speciesSel.indexOf('value="cat"') !== -1 &&
  speciesSel.indexOf('value="dog"') !== -1 &&
  speciesSel.indexOf('value="other"') !== -1 ? 'OK  ' : 'MISS', 'species select offers Cat, Dog, Other']);
rows.push([speciesSel.indexOf('value="rabbit"') === -1 &&
  speciesSel.indexOf('value="bird"') === -1 &&
  speciesSel.indexOf('value="guinea-pig"') === -1 ? 'OK  ' : 'MISS', 'Rabbit/Bird/Guinea pig are no longer report options']);
rows.push([js.indexOf("const offeredSpecies = ['cat', 'dog', 'other'];") !== -1 &&
  js.indexOf('offeredSpecies.indexOf(animal.species)') !== -1 ? 'OK  ' : 'MISS',
  'editing an unlisted species parks it on Other']);
rows.push([html.indexOf('id="report-pinbar"') === -1 ? 'OK  ' : 'MISS', 'pin-first bar removed (form-first flow restored)']);
rows.push([html.indexOf('id="report-change-loc"') === -1 ? 'OK  ' : 'MISS', 'read-only Change-location link removed']);
rows.push([js.indexOf('openPinFirst') === -1 && js.indexOf('wirePinbar') === -1 ? 'OK  ' : 'MISS', 'no pin-first helpers left behind']);
check('report entry opens the form', 'function openReportModal()', js);
check('openReportModal resets the form', 'form.reset();', js);
rows.push([/if \(!hasLocation\)\s*\{\s*requestReportLocation\(\);\s*return;\s*\}/.test(js) ? 'OK  ' : 'MISS',
  'report form requires a valid user location']);
check('report without location opens the location prompt',
  'Your location is required to place this report accurately.', js);
rows.push([/if \(state\.pendingReportOpen\)\s*\{\s*state\.pendingReportOpen = false;\s*void openReportModal\(\);/.test(js) ? 'OK  ' : 'MISS',
  'report opens after location is acquired']);
rows.push([/state\.pendingReportOpen = false;\s*hideLocationPrompt\(true\);/.test(js) ? 'OK  ' : 'MISS',
  'dismissing the location prompt cancels the pending report']);
rows.push([js.indexOf("modal.classList.add('fta-picking')") === -1 ? 'OK  ' : 'MISS', 'pick-on-map panel docking is gone']);
rows.push([js.indexOf('state.pickMode = true;') === -1 ? 'OK  ' : 'MISS', 'pick-on-map arming is gone']);
rows.push([js.indexOf('if (state.pickMode) placePickMarker(') === -1 ? 'OK  ' : 'MISS', 'map taps never move the report pin']);
check('geolocation request still exists', 'getCurrentPosition(', js);
check('geolocation keeps high accuracy', 'enableHighAccuracy: true', js);
check('location onboarding prompt is present', 'id="location-prompt"', html);
check('location icon is aligned inline with the prompt heading',
  'fta-location-prompt__title-icon material-symbols-outlined', html);
check('location prompt has an explicit opt-in action', 'id="location-enable-btn"', html);
check('location prompt can be dismissed', 'id="location-dismiss-btn"', html);
check('mobile location control is visibly labelled', 'class="text-xs font-semibold">Near me</span>', html);
check('location permission is not requested automatically at startup', 'initLocationPrompt();', js);
rows.push([js.indexOf('function openAtVisitor') === -1 ? 'OK  ' : 'MISS',
  'automatic geolocation-on-load flow is removed']);
check('location prompt opt-in uses the normal location flow',
  "locationEnableButton.addEventListener('click', locateMe)", js);
check('dismissed prompt is remembered for the current tab session',
  'fta.location-prompt-dismissed.v1', js);
check('blocked location shows browser permission recovery guidance',
  'Allow it in this site’s browser permissions', js);
check('insecure origin explains the HTTPS requirement',
  'Location requires a secure connection', js);
/* The button must show a pending state, otherwise a slow GPS fix looks broken. */
check('use-my-location shows a locating state', 'setLocating(true)', js);
check('locating state has a visible label', 'Locating…', js);
check('locating state shows a spinner', 'animate-spin', js);
check('locating state disables the button', 'useMyLocationButton.disabled = busy', js);
rows.push([(js.match(/setLocating\(false\)/g) || []).length >= 2 ? 'OK  ' : 'MISS',
  'locating state clears on BOTH success and failure (' + (js.match(/setLocating\(false\)/g) || []).length + ' calls)']);
check('location success reports the accuracy', 'Pinned at your location (accurate to about', js);
check('permission denial is explained', 'Location permission denied', js);
check('failure suggests a GPS retry', 'allow location access', js);
check('geolocation timeout allows a slow fix', 'timeout: 15000', js);
/* Regression: setValue()/value() used to exist only as LOCAL copies inside
   openEditReport/submitReport, so callers outside those two functions crashed
   with ReferenceError and the Report button did nothing. They must be declared
   at module scope, BEFORE first use. */
rows.push([js.indexOf('const setValue =') !== -1 &&
  js.indexOf('const setValue =') < js.indexOf('function openEditReport') ? 'OK  ' : 'MISS',
'setValue() is at module scope, before openEditReport']);
rows.push([js.indexOf('const value = (id)') !== -1 &&
  js.indexOf('const value = (id)') < js.indexOf('function submitReport') ? 'OK  ' : 'MISS',
'value() is at module scope, before submitReport']);
check('report pin is NOT draggable (GPS-only)', 'draggable: false', js);
rows.push([/Use park center|Use park centre/.test(js) === false ? 'OK  ' : 'MISS',
  'no copy references the removed button']);

/* --- honest landmarks ------------------------------------------------- *
 * Bug: the auto label named the nearest demo station for EVERY pin (and a
 * hard-coded "Oakwood Park" when none was loaded), so a real GPS report
 * thousands of km from the park claimed to be dropped inside it. The label
 * must come from a station actually next to the pin, or from the
 * reverse-geocoded city - and legacy labels must rebuild on load. */
rows.push([js.indexOf("'Dropped pin near ' + (station") === -1 ? 'OK  ' : 'MISS',
  'the unconditional nearest-station landmark is gone']);
check('the landmark helper exists', 'function fillPlaceLabel(lat, lng)', js);
check('a station only names the pin when it is near', '<= 3000', js);
check('far pins fall back to the reverse-geocoded city', "'Dropped pin near ' + geo.city", js);
check('submit rebuilds an empty landmark from the resolved city', 'place = geoCity', js);
check('legacy far-away labels are rebuilt on load',
  'haversine(animal.location, state.meta.center) > 20000', js);

/* --- GPS accuracy + pin/dot consistency ----------------------------- *
 * Bug: placePickMarker() wrote the report pin but never updated
 * state.userLocation, so the blue "you are here" dot kept rendering a
 * stale fix from localStorage. A correct pin then looked misplaced. */
check('placePickMarker accepts options', 'function placePickMarker(lat, lng, options)', js);
check('placePickMarker takes a fromGps flag', 'opts.fromGps', js);
check('a GPS pin updates state.userLocation', 'state.userLocation = { lat: lat, lng: lng };', js);
check('a GPS pin re-renders the blue dot', 'renderUserMarker(opts.accuracy)', js);
// A report-form GPS pin must NOT be persisted as the map reference, and must
// never move the viewport - dropping a report pin is not "near me".
const pinBlock = js.slice(js.indexOf('if (opts.fromGps)'), js.indexOf('if (opts.fromGps)') + 260);
rows.push([pinBlock.indexOf('writeOverlay') === -1 ? 'OK  ' : 'MISS', 'a GPS pin does not persist as a map reference']);
rows.push([/flyTo|setView/.test(pinBlock) === false ? 'OK  ' : 'MISS', 'a GPS pin never moves the viewport']);
check('the pin carries the GPS accuracy', 'accuracy: accuracy', js);
check('accuracy is shown to the user', 'accurate to about', js);
check('a rough fix warns the user', 'GPS was only accurate to about', js);
// The accuracy circle makes precision visible instead of a bare dot.
check('renderUserMarker accepts an accuracy', 'function renderUserMarker(accuracy)', js);
check('an accuracy circle is drawn', 'window.L.circle(', js);
check('the accuracy circle uses the GPS radius', 'radius: accuracy', js);
check('the accuracy circle is removed before redrawing', 'state.map.removeLayer(state.accuracyCircle)', js);
check('accuracyCircle is declared in state', 'accuracyCircle: null', js);
// A single cold fix is usually the worst one; watchPosition warms up and the
// watch is cleared as soon as a good reading arrives.
check('uses watchPosition for the first fix', 'watchPosition(', js);
check('the GPS watch is always cleared', 'clearWatch(watchId)', js);
rows.push([(js.match(/clearWatch\(watchId\)/g) || []).length >= 2 ? 'OK  ' : 'MISS',
  'clears the GPS watch on BOTH success and failure']);
check('GPS caching is disabled for report pins', 'maximumAge: 0', js);
check('locateMe also passes accuracy', 'renderUserMarker(position.coords.accuracy)', js);

/* --- "Near Me" is global: it takes you to you ------------------------ *
 * A saved GPS point must not become the STARTUP reference (the map still
 * opens on the park, so distances stay stable across reloads), but once the
 * visitor asks to be located, the map flies to them and every distance/sort
 * re-measures from where they actually are. */
rows.push([/state\.userLocation = overlay\.userLocation \|\| state\.meta\.center/.test(js) === false ? 'OK  ' : 'MISS',
  'a saved GPS point is not used as the map reference on load']);
check('referencePoint prefers the visitor, then the park centre',
  'const referencePoint = () => state.userLocation || state.meta.center', js);
// locateMe must fly the viewport to the visitor, not leave them off screen.
const locateBlock = js.slice(js.indexOf('function locateMe()'), js.indexOf('function useParkCenter()'));
rows.push([/flyTo|setView/.test(locateBlock) ? 'OK  ' : 'MISS',
  '"Near Me" moves the map viewport to the visitor']);
check('"Near Me" flies to the visitor, not the park',
  'state.map.flyTo([state.userLocation.lat, state.userLocation.lng]', js);
check('"Near Me" confirms where it took you', 'Showing your location', js);
rows.push([/renderFeed\(\)/.test(locateBlock) ? 'OK  ' : 'MISS',
  '"Near Me" re-measures the list from the visitor']);
/* Scolding the volunteer for WHERE they are was removed on purpose. The
   phrase still appears in an explanatory comment in index.js, so test the
   CODE, not the prose: strip comments first (same trick as jsCode below). */
const scoldFreeJs = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
rows.push([/inside the mapped area|outside the mapped area/.test(scoldFreeJs) === false ? 'OK  ' : 'MISS',
  'the park inside/outside scolding is gone']);
check('reset clears the stored location', 'state.userLocation = null;', js);
check('reset re-frames the whole park', 'showing the whole', js);
/* ONE camera move at boot: each extra move downloads a full screen of tiles
   that the next move throws away (it used to be setView -> fitToPark ->
   flyTo = three screens per visit). The opening frame is decided in initMap()
   from the saved position or the park bounds. */
check('map opens on the saved visitor position', 'state.map.setView([cached.lat, cached.lng], 16);', js);
check('first visit frames the park in ONE move', 'fitToPark({ animate: false })', js);
check('the opening view counts as framed (no second refit)', 'state.fitted = true;', js);
rows.push([/flyTo\(\[cached\.lat/.test(js) === false ? 'OK  ' : 'MISS',
  'boot does not fly to the position it just opened on']);

/* --- opening view shows the WHOLE park ------------------------------- *
 * The old fitBounds() used the filtered subset and carried maxZoom: 15,
 * so the park (1.7km across) never fitted in one screen. */
check('fitToPark() helper exists', 'function fitToPark(options)', js);
check('opening fit is delegated to fitToPark', 'fitToPark();', js);
check('fitToPark includes every animal', 'state.animals.forEach((a) => points.push', js);
check('fitToPark includes every station', 'state.stations.forEach((s) => points.push', js);
check('fitToPark includes the park centre', 'if (centre) points.push([centre.lat, centre.lng])', js);
// The subset bug: fitting rows (filtered) instead of the whole dataset.
rows.push([/const bounds = \[\];[\s\S]{0,400}bounds\.push/.test(js) === false ? 'OK  ' : 'MISS',
  'fit no longer uses the filtered marker subset']);
const fitBlock = js.slice(js.indexOf('function fitToPark(options)'), js.indexOf('function animalMarker('));
// Strip comments first: the rationale comment mentions "maxZoom" by name.
const fitCode = fitBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
rows.push([/maxZoom/.test(fitCode) === false ? 'OK  ' : 'MISS',
  'fitToPark has no maxZoom cap (that blocked zooming out to the full park)']);
check('fitToPark pads the bounds slightly', '.pad(0.08)', js);
check('reset button re-frames the whole park', 'fitToPark({ animate: true });', js);
check('map starts zoomed out before fitting', 'state.meta.startZoom || 13', js);
rows.push([/state\.meta\.defaultZoom \|\| 15\);[\s\S]{0,40}attributionControl/.test(js) === false ? 'OK  ' : 'MISS',
  'initial setView no longer starts at a close-in defaultZoom']);

/* compression + upload helpers on the client */
check('sbCompressImage() defined', 'async function sbCompressImage', sc);
check('compression caps the longest edge at 1200px', 'maxEdge: 1200', sc);
check('compression targets a ~110KB budget', 'targetBytes: 110 * 1024', sc);
check('compression has a hard cap under the bucket limit', 'hardCapBytes: 460 * 1024', sc);
check('compression keeps a quality floor', 'minQuality: 0.45', sc);
check('compression prefers AVIF', "type: 'image/avif'", sc);
check('compression encodes WebP', "'image/webp'", sc);
check('compression falls back when it cannot convert', 'return file;', sc);
check('sbSubmitReport() defined', 'async function sbSubmitReport', sc);
check('sbSubmitReport writes photo_url', 'photo_url: report.photoUrl', sc);
check('sbSubmitReport returns the new row id', "return (result.data && result.data.id) || true;", sc);
check('sbSubmitReport asks for the id back', ".insert([payload]).select('id').single()", sc);

/* --- reports must be READ, not just written --------------------------- *
 * Bug: sbSubmitReport() inserted into `reports` but nothing ever selected
 * from it. Every report was therefore invisible to other users and the map
 * stayed empty. These assert the read half exists and is wired into boot. */
check('sbLoadReports() defined', 'async function sbLoadReports', sc);
check('sbLoadReports selects from reports', "sb.from('reports')", sc);
check('sbLoadReports maps location_label to location.label', "label: label", sc);
check('sbLoadReports maps photo_url to photoUrl', 'photoUrl: row.photo_url', sc);
check('sbLoadReports stamps a stable id', "'report-' + String(row.id)", sc);
check('sbLoadReports drops coordinate-less reports', 'null island', sc);
check('sbLoadReports is exported', 'window.sbLoadReports = sbLoadReports', sc);
check('boot() fetches community reports', "getFn('sbLoadReports')", js);
check('boot() merges them into state.animals', 'state.animals = Array.from(merged.values())', js);
check('boot() re-renders after merging reports', 'added + \' community report\'', js);
/* The local pin must adopt the cloud id, or one report pins twice. */
check('a shared report keeps the cloud row id', "'report-' + shared :", js);
check('sbUploadReportPhoto returns null with no file', 'if (!file) return null;', sc);
check('sbSubmitReport exposed on window', 'window.sbSubmitReport = sbSubmitReport;', sc);
check('sbCompressImage exposed on window', 'window.sbCompressImage = sbCompressImage;', sc);
/* --- editing a report must reach the shared copy ---------------------- *
 * index.js calls window.sbUpdateReport() when an edit saves. It did not
 * exist: the typeof guard skipped the write while sharedOk stayed true, so
 * the toast claimed "Saved - on the map for everyone" and the next reload
 * restored the old photo and name. These assert the writer exists, is
 * exported, and that a missing writer fails the save honestly. */
check('sbUpdateReport() defined', 'async function sbUpdateReport', sc);
check('sbUpdateReport patches the reports row', "from('reports').update(", sc);
check('sbUpdateReport asks which rows changed', "update(patch).eq('id', report.id).select('id')", sc);
check('sbUpdateReport writes photo_url', 'photo_url: report.photoUrl || null', sc);
check('sbUpdateReport encodes the needs markers', "'[NEEDS_VET] ' + description", sc);
check('sbUpdateReport exposed on window', 'window.sbUpdateReport = sbUpdateReport;', sc);
check('a cloud-id edit always attempts the shared save', 'if (isCloudReportId(editing.id)) {', js);
check('a missing writer fails the shared save instead of lying', 'sharedOk = false;', js);
/* Owner-only in the DATABASE, not just in the button. */
check('reports allow only their reporter to update', 'create policy "reporter update reports" on reports for update', core);
check('the update policy matches auth.uid() to reporter_id', 'using (auth.uid() = reporter_id)', core);
const editMigPath = path.join(ROOT, 'supabase', 'migration-report-edit.sql');
const editMig = fs.existsSync(editMigPath) ? fs.readFileSync(editMigPath, 'utf8') : '';
check('migration-report-edit.sql carries the owner policy', 'reporter update reports', editMig);
check('the migration adds reporter_id when the table predates it', 'add column if not exists reporter_id', editMig);
/* Popups must build their content at OPEN time: popupHtml() embeds
   canManageReport() (the Edit button) and state.myId only resolves once
   auth answers - a string bound at marker-render time froze "no edit
   button" into every popup opened before that. */
check('popup content is rebuilt on every open', 'bindPopup(() => popupHtml(row)', js);
/* "Remove photo" during an edit must clear photo_url on save, not silently
   keep the old file. */
check('removing a photo in edit mode clears it on save', 'reportPhotoRemoved ? null : (editing.photoUrl || null)', js);
check('sbFormatBytes exposed on window', 'window.sbFormatBytes = sbFormatBytes;', sc);
// Regression guard: sbSearchQuality calls sbEncodeCanvas. A missing definition
// would be swallowed by sbCompressImage's catch, silently uploading the
// uncompressed original, so assert the definition exists and comes first.
check('sbEncodeCanvas is defined (not just called)', 'function sbEncodeCanvas(', sc);
rows.push([sc.indexOf('function sbEncodeCanvas(') < sc.indexOf('await sbEncodeCanvas(') ? 'OK  ' : 'MISS',
  'sbEncodeCanvas is defined before sbSearchQuality uses it']);

/* sbCompressImage must actually shrink a large image. Run it in a sandbox
   with a fake canvas + ImageBitmap to prove the math, without a browser. */
/* Run the real compression pipeline against a simulated encoder.
 *
 * The stub models how a real encoder behaves: output bytes grow with both
 * pixel count and quality, AVIF beats WebP at equal quality, and a format
 * the browser cannot encode silently comes back as PNG. That lets us assert
 * the *strategy* (format choice, binary search, dimension stepping, budget)
 * rather than just that some function ran. */
/* Extract a whole top-level declaration by slicing between the comment
   banners that separate each block. Brace counting is not reliable here:
   sbEncodeCanvas has an arrow body, and sbCompressImage has an `= {}`
   default parameter that opens a brace before the real body. */
const sbSlice = (startMarker, endMarker) => {
  const start = sc.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? sc.indexOf(endMarker, start + startMarker.length) : -1;
  if (end === -1) return '';
  return sc.slice(start, end);
};

function loadEncoder(box) {
  const ctx = vmMod.createContext(box);
  // NB: sbEncodeCanvas must be sliced first, because its marker text also
  // appears inside sbCompressImage's body (same function name).
  const parts = [
    sbSlice('const SB_IMAGE_DEFAULTS = {', '/* Which formats'),
    sbSlice('function sbEncodeCanvas(', '/* Highest quality'),
    sbSlice('let sbImageFormatPromise = null;', '/* Highest quality'),
    sbSlice('/* Highest quality whose encoded size', '/* Compress an image File'),
    sbSlice('/* Compress an image File', '/* Human-readable'),
    sbSlice('/* Human-readable', '/* Compress then upload'),
  ];
  parts.forEach((code) => { if (code) vmMod.runInContext(code, ctx); });
  return ctx;
}

function makeEncoderBox(opts) {
  const o = opts || {};
  const calls = [];
  let decodeOptions = null;
  let bitmapCloseCount = 0;
  const encode = (type, quality, width, height) => {
    calls.push({ type, quality, width, height });
    if (o.unsupported && o.unsupported.indexOf(type) !== -1) {
      // Some browsers silently fall back to PNG instead of failing.
      return { size: 9999, type: 'image/png' };
    }
    // bytes ~ pixels * quality, with a per-format efficiency factor
    const factor = type === 'image/avif' ? 0.62 : type === 'image/webp' ? 0.85 : 1.0;
    return { size: Math.round(width * height * factor * quality * 0.55), type };
  };
  return {
    calls,
    decodeOptions: () => decodeOptions,
    createImageBitmap: async (_file, options) => {
      decodeOptions = options || null;
      const originalWidth = o.w || 4000;
      const originalHeight = o.h || 3000;
      const scale = decodeOptions && !o.ignoreResize
        ? Math.min(1, decodeOptions.resizeWidth / originalWidth)
        : 1;
      return {
        width: Math.round(originalWidth * scale),
        height: Math.round(originalHeight * scale),
        close() { bitmapCloseCount++; },
      };
    },
    bitmapCloseCount: () => bitmapCloseCount,
    document: {
      createElement: () => {
        const canvas = {
          width: 0, height: 0,
          getContext: () => ({ drawImage: (_b, _x, _y, w, h) => { canvas._w = w; canvas._h = h; } }),
          toBlob: (cb, type, quality) => {
            const isProbe = canvas.width === 1;
            if (isProbe && o.supportedAvif === false && type === 'image/avif') {
              return cb({ size: 1, type: 'image/png' });
            }
            const r = encode(type, quality, canvas.width, canvas.height);
            // A real Blob exposes .size; mirror it so the File we build later
            // reports the true byte count instead of 0.
            return cb({ size: r.size, type: r.type });
          },
        };
        return canvas;
      },
    },
    // `new File([blob], name, opts)` passes an ARRAY of parts, so read the
    // first element's .size - that is where the real byte count lives.
    File: class {
      constructor(parts, name, o2) {
        const first = Array.isArray(parts) ? parts[0] : parts;
        this.name = name;
        this.type = o2.type;
        this.size = (first && first.size) || 0;
      }
    },
    Object, Math, Promise, RegExp, Error, console, Date,
  };
}

const realEncodes = (box) => box.calls.filter((c) => c.width > 1);
const longestEdge = (box) => Math.max.apply(null, realEncodes(box).map((c) => Math.max(c.width, c.height)));
const BUDGET = 110 * 1024;

(async () => {
  // 1. a big photo lands near the budget, not merely "under the cap"
  {
    const box = makeEncoderBox({});
    const out = await loadEncoder(box).sbCompressImage({ name: 'cat.jpg', type: 'image/jpeg', size: 6_000_000 });
    rows.push([box.decodeOptions() && Math.max.apply(null, realEncodes(box).map((c) => Math.max(c.width, c.height))) <= 1200
      ? 'OK  ' : 'MISS', 'large photos are downsampled by the decoder before canvas processing']);
    rows.push([box.bitmapCloseCount() === 1 ? 'OK  ' : 'MISS',
      'decoded image memory is released after compression']);
    rows.push([out.type === 'image/avif' ? 'OK  ' : 'MISS', 'picks AVIF when supported (got ' + out.type + ')']);
    rows.push([out.size <= BUDGET ? 'OK  ' : 'MISS', 'hits the ~110KB budget: 6MB -> ' + Math.round(out.size / 1024) + 'KB']);
    rows.push([longestEdge(box) <= 1200 ? 'OK  ' : 'MISS', 'never exceeds the 1200px long edge (got ' + longestEdge(box) + ')']);
    rows.push([realEncodes(box).length >= 3 ? 'OK  ' : 'MISS', 'binary-searches quality (' + realEncodes(box).length + ' passes)']);
    rows.push([out.name.endsWith('.avif') ? 'OK  ' : 'MISS', 'names the file with a matching extension']);
  }
  {
    const box = makeEncoderBox({ ignoreResize: true });
    let rejected = false;
    try {
      await loadEncoder(box).sbCompressImage({ name: 'large.jpg', type: 'image/jpeg', size: 6_000_000 });
    } catch (e) {
      rejected = /too large for this browser to process safely/.test(e.message);
    }
    rows.push([rejected ? 'OK  ' : 'MISS', 'fails safely if the browser ignores image resize options']);
    rows.push([box.bitmapCloseCount() === 1 ? 'OK  ' : 'MISS',
      'releases decoded image memory when resizing is unsupported']);
  }
  // 2. no AVIF support -> WebP
  {
    const box = makeEncoderBox({ supportedAvif: false });
    const out = await loadEncoder(box).sbCompressImage({ name: 'dog.jpg', type: 'image/jpeg', size: 5_000_000 });
    rows.push([out.type === 'image/webp' ? 'OK  ' : 'MISS', 'falls back to WebP without AVIF (got ' + out.type + ')']);
    rows.push([out.size <= BUDGET ? 'OK  ' : 'MISS', 'WebP fallback still fits the budget (' + Math.round(out.size / 1024) + 'KB)']);
  }
  // 3. an already-small modern image is left alone
  {
    const box = makeEncoderBox({});
    const small = { name: 'tiny.webp', type: 'image/webp', size: 40 * 1024 };
    rows.push([(await loadEncoder(box).sbCompressImage(small)) === small ? 'OK  ' : 'MISS', 'does not re-encode an already-small WebP']);
    rows.push([box.calls.length === 0 ? 'OK  ' : 'MISS', 'skips the encoder entirely for a tiny modern image']);
  }
  // 4. never upscales
  {
    const box = makeEncoderBox({ w: 640, h: 480 });
    await loadEncoder(box).sbCompressImage({ name: 'small.jpg', type: 'image/jpeg', size: 900_000 });
    rows.push([longestEdge(box) <= 640 ? 'OK  ' : 'MISS', 'never upscales a 640x480 photo (got ' + longestEdge(box) + ')']);
  }
  // 5. pathological: neither modern format encodes, so quality alone cannot
  //    fit the budget and the encoder must step the dimensions down
  {
    const box = makeEncoderBox({ w: 12000, h: 9000, unsupported: ['image/avif', 'image/webp'] });
    const out = await loadEncoder(box).sbCompressImage({ name: 'huge.jpg', type: 'image/jpeg', size: 40_000_000 });
    rows.push([out.type === 'image/jpeg' ? 'OK  ' : 'MISS', 'falls back to JPEG when modern formats fail']);
    const tried = [...new Set(realEncodes(box).map((c) => Math.max(c.width, c.height)))];
    rows.push([tried.length > 1 ? 'OK  ' : 'MISS', 'steps down when quality alone cannot fit (' + tried.join('>') + ')']);
    rows.push([out.size <= BUDGET ? 'OK  ' : 'MISS', 'still fits the budget after stepping down (' + Math.round(out.size / 1024) + 'KB)']);
  }
  // 6. pass-throughs
  {
    const ctx = loadEncoder(makeEncoderBox({}));
    const gif = { name: 'a.gif', type: 'image/gif', size: 2_000_000 };
    rows.push([(await ctx.sbCompressImage(gif)) === gif ? 'OK  ' : 'MISS', 'passes GIFs through untouched']);
    const pdf = { name: 'a.pdf', type: 'application/pdf', size: 10 };
    rows.push([(await ctx.sbCompressImage(pdf)) === pdf ? 'OK  ' : 'MISS', 'passes non-images through untouched']);
    rows.push([(await ctx.sbCompressImage(null)) === null ? 'OK  ' : 'MISS', 'handles a null file']);
  }
  // 7. byte formatting
  {
    const ctx = loadEncoder(makeEncoderBox({}));
    rows.push([ctx.sbFormatBytes(512) === '512 B' ? 'OK  ' : 'MISS', 'sbFormatBytes() formats bytes']);
    rows.push([ctx.sbFormatBytes(96 * 1024) === '96 KB' ? 'OK  ' : 'MISS', 'sbFormatBytes() formats kilobytes']);
    rows.push([ctx.sbFormatBytes(4.2 * 1048576) === '4.2 MB' ? 'OK  ' : 'MISS', 'sbFormatBytes() formats megabytes']);
  }
  finish();
})().catch((e) => { rows.push(['MISS', 'compression harness threw: ' + e.message]); finish(); });

/* --- Phase 6: deploy surface (MVP blocker) ---------------------------- *
 * A broken internal link is a 404 in production, so assert every local
 * href/src in every shipped page actually exists on disk. */
const pages = ['index.html', 'activity.html', 'auth.html', 'privacy.html', 'terms.html', 'community.html', '404.html', 'inbox.html', 'cities.html'];
// The shared navbar must exist on EVERY shipped page.
rows.push([fs.existsSync(path.join(ROOT, 'site-header.js')) ? 'OK  ' : 'MISS', 'deploy file present: site-header.js']);
pages.forEach((file) => {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  rows.push([body.includes('id="site-header"') ? 'OK  ' : 'MISS', file + ' uses the shared header placeholder']);
  rows.push([body.includes('src="site-header.js"') ? 'OK  ' : 'MISS', file + ' loads site-header.js']);
  // A hard-coded header would drift out of sync again - that is the bug.
  rows.push([body.includes('Support Animal Relief') ? 'MISS' : 'OK  ', file + ' has no hard-coded navbar']);
  rows.push([body.includes('has-site-header') || body.includes('pt-[68px]') ? 'OK  ' : 'MISS',
    file + ' clears the fixed navbar']);
});

const header = fs.readFileSync(path.join(ROOT, 'site-header.js'), 'utf8');
check('the navbar is defined in exactly one file', 'var LINKS = [', header);
check('the navbar has a Map link', "label: 'Map'", header);
rows.push([header.toLowerCase().indexOf('leaderboard') === -1 ? 'OK  ' : 'MISS',
  'the navbar has no Leaderboard link']);
check('the navbar has an Activity link', "label: 'Activity'", header);
check('the navbar has a Cities link', "label: 'Cities'", header);
/* Cities is a real page now - a dead index.html#cities href would 404-adjacent
   (it never opened anything), so pin both entries to the shipped file. */
check('the Cities links point at the real page', "href: 'cities.html'", header);
check('the map accepts a #city= deep link from cities.html', "params.get('city')", js);
check('the navbar has a Community link', "label: 'Community'", header);
check('the navbar keeps the Support button', 'Support Animal Relief', header);
check('the navbar keeps the brand', 'FeedAnAnimalMap', header);
/* The brand mark graduated from a 🐾 glyph to logo/logo.png - assert the
   navbar still RENDERS a logo and that the file actually ships, otherwise
   every page shows a broken image where the paw used to be. */
check('the navbar keeps the logo image', 'logo/logo.png', header);
rows.push([fs.existsSync(path.join(ROOT, 'logo/logo.png')) ? 'OK  ' : 'MISS',
  'the shipped logo file exists']);
check('the active nav item is derived, not hard-coded', 'function currentId(', header);
check('the Sign in label is wired on every page', 'auth-link-label', header);

// Regression: the Material palette used to be inlined in index.html only, so
// every other page rendered this navbar UNSTYLED (the classes did not exist).
// The theme must now load on EVERY page, and AFTER the Tailwind CDN.
/* ------------------------------------------------------------------ *
 * Declaration order matters for the checkbox flags below: sbSubmitReport()
 * is called before the animal object is built, so a `const` declared after
 * that call throws a temporal dead zone ReferenceError. Strip comments first so
 * the ordering tests look at real code, not the comments describing it.
 * ------------------------------------------------------------------ */
const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/* --- details drawer hides facts we do not know -------------------------- *
 * The report form no longer asks for sex, age, temperament or neuter status,
 * so a reported stray fills them with 'unknown'/false. Printing those anyway
 * produced confident-looking noise ("Vaccinated: No", "Sex / age: unknown")
 * that read as real observations and made the profile look broken. */
check('detailRow skips unknown values', 'if (isUnknown(value)) return \'\';', js);
check('unknown covers the placeholder strings', "text === 'not recorded'", js);
check('unknown covers "unknown"', "text === 'unknown'", js);
check('zero counts are hidden', 'if (n <= 0) return \'\';', js);
check('care flags only render when yes', "animal.sterilized ? detailRow('Neutered', 'Yes')", js);
check('no bare "Vaccinated: No" row', js.indexOf("detailRow('Vaccinated', yesNo") === -1 ? true : false, js);
check('the yesNo helper is gone', js.indexOf('const yesNo =') === -1 ? true : false, js);
/* Stale: the seed data was removed, so this warning is now a lie. */
rows.push([js.indexOf('Demo pins use fictional') === -1 ? 'OK  ' : 'MISS',
  'the stale "fictional Seattle coords" note is gone']);
check('the reporter name is stored', 'reporterName:', js);
check('the drawer credits the reporter once', "detailRow('Reported by'", js);
check('community reports do not repeat caretaker as reporter', "animal.source !== 'report' ? detailRow('Caretakers'", js);
check('species is not repeated in the detail rows', js.indexOf("detailRow('Species'") === -1 ? true : false, js);
check('device-only care history is conditionally rendered', '(historyHtml', js);
check('community-report tag is not displayed as a detail', "animal.tags.filter((tag) => tag !== 'community-report')", js);
check('generic report description is omitted', "['reported by community', 'reported by a community volunteer']", js);
check('the drawer subtitle still drops unknown colour',
  'animal.color].filter((part) => !isUnknown(part))', js);

/* --- breed removed from the UI, tools and schema ---------------------- *
 * The popup used to print "Cat (breed unknown) - unknown - unknown": a field
 * the report form never fills in. Nothing may reintroduce it anywhere in the
 * stack; the database column itself goes away via migration-drop-breed.sql. */
[
  ['index.js', js],
  ['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')],
  ['supabase-client.js', sc],
  ['supabase/schema-core.sql', core],
  ['tools/seed-supabase.js', fs.readFileSync(path.join(ROOT, 'tools', 'seed-supabase.js'), 'utf8')],
  ['tools/build-data.js', fs.readFileSync(path.join(ROOT, 'tools', 'build-data.js'), 'utf8')]
].forEach(function (entry) {
  rows.push([entry[1].indexOf('breed') === -1 ? 'OK  ' : 'MISS', entry[0] + ' has no breed']);
});
const dropBreedMig = path.join(ROOT, 'supabase', 'migration-drop-breed.sql');
check('migration-drop-breed.sql drops the column', 'drop column if exists breed',
  fs.existsSync(dropBreedMig) ? fs.readFileSync(dropBreedMig, 'utf8') : '');

/* --- modal close buttons are real controls ------------------------------ *
 * The X used to be a bare 32px glyph in the title row with no border, so it
 * read as decoration and collided with the "20m away" line below it. It needs
 * a visible resting state, a hover state, an accessible name and shrink-0 so a
 * long animal name can never squeeze it. */
check('details close has an accessible name', 'aria-label="Close details"', js);
check('details close has a resting border', 'border border-surface-container-highest bg-surface-container-low', js);
check('details close has a hover state', 'hover:bg-surface-container hover:text-on-surface', js);
check('details close has a pressed state', 'active:scale-90', js);
check('details close cannot be squeezed by a long name', "class=\"shrink-0 -mt-1 -mr-1 w-9 h-9", js);
check('the title column reserves room for the close button', 'flex-1 min-w-0 pr-10', js);
rows.push([/w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline/.test(js) === false ? 'OK  ' : 'MISS',
  'the old borderless 32px close button is gone']);
check('the distance line truncates instead of wrapping', /<span class="truncate">' \+ esc\(animal\.location\.label\)/.test(js), js);
check('the modal has room around the close button', 'shadow-2xl border border-surface-container-highest p-5', html);
check('the report form close is styled too', 'aria-label="Close report form"', html);

/* --- Directions must be obvious, not an icon --------------------------- *
 * It used to render as a bare arrow glyph in a ghost pill, sharing a row with
 * Feed/Water, so it read as decoration. "How do I get to this animal" is the
 * reason most people open a pin, so every entry point spells the word out and
 * uses the solid blue treatment. */
/* index.js is served no-cache but the CSS lives in index.html, which browsers
   may still hold. An inline colour ships WITH the markup, so the two can never
   disagree and leave the label unreadable on blue. */
rows.push([(js.match(/class="fta-btn fta-btn--go[^"]*" style="color:#ffffff"/g) || []).length >= 3 ? 'OK  ' : 'MISS',
  'all three Directions anchors pin white inline']);
check('the Directions icon also pins white inline',
  (js.match(/material-symbols-outlined" style="color:#ffffff"/g) || []).length >= 3, js);
check('directions button style exists', 'a.fta-btn--go {', html);
/* Link colours get overridden constantly - Tailwind preflight targets bare
   `a`, as do Leaflet and browser defaults - so the selector has to be element-
   qualified or the white silently loses. Match the declaration itself rather
   than "\n{", so this holds with LF or CRLF line endings. */
check('directions selector is element-qualified', /a\.fta-btn--go\s*\{/.test(html), html);
check('directions style is the solid tertiary blue',
  /a\.fta-btn--go\s*\{[^}]*background:\s*#006194;[\s\S]*?color:\s*#ffffff;/.test(html), html);
check('directions text is pure white and heavy', 'font-weight: 800', html);
/* A dark text-shadow behind 13px white glyphs is what made the label read as
   translucent. Weight and size do that job instead. */
check('directions has NO dark text shadow', /text-shadow:\s*0 1px 2px/.test(html) === false ? true : false, html);
check('directions shadow is explicitly none', 'text-shadow: none;', html);
check('the popup directions goes full width', 'a.fta-btn--go.is-block { width: 100%; }', html);
/* The popup head must leave room for Leaflet's absolutely-positioned X, which
   otherwise sits on top of the distance and renders "30m" as "30X". */
check('the popup head reserves room for the close X',
  /fta-popup__head\s*\{[^}]*padding-right:\s*30px/.test(html), html);
check('the popup close X is a real circular control',
  /leaflet-popup-close-button\s*\{[\s\S]*?border-radius:\s*9999px/.test(html), html);
/* The details drawer once used its own Tailwind utilities including
   hover:opacity-95, which faded the label on hover. */
/* Match the attribute, not the prose: the word also appears in the comment
   above the markup explaining why the utility was removed. */
rows.push([/class="[^"]*hover:opacity-95[^"]*"/.test(js) === false ? 'OK  ' : 'MISS',
  'no opacity fade on the Directions button']);
rows.push([(js.match(/class="fta-btn fta-btn--go/g) || []).length >= 3 ? 'OK  ' : 'MISS',
  'all three Directions buttons share one styling class']);
/* The icon font renders via ligatures and needs these settings. The rule is
   `body`-prefixed because this <style> loads BEFORE the Tailwind CDN, which
   appends its sheet to the end of head and would otherwise win on order. */
check('icon font family is pinned', "body .material-symbols-outlined {", html);
check('icon font has ligatures enabled', "-webkit-font-feature-settings: 'liga'", html);
check('icon font is not uppercase-transformed', 'text-transform: none', html);
check('icon font keeps ligatures on one line', 'white-space: nowrap', html);
rows.push([(js.match(/Directions<\/a>/g) || []).length >= 3 ? 'OK  ' : 'MISS',
  'all three Directions entry points spell the word']);
/* The bug: an icon with no label. Guard against it coming back. */
rows.push([js.indexOf('>directions</span></a>') === -1 ? 'OK  ' : 'MISS',
  'no icon-only Directions link (the word is always shown)']);
check('animal popup directions comes before the care actions',
  js.indexOf('fta-btn--go') < js.indexOf('data-action="feed"'), js);
check('details modal leads with directions',
  js.indexOf("'<a class=\"fta-btn fta-btn--go\" target=\"_blank\" rel=\"noopener\" href=\"' + esc(directions2)") !== -1 ? true : false, js);

/* --- food / water ticks feed the timestamps ----------------------------- *
 * levelMinutes() turns these two answers into lastFedAt / lastWateredAt.
 * Dropping the questions (they were removed once already) made every report
 * fall back to 'ok' = "fed 5 minutes ago", silently filing starving animals as
 * freshly fed. Both the local timestamps and the cloud markers must exist. */
check('the form asks about food', 'id="report-needs-food"', html);
check('the form asks about water', 'id="report-needs-water"', html);
check('food is read as a checkbox', 'foodBox.checked', js);
check('water is read as a checkbox', 'waterBox.checked', js);
check('a food tick files it as urgent', "foodLevel = needsFood ? 'urgent' : 'ok'", js);
check('a water tick files it as urgent', "waterLevel = needsWater ? 'urgent' : 'ok'", js);
check('lastFedAt uses the food tick', "levelMinutes(species, 'food', foodLevel)", js);
check('lastWateredAt uses the water tick', "levelMinutes(species, 'water', waterLevel)", js);
rows.push([jsCode.indexOf('const foodLevel') !== -1 &&
  jsCode.indexOf('const foodLevel') < jsCode.indexOf("levelMinutes(species, 'food', foodLevel)")
  && jsCode.indexOf('const waterLevel') < jsCode.indexOf("levelMinutes(species, 'water', waterLevel)")
  ? 'OK  ' : 'MISS', 'food/water levels are declared before they are used']);
check('food needs are sent to the database', 'needsFood: needsFood', js);
check('water needs are sent to the database', 'needsWater: needsWater', js);
check('a food marker is written', "'[NEEDS_FOOD] '", sc);
check('a water marker is written', "'[NEEDS_WATER] '", sc);
check('the food marker is read back', "indexOf('[NEEDS_FOOD]') === 0", sc);
check('the water marker is read back', "indexOf('[NEEDS_WATER]') === 0", sc);
check('cloud reports restore saved or needs-based lastFedAt', 'lastFedAt: row.last_fed_at || new Date(nowMs', sc);
check('cloud reports restore saved or needs-based lastWateredAt', 'lastWateredAt: row.last_watered_at || new Date(nowMs', sc);
check('speciesRule() mirrors the dataset policy', 'function speciesRule(species)', sc);

/* --- the medical-help tick --------------------------------------------- *
 * Food and water are computed from timestamps, so the form only asks the one
 * thing the app cannot infer. Health must survive the round trip to other
 * users, or an injured stray arrives looking healthy. */
check('the report form asks about medical help', 'id="report-health"', html);
check('medical help is a checkbox', 'id="report-health" type="checkbox"', html);
check('it is read as .checked', 'healthBox.checked', js);
check('a ticked box marks the animal critical', "needsVet ? 'critical' : 'healthy'", js);
check('the flag is sent to the database', 'needsVet: needsVet', js);
/* Ordering: sbSubmitReport({ needsVet }) runs before the animal is built, so a
   `const` declared after that call would throw a temporal dead zone error. */
rows.push([jsCode.indexOf('const needsVet') !== -1 &&
  jsCode.indexOf('const needsVet') < jsCode.indexOf('needsVet: needsVet') ? 'OK  ' : 'MISS',
  'needsVet is declared before it is used (temporal dead zone)']);
check('critical health is written on submit', '[NEEDS_VET]', sc);
check('other users get the marker back', "indexOf('[NEEDS_VET]') === 0", sc);
check('the marker restores health on load', "health: needsVet ? 'critical' : 'healthy'", sc);
check('the marker is stripped from the description', "slice('[NEEDS_VET]'.length)", sc);
check('the tick is reset when the form reopens', 'form.reset()', js);

/* --- chat RLS: no self-referencing policy ------------------------------- *
 * A SELECT policy on conversation_participants that queried
 * conversation_participants re-entered its own policy forever. Postgres
 * raised "infinite recursion detected", which killed reads of
 * conversation_participants AND every table depending on it (messages,
 * conversations) - so chat was dead while the tables existed.
 *
 * The fix routes membership checks through SECURITY DEFINER helpers. This
 * asserts the shape of that fix so it cannot silently regress. */
const chatSql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-chat.sql'), 'utf8');
check('chat has a membership helper', 'create or replace function is_conversation_participant(', chatSql);
check('the membership helper bypasses RLS', 'security definer', chatSql);
check('the helper pins its search_path', 'set search_path = public', chatSql);
check('chat has a member-ids helper for the block check',
  'create or replace function conversation_member_ids(', chatSql);

// The actual regression: a policy on the participants table must not query
// the participants table directly. Inspect each `create policy ... on
// conversation_participants` block and fail if it self-references.
const selfRef = /create policy[^\n]*on conversation_participants[\s\S]*?;\s*\n/.exec(chatSql);
rows.push([selfRef && !/from conversation_participants/.test(selfRef[0]) ? 'OK  ' : 'MISS',
  'no policy on conversation_participants queries that same table']);
rows.push([/is_conversation_participant\(conversation_participants\.conversation_id\)/.test(chatSql) ? 'OK  ' : 'MISS',
  'the participants SELECT policy goes through the SECURITY DEFINER helper']);

// execute must stay granted, or every policy calling the helper 403s.
rows.push([/revoke execute on function is_conversation_participant/.test(chatSql) ? 'MISS' : 'OK  ',
  'execute is not revoked on the helper (policies would break)']);

// The theme must load on EVERY page, and AFTER the Tailwind CDN.
const theme = fs.readFileSync(path.join(ROOT, 'tailwind-theme.js'), 'utf8');
rows.push([theme.indexOf('primary-fixed') !== -1 ? 'OK  ' : 'MISS', 'tailwind-theme.js defines the primary-fixed palette']);
rows.push([theme.indexOf('surface-container-highest') !== -1 ? 'OK  ' : 'MISS', 'tailwind-theme.js defines surface-container-highest']);
rows.push([/tailwind\.config\s*=/.test(theme) ? 'OK  ' : 'MISS', 'tailwind-theme.js assigns tailwind.config']);
pages.forEach((file) => {
  const body = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const cdn = body.indexOf('cdn.tailwindcss.com');
  const themeAt = body.indexOf('src="tailwind-theme.js"');
  rows.push([themeAt !== -1 ? 'OK  ' : 'MISS', file + ' loads the shared theme']);
  rows.push([cdn !== -1 ? 'OK  ' : 'MISS', file + ' loads the Tailwind CDN']);
  rows.push([themeAt > cdn && cdn !== -1 ? 'OK  ' : 'MISS', file + ' loads the theme AFTER the CDN']);
});
// The navbar relies on these custom classes; without the theme they are no-ops.
// The pill styling itself moved into site-header.js's CHROME_CSS, so these are
// the theme-coloured utilities the shared header still carries in markup.
['text-primary', 'text-on-surface', 'bg-surface-container',
 'border-surface-container-highest'].forEach((cls) => {
  rows.push([header.indexOf(cls) !== -1 && theme.indexOf(cls.split('/')[0].replace(/^(bg|text|border)-/, '')) !== -1
    ? 'OK  ' : 'MISS', 'navbar class "' + cls + '" exists in the shared theme']);
});
const linked = new Set();
pages.forEach((page) => {
  const body = fs.readFileSync(path.join(ROOT, page), 'utf8');
  Array.from(body.matchAll(/(?:href|src)="(\/[^"?#]*|[A-Za-z0-9_.\/-]+\.(?:html|js|css|svg|json|txt|xml))"/g))
    .forEach((m) => {
      const target = m[1].replace(/^\//, '');
      if (target && !/^(https?:|mailto:|#)/.test(target)) linked.add(target);
    });
});
Array.from(linked).sort().forEach((target) => {
  rows.push([fs.existsSync(path.join(ROOT, target)) ? 'OK  ' : 'MISS', 'internal link resolves: ' + target]);
});

/* deploy config files that must ship */
['_headers', 'robots.txt', 'sitemap.xml', '404.html', '.nojekyll', 'og-image.svg']
  .forEach((f) => rows.push([fs.existsSync(path.join(ROOT, f)) ? 'OK  ' : 'MISS', 'deploy file present: ' + f]));

/* SEO essentials on the landing page */
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('index.html has a meta description', 'name="description"', idx);
check('index.html has Open Graph title', 'property="og:title"', idx);
check('index.html has Open Graph description', 'property="og:description"', idx);
check('index.html has an Open Graph image', 'property="og:image"', idx);
check('index.html has a favicon', 'rel="icon"', idx);
check('index.html has a canonical url', 'rel="canonical"', idx);
check('index.html sets a theme colour', 'name="theme-color"', idx);
check('favicon is an inline SVG (cannot 404)', "href=\"data:image/svg+xml,%3Csvg", idx);
check('footer links to Privacy', '/privacy.html', idx);
check('footer links to Terms', '/terms.html', idx);
check('footer has a Contact address', 'mailto:hello@feedanimals.org', idx);
// The OG image the meta tags point at has to exist.
rows.push([/og:image"\s+content="https:\/\/feedanimals\.pages\.dev\/og-image\.svg"/.test(idx) ? 'OK  ' : 'MISS',
  'og:image points at the og-image.svg we ship']);
// _headers must not cache HTML, or deploys never appear.
const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
rows.push([/no-cache/.test(headers) ? 'OK  ' : 'MISS', '_headers disables caching for HTML']);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
rows.push([typeof pkg.scripts.build === 'string' ? 'OK  ' : 'MISS', 'package.json has a build script for Pages']);
rows.push([typeof pkg.scripts.test === 'string' ? 'OK  ' : 'MISS', 'package.json has a test script']);

function finish() {
  let bad = 0;
  rows.forEach(([s, l]) => { if (s === 'MISS') bad++; console.log(s + '  ' + l); });
  console.log(bad ? '\n' + bad + ' MISSING' : '\nAll wiring present.');
  process.exit(bad ? 1 : 0);
}