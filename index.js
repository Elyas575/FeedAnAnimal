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
    map: null, markerLayer: null, markers: {}, userMarker: null, pickMarker: null,
    pickMode: false, mobileView: 'list', tickerIndex: 0, tickerHidden: false,
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
    state.userLocation = overlay.userLocation || state.meta.center || null;
    state.profile = overlay.profile || { name: state.meta.defaultVolunteerName || 'Guest volunteer' };
    state.dataSource = sourceLabel;

    applyUserLog();
  }
  /* ============================== selectors =========================== */
  const animalById = (id) => state.animals.find((a) => a.id === id) || null;
  const stationById = (id) => state.stations.find((s) => s.id === id) || null;
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
      '<div class="w-8 h-8 rounded-full ' + (isUser ? 'bg-primary-fixed' : 'bg-secondary-container') + ' flex items-center justify-center shrink-0 mt-0.5">' +
        '<span class="material-symbols-outlined ' + (isUser ? 'text-on-primary-fixed-variant' : 'text-on-secondary-container') + ' text-[18px]">volunteer_activism</span>' +
      '</div>' +
      '<div class="flex-1 min-w-0 pr-4">' +
        '<div class="flex items-center justify-between">' +
          '<span class="font-label-sm text-label-sm text-primary font-bold">' + (isUser ? 'Your activity' : 'Live Activity') + '</span>' +
          '<span class="font-label-sm text-label-sm text-outline">' + relativeTime(entry.at) + '</span>' +
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
    const source = $('#data-source');
    if (source) source.textContent = state.animals.length + ' animals tracked • ' + state.dataSource;
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
      '<div class="fta-popup__actions">' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--primary">' +
          '<span class="material-symbols-outlined">restaurant</span>I fed ' + esc(animal.name) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--water">' +
          '<span class="material-symbols-outlined">water_drop</span>Water</button>' +
        '<a class="fta-btn fta-btn--ghost" target="_blank" rel="noopener" href="' + esc(directions) + '" title="Walking directions">' +
          '<span class="material-symbols-outlined">directions</span></a>' +
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
      '<div class="fta-popup__actions">' +
        '<button type="button" data-action="station-check" data-station="' + esc(station.id) + '" class="fta-btn fta-btn--primary">' +
          '<span class="material-symbols-outlined">checklist</span>Log a station check</button>' +
        '<a class="fta-btn fta-btn--ghost" target="_blank" rel="noopener" title="Directions" ' +
          'href="https://www.google.com/maps/dir/?api=1&destination=' + station.location.lat + ',' + station.location.lng + '">' +
          '<span class="material-symbols-outlined">directions</span></a>' +
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
    /* Leaflet renders Google's raster tiles; Google's own terms/attribution still apply. */
    state.map = window.L.map('map', {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: state.meta.maxZoom || 20,
      worldCopyJump: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5
    }).setView([center.lat, center.lng], state.meta.defaultZoom || 15);

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
    const bounds = [];
    rows.forEach((row) => {
      const marker = animalMarker(row);
      state.markers[row.animal.id] = marker;
      group.addLayer(marker);
      bounds.push([row.animal.location.lat, row.animal.location.lng]);
    });
    state.stations.forEach((station) => group.addLayer(stationMarker(station)));

    state.map.addLayer(group);
    state.markerLayer = group;

    if (bounds.length && !state.fitted) {
      state.fitted = true;
      state.map.fitBounds(bounds, { padding: [48, 48], maxZoom: state.meta.defaultZoom || 15 });
    }
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

  function renderUserMarker() {
    if (!state.map || !state.userLocation) return;
    if (state.userMarker) state.map.removeLayer(state.userMarker);
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
  function locateMe() {
    if (!navigator.geolocation) {
      toast('This browser cannot share a location - using Oakwood Park center.', 'error');
      return;
    }
    toast('Requesting your location…', 'info');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        writeOverlay();
        renderUserMarker();
        renderMarkers();
        renderFeed();
        if (state.map) state.map.flyTo([state.userLocation.lat, state.userLocation.lng], 16, { duration: 0.8 });
        toast('Distances are now measured from your position.', 'ok');
      },
      (error) => {
        toast('Location unavailable (' + error.message + ') - keeping Oakwood Park center.', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function useParkCenter() {
    state.userLocation = state.meta.center || null;
    writeOverlay();
    renderUserMarker();
    renderFeed();
    renderMarkers();
    toast('Distances reset to the ' + (state.meta.region || 'park') + ' reference point.', 'ok');
  }

  /* Used by the "Report a stray" form: click the map to drop the pin. */
  function placePickMarker(lat, lng) {
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
    const hint = $('#report-pick-hint');
    if (hint) hint.textContent = 'Pinned at ' + lat.toFixed(5) + ', ' + lng.toFixed(5) + '.';
    const modal = $('#report-modal');
    if (modal) modal.classList.remove('fta-picking');
    switchMobileView('map');
    toast('Location pinned on the map.', 'ok');
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
      actor: state.profile.name || 'You', note: note, place: animal.location.label,
      at: at, source: 'user'
    });

    if (kind === 'feed') { animal.lastFedAt = at; animal.feedCount += 1; }
    if (kind === 'water') { animal.lastWateredAt = at; animal.waterCount += 1; }
    if (kind === 'medicine') animal.health = 'treatment';

    if (!writeOverlay() && !state.saveWarningShown) {
      state.saveWarningShown = true;
      toast('Private storage is blocked, so this action lasts for this visit only.', 'error');
    }
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
      actor: state.profile.name || 'You', note: 'checked ' + station.name + ' and topped the container up',
      place: station.ref, at: at, source: 'user'
    });
    writeOverlay();
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
  function switchMobileView(view) {
    state.mobileView = view;
    const sidebar = $('#sidebar-pane');
    const label = $('#mobile-view-toggle-label');
    const narrow = isNarrow();
    if (sidebar) {
      if (narrow && view === 'map') {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
      } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
      }
    }
    if (label) label.textContent = (narrow && view === 'map') ? 'List' : 'Map';
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
    if (hint) hint.textContent = 'Tip: press “Pick on map”, then click the exact spot where you saw the animal.';
    const error = $('#report-error');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }

    const center = state.map ? state.map.getCenter() : (state.meta.center || { lat: 0, lng: 0 });
    const latInput = $('#report-lat');
    const lngInput = $('#report-lng');
    if (latInput) latInput.value = Number(center.lat).toFixed(6);
    if (lngInput) lngInput.value = Number(center.lng).toFixed(6);

    const reporter = $('#report-reporter');
    if (reporter && state.profile.name && state.profile.name !== 'Guest volunteer') reporter.value = state.profile.name;

    openModal('report-modal');
  }

  function submitReport(event) {
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
      fail('Please pick the location first - “Pick on map”, “Use my location”, or “Use park center”.');
      return;
    }
    const photo = value('report-photo');
    if (photo && !/^https?:\/\//i.test(photo)) {
      fail('Photo must be a full http(s) image URL.');
      return;
    }

    const now = Date.now();
    const reporter = value('report-reporter');
    const station = nearestStation(lat, lng);
    const place = value('report-place') || 'Community report pin';

    const animal = {
      id: 'report-' + now.toString(36),
      name: value('report-name') || 'Unnamed stray',
      species: species,
      breed: value('report-breed') || speciesInfo(species).singular + ' (breed unknown)',
      sex: value('report-sex') || 'unknown',
      ageClass: value('report-age') || 'unknown',
      color: value('report-color') || 'Not recorded',
      description: value('report-description') || 'Newly reported by a community volunteer.',
      temperament: 'unknown',
      health: value('report-health') || 'healthy',
      sterilized: value('report-sterilized') === 'yes',
      vaccinated: false,
      microchipped: false,
      caretakers: [reporter || state.profile.name || 'Guest volunteer'],
      tags: ['community-report'],
      notes: value('report-notes') || 'Watch this spot for a few days and log what you see.',
      photoUrl: photo || null,
      stationId: station ? station.id : null,
      location: { label: place, area: station ? station.area : 'Reported area', lat: lat, lng: lng },
      reportedAt: new Date(now).toISOString(),
      lastFedAt: new Date(now - levelMinutes(species, 'food', value('report-food') || 'ok') * 60000).toISOString(),
      lastWateredAt: new Date(now - levelMinutes(species, 'water', value('report-water') || 'ok') * 60000).toISOString(),
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

    state.filter = 'all';
    state.query = '';
    const search = $('#sidebar-search');
    if (search) search.value = '';
    afterMutation('Report saved - ' + animal.name + ' is now on the map.', 'ok');
    switchMobileView('map');
    revealAnimal(animal.id);
  }
  /* ========================== details drawer ========================= */
  function detailRow(label, value) {
    return '<div class="flex items-start justify-between gap-3 py-1.5 border-b border-surface-container-high/70">' +
      '<span class="font-label-sm text-xs text-on-surface-variant">' + esc(label) + '</span>' +
      '<span class="font-label-sm text-xs text-on-surface font-semibold text-right">' + esc(value) + '</span>' +
      '</div>';
  }

  function openDetails(id) {
    const animal = animalById(id);
    if (!animal) return;
    const row = { animal: animal, status: statusOf(animal) };
    const issue = primaryIssue(row);
    const station = stationById(animal.stationId);
    const history = historyFor(animal.id).slice(0, 6);
    const yesNo = (value) => (value ? 'Yes' : 'No');
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

    const directions = 'https://www.google.com/maps/dir/?api=1&destination=' + animal.location.lat + ',' + animal.location.lng;

    host.innerHTML =
      '<div class="flex items-start gap-3">' +
        '<div class="w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm">' + avatarHtml(animal) + '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-start justify-between gap-2">' +
            '<div class="min-w-0">' +
              '<h3 class="font-headline-md text-headline-md text-on-surface">' + esc(animal.name) + '</h3>' +
              '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(animal.breed) + ' • ' + esc(animal.color) + '</p>' +
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
        detailRow('Sex / age', (animal.sex || 'unknown') + ' • ' + (animal.ageClass || 'unknown')) +
        detailRow('Temperament', animal.temperament) +
        detailRow('Health', animal.health) +
        detailRow('Neutered', yesNo(animal.sterilized)) +
        detailRow('Vaccinated', yesNo(animal.vaccinated)) +
        detailRow('Microchipped', yesNo(animal.microchipped)) +
        detailRow('First reported', relativeTime(animal.reportedAt) + ' (' + clockTime(animal.reportedAt) + ')') +
        detailRow('Logged feeds', String(animal.feedCount)) +
        detailRow('Logged water refills', String(animal.waterCount)) +
        detailRow('Caretakers', animal.caretakers.length ? animal.caretakers.join(', ') : 'None recorded') +
        detailRow('Feeding station', station ? station.name : 'Not assigned') +
        (animal.source === 'report' ? detailRow('Source', 'Community report from this device') : '') +
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

      '<div class="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-surface-container-high">' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[18px]">restaurant</span>I fed ' + esc(animal.name) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-tertiary text-on-tertiary font-label-md text-label-md flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[18px]">water_drop</span>Gave water</button>' +
        '<button type="button" data-action="medicine" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">medical_services</span>Vet visit</button>' +
        '<button type="button" data-action="locate" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">my_location</span>Show on map</button>' +
        '<a href="' + esc(directions) + '" target="_blank" rel="noopener" class="h-10 px-4 rounded-full border border-surface-container-highest text-on-surface font-label-md text-label-md flex items-center gap-1.5 hover:bg-surface-container transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">directions</span>Directions</a>' +
      '</div>';

    openModal('details-modal');
    setSelected(animal.id, false);
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
    const parkCenter = $('#park-center-btn');
    if (parkCenter) parkCenter.addEventListener('click', useParkCenter);
    const resetButton = $('#reset-demo-btn');
    if (resetButton) resetButton.addEventListener('click', resetDemo);
    const zoomIn = $('#zoom-in');
    if (zoomIn) zoomIn.addEventListener('click', () => state.map && state.map.zoomIn());
    const zoomOut = $('#zoom-out');
    if (zoomOut) zoomOut.addEventListener('click', () => state.map && state.map.zoomOut());
    const layerButton = $('#layer-btn');
    if (layerButton) layerButton.addEventListener('click', cycleBaseLayer);
    const centerButton = $('#center-btn');
    if (centerButton) {
      centerButton.addEventListener('click', () => {
        if (!state.map) return;
        const center = state.meta.center || { lat: 0, lng: 0 };
        state.map.flyTo([center.lat, center.lng], state.meta.defaultZoom || 15, { duration: 0.7 });
        toast('Centered on ' + (state.meta.region || 'Oakwood Park'), 'info');
      });
    }

    const mobileToggle = $('#mobile-view-toggle');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => switchMobileView(state.mobileView === 'map' ? 'list' : 'map'));
    }

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

    const useParkCenterButton = $('#report-use-center');
    if (useParkCenterButton) {
      useParkCenterButton.addEventListener('click', () => {
        const center = state.meta.center || { lat: 0, lng: 0 };
        placePickMarker(center.lat, center.lng);
        const modal = $('#report-modal');
        if (modal) modal.classList.remove('fta-picking');
      });
    }

    const useMyLocationButton = $('#report-use-location');
    if (useMyLocationButton) {
      useMyLocationButton.addEventListener('click', () => {
        if (!navigator.geolocation) {
          toast('Geolocation is unavailable in this browser.', 'error');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            placePickMarker(position.coords.latitude, position.coords.longitude);
            const modal = $('#report-modal');
            if (modal) modal.classList.remove('fta-picking');
          },
          () => toast('Could not read your location.', 'error'),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
    }

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
  /* ============================== bootstrap ========================== */
  async function boot() {
    const overlay = readOverlay();

    try {
      const loaded = await loadDataset();
      hydrate(loaded.payload, overlay, loaded.sourceLabel);
    } catch (err) {
      console.error('[FeedAnAnimalMap] dataset failed to load', err);
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
    switchMobileView('list');
    wireEvents();
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
      layerSubdomains: layerSubdomains,
      setPolicy: (policy) => {
        POLICY = Object.assign({ default: { food: { okHours: 8, urgentHours: 14 }, water: { okHours: 6, urgentHours: 10 } } }, policy || {});
      }
    };
  }
}());

