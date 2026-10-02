/* Community forum — Wakie-style topics.
 *
 * LOCAL-FIRST: if supabase/schema-forum.sql has not been run yet, the
 * cloud wrappers return null and everything stays on this device. After
 * the SQL is run, the same UI reads/writes the shared tables instead.
 */
(function () {
'use strict';

var TITLE_MAX = 140;
var BODY_MAX = 4000;
var REPLY_MAX = 2000;

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function uid(prefix) {
  return (prefix || 't') + '-' + Date.now().toString(36) + '-'
    + Math.random().toString(36).slice(2, 8);
}
function timeAgo(ts) {
  var t = new Date(ts).getTime();
  if (!isFinite(t)) return '';
  var s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  var d = Math.floor(s / 86400);
  if (d < 7) return d + 'd ago';
  return new Date(t).toLocaleDateString();
}

function validateTopic(title, body) {
  var t = String(title || '').trim();
  var b = String(body || '').trim();
  if (t.length < 3) return 'Give your topic a title (3+ characters).';
  if (t.length > TITLE_MAX) return 'Keep the title under ' + TITLE_MAX + '.';
  if (!b) return 'Say a little more — what is happening?';
  if (b.length > BODY_MAX) return 'Keep it under ' + BODY_MAX + ' characters.';
  return null;
}
function validateReply(body) {
  var b = String(body || '').trim();
  if (!b) return 'Write a reply first.';
  if (b.length > REPLY_MAX) return 'Keep replies under ' + REPLY_MAX + '.';
  return null;
}

/*@@PART2@@*/
function createStore(adapter) {
  function read(key, fallback) {
    try {
      var raw = adapter.get(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { adapter.set(key, JSON.stringify(val)); } catch (e) { /* full */ }
  }
  return {
    listTopics: function (sort) {
      var replies = read('fta-forum-replies', []);
      var rows = read('fta-forum-topics', []).map(function (t) {
        t.reply_count = replies.filter(function (r) {
          return (r.topic_id || r.topicId) === t.id;
        }).length;
        return t;
      });
      return sortTopics(rows, sort);
    },
    getTopic: function (id) {
      var found = null;
      read('fta-forum-topics', []).forEach(function (t) {
        if (t.id === id) found = t;
      });
      if (!found) return null;
      found.reply_count = read('fta-forum-replies', []).filter(function (r) {
        return (r.topic_id || r.topicId) === found.id;
      }).length;
      return found;
    },
    addTopic: function (fields) {
      var err = validateTopic(fields.title, fields.body);
      if (err) return { error: err };
      var now = fields.createdAt || new Date().toISOString();
      var topic = {
        id: uid('topic'),
        author_id: fields.authorId || null,
        author_name: fields.authorName || 'Volunteer',
        author_avatar: fields.authorAvatar || null,
        title: String(fields.title).trim().slice(0, TITLE_MAX),
        body: String(fields.body).trim().slice(0, BODY_MAX),
        reply_count: 0, like_count: 0,
        last_reply_at: null, created_at: now,
      };
      var rows = read('fta-forum-topics', []);
      rows.push(topic);
      write('fta-forum-topics', rows);
      return { topic: topic };
    },
    addReply: function (topicId, fields) {
      var err = validateReply(fields.body);
      if (err) return { error: err };
      var okTopic = false;
      read('fta-forum-topics', []).forEach(function (t) {
        if (t.id === topicId) okTopic = true;
      });
      if (!okTopic) return { error: 'That topic is gone.' };
      var reply = {
        id: uid('reply'), topic_id: topicId,
        author_id: fields.authorId || null,
        author_name: fields.authorName || 'Volunteer',
        author_avatar: fields.authorAvatar || null,
        body: String(fields.body).trim().slice(0, REPLY_MAX),
        created_at: new Date().toISOString(),
      };
      var rows = read('fta-forum-replies', []);
      rows.push(reply);
      write('fta-forum-replies', rows);
      return { reply: reply };
    },
    listReplies: function (topicId) {
      return read('fta-forum-replies', []).filter(function (r) {
        return (r.topic_id || r.topicId) === topicId;
      });
    },
    isLiked: function (topicId) {
      return !!read('fta-forum-likes', {})[topicId];
    },
    toggleLike: function (topicId) {
      var likes = read('fta-forum-likes', {});
      var liked = !likes[topicId];
      if (liked) likes[topicId] = 1; else delete likes[topicId];
      var rows = read('fta-forum-topics', []);
      rows.forEach(function (t) {
        if (t.id === topicId) {
          t.like_count = Math.max(0, (t.like_count || 0) + (liked ? 1 : -1));
        }
      });
      write('fta-forum-likes', likes);
      write('fta-forum-topics', rows);
      return liked;
    },
  };
}

function sortTopics(rows, sort) {
  var list = rows.slice();
  function ts(v) { var t = new Date(v).getTime(); return isFinite(t) ? t : 0; }
  if (sort === 'top') {
    list.sort(function (a, b) {
      return (b.like_count || 0) - (a.like_count || 0)
        || ts(b.created_at) - ts(a.created_at);
    });
  } else if (sort === 'active') {
    list.sort(function (a, b) {
      return ts(b.last_reply_at || b.created_at) - ts(a.last_reply_at || a.created_at);
    });
  } else {
    list.sort(function (a, b) { return ts(b.created_at) - ts(a.created_at); });
  }
  return list;
}

/*@@PART3@@*/
function faceHtml(name, avatarUrl, size) {
  var px = size || 40;
  var photo = avatarUrl
    ? '<img src="' + esc(avatarUrl) + '" alt="" loading="lazy"'
      + ' onerror="this.remove()">'
    : '';
  return '<span class="f-avatar" style="width:' + px + 'px;height:' + px + 'px;'
    + 'background:' + faceColor(name) + '">'
    + '<span class="f-initials">' + esc(initialsOf(name)) + '</span>'
    + photo + '</span>';
}
function initialsOf(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function faceColor(name) {
  var h = 0;
  var s = String(name || '?');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ',38%,46%)';
}
function topicCardHtml(t, liked) {
  var replies = Number(t.reply_count) || 0;
  var likes = Number(t.like_count) || 0;
  return '<article class="f-topic" data-topic="' + esc(t.id) + '">'
    + '<button type="button" class="f-open" data-open="' + esc(t.id) + '">'
    + faceHtml(t.author_name || t.authorName, t.author_avatar || t.authorAvatar, 42)
    + '<span class="f-main"><span class="f-title">' + esc(t.title) + '</span>'
    + '<span class="f-meta">' + esc(t.author_name || t.authorName || 'Volunteer')
    + ' · ' + esc(timeAgo(t.created_at)) + ' · '
    + replies + (replies === 1 ? ' reply' : ' replies') + '</span>'
    + '<span class="f-preview">' + esc(String(t.body || '').slice(0, 160))
    + (String(t.body || '').length > 160 ? '…' : '') + '</span></span>'
    + '</button>'
    + '<span class="f-like' + (liked ? ' on' : '') + '" data-like="' + esc(t.id) + '"'
    + ' role="button" tabindex="0" title="Like this topic">'
    + '<span class="material-symbols-outlined">favorite</span>'
    + '<span data-likecount>' + likes + '</span></span>'
    + '</article>';
}

/*@@PART4@@*/
function replyHtml(r) {
  return '<div class="f-reply">'
    + faceHtml(r.author_name || r.authorName, r.author_avatar || r.authorAvatar, 34)
    + '<div class="f-bubble"><div class="f-meta">'
    + esc(r.author_name || r.authorName || 'Volunteer')
    + ' · ' + esc(timeAgo(r.created_at)) + '</div>'
    + '<p>' + esc(r.body) + '</p></div></div>';
}

/*@@PART5@@*/
var LS = {
  get: function (k) { return window.localStorage.getItem(k); },
  set: function (k, v) { window.localStorage.setItem(k, v); },
};
var store = createStore(LS);
var cloud = false; /* true once the forum tables answer */
var sortMode = 'recent';
var openId = null;
var myName = 'Volunteer';
var myAvatar = null;
var myId = null;

async function identity() {
  try {
    if (window.sbEnsureAuth) await window.sbEnsureAuth();
    if (window.sbAuth) {
      var u = await window.sbAuth.currentUser();
      if (u && !u.is_anonymous) myId = u.id;
    }
    if (typeof window.sbDisplayName === 'function') {
      myName = await window.sbDisplayName('Volunteer');
    }
    if (typeof window.sbAvatarUrl === 'function') {
      myAvatar = await window.sbAvatarUrl();
    }
  } catch (e) { /* guests stay guests */ }
}

async function refreshTopics() {
  var listEl = $('topics');
  if (!listEl) return;
  var rows = null;
  if (typeof window.sbForumTopics === 'function') {
    try { rows = await window.sbForumTopics(sortMode); } catch (e) { rows = null; }
  }
  if (rows === null) {
    cloud = false;
    rows = store.listTopics(sortMode);
  } else {
    cloud = true;
  }
  $('forum-mode').textContent = cloud ? 'Shared · live' : 'On this device';
  if (!rows.length) {
    listEl.innerHTML = '';
    var empty = $('topics-empty');
    empty.classList.remove('hidden');
    var anon = !myId;
    empty.innerHTML = anon
      ? 'No topics yet. <a href="auth.html">Sign in</a> and start the first one.'
      : 'No topics yet — start the first one below.';
    return;
  }
  $('topics-empty').classList.add('hidden');
  listEl.innerHTML = rows.map(function (t) {
    var liked = cloud ? false : store.isLiked(t.id);
    return topicCardHtml(t, liked);
  }).join('');
}

/*@@PART6@@*/
function needSignin() {
  var box = $('composer-hint');
  box.textContent = 'Sign in to post. Anonymous browsing is fine — posting needs a name.';
  box.classList.remove('hidden');
}
async function submitTopic() {
  var title = $('topic-title').value;
  var body = $('topic-body').value;
  var err = validateTopic(title, body);
  if (err) {
    var box = $('composer-hint');
    box.textContent = err;
    box.classList.remove('hidden');
    return;
  }
  $('topic-post').disabled = true;
  try {
    if (cloud && typeof window.sbForumCreateTopic === 'function') {
      var res = await window.sbForumCreateTopic(title, body);
      if (res && res.error === 'signin') { needSignin(); return; }
      if (!res || !res.topic) { cloud = false; }
      else { location.hash = '#topic=' + res.topic.id; await refreshTopics(); }
      if (res && res.topic) return;
    }
    if (!myId) { needSignin(); return; }
    var made = store.addTopic({
      title: title, body: body,
      authorId: myId, authorName: myName, authorAvatar: myAvatar,
    });
    if (made.error) {
      var box2 = $('composer-hint');
      box2.textContent = made.error;
      box2.classList.remove('hidden');
      return;
    }
    $('topic-title').value = '';
    $('topic-body').value = '';
    $('composer-hint').classList.add('hidden');
    await refreshTopics();
    location.hash = '#topic=' + made.topic.id;
  } finally {
    $('topic-post').disabled = false;
  }
}

/*@@PART7@@*/
async function openTopic(id) {
  openId = id;
  var topic = null;
  var replies = [];
  if (cloud) {
    if (typeof window.sbForumTopics === 'function') {
      try {
        var rows = await window.sbForumTopics('recent');
        (rows || []).forEach(function (t) { if (String(t.id) === String(id)) topic = t; });
      } catch (e) { topic = null; }
    }
    if (typeof window.sbForumReplies === 'function') {
      try { replies = await window.sbForumReplies(id); } catch (e) { replies = []; }
      if (replies === null) { cloud = false; replies = []; }
    }
  }
  if (!cloud) {
    topic = store.getTopic(id);
    replies = store.listReplies(id);
  }
  if (!topic) { closeTopic(); return; }
  $('thread-title').textContent = topic.title;
  $('thread-meta').textContent = (topic.author_name || topic.authorName || 'Volunteer')
    + ' · ' + timeAgo(topic.created_at);
  $('thread-face').innerHTML = faceHtml(
    topic.author_name || topic.authorName, topic.author_avatar || topic.authorAvatar, 44);
  $('thread-body').textContent = topic.body;
  $('thread-replies').innerHTML = replies.length
    ? replies.map(replyHtml).join('')
    : '<p class="f-none">No replies yet — be the first.</p>';
  $('thread').classList.remove('hidden');
  $('thread').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeTopic() {
  openId = null;
  $('thread').classList.add('hidden');
  if ((location.hash || '').indexOf('#topic=') === 0) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}
async function submitReply() {
  if (!openId) return;
  var body = $('reply-body').value;
  var err = validateReply(body);
  if (err) {
    var box = $('reply-hint');
    box.textContent = err;
    box.classList.remove('hidden');
    return;
  }
  $('reply-send').disabled = true;
  try {
    if (cloud && typeof window.sbForumCreateReply === 'function') {
      var res = await window.sbForumCreateReply(openId, body);
      if (res && res.error === 'signin') {
        var box2 = $('reply-hint');
        box2.textContent = 'Sign in to reply.';
        box2.classList.remove('hidden');
        return;
      }
      if (res && res.reply) {
        $('reply-body').value = '';
        $('reply-hint').classList.add('hidden');
        await openTopic(openId);
        await refreshTopics();
        return;
      }
      cloud = false;
    }
    if (!myId) {
      var box3 = $('reply-hint');
      box3.textContent = 'Sign in to reply.';
      box3.classList.remove('hidden');
      return;
    }
    var made = store.addReply(openId, {
      body: body, authorId: myId, authorName: myName, authorAvatar: myAvatar,
    });
    if (made.error) {
      var box4 = $('reply-hint');
      box4.textContent = made.error;
      box4.classList.remove('hidden');
      return;
    }
    $('reply-body').value = '';
    $('reply-hint').classList.add('hidden');
    await openTopic(openId);
    await refreshTopics();
  } finally {
    $('reply-send').disabled = false;
  }
}

/*@@PART8@@*/
function applyView() {
  // One page, one view: the forum. Deep links (#topic=<id>) still open threads.
  var m = String(location.hash || '').match(/^#topic=(.+)$/);
  if (m && m[1] && m[1] !== openId) openTopic(m[1]);
}
function wire() {
  window.addEventListener('hashchange', applyView);
  var sorts = document.querySelectorAll('[data-sort]');
  for (var s = 0; s < sorts.length; s++) {
    sorts[s].addEventListener('click', function () {
      for (var j = 0; j < sorts.length; j++) sorts[j].classList.remove('on');
      this.classList.add('on');
      sortMode = this.getAttribute('data-sort');
      refreshTopics();
    });
  }
  $('topic-post').addEventListener('click', submitTopic);
  $('reply-send').addEventListener('click', submitReply);
  $('thread-close').addEventListener('click', closeTopic);
  $('topics').addEventListener('click', function (ev) {
    var like = ev.target.closest ? ev.target.closest('[data-like]') : null;
    if (like) { toggleLike(like.getAttribute('data-like')); return; }
    var open = ev.target.closest ? ev.target.closest('[data-open]') : null;
    if (open) {
      location.hash = '#topic=' + open.getAttribute('data-open');
      openTopic(open.getAttribute('data-open'));
    }
  });
  $('topics').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var like = ev.target.closest ? ev.target.closest('[data-like]') : null;
    if (like) { ev.preventDefault(); toggleLike(like.getAttribute('data-like')); }
  });
}
async function toggleLike(id) {
  if (cloud && typeof window.sbForumToggleLike === 'function') {
    try {
      var res = await window.sbForumToggleLike(id);
      if (res && res.error === 'signin') { needSignin(); return; }
      if (res && !res.error) { await refreshTopics(); return; }
      cloud = false;
    } catch (e) { cloud = false; }
  }
  if (!myId) { needSignin(); return; }
  store.toggleLike(id);
  await refreshTopics();
}

/*@@PART9@@*/
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TITLE_MAX: TITLE_MAX, BODY_MAX: BODY_MAX, REPLY_MAX: REPLY_MAX,
    validateTopic: validateTopic, validateReply: validateReply,
    createStore: createStore, sortTopics: sortTopics,
    initialsOf: initialsOf, topicCardHtml: topicCardHtml, replyHtml: replyHtml,
  };
}

if (typeof document !== 'undefined' && document.getElementById('topics')) {
  (async function boot() {
    await identity();
    wire();
    applyView();
    await refreshTopics();
  })();
}
})();

