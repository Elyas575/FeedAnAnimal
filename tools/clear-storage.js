#!/usr/bin/env node
/*
 * Empty the animal-photos bucket (companion to supabase/reset-all-data.sql).
 * Usage (same env pattern as tools/seed-supabase.js):
 *   npm i @supabase/supabase-js   (or: npm install @supabase/supabase-js)
 *   $env:SUPABASE_URL="https://xyz.supabase.co"          # PowerShell
 *   $env:SUPABASE_SERVICE_KEY="eyJ...service_role..."    # NEVER the anon key, NEVER commit this
 *   node tools/clear-storage.js
 *
 * Why a script: the SQL editor refuses "delete from storage.objects" -
 * the storage.protect_delete() trigger raises 42501 on purpose, telling you
 * to use the Storage API instead. This does exactly that, with the service
 * role key (bypasses RLS, no policies in the way).
 * Safe to re-run: an empty bucket just reports 0 files.
 */
const BUCKET = 'animal-photos';
const PAGE = 100;        // list() page size
const REMOVE_BATCH = 100; // paths per remove() call

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

/* Recursively collect every object path in the bucket. list() reports a
   folder as an entry with id === null, so descend into those. */
async function listAll(prefix) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .list(prefix, { limit: PAGE, offset: offset });
    if (error) throw error;
    if (!data || !data.length) break;
    for (const entry of data) {
      const p = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.id === null) out.push(...(await listAll(p)));
      else out.push(p);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function main() {
  const paths = await listAll('');
  console.log(`Found ${paths.length} file(s) in bucket "${BUCKET}".`);
  if (!paths.length) {
    console.log('DONE. bucket already empty');
    return;
  }
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const chunk = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(chunk);
    if (error) throw error;
    removed += chunk.length;
    console.log(`  removed ${removed}/${paths.length}`);
  }
  const check = await listAll('');
  console.log(`DONE. removed=${removed}, remaining=${check.length} (expect 0)`);
}
main().catch((e) => { console.error('CLEAR FAILED:', e.message); process.exit(1); });