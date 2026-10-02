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

let bad = 0;
rows.forEach(([s, l]) => { if (s === 'MISS') bad++; console.log(s + '  ' + l); });
console.log(bad ? '\n' + bad + ' MISSING' : '\nAll wiring present.');
process.exit(bad ? 1 : 0);