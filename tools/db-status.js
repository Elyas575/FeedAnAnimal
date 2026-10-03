#!/usr/bin/env node
/* Read-only probe: which Supabase tables exist and how many rows are in them.
   Makes NO changes. Safe to run any time.  ->  node tools/db-status.js */
const https = require('https');

const SB_URL = 'https://wtmcviupbcmcffamyslb.supabase.co';
const SB_ANON = 'sb_publishable_As7cS21usw4DV3MtKdLnEw_op6mSBXb';

const TABLES = ['animals', 'stations', 'events', 'reports', 'profiles', 'topics',
  'replies', 'topic_likes', 'messages', 'conversations',
  'conversation_participants', 'blocks'];

function probe(name) {
  return new Promise((resolve) => {
    const url = SB_URL + '/rest/v1/' + name + '?select=*';
    const req = https.request(url, {
      headers: {
        apikey: SB_ANON,
        Authorization: 'Bearer ' + SB_ANON,
        Prefer: 'count=exact',
        Range: '0-0'
      }
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        const range = res.headers['content-range'] || '';
        const count = range.split('/')[1] || '0';
        // 206 = Partial Content: expected, because of the Range: 0-0 header.
        if (res.statusCode === 200 || res.statusCode === 206) {
          const n = range.split('/')[1];
          resolve({ name, ok: true, count: n === '*' ? '?' : n });
        } else {
          let msg = body.slice(0, 120).replace(/\s+/g, ' ');
          try { msg = JSON.parse(body).message || msg; } catch (e) { /* keep raw */ }
          resolve({ name, ok: false, msg });
        }
      });
    });
    req.on('error', (e) => resolve({ name, ok: false, msg: e.message }));
    req.end();
  });
}

(async function main() {
  console.log('Supabase: ' + SB_URL);
  console.log('(read-only probe - nothing is modified)\n');
  let rows = 0;
  for (const t of TABLES) {
    const r = await probe(t);
    if (r.ok) {
      rows += Number(r.count);
      console.log('  OK    ' + t.padEnd(26) + r.count + ' rows');
    } else {
      console.log('  MISS  ' + t.padEnd(26) + r.msg);
    }
  }
  console.log('\nTotal rows across all tables: ' + rows);
})();