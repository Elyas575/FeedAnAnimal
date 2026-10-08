# FeedAnimals - Start to Finish - Simple Plan

Goal: feedanimals.com live with map + backend + chat. Cost: ~$12/year (domain only).

## STAGE 1: Get your domain (15 min, $12)
1. Go to namecheap.com, search feedanimals.com
2. If taken, buy feedanimalsmap.com or feedtheanimals.org instead - don't overpay
3. Buy 1 year + turn on auto-renew
4. Keep Namecheap tab open, you'll add DNS later

## STAGE 2: Get free backend (10 min, $0)
1. Go to supabase.com, sign up with GitHub
2. New Project: name feed-animals, region West US, save DB password
3. Wait 2 min for green Active
4. Settings > API: copy Project URL + anon key to notepad
5. Auth > Providers: turn ON Anonymous + Email
6. SQL Editor > New Query: paste supabase/schema-core.sql > Run
7. SQL Editor > New Query: paste supabase/schema-chat.sql > Run
8. Database > Replication: turn on for events + messages tables
9. Storage > New Bucket: name animal-photos, Public ON, 2MB limit

## STAGE 3: Upload your 48 animals (10 min)
1. In project folder run: npm init -y + npm install @supabase/supabase-js
2. Copy service_role key from Supabase Settings > API (secret, terminal only)
3. PowerShell:
   $env:SUPABASE_URL="https://YOUR.supabase.co"
   $env:SUPABASE_SERVICE_KEY="YOUR-service-role"
   node tools/seed-supabase.js
4. Check: Table Editor > animals = 48 rows, stations = 6 rows
5. Done - you never edit data/animals.json again, it stays as offline backup

## STAGE 4: Connect frontend to backend (30 min)
1. In index.html before index.js add:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
2. Top of index.js: paste supabase/frontend-snippets.js, fill SB_URL + SB_ANON
3. On boot call sbEnsureAuth()
4. Feed button: after writeOverlay() add sbLogEvent({animalId, kind:'feed'})
5. Same for water + station check
6. Test: npx serve . open 2 browsers, feed in one, reload other = shared

## STAGE 5: Add chat DMs (1 hour)
1. Details drawer: add [Message Caretaker] button
2. Paste supabase/chat-snippets.js functions
3. Click -> sbOpenDm(otherUserId, animalId) -> list -> subscribe -> send
4. Require email login only for chat (sbRequireEmail)
5. Add Block button -> insert into blocks table
6. Test with 2 logins: live message, no refresh

## STAGE 6: Put online with your domain (20 min)
1. Push folder to GitHub
2. dash.cloudflare.com > Pages > Connect GitHub > Build empty, Output .
3. You get feedanimals.pages.dev - test it works
4. Pages > Custom domains > Add feedanimals.com
5. Cloudflare shows DNS records - copy them
6. Namecheap > feedanimals.com > Advanced DNS > paste CNAMEs:
   CNAME @ feedanimals.pages.dev
   CNAME www feedanimals.pages.dev
7. Wait 10-30 min, https://feedanimals.com shows lock
8. Supabase > Auth > URL Config: Site URL = https://feedanimals.com, add www + localhost:3000 to Redirects
9. Done. No Supabase payment needed for domain.

## What you pay
- Namecheap: ~$12/year once
- Cloudflare Pages: $0 forever + free SSL
- Supabase: $0 until 1k+ daily heavy use, then $25 only if needed

## If stuck, tell me STAGE + STEP number.
