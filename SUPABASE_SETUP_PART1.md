# FeedTheAnimalsMap — Supabase Backend Setup (Do Together, Step-by-Step)

Follow top to bottom. Check each box. Stop and tell me where you get stuck.

## PHASE 0 — What we're building (5 min read)
- Frontend stays static: `index.html + index.js + Leaflet`
- Supabase becomes: Postgres DB + Auth + Storage (photos) + Realtime (live ticker + DMs)
- Security = Row Level Security (RLS). No custom Node server.
- Cost = $0 (Free tier). Host frontend free on Cloudflare Pages.

Files I just created for you:
- `supabase/schema-core.sql` → animals, stations, events, reports, profiles
- `supabase/schema-chat.sql` → DMs
- `tools/seed-supabase.js` → uploads your 48 animals + 6 stations
- `supabase/frontend-snippets.js` → copy-paste for index.js

## PHASE 1 — Create Supabase project [YOU, 10 min]
- [ ] 1.1 Go to https://supabase.com → Sign up (GitHub login is fastest)
- [ ] 1.2 New Project → Name: `feed-animals`, Region: `West US (North California)` (closest to Seattle), DB password: save in password manager
- [ ] 1.3 Wait 2 min → Settings → API → copy `Project URL` + `anon public key` into a temp notepad
  - Example: `https://xyzcompany.supabase.co` + `eyJhbG...`
- [ ] 1.4 Tell me: ✅ Project created + paste Project URL (no secret keys in chat, just URL to confirm)

STOP HERE — checkpoint 1. Don't continue until 1.4 done.
