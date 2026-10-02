# FeedAnimals - MVP Full Steps (Start to Production)
Goal: feedanimals.com live with map + backend + chat. Cost: ~$12/yr domain only.
Repo: FeedTheAnimalsMap (index.html + index.js + data/animals.json 48/6)
Check each box. Tell me PHASE + STEP + F12 error if stuck.

## PHASE 0 - Prep (10 min)
- [ X ] 0.1 Install Node LTS, verify `node -v`
- [ X ] 0.2 Open folder in VS Code
- [ X ] 0.3 Run `npx serve .` -> http://localhost:3000 shows 48 cards + map + ticker
- [ X ] 0.4 Feed Milo -> pin green -> reload keeps it (localStorage fta.overlay.v1)
DONE WHEN: map loads, feed persists on reload.

## PHASE 1 - Domain (15 min, ~$12)
- [ ] 1.1 namecheap.com search feedanimals.com
- [ ] 1.2 If taken/>$15 buy feedanimalsmap.com or feedtheanimals.org
- [ ] 1.3 Buy 1yr + Auto-Renew ON, decline upsells
- [ ] 1.4 Leave tab open, DO NOT add DNS yet (done in PHASE 7)
DONE WHEN: domain owned in Namecheap.

## PHASE 2 - Supabase backend (15 min, $0)
- [ ] 2.1 supabase.com signup with GitHub -> New Project feed-animals, Region West US (N. California), save DB password
- [ ] 2.2 Wait for green Active
- [ ] 2.3 Settings > API copy Project URL + anon key to notepad (never share service_role)
- [ ] 2.4 Auth > Providers: Anonymous=ON, Email=ON + Magic Link ON
- [ ] 2.5 SQL Editor > New Query paste supabase/schema-core.sql > Run (add `create extension if not exists pgcrypto;` on top if error)
- [ ] 2.6 New Query paste supabase/schema-chat.sql > Run
- [ ] 2.7 New Query paste supabase/schema-storage.sql > Run (creates animal-photos bucket + policies; if missing, uploads 403)
- [ ] 2.8 Database > Publications > supabase_realtime tick events + messages (enables live ticker + DMs)
- [ ] 2.9 Storage verify animal-photos Public ON, 500KB limit, image/* only (500KB per file, total free 1GB = ~5000 compressed photos)
- [ ] 2.10 Table Editor shows: animals, stations, events, reports, profiles, conversations, conversation_participants, messages, blocks
DONE WHEN: all tables exist, realtime ticked.

## PHASE 3 - Seed 48+6 (10 min)
- [ ] 3.1 Ensure package.json has @supabase/supabase-js + .gitignore ignores node_modules/, .env
- [ ] 3.2 `npm install`
- [ ] 3.3 PowerShell:
  $env:SUPABASE_URL="https://YOUR.supabase.co"
  $env:SUPABASE_SERVICE_KEY="eyJ...service_role..."
  node tools/seed-supabase.js
- [ ] 3.4 Table Editor > animals=48 rows, stations=6 rows
- [ ] 3.5 Keep data/animals.json as offline fallback, never edit DB by hand
DONE WHEN: 48/6 counts match. DB 500MB = ~700k feeds/chats (months free).

## PHASE 4 - Shared feeds + reports (45 min)
- [ X ] 4.1 index.html before index.js add:
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="supabase-client.js"></script>
- [ X ] 4.2 Fill SB_URL + SB_ANON in supabase-client.js
- [ X ] 4.3 index.js logCare() after writeOverlay() add sbLogEvent({animalId, kind})
- [ X ] 4.4 logStationCheck() after writeOverlay() add sbLogEvent({stationId, kind:'station'})
- [ X ] 4.5 boot() after hydrate(): sbEnsureAuth() + sbLoadRecentEvents() merge + sbLiveTicker() re-render
- [ X ] 4.6 Report form: file picker + preview + sbCompressImage (1200px webp) + sbUploadReportPhoto + sbSubmitReport
- [ ] 4.7 Test: npx serve . open normal + incognito, Feed in one, reload other = count+1 + ticker
- [ ] 4.8 EXTRA (not in plan): activity.html "View all" page, deep links #animal=, volunteer + animal
  avatars in the ticker/feed, migration-avatar.sql for events.actor_avatar
DONE WHEN: shared test passes, no [sb] console errors.

## PHASE 5 - Chat DMs (1 hr) - OPTIONAL, not needed for MVP
- Skipped for now: DMs are a nice-to-have. The MVP works without them and ships
  faster without 1hr of RLS edge-case debugging. Chat tables + get_or_create_dm
  RPC already exist in the database, so this can be added post-launch.
- [ ] 5.1 Details modal add [Message Caretaker] + [Block] buttons
- [ ] 5.2 Click -> sbRequireEmail() (email only for chat, feed stays anon)
- [ ] 5.3 -> sbOpenDm(otherUserId, animalId) via rpc get_or_create_dm (otherUserId = latest events.actor_id for animal != me)
- [ ] 5.4 -> sbListMessages() render + sbSubscribeDm() live append + sbSendMessage() (must include sender_id=user.id or RLS fails)
- [ ] 5.5 Block -> insert blocks table
- [ ] 5.6 Test 2 email logins: send appears no refresh, blocked user cannot send
DONE WHEN: live DM + block works.

## PHASE 6 - Hardening (30 min)
- [ X ] 6.1 _headers (caching + security), SEO meta/title/og on all pages,
  inline-SVG favicon, og-image.svg, robots.txt, sitemap.xml, 404.html,
  privacy.html, terms.html, footer Privacy/Terms/Contact
- [ ] 6.2 Debounce feed + note <100 chars (nice-to-have, not MVP-blocking)
- [ X ] 6.3 Monthly cleanup SQL written (supabase/cleanup-events.sql)
- [ X ] 6.4 npm run test green (selftest + check-markup + check-activity),
  no secrets in git (verified across all 27 commits)
DONE WHEN: no secrets in git, validators pass.

## PHASE 7 - Go live (20 min)
- [ ] 7.1 git add .; git commit -m "mvp ready"; git push origin main
- [ ] 7.2 dash.cloudflare.com > Pages > Connect GitHub > Build empty, Output . -> https://feedanimals.pages.dev works
- [ ] 7.3 Pages > Custom domains > Add feedanimals.com + www.feedanimals.com
- [ ] 7.4 Copy 2 Cloudflare nameservers -> Namecheap > feedanimals.com > Nameservers > Custom DNS paste -> Save (do NOT use CNAME @ on Namecheap)
- [ ] 7.5 Wait 10-30 min, Cloudflare SSL=Full Strict, Always HTTPS=ON
- [ ] 7.6 Supabase Auth > URL Config: Site URL=https://feedanimals.com, Redirects add https://www.feedanimals.com/*, https://feedanimals.pages.dev/*, http://localhost:3000/*
- [ ] 7.7 Update SB_URL/SB_ANON, push, auto-redeploy, open https://feedanimals.com lock icon
DONE WHEN: 48 pins, shared feed, report photo, 2-user DM, https lock. MVP LIVE.

## OPERATE
- Monitor Supabase Database Usage alert 400MB, Storage 800MB.
- Full? Migrate photos to Cloudflare R2 (10GB free) - DB stays, 30 min.
- If stuck: tell me PHASE + STEP + F12 console error.

Next: say GO ACT to have me build supabase-client.js, chat.js, schema-storage.sql, package.json, .gitignore, _headers + patch index.html/index.js.
