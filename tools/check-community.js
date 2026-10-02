#!/usr/bin/env node
/*
 * Community / leaderboard page checks.
 *
 *   node tools/check-community.js
 *
 * The interesting logic is the tier ladder: a volunteer's badge must be a
 * pure function of the points the SERVER reported. These tests execute the
 * real community.js and assert behaviour at every threshold, because a
 * badge that disagrees with the number is the bug this page is prone to.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const rows = [];
const ok = (label, pass, detail) => rows.push([pass ? 'OK  ' : 'MISS', label + (detail === undefined ? '' : '  ->  ' + detail)]);

const community = require(path.join(ROOT, 'community.js'));
const html = fs.readFileSync(path.join(ROOT, 'community.html'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-leaderboard.sql'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'supabase-client.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* --------------------------------- tiers -------------------------------- */
ok('there are 8 ranks', community.TIERS.length === 8, community.TIERS.length);
ok('the ladder starts at 0 points', community.TIERS[0].min === 0);
ok('every rank has a name, accent and icon',
  community.TIERS.every((t) => t.name && t.accent && t.icon));
ok('thresholds strictly increase',
  community.TIERS.every((t, i) => i === 0 || t.min > community.TIERS[i - 1].min));
ok('every rank is distinct',
  new Set(community.TIERS.map((t) => t.name)).size === community.TIERS.length);
ok('every rank has its own colour',
  new Set(community.TIERS.map((t) => t.accent)).size === community.TIERS.length);

/* ---------------------------- tier boundaries --------------------------- */
[[0, 'Stray'], [99, 'Stray'], [100, 'Scout'], [249, 'Scout'],
 [250, 'Feeder'], [499, 'Feeder'], [500, 'Carer'], [899, 'Carer'],
 [900, 'Guardian'], [1499, 'Guardian'], [1500, 'Angel'], [2499, 'Angel'],
 [2500, 'Saint'], [3999, 'Saint'], [4000, 'Legend'], [99999, 'Legend']]
  .forEach(([points, expected]) => {
    ok(points + ' points ranks as ' + expected,
      community.tierFor(points).name === expected, community.tierFor(points).name);
  });

// Postgres bigint arrives as a STRING. Without coercion every row would
// compare false and the whole board would show as tier 1.
ok('string points are coerced ("250")', community.tierFor('250').name === 'Feeder', community.tierFor('250').name);
ok('string points are coerced ("900")', community.tierFor('900').name === 'Guardian', community.tierFor('900').name);
ok('junk points fall back to tier 1', community.tierFor('abc').name === 'Stray');
ok('null points fall back to tier 1', community.tierFor(null).name === 'Stray');
ok('undefined points fall back to tier 1', community.tierFor(undefined).name === 'Stray');

/* ------------------------------- progress ------------------------------ */
ok('a fresh account starts at 0%', community.tierProgress(0) === 0, community.tierProgress(0));
ok('the top rank reads 100%', community.tierProgress(4000) === 100, community.tierProgress(4000));
ok('progress stays within 0-100',
  [0, 1, 137, 999, 2501, 3999, 5000].every((p) => {
    const v = community.tierProgress(p);
    return v >= 0 && v <= 100;
  }));
ok('progress resets at a new tier', community.tierProgress(100) === 0 && community.tierProgress(99) > 90);
ok('nextTierFor is null at the summit', community.nextTierFor(4000) === null);
ok('nextTierFor names the next rank', community.nextTierFor(0).name === 'Scout');

/* -------------------------------- badges ------------------------------- */
// Look tiers up BY NAME, never by array index: the ladder order is an
// implementation detail, and index-based tests break when it changes.
const saint = community.TIERS.filter((t) => t.name === 'Saint')[0];
const svg = community.badgeSvg(saint, 44);
ok('badge renders an SVG', svg.indexOf('<svg') === 0);
ok('badge carries an accessible label', svg.indexOf('aria-label="' + saint.name + ' rank badge"') !== -1, svg.slice(0, 120));
ok('badge uses the tier colour', svg.indexOf(saint.accent) !== -1, saint.accent);
const badges = community.TIERS.map((t) => community.badgeSvg(t, 44));
ok('each rank produces a distinct badge', new Set(badges).size === 8, new Set(badges).size);
ok('badge gradient ids are unique per tier',
  new Set(community.TIERS.map((t) => community.badgeSvg(t, 44).match(/id="([^"]+)"/)[1])).size === 8);
ok('badge gradient ids differ by size',
  /id="[^"]*_44"/.test(community.badgeSvg(community.TIERS[0], 44))
  && /id="[^"]*_56"/.test(community.badgeSvg(community.TIERS[0], 56)));

/* -------------------------------- avatars ------------------------------ */
ok('initials from a single name', community.initialsOf('Lirah') === 'LI', community.initialsOf('Lirah'));
ok('initials from two names', community.initialsOf('Ada Lovelace') === 'AL', community.initialsOf('Ada Lovelace'));
ok('initials from a handle', community.initialsOf('ElyasQadi') === 'EL', community.initialsOf('ElyasQadi'));
ok('initials from an empty name', community.initialsOf('') === '?');
ok('avatar colour is stable for the same name', community.hueOf('Lirah575') === community.hueOf('Lirah575'));

/* --------------------------------- rows -------------------------------- */
const row = community.rowHtml({
  rank: 2, user_id: 'u1', display_name: 'Lirah575', avatar_url: null,
  points: 260, feeds: 20, waters: 5, reports: 1, animals: 12,
  last_seen: new Date().toISOString(),
}, null);
ok('row shows the rank number', row.indexOf('>2<') !== -1);
ok('row shows the points', row.indexOf('260') !== -1);
ok('row shows the tier name', row.indexOf('Feeder') !== -1);
ok('row shows the feed count', row.indexOf('20 feeds') !== -1);
ok('row escapes a display name', community.rowHtml(
  { rank: 1, user_id: 'x', display_name: '<img src=x onerror=alert(1)>', points: 10 }, null
).indexOf('<img src=x') === -1);
ok('row marks the signed-in volunteer',
  community.rowHtml({ rank: 1, user_id: 'me', display_name: 'Me', points: 10 }, 'me').indexOf('>You<') !== -1);

/* -------------------------------- scoring ------------------------------ */
const SCORE_EXPECT = { feed: 10, water: 8, station: 12, vet: 20, medicine: 18, rescue: 30, report: 25 };
ok('all 7 action types are scored', community.SCORES.length === 7, community.SCORES.length);
community.SCORES.forEach((s) => {
  ok(s.kind + ' scores ' + SCORE_EXPECT[s.kind], s.points === SCORE_EXPECT[s.kind], s.points);
});
// The displayed table must agree with the SQL, or the docs lie.
Object.keys(SCORE_EXPECT).forEach((kind) => {
  ok('SQL awards ' + SCORE_EXPECT[kind] + ' for ' + kind,
    sql.indexOf("when '" + kind + "' then " + SCORE_EXPECT[kind]) !== -1);
});

/* ------------------------------- the page ------------------------------ */
ok('community.html has a title', html.indexOf('<title>') !== -1);
ok('page loads the supabase client', html.indexOf('src="supabase-client.js"') !== -1);
ok('page loads community.js', html.indexOf('src="community.js"') !== -1);
ok('page has a leaderboard container', html.indexOf('id="board"') !== -1);
ok('page has the three time windows',
  html.indexOf('data-w="week"') !== -1 && html.indexOf('data-w="month"') !== -1 && html.indexOf('data-w="all"') !== -1);
ok('page explains how points work', html.indexOf('id="scores"') !== -1);
ok('page shows the full ladder', html.indexOf('id="tiers"') !== -1);
ok('page has a "your rank" panel', html.indexOf('id="mine"') !== -1);
ok('page has an empty state', html.indexOf('id="board-empty"') !== -1);
ok('page links back to the map', html.indexOf('href="index.html"') !== -1);
ok('page has a meta description', html.indexOf('name="description"') !== -1);
ok('page has a favicon', html.indexOf('rel="icon"') !== -1);
ok('every rank has a blurb', community.TIERS.every((t) => !!community.TIER_BLURB[t.tier]));

/* ------------------------------ the backend ---------------------------- */
ok('SQL defines leaderboard()', sql.indexOf('create or replace function public.leaderboard') !== -1);
ok('SQL defines my_rank()', sql.indexOf('create or replace function public.my_rank') !== -1);
ok('SQL ranks by points', /order by t\.points desc/.test(sql));
ok('SQL only counts named volunteers', sql.indexOf('actor_id is not null') !== -1);
ok('SQL supports all three windows',
  sql.indexOf("p_window = 'week'") !== -1 && sql.indexOf("p_window = 'month'") !== -1 && sql.indexOf("p_window = 'all'") !== -1);
ok('SQL limits the board', sql.indexOf('limit 100') !== -1);
ok('SQL grants the board to visitors',
  /grant execute on function public\.leaderboard\(text\) to anon, authenticated/.test(sql));
ok('SQL grants my_rank too', /grant execute on function public\.my_rank\(\) to anon, authenticated/.test(sql));
ok('SQL exposes no email or auth columns', !/select[^;]*\bemail\b/.test(sql));

ok('client exposes sbLeaderboard', client.indexOf('window.sbLeaderboard = sbLeaderboard;') !== -1);
ok('client exposes sbMyRank', client.indexOf('window.sbMyRank = sbMyRank;') !== -1);
ok('client calls the leaderboard RPC', client.indexOf("sb.rpc('leaderboard'") !== -1);
ok('client calls the my_rank RPC', client.indexOf("sb.rpc('my_rank'") !== -1);
ok('client degrades gracefully if the RPC is missing',
  client.indexOf('leaderboard unavailable') !== -1 && client.indexOf('my_rank unavailable') !== -1);
ok('client validates the window argument', /\['week', 'month', 'all'\]\.indexOf\(span\)/.test(client));

/* ------------------------------- nav link ----------------------------- */
ok('nav links Leaderboard to community.html',
  /data-path="leaderboard" href="community\.html"/.test(indexHtml));

/* --------------------------------- run --------------------------------- */
let bad = 0;
rows.forEach(([s, l]) => { if (s === 'MISS') bad++; console.log(s + '  ' + l); });
console.log(bad ? '\n' + bad + ' FAILED' : '\nCommunity page checks passed (' + rows.length + ' checks).');
process.exit(bad ? 1 : 0);