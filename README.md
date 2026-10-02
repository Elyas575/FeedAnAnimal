# FeedAnAnimalMap

A working stray-animal feeding map for Oakwood Park & West End (Seattle, WA).
The site started life as a static design mockup: hardcoded cards, a map that was
really just a background photo, fake cluster numbers and an empty `index.js`.
It now loads a real dataset, renders a real interactive map and stores what the
visitor does.

## Quick start

```bash
# option 1 - any static server (recommended, loads data/animals.json over http)
npx serve .
#   -> http://localhost:3000

# option 2 - just double-click index.html
#   works too: index.js falls back to data/animals-data.js because browsers
#   block fetch() on file:// URLs

# option 3 - VS Code Live Server extension: "Open with Live Server"
```

No API keys, no build step, no package.json. Everything runs from CDN assets
(Tailwind Play CDN, Leaflet, Google Fonts, Material Symbols).

## What now works

**Real map (Leaflet 1.9 + Google tiles, no API key)**
- Live slippy map centered on the dataset's coordinates, with a real map centre
  from `meta.center` (47.671236, -122.343184) and 10-20 zoom.
- Four switchable base maps from `meta.tileLayers`: Google Streets (default),
  Google Satellite, CARTO Light and OSM Streets (the layers button cycles them,
  the label shows the active one). Google tiles are free for light dev use but
  are governed by Google's Terms of Service - add billing / an API key for
  production traffic.
- Marker clustering (`leaflet.markercluster`) with brand-styled cluster bubbles
  that break apart as you zoom in.
- Custom pins per animal showing photo/emoji, urgency ring, an "empty for Nh"
  badge and the name label - green fed, orange needs a refill, red urgent.
- Individual preview popups with food/water meters, handling notes, feed/water
  buttons, a details button and a Google Maps walking-directions link.
- Separate station pins for the six community feeding stations, a visitor
  location dot and metric scale control.

**Sidebar feed driven by data**
- Every card is rendered from `data/animals.json` (photos, breed, distance,
  status line, station, actions) instead of being hardcoded.
- Filter chips recompute from the data: All 48, Cats 28, Dogs 16, plus the other
  rescued species, plus "Needs Help 12".
- Sorting by Most Urgent (scored), Closest (haversine) and Recently Fed.
- Debounced search across name, breed, colour, area, landmark, notes, caretakers
  and tags; Enter jumps to the first hit on the map, Escape clears it.
- Live activity ticker merges the seeded community log with your own actions and
  rotates every 9 seconds.

**Volunteer actions that persist**
- "Feed"/"Water" one-tap logging updates `lastFedAt`/`lastWateredAt`, feed counts,
  the pin colour, the filter counters and the activity ticker, then writes to
  `localStorage` (`fta.overlay.v1`) so it survives a reload.
- "Near Me" uses the browser Geolocation API and re-measures every distance from
  where you actually are; "reset" returns to the park centre.
- "+ Report a Stray" opens a full form. You can drop the pin on the map (the
  modal docks to the bottom so the map is clickable) or use your GPS position.
  The photo is compressed in the browser before upload. Reports are saved
  locally, appear on the map immediately, get assigned to the nearest feeding
  station, and are shared with other volunteers through Supabase.
- Details drawer with the full profile, health/sterilisation flags, care history
  from this device and shortcuts to log a feed, water or vet check.
- Station popups let you log a container check, which raises the capacity level
  and is remembered on reload.
- Toasts, keyboard <kbd>Esc</kbd> handling, backdrop-click closing and a
  list/map toggle on phones.
- `restart_alt` clears the local demo changes.

When the urgency is computed the app uses per-species thresholds from the data
file, e.g. a cat is fine up to 8h without food (`needs` until 14h, then
`urgent`); a dog gets 10h/16h. Anything past its "ok" window - or marked
`treatment`/`critical` - lands in "Needs Help".

## Project layout

```
index.html                  built page: design system + app shell + Leaflet
index.js                    app logic (~1500 lines, plain script, no bundler)
data/animals.json           the dataset - single source of truth
data/animals-data.js        generated embedded copy, used on file://
reference/index.mockup.html the original static mockup, kept untouched
tools/build-data.js         validates animals.json + regenerates the embedded copy
tools/selftest.js           Node assertions for the geo/time/urgency logic
tools/check-markup.js       asserts index.html and index.js stay in sync
```

## Commands

```bash
node tools/build-data.js     # validate the dataset, then regenerate data/animals-data.js
node tools/selftest.js       # 55 assertions against the real data file
node tools/check-markup.js   # ids, delegated hooks, assets, embedded-data freshness
node --check index.js        # syntax check
```

Run `build-data.js` after every data edit - it fails loudly on duplicate ids,
out-of-range coordinates, unknown stations, bad tile URLs, missing fields, or if
the All/Cats/Dogs/Others/Needs-Help counters no longer match the design.
`check-markup.js` is the guard for edits to `index.html`/`index.js`: it makes sure
every id and delegated `data-*` hook the script depends on still exists.

## The dataset (`data/animals.json`)

One document with four top-level keys.

```jsonc
{
  "meta": {
    "version": 1,
    "city": "Seattle, WA",
    "region": "Oakwood Park & West End",
    "center": { "lat": 47.671236, "lng": -122.343184 }, // map start + distance origin
    "defaultZoom": 15,
    "maxZoom": 19,
    "volunteersActive": 14,          // "Live Community Watch" pill
    "timeModel": "relative",         // see below
    "urgencyPolicy": {               // per species, in hours
      "cat": { "food": { "okHours": 8,  "urgentHours": 14 }, "water": { "okHours": 6,  "urgentHours": 10 } },
      "dog": { "food": { "okHours": 10, "urgentHours": 16 }, "water": { "okHours": 8,  "urgentHours": 12 } },
      "rabbit": { … }, "bird": { … }, "guinea-pig": { … },
      "default": { … }               // fallback for any new species
    },
    "speciesCatalog": [ { "id": "cat", "label": "Cats", "singular": "Cat", "emoji": "🐱" }, … ],
    "activityKinds": ["feed", "water", "report", "rescue", "medicine", "station"],
    "tileLayers": [ { "id": "light", "label": "Light", "url": "https://…/{z}/{x}/{y}{r}.png",
                      "attribution": "…", "subdomains": "abcd", "maxZoom": 20 }, … ]
  },
  "stations": [ { "id": "station-04", "name": "Station #04 - Pine Grove", "ref": "Feeding station 4, Pine Grove",
                  "type": "auto-dispenser", "status": "Auto-dispenser active", "capacityPct": 72,
                  "caretaker": "Priya N.", "notes": "…", "lastServicedMinutesAgo": 180,
                  "location": { "label": …, "area": …, "lat": …, "lng": … } } ],
  "animals": [ { "id": "milo", "name": "Milo", "species": "cat", "breed": "Orange Tabby",
                 "sex": "male", "ageClass": "adult", "color": "Ginger with white mittens",
                 "description": "…", "temperament": "friendly",
                 "health": "healthy",                    // healthy | monitor | treatment | critical
                 "sterilized": true, "vaccinated": true, "microchipped": false,
                 "caretakers": ["Alex R.", "Priya N."], "tags": ["bench-sleeper"],
                 "notes": "Follows you to the kiosk…", "photoUrl": "https://… or null",
                 "stationId": "station-01",
                 "location": { "label": "Bench 4, West Rose Garden", "area": "West Rose Garden",
                               "lat": 47.671126, "lng": -122.338513 },
                 "lastFedMinutesAgo": 540, "lastWateredMinutesAgo": 60,
                 "feedCount": 412, "waterCount": 268, "reportedDaysAgo": 38 } ],
  "activity": [ { "id": "act-01", "minutesAgo": 35, "actor": "Alex R.", "kind": "feed",
                  "animalId": "milo", "note": "fed Milo with warm broth & kibble",
                  "place": "Oakwood Park West Trail" } ]
}
```

### Why the time fields are relative

`lastFedMinutesAgo`, `lastWateredMinutesAgo`, `reportedDaysAgo` and
`activity[].minutesAgo` are offsets from the moment the page loads, not fixed
dates. That is deliberate: the snapshot never goes stale, so "Milo needs food -
empty 9h ago" is still true next month. `index.js` converts them to absolute ISO
timestamps in memory (`animal.lastFedAt`, station `lastServicedAt`,
`activity[].at`) and everything else - the UI, the sorting, the localStorage log -
works with absolute times, exactly like a real backend would.

### Adding or editing an animal

1. Add a record to `animals` (unique `id`, real `location.lat`/`lng`, non-empty
   `caretakers`/`tags`/`notes`, `health` from the four allowed values).
2. Run `node tools/build-data.js` - it validates everything and refreshes
   `data/animals-data.js`.
3. Run `node tools/selftest.js` if you touched thresholds or counts.

Counts asserted by the validator: **48 animals - 28 cats, 16 dogs, 4 rescued
small pets - with exactly 12 needing help**, which is what the filter chips show.
Photos are optional (`photoUrl: null` renders a species avatar instead); the three
mockup photos were kept for Milo, Barnaby and Luna.

## Map providers and licensing

| Layer | Provider | Notes |
| --- | --- | --- |
| Google Streets | `mt*.google.com/vt/lyrs=m` | default; no key needed for light use, Google ToS applies |
| Google Satellite | `mt*.google.com/vt/lyrs=s,h` | labels + imagery, attribution kept on the map |
| Light | CARTO `light_all` basemaps | free for non-commercial/dev use, attribution kept |
| Streets | `tile.openstreetmap.org` | OSM tile usage policy applies (no bulk scraping) |

All attributions are rendered by Leaflet's attribution control - keep them if you
swap tiles. To use Mapbox instead, replace the `tileLayers` URLs
(Mapbox needs its access token appended to the URL) or, if you get a Google
Maps API key, swap `initMap()` for the Google Maps JS API; `index.js` only depends on `L.marker`, `L.divIcon`,
`L.tileLayer` and `L.markerClusterGroup`.

## Known limitations

- **No backend.** Feeds, water top-ups and reports are stored in this browser's
  `localStorage` (`fta.overlay.v1`). Two visitors do not see each other's
  actions, and clearing site data resets everything. Swapping `loadDataset()` and
  the write in `writeOverlay()` for real API calls is the natural next step.
- **CDN dependency.** Tailwind, Leaflet and the map tiles need internet access.
  If the tiles never load, check the console: the app degrades to a message in
  the map area but the sidebar keeps working.
- **Photo coverage.** Only the three original animals ship with photos; the rest
  render a species avatar tile.
- `reference/index.mockup.html` is the untouched original, kept for comparison.


- Photos, stations and activity entries all come from the JSON file, so the whole
  demo can be re-skinned by editing data instead of markup.

