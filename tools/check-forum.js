/* COMMUNITY: forum-only checks (the rank ladder lives outside this page now).
 *
 *   node tools/check-forum.js
 *
 * The forum is LOCAL-FIRST: before supabase/schema-forum.sql is run, the
 * cloud wrappers return null and forum.js keeps posts on this device.
 * These tests execute the real forum.js store headlessly: validation,
 * sorting, replies, likes, HTML escaping, deep links.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const rows = [];
const ok = (label, pass, detail) => rows.push([pass ? 'OK  ' : 'MISS', label + (detail === undefined ? '' : '  ->  ' + detail)]);

const forum = require(path.join(ROOT, 'forum.js'));
const html = fs.readFileSync(path.join(ROOT, 'community.html'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-forum.sql'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'supabase-client.js'), 'utf8');

function mem() {
  const bag = {};
  return { get: (k) => (k in bag ? bag[k] : null), set: (k, v) => { bag[k] = String(v); } };
}
function seedStore() {
  const s = forum.createStore(mem());
  // Spaced 1s apart so newest-first ordering is deterministic: same-ms
  // timestamps would leave the order up to the sort implementation.
  const at = [1000, 2000, 3000].map((ago) => new Date(Date.now() - ago).toISOString());
  s.addTopic({ title: 'Who feeds market cats?', body: 'Friday rota?', authorName: 'A', createdAt: at[2] });
  s.addTopic({ title: 'Lost tabby near north gate', body: 'Seen?', authorName: 'B', createdAt: at[1] });
  s.addTopic({ title: 'Water bowls frozen', body: 'Tips?', authorName: 'C', createdAt: at[0] });
  return s;
}

ok('short titles are rejected', !!forum.validateTopic('Hi', 'some body'));
ok('empty bodies are rejected', !!forum.validateTopic('A real title here', '  '));
ok('good topics pass', forum.validateTopic('Who feeds Fridays?', 'Rota?') === null);
ok('titles cap at 140', forum.TITLE_MAX === 140);
ok('bodies cap at 4000', forum.BODY_MAX === 4000);
ok('replies cap at 2000', forum.REPLY_MAX === 2000);
ok('empty replies are rejected', !!forum.validateReply('   '));
ok('good replies pass', forum.validateReply('I can do Fridays') === null);

/*@@MORE@@*/
(function () {
  const s = seedStore();
  ok('three topics stored', s.listTopics('recent').length === 3);
  const first = s.listTopics('recent')[0];
  ok('newest sorts first', first.title.indexOf('Water bowls') === 0, first.title);
  const bad = s.addTopic({ title: 'No', body: 'x', authorName: 'Z' });
  ok('invalid topics are refused', !!bad.error && s.listTopics('recent').length === 3);
  const r = s.addReply(first.id, { body: 'Use heated bowls', authorName: 'D' });
  ok('replies attach', !r.error && !!r.reply.id);
  ok('reply_count follows', s.getTopic(first.id).reply_count === 1);
  const rBad = s.addReply('topic-missing', { body: 'hi', authorName: 'D' });
  ok('replies to ghosts are refused', !!rBad.error);
  ok('liking flips on', s.toggleLike(first.id) === true);
  ok('liking flips off', s.toggleLike(first.id) === false);
  s.toggleLike(first.id);
  ok('top sort leads with likes', s.listTopics('top')[0].id === first.id);
})();

(function () {
  const forumSrc = fs.readFileSync(path.join(ROOT, 'forum.js'), 'utf8');
  ok('forum has no board-view switching',
    forumSrc.indexOf('view-board') === -1 && forumSrc.indexOf('data-view') === -1
    && forumSrc.toLowerCase().indexOf('leaderboard') === -1);
  const evil = forum.topicCardHtml({
    id: 'x', title: '<script>alert(1)</script>', body: '<b>hi</b>',
    author_name: '<img src=x>', created_at: new Date().toISOString(),
    reply_count: 0, like_count: 0,
  }, false);
  ok('topic cards escape titles', evil.indexOf('<script>') === -1);
  ok('topic cards escape bodies', evil.indexOf('<b>hi</b>') === -1);
  ok('topic cards link to threads', evil.indexOf('data-open="x"') !== -1);
  const revil = forum.replyHtml({ body: '<i>yo</i>', author_name: 'E', created_at: new Date().toISOString() });
  ok('replies escape bodies', revil.indexOf('<i>yo</i>') === -1);
  ok('initials from two names', forum.initialsOf('Lira H') === 'LH');
})();

/*@@PAGE@@*/
ok('page loads forum.js', html.indexOf('src="forum.js"') !== -1);
ok('page has no leaderboard markup or switches',
  html.indexOf('data-view=') === -1 && html.indexOf('id="view-board"') === -1
  && html.toLowerCase().indexOf('leaderboard') === -1);
ok('page has a topic composer',
  html.indexOf('id="topic-title"') !== -1 && html.indexOf('id="topic-body"') !== -1);
ok('page has a post button', html.indexOf('id="topic-post"') !== -1);
ok('page has sort buttons',
  html.indexOf('data-sort="recent"') !== -1 && html.indexOf('data-sort="active"') !== -1
  && html.indexOf('data-sort="top"') !== -1);
ok('page has a topic list', html.indexOf('id="topics"') !== -1);
ok('page has a thread view',
  html.indexOf('id="thread"') !== -1 && html.indexOf('id="thread-replies"') !== -1);
ok('page has a reply box',
  html.indexOf('id="reply-body"') !== -1 && html.indexOf('id="reply-send"') !== -1);

ok('SQL creates topics', sql.indexOf('create table if not exists topics') !== -1);
ok('SQL creates replies', sql.indexOf('create table if not exists replies') !== -1);
ok('SQL creates topic_likes', sql.indexOf('create table if not exists topic_likes') !== -1);
ok('SQL syncs reply counts', sql.indexOf('touch_topic_on_reply') !== -1);
ok('SQL syncs like counts', sql.indexOf('forum_like_delta') !== -1);
ok('SQL posting needs auth', sql.indexOf('"auth insert topics"') !== -1);
ok('SQL topics cap titles', sql.indexOf('between 3 and 140') !== -1);
ok('SQL topics cap bodies', sql.indexOf('between 1 and 4000') !== -1);

ok('client exposes sbForumTopics', client.indexOf('window.sbForumTopics = sbForumTopics;') !== -1);
ok('client exposes sbForumCreateTopic', client.indexOf('window.sbForumCreateTopic = sbForumCreateTopic;') !== -1);
ok('client exposes sbForumReplies', client.indexOf('window.sbForumReplies = sbForumReplies;') !== -1);
ok('client exposes sbForumCreateReply', client.indexOf('window.sbForumCreateReply = sbForumCreateReply;') !== -1);
ok('client exposes sbForumToggleLike', client.indexOf('window.sbForumToggleLike = sbForumToggleLike;') !== -1);

let bad = 0;
rows.forEach(([s, l]) => { if (s === 'MISS') bad++; console.log(s + '  ' + l); });
console.log(bad ? '\n' + bad + ' FAILED' : '\nForum checks passed (' + rows.length + ' checks).');
process.exit(bad ? 1 : 0);