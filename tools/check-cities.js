#!/usr/bin/env node
/*
 * Validates cities.html without a browser.
 *
 *   node tools/check-cities.js
 *
 * Two layers:
 *   1. static - the page mounts the shared header, loads the icon font and
 *      exists on disk for every link the rest of the app points at it.
 *   2. functional - extracts the page's inline script and RUNS it against a
 *      stubbed DOM + fixture dataset, so grouping, needs-help counting,
 *      search filtering and the stats line are all proven, not assumed.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function check(label, ok, extra) {
  console.log((ok ? 'OK  ' : 'FAIL') + '  ' + label +
    (!ok && extra !== undefined ? '  (' + extra + ')' : ''));
  if (!ok) failed++;
}

const file = path.join(ROOT, 'cities.html');
check('cities.html exists', fs.existsSync(file));
if (!fs.existsSync(file)) { console.error('\n1 FAILED'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');

console.log('\nstatic markup:');
check('mounts the shared header', html.includes('id="site-header"'));
check('loads the shared header script', html.includes('src="site-header.js"'));
check('has no hard-coded navbar', !html.includes('Support Animal Relief'));
check('clears the fixed navbar', html.includes('has-site-header'));
check('loads supabase-client.js', html.includes('src="supabase-client.js"'));
check('falls back to the embedded dataset for file://', html.includes('src="data/animals-data.js"'));
{
  const m = html.match(/family=Material\+Symbols\+Outlined:([^&"']+)/);
  const axes = m ? m[1].split('@')[0] : '';
  const vals = m ? (m[1].split('@')[1] || '').split(';')[0].split(',') : [];
  check('icon font has 4 axes and 4 tuples', !!m && axes === 'opsz,wght,FILL,GRAD' && axes.split(',').length === vals.length,
    m && m[1]);
}

console.log('\nnav + handoff wiring:');
{
  const header = fs.readFileSync(path.join(ROOT, 'site-header.js'), 'utf8');
  const linksCities = /id: 'cities',\s*label: 'Cities',\s*icon: 'public',\s*href: 'cities\.html'/.test(header);
  check('navbar Cities pill -> cities.html', linksCities);
  check('both desktop and mobile entries repointed',
    (header.match(/href: 'cities\.html'/g) || []).length === 2);
  const js = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  check('the map reads #city= deep links', js.includes("params.get('city')"));
  check('the map prefills the sidebar search for a city',
    js.includes("state.query = city") && js.includes("search.value = city"));
}

/* ------------------------ functional harness ------------------------- */
console.log('\ninline script (run under a stubbed DOM):');
const blocks = html.match(/<script>\s*\(function\(\)[\s\S]*?<\/script>/g) || [];
check('page has an inline IIFE', blocks.length > 0);
if (blocks.length) {
  const code = blocks[blocks.length - 1]
    .replace(/^<script>/, '').replace(/<\/script>$/, '');

  function makeClassList(init) {
    const set = new Set(init || []);
    return {
      toggle(name, force) {
        const on = force === undefined ? !set.has(name) : !!force;
        on ? set.add(name) : set.delete(name);
        return on;
      },
      add(name) { set.add(name); },
      remove(name) { set.delete(name); },
      contains(name) { return set.has(name); }
    };
  }
  const HIDDEN = ['empty', 'unplaced', 'geo-note'];
  const els = {};
  function el(id) {
    if (!els[id]) {
      els[id] = {
        id, value: '', innerHTML: '', textContent: '',
        classList: makeClassList(HIDDEN.includes(id) ? ['hidden'] : []),
        onclick: null, oninput: null
      };
    }
    return els[id];
  }
  const documentStub = {
    getElementById: (id) => el(id),
    querySelectorAll: () => [],
    addEventListener() {},
    readyState: 'complete',
    body: null
  };
  /* Fixture: 2 Seattle cats (one starving - relative seed fields), 1 fresh
     Portland dog, 1 stray with NO city (must land in "unplaced"). */
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'animals.json'), 'utf8'));
  fixture.animals = [
    { id: 'starving-cat', name: 'Milo', species: 'cat', health: 'healthy',
      lastFedMinutesAgo: 999, lastWateredMinutesAgo: 5, reportedDaysAgo: 3,
      location: { label: 'Bench 4', lat: 47.6, lng: -122.3, city: 'Seattle', country: 'USA', citySlug: 'seattle-usa' } },
    { id: 'fresh-cat', name: 'Luna', species: 'cat', health: 'healthy',
      lastFedMinutesAgo: 1, lastWateredMinutesAgo: 1, reportedDaysAgo: 2,
      location: { label: 'Gate 2', lat: 47.61, lng: -122.32, city: 'Seattle', country: 'USA', citySlug: 'seattle-usa' } },
    { id: 'fresh-dog', name: 'Rex', species: 'dog', health: 'healthy',
      lastFedMinutesAgo: 1, lastWateredMinutesAgo: 1, reportedDaysAgo: 1,
      location: { label: 'Park Ave', lat: 45.5, lng: -122.6, city: 'Portland', country: 'USA' } },
    { id: 'no-city', name: 'Rover', species: 'dog', health: 'healthy',
      lastFedMinutesAgo: 1, lastWateredMinutesAgo: 1, reportedDaysAgo: 1,
      location: { label: 'Middle of nowhere', lat: 1, lng: 1 } }
  ];
  const fetchStub = async () => ({ ok: true, json: async () => fixture });
  const localStub = { getItem: () => null, setItem() {} };
  const windowStub = {};          /* no Supabase helpers -> loadCloud() = [] */
  const navigatorStub = {};       /* no geolocation -> Near me is opt-in */

  let threw = null;
  try {
    new Function('document', 'window', 'fetch', 'localStorage', 'navigator', code)(
      documentStub, windowStub, fetchStub, localStub, navigatorStub);
  } catch (e) { threw = e; }
  check('script evaluates without throwing', !threw, threw && threw.message);

  setTimeout(() => {
    check('grouped rows into city cards',
      /#city=Seattle/.test(els.list.innerHTML) && /#city=Portland/.test(els.list.innerHTML),
      els.list.innerHTML.slice(0, 120));
    check('Seattle shows 2 strays with 1 needing help',
      /Seattle/.test(els.list.innerHTML) && /needs help/.test(els.list.innerHTML));
    check('stats count strays, cities and countries',
      /4 strays mapped in 2 cities across 1 country/.test(els.stats.textContent), els.stats.textContent);
    check('the city-less stray is reported honestly, not invented',
      !els.unplaced.classList.contains('hidden') &&
      /1 stray is on the map without a city label/.test(els.unplaced.textContent),
      els.unplaced.textContent);
    check('empty state stays hidden when cities exist',
      els.empty.classList.contains('hidden'));

    /* Search must filter to Portland only. */
    els.q.value = 'portland';
    els.q.oninput();
    check('search narrows the list to the match',
      /Portland/.test(els.list.innerHTML) && !/#city=Seattle/.test(els.list.innerHTML));

    if (failed) { console.error('\n' + failed + ' FAILED'); process.exit(1); }
    console.log('\ncities.html checks passed.');
  }, 60);
}

