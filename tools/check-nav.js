const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* Stub just enough DOM for site-header.js to boot under Node.
   currentId() only reads location, so the module export is directly testable. */
global.location = { pathname: '/', hash: '' };
global.document = {
  readyState: 'complete',
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelectorAll: function () { return []; },
  body: null,
};
global.window = { addEventListener: function () {} };

const header = require(path.join(ROOT, 'site-header.js'));

let failed = 0;
function t(pathname, hash, want) {
  global.location = { pathname: pathname, hash: hash };
  const got = header.currentId();
  const okRow = got === want;
  if (!okRow) failed++;
  console.log((okRow ? 'OK  ' : 'FAIL') + '  ' + pathname + (hash || '')
    + '  -> ' + got + (okRow ? '' : '   (expected ' + want + ')'));
}

console.log('currentId() active-tab routing:');
t('/', '', 'index');
t('/index.html', '', 'index');
t('/index.html', '#cities', 'cities');
t('/about.html', '', 'about');
t('/community.html', '', 'community');
t('/community.html', '#leaderboard', 'community');
t('/activity.html', '', 'activity');
t('/inbox.html', '', 'inbox');
t('/auth.html', '', 'auth');
t('/privacy.html', '', 'privacy');
t('/terms.html', '', 'terms');

/* Every pill id in the LINKS nav must be reachable through currentId(),
   otherwise some tabs can never be highlighted. */
console.log('\nnav reachability:');
header.LINKS.forEach((l) => {
  const html = header.headerHtml();
  const okRow = html.indexOf('data-nav="' + l.id + '"') !== -1;
  if (!okRow) failed++;
  console.log((okRow ? 'OK  ' : 'FAIL') + '  pill "' + l.id + '" is rendered');
});

/* The navbar renders its icons as a FONT (ligatures like 'location_on'
   become glyphs only if this stylesheet loads). Two failure modes have
   bitten us here:
     1. community.html's URL declared 3 axes but 4 value-tuples - Google
        answers 400, NO font loads, and the nav degrades to raw words.
     2. four pages loaded no icon font at all.
   Both read as 'a different navbar', so this stays green forever. */
const GOOD_AXES = 'opsz,wght,FILL,GRAD';
const NAV_PAGES = ['index.html', 'community.html', 'activity.html', 'auth.html',
  'about.html', 'privacy.html', 'terms.html', '404.html', 'inbox.html'];
let fontFailed = 0;
NAV_PAGES.forEach((file) => {
  const h = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = h.match(/family=Material\+Symbols\+Outlined:([^&"']+)/);
  if (!m) { console.log('FAIL  ' + file + ': no icon font'); fontFailed++; return; }
  const axes = m[1].split('@')[0];
  const vals = (m[1].split('@')[1] || '').split(';')[0].split(',');
  const okRow = axes === GOOD_AXES && axes.split(',').length === vals.length;
  if (!okRow) fontFailed++;
  console.log((okRow ? 'OK  ' : 'FAIL') + '  ' + file.padEnd(15)
    + 'axes=' + axes + ' tuples=' + vals.length);
  const slot = h.includes('id="site-header"');
  if (slot && !m) { console.log('FAIL  ' + file + ': mounts navbar without icons'); fontFailed++; }
});
if (fontFailed) { console.error('\n' + fontFailed + ' icon-font FAILED'); process.exit(1); }
console.log('icon-font checks passed.');
if (failed) { console.error('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\ncurrentId routing checks passed.');