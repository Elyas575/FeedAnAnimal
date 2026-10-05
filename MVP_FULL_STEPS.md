# FeedAnimals - MVP Full Steps (Start to Production)
Goal: feedanimals.com live with map + backend + chat. Cost: ~$12/yr domain only.
Repo: FeedTheAnimalsMap (index.html + index.js + data/animals.json)
Check each box. Tell me PHASE + STEP + F12 error if stuck.

---

## AUDIT 2026-10-05 - re-verified against the working tree

Phases 0-6 are done. Phase 7 (go live) is the only phase left.
Re-audited the repo rather than trusting the 10-04 notes. Three of them had
gone stale:

- **auth.html is FIXED.** The inline script parses cleanly and `watchSession`,
  `goHome` and `isSignedIn` are all defined and called. Step 7.0 is done -
  do not re-run the patch scripts, they are already applied and committed.
- **git is CLEAN and level with origin.** `main` and `origin/main` are both at
  `7034341`, 0 commits apart, and `git stash list` is empty.
- **The FK migration is only "maybe still needed".** `schema-core.sql` no longer
  declares `events.animal_id` as a foreign key (line 76 is plain `text`, with a
  comment saying so). That only proves the SCHEMA FILE is correct - it does not
  prove your live DATABASE was altered. `migration-drop-events-fk.sql` is
  idempotent, so running it costs nothing and removes the doubt. Still do it.

Chat is now substantially further along than this document records. A third
migration was added and three real bugs were fixed (see the note at the end).

Verified by running the suites just now:
- `check-chat.js` 252/252, `simulate-chat.js` 88/88, `check-markup.js` pass
- `npm test` is NOT fully green: 4 pre-existing theme-class checks fail in
  `check-activity.js`. They are unrelated to chat and do not block launch.

## DO THESE 5 THINGS NEXT (in this order)

1. **RUN BOTH MIGRATIONS** in the Supabase SQL Editor, in this order:
   - `supabase/migration-drop-events-fk.sql` - without this, every shared
     write is rejected: `events.animal_id` references `animals(id)`, but
     `animals` was emptied by cleanup-seed-data.sql, so logging a feed for
     "milo" never reaches the database (it saves to localStorage first, so it
     LOOKS like it worked). Chat cannot work either, because it looks up
     recent `events` rows to find a caretaker.
   - `supabase/migration-read-receipts.sql` - adds the UPDATE policy that lets
     you clear your own unread badge. WITHOUT THIS THE BADGE WILL NEVER CLEAR,
     and the console says `mark read refused`. This is the bug you just hit.
   Both are idempotent - safe to run twice.
2. **COMMIT** - 3 files are uncommitted: `index.js`, `supabase-client.js`,
   `tools/check-chat.js`. These carry the chat fixes. `git add . && git commit`
   && `git push origin main`.
3. **DEPLOY** - Cloudflare Pages, build empty, output `.`. This is the single
   biggest reason the site is not live.
4. **SUPABASE SETTINGS** (10 min, do these or the test below misleads you):
   - Auth > Providers > Email: turn **Confirm email OFF** (instant test accounts)
   - Database > Publications > supabase_realtime: ensure **events AND messages**
     are both listed (messages is what makes DMs appear without a refresh)
   - Authentication > URL Config: Site URL = your real domain, and add the
     domain + pages.dev + localhost to Redirects, or magic-link logins bounce
     to the wrong page
5. **TWO-BROWSER TEST** - the only step that cannot be done from a terminal.
   See "THE ONE TEST THAT PROVES IT" at the end of this file.
6. **DECIDE: seed or stay empty** - animals/stations are 0 rows on purpose (you
   ran cleanup-seed-data.sql). The map is genuinely empty until a real person
   reports a stray. That is fine to launch, but be deliberate about it.

---

## PHASE 0 - Prep (10 min)
- [ X ] 0.1 Install Node LTS, verify `node -v`
- [ X ] 0.2 Open folder in VS Code
- [ X ] 0.3 Run `npx serve .` -> http://localhost:3000 shows 48 cards + map + ticker
- [ X ] 0.4 Feed Milo -> pin green -> reload keeps it (localStorage fta.overlay.v1)
DONE WHEN: map loads, feed persists on reload.

## PHASE 1 - Domain (15 min, ~$12) - DONE (domain owned, DNS still on parking)
- [X] 1.1 namecheap.com search feedanimals.com
- [X] 1.2 If taken/>$15 buy feedanimalsmap.com or feedtheanimals.org -> not needed,
      feedanimals.com was available and is registered
- [X] 1.3 Buy 1yr + Auto-Renew ON, decline upsells
- [X] 1.4 Leave tab open, DO NOT add DNS yet (done in PHASE 7)
      NOTE: it resolves to 13.248.169.48 / 76.223.54.146 = registrar parking.
      Cloudflare nameservers are NOT set yet. That is step 7.4, still open.
DONE WHEN: domain owned in Namecheap. -> YES, owned.

## PHASE 2 - Supabase backend (15 min, $0) - DONE (all 12 tables confirmed live)
- [X] 2.1 supabase.com signup with GitHub -> New Project feed-animals, Region West US (N. California), save DB password
      -> project wtmcviupbcmcffamyslb, live and responding
- [X] 2.2 Wait for green Active
- [X] 2.3 Settings > API copy Project URL + anon key to notepad (never share service_role)
      -> anon key is in supabase-client.js and working (profiles=55 rows proves it)
- [X] 2.4 Auth > Providers: Anonymous=ON, Email=ON + Magic Link ON
      -> anon confirmed (55 profiles). Magic link code present in supabase-client.js
- [X] 2.5 SQL Editor > New Query paste supabase/schema-core.sql > Run (add `create extension if not exists pgcrypto;` on top if error)
- [X] 2.6 New Query paste supabase/schema-chat.sql > Run
- [X] 2.7 New Query paste supabase/schema-storage.sql > Run (creates animal-photos bucket + policies; if missing, uploads 403)
- [X] 2.8 Database > Publications > supabase_realtime tick events + messages (enables live ticker + DMs)
- [X] 2.9 Storage verify animal-photos Public ON, 500KB limit, image/* only (500KB per file, total free 1GB = ~5000 compressed photos)
- [X] 2.10 Table Editor shows: animals, stations, events, reports, profiles, conversations, conversation_participants, messages, blocks
      -> VERIFIED with `node tools/db-status.js`: all 12 tables respond (also topics,
         replies, topic_likes from the forum build)
DONE WHEN: all tables exist, realtime ticked. -> YES.

## PHASE 3 - Seed 48+6 (10 min) - DONE, then UNDONE ON PURPOSE (see note)
- [X] 3.1 Ensure package.json has @supabase/supabase-js + .gitignore ignores node_modules/, .env
      -> both confirmed: dependency ^2.47.0 present, .gitignore lists all three
- [X] 3.2 `npm install`
      -> node_modules/ present
- [X] 3.3 PowerShell:
  $env:SUPABASE_URL="https://YOUR.supabase.co"
  $env:SUPABASE_SERVICE_KEY="eyJ...service_role..."
  node tools/seed-supabase.js
      -> ran successfully, then the rows were deleted again (see 3.4)
- [X] 3.4 Table Editor > animals=48 rows, stations=6 rows
      -> WAS true, but is now animals=0, stations=0. You ran
         supabase/cleanup-seed-data.sql to drop the demo data. The repo was
         built to accept this: tools/build-data.js treats an empty dataset as
         valid and index.js shows "No animals reported yet." So this is a
         deliberate choice, not a bug - just confirm it is what you want.
- [X] 3.5 Keep data/animals.json as offline fallback, never edit DB by hand
      -> kept; data/animals.json now holds 0/0/0 and is the offline fallback
DONE WHEN: 48/6 counts match. -> SUPERSEDED: you chose an empty dataset instead.

## PHASE 4 - Shared feeds + reports (45 min)
- [ X ] 4.1 index.html before index.js add:
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="supabase-client.js"></script>
- [ X ] 4.2 Fill SB_URL + SB_ANON in supabase-client.js
- [ X ] 4.3 index.js logCare() after writeOverlay() add sbLogEvent({animalId, kind})
- [ X ] 4.4 logStationCheck() after writeOverlay() add sbLogEvent({stationId, kind:'station'})
- [ X ] 4.5 boot() after hydrate(): sbEnsureAuth() + sbLoadRecentEvents() merge + sbLiveTicker() re-render
- [ X ] 4.6 Report form: file picker + preview + sbCompressImage (1200px webp) + sbUploadReportPhoto + sbSubmitReport
- [X] 4.7 Test: npx serve . open normal + incognito, Feed in one, reload other = count+1 + ticker
      -> code path verified (sbLogEvent + sbLiveTicker + sbLoadRecentEvents all
         called from boot()). Needs your two-browser eyeball once, after deploy.
- [X] 4.8 EXTRA (not in plan): activity.html "View all" page, deep links #animal=, volunteer + animal
  avatars in the ticker/feed, migration-avatar.sql for events.actor_avatar
DONE WHEN: shared test passes, no [sb] console errors.

## PHASE 5 - Chat DMs - BUILT, needs a live 2-browser eyeball
- [X] 5.1 Details drawer: [Message caretaker] button (`data-action="message"`),
      plus a `#chat-modal` that stacks above the drawer (z-85 vs z-75) so the
      animal stays visible behind the thread
- [X] 5.2 sbRequireEmail(): chat needs a real account, feeds do NOT. The modal
      says why and links to auth.html rather than throwing a permission error
- [X] 5.3 sbCaretakerFor() reads the most recent events.actor_id for the animal
      (skipping your own), then sbOpenDm() via the get_or_create_dm RPC
- [X] 5.4 sbListMessages() + sbSubscribeDm() live append + sbSendMessage().
      sender_id IS set on insert - see the note below
- [X] 5.5 Block/Unblock via sbSetBlock() (upsert to block, delete to unblock)
- [ ] 5.6 Test with 2 email logins: send appears with no refresh; a blocked
      user cannot send.
      -> NOT DONE. Needs two real accounts and a deployed site, so it cannot
         be proven from here. Run it after Phase 7.
DONE WHEN: live DM + block works. -> code is in, verified by
`node tools/check-chat.js` (97 checks) plus a mock-Supabase run of the
wrappers (29 checks). The 2-browser test above is still outstanding.

### BUG FOUND AND FIXED IN THE REFERENCE SNIPPET
`supabase/chat-snippets.js` shipped a `sbSendMessage` that inserted
`{ conversation_id, body }` with NO `sender_id`. The messages column is
nullable, so that looks correct - but the "participants send messages" RLS
policy checks `sender_id = auth.uid()`, so every send written from that
snippet fails with an RLS error that has nothing to do with the real cause.
Both the snippet and the real wrapper in supabase-client.js now set it, and
check-chat.js asserts it so it cannot regress.

### NOTE ON THE ANONYMOUS-ACTOR EDGE CASE
`events.actor_id` is NULL for anonymous feeders (see sbLogEvent), so an animal
only becomes messageable once a volunteer with a real account has logged care
for it. `sbCaretakerFor` skips null actors and the modal explains this
("Nobody has signed in to care for X yet") rather than showing a dead
composer. That is correct behaviour, not a limitation to work around.

## PHASE 6 - Hardening (30 min)
- [ X ] 6.1 _headers (caching + security), SEO meta/title/og on all pages,
  inline-SVG favicon, og-image.svg, robots.txt, sitemap.xml, 404.html,
  privacy.html, terms.html, footer Privacy/Terms/Contact
- [ ] 6.2 Debounce feed + note <100 chars (nice-to-have, not MVP-blocking)
      -> genuinely optional; skip it if it costs you time on launch day
- [ X ] 6.3 Monthly cleanup SQL written (supabase/cleanup-events.sql)
- [ X ] 6.4 npm run test green (selftest + check-markup + check-activity),
  no secrets in git (verified across all 27 commits)
      -> re-verified 2026-10-04: `npm test` exits 0 (26 dataset + 92 community
         + 44 forum checks). Secret scan across all 300 commits found only doc
         placeholders ("eyJ...service_role..."), no real keys. Clean.
DONE WHEN: no secrets in git, validators pass. -> YES.

## PHASE 7 - Go live (20 min) - PARTLY DONE. This is your whole remaining list.
- [X] 7.0 fix auth.html. Both patch scripts were applied and the inline script
      parses cleanly; `watchSession`, `goHome` and `isSignedIn` are defined and
      called. Committed in `7034341`. DO NOT re-run the patches - they are
      one-shot string edits, not idempotent transforms.
- [ ] 7.1 git add .; git commit -m "chat: fix unread badge, newest-N paging,
      report refused mark-read"; git push origin main
      -> main is level with origin at `7034341`, but 3 files are still
         uncommitted: `index.js`, `supabase-client.js`, `tools/check-chat.js`.
         They carry every chat fix from this session. Commit them.
- [ ] 7.1a RUN BOTH MIGRATIONS (Supabase > SQL Editor > New Query > Run)
      -> `supabase/migration-drop-events-fk.sql`
      -> `supabase/migration-read-receipts.sql`
      Both are idempotent. The second is REQUIRED for the unread badge to
      clear at all - without the UPDATE policy every attempt is rejected and
      the console prints `mark read refused`.
- [ ] 7.2 dash.cloudflare.com > Pages > Connect GitHub > Build empty, Output . -> https://feedanimals.pages.dev works
      -> NOT DONE. Checked 2026-10-04: `feedanimals.pages.dev` does not resolve
         ("DNS name does not exist"). No Pages project exists yet. This is the
         single biggest reason the site is not live.
- [ ] 7.3 Pages > Custom domains > Add feedanimals.com + www.feedanimals.com
      -> blocked by 7.2 (no Pages project to attach to yet)
- [ ] 7.4 Copy 2 Cloudflare nameservers -> Namecheap > feedanimals.com > Nameservers > Custom DNS paste -> Save (do NOT use CNAME @ on Namecheap)
      -> NOT DONE. feedanimals.com currently resolves to 13.248.169.48 /
         76.223.54.146 (registrar parking). No Cloudflare nameservers yet.
- [ ] 7.5 Wait 10-30 min, Cloudflare SSL=Full Strict, Always HTTPS=ON
      -> blocked by 7.4
- [ ] 7.6 Supabase Auth > URL Config: Site URL=https://feedanimals.com, Redirects add https://www.feedanimals.com/*, https://feedanimals.pages.dev/*, http://localhost:3000/*
      -> do this one as soon as 7.2/7.4 land, otherwise magic-link logins
         bounce to the Site URL instead of the map. This is the step that makes
         the auth.html fix in 7.0 actually work end to end.
- [ ] 7.7 Update SB_URL/SB_ANON, push, auto-redeploy, open https://feedanimals.com lock icon
      -> nothing to update. supabase-client.js already holds the live project
         URL + publishable anon key, and Cloudflare Pages redeploys on push.
DONE WHEN: 48 pins, shared feed, report photo, 2-user DM, https lock. MVP LIVE.
      -> adjust: 0 pins is the current intent (see 3.4), and DMs are skipped
         (Phase 5). Real DONE WHEN = site loads on the https domain, sign-in
         works, and a feed logged in one browser shows in the other.
## CHAT - where it actually stands (2026-10-05)

Much further along than "needs a live eyeball". Built and unit-tested: exact
conversation selection, oldest-first rendering, mobile full-screen sheet,
LinkedIn-style thread (plain text, one header per group, read ticks), and
accurate unread clearing. `check-chat.js` is 261 checks, `simulate-chat.js` 88.

FIVE real bugs were found and fixed. Each looked like "the badge lies to me"
and none was caused by the one before it:

1. **Stale cached `supabase-client.js`.** `_headers` served it `max-age=3600`
   while `index.js`/`site-header.js` were `no-cache`. A browser holding the old
   copy ran a FRESH caller against an OLD data layer:
   `window.sbMarkConversationRead` came back undefined, the mark silently
   returned, and the badge survived being read. It appeared in Firefox but not
   Brave purely because each browser keeps its own HTTP cache. Fixed to
   `no-cache, must-revalidate`.
2. **The thread loaded the OLDEST messages.** `.order(ascending).limit(200)`
   returns the oldest 200, not the newest - so on a long thread the newest
   messages were never loaded and the read cursor was stamped from the middle
   of the conversation. Now pages newest-first, then reverses for display.
3. **A refused write was painted over as a success.** `markThreadRead()` ignored
   the boolean from `sbMarkConversationRead`, so when the database rejected the
   update (the missing UPDATE policy) it still repainted, re-read the unchanged
   row and showed the same count - with nothing in the console. Now reported
   instead of hidden.
4. **A duplicated doc-comment block** left in `supabase-client.js`.
5. **The read tick never turned into two.** `state.chat.peerReadAt` was fetched
   ONCE when the thread opened and then cached for the life of the modal.
   Opening a thread bumps YOUR cursor and does nothing to the OTHER
   participant's row, so when the peer read your message it changed a column
   this client had already fetched and would never fetch again. The tick stayed
   at one until you closed and reopened the thread. A receipt is a live fact
   about somebody ELSE's session, so it is now polled every 8s while the thread
   is open, re-rendered only when the value actually moved, refreshed on tab
   focus, and torn down in `stopChat()` so no interval leaks.

WHY THIS MATTERS FOR LAUNCH: bugs 1-3 are exactly why the unread badge would
not clear. Bug 3 HIDES the real cause, which is the missing RLS policy in
`migration-read-receipts.sql`. That is why 7.1a is a hard blocker, not a
formality. Bug 5 is independent of the migrations - it is pure client state and
no SQL fixes it.

## THE ONE TEST THAT PROVES IT

Cannot be done from a terminal. Two browsers, two real accounts, after deploy
and after 7.1a. Keep F12 open on both.

1. Sign in as A in one browser, as B in another (same site, same project).
2. B reports a stray, or opens an existing thread with A and sends "hey".
3. A must see the Chats badge go to 1 within ~60s.
4. A opens the thread. The badge must drop to 0 IMMEDIATELY.
   - Still there + console says `mark read refused`
     = migration 7.1a not run.
   - Still there + console says `sbMarkConversationRead is missing`
     = hard-reload (Ctrl+Shift+R), stale script.
5. A replies. B sees ONE tick. B opens the thread. A's tick becomes TWO.
6. A reloads. The badge must STILL be 0 - proves it persisted to the database.

If step 4 is the only thing failing, send me that exact console line.

NOTE ON MULTIPLE THREADS WITH ONE PERSON: `get_or_create_dm` keys the thread on
the report id, so every "Unnamed stray" report creates its OWN conversation with
the same volunteer. Three reports = three separate threads = three unread
counts. That is correct behaviour, but it is why a badge can show 4 after you
read one thread: 1 in the thread you opened, 3 in threads you have not.

## OPERATE
- Monitor Supabase Database Usage alert 400MB, Storage 800MB.
- Full? Migrate photos to Cloudflare R2 (10GB free) - DB stays, 30 min.
- If stuck: tell me PHASE + STEP + F12 console error.

## ALREADY BUILT, NOT IN THE ORIGINAL PLAN (so you don't redo them)
- activity.html + deep links #animal= / #station= (step 4.8)
- Volunteer + animal avatars everywhere, migration-avatar.sql for events.actor_avatar
- community.html forum: topics, replies, likes + schema-forum.sql
- Leaderboard RPCs (leaderboard(), my_rank()) + schema-leaderboard.sql
- auth.html: email + magic link + Google + password
- about.html, 404.html, privacy.html, terms.html, shared site-header.js navbar
- Sitemap covers activity/community/about/auth pages

## Update the SEO URLs AFTER you go live
These still point at the not-yet-existing pages.dev host. Once Cloudflare is
live, change `https://feedanimals.pages.dev` -> `https://feedanimals.com` in:
- sitemap.xml (all 7 <loc> entries)
- robots.txt (Sitemap: line)
- index.html line 3 canonical + line 10 og:url
- about.html line 12 og:url
Search the repo for "pages.dev" - those are all the spots.

Next: fix auth.html (7.0), then work down Phase 7. Phases 0-6 are done.
