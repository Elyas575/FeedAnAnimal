/*!
 * FeedAnAnimalMap - application logic
 * ---------------------------------------------------------------
 * Loads data/animals.json, renders the volunteer sidebar feed, drives a real
 * Leaflet map (Google Streets / Google Satellite / CARTO Light / OSM Streets)
 * with clustered custom pins, and stores every feed / water / report action the visitor makes in
 * localStorage so the state survives a reload.
 *
 * The pure layer (geo, time, urgency policy) is exported to Node at the bottom
 * of this file so it can be asserted by tools/selftest.js.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fta.overlay.v1';
  const DATA_URL = 'data/animals.json';
  const TICKER_ROTATE_MS = 9000;

  /* ============================== helpers ============================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const esc = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const uid = (prefix) => (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function debounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  /* ================================ geo =============================== */
  const EARTH_RADIUS_M = 6371008.8;

  function haversine(a, b) {
    if (!a || !b) return NaN;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const t = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(t)));
  }

  function formatDistance(meters) {
    if (!isFinite(meters)) return '--';
    if (meters < 1000) return Math.max(10, Math.round(meters / 10) * 10) + 'm';
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + 'km';
  }

  /* =============================== time =============================== */
  const MINUTE = 60000;

  const isoFromMinutes = (minutes) => new Date(Date.now() - (Number(minutes) || 0) * MINUTE).toISOString();
  const isoFromDays = (days) => new Date(Date.now() - (Number(days) || 0) * 24 * 60 * MINUTE).toISOString();
  const minutesSince = (iso) => (Date.now() - Date.parse(iso)) / MINUTE;

  function relativeTime(iso) {
    if (!iso) return 'unknown';
    const minutes = minutesSince(iso);
    if (!isFinite(minutes)) return 'unknown';
    if (minutes < 1) return 'just now';
    if (minutes < 60) return Math.round(minutes) + 'm ago';
    const hours = minutes / 60;
    if (hours < 24) return Math.round(hours) + 'h ago';
    const days = hours / 24;
    if (days < 30) return Math.round(days) + 'd ago';
    return Math.round(days / 30) + 'mo ago';
  }

  const clockTime = (iso) => new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  /* ===================== urgency policy and status ==================== */
  let POLICY = { default: { food: { okHours: 8, urgentHours: 14 }, water: { okHours: 6, urgentHours: 10 } } };

  const policyFor = (species) => POLICY[species] || POLICY.default;

  function stateFor(minutes, species, kind) {
    const rule = policyFor(species)[kind];
    const hours = minutes / 60;
    if (hours <= rule.okHours) return 'ok';
    if (hours <= rule.urgentHours) return 'needs';
    return 'urgent';
  }

  function computeStatus(animal, reference) {
    const at = reference || { lat: 0, lng: 0 };
    const foodMinutes = minutesSince(animal.lastFedAt);
    const waterMinutes = minutesSince(animal.lastWateredAt);
    const food = stateFor(foodMinutes, animal.species, 'food');
    const water = stateFor(waterMinutes, animal.species, 'water');
    const health = animal.health || 'healthy';
    const sick = health === 'treatment' || health === 'critical';
    const needsHelp = food !== 'ok' || water !== 'ok' || sick;

    let score = 0;
    score += food === 'urgent' ? 40 : food === 'needs' ? 22 : 0;
    score += water === 'urgent' ? 32 : water === 'needs' ? 18 : 0;
    score += health === 'critical' ? 34 : health === 'treatment' ? 16 : health === 'monitor' ? 4 : 0;
    score += clamp((minutesSince(animal.reportedAt) || 0) / (24 * 60), 0, 6);
    score += clamp((foodMinutes || 0) / 240, 0, 8);

    return {
      food: food, water: water, health: health, sick: sick, needsHelp: needsHelp,
      foodMinutes: foodMinutes, waterMinutes: waterMinutes, score: score,
      distance: haversine(at, animal.location)
    };
  }
  /* ============================ data loading ========================== */
  function normalizeAnimal(raw, source) {
    const animal = Object.assign({}, raw);
    animal.tags = animal.tags || [];
    animal.caretakers = animal.caretakers || [];
    animal.photoUrl = animal.photoUrl || null;
    animal.health = animal.health || 'healthy';
    animal.temperament = animal.temperament || 'unknown';
    animal.stationId = animal.stationId || null;
    animal.source = animal.source || source || 'seed';
    animal.lastFedAt = animal.lastFedAt || isoFromMinutes(animal.lastFedMinutesAgo || 0);
    animal.lastWateredAt = animal.lastWateredAt || isoFromMinutes(animal.lastWateredMinutesAgo || 0);
    animal.reportedAt = animal.reportedAt || isoFromDays(animal.reportedDaysAgo || 0);
    animal.feedCount = Number(animal.feedCount) || 0;
    animal.waterCount = Number(animal.waterCount) || 0;
    delete animal.lastFedMinutesAgo;
    delete animal.lastWateredMinutesAgo;
    delete animal.reportedDaysAgo;
    return animal;
  }

  function normalizeStation(raw) {
    const station = Object.assign({}, raw);
    station.lastServicedAt = station.lastServicedAt || isoFromMinutes(station.lastServicedMinutesAgo || 0);
    delete station.lastServicedMinutesAgo;
    return station;
  }

  function normalizeActivity(raw) {
    return {
      id: raw.id || uid('act'),
      kind: raw.kind || 'feed',
      animalId: raw.animalId || null,
      stationId: raw.stationId || null,
      actor: raw.actor || 'Volunteer',
      actorAvatar: raw.actorAvatar || raw.actor_avatar || null,
      note: raw.note || '',
      place: raw.place || '',
      at: raw.at || isoFromMinutes(raw.minutesAgo || 0),
      source: raw.source || 'seed'
    };
  }

  /* ========================= local state overlay ====================== */
  function readOverlay() {
    const empty = { profile: null, userLocation: null, log: [], reports: [] };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        profile: parsed.profile || null,
        userLocation: parsed.userLocation || null,
        log: Array.isArray(parsed.log) ? parsed.log : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : []
      };
    } catch (err) {
      console.warn('[FeedAnAnimalMap] could not read local state', err);
      return empty;
    }
  }

  function writeOverlay() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        profile: state.profile,
        userLocation: state.userLocation,
        log: state.log,
        reports: state.animals.filter((a) => a.source === 'report')
      }));
      return true;
    } catch (err) {
      console.warn('[FeedAnAnimalMap] could not save local state', err);
      return false;
    }
  }
  /* ============================== app state =========================== */
  const state = {
    meta: {}, stations: [], animals: [], log: [], activity: [],
    filter: 'all', query: '', sort: 'urgent', selectedId: null,
    userLocation: null, profile: { name: 'Guest volunteer' },
    layers: [], baseLayerIndex: 0, baseLayer: null,
    map: null, markerLayer: null, markers: {}, userMarker: null, accuracyCircle: null, pickMarker: null,
    pickMode: false, mobileView: 'map', tickerIndex: 0, tickerHidden: false, cloudWarned: false,
    dataSource: '', saveWarningShown: false
  };

  async function loadDataset() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return { payload: await response.json(), sourceLabel: DATA_URL };
    } catch (err) {
      if (window.FEED_THE_ANIMALS_DATA) {
        console.warn('[FeedAnAnimalMap] fetch failed, using the embedded snapshot: ' + err.message);
        return { payload: window.FEED_THE_ANIMALS_DATA, sourceLabel: 'embedded snapshot (file:// mode)' };
      }
      throw err;
    }
  }

  /* Applies the stored visitor actions (feed / water / medicine) to the seed
     data. Runs once at boot; later actions mutate the animal directly. */
  function applyUserLog() {
    const animals = new Map(state.animals.map((a) => [a.id, a]));
    state.log = state.log.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    state.log.forEach((entry) => {
      const animal = animals.get(entry.animalId);
      if (!animal) return;
      if (entry.kind === 'feed' && Date.parse(entry.at) > Date.parse(animal.lastFedAt)) {
        animal.lastFedAt = entry.at;
        animal.feedCount += 1;
      }
      if (entry.kind === 'water' && Date.parse(entry.at) > Date.parse(animal.lastWateredAt)) {
        animal.lastWateredAt = entry.at;
        animal.waterCount += 1;
      }
      if (entry.kind === 'medicine') animal.health = 'treatment';
    });

    /* Station checks also survive a reload. */
    const stations = new Map(state.stations.map((s) => [s.id, s]));
    state.log.filter((entry) => entry.kind === 'station').forEach((entry) => {
      const station = stations.get(entry.stationId);
      if (!station) return;
      station.lastServicedAt = entry.at;
      station.capacityPct = Math.min(100, station.capacityPct + 15);
      station.status = station.capacityPct > 50 ? 'Volunteer run' : 'Refill due';
    });
  }

  function hydrate(payload, overlay, sourceLabel) {
    POLICY = Object.assign({}, (payload.meta && payload.meta.urgencyPolicy) || {});
    if (!POLICY.default) POLICY.default = { food: { okHours: 8, urgentHours: 14 }, water: { okHours: 6, urgentHours: 10 } };

    state.meta = payload.meta || {};
    state.layers = (state.meta.tileLayers || []).filter((layer) => layer && layer.url);
    state.stations = (payload.stations || []).map(normalizeStation);

    const merged = new Map();
    (payload.animals || []).map((raw) => normalizeAnimal(raw, 'seed')).forEach((a) => merged.set(a.id, a));
    overlay.reports.map((raw) => normalizeAnimal(raw, 'report')).forEach((a) => merged.set(a.id, a));
    state.animals = Array.from(merged.values());

    state.activity = (payload.activity || []).map((raw) => normalizeActivity(Object.assign({ source: 'seed' }, raw)));
    state.log = overlay.log.map((raw) => normalizeActivity(Object.assign({ source: 'user' }, raw)));
    /* The map is always framed on the park, never on the visitor. A saved
       GPS point from a previous session must not become the map's reference
       (it used to: state.userLocation was seeded from localStorage here and
       then used as referencePoint(), which also skewed every distance).
       The blue dot is drawn from this value, but it never moves the map. */
    state.userLocation = overlay.userLocation || null;
    state.profile = overlay.profile || { name: state.meta.defaultVolunteerName || 'Guest volunteer' };
    state.dataSource = sourceLabel;

    applyUserLog();
  }
  /* ============================== selectors =========================== */
  const animalById = (id) => state.animals.find((a) => a.id === id) || null;
  const stationById = (id) => state.stations.find((s) => s.id === id) || null;
  /* Distances are measured from the visitor once they share a location, and
       from the park centre before that. This is a global map: "Near Me" should
       re-measure everything from where you actually are, so the pin labelled
       closest really is. Urgency (needsHelp/score) never depends on distance,
       so this only moves the "m"/"km" labels and the Closest sort order. */
  const referencePoint = () => state.userLocation || state.meta.center || { lat: 0, lng: 0 };

  function speciesInfo(id) {
    const found = (state.meta.speciesCatalog || []).find((s) => s.id === id);
    return found || { id: id, label: id + 's', singular: id, emoji: '🐾' };
  }

  const statusOf = (animal) => computeStatus(animal, referencePoint());

  function matchesQuery(animal, query) {
    if (!query) return true;
    const haystack = [
      animal.name, animal.breed, animal.color, animal.description, animal.notes,
      animal.temperament, animal.health, animal.location.area, animal.location.label,
      animal.caretakers.join(' '), animal.tags.join(' ')
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function matchesFilter(row) {
    if (state.filter === 'all') return true;
    if (state.filter === 'help') return row.status.needsHelp;
    return row.animal.species === state.filter;
  }

  /* Every list and map render goes through this: filter -> search -> sort. */
  function selectAnimals() {
    const query = state.query.trim().toLowerCase();
    const rows = state.animals
      .map((animal) => ({ animal: animal, status: statusOf(animal) }))
      .filter((row) => matchesFilter(row) && matchesQuery(row.animal, query));

    if (state.sort === 'closest') {
      rows.sort((a, b) => (a.status.distance - b.status.distance) || (b.status.score - a.status.score));
    } else if (state.sort === 'recent') {
      rows.sort((a, b) => Date.parse(b.animal.lastFedAt) - Date.parse(a.animal.lastFedAt));
    } else {
      rows.sort((a, b) => (b.status.score - a.status.score) || (a.status.distance - b.status.distance));
    }
    return rows;
  }

  function countBySpecies() {
    const counts = new Map();
    state.animals.forEach((a) => counts.set(a.species, (counts.get(a.species) || 0) + 1));
    return (state.meta.speciesCatalog || [])
      .map((s) => ({ id: s.id, label: s.label, emoji: s.emoji, count: counts.get(s.id) || 0, singular: s.singular }))
      .filter((s) => s.count > 0);
  }

  const needsHelpCount = () => state.animals.filter((a) => statusOf(a).needsHelp).length;

  /* Care history for one animal, newest first. */
  const historyFor = (animalId) => state.log
    .filter((entry) => entry.animalId === animalId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  /* Seeded community activity merged with what this visitor has done. */
  const activityFeed = () => state.log.concat(state.activity).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  function nearestStation(lat, lng) {
    let best = null;
    let bestDistance = Infinity;
    state.stations.forEach((station) => {
      const d = haversine({ lat: lat, lng: lng }, station.location);
      if (d < bestDistance) { bestDistance = d; best = station; }
    });
    return best;
  }
  /* ============================== rendering =========================== */
  const TONE_TEXT = { error: 'text-error', secondary: 'text-secondary', tertiary: 'text-tertiary' };
  const DOT_CLASS = { error: 'bg-error', secondary: 'bg-secondary', tertiary: 'bg-tertiary' };

  /* One short sentence describing what an animal needs right now. */
  function primaryIssue(row) {
    const animal = row.animal;
    const food = row.status.food;
    const water = row.status.water;
    const health = row.status.health;
    if (health === 'critical') return { icon: 'emergency', tone: 'error', text: 'Critical condition • vet attention needed' };
    if (food === 'urgent') return { icon: 'restaurant', tone: 'error', text: 'Food urgent • empty ' + relativeTime(animal.lastFedAt) };
    if (water === 'urgent') return { icon: 'water_drop', tone: 'error', text: 'Water urgent • empty ' + relativeTime(animal.lastWateredAt) };
    if (health === 'treatment') return { icon: 'medical_services', tone: 'tertiary', text: 'Under treatment • small portions' };
    if (food === 'needs') return { icon: 'restaurant', tone: 'error', text: 'Needs food • empty ' + relativeTime(animal.lastFedAt) };
    if (water === 'needs') return { icon: 'water_drop', tone: 'tertiary', text: 'Needs water • empty ' + relativeTime(animal.lastWateredAt) };
    if (health === 'monitor') return { icon: 'visibility', tone: 'tertiary', text: 'Fed ' + relativeTime(animal.lastFedAt) + ' • monitoring' };
    return { icon: 'check_circle', tone: 'secondary', text: 'Fed ' + relativeTime(animal.lastFedAt) + ' • water ok' };
  }

  /* The most useful one-tap action for this animal. */
  function primaryAction(row) {
    if (row.status.food !== 'ok') return { kind: 'feed', icon: 'restaurant', label: 'Feed ' + row.animal.name, style: 'primary' };
    if (row.status.water !== 'ok') return { kind: 'water', icon: 'water_drop', label: 'Refill water', style: 'tertiary' };
    return { kind: 'feed', icon: 'restaurant', label: 'Log a feed', style: 'soft' };
  }

  const secondaryAction = (row) => (row.status.water !== 'ok'
    ? { kind: 'water', icon: 'water_drop', title: 'Log water' }
    : { kind: 'feed', icon: 'restaurant', title: 'Log food' });

  /* --------------------------- people avatars ------------------------- */
  /* Deterministic colours + initials so every volunteer gets a stable,
     recognisable avatar even when nobody has uploaded a real photo. */
  const AVATAR_HUES = ['#a03b0e', '#7c4a21', '#4b6b3a', '#2f6f6a', '#3b5a8a', '#6b3a7a', '#8a5a2b', '#5a6b2f'];

  function nameInitials(name) {
    const parts = String(name == null ? '' : name).trim().split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function nameHue(name) {
    const source = String(name == null ? '' : name);
    let hash = 0;
    for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
    return AVATAR_HUES[hash % AVATAR_HUES.length];
  }

  /* Real photo when we have one, colour-coded initials underneath.
     Layering matters: both children are absolutely positioned, so the photo
     is emitted SECOND (paints on top) and the initials FIRST. If the photo
     URL is dead the onerror handler removes the <img>, revealing the
     initials again. Never reverse this order. */
  function personAvatarHtml(name, avatarUrl, sizeClass) {
    const initials = esc(nameInitials(name));
    const hue = esc(nameHue(name));
    const size = sizeClass || 'w-8 h-8';
    const photo = avatarUrl
      ? '<img src="' + esc(avatarUrl) + '" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover z-[2]" onerror="this.remove()">'
      : '';
    return '<span class="relative inline-flex ' + size + ' rounded-full overflow-hidden shrink-0 align-middle" style="background:' + hue + '" title="' + esc(name || 'Volunteer') + '">' +
      '<span class="absolute inset-0 z-[1] flex items-center justify-center text-[11px] font-bold text-white">' + initials + '</span>' +
      photo +
    '</span>';
  }

  /* Small animal photo for the ticker/feed. Same dead-link protection and
     same layering rule as personAvatarHtml: fallback first, photo second. */
  function animalThumbHtml(animal, sizeClass) {
    const size = sizeClass || 'w-9 h-9';
    const emoji = animal ? speciesInfo(animal.species).emoji : '🐾';
    const species = animal ? animal.species : 'unknown';
    const photo = (animal && animal.photoUrl)
      ? '<img src="' + esc(animal.photoUrl) + '" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover z-[2]" onerror="this.remove()">'
      : '';
    return '<span class="relative inline-flex ' + size + ' rounded-xl overflow-hidden shrink-0 align-middle fta-avatar" data-species="' + esc(species) + '">' +
      '<span class="absolute inset-0 z-[1] flex items-center justify-center text-lg">' + emoji + '</span>' +
      photo +
    '</span>';
  }

  function avatarHtml(animal) {
    if (animal.photoUrl) {
      return '<img alt="' + esc(animal.name + ' the ' + animal.breed) + '" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" src="' + esc(animal.photoUrl) + '">';
    }
    return '<div class="fta-avatar w-full h-full flex items-center justify-center text-2xl transition-transform duration-300 group-hover:scale-105" data-species="' + esc(animal.species) + '" aria-hidden="true">' + speciesInfo(animal.species).emoji + '</div>';
  }

  function badgeDot(row) {
    const tone = (row.status.sick || row.status.food !== 'ok') ? 'error' : row.status.water !== 'ok' ? 'tertiary' : 'secondary';
    return '<span class="absolute top-1 right-1 w-2.5 h-2.5 rounded-full ' + DOT_CLASS[tone] + ' border-2 border-white' + (row.status.needsHelp ? ' animate-pulse' : '') + '"></span>';
  }

  /* ============================== filter chips ======================== */
  function renderChips() {
    const host = $('#filter-chips');
    if (!host) return;
    const chips = [{ id: 'all', label: 'All', count: state.animals.length, emoji: '' }]
      .concat(countBySpecies().map((s) => ({ id: s.id, label: s.label, count: s.count, emoji: s.emoji })))
      .concat([{ id: 'help', label: 'Needs Help', count: needsHelpCount(), emoji: '', help: true }]);

    host.innerHTML = chips.map((chip) => {
      const active = state.filter === chip.id;
      const base = 'px-3.5 py-1 rounded-full font-label-sm text-xs transition-colors flex items-center gap-1.5 text-nowrap shrink-0';
      const idle = chip.help
        ? 'bg-surface-container hover:bg-surface-container-high text-error'
        : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant';
      const dot = chip.help ? '<span class="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>' : '';
      return '<button type="button" data-filter="' + chip.id + '" aria-pressed="' + active + '" class="' + base + ' ' + (active ? 'bg-primary text-on-primary shadow-sm' : idle) + '">' +
        dot +
        '<span>' + esc(chip.emoji ? chip.emoji + ' ' : '') + esc(chip.label) + '</span>' +
        '<span class="' + (active ? 'text-[11px] font-bold opacity-80' : 'text-[11px] text-outline') + '">' + chip.count + '</span>' +
        '</button>';
    }).join('');
  }
  /* ============================== live ticker ========================= */
  function renderTicker() {
    const card = $('#activity-ticker');
    if (!card) return;
    const feed = activityFeed();
    if (state.tickerHidden || !feed.length) {
      card.classList.add('hidden');
      card.classList.remove('flex');
      return;
    }
    card.classList.remove('hidden');
    card.classList.add('flex');

    const entry = feed[state.tickerIndex % feed.length];
    const animal = entry.animalId ? animalById(entry.animalId) : null;
    const station = entry.stationId ? stationById(entry.stationId) : null;
    const place = entry.place || (animal ? animal.location.label : station ? station.ref : 'Oakwood Park');
    const actor = entry.source === 'user' ? (state.profile.name || 'You') : entry.actor;
    const isUser = entry.source === 'user';

    card.innerHTML =
      animalThumbHtml(animal, 'w-10 h-10') +
      '<div class="flex-1 min-w-0 pr-4">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<span class="flex items-center gap-1.5 min-w-0">' +
            personAvatarHtml(actor, entry.actorAvatar, 'w-5 h-5') +
            '<span class="font-label-sm text-label-sm text-primary font-bold truncate">' + (isUser ? 'Your activity' : 'Live Activity') + '</span>' +
          '</span>' +
          '<span class="flex items-center gap-2 shrink-0">' +
            '<a href="activity.html" class="font-label-sm text-label-sm text-primary font-bold hover:underline whitespace-nowrap">View all</a>' +
            '<span class="font-label-sm text-label-sm text-outline">' + relativeTime(entry.at) + '</span>' +
          '</span>' +
        '</div>' +
        '<p class="font-body-sm text-body-sm text-on-surface truncate">' +
          '<span class="font-semibold">' + esc(actor) + '</span> ' + esc(entry.note || entry.kind) +
        '</p>' +
        '<p class="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1 mt-0.5">' +
          '<span class="material-symbols-outlined text-[13px] text-outline">location_on</span>' + esc(place) +
        '</p>' +
      '</div>' +
      '<button type="button" data-ticker="next" class="text-outline hover:text-primary transition-colors p-0.5" title="Next update">' +
        '<span class="material-symbols-outlined text-[16px]">chevron_right</span>' +
      '</button>' +
      '<button type="button" data-ticker="dismiss" class="text-outline hover:text-on-surface transition-colors p-0.5" title="Dismiss">' +
        '<span class="material-symbols-outlined text-[16px]">close</span>' +
      '</button>';
  }
  /* ============================ sidebar feed ========================== */
  const ACTION_STYLES = {
    primary: 'bg-primary hover:bg-primary-container text-on-primary',
    tertiary: 'bg-tertiary hover:bg-tertiary-container text-on-tertiary',
    soft: 'bg-surface-container hover:bg-surface-container-high text-on-surface'
  };

  function cardHtml(row) {
    const animal = row.animal;
    const issue = primaryIssue(row);
    const action = primaryAction(row);
    const secondary = secondaryAction(row);
    const station = stationById(animal.stationId);
    const border = row.status.needsHelp
      ? ((row.status.food === 'urgent' || row.status.water === 'urgent' || row.status.sick) ? 'border-error/30' : 'border-tertiary/30')
      : 'border-surface-container-highest';

    return '<article data-animal-card="' + esc(animal.id) + '" class="fta-card p-3.5 rounded-lg bg-surface-container-lowest border ' + border + ' shadow-sm hover:shadow-md transition-all flex flex-col gap-3 group">' +
      '<div class="flex gap-3 items-center">' +
        '<div class="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm">' + avatarHtml(animal) + badgeDot(row) + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center justify-between gap-1">' +
            '<div class="flex items-center gap-1.5 truncate">' +
              '<h3 class="font-headline-sm text-base text-on-surface font-semibold truncate">' + esc(animal.name) + '</h3>' +
              '<span class="text-xs text-outline font-normal">• ' + esc(animal.breed) + '</span>' +
            '</div>' +
            '<span class="font-label-sm text-xs text-outline shrink-0 flex items-center gap-0.5">' +
              '<span class="material-symbols-outlined text-[13px]">near_me</span> ' + formatDistance(row.status.distance) +
            '</span>' +
          '</div>' +
          '<p class="font-body-sm text-xs ' + TONE_TEXT[issue.tone] + ' font-medium flex items-center gap-1 mt-0.5">' +
            '<span class="material-symbols-outlined text-[14px]">' + issue.icon + '</span> ' + esc(issue.text) +
          '</p>' +
          '<p class="font-body-sm text-xs text-on-surface-variant truncate mt-0.5 opacity-80">' + esc(animal.description) + '</p>' +
          (station ? '<p class="font-label-sm text-[11px] text-outline truncate mt-0.5 flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[12px]">roofing</span>' + esc(station.name) + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 pt-2 border-t border-surface-container-high/60">' +
        '<button type="button" data-action="' + action.kind + '" data-id="' + esc(animal.id) + '" class="flex-1 h-9 rounded-full ' + ACTION_STYLES[action.style] + ' font-label-sm text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[16px]">' + action.icon + '</span><span>' + esc(action.label) + '</span>' +
        '</button>' +
        '<button type="button" data-action="' + secondary.kind + '" data-id="' + esc(animal.id) + '" title="' + secondary.title + '" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">' + secondary.icon + '</span>' +
        '</button>' +
        '<button type="button" data-action="locate" data-id="' + esc(animal.id) + '" title="View on map" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">navigation</span>' +
        '</button>' +
        '<button type="button" data-action="details" data-id="' + esc(animal.id) + '" title="Details" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">info</span>' +
        '</button>' +
      '</div>' +
    '</article>';
  }
  function renderFeed() {
    const host = $('#animals-feed');
    if (!host) return;
    const rows = selectAnimals();
    const empty = $('#feed-empty');

    if (!rows.length) {
      host.innerHTML = '';
      if (empty) {
        /* Two different "empty" states need two different messages. With the
           seed data gone the app can genuinely have no animals at all, and
           telling someone "no animal matches your filter" when they never
           applied a filter reads as a broken app. */
        const nothingAtAll = state.animals.length === 0;
        const text = $('#feed-empty-text');
        if (text) {
          text.textContent = nothingAtAll
            ? 'No animals reported yet. Tap “Report a Stray” to add the first one.'
            : 'No animal matches that filter or search yet.';
        }
        const icon = $('#feed-empty-icon');
        if (icon) icon.textContent = nothingAtAll ? 'pets' : 'search_off';
        empty.classList.remove('hidden');
        empty.classList.add('flex');
      }
    } else {
      if (empty) {
        empty.classList.add('hidden');
        empty.classList.remove('flex');
      }
      host.innerHTML = rows.map(cardHtml).join('');
    }

    const count = $('#feed-count');
    if (count) count.textContent = rows.length;
    const sortSelect = $('#feed-sort');
    if (sortSelect) sortSelect.value = state.sort;

    highlightSelection();
  }

  /* Mirrors the map selection onto the sidebar card. */
  function highlightSelection() {
    $$('[data-animal-card]').forEach((card) => {
      const isSelected = card.getAttribute('data-animal-card') === state.selectedId;
      card.classList.toggle('ring-2', isSelected);
      card.classList.toggle('ring-primary/40', isSelected);
    });
  }

  function renderStatusBar() {
    const volunteers = $('#volunteer-count');
    if (volunteers) volunteers.textContent = String(state.meta.volunteersActive || 0);
    const centerLabel = $('#center-label');
    if (centerLabel) centerLabel.textContent = 'Center on ' + String(state.meta.region || 'Oakwood Park').split('&')[0].trim();
    const needsHelp = $('#header-needs-help');
    if (needsHelp) needsHelp.textContent = String(needsHelpCount()) + ' need help now';
  }

  /* ------------------------------ toasts ----------------------------- */
  function toast(message, tone) {
    const stack = $('#toast-stack');
    if (!stack) return;
    const palette = {
      ok: 'bg-secondary text-on-secondary',
      info: 'bg-surface-bright text-on-surface',
      error: 'bg-error text-on-error'
    };
    const node = document.createElement('div');
    node.className = 'pointer-events-auto max-w-xs px-4 py-2.5 rounded-full shadow-xl font-label-md text-label-md flex items-center gap-2 ' + (palette[tone] || palette.info);
    node.innerHTML = '<span class="material-symbols-outlined text-[18px]">' +
      (tone === 'ok' ? 'check_circle' : tone === 'error' ? 'error' : 'info') + '</span><span>' + esc(message) + '</span>';
    stack.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .3s ease, transform .3s ease';
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 320);
    }, 3200);
  }
  /* =============================== the map ============================ */
  function pinHtml(row) {
    const animal = row.animal;
    const foodUrgent = row.status.food === 'urgent';
    const waterUrgent = row.status.water === 'urgent';
    const urgent = foodUrgent || waterUrgent || row.status.sick;
    const tone = urgent ? 'is-urgent' : row.status.needsHelp ? 'is-needs' : 'is-ok';
    const selected = state.selectedId === animal.id ? ' is-selected' : '';
    const maxMinutes = Math.max(row.status.foodMinutes || 0, row.status.waterMinutes || 0);
    const badge = row.status.needsHelp
      ? '<span class="fta-pin__badge' + (urgent ? ' fta-pin__badge--error' : '') + '">' + Math.max(1, Math.round(maxMinutes / 60)) + 'h</span>'
      : '';
    const shortStatus = row.status.food !== 'ok' ? 'needs food' : row.status.water !== 'ok' ? 'needs water' : 'ok';
    const disc = animal.photoUrl
      ? '<img class="fta-pin__photo" alt="" src="' + esc(animal.photoUrl) + '">'
      : '<span class="fta-pin__emoji">' + speciesInfo(animal.species).emoji + '</span>';

    return '<div class="fta-pin ' + tone + selected + '">' +
      '<div class="fta-pin__disc">' + disc + '</div>' +
      (row.status.needsHelp ? '<span class="fta-pin__pulse"></span>' : '') +
      badge +
      '<div class="fta-pin__label"><span>' + esc(animal.name) + '</span>' +
        '<span class="fta-pin__label-state">• ' + shortStatus + '</span></div>' +
      '</div>';
  }

  function clusterIconHtml(count) {
    const size = count < 10 ? 40 : count < 25 ? 50 : 60;
    return '<div class="fta-cluster" style="width:' + size + 'px;height:' + size + 'px">' + count + '</div>';
  }
  function popupHtml(row) {
    const animal = row.animal;
    const issue = primaryIssue(row);
    const station = stationById(animal.stationId);
    const directions = 'https://www.google.com/maps/dir/?api=1&destination=' + animal.location.lat + ',' + animal.location.lng;
    const mapsSearch = 'https://www.google.com/maps/search/?api=1&query=' + animal.location.lat + ',' + animal.location.lng;
    const coordText = Number(animal.location.lat).toFixed(6) + ', ' + Number(animal.location.lng).toFixed(6);
    const myCare = historyFor(animal.id).length;
    const foodWidth = row.status.food === 'ok' ? 100 : row.status.food === 'needs' ? 40 : 15;
    const waterWidth = row.status.water === 'ok' ? 100 : row.status.water === 'needs' ? 40 : 15;
    const issueClass = issue.tone === 'error' ? 'is-alert' : issue.tone === 'tertiary' ? 'is-water' : 'is-ok';

    return '<div class="fta-popup__card">' +
      '<div class="fta-popup__head">' +
        '<span class="fta-popup__dot ' + (row.status.needsHelp ? 'is-alert' : 'is-ok') + '"></span>' +
        '<span class="fta-popup__kicker">' + (row.status.needsHelp ? 'Urgent attention needed' : 'Doing fine') + '</span>' +
        '<span class="fta-popup__distance">' + formatDistance(row.status.distance) + '</span>' +
      '</div>' +
      '<div class="fta-popup__body">' +
        '<div class="fta-popup__thumb">' + avatarHtml(animal) + '</div>' +
        '<div class="fta-popup__id">' +
          '<h4>' + esc(animal.name) + '</h4>' +
          '<p>' + esc(animal.breed) + ' • ' + esc(animal.sex || 'sex unknown') + ' • ' + esc(animal.ageClass || 'unknown') + '</p>' +
          '<p class="fta-popup__place"><span class="material-symbols-outlined">pin_drop</span>' + esc(animal.location.label) + '</p>' +
        '</div>' +
      '</div>' +
      '<p class="fta-popup__issue ' + issueClass + '">' +
        '<span class="material-symbols-outlined">' + issue.icon + '</span>' + esc(issue.text) + '</p>' +
      '<div class="fta-popup__meters">' +
        '<div class="fta-popup__meter"><span>Food</span><span>' + relativeTime(animal.lastFedAt) + '</span></div>' +
        '<div class="fta-bar"><i class="' + (row.status.food === 'ok' ? 'is-ok' : 'is-alert') + '" style="width:' + foodWidth + '%"></i></div>' +
        '<div class="fta-popup__meter"><span>Water</span><span>' + relativeTime(animal.lastWateredAt) + '</span></div>' +
        '<div class="fta-bar"><i class="' + (row.status.water === 'ok' ? 'is-ok' : 'is-water') + '" style="width:' + waterWidth + '%"></i></div>' +
      '</div>' +
      '<p class="fta-popup__notes">' + esc(animal.notes) + '</p>' +
      '<p class="fta-popup__meta">' + esc(station ? station.name : 'No station assigned') + ' • ' + animal.feedCount + ' feeds logged' +
        (myCare ? ' • ' + myCare + ' by you' : '') + '</p>' +
      '<p class="fta-popup__meta"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">location_on</span> ' +
        '<a href="' + esc(mapsSearch) + '" target="_blank" rel="noopener" title="Open exact pin in Google Maps">' + esc(coordText) + '</a>' +
        ' <button type="button" data-action="copy-coords" data-id="' + esc(animal.id) + '" title="Copy coordinates" style="text-decoration:underline">Copy</button></p>' +
      /* Directions gets its OWN full-width row above the care actions. "Walk to
         this animal" is the reason someone opened the popup, so it should not
         compete with Feed/Water for horizontal space on one row. Sizing and
         colour come from .fta-btn--go in index.html - no inline styles here, so
         the button can't end up half-styled. */
      '<a class="fta-btn fta-btn--go" target="_blank" rel="noopener" href="' + esc(directions) + '" ' +
        'title="Walking directions to this animal">' +
        '<span class="material-symbols-outlined">directions</span>Directions</a>' +
      '<div class="fta-popup__actions">' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--primary">' +
          '<span class="material-symbols-outlined">restaurant</span>I fed ' + esc(animal.name) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--water">' +
          '<span class="material-symbols-outlined">water_drop</span>Water</button>' +
        '<button type="button" data-action="details" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--ghost" title="Full profile">' +
          '<span class="material-symbols-outlined">info</span></button>' +
      '</div>' +
    '</div>';
  }
  function stationPopupHtml(station) {
    return '<div class="fta-popup__card">' +
      '<div class="fta-popup__head"><span class="fta-popup__dot is-ok"></span>' +
        '<span class="fta-popup__kicker">Community feeding station</span>' +
        '<span class="fta-popup__distance">' + station.capacityPct + '% full</span></div>' +
      '<h4 class="fta-popup__title">' + esc(station.name) + '</h4>' +
      '<p class="fta-popup__place"><span class="material-symbols-outlined">roofing</span>' + esc(station.ref) + '</p>' +
      '<p class="fta-popup__issue is-ok"><span class="material-symbols-outlined">inventory_2</span>' +
        esc(station.type) + ' • ' + esc(station.status) + '</p>' +
      '<div class="fta-popup__meter"><span>Container level</span><span>' + station.capacityPct + '%</span></div>' +
      '<div class="fta-bar"><i class="' + (station.capacityPct > 50 ? 'is-ok' : 'is-alert') + '" style="width:' + station.capacityPct + '%"></i></div>' +
      '<p class="fta-popup__notes">' + esc(station.notes) + '</p>' +
      '<p class="fta-popup__meta">Steward: ' + esc(station.caretaker) + ' • serviced ' + relativeTime(station.lastServicedAt) + '</p>' +
      /* Station popups get the same prominent, worded Directions button. */
      '<a class="fta-btn fta-btn--go" target="_blank" rel="noopener" title="Walking directions to this station" ' +
        'href="https://www.google.com/maps/dir/?api=1&destination=' + station.location.lat + ',' + station.location.lng + '">' +
        '<span class="material-symbols-outlined">directions</span>Directions</a>' +
      '<div class="fta-popup__actions">' +
        '<button type="button" data-action="station-check" data-station="' + esc(station.id) + '" class="fta-btn fta-btn--primary">' +
          '<span class="material-symbols-outlined">checklist</span>Log a station check</button>' +
      '</div>' +
    '</div>';
  }

  /* --------------------------- map bootstrap -------------------------- */
  function mapUnavailable(message) {
    const host = $('#map');
    if (host) {
      host.innerHTML = '<div class="w-full h-full flex items-center justify-center p-8 text-center">' +
        '<div class="max-w-sm flex flex-col items-center gap-2">' +
        '<span class="material-symbols-outlined text-[40px] text-outline">map</span>' +
        '<p class="font-headline-sm text-base text-on-surface font-semibold">Map engine unavailable</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(message) + '</p>' +
        '</div></div>';
    }
    toast('Map library could not load - the animal list still works offline.', 'error');
  }

  function initMap() {
    if (!window.L) {
      mapUnavailable('Leaflet did not load. Check the CDN link or serve the folder over http.');
      return false;
    }
    const center = state.meta.center || { lat: 47.671236, lng: -122.343184 };
    /* Leaflet renders Google's raster tiles; Google's own terms/attribution still apply.
       We start zoomed out; fitToPark() refines this to the exact park extent as
       soon as the dataset loads, so the opening frame is never a close-up. */
    state.map = window.L.map('map', {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: state.meta.maxZoom || 20,
      worldCopyJump: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5
    }).setView([center.lat, center.lng], state.meta.startZoom || 13);

    window.L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);
    /* Default to the Google Streets base map; the layers button cycles the rest. */
    const googleIndex = Math.max(0, state.layers.findIndex((entry) => entry.id === 'google-streets'));
    setBaseLayer(googleIndex);

    state.map.on('click', (event) => {
      if (state.pickMode) placePickMarker(event.latlng.lat, event.latlng.lng);
    });
    return true;
  }

  /* Normalize a tile-layer record so comma-separated subdomains work in Leaflet
     (Leaflet expects an array; "mt0,mt1,mt2,mt3" would otherwise be one host). */
  function layerSubdomains(layer) {
    if (Array.isArray(layer.subdomains)) return layer.subdomains;
    if (typeof layer.subdomains === 'string' && layer.subdomains.indexOf(',') !== -1) {
      return layer.subdomains.split(',').map((part) => part.trim()).filter(Boolean);
    }
    return layer.subdomains;
  }

  function setBaseLayer(index) {
    if (!state.map || !state.layers.length) return;
    const layer = state.layers[((index % state.layers.length) + state.layers.length) % state.layers.length];
    if (state.baseLayer) state.map.removeLayer(state.baseLayer);
    const options = { attribution: layer.attribution || '', maxZoom: layer.maxZoom || 20, minZoom: 2, subdomains: layerSubdomains(layer) || 'abc' };
    state.baseLayer = window.L.tileLayer(layer.url, options).addTo(state.map);
    state.baseLayerIndex = state.layers.indexOf(layer);
    const label = $('#layer-label');
    if (label) label.textContent = layer.label || layer.id;
  }

  function cycleBaseLayer() {
    if (!state.layers.length) return;
    setBaseLayer(state.baseLayerIndex + 1);
    const layer = state.layers[state.baseLayerIndex];
    toast('Base map: ' + (layer.label || layer.id), 'info');
  }

  function renderMarkers() {
    if (!state.map || !window.L) return;
    if (state.markerLayer) state.map.removeLayer(state.markerLayer);

    const clusters = typeof window.L.markerClusterGroup === 'function';
    const group = clusters
      ? window.L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 46,
        disableClusteringAtZoom: 16,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          const size = count < 10 ? 52 : count < 25 ? 62 : 72;
          return window.L.divIcon({
            html: clusterIconHtml(count),
            className: 'fta-cluster-icon',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          });
        }
      })
      : window.L.layerGroup();
    if (!clusters) console.warn('[FeedAnAnimalMap] leaflet.markercluster missing, falling back to a plain layer group.');

    state.markers = {};
    const rows = selectAnimals();
    rows.forEach((row) => {
      const marker = animalMarker(row);
      state.markers[row.animal.id] = marker;
      group.addLayer(marker);
    });
    state.stations.forEach((station) => group.addLayer(stationMarker(station)));

    state.map.addLayer(group);
    state.markerLayer = group;

    /* Frame the WHOLE park on first load, not just the animals that survive
       the current filter. Fitting the filtered subset meant that opening the
       page with "Cats" active zoomed into a corner, and the extent changed
       every time a chip was applied. We also drop the maxZoom cap: it was
       inherited from the old default-zoom behaviour and prevented zooming
       out far enough to see the full 1.7km park. */
    if (!state.fitted) {
      state.fitted = true;
      fitToPark();
    }
  }

  /* Zoom out far enough to show every animal and station in one view. */
  function fitToPark(options) {
    if (!state.map) return;
    const points = [];
    state.animals.forEach((a) => points.push([a.location.lat, a.location.lng]));
    state.stations.forEach((s) => points.push([s.location.lat, s.location.lng]));
    const centre = state.meta.center || null;
    if (centre) points.push([centre.lat, centre.lng]);
    if (!points.length) return;

    const opts = options || {};
    if (points.length === 1) {
      state.map.setView(points[0], state.meta.defaultZoom || 15);
      return;
    }
    state.map.fitBounds(L.latLngBounds(points).pad(0.08), {
      padding: opts.padding || [40, 40],
      // No maxZoom here on purpose: this must be allowed to zoom OUT.
      animate: opts.animate !== false,
      duration: opts.duration === undefined ? 0.6 : opts.duration,
    });
  }
  function animalMarker(row) {
    const animal = row.animal;
    const marker = window.L.marker([animal.location.lat, animal.location.lng], {
      icon: window.L.divIcon({
        className: 'fta-pin-wrap',
        html: pinHtml(row),
        iconSize: [48, 62],
        iconAnchor: [24, 56],
        popupAnchor: [0, -52]
      }),
      title: animal.name + ' • ' + animal.breed,
      alt: animal.name + ', ' + animal.breed,
      riseOnHover: true,
      keyboard: true
    });
    marker.bindPopup(popupHtml(row), { maxWidth: 340, minWidth: 296, autoPanPadding: [28, 28], className: 'fta-popup' });
    marker.on('click', () => setSelected(animal.id, true));
    marker.on('popupopen', () => setSelected(animal.id, false));
    return marker;
  }

  function stationMarker(station) {
    const marker = window.L.marker([station.location.lat, station.location.lng], {
      icon: window.L.divIcon({
        className: 'fta-station-wrap',
        html: '<div class="fta-station"><span class="material-symbols-outlined">roofing</span></div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -18]
      }),
      title: station.name,
      alt: station.name,
      riseOnHover: true
    });
    marker.bindPopup(stationPopupHtml(station), { maxWidth: 320, minWidth: 280, className: 'fta-popup' });
    return marker;
  }

  function renderUserMarker(accuracy) {
    if (!state.map || !state.userLocation) return;
    if (state.userMarker) state.map.removeLayer(state.userMarker);

    /* Draw the GPS accuracy circle. Without it a 60m fix and a 5m fix look
       identical, which is what makes people distrust a correct position. */
    if (state.accuracyCircle) {
      state.map.removeLayer(state.accuracyCircle);
      state.accuracyCircle = null;
    }
    if (accuracy && isFinite(accuracy) && accuracy > 0) {
      state.accuracyCircle = window.L.circle([state.userLocation.lat, state.userLocation.lng], {
        radius: accuracy,
        color: '#1a73e8',
        weight: 1,
        opacity: 0.5,
        fillColor: '#1a73e8',
        fillOpacity: 0.10,
        interactive: false,
        keyboard: false
      }).addTo(state.map);
    }

    state.userMarker = window.L.marker([state.userLocation.lat, state.userLocation.lng], {
      icon: window.L.divIcon({
        className: 'fta-me-wrap',
        html: '<div class="fta-me"><span></span></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      }),
      title: 'Your location',
      zIndexOffset: 500,
      interactive: false,
      keyboard: false
    }).addTo(state.map);
  }

  /* --------------------------- selection glue ------------------------- */
  function setSelected(id, scrollToCard) {
    state.selectedId = id || null;
    highlightSelection();
    Object.keys(state.markers).forEach((key) => {
      const marker = state.markers[key];
      const element = marker && typeof marker.getElement === 'function' ? marker.getElement() : null;
      if (element) element.classList.toggle('is-selected', key === state.selectedId);
    });
    if (scrollToCard && state.selectedId) {
      const card = $('[data-animal-card="' + state.selectedId + '"]');
      if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* "View on map" - un-clusters, flies in and opens the preview card. */
  function revealAnimal(id) {
    const animal = animalById(id);
    if (!animal) return;
    /* Only a phone has to hand the screen over: there the list covers the map
       completely. On desktop the two sit side by side, so revealing a pin
       must NOT collapse the side menu out from under the user. */
    if (isNarrow() && state.mobileView !== 'map') switchMobileView('map');
    if (!state.map) return;
    const marker = state.markers[id];
    setSelected(id, true);
    if (marker && state.markerLayer && typeof state.markerLayer.zoomToShowLayer === 'function') {
      state.markerLayer.zoomToShowLayer(marker, () => marker.openPopup());
      return;
    }
    state.map.flyTo([animal.location.lat, animal.location.lng], Math.max(state.map.getZoom(), 16), { duration: 0.6 });
    if (marker) setTimeout(() => marker.openPopup(), 650);
  }

  const isNarrow = () => window.matchMedia('(max-width: 767px)').matches;

  /* ---------------------------- geolocation --------------------------- */
  /* Pending state for the "where am I" buttons. A cold GPS fix takes seconds,
     and the mobile circle is a bare icon with no label next to it, so without
     a spinner it is indistinguishable from a button that did nothing. */
  function setLocatePending(busy) {
    const button = $('#mobile-locate-btn');
    if (button) {
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
      button.classList.toggle('opacity-60', busy);
    }
    const icon = $('#mobile-locate-icon');
    if (icon) {
      icon.textContent = busy ? 'progress_activity' : 'my_location';
      icon.classList.toggle('animate-spin', busy);
    }
  }

  /* --------------------------- opening view --------------------------- */
  /* Fallback frame when we have no position for the visitor. A wide slice of
     New York State reads as "a map somewhere sensible" and stays recognisable
     at every zoom, which beats leaving the camera on a demo park in another
     state entirely. */
  const FALLBACK_VIEW = { lat: 43.0, lng: -75.5, zoom: 7 };

  function flyToFallback(reason) {
    if (!state.map) return;
    state.map.flyTo([FALLBACK_VIEW.lat, FALLBACK_VIEW.lng], FALLBACK_VIEW.zoom, { duration: 0.9 });
    if (reason) toast(reason + ' - showing New York State.', 'info');
  }

  /* Aims the map at the visitor on open, so the first frame they see is their
     own neighbourhood instead of the seeded demo park.

     Geolocation is best effort and can fail in four different ways - no API,
     insecure origin (browsers block it outside https/localhost), a refused
     permission, or a timeout. Every one of those paths has to land somewhere
     deliberate, so they all fall back rather than leaving the camera wherever
     initMap() happened to put it. This runs silently on success: a toast on
     every page load would be noise. */
  function openAtVisitor() {
    if (!state.map) return;

    /* A position cached from an earlier visit frames the map immediately, so a
       returning visitor never sees the demo park flash past. */
    const cached = state.userLocation;
    if (cached) {
      state.map.flyTo([cached.lat, cached.lng], Math.max(state.map.getZoom(), 16), { duration: 0.6 });
    }

    if (!navigator.geolocation) {
      if (!cached) flyToFallback('This browser cannot share your location');
      return;
    }

    setLocatePending(true);
    /* Guards against the success and failure paths both running if a late fix
       arrives after a timeout has already been reported. */
    let settled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) return;
        settled = true;
        setLocatePending(false);

        state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        writeOverlay();
        renderUserMarker(position.coords.accuracy);
        /* Distances now measure from the visitor, so the list and the pin
           labels have to be rebuilt from the new reference. */
        renderFeed();
        renderMarkers();

        /* Skip the second fly when the cached frame was already right (common
           on a return visit - the browser usually re-serves the same fix), so
           the map does not jitter between two spots metres apart. */
        const moved = cached ? haversine(cached, state.userLocation) : Infinity;
        if (moved > 50) {
          state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 16, { duration: 0.9 });
        }
      },
      () => {
        if (settled) return;
        settled = true;
        setLocatePending(false);
        if (cached) return; /* already framed on the cached position */
        flyToFallback('Location unavailable');
      },
      /* maximumAge lets a returning visitor get an instant cached fix with no
         permission prompt; a cold start still has to wait for the GPS. */
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  }

  /* Finds where the visitor is, drops the blue "you are here" dot, and takes
     the map to them.

     "Near Me" means "show me me": the map is global, so whatever the seeded
     demo pins are, the viewport flies to the visitor's own point at street
     level. Distances then re-measure from that point (see referencePoint()),
     and "Center on ..." resets the view back to the park. */
  function locateMe() {
    if (!navigator.geolocation) {
      toast('This browser cannot share a location.', 'error');
      return;
    }
    toast('Requesting your location…', 'info');
    setLocatePending(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        writeOverlay();
        renderUserMarker(position.coords.accuracy);
        /* Re-measure the list and the pins from the new reference before the
           camera moves, so the "closest" order is already correct on arrival. */
        renderFeed();
        renderMarkers();
        setLocatePending(false);

        /* On a phone the map can be sitting behind the list view. Reveal it
           first, and wait for switchMobileView()'s invalidateSize() so the
           flyTo aims at a container that actually has a size. Desktop keeps
           its side menu - the map just flies within the space it has. */
        const moveToVisitor = () => {
          if (!state.map) return;
          /* Fly to the visitor - not to the park. Never zoom back out below the
             street level people expect from a "find me" button. */
          const zoom = Math.max(state.map.getZoom(), state.meta.defaultZoom || 15, 16);
          state.map.flyTo([state.userLocation.lat, state.userLocation.lng], zoom, { duration: 0.8 });
        };
        if (isNarrow() && state.mobileView !== 'map') {
          switchMobileView('map');
          setTimeout(moveToVisitor, 300);
        } else {
          moveToVisitor();
        }
        toast('Showing your location - the blue dot is you.', 'ok');
      },
      (error) => {
        setLocatePending(false);
        const denied = error && error.code === 1;
        toast(denied ? 'Location permission denied.' : 'Location unavailable (' + error.message + ').', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function useParkCenter() {
    state.userLocation = null;
    writeOverlay();
    if (state.userMarker) state.map.removeLayer(state.userMarker);
    state.userMarker = null;
    if (state.accuracyCircle) state.map.removeLayer(state.accuracyCircle);
    state.accuracyCircle = null;
    renderFeed();
    renderMarkers();
    fitToPark({ animate: true });
    toast('Cleared your location - showing the whole ' + (state.meta.region || 'park') + '.', 'ok');
  }

  /* Used by the "Report a stray" form: click the map to drop the pin. */
  function placePickMarker(lat, lng, options) {
    const opts = options || {};
    state.pickMode = false;
    const latInput = $('#report-lat');
    const lngInput = $('#report-lng');
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);
    const placeInput = $('#report-place');
    if (placeInput && !placeInput.value.trim()) {
      const station = nearestStation(lat, lng);
      placeInput.value = 'Dropped pin near ' + (station ? station.ref : 'Oakwood Park');
    }
    if (state.pickMarker) state.map.removeLayer(state.pickMarker);
    state.pickMarker = window.L.marker([lat, lng], {
      icon: window.L.divIcon({
        className: 'fta-pick-wrap',
        html: '<div class="fta-pick"><span class="material-symbols-outlined">add_location_alt</span></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      }),
      title: 'New report pin',
      zIndexOffset: 600
    }).addTo(state.map);

    /* When the pin came from GPS, the "you are here" dot moves with it so the
       two can never disagree. This does NOT persist as a map reference and
       never moves the viewport - the map stays on the park. */
    if (opts.fromGps) {
      state.userLocation = { lat: lat, lng: lng };
      renderUserMarker(opts.accuracy);
    }

    const hint = $('#report-pick-hint');
    if (hint) {
      if (opts.accuracy && isFinite(opts.accuracy)) {
        hint.textContent = 'Pinned at ' + lat.toFixed(5) + ', ' + lng.toFixed(5)
          + ' - accurate to about ' + formatDistance(opts.accuracy) + '.';
      } else {
        hint.textContent = 'Pinned at ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '.';
      }
    }
    const modal = $('#report-modal');
    if (modal) modal.classList.remove('fta-picking');
    switchMobileView('map');
    toast('Location pinned on the map.', 'ok');
  }
  /* Fills the report pin from the device GPS.

     This is the DEFAULT for the form - most people report a stray they are
     standing in front of - so openReportModal() calls it on its own. The
     "Use my location" button is there to re-pin or fine-tune, not to be the
     only way in.

     watchPosition (not getCurrentPosition) for the first fix: a single reading
     is often the worst one available while the GPS warms up. We take the
     first good fix and stop listening, so this stays quick indoors but is
     accurate outdoors where it matters. */
  /* Captured lazily: the modal is not in the DOM at script-parse time. */
  let reportUseLocationHtml = '';
  function useMyLocationForReport() {
    const useMyLocationButton = $('#report-use-location');
    if (!useMyLocationButton) return;
    if (!navigator.geolocation) {
      toast('Geolocation is unavailable in this browser - press "Pick on map" instead.', 'error');
      return;
    }
    if (!reportUseLocationHtml) reportUseLocationHtml = useMyLocationButton.innerHTML;
    // GPS can take several seconds (or hang while the user decides), so the
    // button has to say so - otherwise it looks like nothing happened.
    const setLocating = (busy) => {
      useMyLocationButton.disabled = busy;
      useMyLocationButton.classList.toggle('opacity-60', busy);
      useMyLocationButton.innerHTML = busy
        ? '<span class="material-symbols-outlined animate-spin">progress_activity</span>Locating…'
        : reportUseLocationHtml;
    };

    setLocating(true);
    let settled = false;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = position.coords.accuracy;
        // Ignore very rough fixes; if nothing better arrives we use this one.
        if (settled && accuracy > 50) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        setLocating(false);
        placePickMarker(
          position.coords.latitude,
          position.coords.longitude,
          { fromGps: true, accuracy: accuracy }
        );
        toast(accuracy && accuracy > 40
          ? 'Pinned, but GPS was only accurate to about ' + formatDistance(accuracy) + '. Use “Pick on map” to fine-tune.'
          : 'Pinned at your location (accurate to about ' + formatDistance(accuracy) + ').', 'ok');
      },
      (error) => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        setLocating(false);
        const denied = error && error.code === 1;
        toast(denied
          ? 'Location permission denied - you can still use "Pick on map".'
          : 'Could not read your location - try "Pick on map" instead.', 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  /* ============================= care actions ========================= */
  function afterMutation(message, tone) {
    state.tickerIndex = 0;
    state.tickerHidden = false;
    renderChips();
    renderFeed();
    renderTicker();
    renderMarkers();
    renderStatusBar();
    if (state.map) state.map.closePopup();
    if (message) toast(message, tone || 'ok');
  }

  function logCare(id, kind) {
    const animal = animalById(id);
    if (!animal) return;
    const at = new Date().toISOString();
    const note = kind === 'feed'
      ? 'fed ' + animal.name + ' (dry food + water top-up)'
      : kind === 'water'
        ? 'refilled the water bowl for ' + animal.name
        : 'logged a vet check for ' + animal.name;

    state.log.unshift({
      id: uid('log'), kind: kind, animalId: animal.id, stationId: animal.stationId,
      actor: state.profile.name || 'You', actorAvatar: state.profile.avatarUrl || null,
      note: note, place: animal.location.label,
      at: at, source: 'user'
    });

    if (kind === 'feed') { animal.lastFedAt = at; animal.feedCount += 1; }
    if (kind === 'water') { animal.lastWateredAt = at; animal.waterCount += 1; }
    if (kind === 'medicine') animal.health = 'treatment';

    if (!writeOverlay() && !state.saveWarningShown) {
      state.saveWarningShown = true;
      toast('Private storage is blocked, so this action lasts for this visit only.', 'error');
    }
    // Phase 4: shared feed — also POST to Supabase. Local always wins, but we
    // surface a warning if the cloud write failed so a "shared" feed never
    // silently looks like it synced when it did not.
    try {
      if (typeof window !== 'undefined' && typeof window.sbLogEvent === 'function') {
        Promise.resolve(window.sbLogEvent({ animalId: animal.id, stationId: animal.stationId, kind: kind, note: note, place: animal.location.label }))
          .then((ok) => {
            if (ok === false && !state.cloudWarned) {
              state.cloudWarned = true;
              toast('Saved on this device only - the shared feed could not be reached.', 'error');
            }
          })
          .catch(() => {});
      }
    } catch (err) { /* local save already succeeded - ignore backend failure */ }
    afterMutation(kind === 'feed'
      ? 'Feed logged for ' + animal.name + ' - thank you!'
      : kind === 'water'
        ? 'Water logged for ' + animal.name + ' - thank you!'
        : 'Care note logged for ' + animal.name + '.');
  }

  function logStationCheck(stationId) {
    const station = stationById(stationId);
    if (!station) return;
    const at = new Date().toISOString();
    station.lastServicedAt = at;
    station.capacityPct = Math.min(100, station.capacityPct + 15);
    station.status = station.capacityPct > 50 ? 'Volunteer run' : 'Refill due';
    state.log.unshift({
      id: uid('log'), kind: 'station', animalId: null, stationId: station.id,
      actor: state.profile.name || 'You', actorAvatar: state.profile.avatarUrl || null,
      note: 'checked ' + station.name + ' and topped the container up',
      place: station.ref, at: at, source: 'user'
    });
    writeOverlay();
    // Phase 4: shared station check — also POST to Supabase
    try {
      if (typeof window !== 'undefined' && typeof window.sbLogEvent === 'function') {
        window.sbLogEvent({ animalId: null, stationId: station.id, kind: 'station', note: 'checked ' + station.name + ' and topped the container up', place: station.ref });
      }
    } catch (err) { /* ignore */ }
    afterMutation(station.name + ' logged at ' + station.capacityPct + '% capacity.');
  }

  function resetDemo() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      toast('Local changes cleared - reloading the seed data…', 'info');
    } catch (err) {
      toast('Could not clear local storage.', 'error');
    }
    setTimeout(() => window.location.reload(), 600);
  }

  /* ------------------------- responsive list / map -------------------- */
  /* "map" means the map owns the screen; "list" means the feed owns it. This
     used to hide the sidebar only when narrow, so on desktop the split view
     always showed the list no matter what the app booted into - which is why
     the app could claim to open on the map and still land on the list.

     Both widths now honour the same rule, so the map is genuinely full-bleed
     on a phone AND on a desktop, and the toggle works the same on both. The
     sidebar's own `md:flex` is removed on map view because it would otherwise
     re-show the panel at desktop widths. */
  function switchMobileView(view) {
    state.mobileView = view;
    const sidebar = $('#sidebar-pane');
    const onMap = view === 'map';

    if (sidebar) {
      if (onMap) {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex', 'md:flex');
      } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
      }
    }

    /* Both toggles (mobile pill + desktop pill) label the action the user can
       take next, not the view they are currently in. */
    const label = onMap ? 'List' : 'Map';
    const icon = onMap ? 'list' : 'map';
    [$(`#mobile-view-toggle-label`), $('#desktop-list-toggle-label')].forEach((node) => {
      if (node) node.textContent = label;
    });
    [$(`#mobile-view-toggle-icon`), $('#desktop-list-toggle-icon')].forEach((node) => {
      if (node) node.textContent = icon;
    });

    if (state.map) setTimeout(() => state.map.invalidateSize(), 260);
  }

  /* ------------------------------ modals ----------------------------- */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
    if (id === 'report-modal') {
      state.pickMode = false;
      if (state.pickMarker && state.map) state.map.removeLayer(state.pickMarker);
      state.pickMarker = null;
    }
  }

  function closeAllModals() {
    $$('[data-modal]').forEach((modal) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
    document.body.style.overflow = '';
    state.pickMode = false;
  }
  /* ====================== "report a stray" workflow =================== */
  /* Turns the volunteer's quick answer about a bowl into dataset minutes. */
  function levelMinutes(species, kind, level) {
    const rule = policyFor(species)[kind];
    if (level === 'ok') return 5;
    if (level === 'needs') return rule.okHours * 60 + 90;
    return rule.urgentHours * 60 + 120;
  }

  function openReportModal() {
    const form = $('#report-form');
    if (!form) return;
    form.reset();

    const hint = $('#report-pick-hint');
    if (hint) hint.textContent = 'We pin your current location automatically. Press “Pick on map” if you saw the animal somewhere else.';
    const error = $('#report-error');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }

    /* Default to where the reporter actually IS: people report a stray they
       are standing in front of. A position we already know (from the opening
       locate) is applied instantly with no further prompt; otherwise ask for
       one. The old default was the map's viewport centre, which silently
       pinned the report wherever the user last panned to. */
    const known = state.userLocation;
    const fallback = state.map ? state.map.getCenter() : (state.meta.center || { lat: 0, lng: 0 });
    const start = known || fallback;
    const latInput = $('#report-lat');
    const lngInput = $('#report-lng');
    if (latInput) latInput.value = Number(start.lat).toFixed(6);
    if (lngInput) lngInput.value = Number(start.lng).toFixed(6);

    if (known) {
      /* Already located - no need to ask the browser again. */
      if (hint) hint.textContent = 'Pinned to your current location. Press “Pick on map” if the animal was somewhere else.';
    } else if (hint) {
      hint.textContent = 'Finding your location… press “Pick on map” to choose the spot yourself.';
    }
    if (!known) useMyLocationForReport();

    /* No "your name" field any more: the log is attributed to state.profile.name,
       which the shared header already keeps in sync with the signed-in account
       (see syncProfileFromAuth). Asking twice was pure friction. */

    openModal('report-modal');
  }

  /* ------------------------- report photo picker ---------------------- */
  /* Holds the chosen File until submit. We keep the File (not a data URL)
     so it can be uploaded straight to Supabase Storage. */
  let pendingReportPhoto = null;

  function setReportPhotoPreview(src) {
    const box = $('#report-photo-preview');
    if (!box) return;
    if (!src) {
      box.innerHTML = '<span class="material-symbols-outlined text-[26px]">photo_camera</span>';
      return;
    }
    box.innerHTML = '<img alt="Selected stray photo" class="w-full h-full object-cover" src="' + esc(src) + '">';
  }

  function wireReportPhoto() {
    const input = $('#report-photo-file');
    const clear = $('#report-photo-clear');
    const hint = $('#report-photo-hint');
    if (!input) return;

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { pendingReportPhoto = null; setReportPhotoPreview(null); if (clear) clear.classList.add('hidden'); return; }
      if (!/^image\//.test(file.type)) {
        toast('Please choose an image file.', 'error');
        input.value = '';
        return;
      }
      pendingReportPhoto = file;
      // Object URL is cheap and instant; the real upload happens on submit.
      setReportPhotoPreview(URL.createObjectURL(file));
      if (clear) clear.classList.remove('hidden');
      if (hint) {
        const mb = typeof window.sbFormatBytes === 'function' ? window.sbFormatBytes(file.size) : (file.size / 1048576).toFixed(1) + ' MB';
        hint.textContent = file.name + ' - ' + mb + '. It is compressed to about 110 KB before upload.';
      }
    });

    if (clear) {
      clear.addEventListener('click', () => {
        pendingReportPhoto = null;
        input.value = '';
        setReportPhotoPreview(null);
        clear.classList.add('hidden');
        if (hint) hint.textContent = 'Take or choose a photo. It is shrunk to 1200px and uploaded automatically.';
      });
    }
  }

  function resetReportPhoto() {
    pendingReportPhoto = null;
    const input = $('#report-photo-file');
    if (input) input.value = '';
    const clear = $('#report-photo-clear');
    if (clear) clear.classList.add('hidden');
    const hint = $('#report-photo-hint');
    if (hint) hint.textContent = 'Take or choose a photo. It is shrunk to 1200px and uploaded automatically.';
    setReportPhotoPreview(null);
  }

  async function submitReport(event) {
    event.preventDefault();
    const value = (id) => {
      const node = document.getElementById(id);
      return node ? String(node.value || '').trim() : '';
    };
    const error = $('#report-error');
    const fail = (message) => {
      if (error) {
        error.textContent = message;
        error.classList.remove('hidden');
      }
    };

    const species = value('report-species') || 'cat';
    const lat = Number(value('report-lat'));
    const lng = Number(value('report-lng'));
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
      fail('Please pick the location first - press “Pick on map” or “Use my location”.');
      return;
    }

    const now = Date.now();
    const reporter = value('report-reporter');
    const station = nearestStation(lat, lng);
    const place = value('report-place') || 'Community report pin';

    const button = $('#report-submit');
    const originalLabel = button ? button.innerHTML : '';
    const setBusy = (busy, label) => {
      if (!button) return;
      button.disabled = busy;
      button.classList.toggle('opacity-60', busy);
      if (label) button.innerHTML = label;
      else button.innerHTML = originalLabel;
    };

    /* The three "needs" ticks. Read BEFORE the upload block because
       sbSubmitReport() needs them too.

       report-health is a CHECKBOX (id kept from the old select), so read
       .checked rather than going through value(). */
    const healthBox = document.getElementById('report-health');
    const needsVet = !!(healthBox && healthBox.checked);
    const foodBox = document.getElementById('report-needs-food');
    const needsFood = !!(foodBox && foodBox.checked);
    const waterBox = document.getElementById('report-needs-water');
    const needsWater = !!(waterBox && waterBox.checked);
    /* A tick means "urgent", not just "needs" - the reporter is looking at the
       animal right now and telling us the bowl is empty. This feeds
       levelMinutes(), which backdates lastFedAt/lastWateredAt so computeStatus
       lands on 'urgent' and the pin sorts to the top. Unticked stays 'ok'
       (5 minutes ago = looks just fed). */
    const foodLevel = needsFood ? 'urgent' : 'ok';
    const waterLevel = needsWater ? 'urgent' : 'ok';

    /* Upload the photo + share the report. Local save happens either way, so
       a network failure never loses what the volunteer typed. */
    setBusy(true, '<span class="material-symbols-outlined text-[18px]">upload</span>Uploading photo…');
    let photoUrl = null;
    let shared = false;
    try {
      if (pendingReportPhoto && typeof window.sbUploadReportPhoto === 'function') {
        photoUrl = await window.sbUploadReportPhoto(pendingReportPhoto);
      }
      if (typeof window.sbSubmitReport === 'function') {
        shared = await window.sbSubmitReport({
          name: value('report-name') || 'Unnamed stray',
          species: species,
          lat: lat,
          lng: lng,
          place: place,
          photoUrl: photoUrl,
          description: value('report-description'),
          needsVet: needsVet,
          needsFood: needsFood,
          needsWater: needsWater,
        });
      }
    } catch (err) {
      console.warn('[FeedAnAnimalMap] report upload failed', err);
      toast('Photo upload failed - saving the report on this device only.', 'error');
    }
    setBusy(false);
    /* sbSubmitReport returns the new row's id. Reuse it for the local pin so
       the local copy and the cloud row are one animal - otherwise the same
       report would show up twice the next time sbLoadReports() runs. */
    const localId = (shared && typeof shared === 'string') ? 'report-' + shared : 'report-' + now.toString(36);

    const animal = {
      id: localId,
      name: value('report-name') || 'Unnamed stray',
      species: species,
      breed: value('report-breed') || speciesInfo(species).singular + ' (breed unknown)',
      sex: value('report-sex') || 'unknown',
      ageClass: value('report-age') || 'unknown',
      color: value('report-color') || 'Not recorded',
      description: value('report-description') || 'Newly reported by a community volunteer.',
      temperament: 'unknown',
      /* The medical-help tick. 'critical' (not 'treatment') so it lands on the
         top-priority branch of computeStatus/primaryIssue and the card reads
         "Critical condition - vet attention needed". */
      health: needsVet ? 'critical' : 'healthy',
      sterilized: value('report-sterilized') === 'yes',
      vaccinated: false,
      microchipped: false,
      caretakers: [reporter || state.profile.name || 'Guest volunteer'],
      /* Kept so the profile can say WHO reported it, not just "from this
         device". Without it the drawer had nothing but "this device". */
      reporterName: reporter || (state.profile.name || ''),
      tags: ['community-report'],
      notes: value('report-notes') || 'Watch this spot for a few days and log what you see.',
      photoUrl: photoUrl || null,
      stationId: station ? station.id : null,
      location: { label: place, area: station ? station.area : 'Reported area', lat: lat, lng: lng },
      reportedAt: new Date(now).toISOString(),
      lastFedAt: new Date(now - levelMinutes(species, 'food', foodLevel) * 60000).toISOString(),
      lastWateredAt: new Date(now - levelMinutes(species, 'water', waterLevel) * 60000).toISOString(),
      feedCount: 0,
      waterCount: 0,
      source: 'report'
    };

    state.animals.push(animal);
    if (reporter) state.profile = { name: reporter };
    state.log.unshift({
      id: uid('log'), kind: 'report', animalId: animal.id, stationId: animal.stationId,
      actor: state.profile.name || 'Guest volunteer',
      note: 'reported a new stray: ' + animal.name + ' (' + animal.breed + ')',
      place: animal.location.label, at: animal.reportedAt, source: 'user'
    });

    writeOverlay();
    closeModal('report-modal');
    resetReportPhoto();
    // Also tell the shared feed, so other volunteers see the stray appear live.
    try {
      if (typeof window.sbLogEvent === 'function') {
        window.sbLogEvent({
          animalId: animal.id, stationId: animal.stationId, kind: 'report',
          note: 'reported a new stray: ' + animal.name + ' (' + animal.breed + ')',
          place: animal.location.label,
        });
      }
    } catch (err) { /* local save already succeeded */ }

    state.filter = 'all';
    state.query = '';
    const search = $('#sidebar-search');
    if (search) search.value = '';
    afterMutation(
      shared
        ? 'Report shared - ' + animal.name + ' is now on the map for everyone.'
        : 'Report saved on this device - ' + animal.name + ' is on the map.',
      'ok'
    );
    switchMobileView('map');
    revealAnimal(animal.id);
  }
  /* ========================== details drawer ========================= */
  /* detailRow(label, value) renders one fact, but only if it is actually known.

     The report form was cut down to photo / species / needs / location /
     description, so a reported stray carries no sex, age, temperament, neuter
     or microchip data. Printing those anyway produced a wall of confident
     noise ("Sex / age: unknown • unknown", "Vaccinated: No") that read as real
     observations and made the profile look broken.

     Anything unknown, empty or unrecorded is skipped instead. Same for the
     boolean care flags: "No" is indistinguishable from "we were never told",
     so only an explicit "yes" is worth showing. */
  const isUnknown = (value) => {
    const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    return !text || text === 'unknown' || text === 'not recorded' ||
      text === 'not sure' || text === 'none recorded' || text === 'unassigned' ||
      text === 'not assigned' || text === 'n/a' || text === '-';
  };
  function detailRow(label, value) {
    if (isUnknown(value)) return '';
    return '<div class="flex items-start justify-between gap-3 py-1.5 border-b border-surface-container-high/70">' +
      '<span class="font-label-sm text-xs text-on-surface-variant">' + esc(label) + '</span>' +
      '<span class="font-label-sm text-xs text-on-surface font-semibold text-right">' + esc(value) + '</span>' +
      '</div>';
  }

  /* Only worth a row when a volunteer has actually logged something. */
  function countRow(label, count) {
    const n = Number(count) || 0;
    if (n <= 0) return '';
    return detailRow(label, n + (n === 1 ? ' time' : ' times'));
  }

  function openDetails(id) {
    const animal = animalById(id);
    if (!animal) return;
    const row = { animal: animal, status: statusOf(animal) };
    const issue = primaryIssue(row);
    const station = stationById(animal.stationId);
    const history = historyFor(animal.id).slice(0, 6);
    const host = $('#details-content');
    if (!host) return;

    const historyHtml = history.length
      ? '<ul class="flex flex-col gap-1.5">' + history.map((entry) => '<li class="flex items-start gap-2">' +
          '<span class="material-symbols-outlined text-[16px] text-primary">' +
            (entry.kind === 'feed' ? 'restaurant' : entry.kind === 'water' ? 'water_drop' : entry.kind === 'report' ? 'campaign' : 'event_note') +
          '</span>' +
          '<span class="font-body-sm text-xs text-on-surface-variant flex-1">' + esc(entry.note) + '</span>' +
          '<span class="font-label-sm text-[11px] text-outline shrink-0">' + relativeTime(entry.at) + '</span>' +
        '</li>').join('') + '</ul>'
      : '<p class="font-body-sm text-xs text-on-surface-variant">No care logged from this device yet. Your first feed or water log will show up here.</p>';

    const mapsUrl2 = 'https://www.google.com/maps/search/?api=1&query=' + animal.location.lat + ',' + animal.location.lng;
    const coord2 = Number(animal.location.lat).toFixed(6) + ', ' + Number(animal.location.lng).toFixed(6);
    const directions2 = 'https://www.google.com/maps/dir/?api=1&destination=' + animal.location.lat + ',' + animal.location.lng;

    host.innerHTML =
      '<div class="flex items-start gap-3">' +
        '<div class="w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm">' + avatarHtml(animal) + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
              '<h3 class="font-headline-md text-headline-md text-on-surface">' + esc(animal.name) + '</h3>' +
              '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
          esc([animal.breed, animal.color].filter((part) => !isUnknown(part)).join(' • ') || speciesInfo(animal.species).singular) +
          '</p>' +
            '</div>' +
            '<button type="button" data-close-modal="details-modal" class="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-outline" title="Close">' +
              '<span class="material-symbols-outlined text-[18px]">close</span></button>' +
          '</div>' +
          '<p class="font-label-sm text-xs text-outline flex items-center gap-1 mt-1">' +
            '<span class="material-symbols-outlined text-[14px] text-primary">pin_drop</span>' + esc(animal.location.label) +
            '<span class="mx-1">•</span>' + formatDistance(row.status.distance) + ' away</p>' +
        '</div>' +
      '</div>' +

      '<p class="mt-4 p-2.5 rounded-lg flex items-center gap-2 font-label-md text-label-md ' +
        (issue.tone === 'error' ? 'bg-error-container text-on-error-container' : issue.tone === 'tertiary' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container') + '">' +
        '<span class="material-symbols-outlined text-[18px]">' + issue.icon + '</span>' + esc(issue.text) + '</p>' +

      '<div class="mt-4 grid grid-cols-2 gap-3">' +
        '<div class="p-2.5 rounded-lg bg-surface-container">' +
          '<p class="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-error">restaurant</span> Food</p>' +
          '<p class="font-body-sm text-xs font-semibold text-on-surface mt-1">' +
            esc(row.status.food === 'ok' ? 'Bowl stocked' : row.status.food === 'needs' ? 'Empty - refill needed' : 'Urgent - long empty') + '</p>' +
          '<p class="font-label-sm text-[11px] text-outline">last fed ' + relativeTime(animal.lastFedAt) + '</p>' +
        '</div>' +
        '<div class="p-2.5 rounded-lg bg-surface-container">' +
          '<p class="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-tertiary">water_drop</span> Water</p>' +
          '<p class="font-body-sm text-xs font-semibold text-on-surface mt-1">' +
            esc(row.status.water === 'ok' ? 'Fresh' : row.status.water === 'needs' ? 'Low - top up' : 'Urgent - dry bowl') + '</p>' +
          '<p class="font-label-sm text-[11px] text-outline">last filled ' + relativeTime(animal.lastWateredAt) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="mt-4">' +
        detailRow('Species', speciesInfo(animal.species).singular) +
        /* Sex/age and temperament are only meaningful for animals someone has
           actually observed up close; a report never has them. */
        detailRow('Sex / age', [animal.sex, animal.ageClass].every(isUnknown)
          ? '' : (isUnknown(animal.sex) ? '' : animal.sex) + ' • ' + (isUnknown(animal.ageClass) ? '' : animal.ageClass)) +
        detailRow('Temperament', animal.temperament) +
        detailRow('Health', animal.health) +
        /* Care flags only render when affirmative: "No" would claim we checked
           and found nothing, when really nobody was asked. */
        (animal.sterilized ? detailRow('Neutered', 'Yes') : '') +
        (animal.vaccinated ? detailRow('Vaccinated', 'Yes') : '') +
        (animal.microchipped ? detailRow('Microchipped', 'Yes') : '') +
        detailRow('First reported', relativeTime(animal.reportedAt) + ' (' + clockTime(animal.reportedAt) + ')') +
        countRow('Feeds logged', animal.feedCount) +
        countRow('Water refills logged', animal.waterCount) +
        detailRow('Caretakers', animal.caretakers.length ? animal.caretakers.join(', ') : '') +
        detailRow('Feeding station', station ? station.name : '') +
        (animal.source === 'report' ? detailRow('Reported', animal.reporterName || 'by a community volunteer') : '') +
      '</div>' +

      '<div class="mt-4 p-2.5 rounded-lg bg-surface-container-low">' +
        '<p class="font-label-sm text-[11px] text-on-surface-variant">Exact GPS (tap to open in Google Maps)</p>' +
        '<p class="font-mono text-xs mt-1"><a href="' + esc(mapsUrl2) + '" target="_blank" rel="noopener" style="text-decoration:underline">' + esc(coord2) + '</a> ' +
        '<button type="button" data-action="copy-coords" data-id="' + esc(animal.id) + '" style="text-decoration:underline">Copy</button></p>' +
      '</div>' +

      '<p class="mt-4 font-body-sm text-body-sm text-on-surface">' + esc(animal.description) + '</p>' +
      '<p class="mt-2 p-2.5 rounded-lg bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">' +
        '<span class="material-symbols-outlined text-[14px] text-primary align-middle mr-1">lightbulb</span>' + esc(animal.notes) + '</p>' +
      (animal.tags.length
        ? '<div class="flex flex-wrap gap-1.5 mt-3">' + animal.tags.map((tag) =>
            '<span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px]">#' + esc(tag) + '</span>').join('') + '</div>'
        : '') +

      '<div class="mt-4">' +
        '<p class="font-label-md text-label-md text-on-surface font-semibold mb-2">Care log from this device</p>' +
        historyHtml +
      '</div>' +

      /* Directions leads this row, in solid blue with the word spelled out. It is the
         reason most people open the profile, so it must not look like a
         low-priority outline chip after four other buttons. */
      '<div class="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-surface-container-high">' +
        '<a href="' + esc(directions2) + '" target="_blank" rel="noopener" ' +
          'class="h-11 px-5 rounded-full bg-tertiary text-white font-label-md text-label-md font-extrabold flex items-center gap-2 shadow-md hover:opacity-95 active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[20px]">directions</span>Directions</a>' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[18px]">restaurant</span>I fed ' + esc(animal.name) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">water_drop</span>Gave water</button>' +
        '<button type="button" data-action="medicine" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">medical_services</span>Vet visit</button>' +
        '<button type="button" data-action="locate" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">my_location</span>Show on map</button>' +
      '</div>';

    openModal('details-modal');
    setSelected(animal.id, false);
  }
  /* The Sign in button label is now handled by site-header.js on every page,
     so index.js does not need its own copy. */

  // Keep local profile + report name in sync with the real Supabase login
  /* Pulls the provider's profile photo (Google sets user_metadata.avatar_url /
     picture), stores it on the local profile, and mirrors it into the profiles
     table so other volunteers can resolve the same face. */
  async function syncAvatar(user) {
    try {
      const meta = (user && user.user_metadata) || {};
      const url = meta.avatar_url || meta.picture || meta.photo_url || null;
      const clean = url ? String(url) : null;
      const client = (typeof window !== 'undefined' && window.sb) ? window.sb : null;
      if (clean && client && user && user.id) {
        try {
          await client.from('profiles')
            .upsert({ id: user.id, avatar_url: clean }, { onConflict: 'id' });
        } catch (e) { /* profile write is best-effort only */ }
      }
      return clean || state.profile.avatarUrl || null;
    } catch (e) {
      return (state.profile && state.profile.avatarUrl) || null;
    }
  }

  async function syncProfileFromAuth() {
    try {
      const auth = (typeof window !== 'undefined' && window.sbAuth) ? window.sbAuth : null;
      const getName = (typeof window !== 'undefined' && typeof window.sbDisplayName === 'function')
        ? window.sbDisplayName : null;
      if (!auth || !getName) return;
      const user = await auth.currentUser();
      if (user && !user.is_anonymous) {
        const name = await getName(state.profile.name || 'Guest volunteer');
        const avatarUrl = await syncAvatar(user);
        if (name && name !== state.profile.name) {
          state.profile = { name: name, avatarUrl: avatarUrl || state.profile.avatarUrl || null };
          writeOverlay();
          renderTicker();
        }
      }
      try {
        const client = auth.client();
        if (client && client.auth && client.auth.onAuthStateChange) {
          client.auth.onAuthStateChange(async () => {
            const u = await auth.currentUser();
            if (u && !u.is_anonymous) {
              const n = await getName(state.profile.name || 'Guest volunteer');
              const av = await syncAvatar(u);
              if (n) { state.profile = { name: n, avatarUrl: av || state.profile.avatarUrl || null }; writeOverlay(); renderTicker(); }
            }
          });
        }
      } catch (e) {}
    } catch (e) { /* stay as guest */ }
  }

  /* ============================ event wiring ========================= */
  function handleAction(button) {
    const action = button.getAttribute('data-action');
    const id = button.getAttribute('data-id');
    if (action === 'feed' || action === 'water' || action === 'medicine') {
      if (state.map) state.map.closePopup();
      logCare(id, action);
      return;
    }
    if (action === 'locate') {
      closeModal('details-modal');
      revealAnimal(id);
      return;
    }
    if (action === 'details') {
      if (state.map) state.map.closePopup();
      openDetails(id);
      return;
    }
    if (action === 'station-check') logStationCheck(button.getAttribute('data-station'));
    if (action === 'copy-coords') {
      const a = animalById(id);
      if (a) {
        const txt = Number(a.location.lat).toFixed(6) + ', ' + Number(a.location.lng).toFixed(6);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(() => toast('Coordinates copied: ' + txt, 'ok'));
          } else { toast(txt, 'info'); }
        } catch (e) { toast(txt, 'info'); }
      }
      return;
    }
  }

  function wireEvents() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;

      const filterButton = target.closest('[data-filter]');
      if (filterButton) {
        state.filter = filterButton.getAttribute('data-filter');
        setSelected(null, false);
        renderChips();
        renderFeed();
        renderMarkers();
        return;
      }

      const tickerButton = target.closest('[data-ticker]');
      if (tickerButton) {
        if (tickerButton.getAttribute('data-ticker') === 'dismiss') {
          state.tickerHidden = true;
        } else {
          state.tickerIndex += 1;
        }
        renderTicker();
        return;
      }

      const actionButton = target.closest('[data-action]');
      if (actionButton) {
        handleAction(actionButton);
        return;
      }

      const closeButton = target.closest('[data-close-modal]');
      if (closeButton) {
        closeModal(closeButton.getAttribute('data-close-modal'));
        return;
      }

      const reportButton = target.closest('[data-open-report]');
      if (reportButton) {
        event.preventDefault();
        openReportModal();
        return;
      }

      const modal = target.closest('[data-modal]');
      if (modal && target === modal) closeModal(modal.id);
    });

    const search = $('#sidebar-search');
    if (search) {
      search.addEventListener('input', debounce(() => {
        state.query = search.value;
        renderFeed();
        renderMarkers();
      }, 160));
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          const first = selectAnimals()[0];
          if (first) revealAnimal(first.animal.id);
        } else if (event.key === 'Escape') {
          search.value = '';
          state.query = '';
          renderFeed();
          renderMarkers();
        }
      });
    }

    const sort = $('#feed-sort');
    if (sort) {
      sort.addEventListener('change', () => {
        state.sort = sort.value;
        renderFeed();
        renderMarkers();
      });
    }

    const nearMe = $('#near-me-btn');
    if (nearMe) nearMe.addEventListener('click', locateMe);
    const zoomIn = $('#zoom-in');
    if (zoomIn) zoomIn.addEventListener('click', () => state.map && state.map.zoomIn());
    const zoomOut = $('#zoom-out');
    if (zoomOut) zoomOut.addEventListener('click', () => state.map && state.map.zoomOut());
    const layerButton = $('#layer-btn');
    if (layerButton) layerButton.addEventListener('click', cycleBaseLayer);
    /* Only the desktop pill stays on "Center on ..." - its own label says so.
       The mobile circle is a bare my_location icon, which every other map app
       reads as "take me to ME", so it runs the real geolocation flow instead. */
    const centerOnPark = () => {
      if (!state.map) return;
      const center = state.meta.center || { lat: 0, lng: 0 };
      state.map.flyTo([center.lat, center.lng], state.meta.defaultZoom || 15, { duration: 0.7 });
      toast('Centered on ' + (state.meta.region || 'Oakwood Park'), 'info');
    };
    const centerButton = $('#center-btn');
    if (centerButton) centerButton.addEventListener('click', centerOnPark);
    const mobileLocateButton = $('#mobile-locate-btn');
    if (mobileLocateButton) mobileLocateButton.addEventListener('click', locateMe);

    /* Mobile map chrome (CheapFoodMap style): Filters opens the list where the
       search box and filter chips live; the search circle does the same and
       puts the cursor straight into the search box. */
    const filtersButton = $('#mobile-filters-btn');
    if (filtersButton) {
      filtersButton.addEventListener('click', () => switchMobileView('list'));
    }
    const searchButton = $('#mobile-search-btn');
    if (searchButton) {
      searchButton.addEventListener('click', () => {
        switchMobileView('list');
        const input = $('#sidebar-search');
        if (input) setTimeout(() => input.focus(), 150);
      });
    }

    /* The bottom-nav pill (phones) and the floating pill (desktop) drive the same
       state, so the list stays one tap away at every width. */
    const viewToggle = () => switchMobileView(state.mobileView === 'map' ? 'list' : 'map');
    const mobileToggle = $('#mobile-view-toggle');
    if (mobileToggle) mobileToggle.addEventListener('click', viewToggle);
    const desktopToggle = $('#desktop-list-toggle');
    if (desktopToggle) desktopToggle.addEventListener('click', viewToggle);

    const reportForm = $('#report-form');
    if (reportForm) reportForm.addEventListener('submit', submitReport);

    const pickOnMap = $('#report-pick-map');
    if (pickOnMap) {
      pickOnMap.addEventListener('click', () => {
        state.pickMode = true;
        const modal = $('#report-modal');
        if (modal) modal.classList.add('fta-picking');
        switchMobileView('map');
        toast('Now click the map where you saw the animal.', 'info');
      });
    }

    const useMyLocationButton = $('#report-use-location');
    if (useMyLocationButton) useMyLocationButton.addEventListener('click', useMyLocationForReport);

    const reportCancel = $('#report-cancel');
    if (reportCancel) reportCancel.addEventListener('click', () => closeModal('report-modal'));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAllModals();
    });

    window.addEventListener('resize', debounce(() => switchMobileView(state.mobileView), 200));

    window.setInterval(() => {
      if (state.tickerHidden) return;
      const feed = activityFeed();
      if (feed.length < 2) return;
      state.tickerIndex = (state.tickerIndex + 1) % feed.length;
      renderTicker();
    }, TICKER_ROTATE_MS);
  }
  /* ----------------------------- deep links --------------------------- */
  /* Lets other pages (activity.html) jump straight to an animal:
     index.html#animal=milo  ->  opens the details modal for Milo.
     Also understands #station=<id> and clears cleanly when the hash changes. */
  function wireDeepLink() {
    const apply = () => {
      const hash = String(window.location.hash || '').replace(/^#/, '');
      if (!hash) return;
      const params = new URLSearchParams(hash);
      const animalId = params.get('animal');
      const stationId = params.get('station');
      if (animalId && animalById(animalId)) {
        const animal = animalById(animalId);
        if (state.map) {
          state.map.setView([animal.location.lat, animal.location.lng], 16, { animate: true });
        }
        openDetails(animalId);
        return;
      }
      if (stationId && stationById(stationId)) {
        const station = stationById(stationId);
        if (state.map) state.map.setView([station.location.lat, station.location.lng], 16, { animate: true });
        toast('Showing ' + (station.name || stationId), 'info');
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
  }

  /* ============================== bootstrap ========================== */
  async function boot() {
    const overlay = readOverlay();

    try {
      const loaded = await loadDataset();
      hydrate(loaded.payload, overlay, loaded.sourceLabel);
    } catch (err) {
      console.error('[FeedAnAnimalMap] dataset failed to load', err);
      // Mobile boots straight into the map, so flip back to the list to make
      // the error message (rendered into the feed) visible.
      switchMobileView('list');
      const host = $('#animals-feed');
      if (host) {
        host.innerHTML = '<div class="p-4 rounded-lg bg-error-container text-on-error-container font-body-sm text-body-sm">' +
          'Could not load <strong>data/animals.json</strong>. Serve this folder over http (for example ' +
          '<code class="font-mono">npx serve .</code>) or keep <code class="font-mono">data/animals-data.js</code> ' +
          'next to index.html for offline use.</div>';
      }
      toast('Dataset could not be loaded.', 'error');
      return;
    }

    if (initMap()) {
      renderUserMarker();
      renderMarkers();
    }
    renderChips();
    renderFeed();
    renderTicker();
    renderStatusBar();
    /* Phones land on the map (one pane fits the screen); desktop keeps the split
       view, so the side menu is there from the first frame. The desktop pill
       can still collapse it to a full-bleed map on demand. */
    switchMobileView(isNarrow() ? 'map' : 'list');
    /* Point the opening frame at the visitor (or the New York fallback). On a
       phone the sidebar hides here, so wait for switchMobileView()'s
       invalidateSize() (260ms) or the flyTo aims at a zero-size container.
       The desktop map keeps its size, so it can fly straight away. */
    window.setTimeout(openAtVisitor, isNarrow() ? 300 : 0);
    wireEvents();
    wireReportPhoto();
    syncProfileFromAuth();
    wireDeepLink();

    // Phase 4: shared backend — anonymous auth + merge recent cloud events + live ticker
    try {
      // supabase-client.js explicitly assigns its helpers onto window, so a plain
      // window lookup is enough (no eval, no bare global references).
      const getFn = (name) => {
        try {
          if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
        } catch (e) { /* ignore */ }
        return null;
      };
      const ensureAuth = getFn('sbEnsureAuth');
      const loadRecent = getFn('sbLoadRecentEvents');
      const loadReports = getFn('sbLoadReports');
      const liveTicker = getFn('sbLiveTicker');
      if (ensureAuth) ensureAuth();

      /* Pull every community report so strays reported by OTHER people appear
         on this visitor's map. Without this the reports table was written but
         never read, so the map was empty for everyone. */
      if (loadReports) {
        loadReports().then((rows) => {
          if (!rows || !rows.length) return;
          /* Match the id convention used in hydrate(), so a report this device
             made locally and the same row from the cloud collapse into one
             pin instead of doubling up. */
          const merged = new Map(state.animals.map((a) => [a.id, a]));
          let added = 0;
          rows.forEach((raw) => {
            const animal = normalizeAnimal(raw, 'report');
            if (merged.has(animal.id)) return;
            merged.set(animal.id, animal);
            added += 1;
          });
          if (!added) return;
          state.animals = Array.from(merged.values());
          state.fitted = true; /* the opening fit already ran; keep the camera */
          renderFeed();
          renderMarkers();
          renderStatusBar();
          toast(added + ' community report' + (added === 1 ? '' : 's') + ' on the map.', 'info');
        }).catch(() => {});
      }

      if (loadRecent) {
        loadRecent(30).then((rows) => {
          if (!rows || !rows.length) return;
          let added = 0;
          rows.forEach((r) => {
            const exists = state.activity.some((a) => a.id === r.id);
            if (exists) return;
            state.activity.unshift({
              id: r.id,
              actor: r.actor_name || 'Volunteer',
              actorAvatar: r.actor_avatar || undefined,
              kind: r.kind,
              animalId: r.animal_id || undefined,
              stationId: r.station_id || undefined,
              note: r.note || (r.kind + (r.animal_id ? ' ' + r.animal_id : '')),
              place: r.place || '',
              at: r.created_at,
              source: 'cloud',
            });
            added += 1;
          });
          if (added) { state.tickerIndex = 0; renderTicker(); }
        }).catch(() => {});
      }
      if (liveTicker) {
        liveTicker((row) => {
          if (!row) return;
          const exists = state.activity.some((a) => a.id === row.id);
          if (exists) return;
          state.activity.unshift({
            id: row.id,
            actor: row.actor_name || 'Volunteer',
            actorAvatar: row.actor_avatar || undefined,
            kind: row.kind,
            animalId: row.animal_id || undefined,
            stationId: row.station_id || undefined,
            note: row.note || (row.kind + (row.animal_id ? ' ' + row.animal_id : '')),
            place: row.place || '',
            at: row.created_at,
            source: 'cloud',
          });
          state.tickerIndex = 0;
          renderTicker();
          toast('Live: ' + (row.actor_name || 'Volunteer') + ' logged ' + row.kind, 'info');
        });
      }
    } catch (err) { console.warn('[sb] backend init skipped', err.message); }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  /* ================== Node export for tools/selftest.js =============== */
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) {
    module.exports = {
      haversine: haversine,
      formatDistance: formatDistance,
      relativeTime: relativeTime,
      isoFromMinutes: isoFromMinutes,
      isoFromDays: isoFromDays,
      minutesSince: minutesSince,
      clockTime: clockTime,
      stateFor: stateFor,
      policyFor: policyFor,
      computeStatus: computeStatus,
      levelMinutes: levelMinutes,
      normalizeAnimal: normalizeAnimal,
      normalizeStation: normalizeStation,
      normalizeActivity: normalizeActivity,
      nameInitials: nameInitials,
      nameHue: nameHue,
      personAvatarHtml: personAvatarHtml,
      animalThumbHtml: animalThumbHtml,
      layerSubdomains: layerSubdomains,
      setPolicy: (policy) => {
        POLICY = Object.assign({ default: { food: { okHours: 8, urgentHours: 14 }, water: { okHours: 6, urgentHours: 10 } } }, policy || {});
      }
    };
  }
}());

