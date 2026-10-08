/* Messages inbox — the "all your chats" view (Phase 5.7).
 *
 * Reads the SAME sbInbox() the header badge reads, so the number on the
 * bell and the list here can never disagree.
 *
 * Rows are <button>s rather than links because the thread may not exist
 * yet: opening a conversation from here hands the id to the map, which
 * calls get_or_create_dm and creates it on demand.
 */
(function () {
  'use strict';

  var HUES = ['#a03b0e', '#7c4a21', '#4b6b3a', '#2f6f6a', '#3b5a8a', '#6b3a7a', '#8a5a2b', '#5a6b2f'];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Same deterministic colour as the rest of the app, so a volunteer's
     avatar is the same shade here, in chat and on the leaderboard. */
  function hueOf(name) {
    var src = String(name == null ? '' : name), h = 0;
    for (var i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
    return HUES[h % HUES.length];
  }

  function initialsOf(name) {
    var parts = String(name == null ? '' : name).trim().split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarHtml(name) {
    return '<span class="avatar" style="background:' + esc(hueOf(name)) + '">'
      + '<span class="initials">' + esc(initialsOf(name)) + '</span></span>';
  }

  /* Same "2m ago / Today / 3 Oct" ladder the chat thread uses, so a time
     reads identically wherever it appears. */
  function relTime(iso) {
    var at = Date.parse(iso);
    if (!isFinite(at)) return '';
    var mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 60 * 24) return Math.round(mins / 60) + 'h ago';
    var days = Math.round(mins / 1440);
    if (days < 7) return days + 'd ago';
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function rowHtml(t) {
    var who = t.peerName || 'Volunteer';
    /* An empty thread has no last message yet, so the preview becomes an
       invitation rather than a blank line. */
    var preview = t.lastBody
      ? (t.lastMine ? 'You: ' + t.lastBody : t.lastBody)
      : 'No messages yet - say hello';
    return '<button type="button" class="row' + (t.unread ? ' unread' : '') + '"'
      + ' data-conversation="' + esc(t.id) + '"'
      + ' data-animal="' + esc(t.animalId || '') + '"'
      + ' aria-label="Conversation with ' + esc(who) + '">'
      + avatarHtml(who)
      + '<span class="meta">'
        + '<span class="top">'
          + '<span class="who">' + esc(who) + '</span>'
          + '<span class="when">' + esc(relTime(t.lastAt)) + '</span>'
        + '</span>'
        + '<span class="preview' + (t.lastMine ? ' mine' : '') + '">' + esc(preview) + '</span>'
        + (t.animalName ? '<span class="about-tag">about ' + esc(t.animalName) + '</span>' : '')
      + '</span>'
      + (t.unread ? '<span class="badge" aria-label="' + t.unread + ' unread">' + (t.unread > 99 ? '99+' : t.unread) + '</span>' : '')
    + '</button>';
  }

  function showEmpty(html) {
    var list = $('list');
    var empty = $('empty');
    if (list) list.innerHTML = '';
    if (empty) {
      empty.innerHTML = html;
      empty.classList.remove('hidden');
    }
  }

  async function load() {
    var list = $('list');
    if (list) list.innerHTML = '<div class="none">Loading messages...</div>';

    var inbox = window.sbInbox;
    if (typeof inbox !== 'function') {
      showEmpty('Messaging is not available yet.');
      return;
    }

    var me = (window.sbRequireEmail) ? await window.sbRequireEmail() : null;
    if (!me) {
      showEmpty('Sign in to see your messages.<br><a href="auth.html">Sign in</a> - ' +
        'logging a feed works without an account.');
      return;
    }

    var rows = [];
    try {
      rows = (await inbox(60)) || [];
    } catch (e) { rows = []; }

    var empty = $('empty');
    if (!rows.length) {
      showEmpty('No messages yet.<br>Open an animal on the map and tap the chat button to start a conversation with whoever cared for it last.');
      return;
    }
    if (empty) empty.classList.add('hidden');

    /* Unread threads first, then by recency. A volunteer opening this page
       wants the thing that is waiting for them, not the newest thing. */
    rows.sort(function (a, b) {
      if ((b.unread || 0) !== (a.unread || 0)) return (b.unread || 0) - (a.unread || 0);
      return (Date.parse(b.lastAt) || 0) - (Date.parse(a.lastAt) || 0);
    });

    if (list) list.innerHTML = rows.map(rowHtml).join('');
  }

  function onRowClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var row = target.closest('[data-conversation]');
    if (!row) return;
    /* Hand off to the map, which owns the thread UI. BOTH ids travel: the
       animal so the map can centre the pin, and the conversation so it
       opens the exact thread tapped. Passing only the animal made the map
       re-derive the peer from "who fed this animal last", which is often a
       different volunteer - the row appeared to open, onto an empty
       thread with somebody else. */
    var animal = row.getAttribute('data-animal') || '';
    var conversation = row.getAttribute('data-conversation') || '';
    var target2 = 'index.html';
    if (conversation) {
      target2 += '#chat=' + encodeURIComponent(animal || conversation) +
        '&conversation=' + encodeURIComponent(conversation);
    } else if (animal) {
      target2 += '#chat=' + encodeURIComponent(animal);
    }
    window.location.href = target2;
  }

  function boot() {
    load();
    window.addEventListener('fta:inbox-updated', load);
  }

  /* Guard the DOM wiring for browsers. Under Node (tools/check-chat.js
     exercises this file's pure functions headlessly) there is no document,
     and running for side effects here would crash the require(). The module
     export above still runs, which is exactly what the tests need. */
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('click', onRowClick);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initialsOf: initialsOf, hueOf: hueOf, avatarHtml: avatarHtml,
      relTime: relTime, rowHtml: rowHtml
    };
  }
})();