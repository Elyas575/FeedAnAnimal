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
check('report form has a file picker', 'id="report-photo-file"', html);
check('file picker accepts images', 'accept="image/*"', html);
check('file picker opens the camera on mobile', 'capture="environment"', html);
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

/* --- report location pinning ---------------------------------------- */
rows.push([html.indexOf('id="report-use-center"') === -1 ? 'OK  ' : 'MISS', '"Use park centre" button removed from the form']);
rows.push([js.indexOf('report-use-center') === -1 ? 'OK  ' : 'MISS', 'no orphaned handler for the removed button']);
check('"Pick on map" is still offered', 'id="report-pick-map"', html);
check('"Use my location" is still offered', 'id="report-use-location"', html);
check('geolocation request still exists', 'getCurrentPosition(', js);
check('geolocation keeps high accuracy', 'enableHighAccuracy: true', js);
// The button must show a pending state, otherwise a slow GPS fix looks broken.
check('use-my-location shows a locating state', 'setLocating(true)', js);
check('locating state has a visible label', 'Locating…', js);
check('locating state shows a spinner', 'animate-spin', js);
check('locating state disables the button', 'useMyLocationButton.disabled = busy', js);
rows.push([(js.match(/setLocating\(false\)/g) || []).length >= 2 ? 'OK  ' : 'MISS',
  'locating state clears on BOTH success and failure (' + (js.match(/setLocating\(false\)/g) || []).length + ' calls)']);
check('location success reports the accuracy', 'Pinned at your location (accurate to about', js);
check('permission denial is explained', 'Location permission denied', js);
check('failure suggests the map alternative', 'try "Pick on map" instead', js);
rows.push([/Use park center|Use park centre/.test(js) === false ? 'OK  ' : 'MISS',
  'no copy references the removed button']);
check('geolocation timeout allows for a slow fix', 'timeout: 15000', js);

/* --- GPS accuracy + pin/dot consistency ----------------------------- *
 * Bug: placePickMarker() wrote the report pin but never updated
 * state.userLocation, so the blue "you are here" dot kept rendering a
 * stale fix from localStorage. A correct pin then looked misplaced. */
check('placePickMarker accepts options', 'function placePickMarker(lat, lng, options)', js);
check('placePickMarker takes a fromGps flag', 'opts.fromGps', js);
check('a GPS pin updates state.userLocation', 'state.userLocation = { lat: lat, lng: lng };', js);
check('a GPS pin re-renders the blue dot', 'renderUserMarker(opts.accuracy)', js);
check('a GPS pin persists the new location', 'writeOverlay();', js);
check('the pin carries the GPS accuracy', 'accuracy: accuracy', js);
check('accuracy is shown to the user', 'accurate to about', js);
check('a rough fix warns the user', 'GPS was only accurate to about', js);
// The accuracy circle makes precision visible instead of a bare dot.
check('renderUserMarker accepts an accuracy', 'function renderUserMarker(accuracy)', js);
check('an accuracy circle is drawn', 'window.L.circle(', js);
check('the accuracy circle uses the GPS radius', 'radius: accuracy', js);
check('the accuracy circle is removed before redrawing', 'state.map.removeLayer(state.accuracyCircle)', js);
check('accuracyCircle is declared in state', 'accuracyCircle: null', js);
// A single cold fix is usually the worst one; watch for a better reading.
check('uses watchPosition for the first fix', 'watchPosition(', js);
check('the GPS watch is always cleared', 'clearWatch(watchId)', js);
rows.push([(js.match(/clearWatch\(watchId\)/g) || []).length >= 2 ? 'OK  ' : 'MISS',
  'clears the GPS watch on BOTH success and failure']);
check('GPS caching is disabled for report pins', 'maximumAge: 0', js);
check('locateMe also passes accuracy', 'renderUserMarker(position.coords.accuracy)', js);

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
check('sbUploadReportPhoto returns null with no file', 'if (!file) return null;', sc);
check('sbSubmitReport exposed on window', 'window.sbSubmitReport = sbSubmitReport;', sc);
check('sbCompressImage exposed on window', 'window.sbCompressImage = sbCompressImage;', sc);
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
    createImageBitmap: async () => ({ width: o.w || 4000, height: o.h || 3000, close() {} }),
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
    rows.push([out.type === 'image/avif' ? 'OK  ' : 'MISS', 'picks AVIF when supported (got ' + out.type + ')']);
    rows.push([out.size <= BUDGET ? 'OK  ' : 'MISS', 'hits the ~110KB budget: 6MB -> ' + Math.round(out.size / 1024) + 'KB']);
    rows.push([longestEdge(box) <= 1200 ? 'OK  ' : 'MISS', 'never exceeds the 1200px long edge (got ' + longestEdge(box) + ')']);
    rows.push([realEncodes(box).length >= 3 ? 'OK  ' : 'MISS', 'binary-searches quality (' + realEncodes(box).length + ' passes)']);
    rows.push([out.name.endsWith('.avif') ? 'OK  ' : 'MISS', 'names the file with a matching extension']);
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

function finish() {
  let bad = 0;
  rows.forEach(([s, l]) => { if (s === 'MISS') bad++; console.log(s + '  ' + l); });
  console.log(bad ? '\n' + bad + ' MISSING' : '\nAll wiring present.');
  process.exit(bad ? 1 : 0);
}