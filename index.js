/*!
 * StrayFeedingMap - application logic
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

  /* i18n for dynamic JS strings. t() reads the live dictionary at call time
     (so it follows language switches), falls back to English, and keeps the
     English literal when i18n.js has not loaded yet - important for Node
     selftests which load index.js without the browser scripts. */
  const EN_FALLBACK = {
    'card.needs_attention': 'Needs attention',
    'card.doing_fine': 'Doing fine',
    'card.community_report': 'Community report',
    'card.view_location': 'View location',
    'card.food': 'Food',
    'card.water': 'Water',
    'card.good': 'Good',
    'card.needs': 'Needs',
    'card.urgent': 'Urgent',
    'card.no_station': 'No station',
    'card.feeds': 'feeds',
    'card.by_you': 'by you',
    'card.directions': 'Directions',
    'card.i_fed': 'I fed',
    'card.i_watered': 'I watered',
    'card.edit': 'Edit',
    'card.edit_report': 'Edit your report',
    'card.more_details': 'More details',
    'card.message_caretaker': 'Message caretaker',
    'card.message_who': 'Message whoever posted or cared for {name}',
    'card.view_photo': 'View a big photo of {name}',
    'card.walk_to': 'Walking directions to this animal',
    'card.open_maps': 'Open this location in Google Maps',
    'card.dropped_pin': 'Dropped pin near {city}',
    'card.report_pin': 'Community report pin',
    'card.community_notes': 'Reported by the community - log what you see here.',
    'card.unnamed': 'Unnamed stray',
    'card.reported_volunteer': 'Reported by a community volunteer.',
    'card.newly_reported': 'Newly reported by a community volunteer.',
    'card.reported_area': 'Reported area',
    'card.away': 'away',
    'card.close': 'Close',
    'card.close_details': 'Close details',
    'card.show_on_map': 'Show {name} on the map',
    'card.no_photo_yet': 'No photo of {name} has been shared yet',
    'time.now': 'just now',
    'time.min_ago': '{n}m ago',
    'time.hour_ago': '{n}h ago',
    'time.day_ago': '{n}d ago',
    'time.month_ago': '{n}mo ago',
    'time.unknown': 'unknown',
    'status.critical': 'Critical condition • vet attention needed',
    'status.food_urgent': 'Food urgent • empty {when}',
    'status.water_urgent': 'Water urgent • empty {when}',
    'status.treatment': 'Under treatment • small portions',
    'status.food_needs': 'Needs food • empty {when}',
    'status.water_needs': 'Needs water • empty {when}',
    'status.monitoring': 'Fed {when} • monitoring',
    'status.rested': 'Rested • fed {when}',
    'status.ok': 'Doing well • fed {when}',
    'drawer.food': 'Food',
    'drawer.water': 'Water',
    'drawer.bowl_stocked': 'Bowl stocked',
    'drawer.empty_refill': 'Empty - refill needed',
    'drawer.long_empty': 'Urgent - long empty',
    'drawer.fresh': 'Fresh',
    'drawer.low_topup': 'Low - top up',
    'drawer.dry': 'Urgent - dry bowl',
    'drawer.last_fed': 'last fed {when}',
    'drawer.last_filled': 'last filled {when}',
    'drawer.sex_age': 'Sex / age',
    'drawer.temperament': 'Temperament',
    'drawer.health': 'Health',
    'drawer.neutered': 'Neutered',
    'drawer.vaccinated': 'Vaccinated',
    'drawer.microchipped': 'Microchipped',
    'drawer.yes': 'Yes',
    'drawer.first_reported': 'First reported',
    'drawer.feeds_logged': 'Feeds logged',
    'drawer.water_logged': 'Water refills logged',
    'drawer.caretakers': 'Caretakers',
    'drawer.station': 'Feeding station',
    'drawer.reported_by': 'Reported by',
    'drawer.location': 'Location',
    'drawer.open_maps_link': 'Open this location in Google Maps',
    'drawer.recent_device': 'Recent care on this device',
    'drawer.i_fed_name': 'I fed {name}',
    'drawer.gave_water': 'Gave water',
    'drawer.vet_visit': 'Vet visit',
    'drawer.show_map': 'Show on map',
    'drawer.edit_report': 'Edit report',
    'station.title': 'Community feeding station',
    'station.full': '{pct}% full',
    'station.container': 'Container level',
    'station.steward': 'Steward: {name} • serviced {when}',
  };
  const tt = (key, vars) => {
    try {
      if (typeof window !== 'undefined' && window.FTA_I18N) return window.FTA_I18N.t(key, vars);
    } catch (e) { /* fall through to English */ }
    let s = EN_FALLBACK[key] != null ? EN_FALLBACK[key] : key;
    if (vars) Object.keys(vars).forEach((k) => { s = String(s).split('{' + k + '}').join(String(vars[k])); });
    return s;
  };
  /* Display-time translation of the stored English placeholders. Reports were
     saved with English defaults ('Unnamed stray', 'Community report pin',
     'Reported by the community...'), so map them to the live language when
     rendering - the stored value stays English for dedupe/comparison. */
  const displayText = (value, key) => {
    const v = String(value == null ? '' : value);
    const en = EN_FALLBACK[key] != null ? EN_FALLBACK[key] : key;
    if (v === en) return tt(key);
    /* Stored "Dropped pin near X" labels: keep the city, translate the wrapper. */
    if (key === 'card.view_location' || key === 'card.report_pin') {
      const prefix = 'Dropped pin near ';
      if (v.indexOf(prefix) === 0) return tt('card.dropped_pin', { city: v.slice(prefix.length) });
      if (v === 'Community report pin') return tt('card.report_pin');
    }
    if (key === 'card.unnamed' && v === 'Unnamed stray') return tt('card.unnamed');
    if (key === 'card.community_notes' && /^(reported by (the )?community( volunteer)?|reported by a community volunteer - log what you see here)\.?$/i.test(v)) return tt('card.community_notes');
    return v;
  };
  const displayLabel = (label) => {
    const v = String(label == null ? '' : label);
    if (v.indexOf('Dropped pin near ') === 0) return tt('card.dropped_pin', { city: v.slice('Dropped pin near '.length) });
    if (v === 'Community report pin') return tt('card.report_pin');
    if (!v) return tt('card.view_location');
    return v;
  };

  /* Shared form-field helpers, used by BOTH report paths (the pin-first
     flow and the edit flow). Earlier each function kept a private copy,
     but the pin-first functions call them across function boundaries, so
     they must exist at module scope - otherwise the very first call throws
     ReferenceError and "Report a Stray" silently does nothing.
     value() returns '' for missing/empty fields; setValue() is a no-op
     when the node is not rendered yet. */
  const setValue = (id, v) => {
    const node = document.getElementById(id);
    if (node) node.value = v;
  };
  const value = (id) => {
    const node = document.getElementById(id);
    return node ? String(node.value || '').trim() : '';
  };

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
    if (!iso) return tt('time.unknown');
    const minutes = minutesSince(iso);
    if (!isFinite(minutes)) return tt('time.unknown');
    if (minutes < 1) return tt('time.now');
    if (minutes < 60) return tt('time.min_ago', { n: Math.round(minutes) });
    const hours = minutes / 60;
    if (hours < 24) return tt('time.hour_ago', { n: Math.round(hours) });
    const days = hours / 24;
    if (days < 30) return tt('time.day_ago', { n: Math.round(days) });
    return tt('time.month_ago', { n: Math.round(days / 30) });
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
    /* City/country travel inside location so search + Cities grouping see
       them on seeds, local reports AND cloud reports alike. */
    animal.location = animal.location || {};
    animal.location.city = animal.location.city || animal.city || '';
    animal.location.country = animal.location.country || animal.country || '';
    animal.location.citySlug = animal.location.citySlug || animal.city_slug || animal.citySlug || '';
    /* Report ownership survives reloads + cloud round trips: reporterId is the
       Supabase auth id (anonymous included), mine marks pins made on this
       device so they stay editable before auth answers. */
    animal.reporterId = animal.reporterId || animal.reporter_id || null;
    animal.reporterName = animal.reporterName || null;
    animal.mine = !!animal.mine;
    /* The auto landmark used to name the demo park ("Dropped pin near Oakwood
       Park") or a Seattle station for EVERY pin, including real GPS reports on
       the other side of the country. Rebuild such a label from the detected
       city whenever the report sits far outside the mapped area, so the card
       never points at a place the animal is not near. Idempotent: an honest
       in-park label (or a city label) passes through unchanged. */
    if (animal.source === 'report' &&
        String(animal.location.label || '').indexOf('Dropped pin near ') === 0 &&
        state.meta && state.meta.center &&
        haversine(animal.location, state.meta.center) > 20000) {
      animal.location.label = animal.location.city
        ? tt('card.dropped_pin', { city: animal.location.city })
        : tt('card.report_pin');
    }
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
    const empty = { profile: null, userLocation: null, log: [], reports: [], deletedReportIds: [] };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        profile: parsed.profile || null,
        userLocation: parsed.userLocation || null,
        log: Array.isArray(parsed.log) ? parsed.log : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        /* Tombstones: ids this device deleted (see deleteThisReport). The cloud
           row may still exist (RLS blocked, offline, policy not run yet), so
           hydrate + the boot cloud merge must skip these or the pin
           resurrects on every reload. Cleared only when the shared delete is
           confirmed... actually never auto-cleared: harmless, tiny, and the
           row id will never be reused. */
        deletedReportIds: Array.isArray(parsed.deletedReportIds) ? parsed.deletedReportIds : []
      };
    } catch (err) {
      console.warn('[StrayFeedingMap] could not read local state', err);
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
        reports: state.animals.filter((a) => a.source === 'report'),
        deletedReportIds: Array.isArray(state.deletedReportIds) ? state.deletedReportIds : []
      }));
      return true;
    } catch (err) {
      console.warn('[StrayFeedingMap] could not save local state', err);
      return false;
    }
  }
  /* ============================== app state =========================== */
  const state = {
    meta: {}, stations: [], animals: [], log: [], activity: [],
    filter: 'all', query: '', sort: 'urgent', selectedId: null,
    userLocation: null, pendingReportOpen: false, profile: { name: 'Guest volunteer' },
    /* Signed-in account id, resolved async by syncProfileFromAuth(). Report
       ownership (canManageReport) is checked against it, so it starts null:
       until auth answers, only this device's own reports look editable. */
    myId: null,
    layers: [], baseLayerIndex: 0, baseLayer: null,
    map: null, markerLayer: null, markers: {}, userMarker: null, accuracyCircle: null, pickMarker: null,
    pickMode: false, mobileView: 'map', tickerIndex: 0, tickerHidden: false, cloudWarned: false,
    dataSource: '', saveWarningShown: false,
    /* Ids this device deleted (tombstones from deleteThisReport, persisted via
       the overlay). hydrate() + the boot cloud merge skip them so a cloud row
       that survived deletion can't resurrect the pin on reload. */
    deletedReportIds: [],
    /* Phase 5 chat. conversationId + peer identify the open thread; seenIds
       dedupes realtime echoes of our own sends (we render the row we get
       back from the insert, and realtime then delivers the same row again).
       channel is the realtime subscription and MUST be released on close or
       it keeps delivering into a detached node. */
    chat: { conversationId: null, peer: null, peerName: '', peerReadAt: null, peerOnline: false, blocked: false, channel: null, seenIds: {}, rows: [], animalName: '', myId: null, readTimer: null, presenceTimer: null }
  };

  async function loadDataset() {
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return { payload: await response.json(), sourceLabel: DATA_URL };
    } catch (err) {
      if (window.FEED_THE_ANIMALS_DATA) {
        console.warn('[StrayFeedingMap] fetch failed, using the embedded snapshot: ' + err.message);
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
    /* Tombstones first: a report deleted on this device must never come back
       from the saved local copy, even if the cloud row survived deletion. */
    state.deletedReportIds = Array.isArray(overlay.deletedReportIds) ? overlay.deletedReportIds.slice() : [];
    const gone = new Set(state.deletedReportIds);
    overlay.reports.map((raw) => normalizeAnimal(raw, 'report')).forEach((a) => {
      if (!gone.has(a.id)) merged.set(a.id, a);
    });
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

  /* Report ownership: only the volunteer who posted a stray may edit or
     delete it. Signed-in AND anonymous ids both count - sbEnsureAuth()
     gives every browser a stable id, and sbSubmitReport() stores it as
     reporter_id. `mine` covers pins made on this device before auth answers
     (or while offline), and seed animals are never manageable. */
  function isCloudReportId(id) {
    return /^report-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function canManageReport(animal) {
    if (!animal || animal.source !== 'report') return false;
    if (animal.mine) return true;
    if (animal.reporterId && state.myId && animal.reporterId === state.myId) return true;
    return false;
  }

  function matchesQuery(animal, query) {
    if (!query) return true;
    const loc = animal.location || {};
    const haystack = [
      animal.name, animal.color, animal.description, animal.notes,
      animal.temperament, animal.health, loc.area, loc.label,
      loc.city, loc.country,
      animal.caretakers.join(' '), animal.tags.join(' ')
    ].join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  /* ------------------- city/country auto-detect -------------------- */
  /* Reverse-geocodes a report pin to city + country so volunteers never
     type it (typos/duplicates would kill the Cities grouping). BigDataCloud
     free client endpoint: no key, CORS-enabled, built for browser calls.
     Cached in localStorage (rounded ~1km grid) so repeat pins in the same
     neighbourhood cost zero network. Never blocks the report: on failure
     the caller keeps city/country empty and submits anyway. */
  const GEO_CACHE_KEY = 'fta.geo.v1';

  function geoGridKey(lat, lng) {
    return Number(lat).toFixed(2) + ',' + Number(lng).toFixed(2);
  }

  function readGeoCache() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(GEO_CACHE_KEY) : null;
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeGeoCache(cache) {
    try {
      if (typeof localStorage === 'undefined') return;
      const keys = Object.keys(cache);
      /* Cap the cache so one world-travelling browser cannot grow it forever. */
      while (keys.length > 500) delete cache[keys.shift()];
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* storage full - lookups just run again next time */ }
  }

  function slugifyCity(city, country) {
    const slug = String(city || '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!slug) return '';
    const cc = String(country || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
    return cc ? slug + '-' + cc : slug;
  }

  async function reverseGeocode(lat, lng) {
    const out = { city: '', country: '', citySlug: '' };
    if (!isFinite(lat) || !isFinite(lng)) return out;
    const key = geoGridKey(lat, lng);
    const cache = readGeoCache();
    if (cache[key]) return cache[key];
    /* Skip private/reserved ranges fast - geocoders return junk for them. */
    if (lat === 0 && lng === 0) return out;
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='
        + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lng)
        + '&localityLanguage=en';
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 6000) : null;
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return out;
      const data = await res.json();
      const city = data.city || data.locality || data.principalSubdivision || '';
      const country = data.countryName || data.countryCode || '';
      out.city = String(city || '').slice(0, 80);
      out.country = String(country || '').slice(0, 80);
      out.citySlug = slugifyCity(out.city, data.countryCode || out.country);
      cache[key] = out;
      writeGeoCache(cache);
    } catch (e) { /* offline/timeout/blocked - report still submits without city */ }
    return out;
  }

  /* Shows the detected city under the pin hint (read-only text, not an
     input) and stashes it in the hidden fields the submit reads. */
  function paintGeoLine(geo, state) {
    const line = $('#report-geo');
    if (!line) return;
    if (state === 'loading') {
      line.textContent = 'Detecting city…';
      line.classList.remove('hidden');
    } else if (state === 'done' && geo && (geo.city || geo.country)) {
      line.textContent = '📍 ' + [geo.city, geo.country].filter(Boolean).join(', ');
      line.classList.remove('hidden');
    } else {
      line.textContent = '';
      line.classList.add('hidden');
    }
  }

  /* Fills hidden report-city/report-country from the current pin. Called
     from placePickMarker (auto) and right before submit (safety net, in
     case the pin was set before the lookup finished). Awaits at most ~6s
     thanks to the abort above; usually instant from cache. */
  async function fillReportGeo(lat, lng) {
    const cityInput = $('#report-city');
    const countryInput = $('#report-country');
    paintGeoLine(null, 'loading');
    const geo = await reverseGeocode(lat, lng);
    if (cityInput && !cityInput.value.trim() && geo.city) cityInput.value = geo.city;
    if (countryInput && !countryInput.value.trim() && geo.country) countryInput.value = geo.country;
    /* Re-read: a re-pin keeps the old city while looking up the new one,
       so show what is actually stored, not the stale lookup. */
    paintGeoLine({
      city: cityInput ? cityInput.value.trim() : geo.city,
      country: countryInput ? countryInput.value.trim() : geo.country
    }, 'done');
    return {
      city: cityInput ? cityInput.value.trim() : '',
      country: countryInput ? countryInput.value.trim() : '',
      citySlug: slugifyCity(
        cityInput ? cityInput.value.trim() : '',
        countryInput ? countryInput.value.trim() : ''
      ) || geo.citySlug
    };
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
    const listed = (state.meta.speciesCatalog || [])
      .map((s) => ({ id: s.id, label: s.label, emoji: s.emoji, count: counts.get(s.id) || 0, singular: s.singular }))
      .filter((s) => s.count > 0);
    /* Species the report form creates that the demo catalog never had
       (e.g. a report saved as 'other'): count them too, or their pins only
       ever show up under All / Needs Help and cannot be filtered. */
    const known = new Set(listed.map((s) => s.id));
    counts.forEach((count, id) => {
      if (count > 0 && !known.has(id)) {
        const info = speciesInfo(id);
        listed.push({
          id: id,
          label: info.label.charAt(0).toUpperCase() + info.label.slice(1),
          emoji: info.emoji,
          count: count,
          singular: info.singular
        });
      }
    });
    return listed;
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
    if (health === 'critical') return { icon: 'emergency', tone: 'error', text: tt('status.critical') };
    if (food === 'urgent') return { icon: 'restaurant', tone: 'error', text: tt('status.food_urgent', { when: relativeTime(animal.lastFedAt) }) };
    if (water === 'urgent') return { icon: 'water_drop', tone: 'error', text: tt('status.water_urgent', { when: relativeTime(animal.lastWateredAt) }) };
    if (health === 'treatment') return { icon: 'medical_services', tone: 'tertiary', text: tt('status.treatment') };
    if (food === 'needs') return { icon: 'restaurant', tone: 'error', text: tt('status.food_needs', { when: relativeTime(animal.lastFedAt) }) };
    if (water === 'needs') return { icon: 'water_drop', tone: 'tertiary', text: tt('status.water_needs', { when: relativeTime(animal.lastWateredAt) }) };
    if (health === 'monitor') return { icon: 'visibility', tone: 'tertiary', text: tt('status.monitoring', { when: relativeTime(animal.lastFedAt) }) };
    if (food === 'ok' && water === 'ok' && !isUnknown(animal.lastWateredAt) && !isUnknown(animal.lastFedAt)) return { icon: 'check_circle', tone: 'secondary', text: tt('status.rested', { when: relativeTime(animal.lastFedAt) }) };
    return { icon: 'check_circle', tone: 'secondary', text: tt('status.ok', { when: relativeTime(animal.lastFedAt) }) };
  }


  /* The most useful one-tap action for this animal. */
  function primaryAction(row) {
    if (row.status.food !== 'ok') return { kind: 'feed', icon: 'restaurant', label: tt('drawer.i_fed_name', { name: row.animal.name }), style: 'primary' };
    if (row.status.water !== 'ok') return { kind: 'water', icon: 'water_drop', label: tt('drawer.gave_water'), style: 'tertiary' };
    return { kind: 'feed', icon: 'restaurant', label: tt('card.i_fed'), style: 'soft' };
  }

  const secondaryAction = (row) => (row.status.water !== 'ok'
    ? { kind: 'water', icon: 'water_drop', title: tt('drawer.gave_water') }
    : { kind: 'feed', icon: 'restaurant', title: tt('card.i_fed') });

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
      return '<img alt="' + esc(animal.name + ' the ' + speciesInfo(animal.species).singular) + '" class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" src="' + esc(animal.photoUrl) + '">';
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

    /* Split card behaviour: the PHOTO opens the lightbox, the REST of the
       card flies the map to the animal. Both are "show me the animal", just
       different halves   picture vs location. The thumb is a real <button>
       (data-action="photo") so it answers before the card handler, and it
       is layered BEFORE badgeDot so the status dot always stays on top.
       Without a photo the thumb is a plain div: the emoji fallback has
       nothing to enlarge, so it falls through to the map. */
    const cardTitle = tt('card.show_on_map', { name: animal.name });
    const photoTitle = animal.photoUrl
      ? tt('card.view_photo', { name: animal.name })
      : tt('card.no_photo_yet', { name: animal.name });
    const thumbZoom = animal.photoUrl
      ? '<span class="absolute inset-0 flex items-end justify-center pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent pointer-events-none" aria-hidden="true">' +
          '<span class="material-symbols-outlined text-[16px] text-white drop-shadow-sm">zoom_in</span></span>'
      : '';
    const thumbInner = avatarHtml(animal) + thumbZoom + badgeDot(row);
    const thumbBox = animal.photoUrl
      ? '<button type="button" data-action="photo" data-id="' + esc(animal.id) + '" title="' + photoTitle + '" aria-label="' + photoTitle + '" class="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm cursor-zoom-in">' + thumbInner + '</button>'
      : '<div class="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm">' + thumbInner + '</div>';

    return '<article data-animal-card="' + esc(animal.id) + '" tabindex="0" role="button" aria-label="' + esc(cardTitle) + '" title="' + esc(cardTitle) + '" class="fta-card p-3.5 rounded-lg bg-surface-container-lowest border ' + border + ' shadow-sm hover:shadow-md transition-all flex flex-col gap-3 group cursor-pointer">' +
      '<div class="flex gap-3 items-center">' +
        thumbBox +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center justify-between gap-1">' +
            '<div class="flex items-center gap-1.5 truncate">' +
              '<h3 class="font-headline-sm text-base text-on-surface font-semibold truncate">' + esc(displayText(animal.name, 'card.unnamed')) + '</h3>' +
            '</div>' +
            '<span class="font-label-sm text-xs text-outline shrink-0 flex items-center gap-0.5">' +
              '<span class="material-symbols-outlined text-[13px]">near_me</span> ' + formatDistance(row.status.distance) +
            '</span>' +
          '</div>' +
          '<p class="font-body-sm text-xs ' + TONE_TEXT[issue.tone] + ' font-medium flex items-center gap-1 mt-0.5">' +
            '<span class="material-symbols-outlined text-[14px]">' + issue.icon + '</span> ' + esc(issue.text) +
          '</p>' +
          '<p class="font-body-sm text-xs text-on-surface-variant truncate mt-0.5 opacity-80">' + esc(animal.description) + '</p>' +
          (function () {
            /* City/country line: the "where" for a worldwide map. New reports
               carry a real city; seed animals only have an area label, so the
               line degrades gracefully: City, Country → label → nothing (the
               line is skipped, not rendered empty). */
            const loc = animal.location || {};
            const place = [loc.city, loc.country].filter(Boolean).join(', ') || loc.label || loc.area || '';
            if (!place) return '';
            return '<p class="font-label-sm text-[11px] text-outline truncate mt-0.5 flex items-center gap-1">' +
              '<span class="material-symbols-outlined text-[12px]">location_on</span>' + esc(place) + '</p>';
          })() +
          (station ? '<p class="font-label-sm text-[11px] text-outline truncate mt-0.5 flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[12px]">roofing</span>' + esc(station.name) + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2 pt-2 border-t border-surface-container-high/60">' +
        '<button type="button" data-action="' + action.kind + '" data-id="' + esc(animal.id) + '" class="flex-1 h-9 rounded-full ' + ACTION_STYLES[action.style] + ' font-label-sm text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[16px]">' + action.icon + '</span><span>' + esc(action.label) + '</span>' +
        '</button>' +
        /* Chat sits next to the primary action because "who looked after this
           last?" is the next question after "is it fed?", and the answer is
           only reachable from the details drawer otherwise - two taps and a
           scroll for what is a one-tap conversation.

           The button is always rendered rather than conditionally: whether a
           caretaker EXISTS is a per-animal database question (only volunteers
           with a real account leave an actor_id), and answering it for all 48
           cards up front would mean 48 queries on every render. openChat()
           already handles every outcome in plain language - nobody has signed
           in yet, sign in first, or it is your own log - so a click is never
           a dead end. */
        '<button type="button" data-action="message" data-id="' + esc(animal.id) + '" title="' + esc(tt('card.message_who', { name: animal.name })) + '" aria-label="' + esc(tt('card.message_who', { name: animal.name })) + '" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">chat</span>' +
        '</button>' +
        '<button type="button" data-action="' + secondary.kind + '" data-id="' + esc(animal.id) + '" title="' + esc(secondary.title) + '" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">' + secondary.icon + '</span>' +
        '</button>' +
        '<button type="button" data-action="locate" data-id="' + esc(animal.id) + '" title="' + esc(tt('drawer.show_map')) + '" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">navigation</span>' +
        '</button>' +
        '<button type="button" data-action="details" data-id="' + esc(animal.id) + '" title="' + esc(tt('card.more_details')) + '" aria-label="' + esc(tt('card.more_details')) + ' ' + esc(animal.name) + '" class="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">' +
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
            ? tt('feed.empty_none')
            : tt('feed.empty_filter');
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
    const station = stationById(animal.stationId);
    const directions = 'https://www.google.com/maps/dir/?api=1&destination=' + animal.location.lat + ',' + animal.location.lng;
    const mapsSearch = 'https://www.google.com/maps/search/?api=1&query=' + animal.location.lat + ',' + animal.location.lng;
    const myCare = historyFor(animal.id).length;
    const foodWidth = row.status.food === 'ok' ? 100 : row.status.food === 'needs' ? 40 : 15;
    const waterWidth = row.status.water === 'ok' ? 100 : row.status.water === 'needs' ? 40 : 15;
    const facts = animal.source === 'report'
      ? [tt('card.community_report'), speciesInfo(animal.species).singular].join(' · ')
      : [animal.sex, animal.ageClass].filter((part) => !isUnknown(part)).join(' · ');
    const note = String(animal.notes || '').trim();
    const hideNote = !note || /^(reported by (the )?community( volunteer)?|reported by a community volunteer - log what you see here)\.?$/i.test(note);
    const foodLabel = row.status.food === 'ok' ? tt('card.good') : row.status.food === 'needs' ? tt('card.needs') : tt('card.urgent');
    const waterLabel = row.status.water === 'ok' ? tt('card.good') : row.status.water === 'needs' ? tt('card.needs') : tt('card.urgent');

    return '<div class="fta-popup__card">' +
      '<div class="fta-popup__head">' +
        '<span class="fta-popup__dot ' + (row.status.needsHelp ? 'is-alert' : 'is-ok') + '"></span>' +
        '<span class="fta-popup__kicker">' + esc(row.status.needsHelp ? tt('card.needs_attention') : tt('card.doing_fine')) + '</span>' +
        '<span class="fta-popup__distance">' + esc(formatDistance(row.status.distance)) + '</span>' +
      '</div>' +
      '<div class="fta-popup__body">' +
        (animal.photoUrl
          ? '<button type="button" class="fta-popup__thumb" data-action="photo" data-id="' + esc(animal.id) + '" title="' + esc(tt('card.view_photo', { name: animal.name })) + '" aria-label="' + esc(tt('card.view_photo', { name: animal.name })) + '">' + avatarHtml(animal) + '</button>'
          : '<div class="fta-popup__thumb">' + avatarHtml(animal) + '</div>') +
        '<div class="fta-popup__id">' +
          '<h4>' + esc(animal.name) + '</h4>' +
          (facts ? '<p>' + esc(facts) + '</p>' : '') +
          '<p class="fta-popup__place"><span class="material-symbols-outlined">pin_drop</span><span class="truncate">' +
            '<a href="' + esc(mapsSearch) + '" target="_blank" rel="noopener" title="' + esc(tt('card.open_maps')) + '">' +
              esc(displayLabel(animal.location.label)) + '</a></span></p>' +
        '</div>' +
      '</div>' +
      '<div class="fta-popup__meters">' +
        '<div class="fta-popup__need"><div class="fta-popup__meter"><span>' + esc(tt('card.food')) + '</span><span>' + esc(foodLabel) +
          '</span></div><div class="fta-popup__time">' + esc(relativeTime(animal.lastFedAt)) +
          '</div><div class="fta-bar"><i class="' + (row.status.food === 'ok' ? 'is-ok' : 'is-alert') +
          '" style="width:' + foodWidth + '%"></i></div></div>' +
        '<div class="fta-popup__need"><div class="fta-popup__meter"><span>' + esc(tt('card.water')) + '</span><span>' + esc(waterLabel) +
          '</span></div><div class="fta-popup__time">' + esc(relativeTime(animal.lastWateredAt)) +
          '</div><div class="fta-bar"><i class="' + (row.status.water === 'ok' ? 'is-ok' : 'is-water') +
          '" style="width:' + waterWidth + '%"></i></div></div>' +
      '</div>' +
      (hideNote ? '' : '<p class="fta-popup__notes">' + esc(displayText(note, 'card.community_notes')) + '</p>') +
      '<p class="fta-popup__meta">' + esc(station ? station.name : tt('card.no_station')) + ' · ' + animal.feedCount +
        ' ' + esc(tt('card.feeds')) + (myCare ? ' · ' + myCare + ' ' + esc(tt('card.by_you')) : '') + '</p>' +
      /* Directions gets its OWN full-width row above the care actions. "Walk to
         this animal" is the reason someone opened the popup, so it should not
         compete with Feed/Water for horizontal space on one row.

         The white is set inline as well as in CSS on purpose. This markup is
         built in JS, and _headers lets the browser cache index.js for an hour
         while index.html revalidates - so a user could get the new markup with
         the previous stylesheet and see a blue button with unreadable text. An
         inline colour ships with the markup, so the two can never disagree. */
      '<a class="fta-btn fta-btn--go is-block" style="color:#ffffff" target="_blank" rel="noopener" ' +
        'href="' + esc(directions) + '" title="' + esc(tt('card.walk_to')) + '">' +
        '<span class="material-symbols-outlined" style="color:#ffffff">directions</span>' + esc(tt('card.directions')) + '</a>' +
      '<div class="fta-popup__actions fta-popup__care">' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--primary">' +
          '<span class="material-symbols-outlined">restaurant</span>' + esc(tt('card.i_fed')) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--water">' +
          '<span class="material-symbols-outlined">water_drop</span>' + esc(tt('card.i_watered')) + '</button>' +
      '</div>' +
      '<div class="fta-popup__secondary">' +
        (canManageReport(animal)
          ? '<button type="button" data-action="edit" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--ghost" title="' + esc(tt('card.edit_report')) + '">' +
            '<span class="material-symbols-outlined">edit</span>' + esc(tt('card.edit')) + '</button>'
          : '') +
        '<button type="button" data-action="details" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--ghost" title="' + esc(tt('card.more_details')) + '">' +
          '<span class="material-symbols-outlined">info</span>' + esc(tt('card.more_details')) + '</button>' +
        /* Chat mirrors the sidebar card: "is it fed?" is immediately followed
           by "who is looking after it?", and the pin you just clicked IS the
           animal you are looking at - so the thread is one tap away instead of
           two (drawer) plus a scroll. openChat() resolves the poster/caretaker
           and explains every dead end, so the icon is never a trap. */
        '<button type="button" data-action="message" data-id="' + esc(animal.id) + '" class="fta-btn fta-btn--ghost" title="' + esc(tt('card.message_who', { name: animal.name })) + '" aria-label="' + esc(tt('card.message_who', { name: animal.name })) + '">' +
          '<span class="material-symbols-outlined">chat</span>' + esc(tt('card.message_caretaker')) + '</button>' +
      '</div>' +
    '</div>';
  }
  function stationPopupHtml(station) {
    return '<div class="fta-popup__card">' +
      '<div class="fta-popup__head"><span class="fta-popup__dot is-ok"></span>' +
        '<span class="fta-popup__kicker">' + esc(tt('station.title')) + '</span>' +
        '<span class="fta-popup__distance">' + esc(tt('station.full', { pct: station.capacityPct })) + '</span></div>' +
      '<h4 class="fta-popup__title">' + esc(station.name) + '</h4>' +
      '<p class="fta-popup__place"><span class="material-symbols-outlined">roofing</span>' + esc(station.ref) + '</p>' +
      '<p class="fta-popup__issue is-ok"><span class="material-symbols-outlined">inventory_2</span>' +
        esc(station.type) + ' • ' + esc(station.status) + '</p>' +
      '<div class="fta-popup__meter"><span>' + esc(tt('station.container')) + '</span><span>' + station.capacityPct + '%</span></div>' +
      '<div class="fta-bar"><i class="' + (station.capacityPct > 50 ? 'is-ok' : 'is-alert') + '" style="width:' + station.capacityPct + '%"></i></div>' +
      '<p class="fta-popup__notes">' + esc(station.notes) + '</p>' +
      '<p class="fta-popup__meta">' + esc(tt('station.steward', { name: station.caretaker, when: relativeTime(station.lastServicedAt) })) + '</p>' +
      /* Station popups get the same prominent, worded Directions button. */
      '<a class="fta-btn fta-btn--go is-block" style="color:#ffffff" target="_blank" rel="noopener" ' +
        'href="https://www.google.com/maps/dir/?api=1&destination=' + station.location.lat + ',' + station.location.lng + '">' +
        '<span class="material-symbols-outlined" style="color:#ffffff">directions</span>' + esc(tt('card.directions')) + '</a>' +
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
    /* ONE camera move, decided before the first tile loads.

       Tiles are fetched per viewport, so every extra move at boot downloads a
       full screen of pixels that the NEXT move throws away. This used to be
       setView(startZoom) -> fitToPark() -> flyTo(visitor): three screens per
       visit, two of them never seen. hydrate() has already run by now, so the
       final frame is known already - the visitor's saved position when we have
       one, otherwise the park bounds. state.fitted then stops renderMarkers()
       from framing the park a second time.

       Leaflet renders raster tiles fetched from the provider in
       meta.tileLayers; that provider's terms and attribution still apply. */
    state.map = window.L.map('map', {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: state.meta.maxZoom || 20,
      worldCopyJump: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5
    });
    const cached = state.userLocation;
    if (cached) {
      /* Returning visitor: open on their own street, not the demo park. */
      state.map.setView([cached.lat, cached.lng], 16);
    } else if (!fitToPark({ animate: false })) {
      /* No points to frame (empty dataset): fall back to the seeded start view. */
      state.map.setView([center.lat, center.lng], state.meta.startZoom || 13);
    }
    state.fitted = true;

    window.L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.map);
    /* Default to the Google Streets base map; the layers button cycles the rest. */
    const googleIndex = Math.max(0, state.layers.findIndex((entry) => entry.id === 'google-streets'));
    setBaseLayer(googleIndex);

    /* No map-click pinning: the report pin comes from GPS only, so a stray
       tap on the map can never change a location. */
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
    const options = {
      attribution: layer.attribution || '',
      maxZoom: layer.maxZoom || 20,
      minZoom: 2,
      subdomains: layerSubdomains(layer) || 'abc',
      /* Every tile is a network round trip, so don't pay for tiles the visitor
         is about to drag past: on a phone (Leaflet's own recommendation) wait
         for the pan to settle before fetching, and prefetch one ring beyond the
         screen instead of the default two. Desktop keeps streaming mid-pan so
         dragging stays smooth. */
      updateWhenIdle: isNarrow(),
      keepBuffer: isNarrow() ? 1 : 2
    };
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
    if (!clusters) console.warn('[StrayFeedingMap] leaflet.markercluster missing, falling back to a plain layer group.');

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

    /* Safety net: initMap() has already framed the opening view (the saved
       visitor position, or the park) and set state.fitted, so this normally
       does nothing. It exists so an unframed map still gets the WHOLE park. */
    if (!state.fitted) {
      state.fitted = true;
      fitToPark();
    }
  }

  /* Zoom out far enough to show every animal and station in one view.

     Returns true when it actually framed something, false when it could not -
     initMap() uses that to fall back to the seeded start view instead of
     leaving the camera with no view at all. */
  function fitToPark(options) {
    if (!state.map) return false;
    const points = [];
    state.animals.forEach((a) => points.push([a.location.lat, a.location.lng]));
    state.stations.forEach((s) => points.push([s.location.lat, s.location.lng]));
    const centre = state.meta.center || null;
    if (centre) points.push([centre.lat, centre.lng]);
    if (!points.length) return false;

    const opts = options || {};
    if (points.length === 1) {
      state.map.setView(points[0], state.meta.defaultZoom || 15);
      return true;
    }
    state.map.fitBounds(L.latLngBounds(points).pad(0.08), {
      padding: opts.padding || [40, 40],
      // No maxZoom here on purpose: this must be allowed to zoom OUT.
      animate: opts.animate !== false,
      duration: opts.duration === undefined ? 0.6 : opts.duration,
    });
    return true;
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
      title: animal.name + ' • ' + speciesInfo(animal.species).singular,
      alt: animal.name + ', ' + speciesInfo(animal.species).singular,
      riseOnHover: true,
      keyboard: true
    });
    /* Built LAZILY: popupHtml() embeds canManageReport() (the Edit button),
       and state.myId only resolves once auth answers - which is AFTER the
       markers are drawn. Binding the HTML string up front froze "no edit
       button" into every popup opened before that moment; Leaflet calls a
       Function content on every open, so ownership is re-checked each time. */
    marker.bindPopup(() => popupHtml(row), { maxWidth: 340, minWidth: 296, autoPanPadding: [28, 28], className: 'fta-popup' });
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
    /* Same pending treatment for the labelled desktop pill, so a slow fix
       never looks like a click that did nothing there either. */
    const pill = $('#center-btn');
    if (pill) {
      pill.setAttribute('aria-busy', busy ? 'true' : 'false');
      pill.classList.toggle('opacity-60', busy);
    }
    const pillIcon = $('#center-icon');
    if (pillIcon) {
      pillIcon.textContent = busy ? 'progress_activity' : 'my_location';
      pillIcon.classList.toggle('animate-spin', busy);
    }
  }

  /* ------------------------ location onboarding ---------------------- */
  const LOCATION_PROMPT_DISMISSED_KEY = 'fta.location-prompt-dismissed.v1';

  function hideLocationPrompt(dismissed) {
    const prompt = $('#location-prompt');
    if (prompt) prompt.hidden = true;
    if (dismissed) {
      try { sessionStorage.setItem(LOCATION_PROMPT_DISMISSED_KEY, '1'); } catch (e) {}
    }
  }

  function showLocationPromptError(error) {
    const prompt = $('#location-prompt');
    const errorNode = $('#location-prompt-error');
    const enableButton = $('#location-enable-btn');
    if (!prompt || !errorNode) return;

    let message;
    if (!navigator.geolocation) {
      message = 'This browser does not support location. Try a modern browser to use nearby and reporting features.';
    } else if (window.isSecureContext === false) {
      message = 'Location requires a secure connection. Open this site using HTTPS or localhost, then try again.';
    } else if (error && error.code === 1) {
      message = 'Location is blocked. Allow it in this site’s browser permissions, then try again.';
    } else if (error && error.code === 3) {
      message = 'Location is taking too long. Check your device’s location services and try again.';
    } else {
      message = 'We could not get a location fix. Check your device’s location services and try again.';
    }

    errorNode.textContent = message;
    errorNode.hidden = false;
    prompt.hidden = false;
    if (enableButton) {
      const icon = enableButton.querySelector('.material-symbols-outlined');
      enableButton.innerHTML = '';
      if (icon) enableButton.appendChild(icon);
      else {
        const retryIcon = document.createElement('span');
        retryIcon.className = 'material-symbols-outlined';
        retryIcon.setAttribute('aria-hidden', 'true');
        retryIcon.textContent = 'my_location';
        enableButton.appendChild(retryIcon);
      }
      enableButton.appendChild(document.createTextNode('Try again'));
    }
  }

  function requestReportLocation() {
    state.pendingReportOpen = true;
    const prompt = $('#location-prompt');
    const copy = $('#location-prompt-copy');
    const error = $('#location-prompt-error');
    if (copy) copy.textContent = 'Your location is required to place this report accurately. Allow location access to continue.';
    if (error) error.hidden = true;
    if (prompt) prompt.hidden = false;
  }

  function initLocationPrompt() {
    const prompt = $('#location-prompt');
    if (!prompt || state.userLocation) return;
    try {
      if (sessionStorage.getItem(LOCATION_PROMPT_DISMISSED_KEY) === '1') return;
    } catch (e) {}
    prompt.hidden = false;
  }

  /* Finds where the visitor is, drops the blue "you are here" dot, and takes
     the map to them.

     "Near Me" means "show me me": the map is global, so whatever the seeded
     demo pins are, the viewport flies to the visitor's own point at street
     level. Distances then re-measure from that point (see referencePoint()).
     The desktop "Current Location" pill and the mobile circle share this flow. */
  function locateMe() {
    if (!navigator.geolocation) {
      showLocationPromptError();
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
        hideLocationPrompt(false);
        if (state.pendingReportOpen) {
          state.pendingReportOpen = false;
          void openReportModal();
        }

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
        showLocationPromptError(error);
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

  /* The auto landmark for a pin, written into the hidden report-place field.
     The user never types it (the field is hidden), so it is always safe to
     recompute whenever the pin moves.

     It used to name the nearest demo station unconditionally - nearestStation()
     returns the CLOSEST station whatever the distance, so a real GPS fix
     hundreds of kilometres from the park got labelled with a Seattle landmark
     (or the hard-coded "Oakwood Park" fallback when no station was loaded).
     Both lied about where the animal actually is.

     Now a station only names the pin when it is genuinely next to it (within
     3 km - every demo station sits inside the park); otherwise the landmark
     comes from the reverse-geocoded city. That lookup is cached and never
     blocks pinning, and submitReport() has its own city fallback. */
  function fillPlaceLabel(lat, lng) {
    const placeInput = $('#report-place');
    if (placeInput) placeInput.value = '';
    const station = nearestStation(lat, lng);
    if (station && haversine({ lat: lat, lng: lng }, station.location) <= 3000) {
      if (placeInput) placeInput.value = 'Dropped pin near ' + station.ref;
      return;
    }
    try {
      const p = reverseGeocode(lat, lng);
      if (p && typeof p.then === 'function') {
        p.then((geo) => {
          const input = $('#report-place');
          if (input && !input.value.trim() && geo && geo.city) {
            input.value = 'Dropped pin near ' + geo.city;
          }
        }).catch(() => {});
      }
    } catch (e) { /* offline - submit falls back to "Community report pin" */ }
  }

  /* Used by the "Report a stray" form: writes the GPS fix into the hidden
     lat/lng fields. The user never sees or types these numbers. */
  function placePickMarker(lat, lng, options) {
    const opts = options || {};
    state.pickMode = false;
    const latInput = $('#report-lat');
    const lngInput = $('#report-lng');
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);
    fillPlaceLabel(lat, lng);
    /* A moved pin invalidates the old city: clear it, then re-detect in the
       background so the hidden report-city/country always match THIS pin,
       not the previous one. Fire-and-forget - submit re-awaits if needed. */
    const cityInput = $('#report-city');
    const countryInput = $('#report-country');
    if (cityInput) cityInput.value = '';
    if (countryInput) countryInput.value = '';
    try {
      const p = fillReportGeo(lat, lng);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* never break pinning */ }
    drawPickMarker(lat, lng);

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
        hint.textContent = 'Location pinned - accurate to about ' + formatDistance(opts.accuracy) + '.';
      } else {
        hint.textContent = 'Location pinned.';
      }
    }
    const modal = $('#report-modal');
    if (modal) modal.classList.remove('fta-picking');
    switchMobileView('map');
    toast('Location pinned on the map.', 'ok');
  }

  /* Draws (or moves) the single report pin. NOT draggable: the location is
     GPS-only and must never be modified by dragging. */
  function drawPickMarker(lat, lng) {
    if (!state.map || !window.L) return;
    if (state.pickMarker) state.map.removeLayer(state.pickMarker);
    state.pickMarker = window.L.marker([lat, lng], {
      icon: window.L.divIcon({
        className: 'fta-pick-wrap',
        html: '<div class="fta-pick"><span class="material-symbols-outlined">add_location_alt</span></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      }),
      title: 'New report pin',
      draggable: false,
      autoPan: true,
      zIndexOffset: 600
    }).addTo(state.map);
  }

  /* Fills or refreshes the report pin from the device GPS.

     The "Use my location" button lets the volunteer refresh or fine-tune the
     report pin after the required location check has opened the form.

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
      toast('Geolocation is unavailable in this browser - reporting a location needs device GPS.', 'error');
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
          ? 'Pinned, but GPS was only accurate to about ' + formatDistance(accuracy) + '. Tap “Use my location” again for a better fix.'
          : 'Pinned at your location (accurate to about ' + formatDistance(accuracy) + ').', 'ok');
      },
      (error) => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        setLocating(false);
        const denied = error && error.code === 1;
        toast(denied
          ? 'Location permission denied - allow location access in your browser settings, then tap “Use my location” again.'
          : 'Could not read your location - check that GPS is on and tap “Use my location” again.', 'error');
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
    // Phase 4: shared feed   also POST to Supabase. Local always wins, but we
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
    // Phase 4: shared station check   also POST to Supabase
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

    /* Desktop is ALWAYS split view: the sidebar must never hide there. The
       old code stripped md:flex on map view at every width, so a delete (or
       any switchMobileView('map')) made the whole side menu vanish on desktop
       until a manual toggle brought it back. */
    const narrow = (typeof isNarrow === 'function') ? isNarrow() : true;
    if (sidebar) {
      if (onMap && narrow) {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex', 'md:flex');
      } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
        if (!sidebar.classList.contains('md:flex')) sidebar.classList.add('md:flex');
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
  function isDesktopChatWidget() {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 640px)').matches;
  }

  function setChatWidgetCollapsed(collapsed) {
    const modal = document.getElementById('chat-modal');
    const button = document.getElementById('chat-collapse');
    if (!modal || !button) return;
    modal.classList.toggle('chat-widget-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand chat' : 'Minimize chat');
    button.title = collapsed ? 'Expand chat' : 'Minimize chat';
    const icon = button.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = collapsed ? 'expand_less' : 'expand_more';
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (id === 'chat-modal') {
      const desktop = isDesktopChatWidget();
      modal.setAttribute('aria-modal', String(!desktop));
      if (desktop) setChatWidgetCollapsed(false);
      else document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'hidden';
    }
  }

  /* Releases the DM realtime subscription. Called from BOTH closeModal and
     closeAllModals, because Escape and backdrop clicks bypass closeModal -
     a channel left open would keep firing into a detached log element for
     the rest of the session and re-subscribe on top of each reopen. */
  function stopChat() {
    /* The read-cursor poll must die with the thread. Left running it would
       keep querying a conversation nobody is looking at, and the handle would
       leak one interval per thread opened. */
    if (state.chat.readTimer) {
      clearInterval(state.chat.readTimer);
      state.chat.readTimer = null;
    }
    if (state.chat.presenceTimer) {
      clearInterval(state.chat.presenceTimer);
      state.chat.presenceTimer = null;
    }
    if (state.chat.channel) {
      try {
        const client = (typeof window !== 'undefined' && window.sb) ? window.sb : null;
        if (client && client.removeChannel) client.removeChannel(state.chat.channel);
      } catch (e) { /* channel already gone */ }
      state.chat.channel = null;
    }
    state.chat.conversationId = null;
    state.chat.peer = null;
    state.chat.peerName = '';
    state.chat.peerReadAt = null;
    state.chat.peerOnline = false;
    state.chat.blocked = false;
    state.chat.seenIds = {};
    state.chat.rows = [];
    state.chat.animalName = '';
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (id === 'display-name-modal' && displayNameModalOpen) {
      saveDisplayName(displayNameFallback);
      return;
    }
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    /* The photo lightbox is usually opened FROM the details drawer, so
       closing it must not unlock page scrolling while another modal is
       still up. Only the last visible modal releases the lock. */
    document.body.style.overflow = document.querySelector('[data-modal]:not(.hidden)') ? 'hidden' : '';
    if (id === 'chat-modal') {
      stopChat();
      /* openChat hides the generic "Messages" title to make room for the
         WhatsApp peer line - put it back so the next open starts clean. */
      const titleEl = document.getElementById('chat-title');
      if (titleEl) titleEl.style.display = '';
    }
    if (id === 'report-camera-modal') stopReportCamera();
    if (id === 'report-modal') {
      state.pickMode = false;
      if (state.pickMarker && state.map) state.map.removeLayer(state.pickMarker);
      state.pickMarker = null;
    }
  }

  function closeAllModals() {
    if (displayNameModalOpen) {
      saveDisplayName(displayNameFallback);
      return;
    }
    $$('[data-modal]').forEach((modal) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    });
    document.body.style.overflow = '';
    state.pickMode = false;
    stopChat();
    stopReportCamera();
  }
  /* ====================== "report a stray" workflow =================== */
  /* Turns the volunteer's quick answer about a bowl into dataset minutes. */
  function levelMinutes(species, kind, level) {
    const rule = policyFor(species)[kind];
    if (level === 'ok') return 5;
    if (level === 'needs') return rule.okHours * 60 + 90;
    return rule.urgentHours * 60 + 120;
  }

  /* Login gate for reporting: only signed-in volunteers (real account, not
     anonymous) may open the report form. Guests get a toast explaining why
     and are sent to auth.html. A sessionStorage flag re-opens the form after
     they sign in, so they don't lose their intent. */
  async function requireLoginForReport(quiet, intent) {
    try {
      let user = null;
      if (typeof window !== 'undefined' && typeof window.sbRequireEmail === 'function') {
        try { user = await window.sbRequireEmail(); } catch (e) { user = null; }
      } else if (typeof window !== 'undefined' && window.sbAuth) {
        try { user = await window.sbAuth.currentUser(); } catch (e) { user = null; }
        if (user && user.is_anonymous) user = null;
        if (user && !user.email) user = null;
      }
      if (user) { state.myId = user.id; return true; }
    } catch (e) { /* fall through to login prompt */ }
    if (quiet) return false;
    toast('Please sign in to report a stray.', 'info');
    try { sessionStorage.setItem('fta-after-login', intent || 'open-report'); } catch (e) {}
    window.setTimeout(() => { window.location.href = 'auth.html?next=report'; }, 700);
    return false;
  }

  async function openReportModal() {
    const hasLocation = state.userLocation &&
      Number.isFinite(Number(state.userLocation.lat)) &&
      Number.isFinite(Number(state.userLocation.lng));
    if (!hasLocation) {
      requestReportLocation();
      return;
    }
    if (!(await requireLoginForReport())) return;
    if (!state.userLocation ||
        !Number.isFinite(Number(state.userLocation.lat)) ||
        !Number.isFinite(Number(state.userLocation.lng))) {
      requestReportLocation();
      return;
    }
    const form = $('#report-form');
    if (!form) return;
    form.reset();

    /* Every open starts as a FRESH report: a cancelled edit and the photo
       from a previous attempt must never leak into it. */
    editingReportId = null;
    resetReportPhoto();
    const title = $('#report-title');
    if (title) title.textContent = 'Report a stray';
    const subtitle = $('#report-subtitle');
    if (subtitle) subtitle.textContent = 'Adds a pin on the map right away. Shared with other volunteers when you’re signed in.';
    const submit = $('#report-submit');
    if (submit) submit.innerHTML = '<span class="material-symbols-outlined text-[18px]">publish</span>Save to map';

    /* Creating, not editing: no report to delete, so the owner-only Delete
       button stays hidden until openEditReport() reveals it. */
    const delNew = $('#report-delete');
    if (delNew) { delNew.classList.add('hidden'); delNew.classList.remove('inline-flex'); }

    const hint = $('#report-pick-hint');
    if (hint) hint.textContent = 'We pin your location from the device GPS - coordinates stay in the background and are never shown.';
    const error = $('#report-error');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }

    /* GPS ONLY: the pin comes from the device location, never from the map
       viewport and never from a typed field - the lat/lng inputs are hidden
       and are only ever written here. A fix we already know (from the
       opening locate) is applied instantly; otherwise ask for one. */
    const known = state.userLocation;
    const latInput = $('#report-lat');
    const lngInput = $('#report-lng');
    if (known) {
      if (latInput) latInput.value = Number(known.lat).toFixed(6);
      if (lngInput) lngInput.value = Number(known.lng).toFixed(6);
      /* Landmark + city/country for the known pin straight away; a later
         re-pin recomputes both (fillPlaceLabel / placePickMarker). */
      fillPlaceLabel(Number(known.lat), Number(known.lng));
      try {
        const p = fillReportGeo(Number(known.lat), Number(known.lng));
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* the hint already explains the pin */ }
      if (hint) hint.textContent = 'Pinned to your current location (GPS).';
    } else {
      if (latInput) latInput.value = '';
      if (lngInput) lngInput.value = '';
      if (hint) hint.textContent = 'Finding your location… allow GPS access when asked.';
      useMyLocationForReport();
    }

    /* No "your name" field any more: the log is attributed to state.profile.name,
       which the shared header already keeps in sync with the signed-in account
       (see syncProfileFromAuth). Asking twice was pure friction. */

    openModal('report-modal');
  }

  /* --------------------------- editing a report ----------------------- */
  /* Reopens the SAME form in edit mode, prefilled from the report, so a
     correction is typed with the widgets it was created with. The report
     keeps its id - minting a new one would pin the same stray twice - and
     keeps its reporter, care log and history.

     Gating lives in canManageReport(): this function only builds the form,
     the buttons that lead here never render for someone else's report. */
  async function openEditReport(id) {
    const animal = animalById(id);
    if (!animal) return;
    if (!(await requireLoginForReport(false, 'edit:' + id))) return;
    if (!canManageReport(animal)) {
      toast('Only the volunteer who reported this stray can edit or delete it.', 'error');
      return;
    }
    const form = $('#report-form');
    if (!form) return;
    form.reset();
    editingReportId = id;
    resetReportPhoto();

    const setValue = (fieldId, value) => {
      const node = document.getElementById(fieldId);
      if (node) node.value = value;
    };
    const tick = (fieldId, on) => {
      const node = document.getElementById(fieldId);
      if (node) node.checked = !!on;
    };

    /* "Unnamed stray" is the placeholder the form produces, so showing it
       back in the name box would look like a name someone chose. */
    setValue('report-name', animal.name === 'Unnamed stray' ? '' : animal.name);
    /* The select only offers Cat/Dog/Other now. An older report can still
       carry a species we no longer list (rabbit/bird/guinea-pig); assigning
       it would leave the <select> blank, and a blank submit silently
       re-saves as 'cat'. Park anything not offered on 'other' instead. */
    const offeredSpecies = ['cat', 'dog', 'other'];
    setValue('report-species', offeredSpecies.indexOf(animal.species) === -1 ? 'other' : animal.species);
    setValue('report-description', animal.description || '');
    setValue('report-lat', Number(animal.location.lat).toFixed(6));
    setValue('report-lng', Number(animal.location.lng).toFixed(6));
    setValue('report-place', animal.location.label || '');
    setValue('report-city', animal.location.city || '');
    setValue('report-country', animal.location.country || '');
    paintGeoLine({ city: animal.location.city || '', country: animal.location.country || '' }, 'done');

    /* Prefill the needs ticks from the CURRENT status - that is exactly how
       they are read back on save (a tick = "it needs this now"). So editing
       an unrelated field never silently re-urgentises a bowl that is fine. */
    const status = statusOf(animal);
    tick('report-needs-food', status.food !== 'ok');
    tick('report-needs-water', status.water !== 'ok');
    tick('report-health', animal.health === 'critical');

    const error = $('#report-error');
    if (error) { error.textContent = ''; error.classList.add('hidden'); }
    const hint = $('#report-pick-hint');
    if (hint) hint.textContent = 'Location stays as reported. Tap “Use my location” only if the animal has moved.';
    const photoHint = $('#report-photo-hint');
    if (photoHint) {
      photoHint.textContent = animal.photoUrl
        ? 'Current photo shown. Choose a new one to replace it, or Remove photo to take it off.'
        : 'Take a photo or choose one from your gallery. It is resized before upload.';
    }
    if (animal.photoUrl) setReportPhotoPreview(animal.photoUrl);

    const title = $('#report-title');
    if (title) title.textContent = 'Edit your report';
    const subtitle = $('#report-subtitle');
    if (subtitle) subtitle.textContent = 'Changes show up for every volunteer with this map open.';
    const submit = $('#report-submit');
    if (submit) submit.innerHTML = '<span class="material-symbols-outlined text-[18px]">save</span>Save changes';

    /* Editing your own report: reveal the owner-only Delete button. It stays
       hidden for everyone else because this function already returned early
       for them via canManageReport() above. */
    const delEdit = $('#report-delete');
    if (delEdit) { delEdit.classList.remove('hidden'); delEdit.classList.add('inline-flex'); }

    openModal('report-modal');
  }

  /* The report the form is currently editing, or null while it is creating a
     new one. Lives beside the pending photo it pairs with: both only mean
     something while the report modal is open, and both are cleared on save,
     on cancel (openReportModal) and on close. */
  let editingReportId = null;

  /* ------------------------- report photo picker ---------------------- */
  /* Holds the chosen File until submit. We keep the File (not a data URL)
     so it can be uploaded straight to Supabase Storage. */
  let pendingReportPhoto = null;
  let reportCameraStream = null;
  /* Set by "Remove photo" while EDITING: the save then writes photo_url =
     null instead of quietly keeping the old file - the button says Remove,
     so it has to mean it. Cleared when a new file is chosen and by
     resetReportPhoto() (every modal open, every save). */
  let reportPhotoRemoved = false;

  function setReportPhotoPreview(src) {
    const box = $('#report-photo-preview');
    const status = $('#report-photo-status');
    const action = $('#report-photo-action');
    if (!box) return;
    if (!src) {
      box.innerHTML = '<span class="material-symbols-outlined text-[28px]">add_a_photo</span>';
      if (status) status.classList.remove('has-image');
      if (action) action.textContent = 'No photo selected';
      return;
    }
    box.innerHTML = '<img alt="Selected stray photo" class="w-full h-full object-cover" src="' + esc(src) + '">';
    if (status) status.classList.add('has-image');
    if (action) action.textContent = 'Current photo';
  }

  function stopReportCamera() {
    if (reportCameraStream) {
      reportCameraStream.getTracks().forEach((track) => track.stop());
      reportCameraStream = null;
    }
    const video = $('#report-camera-video');
    if (video) video.srcObject = null;
    const capture = $('#report-camera-capture');
    if (capture) capture.disabled = true;
  }

  async function startReportCamera() {
    const error = $('#report-camera-error');
    const video = $('#report-camera-video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !video) {
      toast('Camera capture is unavailable here. Choose a photo from your gallery instead.', 'error');
      return;
    }
    if (error) {
      error.textContent = '';
      error.classList.add('hidden');
    }
    openModal('report-camera-modal');
    try {
      reportCameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 960, max: 1280 },
          height: { ideal: 720, max: 1280 },
        },
      });
      const cameraModal = $('#report-camera-modal');
      if (!cameraModal || cameraModal.classList.contains('hidden')) {
        stopReportCamera();
        return;
      }
      video.srcObject = reportCameraStream;
      await video.play();
      const capture = $('#report-camera-capture');
      if (capture) capture.disabled = false;
    } catch (err) {
      stopReportCamera();
      if (error) {
        error.textContent = err && err.name === 'NotAllowedError'
          ? 'Allow camera access in your browser settings, or choose a photo from your gallery.'
          : 'Could not start the camera. Choose a photo from your gallery instead.';
        error.classList.remove('hidden');
      }
    }
  }

  function isMobilePhotoDevice() {
    const userAgent = navigator.userAgent || '';
    const isTouchIpad = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || isTouchIpad;
  }

  function openReportCamera() {
    const cameraInput = $('#report-photo-camera-file');
    const supportsLiveCamera = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    if (isMobilePhotoDevice() && supportsLiveCamera) {
      startReportCamera();
    } else if (cameraInput) {
      cameraInput.click();
    } else {
      startReportCamera();
    }
  }

  function acceptReportPhoto(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast('Please choose an image file.', 'error');
      return false;
    }
    pendingReportPhoto = file;
    reportPhotoRemoved = false;
    /* Do not preview the original file: mobile browsers may decode a full
       camera-resolution image just to paint this small thumbnail. */
    setReportPhotoPreview(null);
    const preview = $('#report-photo-preview');
    const action = $('#report-photo-action');
    const status = $('#report-photo-status');
    const clear = $('#report-photo-clear');
    const hint = $('#report-photo-hint');
    if (preview) {
      preview.innerHTML = '<span class="material-symbols-outlined text-[24px]">image</span>';
    }
    if (status) status.classList.add('has-image');
    if (action) action.textContent = 'Photo selected';
    if (clear) clear.classList.remove('hidden');
    if (hint) {
      const mb = typeof window.sbFormatBytes === 'function' ? window.sbFormatBytes(file.size) : (file.size / 1048576).toFixed(1) + ' MB';
      hint.textContent = file.name + ' · ' + mb + '. Resized before upload.';
    }
    return true;
  }

  function captureReportPhoto() {
    const video = $('#report-camera-video');
    const capture = $('#report-camera-capture');
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast('The camera is not ready yet. Please wait a moment and try again.', 'error');
      return;
    }
    if (capture) capture.disabled = true;
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        try {
          if (!blob) throw new Error('Could not create a photo.');
          const file = new File([blob], 'stray-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
          acceptReportPhoto(file);
          stopReportCamera();
          closeModal('report-camera-modal');
        } catch (err) {
          if (capture) capture.disabled = false;
          toast('Could not capture the photo. Please try again or choose one from your gallery.', 'error');
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }, 'image/jpeg', 0.78);
    } catch (err) {
      if (capture) capture.disabled = false;
      toast('Could not capture the photo. Please try again or choose one from your gallery.', 'error');
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function wireReportPhoto() {
    const cameraInput = $('#report-photo-camera-file');
    const galleryInput = $('#report-photo-gallery-file');
    const pick = $('#report-photo-pick');
    const galleryPick = $('#report-photo-gallery-pick');
    const clear = $('#report-photo-clear');
    const hint = $('#report-photo-hint');
    if (!cameraInput && !galleryInput) return;

    if (pick) {
      pick.addEventListener('click', openReportCamera);
    }
    const capture = $('#report-camera-capture');
    if (capture) capture.addEventListener('click', captureReportPhoto);
    if (galleryPick) {
      galleryPick.addEventListener('click', () => galleryInput.click());
    }

    const onPhotoSelected = (event) => {
      const selectedInput = event.currentTarget;
      const file = selectedInput.files && selectedInput.files[0];
      if (!file) return;
      acceptReportPhoto(file);
      selectedInput.value = '';
    };
    if (cameraInput) cameraInput.addEventListener('change', onPhotoSelected);
    if (galleryInput) galleryInput.addEventListener('change', onPhotoSelected);

    if (clear) {
      clear.addEventListener('click', () => {
        pendingReportPhoto = null;
        if (cameraInput) cameraInput.value = '';
        if (galleryInput) galleryInput.value = '';
        setReportPhotoPreview(null);
        clear.classList.add('hidden');
        if (hint) hint.textContent = 'Photo is resized before upload to reduce memory use.';
        /* Edit mode: the button says "Remove photo", so removing is what it
           does - the empty preview is the truth and the save writes
           photo_url = null (reportPhotoRemoved). Picking a new file clears
           the flag again, and so does reopening the form. */
        const editing = editingReportId ? animalById(editingReportId) : null;
        if (editing && editing.photoUrl) {
          reportPhotoRemoved = true;
          if (hint) hint.textContent = 'Photo will be removed when you save.';
        }
      });
    }
  }

  function resetReportPhoto() {
    pendingReportPhoto = null;
    reportPhotoRemoved = false;
    const cameraInput = $('#report-photo-camera-file');
    if (cameraInput) cameraInput.value = '';
    const galleryInput = $('#report-photo-gallery-file');
    if (galleryInput) galleryInput.value = '';
    const clear = $('#report-photo-clear');
    if (clear) clear.classList.add('hidden');
    const hint = $('#report-photo-hint');
    if (hint) hint.textContent = 'Photo is resized before upload to reduce memory use.';
    setReportPhotoPreview(null);
  }

  async function submitReport(event) {
    event.preventDefault();
    /* Second half of the login gate: the modal can't be opened while logged
       out, but a stale open form (or console call) must not sneak through. */
    if (!(await requireLoginForReport())) return;
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
      fail('Your location has not been pinned yet - tap “Use my location” and allow GPS access.');
      return;
    }

    const now = Date.now();
    const reporter = value('report-reporter');
    const station = nearestStation(lat, lng);
    let place = value('report-place') || 'Community report pin';

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

    /* ===================== editing an existing report ================== */
    /* Same validation, same widgets, same upload path as creating one - but
       the report keeps its id, its reporter and its care history, so nothing
       pins twice and no feed log is lost. Everything below this block is the
       create path.

       The cloud row is written FIRST: if it cannot be updated (offline, or
       the ownership policies from schema-core.sql are missing) the local
       edit still lands and the volunteer is told, instead of watching the
       change silently reappear at the next load. */
    const editing = editingReportId ? animalById(editingReportId) : null;
    if (editing) {
      setBusy(true, '<span class="material-symbols-outlined text-[18px]">save</span>Saving changes…');
      /* "Remove photo" during an edit means remove: photo_url is cleared.
         A newly chosen file clears the flag too, so replace still wins. */
      let editedPhoto = reportPhotoRemoved ? null : (editing.photoUrl || null);
      try {
        if (pendingReportPhoto && typeof window.sbUploadReportPhoto === 'function') {
          editedPhoto = await window.sbUploadReportPhoto(pendingReportPhoto);
        }
      } catch (err) {
        console.warn('[StrayFeedingMap] photo upload failed', err);
        toast('Photo could not be processed safely - keeping the previous photo.', 'error');
        editedPhoto = editing.photoUrl || null;
      }
      let sharedOk = true;
      if (isCloudReportId(editing.id)) {
        if (typeof window.sbUpdateReport === 'function') {
          sharedOk = await window.sbUpdateReport({
            id: editing.id.replace(/^report-/, ''),
            name: value('report-name') || 'Unnamed stray',
            species: species,
            lat: lat,
            lng: lng,
            place: place,
            city: value('report-city') || editing.location.city || '',
            country: value('report-country') || editing.location.country || '',
            citySlug: slugifyCity(value('report-city') || editing.location.city || '', value('report-country') || editing.location.country || '') || editing.location.citySlug || '',
            photoUrl: editedPhoto,
            description: value('report-description'),
            needsFood: needsFood,
            needsWater: needsWater,
            needsVet: needsVet,
          });
        } else {
          /* The writer lives in supabase-client.js. With it missing the
             shared copy did NOT change, so the save must say so - the old
             `true` default toasted "on the map for everyone" and the next
             reload silently contradicted it. */
          sharedOk = false;
        }
      }
      setBusy(false);

      const status = statusOf(editing);
      /* The ticks are the one thing that cannot be diffed against the form:
         they are an opinion about RIGHT NOW. Recompute a timestamp only
         when its answer actually changed, so fixing a typo never wipes out
         a feed someone logged an hour ago. A tick that lands on an already
         urgent bowl keeps the ORIGINAL deadline rather than extending it. */
      const nextFed = needsFood
        ? (status.food === 'ok' ? new Date(now - levelMinutes(species, 'food', foodLevel) * 60000).toISOString() : editing.lastFedAt)
        : (status.food === 'ok' ? editing.lastFedAt : new Date(now - 5 * 60000).toISOString());
      const nextWatered = needsWater
        ? (status.water === 'ok' ? new Date(now - levelMinutes(species, 'water', waterLevel) * 60000).toISOString() : editing.lastWateredAt)
        : (status.water === 'ok' ? editing.lastWateredAt : new Date(now - 5 * 60000).toISOString());

      Object.assign(editing, {
        name: value('report-name') || 'Unnamed stray',
        species: species,
        description: value('report-description') || 'Newly reported by a community volunteer.',
        /* 'critical' when the vet tick is on; otherwise leave whatever state
           a later vet visit recorded rather than resetting it to healthy. */
        health: needsVet ? 'critical' : (editing.health === 'critical' ? 'healthy' : editing.health),
        photoUrl: editedPhoto,
        stationId: station ? station.id : null,
        location: {
          label: place,
          area: editing.location.city || (station ? station.area : 'Reported area'),
          city: value('report-city') || editing.location.city || '',
          country: value('report-country') || editing.location.country || '',
          citySlug: slugifyCity(value('report-city') || editing.location.city || '', value('report-country') || editing.location.country || '') || editing.location.citySlug || '',
          lat: lat, lng: lng
        },
        lastFedAt: nextFed,
        lastWateredAt: nextWatered,
      });

      writeOverlay();
      editingReportId = null;
      closeModal('report-modal');
      resetReportPhoto();
      afterMutation(sharedOk
        ? 'Saved - the updated report is on the map for everyone.'
        : 'Saved on this device - the shared copy could not be updated yet.', sharedOk ? 'ok' : 'error');
      /* Show the result rather than dumping the volunteer back on the map:
         the drawer they came from now carries the corrected facts. */
      openDetails(editing.id);
      return;
    }

    /* Upload the photo + share the report. Local save happens either way, so
       a network failure never loses what the volunteer typed. */
    setBusy(true, '<span class="material-symbols-outlined text-[18px]">upload</span>Uploading photo…');
    let photoUrl = null;
    let shared = false;
    /* Safety net: the pin may have been set before the background lookup
       finished (or offline). Resolve city now so the cloud row gets it. */
    let geoCity = value('report-city') || '';
    let geoCountry = value('report-country') || '';
    try {
      const geo = await fillReportGeo(lat, lng);
      geoCity = geo.city || geoCity;
      geoCountry = geo.country || geoCountry;
    } catch (e) { /* submit anyway without city */ }
    /* The auto landmark may still be empty (fresh pin whose city lookup was
       in flight, or offline). Name the city just resolved instead, so the
       card never falls back to a park the pin is nowhere near. */
    if (!value('report-place')) {
      place = geoCity ? 'Dropped pin near ' + geoCity : 'Community report pin';
    }
    const geoSlug = slugifyCity(geoCity, geoCountry);
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
          city: geoCity,
          country: geoCountry,
          citySlug: geoSlug,
          photoUrl: photoUrl,
          description: value('report-description'),
          needsVet: needsVet,
          needsFood: needsFood,
          needsWater: needsWater,
        });
      }
    } catch (err) {
      console.warn('[StrayFeedingMap] report upload failed', err);
      toast('Photo could not be processed safely. The report will be saved on this device without its photo.', 'error');
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
      /* Ownership so this stray stays editable/deletable for its poster
         across reloads and on their other screens once signed in. */
      reporterId: state.myId || null,
      mine: true,
      tags: ['community-report'],
      notes: value('report-notes') || 'Watch this spot for a few days and log what you see.',
      photoUrl: photoUrl || null,
      stationId: station ? station.id : null,
      location: {
        label: place,
        area: geoCity || (station ? station.area : 'Reported area'),
        city: geoCity,
        country: geoCountry,
        citySlug: geoSlug,
        lat: lat, lng: lng
      },
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
      note: 'reported a new stray: ' + animal.name,
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
          note: 'reported a new stray: ' + animal.name,
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

  /* --------------------------- deleting a report ------------------------ */
  /* Owner-only COMPLETE deletion, from the Delete button in the edit form
     footer (index.html #report-delete, revealed by openEditReport()).

     Double-guarded like editing: canManageReport() hides the button for
     everyone else AND this re-checks, so a forged click still gets nowhere;
     the DB's "reporter delete reports" policy enforces it a third time.

     Removes, in order:
     1. the shared copy via window.sbDeleteReport() — reports row + its photo
        file in `animal-photos` storage (events history is plain text and stays,
        so other volunteers' "Milo was fed" logs don't vanish with the pin),
     2. the local pin + its device feed entries from state, persisted with
        writeOverlay(), then the map re-renders with the pin gone.

     A cloud id that is NOT a real report-<uuid> (legacy local pins) skips the
     shared call — there is no cloud row to delete. When the shared delete
     fails (offline, missing SQL migration) the local pin still goes and the
     toast says so honestly instead of pretending everyone sees the removal. */
  async function deleteThisReport() {
    const animal = editingReportId ? animalById(editingReportId) : null;
    if (!animal) return;
    if (!canManageReport(animal)) {
      toast('Only the volunteer who reported this stray can edit or delete it.', 'error');
      return;
    }
    const label = animal.name || 'this stray';
    if (!window.confirm('Delete "' + label + '" for good?\n\nThe pin, its photo and the shared report are removed permanently. This cannot be undone.')) return;
    const btn = $('#report-delete');
    const originalLabel = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.classList.add('opacity-60');
      btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">hourglass_empty</span>Deleting…';
    }
    let shared = { rowDeleted: false, photoDeleted: false, photoSkipped: true };
    try {
      if (isCloudReportId(animal.id) && typeof window.sbDeleteReport === 'function') {
        shared = await window.sbDeleteReport(
          animal.id.replace(/^report-/, ''),
          animal.photoUrl || null
        ) || shared;
      }
    } catch (err) { /* local removal below still runs; toast reports it */ }
    // Local pin + its device feed entries go regardless.
    state.animals = state.animals.filter((a) => a.id !== animal.id);
    state.log = state.log.filter((entry) => entry.animalId !== animal.id);
    /* Tombstone so neither the saved local copy nor a surviving cloud row can
       bring this pin back on the next reload (see hydrate + boot merge). */
    if (!Array.isArray(state.deletedReportIds)) state.deletedReportIds = [];
    if (state.deletedReportIds.indexOf(animal.id) === -1) {
      state.deletedReportIds.push(animal.id);
      while (state.deletedReportIds.length > 200) state.deletedReportIds.shift();
    }
    const deletedId = animal.id;
    const deletedPhoto = animal.photoUrl || null;
    writeOverlay();
    editingReportId = null;
    closeModal('report-modal');
    resetReportPhoto();
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-60');
      btn.innerHTML = originalLabel;
      btn.classList.add('hidden');
      btn.classList.remove('inline-flex');
    }
    if (state.map) state.map.closePopup();
    if (isCloudReportId(deletedId)) {
      afterMutation(shared.rowDeleted
        ? 'Deleted - "' + label + '" and its photo are gone for everyone.'
        : 'Removed from this device - the shared copy could not be deleted yet (run supabase/migration-report-delete.sql).',
        shared.rowDeleted ? 'ok' : 'error');
    } else {
      afterMutation('Deleted - "' + label + '" is off the map.', 'ok');
    }
    /* Phones only: the list owns the screen there, so go back to the map.
       Desktop keeps its side-by-side split — the menu must NOT vanish from
       under the user (same isNarrow() guard as revealAnimal/useMyLocation). */
    if (isNarrow()) switchMobileView('map');
    /* The shared delete above may have failed (offline, or the
       migration-report-delete.sql policy isn't run yet) while the pin is
       already gone locally. Retry once in the background: if the policy
       lands later, the cloud row + photo still get cleaned so OTHER devices
       stop resurrecting the pin too. Never blocks the UI. */
    if (isCloudReportId(deletedId) && !shared.rowDeleted &&
        typeof window.sbDeleteReport === 'function') {
      setTimeout(function () {
        try {
          var p = window.sbDeleteReport(deletedId.replace(/^report-/, ''), deletedPhoto);
          if (p && typeof p.then === 'function') p.catch(function () {});
        } catch (e) { /* next visit retries again via the same path */ }
      }, 8000);
    }
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
    return detailRow(label, n + ' ×');
  }

  /* ========================== photo lightbox ========================= */
  /* Full-screen viewer for one animal's photo. Opened from three places -
     a sidebar card tap, the details-drawer thumbnail and the map-popup
     thumb - all through the single `photo` action, so they can never
     disagree about what a photo click does.

     The image is capped at 74vh / 92vw with object-contain: it should feel
     huge without ever cropping the animal's face or forcing a scroll.

     Photo links die over time (the old Google aida CDN now 403s), and a
     broken-image glyph blown up to full screen looks like a crashed app -
     so a failed load drops the picture and swaps the caption instead. */
  function openPhoto(id) {
    const animal = animalById(id);
    if (!animal) return;
    if (!animal.photoUrl) {
      toast('No photo of ' + animal.name + ' has been shared yet - add one when you report or update it.', 'info');
      return;
    }
    const img = $('#photo-img');
    const title = $('#photo-title');
    const caption = $('#photo-caption');
    const detail = [speciesInfo(animal.species).singular, animal.location.label]
      .filter((part) => !isUnknown(part))
      .join(' • ');

    if (title) title.textContent = animal.name;
    if (caption) caption.textContent = detail;
    if (img) {
      img.classList.remove('hidden');
      img.onload = function () { img.classList.remove('hidden'); };
      img.onerror = function () {
        img.classList.add('hidden');
        if (caption) caption.textContent = 'The photo of ' + animal.name + ' could not be loaded right now.';
      };
      img.alt = animal.name + ' the ' + speciesInfo(animal.species).singular;
      /* Assigned last: the handlers above must be in place before the
         browser starts the (possibly cached, possibly instant) load. */
      img.src = animal.photoUrl;
    }
    openModal('photo-modal');
  }

  function openDetails(id) {
    const animal = animalById(id);
    if (!animal) return;
    const row = { animal: animal, status: statusOf(animal) };
    const issue = primaryIssue(row);
    const station = stationById(animal.stationId);
    const history = historyFor(animal.id).slice(0, 6);
    const reporterFirstName = String(animal.reporterName || '').trim().split(/\s+/)[0] || 'Community volunteer';
    const host = $('#details-content');
    if (!host) return;
    try { host.setAttribute('data-animal-id', animal.id); } catch (e) { /* ignore */ }

    const historyHtml = history.length
      ? '<ul class="flex flex-col gap-1.5">' + history.map((entry) => '<li class="flex items-start gap-2">' +
          '<span class="material-symbols-outlined text-[16px] text-primary">' +
            (entry.kind === 'feed' ? 'restaurant' : entry.kind === 'water' ? 'water_drop' : entry.kind === 'report' ? 'campaign' : 'event_note') +
          '</span>' +
          '<span class="font-body-sm text-xs text-on-surface-variant flex-1">' + esc(entry.note) + '</span>' +
          '<span class="font-label-sm text-[11px] text-outline shrink-0">' + relativeTime(entry.at) + '</span>' +
        '</li>').join('') + '</ul>'
      : '';

    const mapsUrl2 = 'https://www.google.com/maps/search/?api=1&query=' + animal.location.lat + ',' + animal.location.lng;
    const directions2 = 'https://www.google.com/maps/dir/?api=1&destination=' + animal.location.lat + ',' + animal.location.lng;

    /* Header. The close control used to be a bare 32px "x" crammed into the title
         row, where it collided with the "20m away" line underneath and looked
         like part of the content. It is now a proper 36px circular button with
         a visible resting border, a hover state and a pressed state, pinned to
         the header's corner with shrink-0 so a long name can never squeeze it.
         The title column carries pr-10 to reserve that space.

         The photo is the point of a profile, so its thumbnail is large
         (112px) and - when there IS a photo - IS the button that opens the
         full-screen viewer. The emoji fallback stays a plain div: tapping it
         explains there is nothing to enlarge instead of opening an empty
         viewer. The heading and subtitle truncate so the bigger thumb can
         never push the close button out of the row. */
    const drawerThumb = animal.photoUrl
      ? '<button type="button" data-action="photo" data-id="' + esc(animal.id) + '" title="' + esc(tt('card.view_photo', { name: animal.name })) + '" aria-label="' + esc(tt('card.view_photo', { name: animal.name })) + '" class="w-28 h-28 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm cursor-zoom-in hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary/40 transition-all">' + avatarHtml(animal) + '</button>'
      : '<div class="w-28 h-28 rounded-xl overflow-hidden shrink-0 bg-surface-container shadow-sm">' + avatarHtml(animal) + '</div>';
    host.innerHTML =
      '<div class="flex items-start gap-3">' +
        drawerThumb +
        '<div class="flex-1 min-w-0 pr-10">' +
          '<h3 class="font-headline-md text-headline-md text-on-surface truncate">' + esc(displayText(animal.name, 'card.unnamed')) + '</h3>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant truncate">' +
            esc([speciesInfo(animal.species).singular, animal.color].filter((part) => !isUnknown(part)).join(' • ') || animal.species) +
          '</p>' +
          '<p class="font-label-sm text-xs text-outline flex items-center gap-1 mt-1">' +
            '<span class="material-symbols-outlined text-[14px] text-primary shrink-0">pin_drop</span>' +
            '<span class="truncate">' + esc(displayLabel(animal.location.label)) + '</span>' +
            '<span class="mx-1 shrink-0">•</span><span class="shrink-0">' + esc(formatDistance(row.status.distance)) + ' ' + esc(tt('card.away')) + '</span></p>' +
        '</div>' +
        '<button type="button" data-close-modal="details-modal" ' +
          'class="shrink-0 -mt-1 -mr-1 w-9 h-9 rounded-full flex items-center justify-center ' +
          'border border-surface-container-highest bg-surface-container-low text-on-surface-variant ' +
          'hover:bg-surface-container hover:text-on-surface active:scale-90 transition-all" ' +
          'title="' + esc(tt('card.close')) + '" aria-label="' + esc(tt('card.close_details')) + '">' +
          '<span class="material-symbols-outlined text-[18px] leading-none">close</span></button>' +
      '</div>' +

      '<p class="mt-4 p-2.5 rounded-lg flex items-center gap-2 font-label-md text-label-md ' +
        (issue.tone === 'error' ? 'bg-error-container text-on-error-container' : issue.tone === 'tertiary' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container') + '">' +
        '<span class="material-symbols-outlined text-[18px]">' + issue.icon + '</span>' + esc(issue.text) + '</p>' +

      '<div class="mt-4 grid grid-cols-2 gap-3">' +
        '<div class="p-2.5 rounded-lg bg-surface-container">' +
          '<p class="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-error">restaurant</span> ' + esc(tt('drawer.food')) + '</p>' +
          '<p class="font-body-sm text-xs font-semibold text-on-surface mt-1">' +
            esc(row.status.food === 'ok' ? tt('drawer.bowl_stocked') : row.status.food === 'needs' ? tt('drawer.empty_refill') : tt('drawer.long_empty')) + '</p>' +
          '<p class="font-label-sm text-[11px] text-outline">' + esc(tt('drawer.last_fed', { when: relativeTime(animal.lastFedAt) })) + '</p>' +
        '</div>' +
        '<div class="p-2.5 rounded-lg bg-surface-container">' +
          '<p class="font-label-sm text-[11px] text-on-surface-variant flex items-center gap-1">' +
            '<span class="material-symbols-outlined text-[14px] text-tertiary">water_drop</span> ' + esc(tt('drawer.water')) + '</p>' +
          '<p class="font-body-sm text-xs font-semibold text-on-surface mt-1">' +
            esc(row.status.water === 'ok' ? tt('drawer.fresh') : row.status.water === 'needs' ? tt('drawer.low_topup') : tt('drawer.dry')) + '</p>' +
          '<p class="font-label-sm text-[11px] text-outline">' + esc(tt('drawer.last_filled', { when: relativeTime(animal.lastWateredAt) })) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="mt-4">' +
        /* Sex/age and temperament are only meaningful for animals someone has
           actually observed up close; a report never has them. */
        detailRow(tt('drawer.sex_age'), [animal.sex, animal.ageClass].every(isUnknown)
          ? '' : (isUnknown(animal.sex) ? '' : animal.sex) + ' • ' + (isUnknown(animal.ageClass) ? '' : animal.ageClass)) +
        detailRow(tt('drawer.temperament'), animal.temperament) +
        detailRow(tt('drawer.health'), animal.health) +
        /* Care flags only render when affirmative: "No" would claim we checked
           and found nothing, when really nobody was asked. */
        (animal.sterilized ? detailRow(tt('drawer.neutered'), tt('drawer.yes')) : '') +
        (animal.vaccinated ? detailRow(tt('drawer.vaccinated'), tt('drawer.yes')) : '') +
        (animal.microchipped ? detailRow(tt('drawer.microchipped'), tt('drawer.yes')) : '') +
        detailRow(tt('drawer.first_reported'), relativeTime(animal.reportedAt) + ' (' + clockTime(animal.reportedAt) + ')') +
        countRow(tt('drawer.feeds_logged'), animal.feedCount) +
        countRow(tt('drawer.water_logged'), animal.waterCount) +
        (animal.source !== 'report' ? detailRow(tt('drawer.caretakers'), animal.caretakers.length ? animal.caretakers.join(', ') : '') : '') +
        detailRow(tt('drawer.station'), station ? station.name : '') +
        (animal.source === 'report' ? detailRow(tt('drawer.reported_by'), reporterFirstName) : '') +
      '</div>' +

      /* Exact coordinates are background data - the link opens the pin in
         Google Maps, but the numbers themselves are never printed. */
      '<div class="mt-4 p-2.5 rounded-lg bg-surface-container-low">' +
        '<p class="font-label-sm text-[11px] text-on-surface-variant">' + esc(tt('drawer.location')) + '</p>' +
        '<p class="font-body-sm text-xs mt-1"><a href="' + esc(mapsUrl2) + '" target="_blank" rel="noopener" style="text-decoration:underline">' + esc(tt('drawer.open_maps_link')) + '</a></p>' +
      '</div>' +

      (isUnknown(animal.description) || ['reported by community', 'reported by a community volunteer'].indexOf(
        String(animal.description || '').trim().toLowerCase().replace(/[.]$/, '')
      ) !== -1
        ? ''
        : '<p class="mt-4 font-body-sm text-body-sm text-on-surface">' + esc(animal.description) + '</p>') +
      '<p class="mt-2 p-2.5 rounded-lg bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">' +
        '<span class="material-symbols-outlined text-[14px] text-primary align-middle mr-1">lightbulb</span>' + esc(animal.notes) + '</p>' +
      (animal.tags.some((tag) => tag !== 'community-report')
        ? '<div class="flex flex-wrap gap-1.5 mt-3">' + animal.tags.filter((tag) => tag !== 'community-report').map((tag) =>
            '<span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-[11px]">#' + esc(tag) + '</span>').join('') + '</div>'
        : '') +

      (historyHtml
        ? '<div class="mt-4">' +
            '<p class="font-label-md text-label-md text-on-surface font-semibold mb-2">' + esc(tt('drawer.recent_device')) + '</p>' +
            historyHtml +
          '</div>'
        : '') +

      /* Directions leads the row. It now uses the SAME .fta-btn--go class as the
         map popups instead of hand-rolled Tailwind utilities - those included
         `hover:opacity-95`, which faded the label on hover and was part of why
         it kept reading as translucent. One class, one colour, everywhere. */
      '<div class="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-surface-container-high">' +
        '<a class="fta-btn fta-btn--go" style="color:#ffffff" target="_blank" rel="noopener" href="' + esc(directions2) + '" ' +
          'title="' + esc(tt('card.walk_to')) + '">' +
          '<span class="material-symbols-outlined" style="color:#ffffff">directions</span>' + esc(tt('card.directions')) + '</a>' +
        '<button type="button" data-action="feed" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">' +
          '<span class="material-symbols-outlined text-[18px]">restaurant</span>' + esc(tt('drawer.i_fed_name', { name: animal.name })) + '</button>' +
        '<button type="button" data-action="water" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">water_drop</span>' + esc(tt('drawer.gave_water')) + '</button>' +
        '<button type="button" data-action="medicine" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">medical_services</span>' + esc(tt('drawer.vet_visit')) + '</button>' +
        '<button type="button" data-action="locate" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">my_location</span>' + esc(tt('drawer.show_map')) + '</button>' +
        /* Only the reporter of THIS stray sees the edit control - and even a
           forged button dies at openEditReport()'s canManageReport() check. */
        (canManageReport(animal)
          ? '<button type="button" data-action="edit" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
            '<span class="material-symbols-outlined text-[18px]">edit</span>' + esc(tt('drawer.edit_report')) + '</button>'
          : '') +
        /* Phase 5. DMs to whoever most recently cared for this animal. The
           button is always present - openChat() resolves the caretaker and
           explains the outcome ("nobody has signed in yet", "sign in
           first"), so the volunteer is never left guessing why a control
           is missing. */
        '<button type="button" data-action="message" data-id="' + esc(animal.id) + '" class="h-10 px-4 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center gap-1.5 transition-colors">' +
          '<span class="material-symbols-outlined text-[18px]">chat</span>' + esc(tt('card.message_caretaker')) + '</button>' +
      '</div>';

    openModal('details-modal');
    setSelected(animal.id, false);
  }

  /* ============================ chat DMs ============================= *
   * Phase 5. Lets two volunteers talk about one animal without ever
   * publishing their names or addresses to anyone else - the thread is
   * readable only by its two participants (schema-chat.sql RLS).
   *
   * The flow is always the same: open an animal -> find the most recent
   * volunteer who cared for it -> open/create the thread for that pair ->
   * render it and subscribe. The animal id is the context key, so the
   * same two people discussing a different animal get a different thread.
   * ------------------------------------------------------------------ */
  const CHAT_MAX = 2000;

  /* How many messages a thread loads on open. sbListMessages orders
     ASCENDING, so this is the OLDEST slice, not the newest - which is what
     you want for a "read the whole thing" thread, and 200 is far beyond
     what any real conversation about one animal reaches. */
  const CHAT_LIMIT = 200;

  function chatFn(name) {
    try {
      if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
    } catch (e) { /* ignore */ }
    return null;
  }

  /* Message delivery state, derived from one number.

     A message is SENT as soon as the insert succeeds - there is no delivery
     receipt in this schema, and inventing one would be a lie. It is READ
     once the OTHER participant's own read cursor is at or past the
     message's timestamp. That cursor is the same column the unread badge
     counts from, so a tick can never claim "read" while the badge still
     says unread: they are two readings of one fact.

     `peerReadAt` is deliberately a parameter rather than a read of
     state.chat, so this stays a pure function the tests can drive. */
  function chatReceipt(row, peerReadAt) {
    const sentAt = Date.parse(row && row.created_at);
    if (!isFinite(sentAt)) return '';
    const seen = Date.parse(peerReadAt || '');
    /* No cursor yet means nobody has ever opened the thread, so the honest
       answer is "sent", never "read". */
    const read = isFinite(seen) && seen >= sentAt;
    /* Inline SVG, NOT the Material Symbols ligature. The ligature renders as
       the literal words "done"/"done_all" whenever the icon font fails to
       load (ad-blocker, offline CDN, slow font), and the 15px box then clips
       it to "don" - exactly the reported bug. An SVG always paints. */
    const path = read
      ? 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.67 16.17l-4.24-4.24-1.41 1.41L11.67 19l12-12-1.43-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z'
      : 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z';
    return '<span class="chat-tick ' + (read ? 'chat-tick--read' : '') + '"'
      + ' title="' + (read ? 'Read' : 'Sent') + '"'
      + ' aria-label="' + (read ? 'Read' : 'Sent') + '"'
      + ' data-tick="' + (read ? 'read' : 'sent') + '">'
      + '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true" focusable="false">'
      + '<path d="' + path + '"/></svg></span>';
  }

  /* WhatsApp-style thread: compact bubbles with the clock + ticks tucked
     inside the bubble's bottom-right corner (floated, not flex-pushed, so a
     one-word "ok" stays a small bubble instead of stretching full-width). */
  function chatBubble(row, mine, grouped, endsGroup, peerReadAt) {
    const receipt = mine ? chatReceipt(row, peerReadAt) : '';
    const bubble = '<div class="chat-message__bubble">' +
      '<span class="chat-message__text whitespace-pre-wrap">' + esc(row.body) + '</span>' +
      '<span class="chat-message__meta"><time>' + esc(chatTime(row.created_at)) + '</time>' +
        receipt + '</span></div>';

    return '<div class="chat-message ' + (mine ? 'chat-message--mine' : 'chat-message--theirs') +
      (grouped ? ' chat-message--grouped' : '') + '">' + bubble + '</div>';
  }

  /* Bubble clock only ("6:35 PM"). The DAY lives in the divider above, so
     repeating "Today" inside every bubble is what made the thread read
     cluttered. Same clock for old messages - the divider already says which
     day they belong to. */
  function chatTime(iso) {
    const at = Date.parse(iso);
    if (!isFinite(at)) return '';
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function chatScrollToEnd(force) {
    const log = $('#chat-log');
    if (!log) return;
    /* Only stick to the bottom when the volunteer is already at (or near)
       it. Someone reading back through yesterday's messages must not be
       yanked to the end by an incoming one. The first paint passes force
       so a reopened thread always starts at the newest message. */
    if (!force) {
      const distance = log.scrollHeight - log.scrollTop - log.clientHeight;
      if (distance > 140) return;
    }
    log.scrollTop = log.scrollHeight;
  }

  /* "Today" / "Yesterday" / "Sat, 22 Feb" - the divider between days.

     Messenger-style threads get long, and "which day was that?" is the
     first question when scrolling back. The date is a local calendar
     comparison, not a 24h window: at 23:58 the reply is Yesterday even
     though it is four minutes old. */
  function chatDayLabel(iso) {
    const at = Date.parse(iso);
    if (!isFinite(at)) return '';
    const day = new Date(at);
    const today = new Date();
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(day)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return day.toLocaleDateString(undefined, { weekday: 'long' });
    return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      (day.getFullYear() === today.getFullYear() ? '' : ' ' + day.getFullYear());
  }

  /* Does this row continue the previous one? Same sender, close in time.
     Conversations come in bursts ("on my way" / "ok" / "thank you"), and
     without this every line would carry its own avatar and timestamp. */
  function isGroupedWith(previous, row) {
    if (!previous || !row) return false;
    if ((previous.sender_id || null) !== (row.sender_id || null)) return false;
    const a = Date.parse(previous.created_at);
    const b = Date.parse(row.created_at);
    if (!isFinite(a) || !isFinite(b)) return false;
    return Math.abs(b - a) < 5 * MINUTE;
  }

  /* Renders the whole thread from state rather than appending one node at a
     time. Grouping is a property of the SEQUENCE, so the last row can change
     the shape of the one before it (it decides who owns the avatar and the
     timestamp). Re-rendering is cheap at 100 rows and removes a whole class
     of stale-tail bugs. */
  /* Builds the thread markup from state, newest at the bottom.

     Re-rendering the whole log (rather than appending a node) is deliberate:
     grouping is a property of the SEQUENCE, so a new message can change the
     shape of the one before it (it decides who owns the avatar and the
     timestamp). It is cheap at 100 rows and removes a class of stale-tail
     bugs that only show up days later in a long thread. */
  function renderChat() {
    const log = chatLogInner();
    if (!log) return;
    const rows = state.chat.rows;
    if (!rows || !rows.length) {
      chatEmptyLog('No messages yet. Say hello - a quick &ldquo;is ' +
        esc(state.chat.animalName || 'this animal') + ' still around?&rdquo; is usually enough.');
      return;
    }

    let lastDay = null;
    const html = [];
    rows.forEach((row, i) => {
      /* A day divider is inserted whenever the calendar day changes, so
         "Today" / "Yesterday" / a date always separates the two days. */
      const day = chatDayLabel(row.created_at);
      if (day && day !== lastDay) {
        html.push(chatDayDividerHtml(day));
        lastDay = day;
      }

      const previous = rows[i - 1];
      const next = rows[i + 1];
      /* A day boundary is also a hard grouping boundary: the first message
         after a divider starts a new block even if it is seconds after the
         last one from yesterday, so the avatar does not float down the log. */
      const newDayBefore = !previous || chatDayLabel(previous.created_at) !== day;
      const newDayAfter = !next || chatDayLabel(next.created_at) !== day;
      const grouped = !newDayBefore && isGroupedWith(previous, row);
      /* The avatar and timestamp belong to the message that ENDS a group. */
      const endsGroup = newDayAfter || !isGroupedWith(row, next);
      const mine = row.sender_id === state.chat.myId;
      html.push(chatBubble(row, mine, grouped, endsGroup, state.chat.peerReadAt));
    });

    log.innerHTML = html.join('');
    chatScrollToEnd();
  }

  /* WhatsApp day chip: a small centred pill ("TODAY"), not a hairline rule.
     The hairline read as a section break from another app; the chip is the
     WhatsApp signal for "same conversation, new day". */
  function chatDayDividerHtml(label) {
    return '<div class="flex justify-center py-2 first:pt-1" role="separator" aria-label="' + esc(label) + '">'
      + '<span class="font-label-sm text-[11px] font-semibold uppercase tracking-wide px-3 py-1 rounded-lg shrink-0"'
      + ' style="background:#f0f2f5;color:#54656f;box-shadow:0 1px 1px rgba(0,0,0,.08)">'
        + esc(label) + '</span>'
      + '</div>';
  }

  /* Appends one message, ignoring any we have already put on screen.

     This is the single dedupe point for three cases: our own send (the
     insert response renders it, then realtime echoes the same row), a
     second realtime event for the same row, and a row replayed after a
     reload. Keyed on the row id, which is the only stable identity. */
  function appendChatRow(row) {
    if (!row || !row.body) return;
    if (row.id) {
      if (state.chat.seenIds[row.id]) return;
      state.chat.seenIds[row.id] = true;
    }
    /* Name is stamped here rather than at each call site so an incoming
       realtime row and our own insert response are labelled identically. */
    if (!row.senderName) {
      row.senderName = row.sender_id === state.chat.myId ? 'You' : state.chat.peerName;
    }
    /* A realtime row can arrive out of order against a page load, so keep
       the thread in chronological order - grouping depends on sequence. */
    const at = Date.parse(row.created_at);
    if (isFinite(at)) {
      let i = state.chat.rows.length;
      while (i > 0 && Date.parse(state.chat.rows[i - 1].created_at) > at) i -= 1;
      state.chat.rows.splice(i, 0, row);
    } else {
      state.chat.rows.push(row);
    }
    renderChat();
  }

  /* Hides the composer and explains why. Used both for "sign in first"
     and for "there is nobody to message yet", so the volunteer is never
     left with a composer that fails on send. */
  function chatGate(text) {
    const gate = $('#chat-gate');
    const gateText = $('#chat-gate-text');
    const form = $('#chat-form');
    if (gateText) gateText.innerHTML = text;
    if (gate) gate.classList.remove('hidden');
    if (form) form.classList.add('hidden');
  }

  function chatShowComposer() {
    const gate = $('#chat-gate');
    const form = $('#chat-form');
    if (gate) gate.classList.add('hidden');
    if (form) form.classList.remove('hidden');
    const input = $('#chat-input');
    if (input) {
      input.disabled = false;
      input.value = '';
    }
    syncChatSendButton();
  }

  function syncChatSendButton() {
    const input = $('#chat-input');
    const sendBtn = $('#chat-send');
    if (sendBtn) sendBtn.hidden = !input || !String(input.value || '').trim();
  }

  /* The scroll container and the flow container are different elements on
     purpose: the outer one scrolls, the inner one holds the messages and
     carries mt-auto so a short thread rests on the floor of the panel.
     Falling back to #chat-log keeps the empty/loading states working even
     if the wrapper is ever missing. */
  function chatLogInner() {
    return $('#chat-log-inner') || $('#chat-log');
  }

  function chatEmptyLog(text) {
    const log = chatLogInner();
    if (log) log.innerHTML = '<p class="font-body-sm text-body-sm text-on-surface-variant text-center py-6">' + text + '</p>';
  }

  /* Opens a thread for one animal.
   *
   * `conversationId` is the whole point of the second parameter. The inbox
   * and the header popover already KNOW which thread the volunteer tapped,
   * and they hand that id over. Re-deriving it from `sbCaretakerFor()` here
   * used to be the only way in - and it is wrong: that lookup returns
   * whoever fed the animal most recently, which is frequently a THIRD
   * volunteer, so get_or_create_dm silently opened a different (empty)
   * conversation. The volunteer tapped "Lala" and landed in a blank thread.
   * When the id is known we open exactly that thread and never guess. */
  /* THE one place a thread is marked read.

     Reading happens on three paths and all three used to be separate,
     partial, or missing:
       1. opening the thread          - fired once, at the very end of
         openChat(), so any early return skipped it entirely
       2. a message arriving while the thread is open - never marked at
         all, so the badge climbed back the moment you were looking at it
       3. returning to the tab         - not handled

     The cursor is the NEWEST SERVER timestamp actually on screen, never the
     browser clock. Writing the local time is what made the badge immortal
     on any device whose clock runs fast: the unread test compares that
     value against server `created_at`, so every message stayed "newer than
     when I read it". Passing the newest row we have seen keeps both sides
     in the same clock, and leaves anything that arrives later correctly
     unread.

     Never rejects: a failed mark must not break the thread, it only means
     the badge is briefly stale.

     A STALE supabase-client.js looks exactly like a broken badge. index.js
     and site-header.js are no-cache, so they refresh on every load, but the
     data layer they call into was cached for an hour - so this function asks
     for window.sbMarkConversationRead, gets undefined back from an old copy
     that never defined it, and the badge survives being read with no other
     error anywhere on the page. That is why the guard below shouts. */
  function markThreadRead() {
    const conversation = state.chat.conversationId;
    if (!conversation) return;
    const markRead = chatFn('sbMarkConversationRead');
    if (!markRead) {
      console.warn('[chat] sbMarkConversationRead missing - hard-reload (Ctrl+Shift+R); ' +
        'the unread badge cannot clear until supabase-client.js refreshes.');
      return;
    }

    /* The newest row in state is the newest thing the volunteer has seen. */
    const rows = state.chat.rows || [];
    const newest = rows.length ? rows[rows.length - 1] : null;
    const upTo = newest ? newest.created_at : null;

    /* The cursor is the newest message we LOADED, never a server-side
       "latest": on a long thread the newest rows are not on screen yet. */
    Promise.resolve(markRead(conversation, upTo)).then((ok) => {
      /* false = the database refused (usually the missing UPDATE policy).
         Repainting anyway re-read the unchanged row and showed the same
         count, so a stuck badge looked identical to a working one. */
      if (ok === false) {
        console.warn('[chat] mark read refused - run supabase/migration-read-receipts.sql');
        return;
      }
      /* Ask the header to repaint so the badge drops without waiting for
         its next poll. */
      try { window.dispatchEvent(new Event('fta:chat-opened')); } catch (e) { /* older browsers */ }
    }).catch(() => { /* badge stays stale; nothing else breaks */ });
  }

  /* Re-read the OTHER volunteer's read cursor.

     THE BUG THIS FIXES: the tick showed a single "sent" check forever. The
     cursor was fetched once, when the thread was opened, and then cached in
     state.chat.peerReadAt for the life of the modal. Opening the thread on
     your own screen bumps YOUR cursor in the database - it does nothing to
     the OTHER participant's row. So the peer reading your message changed a
     column this client had already read and would never read again, and the
     tick stayed at one until you closed and reopened the thread.

     A receipt is a live fact about somebody else's session, so it has to be
     polled, not snapshotted. Cheap: one indexed 2-row read, and only while a
     thread is actually open. Re-renders only when the value really moved, so
     this does not fight the realtime appends or reset the scroll position. */
  async function refreshPeerReadAt() {
    const conversation = state.chat.conversationId;
    if (!conversation) return;
    const peers = chatFn('sbDmPeers');
    if (!peers) return;
    try {
      const listed = await peers(conversation, state.chat.myId);
      const fresh = (listed && listed[0] && listed[0].lastReadAt) || null;
      const onlineNow = !!(listed && listed[0] && listed[0].online);
      const onlineFlip = onlineNow !== !!state.chat.peerOnline;
      if (onlineFlip) {
        state.chat.peerOnline = onlineNow;
        paintChatPresence();
      }
      /* String compare, not Date: both sides are ISO strings from the same
         column, and equal text means nothing changed. Re-rendering on an
         unchanged value would fight the live append path. */
      if ((fresh || '') === (state.chat.peerReadAt || '')) return;
      state.chat.peerReadAt = fresh;
      renderChat();
    } catch (e) { /* the tick simply stays where it was */ }
  }

  /* A message just landed. If the thread is open AND the tab is in front,
     the volunteer is looking straight at it, so it is read by definition.
     The tab check matters: a backgrounded tab does not count as reading,
     which is what stops the badge clearing itself while nobody is there. */
  function onIncomingChatRow() {
    if (!state.chat.conversationId) return;
    /* A message that lands in a background tab has NOT been read, no matter
       how long the thread has been open. Honouring document.hidden is what
       keeps the badge honest: it clears when the volunteer is actually
       looking, and survives until they come back. */
    const hidden = typeof document !== 'undefined' &&
      (document.hidden === true || document.visibilityState === 'hidden');
    if (!hidden) markThreadRead();
  }

  /* Coming back to the tab counts as catching up: the messages that arrived
     while it was in the background are on screen now, so the badge should
     drop the moment the volunteer returns rather than on the next poll. */
  function onTabVisible() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (state.chat.conversationId) markThreadRead();
    /* Same reasoning for the peer's cursor: the volunteer was away, so the
       interval may have been throttled or skipped entirely. Catch up on the
       receipt the moment they look again. */
    refreshPeerReadAt();
  }

  async function openChat(animalId, conversationId) {
    const animal = animalById(animalId);
    stopChat();
    setChatWidgetCollapsed(false);
    state.chat.animalName = animal ? animal.name : '';

    openModal('chat-modal');
    const withEl = $('#chat-with');
    if (withEl) withEl.textContent = 'Loading chat...';
    chatEmptyLog('Loading messages...');

    const requireEmail = chatFn('sbRequireEmail');
    const openDm = chatFn('sbOpenDm');
    const caretakerFor = chatFn('sbCaretakerFor');
    if (!openDm || !caretakerFor) {
      chatEmptyLog('');
      chatGate('Messaging is not available yet. It turns on once the chat tables are running.');
      return;
    }

    const me = requireEmail ? await requireEmail() : null;
    if (me) state.chat.myId = me.id;

    let conversation = conversationId || null;
    let peerName = null;
    let peerId = null;
    let peerReadAt = null;
    let peerOnline = false;

    if (conversation) {
      /* Known thread: the peer comes out of the participants list, so the
         header names whoever is actually on the other side. */
      const peers = chatFn('sbDmPeers');
      const listed = peers ? await peers(conversation, me ? me.id : null) : [];
      if (listed.length) {
        peerId = listed[0].userId;
        peerName = listed[0].name;
        peerReadAt = listed[0].lastReadAt || null;
        peerOnline = !!listed[0].online;
      } else {
        peerName = 'Volunteer';
      }
    } else {
      /* No thread yet, so find someone to start one with. Caretaker first:
         if nobody has a real account for this animal yet, say so instead of
         opening a composer that would fail on send. */
      const caretaker = await caretakerFor(animal ? animal.id : animalId, me ? me.id : null);
      /* For a REPORT the natural peer is whoever POSTED it - not whoever
         happens to have fed it most recently. The poster id rides along on
         every report (sbLoadReports maps reporter_id), so the chat icon on
         the popup really does open a thread with the person who pinned the
         stray. Seed animals carry no reporter, so they keep the caretaker
         behaviour unchanged, and your own report is never messaged (the RPC
         refuses self-DMs anyway). */
      let peer = caretaker;
      const reporterId = animal && animal.reporterId ? animal.reporterId : null;
      const postedByMe = !!(reporterId && me && reporterId === me.id);
      if (animal && animal.source === 'report' && reporterId && !postedByMe) {
        peer = { userId: reporterId, name: animal.reporterName || null };
        if (!peer.name) {
          /* The thread header must name the poster before the first message
             exists; profiles.display_name is the same name the inbox shows. */
          const profileName = chatFn('sbProfileName');
          if (profileName) {
            try { peer.name = await profileName(reporterId); } catch (e) { peer.name = null; }
          }
        }
        peer.name = peer.name || 'Volunteer';
      }
      if (!peer) {
        chatEmptyLog('');
        if (postedByMe) {
          chatGate('This is your own report, so there is nobody else to message about it yet.');
        } else {
          chatGate('Nobody has signed in to care for ' + esc(state.chat.animalName || 'this animal') +
            ' yet, so there is nobody to message. Log a feed or a vet check first - then you can talk to whoever did it.');
        }
        return;
      }

      if (!me) {
        /* An anonymous session cannot be replied to, so chat asks for a real
           account (step 5.2). Logging a feed still works without one. */
        chatEmptyLog('');
        chatGate('Messaging needs a real account so ' + esc(peer.name) +
          ' can reply to you. <a href="auth.html" class="text-primary font-semibold hover:underline">Sign in</a> - ' +
          'logging a feed still works without one.');
        return;
      }

      conversation = await openDm(peer.userId, animal ? animal.id : animalId, null);

      if (conversation && conversation.error === 'self') {
        chatEmptyLog('');
        chatGate('Those are your own care logs, so there is nobody else to message about them.');
        return;
      }
      if (conversation && conversation.error === 'signin') {
        chatEmptyLog('');
        chatGate('Messaging needs a real account. <a href="auth.html" class="text-primary font-semibold hover:underline">Sign in</a> to message ' + esc(peer.name) + '.');
        return;
      }
      if (!conversation) {
        chatEmptyLog('');
        /* The RPC can fail for a reason the volunteer cannot act on (a schema
           problem like the animal_id foreign key, which is exactly what
           "Try again in a moment" used to hide). Point at the console, where
           the real reason is logged, instead of implying retrying will help. */
        chatGate('That conversation could not be opened. Check the browser console (F12) for the reason - if it mentions a foreign key, run <code class="font-mono">supabase/migration-drop-events-fk.sql</code>.');
        return;
      }
      peerId = peer.userId;
      peerName = peer.name;
      peerReadAt = null;
    }

    state.chat.conversationId = conversation;
    state.chat.peer = peerId;
    state.chat.peerName = peerName;
    state.chat.peerReadAt = peerReadAt;

    /* Stamp the sender's display name onto each row so the thread header and
       the grouping logic have a name to work with. `messages` only stores
       sender_id, and a name lookup per bubble would be a query each. */
    const nameFor = (senderId) => (senderId === me.id ? 'You' : state.chat.peerName);

    /* WhatsApp header: ONE line - the peer's name with a green online dot.
       "Messages / Chat with X" stacked two lines is what made the header
       feel like a settings page instead of a chat. */
    const peerOnlineNow = peerOnline || (typeof window !== 'undefined' && window.sbPeerOnline
      ? window.sbPeerOnline({ lastReadAt: peerReadAt }, null, Date.now())
      : false);
    state.chat.peerOnline = !!peerOnlineNow;
    const presenceHtml = (typeof window !== 'undefined' && window.sbPresenceDotHtml)
      ? window.sbPresenceDotHtml(state.chat.peerOnline, 12) : '';
    const statusText = state.chat.peerOnline ? 'online' : 'Chat with ' + (state.chat.peerName || 'Volunteer');
    if (withEl) {
      withEl.innerHTML = '<span style="font-weight:800;color:#111b21;font-size:16px;line-height:1.2;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + esc(state.chat.peerName || 'Volunteer') + '</span>'
        + '<span style="font-size:12px;color:' + (state.chat.peerOnline ? '#25d366' : '#667781') + ';line-height:1.2;display:block">'
        + esc(statusText) + '</span>';
    }
    const titleEl = $('#chat-title');
    if (titleEl) titleEl.style.display = 'none';
    /* Avatar in the thread header, matching the inbox and the popover. */
    const avatarEl = $('#chat-avatar');
    if (avatarEl) avatarEl.innerHTML = '<span style="position:relative;display:inline-flex">' + personAvatarHtml(state.chat.peerName, null, 'w-10 h-10') + presenceHtml + '</span>';
    const blockBtn = $('#chat-block');
    if (blockBtn) blockBtn.textContent = 'Block';

    chatShowComposer();

    /* Both sides of the conversation, oldest first, so the thread reads top
       to bottom. sbListMessages already orders ascending; the client-side
       sort makes the order independent of the query and keeps a realtime
       row that arrived early from rendering out of sequence. */
    const listMessages = chatFn('sbListMessages');
    const rows = listMessages ? await listMessages(conversation, CHAT_LIMIT) : null;
    state.chat.rows = (rows || [])
      .map((row) => Object.assign({}, row, { senderName: nameFor(row.sender_id) }))
      .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
    state.chat.rows.forEach((row) => { if (row.id) state.chat.seenIds[row.id] = true; });
    renderChat();
    chatScrollToEnd(true);

    /* Opening a thread IS reading it, so advance the cursor to the newest
       message on screen. This used to sit at the very end of openChat,
       behind several early returns, so several perfectly normal openings
       never cleared the badge. */
    markThreadRead();

    const subscribe = chatFn('sbSubscribeDm');
    if (subscribe) {
      state.chat.channel = subscribe(conversation, (row) => {
        appendChatRow(row);
        /* Reading what just arrived is the whole point of having the thread
           open, so the badge is cleared here too. Without this the badge
           climbed back the instant a reply landed, which is exactly the
           "still shows unread after I read it" complaint. */
        onIncomingChatRow();
      });
    }

    /* Poll the peer's read cursor while the thread is open, so a message they
       read turns one tick into two without the volunteer reloading. Also
       fires once immediately so reopening a thread shows the true state
       instead of waiting out the first interval. */
    clearInterval(state.chat.readTimer);
    refreshPeerReadAt();
    state.chat.readTimer = setInterval(refreshPeerReadAt, 8000);
    /* Same poll refreshes the green dot: a cursor that moved recently means
       they are here right now. */
    clearInterval(state.chat.presenceTimer);
    state.chat.presenceTimer = setInterval(refreshPeerReadAt, 15000);
  }

  /* Repaints the WhatsApp header line (name + online status + green dot)
     without touching the message log. Called whenever the peer's cursor
     refreshes, so "online" flips live while the thread is open. */
  function paintChatPresence() {
    const withEl = $('#chat-with');
    if (!withEl || !state.chat.conversationId) return;
    const dot = (typeof window !== 'undefined' && window.sbPresenceDotHtml)
      ? window.sbPresenceDotHtml(state.chat.peerOnline, 12) : '';
    const statusText = state.chat.peerOnline ? 'online' : 'Chat with ' + (state.chat.peerName || 'Volunteer');
    withEl.innerHTML = '<span style="font-weight:800;color:#111b21;font-size:16px;line-height:1.2;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + esc(state.chat.peerName || 'Volunteer') + '</span>'
      + '<span style="font-size:12px;color:' + (state.chat.peerOnline ? '#25d366' : '#667781') + ';line-height:1.2;display:block">'
      + esc(statusText) + '</span>';
    const avatarEl = $('#chat-avatar');
    if (avatarEl) avatarEl.innerHTML = '<span style="position:relative;display:inline-flex">' + personAvatarHtml(state.chat.peerName, null, 'w-10 h-10') + dot + '</span>';
  }

  async function sendChatMessage() {
    if (state.chat.blocked) {
      toast('Unblock this volunteer before sending.', 'info');
      return;
    }
    const input = $('#chat-input');
    const body = String((input && input.value) || '').trim().slice(0, CHAT_MAX);
    if (!body || !state.chat.conversationId) return;

    const sendMessage = chatFn('sbSendMessage');
    if (!sendMessage) { toast('Messaging is not available yet.', 'error'); return; }

    const sendBtn = $('#chat-send');
    if (sendBtn) sendBtn.disabled = true;
    let result = null;
    try {
      result = await sendMessage(state.chat.conversationId, body);
    } catch (e) {
      result = { error: 'failed' };
    }
    if (result && !result.error) {
      if (input) input.value = '';
      syncChatSendButton();
    }
    if (sendBtn) sendBtn.disabled = false;

    if (!result) { toast('Message not sent - could not reach the server.', 'error'); return; }
    if (result.error === 'blocked') {
      toast('You blocked ' + state.chat.peerName + ', so they cannot be messaged.', 'info');
      return;
    }
    if (result.error === 'signin') { toast('Sign in to send messages.', 'info'); return; }
    if (result.error) { toast('Message not sent - please try again.', 'error'); return; }

    /* Render from the insert response instead of waiting for the realtime
       echo, so sending feels instant on a slow connection. seenIds stops
       the echo duplicating it. */
    if (result && result.id) appendChatRow(result);
  }

  async function toggleChatBlock() {
    if (!state.chat.peer) return;
    const name = state.chat.peerName || 'this volunteer';
    const next = !state.chat.blocked;
    const setBlock = chatFn('sbSetBlock');
    if (!setBlock) { toast('Blocking is not available yet.', 'error'); return; }

    if (next) {
      const ok = window.confirm('Block ' + name + '?\n\nThey will not be able to send you messages. You can unblock them at any time.');
      if (!ok) return;
    }

    const btn = $('#chat-block');
    if (btn) btn.disabled = true;
    let res = null;
    try {
      res = await setBlock(state.chat.peer, next);
    } catch (e) {
      res = { error: 'failed' };
    }
    if (btn) btn.disabled = false;

    if (!res || res.error) {
      toast('Could not update the block - please try again.', 'error');
      return;
    }
    state.chat.blocked = next;
    if (btn) btn.textContent = next ? 'Unblock' : 'Block';
    toast(next ? 'You blocked ' + name + '.' : 'You unblocked ' + name + '.', 'ok');
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
      const syncUser = async (user) => {
        if (!user || user.is_anonymous) return;
        state.myId = user.id;
        const name = await getName(state.profile.name || 'Guest volunteer');
        const avatarUrl = await syncAvatar(user);
        if (name) {
          state.profile = Object.assign({}, state.profile, {
            name: name,
            avatarUrl: avatarUrl || state.profile.avatarUrl || null,
          });
          writeOverlay();
          renderTicker();
        }
        const metadata = user.user_metadata || {};
        const editRequested = new URLSearchParams(window.location.search).get('edit-display-name') === '1';
        if (editRequested) {
          showDisplayNameModal(name, false);
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        } else if (!metadata.fta_display_name && !metadata.fta_display_name_prompted) {
          showDisplayNameModal(name, true);
        }
      };
      const user = await auth.currentUser();
      await syncUser(user);
      try {
        const client = auth.client();
        if (client && client.auth && client.auth.onAuthStateChange) {
          client.auth.onAuthStateChange(async () => {
            await syncUser(await auth.currentUser());
          });
        }
      } catch (e) {}
    } catch (e) { /* stay as guest */ }
  }

  let displayNameModalOpen = false;
  let displayNameFallback = 'Volunteer';
  let displayNameFirstName = 'Volunteer';
  function showDisplayNameModal(currentName, isFirstSignIn) {
    const modal = $('#display-name-modal');
    const input = $('#display-name-input');
    if (!modal || displayNameModalOpen) return;
    const fullName = String(currentName || '').trim().replace(/\s+/g, ' ');
    displayNameFirstName = fullName.split(/\s+/)[0] || 'Volunteer';
    displayNameFallback = isFirstSignIn ? displayNameFirstName : (fullName || 'Volunteer');
    if (input) input.value = isFirstSignIn ? displayNameFirstName : (fullName || displayNameFirstName);
    const title = $('#display-name-title');
    if (title) title.textContent = isFirstSignIn ? 'What should we call you?' : 'Change your display name';
    displayNameModalOpen = true;
    openModal('display-name-modal');
    window.setTimeout(() => { if (input) input.focus(); }, 50);
  }

  async function saveDisplayName(value) {
    const input = $('#display-name-input');
    const error = $('#display-name-error');
    const saveButton = $('#display-name-save');
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    if (error) {
      error.textContent = '';
      error.classList.add('hidden');
    }
    if (clean.length < 2 || clean.length > 40) {
      if (error) {
        error.textContent = 'Choose a display name between 2 and 40 characters.';
        error.classList.remove('hidden');
      }
      if (input) input.focus();
      return;
    }
    if (saveButton) saveButton.disabled = true;
    try {
      const save = window.sbSaveDisplayName;
      if (typeof save !== 'function') throw new Error('Profile service is unavailable. Please try again later.');
      const savedName = await save(clean);
      state.profile = Object.assign({}, state.profile, { name: savedName });
      writeOverlay();
      renderTicker();
      displayNameModalOpen = false;
      closeModal('display-name-modal');
      toast('Your display name is now ' + savedName + '.', 'ok');
    } catch (err) {
      if (error) {
        error.textContent = err && err.message ? err.message : 'Could not save your name. Please try again.';
        error.classList.remove('hidden');
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  function wireDisplayNameModal() {
    const form = $('#display-name-form');
    const input = $('#display-name-input');
    const useFirstName = $('#display-name-use-first');
    if (form) form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveDisplayName(input ? input.value : '');
    });
    if (useFirstName) useFirstName.addEventListener('click', () => {
      saveDisplayName(displayNameFirstName);
    });
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
    /* Phase 5: open the DM thread for this animal's most recent caretaker.
       The details modal stays open underneath - the chat modal sits above
       it, so the animal context is still visible behind the thread. */
    if (action === 'message') {
      openChat(id);
      return;
    }
    /* Own report: reopen the same form pre-filled. openEditReport() re-checks
       login AND ownership, so a forged button still gets nowhere. */
    if (action === 'edit') {
      if (state.map) state.map.closePopup();
      closeModal('details-modal');
      openEditReport(id);
      return;
    }
    if (action === 'details') {
      if (state.map) state.map.closePopup();
      openDetails(id);
      return;
    }
    /* Photo lightbox. One action name, one handler, shared by the sidebar
       card, the details-drawer thumbnail and the map-popup thumb - the same
       rule the message action follows, so the entry points can never drift. */
    if (action === 'photo') {
      openPhoto(id);
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

      /* A tap on the card body flies the map to that animal and opens its
         preview popup: the card answers "who needs help", the map answers
         "where exactly". Runs AFTER the [data-action] handler above, so the
         photo thumbnail (data-action="photo"), Feed, Water, chat, locate
         and details all keep their own behaviour   only the non-button
         part of the card navigates. */
      const animalCard = target.closest('[data-animal-card]');
      if (animalCard) {
        revealAnimal(animalCard.getAttribute('data-animal-card'));
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

    /* ---- chat (Phase 5) ------------------------------------------------ *
       Bound once here rather than per-open, because the chat markup lives
       in index.html and never gets replaced - only its contents change. */
    const chatForm = $('#chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        sendChatMessage();
      });
    }
    const chatInput = $('#chat-input');
    if (chatInput) {
      /* Enter sends, Shift+Enter breaks the line - the convention every
         chat UI uses, and the hint under the composer says so. */
      chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          sendChatMessage();
        }
      });
      /* Grow with the content, between the textarea's min-height (two rows,
         two-row default) and the max-h-32 cap in the stylesheet, then
         scroll. Resetting to 'auto' first is what makes scrollHeight
         measurable - without it the box can only ever grow, never shrink
         back after deleting text. */
      chatInput.addEventListener('input', () => {
        const MIN = 44;
        const MAX = 128;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(Math.max(chatInput.scrollHeight, MIN), MAX) + 'px';
        syncChatSendButton();
      });
    }
    const chatBlock = $('#chat-block');
    if (chatBlock) chatBlock.addEventListener('click', toggleChatBlock);
    const chatCollapse = $('#chat-collapse');
    if (chatCollapse) {
      chatCollapse.addEventListener('click', () => {
        setChatWidgetCollapsed(chatCollapse.getAttribute('aria-expanded') === 'true');
      });
    }

    /* Returning to the tab catches the thread up. Bound once here rather
       than per-open, because the listener is about the DOCUMENT, not the
       modal - and it must survive the modal closing so the inbox badge is
       already correct by the time the volunteer taps through to it. */
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', onTabVisible);
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('focus', onTabVisible);
      }
    }

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

    /* Keyboard users get the same "card = show on map" behaviour as a tap:
       Enter/Space on a focused card reveals the pin, mirroring the click
       handler below. */
    const feedHost = $('#animals-feed');
    if (feedHost) {
      feedHost.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target && event.target.closest ? event.target.closest('[data-animal-card]') : null;
        if (!card) return;
        if (event.target.closest('button')) return;
        event.preventDefault();
        revealAnimal(card.getAttribute('data-animal-card'));
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
    const locationEnableButton = $('#location-enable-btn');
    if (locationEnableButton) locationEnableButton.addEventListener('click', locateMe);
    const locationDismissButton = $('#location-dismiss-btn');
    if (locationDismissButton) locationDismissButton.addEventListener('click', () => {
      state.pendingReportOpen = false;
      hideLocationPrompt(true);
    });
    const zoomIn = $('#zoom-in');
    if (zoomIn) zoomIn.addEventListener('click', () => state.map && state.map.zoomIn());
    const zoomOut = $('#zoom-out');
    if (zoomOut) zoomOut.addEventListener('click', () => state.map && state.map.zoomOut());
    const layerButton = $('#layer-btn');
    if (layerButton) layerButton.addEventListener('click', cycleBaseLayer);
    /* Both locate controls - the desktop "Current Location" pill and the bare
       mobile my_location circle - read the same way: "take me to ME", so both
       run the real geolocation flow instead of jumping to the demo park. */
    const centerButton = $('#center-btn');
    if (centerButton) centerButton.addEventListener('click', locateMe);
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

    /* GPS-only location: there is no "Pick on map" flow any more. */

    const useMyLocationButton = $('#report-use-location');
    if (useMyLocationButton) useMyLocationButton.addEventListener('click', useMyLocationForReport);

    const reportCancel = $('#report-cancel');
    if (reportCancel) reportCancel.addEventListener('click', () => closeModal('report-modal'));

    const reportDelete = $('#report-delete');
    if (reportDelete) reportDelete.addEventListener('click', deleteThisReport);

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
      /* inbox.html and the desktop chat popover both hand a thread to the
         map as #chat=<animalId>. It goes through openChat() like the button
         does, so there is exactly one way a thread is ever opened. */
      const chatId = params.get('chat');
      if (chatId) {
        /* The id the thread is ABOUT is optional; the conversation id is the
           one that matters. Carrying it means tapping a row in the inbox
           opens THAT exact conversation instead of re-deriving the peer
           from "who fed this animal most recently", which is a different
           person half the time and produced a blank thread. */
        const conversationId = params.get('conversation') || null;
        const target = animalById(chatId);
        if (target && state.map) {
          state.map.setView([target.location.lat, target.location.lng], 16, { animate: true });
        }
        openChat(chatId, conversationId);
        /* Consume the hash. Leaving it in place means tapping the SAME row
           again navigates to the URL we are already on, which fires no
           hashchange and reopens nothing. */
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* older browsers */ }
        return;
      }
      /* cities.html hands a whole city over as #city=<name>. The sidebar
         search matches location.city, so prefilling the query filters the
         feed AND the pins in one move. The hash is deliberately KEPT: the
         URL stays shareable and a refresh keeps the city filter (the chat
         branch above consumes its hash because re-tapping a thread in the
         same session is the common case there; here navigation is fresh). */
      const city = params.get('city');
      if (city) {
        state.query = city;
        const search = $('#sidebar-search');
        if (search) search.value = city;
        renderFeed();
        renderMarkers();
        /* Fly to the first pin of that city once; if the cloud merge has not
           landed yet the filter still applies - renderFeed reruns on merge. */
        const first = selectAnimals()[0];
        if (first && state.map) {
          state.map.setView([first.animal.location.lat, first.animal.location.lng], 15, { animate: true });
        }
        toast('Showing strays in ' + city, 'info');
        return;
      }
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
      console.error('[StrayFeedingMap] dataset failed to load', err);
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
    switchMobileView(isNarrow() ? 'map' : 'list');
    initLocationPrompt();
    wireEvents();
    wireReportPhoto();
    wireDisplayNameModal();
    syncProfileFromAuth();
    /* Back from auth.html after the login gate: the guest wanted to report,
       so re-open the form   BUT only if they're actually signed in now.
       The old code re-opened unconditionally, so "Return to Map" without
       logging in looped: boot -> openReportModal -> gate fails -> redirect
       back to auth.html forever. Now we quiet-check first and drop the
       intent when the visitor is still a guest. */
    try {
      const want = sessionStorage.getItem('fta-after-login');
      if (want) {
        sessionStorage.removeItem('fta-after-login');
        window.setTimeout(async () => {
          try {
            if (!(await requireLoginForReport(true))) return;
            if (want.indexOf('edit:') === 0) openEditReport(want.slice(5));
            else openReportModal();
          } catch (e) {}
        }, 900);
      }
    } catch (e) {}
    wireDeepLink();

    // Phase 4: shared backend   anonymous auth + merge recent cloud events + live ticker
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
             pin instead of doubling up. Cloud care totals are authoritative,
             while a newer local timestamp/count preserves offline actions. */
          const merged = new Map(state.animals.map((a) => [a.id, a]));
          let added = 0;
          let changed = false;
          /* Never resurrect a report this device deleted: if the cloud row
             survived (RLS blocked, offline when deleted, policy not run), the
             pin would otherwise pop back on every reload. */
          const gone = new Set(Array.isArray(state.deletedReportIds) ? state.deletedReportIds : []);
          rows.forEach((raw) => {
            const animal = normalizeAnimal(raw, 'report');
            if (gone.has(animal.id)) {
              // Stale local copy of a deleted pin still hanging around: drop it.
              if (merged.has(animal.id)) { merged.delete(animal.id); changed = true; }
              return;
            }
            const local = merged.get(animal.id);
            if (!local) {
              merged.set(animal.id, animal);
              added += 1;
              changed = true;
              return;
            }
            const cloud = Object.assign({}, local, animal);
            const latest = (a, b) => (Date.parse(a) || 0) >= (Date.parse(b) || 0) ? a : b;
            cloud.lastFedAt = latest(local.lastFedAt, animal.lastFedAt);
            cloud.lastWateredAt = latest(local.lastWateredAt, animal.lastWateredAt);
            cloud.feedCount = Math.max(Number(local.feedCount) || 0, Number(animal.feedCount) || 0);
            cloud.waterCount = Math.max(Number(local.waterCount) || 0, Number(animal.waterCount) || 0);
            merged.set(animal.id, cloud);
            changed = true;
          });
          if (!changed) return;
          state.animals = Array.from(merged.values());
          state.fitted = true; /* the opening fit already ran; keep the camera */
          renderFeed();
          renderMarkers();
          if (added) toast(added + ' community report' + (added === 1 ? '' : 's') + ' on the map.', 'info');
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
    /* Language switch: static chrome is swapped by i18n.js, but every card,
       popup and the open drawer are rendered JS strings - re-render them so
       the whole map follows without a reload. */
    try {
      window.addEventListener('fta:lang-change', function () {
        try {
          renderFeed();
          renderTicker();
          renderMarkers();
          /* Re-open the details drawer in the new language when it is showing:
             openDetails() re-renders from scratch, and open popups rebuild via
             the bindPopup() closure on next open (Leaflet caches the node). */
          try {
            const host = document.getElementById('details-content');
            const showing = host && host.getAttribute('data-animal-id');
            if (showing && typeof openDetails === 'function') openDetails(showing);
          } catch (e) { /* ignore */ }
        } catch (e) { /* next render picks it up */ }
      });
    } catch (e) { /* ignore */ }
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
      /* Phase 5 chat: the bubble renderer is pure, so check-chat.js can
         assert escaping and left/right alignment without a DOM. */
      chatBubble: chatBubble,
      chatTime: chatTime,
      chatDayLabel: chatDayLabel,
      chatReceipt: chatReceipt,
      isGroupedWith: isGroupedWith,
      chatValidate: (raw) => {
        const text = String(raw === null || raw === undefined ? '' : raw).trim();
        if (!text) return 'Write a message first.';
        if (text.length > CHAT_MAX) return 'Keep messages under ' + CHAT_MAX + ' characters.';
        return null;
      },
      setPolicy: (policy) => {
        POLICY = Object.assign({ default: { food: { okHours: 8, urgentHours: 14 }, water: { okHours: 6, urgentHours: 10 } } }, policy || {});
      },
      slugifyCity: slugifyCity,
      geoGridKey: geoGridKey,
      matchesQuery: matchesQuery
    };
  }
}());
