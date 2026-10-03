#!/usr/bin/env node
/*
 * Asserts the pure logic inside index.js against the real dataset.
 *
 *   node tools/selftest.js
 *
 * index.js exports its geo / time / urgency helpers when it is loaded outside a
 * browser, so this runs headless. Exits with code 1 when any assertion fails.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = require(path.join(ROOT, 'index.js'));
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'animals.json'), 'utf8'));

const failures = [];
let passed = 0;

function ok(label, condition, detail) {
  if (condition) { passed += 1; return; }
  failures.push(label + (detail === undefined ? '' : '  ->  ' + detail));
}
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const round = (value) => Math.round(value * 100) / 100;

app.setPolicy(doc.meta.urgencyPolicy);

/* --------------------------------- geo --------------------------------- */
ok('haversine returns 0 for identical points', app.haversine(doc.meta.center, doc.meta.center) === 0);
ok('haversine returns NaN without both points', Number.isNaN(app.haversine(null, doc.meta.center)));

const animals = doc.animals.map((raw) => app.normalizeAnimal(raw, 'seed'));
const byId = new Map(animals.map((a) => [a.id, a]));

/* The demo dataset (Milo, Luna, ...) was removed so the app boots empty and
   fills up with real reports. Assertions that pin specific fixture animals
   only run when those fixtures exist; everything after this block is pure
   logic (geo, time, policy, normalisation) and runs either way, so this file
   still proves the rules are correct on a clean install. */
const hasAnimals = animals.length > 0;
const hasStations = (doc.stations || []).length > 0;
const hasActivity = (doc.activity || []).length > 0;
const hasFixture = hasAnimals && byId.has('milo') && byId.has('barnaby') && byId.has('luna');

if (hasFixture) {
  [['milo', 350], ['barnaby', 850], ['luna', 1200]].forEach((pair) => {
    const distance = app.haversine(doc.meta.center, byId.get(pair[0]).location);
    ok(pair[0] + ' sits ' + pair[1] + 'm from the park centre', near(distance, pair[1], 1), Math.round(distance) + 'm');
  });
}

ok('formatDistance rounds metres to tens', app.formatDistance(348) === '350m', app.formatDistance(348));
ok('formatDistance clamps to a 10m floor', app.formatDistance(4) === '10m', app.formatDistance(4));
ok('formatDistance switches to kilometres', app.formatDistance(1200) === '1.2km', app.formatDistance(1200));
ok('formatDistance handles missing distances', app.formatDistance(NaN) === '--', app.formatDistance(NaN));

/* --------------------------------- time -------------------------------- */
ok('relativeTime prints "just now"', app.relativeTime(new Date().toISOString()) === 'just now', app.relativeTime(new Date().toISOString()));
ok('relativeTime prints minutes', app.relativeTime(app.isoFromMinutes(35)) === '35m ago', app.relativeTime(app.isoFromMinutes(35)));
ok('relativeTime prints hours', app.relativeTime(app.isoFromMinutes(540)) === '9h ago', app.relativeTime(app.isoFromMinutes(540)));
ok('relativeTime prints days', app.relativeTime(app.isoFromDays(3)) === '3d ago', app.relativeTime(app.isoFromDays(3)));
ok('relativeTime survives junk input', app.relativeTime('not-a-date') === 'unknown', app.relativeTime('not-a-date'));

/* ------------------------------- policy -------------------------------- */
ok('cat food is fine at exactly 8h', app.stateFor(480, 'cat', 'food') === 'ok', app.stateFor(480, 'cat', 'food'));
ok('cat food needs a refill at 8h01m', app.stateFor(481, 'cat', 'food') === 'needs', app.stateFor(481, 'cat', 'food'));
ok('cat food is still "needs" at 14h', app.stateFor(840, 'cat', 'food') === 'needs', app.stateFor(840, 'cat', 'food'));
ok('cat food is urgent past 14h', app.stateFor(841, 'cat', 'food') === 'urgent', app.stateFor(841, 'cat', 'food'));
ok('dog water is fine at exactly 8h', app.stateFor(480, 'dog', 'water') === 'ok', app.stateFor(480, 'dog', 'water'));
ok('unknown species uses the default policy', app.stateFor(600, 'llama', 'food') === 'needs', app.stateFor(600, 'llama', 'food'));

['ok', 'needs', 'urgent'].forEach((level) => {
  const minutes = app.levelMinutes('cat', 'food', level);
  ok('report level "' + level + '" maps back to "' + level + '"', app.stateFor(minutes, 'cat', 'food') === level, minutes + 'min');
});

/* ------------------------------ statuses ------------------------------- */
const status = (id) => app.computeStatus(byId.get(id), doc.meta.center);

if (hasFixture) {
  ok('Milo needs food after 9h', status('milo').food === 'needs', status('milo').food);
  ok('Milo water is fresh', status('milo').water === 'ok', status('milo').water);
  ok('Milo is flagged as needing help', status('milo').needsHelp === true);
  ok('Milo shows as 350m away in the UI', app.formatDistance(status('milo').distance) === '350m', app.formatDistance(status('milo').distance));
  ok('Barnaby was fed 40m ago', status('barnaby').food === 'ok', status('barnaby').food);
  ok('Barnaby water is ok', status('barnaby').water === 'ok', status('barnaby').water);
  ok('Barnaby does not need help', status('barnaby').needsHelp === false);
  ok('Luna needs water', status('luna').water === 'needs', status('luna').water);
  ok('Tiger is critical', status('tiger').health === 'critical');
  ok('Tiger food is urgent', status('tiger').food === 'urgent', status('tiger').food);
  ok('Tiger needs help because of health too', status('tiger').needsHelp === true);
  ok('Rocco is under treatment', status('rocco').health === 'treatment');
  ok('Rocco food is urgent', status('rocco').food === 'urgent', status('rocco').food);
  ok('Dusty only needs monitoring, not help', status('dusty').needsHelp === false);
}
/* ---------------------------- dataset shape ---------------------------- */
const needing = animals.filter((a) => app.computeStatus(a, doc.meta.center).needsHelp).map((a) => a.name);
if (hasAnimals) {
  ok('the dataset has some animals in it', animals.length > 0, animals.length);
  ok('exactly 12 animals need help right now', needing.length === 12, needing.join(', '));
}
ok('every animal id is unique', new Set(animals.map((a) => a.id)).size === animals.length);
ok('every animal resolves to a real station',
  animals.every((a) => a.stationId === null || doc.stations.some((s) => s.id === a.stationId)));
ok('every animal sits within 3km of the park centre',
  animals.every((a) => app.haversine(doc.meta.center, a.location) < 3000));

if (hasAnimals) {
  const ranked = animals
    .map((a) => ({ name: a.name, score: app.computeStatus(a, doc.meta.center).score }))
    .sort((a, b) => b.score - a.score);
  ok('"most urgent" puts a needy animal first', needing.indexOf(ranked[0].name) !== -1,
    ranked.slice(0, 3).map((r) => r.name + ':' + round(r.score)).join(', '));
  ok('"most urgent" puts a comfortable animal last', needing.indexOf(ranked[ranked.length - 1].name) === -1,
    ranked.slice(-3).map((r) => r.name + ':' + round(r.score)).join(', '));
}

/* ---------------------------- normalisation ---------------------------- */
if (hasFixture) {
  ok('normalizeAnimal yields an ISO lastFedAt', !Number.isNaN(Date.parse(byId.get('milo').lastFedAt)), byId.get('milo').lastFedAt);
  ok('normalizeAnimal drops lastFedMinutesAgo', byId.get('milo').lastFedMinutesAgo === undefined);
  ok('normalizeAnimal keeps the location label', byId.get('milo').location.label === 'Bench 4, West Rose Garden', byId.get('milo').location.label);
}
if (hasStations) {
  ok('normalizeStation builds lastServicedAt', !Number.isNaN(Date.parse(app.normalizeStation(doc.stations[0]).lastServicedAt)));
}
if (hasActivity) {
  const normalisedActivity = app.normalizeActivity(doc.activity[0]);
  ok('normalizeActivity builds an absolute timestamp', !Number.isNaN(Date.parse(normalisedActivity.at)));
  ok('the newest seeded activity is 35m old', app.relativeTime(normalisedActivity.at) === '35m ago', app.relativeTime(normalisedActivity.at));
}

/* --------------------------- new community report ---------------------- */
const report = app.normalizeAnimal({
  id: 'report-test', name: 'Test stray', species: 'cat', breed: 'Unknown', health: 'healthy',
  caretakers: ['Tester'], tags: ['community-report'], notes: 'notes', description: 'description',
  stationId: null, photoUrl: null, lastFedAt: new Date().toISOString(),
  lastWateredAt: app.isoFromMinutes(30), reportedAt: new Date().toISOString(),
  location: { label: 'Pin', area: 'Pin', lat: doc.meta.center.lat, lng: doc.meta.center.lng },
  feedCount: 0, waterCount: 0
}, 'report');
const reportStatus = app.computeStatus(report, doc.meta.center);
ok('a freshly reported, freshly fed animal needs no help', reportStatus.needsHelp === false);
ok('a reported animal has distance 0 from the centre', reportStatus.distance === 0);
ok('a reported animal keeps its source flag', report.source === 'report', report.source);

/* ------------------------------- results ------------------------------- */
if (failures.length) {
  console.error('SELFTEST FAILED (' + failures.length + ' of ' + (passed + failures.length) + '):');
  failures.forEach((line) => console.error(' - ' + line));
  process.exit(1);
}
console.log('All ' + passed + ' assertions passed against data/animals.json.');
console.log('  animals    : ' + animals.length + ' | stations: ' + (doc.stations || []).length);
console.log('  needing help: ' + (needing.length ? needing.join(', ') : '(none - no animals in the dataset)'));
