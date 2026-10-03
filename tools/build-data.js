#!/usr/bin/env node
/*
 * Validates data/animals.json and regenerates data/animals-data.js.
 *
 *   node tools/build-data.js
 *
 * data/animals.json is the single source of truth. Browsers block fetch() on
 * file:// URLs, so this tool also emits an embedded copy of the very same
 * document (window.FEED_THE_ANIMALS_DATA) which index.js falls back to when the
 * page is opened straight from disk. Run it after every data edit.
 * Exits with code 1 and lists every problem when the dataset is inconsistent.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'data', 'animals.json');
const JS_PATH = path.join(ROOT, 'data', 'animals-data.js');

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };

function levelFor(hours, rule) {
  if (hours <= rule.okHours) return 'ok';
  if (hours <= rule.urgentHours) return 'needs';
  return 'urgent';
}

function statusOf(animal, policy) {
  const rules = policy[animal.species] || policy.default;
  const food = levelFor(animal.lastFedMinutesAgo / 60, rules.food);
  const water = levelFor(animal.lastWateredMinutesAgo / 60, rules.water);
  const sick = animal.health === 'treatment' || animal.health === 'critical';
  return { food: food, water: water, sick: sick, needsHelp: food !== 'ok' || water !== 'ok' || sick };
}

const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const meta = doc.meta || {};
const policy = meta.urgencyPolicy || {};
const catalog = (meta.speciesCatalog || []).map((s) => s.id);
const layers = meta.tileLayers || [];
const animals = doc.animals || [];
const stations = doc.stations || [];
const activity = doc.activity || [];

/* ------------------------------- structure ------------------------------ */
/* An EMPTY dataset is valid: a fresh install has no animals until a real
   report comes in. Only a malformed one is an error, so check the shape
   rather than the length. */
check(Array.isArray(doc.animals), 'animals must be an array (it may be empty)');
check(Array.isArray(doc.stations), 'stations must be an array (it may be empty)');
check(Array.isArray(doc.activity), 'activity must be an array');
check(catalog.length > 0, 'meta.speciesCatalog is required');
check(typeof meta.city === 'string' && typeof meta.region === 'string', 'meta.city and meta.region are required');
check(typeof meta.defaultZoom === 'number' && meta.defaultZoom >= 1 && meta.defaultZoom <= 19, 'meta.defaultZoom must be 1..19');
check(typeof meta.volunteersActive === 'number', 'meta.volunteersActive must be a number');
check(typeof meta.timeModel === 'string', 'meta.timeModel documents how *MinutesAgo fields are interpreted');

const center = meta.center || {};
const centerOk = Number.isFinite(center.lat) && Number.isFinite(center.lng);
check(centerOk, 'meta.center needs numeric lat/lng');

/* ------------------------------- map layers ----------------------------- */
check(layers.length >= 2, 'meta.tileLayers needs at least two base maps');
layers.forEach((layer) => {
  const where = layer.id || '(layer without id)';
  check(typeof layer.id === 'string' && layer.id, 'tile layer without an id');
  check(typeof layer.label === 'string' && layer.label, 'tile layer without a label: ' + where);
  check(/^https:\/\//.test(layer.url || ''), where + ': tile url must be https');
  const url = layer.url || '';
  check(url.indexOf('{z}') !== -1 && url.indexOf('{x}') !== -1 && url.indexOf('{y}') !== -1, where + ': tile url needs {z}/{x}/{y}');
  check(typeof layer.attribution === 'string' && layer.attribution.length > 10, where + ': tile layer needs an attribution string');
});

/* -------------------------------- policy -------------------------------- */
['cat', 'dog', 'default'].forEach((species) => {
  const rules = policy[species];
  check(!!rules, 'urgencyPolicy is missing "' + species + '"');
  if (!rules) return;
  ['food', 'water'].forEach((kind) => {
    const rule = rules[kind];
    check(!!rule, 'urgencyPolicy.' + species + '.' + kind + ' is missing');
    if (!rule) return;
    check(Number.isFinite(rule.okHours) && rule.okHours > 0, 'urgencyPolicy.' + species + '.' + kind + '.okHours must be > 0');
    check(Number.isFinite(rule.urgentHours) && rule.urgentHours > rule.okHours, 'urgencyPolicy.' + species + '.' + kind + '.urgentHours must exceed okHours');
  });
});
/* ------------------------------ the animals ----------------------------- */
const ids = new Set();
animals.forEach((animal) => {
  const where = animal.id || '(animal without id)';
  check(typeof animal.id === 'string' && animal.id.length > 0, 'animal without a string id');
  check(!ids.has(animal.id), 'duplicate animal id: ' + where);
  ids.add(animal.id);

  check(catalog.indexOf(animal.species) !== -1, where + ': species "' + animal.species + '" is not in speciesCatalog');
  check(typeof animal.name === 'string' && animal.name.length > 0, where + ': name is required');
  check(typeof animal.breed === 'string' && animal.breed.length > 0, where + ': breed is required');
  check(typeof animal.description === 'string' && animal.description.length > 10, where + ': description is too short');
  check(typeof animal.notes === 'string' && animal.notes.length > 5, where + ': notes are required');
  check(Array.isArray(animal.caretakers) && animal.caretakers.length > 0, where + ': at least one caretaker is required');
  check(Array.isArray(animal.tags) && animal.tags.length > 0, where + ': at least one tag is required');
  check(['healthy', 'monitor', 'treatment', 'critical'].indexOf(animal.health) !== -1, where + ': unknown health "' + animal.health + '"');
  check(typeof animal.sterilized === 'boolean' && typeof animal.vaccinated === 'boolean' && typeof animal.microchipped === 'boolean',
    where + ': sterilized/vaccinated/microchipped must be booleans');
  check(animal.photoUrl === null ? true : /^https:\/\//.test(String(animal.photoUrl)), where + ': photoUrl must be null or an https URL');

  const location = animal.location || {};
  check(Number.isFinite(location.lat) && Number.isFinite(location.lng), where + ': location needs numeric lat/lng');
  check(typeof location.label === 'string' && typeof location.area === 'string', where + ': location.label and location.area are required');
  if (centerOk && Number.isFinite(location.lat)) {
    check(Math.abs(location.lat - center.lat) < 0.05 && Math.abs(location.lng - center.lng) < 0.08,
      where + ': pin drifts more than ~5km from the map centre');
  }
  check(Number.isFinite(animal.lastFedMinutesAgo) && animal.lastFedMinutesAgo >= 0, where + ': lastFedMinutesAgo must be >= 0');
  check(Number.isFinite(animal.lastWateredMinutesAgo) && animal.lastWateredMinutesAgo >= 0, where + ': lastWateredMinutesAgo must be >= 0');
  check(Number.isFinite(animal.reportedDaysAgo) && animal.reportedDaysAgo >= 0, where + ': reportedDaysAgo must be >= 0');
  check(Number.isInteger(animal.feedCount) && animal.feedCount >= 0, where + ': feedCount must be a non-negative integer');
  check(Number.isInteger(animal.waterCount) && animal.waterCount >= 0, where + ': waterCount must be a non-negative integer');
  check(animal.stationId === null || typeof animal.stationId === 'string', where + ': stationId must be a string or null');
});
/* ------------------------------- stations ------------------------------- */
const stationIds = new Set();
stations.forEach((station) => {
  const where = station.id || '(station without id)';
  check(typeof station.id === 'string' && station.id, 'station without an id');
  check(!stationIds.has(station.id), 'duplicate station id: ' + where);
  stationIds.add(station.id);
  check(typeof station.name === 'string' && typeof station.ref === 'string', where + ': name and ref are required');
  check(Number.isFinite(station.capacityPct) && station.capacityPct >= 0 && station.capacityPct <= 100, where + ': capacityPct must be 0..100');
  check(Number.isFinite(station.lastServicedMinutesAgo) && station.lastServicedMinutesAgo >= 0, where + ': lastServicedMinutesAgo must be >= 0');
  const location = station.location || {};
  check(Number.isFinite(location.lat) && Number.isFinite(location.lng), where + ': location needs numeric lat/lng');
});
animals.forEach((animal) => {
  check(animal.stationId === null || stationIds.has(animal.stationId), (animal.id || '(animal)') + ': unknown stationId ' + animal.stationId);
});

/* ------------------------------- activity ------------------------------- */
const kinds = meta.activityKinds || [];
check(kinds.length > 0, 'meta.activityKinds is required');
activity.forEach((entry) => {
  const where = entry.id || '(activity without id)';
  check(kinds.indexOf(entry.kind) !== -1, where + ': unknown kind "' + entry.kind + '"');
  check(Number.isFinite(entry.minutesAgo) && entry.minutesAgo >= 0, where + ': minutesAgo must be >= 0');
  check(typeof entry.actor === 'string' && entry.actor.length > 0, where + ': actor is required');
  check(typeof entry.note === 'string' && entry.note.length > 0, where + ': note is required');
  check(entry.animalId === null || ids.has(entry.animalId), where + ': unknown animalId ' + entry.animalId);
  check(!entry.stationId || stationIds.has(entry.stationId), where + ': unknown stationId ' + entry.stationId);
});

/* -------------------------- derived UI counters ------------------------- */
const bySpecies = {};
let needsHelp = 0;
const needing = [];
animals.forEach((animal) => {
  bySpecies[animal.species] = (bySpecies[animal.species] || 0) + 1;
  if (statusOf(animal, policy).needsHelp) {
    needsHelp += 1;
    needing.push(animal.name);
  }
});

/* No hard-coded demo totals any more. The seed data was removed so the app
   starts empty and fills up with real reports; asserting "48 animals" would
   make a perfectly valid empty dataset look like a bug. Shape rules above
   (ids, names, species, coordinates) still validate whatever IS there. */

/* --------------------------------- output ------------------------------- */
if (problems.length) {
  console.error('DATASET VALIDATION FAILED (' + problems.length + ' problem(s)):\n - ' + problems.join('\n - '));
  process.exit(1);
}

const banner = [
  '/*',
  ' * GENERATED FILE - do not edit by hand.',
  ' * Source of truth: data/animals.json',
  ' * Regenerate with: node tools/build-data.js',
  ' *',
  ' * Browsers refuse fetch() on file:// URLs, so index.js falls back to this',
  ' * embedded copy when index.html is opened straight from disk.',
  ' */',
  ''
].join('\n');

fs.writeFileSync(JS_PATH, banner + 'window.FEED_THE_ANIMALS_DATA = ' + JSON.stringify(doc, null, 2) + ';\n', 'utf8');

const totals = Object.keys(bySpecies).map((key) => bySpecies[key] + ' ' + key).join(', ');
console.log('data/animals.json is valid');
console.log('  animals  : ' + animals.length + ' (' + totals + ')');
console.log('  stations : ' + stations.length + ' | activity entries: ' + activity.length + ' | base maps: ' + layers.length);
console.log('  needing help now: ' + needsHelp + ' -> ' + needing.join(', '));
console.log('  wrote ' + path.relative(ROOT, JS_PATH) + ' (' + Math.round(fs.statSync(JS_PATH).size / 1024) + ' KB)');
