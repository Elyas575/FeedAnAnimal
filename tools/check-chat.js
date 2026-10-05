/* CHAT / DM checks (MVP Phase 5).
 *
 *   node tools/check-chat.js
 *
 * Chat has no localStorage fallback on purpose - a message is only
 * useful if the other volunteer receives it - so there is no local store
 * to test the way forum.js has one. What IS testable headlessly is the
 * part that silently rots: the pure bubble renderer (escaping, own vs
 * theirs alignment), the RLS invariants the SQL depends on, and the
 * wiring that the browser would otherwise only reveal at runtime.
 *
 * The two regressions this file exists to prevent:
 *   1. sbSendMessage must include sender_id, or every send is rejected
 *      by the "participants send messages" RLS policy.
 *   2. The realtime channel must be released on close, or a leaked
 *      subscription keeps firing into a detached DOM node.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const rows = [];
const ok = (label, pass, detail) => rows.push([pass ? 'OK  ' : 'MISS', label + (detail === undefined ? '' : '  ->  ' + detail)]);

const app = require(path.join(ROOT, 'index.js'));
const inbox = require(path.join(ROOT, 'inbox.js'));
const header = require(path.join(ROOT, 'site-header.js'));
const client = fs.readFileSync(path.join(ROOT, 'supabase-client.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const inboxSrc = fs.readFileSync(path.join(ROOT, 'inbox.js'), 'utf8');
const inboxHtml = fs.readFileSync(path.join(ROOT, 'inbox.html'), 'utf8');
const headerSrc = fs.readFileSync(path.join(ROOT, 'site-header.js'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-chat.sql'), 'utf8');

/* ---------------------------- message bubbles ----------------------- *
 * The thread follows LinkedIn: plain body text on the panel surface under a
 * name+time header, NOT a filled bubble. A coloured pill per line made a
 * long note read as a stack of fragments and pulled the eye off the words,
 * so the bubbles were replaced by the structure asserted below. Describing
 * the new design here is deliberate: it stops the bubbles creeping back. */
const now = new Date().toISOString();
const mine = app.chatBubble({ body: 'is Milo still around?', created_at: now }, true, false, true);
const theirs = app.chatBubble({ body: 'Fed him at 7am', created_at: now }, false, false, true);

ok('messages are NOT filled bubbles',
  mine.indexOf('bg-primary') === -1 && theirs.indexOf('bg-surface-container') === -1);
ok('the message text uses the on-surface colour', theirs.indexOf('text-on-surface') !== -1);
/* One header per GROUP - a name repeated on every line is what makes a
   transcript look like a transcript. */
ok('my message is labelled "You"', mine.indexOf('>You<') !== -1);
ok('their message names the sender',
  app.chatBubble({ body: 'x', created_at: now, senderName: 'Lala' }, false, false, true).indexOf('>Lala<') !== -1);
ok('the header shows a time', /just now|Today|\d{1,2}:\d{2}|Jan|Feb|Mar/.test(mine));
/* Continuations indent under the header rather than repeating it. That
   indent, not a bubble tail, is what fuses a run together. */
ok('a grouped message is indented under the header',
  app.chatBubble({ body: 'x', created_at: now }, false, true, false).indexOf('pl-9') !== -1);
ok('a grouped message repeats no name',
  app.chatBubble({ body: 'x', created_at: now, senderName: 'Lala' }, false, true, false).indexOf('Lala') === -1);
ok('a grouped message repeats no avatar',
  app.chatBubble({ body: 'x', created_at: now, senderName: 'Lala' }, false, true, false).indexOf('title="Lala"') === -1);
ok('an opening message is not indented',
  app.chatBubble({ body: 'x', created_at: now }, false, false, true).indexOf('pl-9') === -1);
/* The read tick still appears only on my own messages. */
ok('their messages carry no read tick', theirs.indexOf('chat-tick') === -1);
ok('my message carries a read tick', mine.indexOf('chat-tick') !== -1);

/* The body is free text written by another volunteer, so it must be
   escaped exactly like every other rendered string in this app. */
const evil = app.chatBubble({ body: '<img src=x onerror=alert(1)><script>alert(2)</script>', created_at: now }, false, false, true);
ok('message bodies escape script tags', evil.indexOf('<script>') === -1);
ok('message bodies escape injected images', evil.indexOf('<img src=x') === -1);
ok('message bodies still show the raw text', evil.indexOf('&lt;script&gt;') !== -1);
ok('the message renders newlines as pre-wrap', mine.indexOf('whitespace-pre-wrap') !== -1);
ok('their messages show a sender avatar', theirs.indexOf('w-7 h-7') !== -1);

/* ------------------------------ grouping ---------------------------- *
 * The behaviour that makes a thread read as a conversation: bursts from one
 * person collapse, a change of speaker starts a new group, and a long gap
 * breaks a run even from the same person. */
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const mineId = 'me-1';
const themId = 'them-1';
ok('same sender, close in time, groups',
  app.isGroupedWith({ sender_id: themId, created_at: ago(5) }, { sender_id: themId, created_at: ago(1) }) === true);
ok('a different sender starts a new group',
  app.isGroupedWith({ sender_id: themId, created_at: ago(5) }, { sender_id: mineId, created_at: ago(1) }) === false);
ok('the same sender after a gap starts a new group',
  app.isGroupedWith({ sender_id: themId, created_at: ago(40) }, { sender_id: themId, created_at: ago(1) }) === false);
ok('nothing groups with the first message',
  app.isGroupedWith(null, { sender_id: themId, created_at: ago(1) }) === false);
ok('a missing timestamp never groups',
  app.isGroupedWith({ sender_id: themId, created_at: ago(1) }, { sender_id: themId }) === false);

/* Chat timestamps show the clock, not "5m ago": inside a live thread the
   volunteer needs to know whether a message came before or after a feed. */
ok('a fresh message reads as just now', app.chatTime(new Date().toISOString()) === 'just now');
ok('an older message shows the clock', /\d{1,2}:\d{2}/.test(app.chatTime(ago(20))), app.chatTime(ago(20)));
ok('yesterday shows a date', /\d{1,2}:\d{2}/.test(app.chatTime(ago(60 * 40))));
ok('a broken timestamp does not throw', app.chatTime('nonsense') === '');

/* ------------------------------ validation -------------------------- */
ok('empty messages are rejected', !!app.chatValidate('   '));
ok('null messages are rejected', !!app.chatValidate(null));
ok('ordinary messages pass', app.chatValidate('on my way with tuna') === null);
ok('messages cap at 2000', !!app.chatValidate('x'.repeat(2001)));
ok('a 2000-char message is allowed', app.chatValidate('x'.repeat(2000)) === null);

/* --------------------------- the sender_id bug ----------------------- *
 * THE regression this file exists for. The messages INSERT policy checks
 * sender_id = auth.uid(). A nullable column is NOT the same as an
 * optional one, so omitting sender_id makes every send fail with an RLS
 * error that looks nothing like "you forgot a column". */
ok('sbSendMessage sets sender_id', client.indexOf('sender_id: user.id') !== -1);
ok('the send wrapper explains why it is required',
  client.indexOf('sender_id is NOT optional') !== -1);
ok('the old snippet bug is called out', client.indexOf('chat-snippets.js') !== -1);

/* ------------------------- realtime channel leak --------------------- *
 * A channel that outlives the modal keeps delivering into a detached
 * node, and reopening stacks another subscription on top of it. Both
 * close paths must release it: Escape/backdrop use closeAllModals, the X
 * button uses closeModal. */
ok('stopChat() exists', js.indexOf('function stopChat') !== -1);
ok('stopChat removes the channel', js.indexOf('client.removeChannel(state.chat.channel)') !== -1);
ok('closing via closeModal stops the chat', /id === 'chat-modal'\) stopChat\(\)/.test(js));
ok('closing via closeAllModals stops the chat', /function closeAllModals\(\)[\s\S]{0,400}stopChat\(\)/.test(js));
ok('opening a thread drops the previous subscription', /async function openChat[\s\S]{0,300}stopChat\(\)/.test(js));

/* ---------------------------- dedupe of echoes ----------------------- *
 * Our own send is rendered from the insert response and then echoed back
 * over realtime. Without an id-keyed guard the volunteer sees their own
 * message twice. */
ok('seenIds tracks rendered rows', js.indexOf('seenIds') !== -1);
ok('appendChatRow ignores rows already shown', /function appendChatRow[\s\S]{0,300}seenIds\[row\.id\]\) return/.test(js));
ok('realtime appends through the same dedupe path',
  /subscribe\(conversation, \(row\) => \{[\s\S]{0,200}appendChatRow\(row\)/.test(js));

/* --------------------- the duplicate-declaration bug ----------------- *
 * THE regression that shipped. index.js had TWO renderChat and TWO
 * appendChatRow declarations; function declarations hoist, so the LAST
 * one won, and the stale renderChat(messages) took over. openChat calls
 * renderChat() with no argument, so every thread threw a TypeError and
 * stayed blank - while all 197 checks below passed, because they assert
 * on source text, never on whether a thread renders.
 *
 * One declaration each, and the parameterless signature the state-driven
 * renderer actually uses. tools/simulate-chat.js renders a real thread
 * on top of this. */
const chatDecls = [...js.matchAll(/function (renderChat|appendChatRow)\s*\(/g)].map((m) => m[1]);
ok('renderChat is declared exactly once',
  chatDecls.filter((d) => d === 'renderChat').length === 1, chatDecls.join(','));
ok('appendChatRow is declared exactly once',
  chatDecls.filter((d) => d === 'appendChatRow').length === 1, chatDecls.join(','));
ok('renderChat reads state rather than taking a list',
  /function renderChat\(\)/.test(js));
ok('no stale renderChat(messages) overload survives', !/renderChat\(messages\)/.test(js));
ok('openChat can open a KNOWN conversation',
  /async function openChat\(animalId, conversationId\)/.test(js));
ok('a known conversation is not re-derived from the caretaker',
  /if \(conversation\) \{[\s\S]{0,900}?caretakerFor/.test(js));

/* -------------------------- the day divider ------------------------- *
 * A thread spanning two days needs a divider, or "when was that?" is
 * unanswerable. Labels are calendar days, not a rolling 24h window. */
ok('chatDayLabel exists', typeof app.chatDayLabel === 'function');
const today = new Date();
ok('a message from now reads as Today', app.chatDayLabel(today.toISOString()) === 'Today');
ok('a message from yesterday reads as Yesterday',
  app.chatDayLabel(new Date(today.getTime() - 26 * 3600000).toISOString()) === 'Yesterday');
ok('a message from last week gets a date, not a relative word',
  !/Today|Yesterday/.test(app.chatDayLabel(new Date(today.getTime() - 9 * 86400000).toISOString())));
ok('an unparseable date yields no label', app.chatDayLabel('not-a-date') === '');
ok('renderChat emits a day divider', /role="separator"/.test(js));

/* ------------------------------- the page ---------------------------- */
ok('page has the chat modal', html.indexOf('id="chat-modal"') !== -1);
ok('chat modal opts into the modal system', /id="chat-modal"[^>]*data-modal/.test(html));
ok('chat modal is labelled for screen readers', html.indexOf('aria-labelledby="chat-title"') !== -1);
ok('chat modal stacks above the details modal', /id="chat-modal"[^>]*z-\[85\]/.test(html));
ok('details modal is below it', /id="details-modal"[^>]*z-\[75\]/.test(html));
ok('page has a message log', html.indexOf('id="chat-log"') !== -1);
ok('the log is a live region', /id="chat-log"[^>]*aria-live="polite"/.test(html));
ok('page has a composer form', html.indexOf('id="chat-form"') !== -1);
ok('page has a message input', html.indexOf('id="chat-input"') !== -1);
ok('the input caps length at CHAT_MAX', html.indexOf('maxlength="2000"') !== -1);
ok('page has a send button', html.indexOf('id="chat-send"') !== -1);
ok('page has a block button', html.indexOf('id="chat-block"') !== -1);
ok('page has a gate for when chat cannot be used', html.indexOf('id="chat-gate"') !== -1);
ok('the composer starts hidden', /id="chat-form"[^>]*class="hidden/.test(html));
ok('the gate starts hidden', /id="chat-gate"[^>]*class="hidden/.test(html));

/* ---------------------------- details drawer ------------------------- */
ok('details drawer offers Message caretaker',
  js.indexOf('data-action="message"') !== -1 && js.indexOf('Message caretaker') !== -1);
ok('the message action opens the thread', /action === 'message'[\s\S]{0,160}openChat\(id\)/.test(js));
ok('the details modal stays open behind the thread',
  /action === 'message'[\s\S]{0,60}\{\s*\n\s*openChat\(id\);/.test(js));

/* ------------------------------- the card ---------------------------- *
 * Chat must be reachable from the sidebar card itself. The details drawer
 * is two taps and a scroll away, and "who looked after this last?" is the
 * natural next question after "is it fed?" - so the card carries its own
 * button rather than hiding the only entry point behind the info icon. */
ok('the animal card has a chat button', /function cardHtml[\s\S]{0,6000}data-action="message"/.test(js));
ok('the card chat button uses the chat icon',
  /data-action="message"[\s\S]{0,400}>chat</.test(js));
ok('the card chat button carries the animal id', /data-action="message" data-id="/.test(js));
ok('the card chat button is labelled for screen readers',
  /data-action="message"[\s\S]{0,400}aria-label="Message whoever cared for/.test(js));
ok('the card chat button explains itself on hover',
  /data-action="message"[\s\S]{0,200}title="Message whoever cared for/.test(js));
/* Both entry points share one handler, so neither can drift. */
ok('the card and the drawer use the same action name',
  (js.match(/data-action="message"/g) || []).length >= 2);
ok('only one message handler exists', (js.match(/action === 'message'/g) || []).length === 1);
/* Card buttons are delegated, so the handler must sit before any early
   return that a card click could hit. */
ok('the message button carries a data-id for delegation',
  /data-action="message" data-id="[^"]*"/.test(js));

/* ------------------------------- wiring ----------------------------- */
ok('the send button submits the form', /chatForm\.addEventListener\('submit'/.test(js));
ok('Enter sends without shift', /event\.key === 'Enter' && !event\.shiftKey/.test(js));
ok('the composer hints at Shift+Enter', html.indexOf('Shift+Enter') !== -1);
ok('the block button is wired', js.indexOf('chatBlock.addEventListener') !== -1);
ok('blocking asks for confirmation', js.indexOf("window.confirm('Block '") !== -1);

/* ------------------------------ honesty ------------------------------ *
 * Chat cannot fall back to local storage, so every failure mode has to
 * say something. A silently swallowed failure looks like a broken feature. */
ok('anonymous visitors are pointed at sign in', js.indexOf('auth.html') !== -1);
ok('sign-in copy says feeds still work anonymously', js.indexOf('logging a feed still works without one') !== -1);
ok('a missing caretaker is explained', js.indexOf('Nobody has signed in to care for') !== -1);
ok('a blocked send is explained', js.indexOf("result.error === 'blocked'") !== -1);
ok('a failed send is explained', js.indexOf('Message not sent') !== -1);
ok('the block state is tracked', js.indexOf('state.chat.blocked') !== -1);
ok('the block button flips to Unblock', js.indexOf("next ? 'Unblock' : 'Block'") !== -1);
ok('sending is refused while blocked',
  /state\.chat\.blocked\)[\s\S]{0,200}Unblock this volunteer before sending/.test(js));

/* ------------------------------ the API ------------------------------ */
['sbRequireEmail', 'sbCaretakerFor', 'sbOpenDm', 'sbListMessages',
  'sbSendMessage', 'sbDmPeers', 'sbSetBlock', 'sbSubscribeDm'].forEach((fn) => {
  ok('client defines ' + fn + '()', client.indexOf('function ' + fn + '(') !== -1);
  ok('client exposes ' + fn + ' on window', client.indexOf('window.' + fn + ' = ' + fn + ';') !== -1);
});

/* Chat degrades to null (never a fake success) when the tables are
   absent, matching every other wrapper in this file. */
ok('wrappers return null when Supabase is missing', client.indexOf('if (!sb) return null;') !== -1);
ok('wrappers warn instead of throwing', client.indexOf("console.warn('[sb] list messages failed:'") !== -1);
ok('sbRequireEmail rejects anonymous sessions', /is_anonymous/.test(client));
ok('the caretaker lookup excludes yourself', /excludeId && rows\[i\]\.actor_id === excludeId/.test(client));
ok('the caretaker lookup skips null actors', client.indexOf(".not('actor_id', 'is', null)") !== -1);
ok('the caretaker lookup takes the most recent', /order\('created_at', \{ ascending: false \}\)/.test(client));
ok('messages read oldest-first', /order\('created_at', \{ ascending: true \}\)/.test(client));
ok('deleted messages are filtered out', client.indexOf(".eq('is_deleted', false)") !== -1);
ok('block uses upsert so double-blocking cannot throw',
  client.indexOf("onConflict: 'blocker_id,blocked_id'") !== -1);
ok('unblock deletes the row', /sb\.from\('blocks'\)\.delete\(\)/.test(client));
ok('realtime is filtered to the open conversation', client.indexOf("filter: 'conversation_id=eq.'") !== -1);

/* ------------------------------- the SQL ----------------------------- *
 * These tables are already live, so the client depends on their exact
 * shape. Asserting it here means a schema edit that breaks chat fails
 * the test run instead of production. */
ok('SQL creates conversations', sql.indexOf('create table if not exists conversations') !== -1);
ok('SQL creates participants', sql.indexOf('create table if not exists conversation_participants') !== -1);
ok('SQL creates messages', sql.indexOf('create table if not exists messages') !== -1);
ok('SQL creates blocks', sql.indexOf('create table if not exists blocks') !== -1);
ok('the send policy checks sender_id', /sender_id = auth\.uid\(\)/.test(sql));
ok('the send policy blocks anyone on a block list',
  /participants send messages[\s\S]{0,400}blocked_id = auth\.uid\(\)/.test(sql));
ok('messages cap the body length', sql.indexOf('between 1 and 2000') !== -1);
ok('the DM lookup RPC exists', sql.indexOf('get_or_create_dm') !== -1);
ok('the RPC refuses self-DMs', sql.indexOf('cannot DM yourself') !== -1);
ok('the RPC requires authentication', sql.indexOf('not authenticated') !== -1);
ok('only participants can read a conversation', sql.indexOf('is_conversation_participant(conversations.id)') !== -1);
ok('only participants can read messages', sql.indexOf('is_conversation_participant(messages.conversation_id)') !== -1);
ok('you cannot add yourself to someone elses DM', sql.indexOf('"auth join convo"') !== -1);
ok('blocking is scoped to the blocker', sql.indexOf('blocker_id = auth.uid()') !== -1);

/* --------------------------- the events FK trap ----------------------- *
 * The trap this feature inherited: `events.animal_id` was declared
 * `references animals(id)`, but the animals table was emptied on purpose
 * (cleanup-seed-data.sql) because the map now grows from real reports.
 * Every shared feed is therefore rejected by Postgres, and chat has no
 * events to resolve a caretaker from. The migration drops the FK; these
 * assertions stop it being re-added by a careless schema re-run. */
const fkSql = fs.readFileSync(path.join(ROOT, 'supabase', 'migration-drop-events-fk.sql'), 'utf8');
ok('a migration exists to drop the events FK', fkSql.indexOf('drop constraint if exists events_animal_id_fkey') !== -1);
ok('the FK migration drops the station FK too', fkSql.indexOf('events_station_id_fkey') !== -1);
ok('the FK migration is re-runnable', fkSql.indexOf('if exists') !== -1);
ok('the FK migration explains why', fkSql.indexOf('cleanup-seed-data.sql') !== -1);
/* schema-core.sql is the file a re-run would re-add the FK from. */
const coreSql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-core.sql'), 'utf8');
ok('schema-core no longer declares the events animal FK',
  !/animal_id text references animals/.test(coreSql));
ok('events.animal_id is still a plain column',
  /animal_id text/.test(coreSql));

/* The SAME trap existed on conversations.animal_id, and fixing only events
 * left chat broken while the shared feed looked healthy. Both tables must be
 * covered, or the next person to hit this sees "That conversation could not
 * be opened" with no clue why. */
const chatSql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema-chat.sql'), 'utf8');
ok('the migration also drops the conversations FK',
  fkSql.indexOf('conversations_animal_id_fkey') !== -1);
ok('schema-chat no longer declares the conversations animal FK',
  !/animal_id text references animals/.test(chatSql));
ok('conversations.animal_id is still a plain column',
  /animal_id text/.test(chatSql));
/* The FK error is deliberately not shown to the volunteer - they cannot act on
   "violates foreign key constraint" - so the gate must name the real fix. */
ok('the failure gate names the migration',
  /migration-drop-events-fk\.sql/.test(js));
ok('the failure gate points at the console',
  /chatGate\([\s\S]{0,200}F12/.test(js));

/* --------------------------- the header bell ------------------------- *
 * A LinkedIn-style Messaging entry: the Chats nav item IS the bell - an
 * icon-over-label button with an unread pill that drops a thread list.
 * The badge, the popover and inbox.html must all read the SAME sbInbox()
 * or they will disagree about what is unread. */
ok('header has a chat bell button', headerSrc.indexOf('id="fta-chat-btn"') !== -1);
ok('the bell is a labelled dialog trigger', /id="fta-chat-btn"[\s\S]{0,300}aria-haspopup="true"/.test(headerSrc));
ok('the bell carries an unread badge', /data-chat-badge="desktop"/.test(headerSrc));
ok('the bell is the Chats nav item', /id:\s*'inbox',\s*label:\s*'Chats'[\s\S]{0,160}chatButton:\s*true/.test(headerSrc));
ok('the bell is icon-over-label', headerSrc.indexOf('fta-nav-item') !== -1 && headerSrc.indexOf('fta-nav-label') !== -1);
ok('the bell keeps its active state', header.BOTTOM_TABS && header.LINKS.some((l) => l.id === 'inbox' && l.chatButton));
ok('the nav renders all six items', header.LINKS.length === 6);
ok('the popover exists', headerSrc.indexOf('id="fta-chat-pop"') !== -1);
ok('the popover starts hidden', /id="fta-chat-pop" hidden/.test(headerSrc));
ok('the popover has a thread list', headerSrc.indexOf('id="fta-chat-list"') !== -1);
ok('the popover links to the full inbox', /href="inbox\.html"[\s\S]{0,80}See all/.test(headerSrc));
ok('the popover closes on Escape', /event\.key === 'Escape'/.test(headerSrc));
ok('the popover closes on outside click', /!pop\.contains\(event\.target\)/.test(headerSrc));
ok('icon clicks do not count as outside', headerSrc.indexOf('!btn.contains(event.target)') !== -1);
ok('opening the popover loads the inbox', /loadChatBell\(\)/.test(headerSrc));
ok('both badges are painted from one count', /querySelectorAll\('\[data-chat-badge\]'\)/.test(headerSrc));
ok('the badge is hidden at zero', /else el\.setAttribute\('hidden', ''\)/.test(headerSrc));
ok('the badge caps at 99+', /99\+/.test(headerSrc));
ok('a popover row shows who and when', /chatPopRow/.test(headerSrc) && /chatAgo/.test(headerSrc));
ok('a popover row shows the animal', /about ' \+ esc\(t\.animalName\)/.test(headerSrc));
ok('the popover row escapes names', /esc\(who\)/.test(headerSrc));
ok('the bell degrades without sbInbox',
  /if \(typeof inbox !== 'function'\) return;/.test(headerSrc));

/* --------------------------- the mobile tab ------------------------- *
 * Chats replaces About in the bottom bar: on a phone that bar is the only
 * persistent nav. About must survive in the desktop nav + footers. */
ok('the bottom bar has a Chats tab', /id:\s*'inbox',\s*label:\s*'Chats'/.test(headerSrc));
ok('Chats points at inbox.html', /id:\s*'inbox',\s*label:\s*'Chats'[\s\S]{0,120}href: 'inbox\.html'/.test(headerSrc));
ok('Chats uses the forum icon', /id:\s*'inbox'[\s\S]{0,120}icon: 'forum'/.test(headerSrc));
ok('the Chats tab can carry a badge', /label: 'Chats'[\s\S]{0,120}badge: true/.test(headerSrc));
ok('the mobile tab renders the badge slot', /data-chat-badge="mobile"/.test(headerSrc));
ok('About is gone from the bottom bar', !/BOTTOM_TABS = \[[\s\S]{0,900}label: 'About'/.test(headerSrc));
ok('the bottom bar keeps four tabs', header.BOTTOM_TABS.length === 4);
ok('only the Chats tab shows a badge', header.BOTTOM_TABS.filter((l) => l.badge).length === 1);
ok('About survives in the desktop nav', header.LINKS.some((l) => l.id === 'about'));

/* ---------------------------- the inbox page ------------------------ */
ok('page has a title', inboxHtml.indexOf('<title>Messages') !== -1);
ok('page loads the supabase client', inboxHtml.indexOf('src="supabase-client.js"') !== -1);
ok('page loads inbox.js', inboxHtml.indexOf('src="inbox.js"') !== -1);
ok('page uses the shared header', inboxHtml.indexOf('id="site-header"') !== -1);
ok('page has a thread list', inboxHtml.indexOf('id="list"') !== -1);
ok('page has an empty state', inboxHtml.indexOf('id="empty"') !== -1);
/* The inbox is per-account and must never be indexed. */
ok('the inbox is not indexed', /name="robots" content="noindex/.test(inboxHtml));
ok('the inbox needs a signed-in volunteer', /sbRequireEmail/.test(inboxSrc));

/* ------------------------------ inbox rows -------------------------- */
const thread = {
  id: 'c1', animalId: 'milo', animalName: 'Milo', peerId: 'p1',
  peerName: 'Priya N.', lastBody: 'on my way', lastAt: new Date().toISOString(),
  lastMine: false, unread: 3,
};
const row = inbox.rowHtml(thread);
ok('a row shows the peer name', row.indexOf('Priya N.') !== -1);
ok('a row shows the preview', row.indexOf('on my way') !== -1);
ok('a row shows the animal it is about', row.indexOf('about Milo') !== -1);
ok('an unread row is highlighted', row.indexOf('row unread') !== -1);
ok('an unread row shows the count', row.indexOf('>3</span>') !== -1);
ok('a read row shows no badge',
  inbox.rowHtml(Object.assign({}, thread, { unread: 0 })).indexOf('class="badge"') === -1);
ok('your own last message is prefixed',
  inbox.rowHtml(Object.assign({}, thread, { lastMine: true })).indexOf('You: on my way') !== -1);
ok('an empty thread invites a hello',
  inbox.rowHtml(Object.assign({}, thread, { lastBody: '' })).indexOf('say hello') !== -1);
ok('a row carries the conversation id', row.indexOf('data-conversation="c1"') !== -1);
ok('a row carries the animal for the deep link', row.indexOf('data-animal="milo"') !== -1);

/* Peer names come from another volunteer, so they must be escaped. */
const evilRow = inbox.rowHtml(Object.assign({}, thread, {
  peerName: '<img src=x onerror=alert(1)>',
  lastBody: '<script>alert(2)</script>',
}));
ok('inbox rows escape peer names', evilRow.indexOf('<img src=x') === -1);
ok('inbox rows escape message previews', evilRow.indexOf('<script>') === -1);

/* The empty state must teach the entry point, not just say "nothing". */
ok('the empty inbox explains how to start', inboxSrc.indexOf('tap the chat button') !== -1);
ok('the inbox points at sign in', /auth\.html/.test(inboxSrc));
ok('threads hand off to the map', /#chat=/.test(inboxSrc));
/* The conversation id MUST travel with it. Re-deriving the peer from the
   animal's care log names whoever fed it LAST, which is often a different
   volunteer - the row appeared to open, onto an empty thread. */
ok('the inbox hands over the conversation id',
  /conversation=' \+ encodeURIComponent\(conversation\)/.test(inboxSrc));
ok('the popover hands over the conversation id',
  /conversation=' \+ encodeURIComponent\(conversation\)/.test(headerSrc));
ok('the popover row carries the conversation id',
  /data-conversation="'\s*\+\s*esc\(t\.id/.test(headerSrc));

/* --------------------------- read receipts -------------------------- *
 * LinkedIn-style ticks. One tick = sent, two = read, and "read" is only
 * ever claimed from the OTHER participant's own read cursor - the same
 * column the unread badge counts from, so the tick and the badge are two
 * readings of one fact and can never disagree. */
ok('chatReceipt exists', typeof app.chatReceipt === 'function');
const t0 = '2026-03-10T10:00:00.000Z';
ok('no peer cursor means sent, never read',
  app.chatReceipt({ created_at: t0 }, null).indexOf('done_all') === -1);
ok('a cursor at or past the message means read',
  app.chatReceipt({ created_at: t0 }, t0).indexOf('done_all') !== -1);
ok('a cursor before the message means sent',
  app.chatReceipt({ created_at: t0 }, '2026-03-10T09:59:00.000Z').indexOf('done_all') === -1);
ok('the read tick is labelled for screen readers',
  app.chatReceipt({ created_at: t0 }, t0).indexOf('aria-label="Read"') !== -1);
ok('the sent tick is labelled for screen readers',
  app.chatReceipt({ created_at: t0 }, null).indexOf('aria-label="Sent"') !== -1);
/* Only my own messages carry a tick. */
ok('my own bubble shows a tick',
  app.chatBubble({ body: 'x', created_at: t0 }, true, false, true, t0).indexOf('chat-tick') !== -1);
ok("the other person's bubble shows no tick",
  app.chatBubble({ body: 'x', created_at: t0 }, false, false, true, t0).indexOf('chat-tick') === -1);
ok('renderChat passes the peer read cursor to the bubbles',
  /chatBubble\(row, mine, grouped, endsGroup, state\.chat\.peerReadAt\)/.test(js));
ok('the peer read cursor is read from the participants row',
  /peerReadAt = listed\[0\]\.lastReadAt/.test(js));
ok('the client returns the peer read cursor',
  /lastReadAt: row\.last_read_at/.test(client));
ok('the client selects last_read_at for peers',
  /select\('user_id, last_read_at'\)/.test(client));
ok('the tick is styled in the page', /\.chat-tick--read/.test(html));
ok('the sent tick is visually distinct from the read tick',
  /\.chat-tick\{[^}]*color:#8b7269/.test(html) && /\.chat-tick--read\{color:#a03b0e\}/.test(html));

/* --------------------- clearing the badge for real ------------------ *
 * THE reported bug: the notification survived reading. Three causes, so
 * three guards. */
ok('there is ONE place a thread is marked read', /function markThreadRead\(\)/.test(js));
ok('mark-read uses the newest SEEN server timestamp, not the local clock',
  /upTo = newest \? newest\.created_at : null/.test(js));
ok('the client no longer stamps the cursor with the browser clock',
  !/update\(\{ last_read_at: new Date\(\)\.toISOString\(\) \}\)/.test(client));
ok('the client accepts the observed timestamp', /function sbMarkConversationRead\(conversationId, upToIso\)/.test(client));
ok('opening the thread marks it read', /markThreadRead\(\);/.test(js));
ok('a message arriving in an open thread is marked read',
  /subscribe\(conversation, \(row\) => \{[\s\S]{0,600}onIncomingChatRow\(\)/.test(js));
ok('a backgrounded tab does not count as read',
  /document\.hidden === true \|\| document\.visibilityState === 'hidden'/.test(js));
ok('returning to the tab catches the thread up',
  /addEventListener\('visibilitychange', onTabVisible\)/.test(js));
ok('focus also catches the thread up',
  /addEventListener\('focus', onTabVisible\)/.test(js));
/* Scope the window to the function BODY, so the assertion survives comments
   and doc blocks growing around it. A fixed 900-char span silently started
   failing the moment the explanation above grew, which reads as "the repaint
   is gone" when the code is fine. Strip comments, then look inside the
   braces only. */
const markBody = (function () {
  const start = js.indexOf('function markThreadRead');
  const open = js.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < js.length; i += 1) {
    if (js[i] === '{') depth += 1;
    else if (js[i] === '}') { depth -= 1; if (depth === 0) return js.slice(open, i + 1); }
  }
  return js.slice(open);
})();
ok('marking read asks the header to repaint', /dispatchEvent\(new Event\('fta:chat-opened'\)\)/.test(markBody));
ok('a failed mark does not break the thread',
  /\.catch\(\(\) => \{ \/\* badge stays stale/.test(js));

/* The caching half of the same bug, and the one that actually explained it.
   index.js and site-header.js are no-cache, so they refresh on every load,
   but supabase-client.js was max-age=3600 - so a browser that had it cached
   ran a FRESH caller against an OLD data layer. window.sbMarkConversationRead
   came back undefined, chatFn() returned null, markThreadRead() returned
   early, and the badge survived being read with no error on the page at all.
   It reproduced in Firefox but not Brave purely because each browser keeps
   its own HTTP cache. Asserting both halves stops it coming back. */
const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
/* The directive may sit under a run of '#' comment lines, which is exactly
   where the explanation for this rule lives - so skip them. */
const clientBlock = (/\/supabase-client\.js([\s\S]*?)(?=\n\/|\n\*\/)/.exec(headers) || [])[1] || '';
const clientRule = (/Cache-Control:\s*([^\n]*)/.exec(clientBlock) || [])[1] || '';
ok('supabase-client.js is not served from a long-lived cache',
  /no-cache/.test(clientRule) && !/max-age=(?!0\b)\d{3,}/.test(clientRule));
ok('the stale-client case is reported instead of silently skipped',
  /if \(!markRead\) \{\s*\n\s*console\.warn/.test(js));

/* Two more reasons the count survives reading, both invisible.

   (a) sbListMessages ordered ascending THEN limited, which returns the OLDEST
       `limit` rows. On a long thread the newest messages were never loaded,
       the cursor was stamped from the middle of the conversation, and every
       later message stayed unread forever. The query must page newest-first
       and reverse for display.

   (b) markThreadRead() repainted the header even when the database REFUSED
       the update. sbMarkConversationRead returns false on a permission error
       (the missing UPDATE policy), the repaint re-read the unchanged row and
       showed the same count, so the badge looked stuck with nothing in the
       console. A refusal must be reported, not painted over. */
const listFn = /async function sbListMessages[\s\S]*?\n\}/.exec(client);
ok('the message query pages the NEWEST messages first',
  listFn && /order\('created_at', \{ ascending: false \}\)/.test(listFn[0]));
ok('the newest-first page is reversed for reading order',
  listFn && /\.slice\(\)\.reverse\(\)/.test(listFn[0]));
ok('a refused mark is reported, not repainted as a success',
  /markRead\(conversation, upTo\)\)\.then\(\(ok\) => \{[\s\S]*?if \(ok === false\)/.test(markBody));
ok('a refused mark points at the read-receipts migration',
  /ok === false[\s\S]{0,700}?migration-read-receipts\.sql/.test(markBody));

/* THE TICK THAT STAYED AT ONE. The peer's cursor was fetched once when the
   thread opened and cached in state.chat.peerReadAt for the life of the
   modal. Opening the thread bumps YOUR cursor and does nothing to the OTHER
   participant's row, so the peer reading your message changed a column this
   client had already read and would never read again - the tick stayed at one
   until you closed and reopened the thread. A receipt is a live fact about
   somebody else's session, so it must be polled, not snapshotted. */
ok('there is a function that refreshes the peer read cursor',
  /async function refreshPeerReadAt\(\)/.test(js));
ok('the refresh reads the cursor from sbDmPeers',
  /async function refreshPeerReadAt\(\)[\s\S]{0,700}?sbDmPeers/.test(js));
ok('the refresh re-renders when the cursor actually moved',
  /async function refreshPeerReadAt\(\)[\s\S]{0,900}?state\.chat\.peerReadAt = fresh;[\s\S]{0,200}?renderChat\(\)/.test(js));
ok('an unchanged cursor does not trigger a re-render',
  /=== \(state\.chat\.peerReadAt \|\| ''\)\) return;/.test(js));
ok('the thread polls the peer cursor while it is open',
  /setInterval\(refreshPeerReadAt, \d+\)/.test(js));
ok('the poll starts as soon as the thread opens',
  /refreshPeerReadAt\(\);\s*\n\s*state\.chat\.readTimer = setInterval/.test(js));
ok('the poll is cleared when the thread closes',
  /function stopChat\(\)[\s\S]{0,400}?clearInterval\(state\.chat\.readTimer\)/.test(js));
ok('the timer handle lives in chat state',
  /readTimer: null/.test(js));
ok('returning to the tab also refreshes the peer cursor',
  /function onTabVisible\(\)[\s\S]{0,400}?refreshPeerReadAt\(\)/.test(js));
/* The SQL side. A database created before the mark-read policy cannot
   clear its badge at all, and the failure is invisible in the UI - which
   is the single most likely reason a volunteer still sees a stuck count. */
const receipts = fs.readFileSync(path.join(ROOT, 'supabase', 'migration-read-receipts.sql'), 'utf8');
ok('a read-receipts migration exists', receipts.length > 0);
ok('the migration adds the mark-read policy',
  receipts.indexOf('"participants mark read"') !== -1);
ok('the migration is scoped to your own row',
  /using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/.test(receipts));
ok('the migration is safe to re-run',
  /drop policy if exists/.test(receipts));
ok('the migration backfills a NULL read cursor',
  /where last_read_at is null/.test(receipts));
ok('the migration keeps the recursion-safe helper',
  /create or replace function is_conversation_participant/.test(receipts));
ok('the migration is documented as a badge fix',
  /badge does not clear/.test(receipts));

/* --------------------------- the deep link -------------------------- *
 * inbox.html and the popover both hand a thread to the map as
 * #chat=<animalId>&conversation=<id>. It must go through openChat(), so
 * there is one way a thread is ever opened. */
ok('the map understands #chat=', /params\.get\('chat'\)/.test(js));
ok('the map reads the conversation id too', /params\.get\('conversation'\)/.test(js));
/* Order matters: the map centres the pin, THEN opens the thread. Two index
   checks rather than a length-windowed regex - a window that is merely big
   enough today silently stops matching the day someone adds a comment. */
const chatBlock = js.slice(js.indexOf('if (chatId) {'), js.indexOf('if (animalId && animalById(animalId))'));
const setViewAt = chatBlock.indexOf('setView');
const openAt = chatBlock.indexOf('openChat(chatId, conversationId)');
ok('#chat= centres the animal first', setViewAt !== -1, 'setView at offset ' + setViewAt);
ok('#chat= opens the thread', openAt !== -1, 'openChat at offset ' + openAt);
ok('the pin is centred before the thread opens',
  setViewAt !== -1 && openAt !== -1 && setViewAt < openAt);
/* Consuming the hash is what makes tapping the SAME row twice work: the
   second tap would otherwise navigate to the identical URL, fire no
   hashchange, and silently reopen nothing. */
ok('the deep link is consumed after it is handled', /history\.replaceState/.test(js));

/* ------------------------- the read-cursor policy ------------------- *
 * The unread badge counts from conversation_participants.last_read_at,
 * but the table only had SELECT and INSERT policies - without an UPDATE
 * policy the badge could never be cleared. */
const mig = fs.readFileSync(path.join(ROOT, 'supabase', 'migration-drop-events-fk.sql'), 'utf8');
ok('the migration adds a mark-read policy',
  mig.indexOf('"participants mark read" on conversation_participants') !== -1);
ok('the mark-read policy is scoped to your own row',
  /for update[\s\S]{0,120}auth\.uid\(\) = user_id/.test(mig));
ok('schema-chat declares the mark-read policy too',
  chatSql.indexOf('"participants mark read"') !== -1);
ok('the client exposes sbInbox', client.indexOf('window.sbInbox = sbInbox;') !== -1);
ok('the client exposes sbMarkConversationRead',
  client.indexOf('window.sbMarkConversationRead = sbMarkConversationRead;') !== -1);
ok('opening a thread clears the badge', /sbMarkConversationRead/.test(js));
ok('opening a thread asks the header to repaint', /fta:chat-opened/.test(js));

/* ------------------------------- output ------------------------------ */
let failed = 0;
rows.forEach(([status, label]) => { if (status !== 'OK  ') failed += 1; });
rows.forEach(([status, label]) => console.log(status + '  ' + label));
console.log('\n' + (failed ? 'FAILED ' + failed + ' of ' + rows.length : 'All ' + rows.length + ' chat checks passed'));
process.exit(failed ? 1 : 0);