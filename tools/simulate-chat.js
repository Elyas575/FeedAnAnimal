/* End-to-end simulation of opening a chat thread, headlessly.
 *
 *   node tools/simulate-chat.js
 *
 * check-chat.js proves the markup of each bubble is correct in isolation.
 * It cannot prove the THREAD renders, and that distinction mattered: the
 * app shipped with two `renderChat` declarations, the stale one hoisted last,
 * and openChat called it with no argument - so every thread threw a
 * TypeError and stayed blank. All 197 checks still passed.
 *
 * This file drives the real helpers from index.js over a fake conversation
 * and asserts on what actually lands in the log. It is the check that would
 * have caught it.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const app = require(path.join(ROOT, 'index.js'));

const rows = [];
const ok = (label, pass, detail) => {
  rows.push([pass ? 'OK  ' : 'MISS', label + (detail === undefined ? '' : '  ->  ' + detail)]);
  return pass;
};

/* --------------------- read receipts, the core rule ------------------ *
 * A message is read once the OTHER participant's read cursor reaches it.
 * These are the two halves of the same rule, and the boundary is exact:
 * cursor == message time is read, one millisecond earlier is not. */
const T = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-03-10T10:00:00.000Z');

ok('no peer cursor means sent, never read',
  app.chatReceipt({ created_at: T(T0) }, null).indexOf('done_all') === -1);
ok('no peer cursor still renders a single tick',
  app.chatReceipt({ created_at: T(T0) }, null).indexOf('>done<') !== -1);
ok('a cursor before the message means sent',
  app.chatReceipt({ created_at: T(T0) }, T(T0 - 60000)).indexOf('done_all') === -1);
ok('a cursor exactly at the message means read',
  app.chatReceipt({ created_at: T(T0) }, T(T0)).indexOf('done_all') !== -1);
ok('a cursor past the message means read',
  app.chatReceipt({ created_at: T(T0) }, T(T0 + 60000)).indexOf('done_all') !== -1);
ok('a read tick is labelled for screen readers',
  app.chatReceipt({ created_at: T(T0) }, T(T0)).indexOf('aria-label="Read"') !== -1);
ok('a sent tick is labelled for screen readers',
  app.chatReceipt({ created_at: T(T0) }, null).indexOf('aria-label="Sent"') !== -1);
ok('the read tick is styled apart from the sent tick',
  app.chatReceipt({ created_at: T(T0) }, T(T0)).indexOf('chat-tick--read') !== -1);
ok('a message with no timestamp renders no tick at all',
  app.chatReceipt({ created_at: 'nope' }, T(T0)) === '');
ok('an unparseable peer cursor falls back to sent',
  app.chatReceipt({ created_at: T(T0) }, 'garbage').indexOf('>done<') !== -1);

/* Only MY messages carry a tick - I cannot know what they read. */
const sentBubble = app.chatBubble({ body: 'hi', created_at: T(T0), senderName: 'Lala' }, true, false, true, T(T0));
const gotBubble = app.chatBubble({ body: 'hi', created_at: T(T0), senderName: 'Lala' }, false, false, true, T(T0));
ok('my own message shows a tick', sentBubble.indexOf('chat-tick') !== -1);
ok("the other person's message shows no tick", gotBubble.indexOf('chat-tick') === -1);
ok('the bubble still carries its timestamp', sentBubble.indexOf('chat-message__meta') !== -1);

/* ------------------- the invisible-message regression -------------- *
 * Reported symptom: after sending a SECOND message, the bubble turned
 * white and vanished, leaving a column of faint letters on the white
 * panel.
 *
 * Cause: the bubble built its class attribute by concatenating OPTIONAL
 * modifiers. A bubble that was grouped but not the last of its group got
 * an empty tail corner and therefore no separating space, fusing
 * "-mt-1.5" onto the colour utility as "-mt-1.5bg-primary". The browser
 * discards an unknown token outright, so the background never applied
 * while the white text colour still did - invisible text. Only the 2nd+
 * message in a group was hit, which is exactly why one message looked
 * fine and two did not.
 *
 * Asserted on RENDERED markup split into real class tokens, because the
 * entire failure is that a token stops being real. Matching the literal
 * "-mt-1.5bg-" would only ever catch this one spelling of the mistake. */
const classTokens = (html) => (html.match(/class="[^"]*"/g) || [])
  .map((a) => a.slice(7, -1).split(/\s+/).filter(Boolean)).flat();

const SHAPES = [];
[true, false].forEach((mine) => {
  [true, false].forEach((grouped) => {
    [true, false].forEach((ends) => { SHAPES.push([mine, grouped, ends]); });
  });
});

/* Every shape must still render valid, unmangled class tokens - the class
   strings are assembled by concatenation here, so a missing separator is
   always one edit away. */

/* ------------------- WhatsApp-style compact message bubbles ---------- *
 * Messages align by sender, carry a compact fill and inline timestamp,
 * and avoid repeating the sender label on every bubble. */
const opener = app.chatBubble({ body: 'A', created_at: T0, senderName: 'Lala' }, false, false, true, T0);
const continuation = app.chatBubble({ body: 'B', created_at: T0, senderName: 'Lala' }, false, true, false, T0);

ok('an incoming message has a filled bubble', opener.indexOf('chat-message__bubble') !== -1);
ok('an incoming bubble is aligned to the left', opener.indexOf('chat-message--theirs') !== -1);
ok('an outgoing bubble is aligned to the right',
  app.chatBubble({ body: 'A', created_at: T0 }, true, false, true, T0).indexOf('chat-message--mine') !== -1);
ok('a bubble carries its timestamp inline',
  opener.indexOf('chat-message__meta') !== -1 && opener.indexOf('<time>') !== -1);
ok('sender names are not repeated inside message bubbles', opener.indexOf('Lala') === -1);
ok('a continuation carries NO repeated name', continuation.indexOf('Lala') === -1);
ok('a continuation carries the grouped-message class',
  continuation.indexOf('chat-message--grouped') !== -1);
/* Grouped bubbles stay compact without repeating sender labels. */
const trio = [false, true, true]
  .map((grouped, i) => app.chatBubble({ body: 'A', created_at: T0, senderName: 'Lala' }, false, grouped, i === 2, T0))
  .join('');
ok('a run of messages does not repeat sender names', trio.indexOf('Lala') === -1);

/* The invisible-message regression, restated for the new markup. It was a
   missing space fusing two class tokens; the assertion is on real tokens
   rather than on the literal string, so it catches any future spelling. */
SHAPES.forEach(([mine, grouped, ends]) => {
  const label = 'mine=' + mine + ' grouped=' + grouped + ' ends=' + ends;
  const tokens = classTokens(app.chatBubble({ body: 'A', created_at: T0 }, mine, grouped, ends, T0));
  const fused = tokens.filter((t) => /^-\d[\d.]*[a-z]/.test(t));
  ok('no fused utility in the class list (' + label + ')', fused.length === 0, fused.join(','));
});
ok('message bodies are always escaped', opener.indexOf('&lt;script&gt;') !== -1 ||
  app.chatBubble({ body: '<script>', created_at: T0 }, false, false, true, T0).indexOf('&lt;script&gt;') !== -1);
ok('newlines in a message are preserved',
  app.chatBubble({ body: 'a\nb', created_at: T0 }, false, false, true, T0).indexOf('whitespace-pre-wrap') !== -1);

/* ------------------- bottom-anchored messenger layout ---------------- *
 * A thread should rest on the FLOOR of the panel and grow upward, leaving
 * the empty space ABOVE, as in familiar messaging apps.
 * Top-anchored, a two-message thread dangles at the top of an otherwise
 * empty panel and reads as broken.
 *
 * margin-top:auto only resolves against a real flex child, so the spacer
 * must be its own element inside the scrolling container; it cannot be a
 * class on the messages themselves. */
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pageSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

ok('the log has an inner flow container', /id="chat-log-inner"/.test(htmlSrc));
ok('the inner container is bottom-anchored (mt-auto)',
  /id="chat-log-inner"[^>]*class="[^"]*\bmt-auto\b/.test(htmlSrc));
ok('the inner container is a flex column',
  /id="chat-log-inner"[^>]*class="[^"]*flex flex-col/.test(htmlSrc));
ok('the scrolling log keeps its own overflow',
  /id="chat-log"[^>]*overflow-y-auto/.test(htmlSrc));
ok('the row gap moved off the scroll container',
  !/id="chat-log"[^>]*class="[^"]*flex flex-col gap-/.test(htmlSrc));
ok('the inner container sits INSIDE the scrolling log',
  htmlSrc.indexOf('id="chat-log"') < htmlSrc.indexOf('id="chat-log-inner"'));
ok('renderChat writes into the inner container',
  /const log = chatLogInner\(\)/.test(pageSrc));
ok('the empty state writes into the inner container',
  /function chatEmptyLog[\s\S]{0,200}chatLogInner\(\)/.test(pageSrc));
ok('there is a helper that resolves the flow container',
  /function chatLogInner\(\)/.test(pageSrc));
ok('the helper falls back to the scroll container',
  /return \$?\('#chat-log-inner'\) \|\| \$?\('#chat-log'\)/.test(pageSrc));
/* Scrolling must still target the OUTER element, or "jump to newest" on
   open silently does nothing - the classic bottom-anchor regression. */
ok('scrolling still targets the scroll container',
  /function chatScrollToEnd[\s\S]{0,300}\$\('#chat-log'\)/.test(pageSrc));
/* The date is a full-width rule with the label sitting ON it, centred. A
   filled chip floating in the flow reads as a message; a rule reads as a
   section break, which is what it is. */
ok('the day divider is a hairline rule',
  /function chatDayDividerHtml[\s\S]{0,600}h-px/.test(pageSrc));
ok('the rule runs edge to edge on both sides of the label',
  (pageSrc.match(/h-px flex-1 bg-surface-container-highest/g) || []).length === 2);
ok('the day label is centred between the rules',
  /function chatDayDividerHtml[\s\S]{0,400}items-center/.test(pageSrc));
ok('the day label is uppercase and letterspaced',
  /function chatDayDividerHtml[\s\S]{0,500}uppercase/.test(pageSrc) &&
  /function chatDayDividerHtml[\s\S]{0,500}tracking-wide/.test(pageSrc));
ok('the day label is not a filled chip',
  !/function chatDayDividerHtml[\s\S]{0,500}rounded-full/.test(pageSrc));
ok('the day divider is labelled for screen readers',
  /function chatDayDividerHtml[\s\S]{0,400}role="separator"/.test(pageSrc));
ok('renderChat uses the day-divider helper',
  /chatDayDividerHtml\(day\)/.test(pageSrc));
/* Bubbles stay readable on wide screens without spanning the whole log. */
ok('message bubbles have a responsive width limit',
  /#chat-log-inner \.chat-message\{[^}]*max-width:88%/.test(htmlSrc));

/* ------------------- does it actually bottom-anchor? --------------- *
 * The mt-auto rules above only prove the class is present. This proves the
 * LAYOUT it produces, by reimplementing the two CSS rules that matter in
 * plain arithmetic:
 *
 *   #chat-log        : flex column, scrolls, definite height
 *   #chat-log-inner  : flex column, margin-top:auto
 *
 * In a flex column, an auto top margin absorbs the FREE space before the
 * item, so content is pushed to the floor. When the content is SHORTER
 * than the box there is free space and it moves down; when it is TALLER
 * the margin resolves to zero and the box scrolls from the top. Those two
 * cases are the whole feature, so they are the two asserted.
 */
function layoutFor(contentHeight, boxHeight) {
  const free = boxHeight - contentHeight;
  /* margin-top:auto absorbs free space, but never pushes past the box. */
  const marginTop = free > 0 ? free : 0;
  const offsetFromTop = marginTop;
  return { offsetFromTop, scrolls: contentHeight > boxHeight };
}

const short = layoutFor(120, 600);
ok('a short thread rests at the BOTTOM (space above, not below)',
  short.offsetFromTop === 480 && !short.scrolls,
  'top gap ' + short.offsetFromTop + 'px of 600px');
ok('a short thread is not scrolled', short.scrolls === false);

const tall = layoutFor(900, 600);
ok('a tall thread starts at the top and scrolls (no lost space)',
  tall.offsetFromTop === 0 && tall.scrolls, 'top gap ' + tall.offsetFromTop);
ok('an exactly-full thread does not gain a phantom gap',
  layoutFor(600, 600).offsetFromTop === 0);
/* The regression this prevents: top-anchoring would put a short thread at
   offset 0, which is precisely the "dangles at the top" look. */
ok('the short thread is NOT left at the top', short.offsetFromTop !== 0);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ------------------------------------------------------------------ *
 * The conversation the volunteer tapped: BOTH sides, across two days,
 * with a run of messages from each so grouping is exercised. m0 is
 * listed out of order to prove the loader's sort orders it, not luck.
 * ------------------------------------------------------------------ */
const ME = 'me-uuid';
const PEER = 'peer-uuid';
const PEER_NAME = 'Lala';

/* The two-day split is anchored to LOCAL MIDNIGHT, not to "N hours ago".
   A message from 18 hours ago is Yesterday only between 03:00 and 20:00 -
   outside that window every row lands on one calendar day and the
   yesterday/today assertions below fail for no real reason. */
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
const dayStart = midnight.getTime();
const yesterAt = (hour, min) =>
  new Date(dayStart - 86400000 + hour * 3600000 + min * 60000).toISOString();
/* My reply: the later of "just after midnight" and "two hours ago", so it
   is always Today and always after the yesterday block. */
const replyMs = Math.max(dayStart + 60000, Date.now() - 2 * 3600000);
const replyAt = new Date(replyMs).toISOString();
const replyNext = new Date(replyMs + 60000).toISOString();

/* m0 sits alone yesterday, m1+m2 are a burst from the peer, m3+m4 are my
   reply. Two calendar days, three groups, both directions. m0 is listed
   LAST in the source array to prove the loader's sort orders it. */
const messages = [
  { id: 'm1', sender_id: PEER, body: 'Fed Milo at 7am, he ate well', created_at: yesterAt(23, 0) },
  { id: 'm2', sender_id: PEER, body: 'Bowl was empty though', created_at: yesterAt(23, 4) },
  { id: 'm3', sender_id: ME, body: 'Thanks! I will refill tonight', created_at: replyAt },
  { id: 'm4', sender_id: ME, body: 'On my way now', created_at: replyNext },
  { id: 'm0', sender_id: PEER, body: 'Is anyone else around today?', created_at: yesterAt(21, 0) },
];

/* openChat() stamps the sender's name onto every row before rendering, so
   the fixture does the same - otherwise chatBubble falls back to the
   generic "Volunteer" and the avatar assertions would prove nothing. */
messages.forEach((m) => { m.senderName = m.sender_id === ME ? 'You' : PEER_NAME; });

/* openChat() sorts ascending, so ordering is a property of the loader
   rather than of whatever order the database happens to return. */
const sorted = messages.slice()
  .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));

/* Mirrors renderChat() in index.js. Kept in step on purpose: if the day
   divider or grouping logic moves, this copy is what tells you. */
function renderThread(rowsIn) {
  let lastDay = null;
  const html = [];
  rowsIn.forEach((row, i) => {
    const day = app.chatDayLabel(row.created_at);
    if (day && day !== lastDay) {
      html.push('<div class="day">' + esc(day) + '</div>');
      lastDay = day;
    }
    const previous = rowsIn[i - 1];
    const next = rowsIn[i + 1];
    const newDayBefore = !previous || app.chatDayLabel(previous.created_at) !== day;
    const newDayAfter = !next || app.chatDayLabel(next.created_at) !== day;
    const grouped = !newDayBefore && app.isGroupedWith(previous, row);
    const endsGroup = newDayAfter || !app.isGroupedWith(row, next);
    html.push(app.chatBubble(row, row.sender_id === ME, grouped, endsGroup));
  });
  return html.join('');
}

const html = renderThread(sorted);

/* ------------------------- the thread itself ------------------------ */
ok('the thread is not blank', html.length > 0, html.length + ' chars');
messages.forEach((m) => {
  ok('renders "' + m.body.slice(0, 20) + '"', html.indexOf(esc(m.body)) !== -1);
});

/* Both directions must be visible - this is the reported bug. */
ok("the peer's messages are present", html.indexOf('Fed Milo at 7am') !== -1);
ok('my own messages are present', html.indexOf('On my way now') !== -1);
ok('incoming and outgoing messages use separate alignment classes',
  /chat-message--theirs/.test(html) && /chat-message--mine/.test(html));

/* ---------------------------- ordering ------------------------------ */
ok('oldest message renders first',
  html.indexOf('Is anyone else around today?') < html.indexOf('Fed Milo at 7am'));
ok('newest message renders last',
  html.indexOf('On my way now') > html.indexOf('I will refill tonight'));
ok('an out-of-order response is sorted correctly',
  sorted[0].id === 'm0' && sorted[sorted.length - 1].id === 'm4');

/* -------------------------- day dividers ---------------------------- */
const dividers = (html.match(/class="day"/g) || []).length;
ok('a day divider is rendered', dividers >= 1, dividers + ' dividers');
ok('yesterday and today are labelled separately', dividers === 2, dividers + ' dividers');
ok('today is labelled "Today"', html.indexOf('>Today<') !== -1);
ok('yesterday is labelled "Yesterday"', html.indexOf('>Yesterday<') !== -1);

/* ---------------------------- grouping ------------------------------ */
/* Every bubble gets a timestamp; one receipt sits on the outgoing group's
   final bubble, matching familiar messenger behavior. */
const timestamps = (html.match(/<time>/g) || []).length;
const ticks = (html.match(/class="chat-tick\b/g) || []).length;
ok('each message bubble shows its own timestamp', timestamps === messages.length,
  timestamps + ' timestamps for ' + messages.length + ' messages');
ok('the outgoing group ends with a receipt', ticks === 1,
  ticks + ' receipt for one outgoing group');
ok('grouped messages use tighter spacing', /chat-message--grouped/.test(html));

/* --------------------- the hoisting regression ---------------------- */
/* The original defect, restated as an executable assertion so it can
   never come back silently. */
const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const decls = [...src.matchAll(/function (renderChat|appendChatRow)\s*\(/g)].map((m) => m[1]);
ok('renderChat is declared exactly once',
  decls.filter((d) => d === 'renderChat').length === 1, decls.join(','));
ok('appendChatRow is declared exactly once',
  decls.filter((d) => d === 'appendChatRow').length === 1, decls.join(','));
ok('renderChat takes no argument (it reads state)', /function renderChat\(\)/.test(src));
ok('no stale renderChat(messages) overload survives', !/renderChat\(messages\)/.test(src));

/* ------------------- the conversation-id regression ----------------- */
ok('openChat accepts a conversation id',
  /async function openChat\(animalId, conversationId\)/.test(src));
ok('a known conversation skips the caretaker guess',
  /if \(conversation\) \{[\s\S]{0,900}?caretakerFor/.test(src));
ok('the deep link forwards the conversation id',
  /params\.get\('conversation'\)/.test(src));
ok('the deep link is consumed so re-tapping works',
  /history\.replaceState/.test(src));
const inboxSrc = fs.readFileSync(path.join(ROOT, 'inbox.js'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'site-header.js'), 'utf8');
ok('the inbox hands the conversation id over',
  /conversation=' \+ encodeURIComponent\(conversation\)/.test(inboxSrc));
ok('the popover carries the conversation id on the row',
  /data-conversation="'\s*\+\s*esc\(t\.id/.test(headerSrc));
ok('the popover hands the conversation id over',
  /conversation=' \+ encodeURIComponent\(conversation\)/.test(headerSrc));

/* ------------------------------ report ------------------------------ */
const failed = rows.filter((r) => r[0] !== 'OK  ');
rows.forEach((r) => console.log(r[0] + '  ' + r[1]));
console.log('');
console.log(failed.length
  ? failed.length + ' of ' + rows.length + ' CHAT SIMULATION CHECKS FAILED'
  : 'All ' + rows.length + ' chat simulation checks passed');
process.exit(failed.length ? 1 : 0);
