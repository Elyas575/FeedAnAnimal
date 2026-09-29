#!/usr/bin/env node
/*
 * Seed Supabase from data/animals.json
 * Usage:
 *   npm i @supabase/supabase-js   (or: npm install @supabase/supabase-js)
 *   $env:SUPABASE_URL="https://xyz.supabase.co"          # PowerShell
 *   $env:SUPABASE_SERVICE_KEY="eyJ...service_role..."    # NEVER the anon key, NEVER commit this
 *   node tools/seed-supabase.js
 *
 * Reads data/animals.json (relative MinutesAgo fields) and upserts:
 *  - 6 stations -> stations table
 *  - 48 animals -> animals table (converts to absolute ISO timestamps)
 */
const fs = require('fs');
const path = require('path');

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error('Missing env. Set SUPABASE_URL + SUPABASE_SERVICE_KEY (service_role, server-only).');
  process.exit(1);
}

let supabase;
try {
  ({ createClient: createClient } = require('@supabase/supabase-js'));
  supabase = createClient(URL, SERVICE_KEY);
} catch (e) {
  console.error('Run: npm install @supabase/supabase-js  (needs package.json: run `npm init -y` first)');
  process.exit(1);
}

const JSON_PATH = path.join(__dirname, '..', 'data', 'animals.json');
const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const now = Date.now();
const isoMin = (m) => new Date(now - (Number(m) || 0) * 60000).toISOString();
const isoDays = (d) => new Date(now - (Number(d) || 0) * 86400000).toISOString();

async function main() {
  // 1. Stations
  const stations = (doc.stations || []).map((s) => ({
    id: s.id,
    name: s.name,
    ref: s.ref || null,
    type: s.type || null,
    status: s.status || null,
    capacity_pct: s.capacityPct ?? 50,
    caretaker: s.caretaker || null,
    notes: s.notes || null,
    lat: s.location.lat,
    lng: s.location.lng,
    location_label: s.location.label,
    location_area: s.location.area,
    last_serviced_at: isoMin(s.lastServicedMinutesAgo),
  }));
  console.log(`Upserting ${stations.length} stations...`);
  let r = await supabase.from('stations').upsert(stations, { onConflict: 'id' });
  if (r.error) throw r.error;

  // 2. Animals
  const animals = (doc.animals || []).map((a) => ({
    id: a.id,
    name: a.name,
    species: a.species,
    breed: a.breed,
    sex: a.sex || null,
    age_class: a.ageClass || null,
    color: a.color || null,
    description: a.description || null,
    temperament: a.temperament || 'unknown',
    health: a.health || 'healthy',
    sterilized: !!a.sterilized,
    vaccinated: !!a.vaccinated,
    microchipped: !!a.microchipped,
    caretakers: a.caretakers || [],
    tags: a.tags || [],
    notes: a.notes || null,
    photo_url: a.photoUrl || null,
    station_id: a.stationId || null,
    lat: a.location.lat,
    lng: a.location.lng,
    location_label: a.location.label,
    location_area: a.location.area,
    feed_count: a.feedCount || 0,
    water_count: a.waterCount || 0,
    last_fed_at: isoMin(a.lastFedMinutesAgo),
    last_watered_at: isoMin(a.lastWateredMinutesAgo),
    reported_at: isoDays(a.reportedDaysAgo),
  }));
  console.log(`Upserting ${animals.length} animals...`);
  // chunk to avoid payload limits
  for (let i = 0; i < animals.length; i += 20) {
    const chunk = animals.slice(i, i + 20);
    const res = await supabase.from('animals').upsert(chunk, { onConflict: 'id' });
    if (res.error) throw res.error;
    console.log(`  chunk ${i}-${i + chunk.length} ok`);
  }

  // 3. Verify
  const c1 = await supabase.from('animals').select('id', { count: 'exact', head: true });
  const c2 = await supabase.from('stations').select('id', { count: 'exact', head: true });
  console.log(`DONE. animals=${c1.count} (expect 48), stations=${c2.count} (expect 6)`);
}
main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
