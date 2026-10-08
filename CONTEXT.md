# FeedAnAnimalMap — AI Context

> Paste this file (or link it) when asking any AI for help. Source of truth for what the site is, looks like, and how it works.

## 1. One-liner

`FeedAnAnimalMap` (repo `FeedTheAnimalsMap`, GitHub `Elyas575/FeedAnAnimal`, Supabase `Feed-Animals` in `eu-west-1`, static on Cloudflare Workers) is a **crowdsourced community map for feeding stray animals**.

Purpose: **No stray should go hungry — find nearby animals and log every meal.** One shared live log of who ate, who needs help, and where.

Taglines: `find, feed and water local street animals` / `Feed well. Help others feed well.`

## 2. Look + layout

- Theme: bg cream `#fff8f6`, cards `#fff`, accent burnt-orange `#a03b0e` (hover `#c15326`), browns `#8b7269` / `#57423b`, borders `#efe6e4`.
- Fonts: `Plus Jakarta Sans` + `Inter` + `Material Symbols Outlined`. Paw favicon (orange circle + paw, inline SVG).
- Top navbar from ONE file (`site-header.js` -> `div#site-header`): Map, Cities (`cities.html`), Community, Activity, Chats (badge + popover, `inbox.html`), About, auth avatar. Active pill from `location.pathname`.
- Mobile bottom bar: Cities, Community, center List/Map pill, Activity, Chats.
- Desktop `index.html`: Leaflet map (right) + volunteer sidebar (left). Phones: full map + bottom sheet.
- Map: `Leaflet 1.9.4 + markercluster 1.5.3`, Google Streets default / Satellite / CARTO Light / OSM. Custom divIcon pins: photo or emoji, ring green ok / orange needs refill / red urgent, `empty Nh` badge, name label. Clusters break on zoom. Blue visitor dot + scale.
- Popup: status dot + kicker, distance, photo, sex/age, food/water meters, notes, station + feed count, coords + Copy + Google directions, Feed / Water / Details / Chat buttons.
- Modals: details drawer (z-75), chat DM (z-85), report form (docks bottom so map clickable), photo lightbox.

## 3. Architecture

- Static frontend: HTML + Tailwind Play CDN + vanilla JS IIFEs, no build. Pins/popups use plain CSS so they render before CDN JIT.
- Backend: Supabase via `supabase-client.js` (publishable key only), `https://wtmcviupbcmcffamyslb.supabase.co`. Hosting: Cloudflare Workers (`wrangler.jsonc`, `feedananimal`).
- Local-first: if Supabase missing/paused, `sb*` wrappers return `null`/`[]` and app works on `localStorage` (`fta.overlay.v1`, `fta-forum-*`) + `data/animals.json` (+ `data/animals-data.js` for `file://`). Never white-screens.
- Realtime: `sbLiveTicker` (events INSERT) + `sbSubscribeDm` (`dm:<id>`, messages INSERT filter). Unsubscribe on close.
- Photos: `sbCompressImage` -> ~70-100KB webp, then `sbUploadReportPhoto` to public `animal-photos` at `reports/<time>-<rand>.<ext>`.

## 4. Pages

- `index.html` (+ `index.js` ~3600 lines): core map + sidebar + report + details + chat. Deep links: `#animal=<id>`, `#station=<id>`, `#chat=<animal>&conversation=<id>`, `#city=<name>` (prefills sidebar search + flies to the city). Search matches name/city/country/area/notes/caretakers/tags.
- `cities.html`: live city directory. Groups seed + local + cloud reports (`sbLoadReports(200)`) by `location.citySlug|country`, needs-help counts via `meta.urgencyPolicy`, search + sort chips (Most strays / Needs help / Near me / A–Z). Cards link to `index.html#city=<name>`.
- `community.html` (+ `community.js` + `forum.js`): leaderboard ladder + Wakie-style forum (composer, sort Newest/Active/Liked, thread, replies, likes).
- `activity.html`: live feed = local (`fta.overlay.v1`) + cloud (`sbLoadRecentEvents(100)`). Search + kind filter + chips All/Mine/Live/This device. Newest 200.
- `inbox.html` (+ `inbox.js`): all DM threads, unread first. Rows are `<button data-conversation data-animal>` -> map.
- `auth.html`: password/Google sign-in (magic link removed) + anon auth. Feed works anon, chat needs real email (`sbRequireEmail`, `sbEnsureAuth` auto-anon otherwise).
- `about.html`, `privacy.html`, `terms.html`, `404.html`: static, same header.

## 5. What users can do

1. Browse: chips `All 48 / Cats 28 / Dogs 16 / Needs Help 12`, sort Urgent / Closest (haversine) / Recently Fed, debounced search name/area/notes/caretakers/tags. Enter flies to hit, Esc clears.
2. Near Me: Geolocation flies map + re-measures distance; Reset to `47.671236,-122.343184` (Seattle demo: Oakwood Park & West End).
3. Log care 1-tap: Feed/Water updates times, counts, pin colour, ticker (9s rotate), writes local + Supabase `events` for points.
4. Report Stray: pin-drop or GPS, species, needs flags as `[NEEDS_*]` prefix in `reports.description` (strip vet->water->food on load), photo compress+upload, nearest station, instant + shared (`sbSubmitReport` / `sbLoadReports(200)`). City/country auto-detected via BigDataCloud reverse-geocode (cached per ~1km grid in `fta.geo.v1`, never blocks submit) into `reports.city/country/city_slug` — run `supabase/migration-report-city.sql` once. Editing is reporter-only: `openEditReport()` reopens the same form (photo replace/remove, name, species, description, needs, location) and saves through `sbUpdateReport` + RLS policy `reporter update reports` — run `supabase/migration-report-edit.sql` once. Popup content is built at open time (`bindPopup(() => popupHtml(row))`) so the Edit button appears as soon as auth resolves `state.myId`.
5. Details: profile, health/sterilized/vaccinated flags, device history, log vet/medicine/rescue.
6. Stations: 6 stations, log check/refill raises capacity.
7. Points: feed 10 / water 8 / station 12 / medicine 18 / vet 20 / report 25 / rescue 30 (Postgres `schema-leaderboard.sql` + `community.js`). Tiers Stray 0, Scout 100, Feeder 250, Carer 500, Guardian 900, Angel 1500, Saint 2500, Legend 4000.
8. Forum: title 140 + body 4000, reply 2000, likes. Local-first, shared after `supabase/schema-forum.sql`.

## 6. Data model

- `data/animals.json`: `{ meta: { center, tileLayers, urgencyPolicy, species }, animals: [{ id, name, species, sex, ageClass, description, health, sterilized/vaccinated/microchipped, caretakers[], tags[], notes, photoUrl|null, stationId, location:{label,area,lat,lng}, lastFedMinutesAgo, lastWateredMinutesAgo, feedCount, waterCount, reportedDaysAgo }], stations[6], activity[] }`. Times are relative offsets (never stale), converted to absolute ISO in memory.
- Supabase: `reports (reporter_id,lat,lng,location_label,photo_url,species,name,city,country,city_slug,description)`, `events (actor_name,kind,note,place,animal_id,station_id)`, `topics/replies/likes`, `conversations/participants/messages/blocks/profiles`. See `supabase/*.sql`.
- Counts: 48 animals — 28 cats, 16 dogs, 4 small pets — 12 needing help. After editing JSON run `node tools/build-data.js` to refresh `data/animals-data.js`.

## 7. Key files + commands

- `index.js` (pure geo/time/urgency exported for selftest), `supabase-client.js` (~1100 lines, ALL cloud via `window.sb*`), `site-header.js` (`LINKS`/`BOTTOM_TABS`), `community.js`, `forum.js`, `inbox.js`, `tailwind-theme.js`, `supabase/*.sql`, `tools/*.js`, `wrangler.jsonc`.
- `npx serve .` (http for fetch; file:// falls back to animals-data.js). `npm test` runs all checks.
- Conventions: IIFE + use strict, esc() all HTML, module.exports guard for Node, no secrets in frontend, keep map attributions, header single-source.
- Free limits: 50k MAU, 5GB egress (hits first), 500MB DB, 1GB storage/logs, nano CPU (60 direct / 200 pooler), pause after 7d idle -> local-only. Workers Free ~100k req/day.

## 8. Plain English

> Like Google Maps but only for stray cats and dogs. See pins colored by hunger, tap one, walk there, tap Feed, everyone sees it is fed. Found a stray? Drop pin, add photo, goes live. Earn points/ranks, ask in forum, DM about animals.

## 9. Chat detail (bottleneck)

Animal -> caretaker via `get_or_create_dm`, newest 100 reversed, send 2000 chars with sender_id=auth.uid() (RLS), block via blocks upsert, unread from last_read_at. Inbox is N+1 (convos + participants + profiles + up to 50x25 msgs) — paginate to 10 if scaling.


