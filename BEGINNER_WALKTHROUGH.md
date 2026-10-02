# FeedTheAnimalsMap - Full Walkthrough for Beginners

You have a working stray-animal map. No build, no npm needed to run it.
Just files + CDN. This doc explains everything in order.

## 1. What you actually have (5 files that matter)
- index.html = layout: header, sidebar (search, chips, feed, ticker), map div, report modal, toasts
- index.js = ALL logic: loads data, draws Leaflet map + pins, sidebar cards, feed/water, reports, ticker
- data/animals.json = source of truth (48 animals, 6 stations, meta). Edit this, nothing else.
- data/animals-data.js = auto copy for file:// double-click mode. Never edit by hand.
- tools/build-data.js + selftest.js + check-markup.js = validators

Ignore reference/ (old mockup).

## 2. Install once (10 min)
1. Install VS Code + Node.js LTS (node -v should work)
2. Open folder: File > Open Folder > FeedTheAnimalsMap
3. Install Live Server extension OR use npx serve .

## 3. Run it (2 min)
Option A (best): npx serve . -> open http://localhost:3000
Option B: VS Code > right-click index.html > Open with Live Server
Option C: double-click index.html (works via fallback, but geolocation fails)

You should see: left list (48 cards), right map (Seattle), clusters, ticker.

## 4. How it boots (read this once)
boot() in index.js bottom:
1. readOverlay() = load localStorage fta.overlay.v1 (your feeds)
2. loadDataset() = fetch data/animals.json (or embedded fallback)
3. hydrate() = relative MinutesAgo -> absolute ISO dates + merge reports + applyUserLog()
4. initMap() = L.map minZoom 2 maxZoom 20 + base layer + clusters
5. renderChips/feed/ticker/markers + wireEvents() (all clicks)

Data flow: animals.json -> normalizeAnimal() -> computeStatus() -> selectAnimals() (filter/search/sort) -> renderFeed() + animalMarker().

## 5. Try these 5 clicks (do now)
1. Search test: type milo -> Enter jumps to pin
2. Chips: All 48 / Cats 28 / Dogs 16 / Needs Help 12
3. Feed: open Milo popup > Feed -> pin turns green, ticker adds You, reload keeps it (localStorage)
4. Near Me: click Near Me > Allow location > distances re-sort + blue dot + flyTo 16
5. Report: + Report a Stray > Pick on map > click map > Submit > new pin appears

## 6. How to edit safely
- Add animal: edit data/animals.json animals[] (unique id, lat/lng near center, caretakers/tags/notes, health in 4 values) -> run node tools/build-data.js -> node tools/selftest.js
- Map start: meta.center + defaultZoom 15, minZoom 2 in index.js initMap()
- Tiles: meta.tileLayers (light, streets, google-streets, google-satellite). Layers button cycles.
- Urgency: meta.urgencyPolicy cat/dog/rabbit/bird/guinea-pig food/water okHours/urgentHours
- Reset demo: button clears localStorage fta.overlay.v1

Counts must stay 48/28/16/12-needs-help or selftest fails - that's expected.

## 7. Where backend fits (next stage)
Right now writes = localStorage only. Next: Supabase replaces that.
See START_TO_FINISH_SIMPLE.md STAGE 2-5. Keep animals.json as fallback.
