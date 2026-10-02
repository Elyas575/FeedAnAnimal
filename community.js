/* ------------------------------------------------------------------ *
 * Community page — the ladder.
 *
 * Points are computed in Postgres from the events table (see
 * supabase/schema-leaderboard.sql), so the board cannot be faked from
 * devtools. This file only decides which BADGE a given score earns,
 * which guarantees the badge always agrees with the server's number.
 *
 *   Stray -> Scout -> Feeder -> Carer -> Guardian -> Angel -> Saint -> Legend
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var TIERS = [
    { tier: 1, name: 'Stray',    min: 0,    accent: '#8b7269', icon: 'pets' },
    { tier: 2, name: 'Scout',    min: 100,  accent: '#4b6b3a', icon: 'search' },
    { tier: 3, name: 'Feeder',   min: 250,  accent: '#2f6f6a', icon: 'restaurant' },
    { tier: 4, name: 'Carer',    min: 500,  accent: '#3b5a8a', icon: 'volunteer_activism' },
    { tier: 5, name: 'Guardian', min: 900,  accent: '#6b3a7a', icon: 'shield' },
    { tier: 6, name: 'Angel',    min: 1500, accent: '#8a5a2b', icon: 'favorite' },
    { tier: 7, name: 'Saint',    min: 2500, accent: '#a03b0e', icon: 'auto_awesome' },
    { tier: 8, name: 'Legend',   min: 4000, accent: '#8a4b0e', icon: 'military_tech' },
  ];

  // Mirrors the scoring in schema-leaderboard.sql. Display only.
  var SCORES = [
    { kind: 'rescue',   label: 'Rescue an animal in danger', points: 30 },
    { kind: 'report',   label: 'Report a stray you found',   points: 25 },
    { kind: 'vet',      label: 'Log a vet check',           points: 20 },
    { kind: 'medicine', label: 'Log medicine given',        points: 18 },
    { kind: 'station',  label: 'Refill a feeding station',   points: 12 },
    { kind: 'feed',     label: 'Feed an animal',            points: 10 },
    { kind: 'water',    label: 'Refresh a water bowl',      points: 8 },
  ];

  var TIER_BLURB = {
    1: 'You showed up. That is the hardest part.',
    2: 'You are out and about looking for animals.',
    3: 'You are feeding regularly. The regulars know you.',
    4: 'You look after specific animals, not just spots.',
    5: 'You are the person others ask when something goes wrong.',
    6: 'You go above and beyond — rescues, vet runs, medicine.',
    7: 'You are one of the people this whole map relies on.',
    8: 'Top rank. The animals here are fed because of you.',
  };

  var WINDOW_LABEL = { week: 'this week', month: 'this month', all: 'all-time' };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };

  /* Points arrive as strings from Postgres bigint - coerce before comparing,
     or every volunteer would silently fall back to tier 1. */
  function tierFor(points) {
    var score = num(points);
    var found = TIERS[0];
    for (var i = 0; i < TIERS.length; i++) {
      if (score >= TIERS[i].min) found = TIERS[i]; else break;
    }
    return found;
  }

  function nextTierFor(points) {
    var score = num(points);
    for (var i = 0; i < TIERS.length; i++) {
      if (score < TIERS[i].min) return TIERS[i];
    }
    return null;
  }

  function tierProgress(points) {
    var score = num(points);
    var here = tierFor(score);
    var next = nextTierFor(score);
    if (!next) return 100;
    var span = next.min - here.min;
    if (span <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(((score - here.min) / span) * 100)));
  }

  /* --- the badge ---------------------------------------------------- *
   * A shield crest with a paw, tinted per tier. Inline SVG so it always
   * scales crisply and can never 404. The gradient id includes the size
   * so several badges of the same tier never share/collide on one page. */
  function badgeSvg(tier, size) {
    var t = tier || TIERS[0];
    var s = size || 44;
    var id = 'cb' + t.tier + '_' + Math.round(s);
    return ''
      + '<svg class="badge-svg" width="' + s + '" height="' + s + '" viewBox="0 0 48 48"'
      + ' role="img" aria-label="' + esc(t.name) + ' rank badge">'
      + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="' + t.accent + '"/>'
      + '<stop offset="100%" stop-color="#ffffff" stop-opacity=".85"/>'
      + '</linearGradient></defs>'
      + '<path d="M24 2 L43 9 V24 C43 34 34 42 24 46 C14 42 5 34 5 24 V9 Z"'
      + ' fill="url(#' + id + ')" stroke="' + t.accent + '" stroke-width="2"/>'
      + '<path d="M24 5.5 L40 11.2 V24 C40 32.4 32.4 39.2 24 42.7 C15.6 39.2 8 32.4 8 24 V11.2 Z"'
      + ' fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>'
      + '<g fill="#fff">'
      + '<ellipse cx="17.5" cy="20.5" rx="3" ry="4"/>'
      + '<ellipse cx="24" cy="17" rx="3.1" ry="4.2"/>'
      + '<ellipse cx="30.5" cy="20.5" rx="3" ry="4"/>'
      + '<path d="M24 26c4.4 0 7.6 2.9 7.6 6.2 0 2.7-2.2 4.3-4.8 4.3-1.2 0-2-.5-2.8-.5s-1.6.5-2.8.5c-2.6 0-4.8-1.6-4.8-4.3 0-3.3 3.2-6.2 7.6-6.2z"/>'
      + '</g></svg>';
  }

  function tierPillHtml(tier, extraClass, extraStyle) {
    return '<span class="tier-pill ' + (extraClass || '') + '" style="' + (extraStyle || 'background:' + tier.accent + '18;color:' + tier.accent) + '">'
      + '<span class="material-symbols-outlined" style="font-size:13px">' + tier.icon + '</span>'
      + esc(tier.name) + '</span>';
  }

  /* Deterministic colour so a volunteer keeps the same avatar everywhere. */
  var HUES = ['#a03b0e', '#7c4a21', '#4b6b3a', '#2f6f6a', '#3b5a8a', '#6b3a7a', '#8a5a2b', '#5a6b2f'];
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
  function avatarHtml(name, url) {
    var photo = url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<span class="avatar" style="background:' + esc(hueOf(name)) + '" title="' + esc(name || 'Volunteer') + '">'
      + '<span class="initials">' + esc(initialsOf(name)) + '</span>' + photo + '</span>';
  }
  function relTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  /* --- rendering --------------------------------------------------- */
  function rowHtml(r, meId) {
    var points = num(r.points);
    var tier = tierFor(points);
    var rank = num(r.rank);
    var medal = rank === 1 ? ' g1' : rank === 2 ? ' g2' : rank === 3 ? ' g3' : '';
    var isMe = !!meId && r.user_id === meId;
    var bits = [];
    if (num(r.feeds)) bits.push(num(r.feeds) + ' feeds');
    if (num(r.waters)) bits.push(num(r.waters) + ' waters');
    if (num(r.reports)) bits.push(num(r.reports) + ' reports');
    if (num(r.animals)) bits.push(num(r.animals) + ' animals');
    var ago = r.last_seen ? ' · ' + esc(relTime(r.last_seen)) : '';
    var meStyle = isMe ? 'border-color:#a03b0e;box-shadow:0 0 0 3px rgba(160,59,14,.08)' : '';

    return '<div class="row" style="' + meStyle + '">'
      + '<span class="rank' + medal + '">' + rank + '</span>'
      + avatarHtml(r.display_name, r.avatar_url)
      + '<div class="flex-1 min-w-0">'
        + '<div class="flex items-center gap-2 flex-wrap">'
          + '<span class="font-bold text-sm truncate">' + esc(r.display_name || 'Volunteer') + '</span>'
          + tierPillHtml(tier)
          + (isMe ? '<span class="tier-pill" style="background:#a03b0e;color:#fff">You</span>' : '')
        + '</div>'
        + '<p class="text-xs text-[#57423b] mt-0.5">' + esc(bits.join(' · ') || 'No activity yet') + ago + '</p>'
      + '</div>'
      + badgeSvg(tier, 40)
      + '<div class="pts">' + points + '<small>points</small></div>'
      + '</div>';
  }

  function renderBoard(rows, meId) {
    var board = $('board');
    var empty = $('board-empty');
    if (!rows.length) {
      board.innerHTML = '';
      empty.classList.remove('hidden');
      empty.textContent = 'No volunteers have earned points in this period yet. Be the first — sign in and log a feed.';
      $('sum-sub').textContent = 'Nobody ranked yet';
      return;
    }
    empty.classList.add('hidden');
    board.innerHTML = rows.map(function (r) { return rowHtml(r, meId); }).join('');
    var total = rows.reduce(function (sum, r) { return sum + num(r.points); }, 0);
    $('sum-sub').textContent = rows.length + ' volunteer' + (rows.length === 1 ? '' : 's')
      + ' · ' + total.toLocaleString() + ' points ' + WINDOW_LABEL[currentWindow];
  }

  function renderMine(mine, meId) {
    var box = $('mine');
    if (!mine || !meId) { box.hidden = true; return; }
    var points = num(mine.points);
    var tier = tierFor(points);
    var next = nextTierFor(points);
    box.hidden = false;
    $('mine-badge').innerHTML = badgeSvg(tier, 56);
    $('mine-name').textContent = 'Your rank';
    $('mine-tier').outerHTML = tierPillHtml(tier, 'mine-tier', 'background:' + tier.accent + '18;color:' + tier.accent);
    $('mine-stats').textContent = '#' + num(mine.rank) + ' on the board · '
      + num(mine.feeds) + ' feeds · ' + num(mine.waters) + ' waters · '
      + num(mine.reports) + ' reports · ' + num(mine.animals) + ' animals';
    var bar = $('mine-bar');
    bar.style.width = tierProgress(points) + '%';
    bar.style.background = tier.accent;
    $('mine-next').textContent = next
      ? (next.min - points) + ' points to ' + next.name + '.'
      : 'Top rank reached — you are a Legend.';
  }

  function renderTiers(mine) {
    var mineTier = tierFor(mine ? num(mine.points) : 0);
    $('tiers').innerHTML = TIERS.map(function (t) {
      var locked = t.tier > mineTier.tier;
      var current = t.tier === mineTier.tier;
      return '<div class="tier-card' + (current ? ' current' : '') + (locked ? ' locked' : '') + '">'
        + badgeSvg(t, 38)
        + '<div class="flex-1 min-w-0">'
          + '<div class="flex items-center gap-2">'
            + '<span class="font-bold text-sm">' + esc(t.name) + '</span>'
            + '<span class="text-[11px] text-[#8b7269]">' + t.min + '+ pts</span>'
          + '</div>'
          + '<p class="text-[11px] text-[#57423b]">' + esc(TIER_BLURB[t.tier]) + '</p>'
        + '</div>'
        + (current ? '<span class="tier-pill" style="background:#a03b0e;color:#fff">You</span>' : '')
        + '</div>';
    }).join('');
  }

  function renderScores() {
    $('scores').innerHTML = SCORES.map(function (s) {
      return '<div class="flex items-center justify-between py-2 border-b border-[#efe6e4] last:border-0">'
        + '<span class="text-sm">' + esc(s.label) + '</span>'
        + '<span class="text-sm font-bold" style="color:#a03b0e">+' + s.points + '</span>'
        + '</div>';
    }).join('');
  }

  /* --- data --------------------------------------------------------- */
  var currentWindow = 'week';
  var myId = null;

  async function load() {
    // Anonymous visitors can still see the board; signing in adds "your rank".
    if (window.sbEnsureAuth) { try { await window.sbEnsureAuth(); } catch (e) { /* fine */ } }
    if (window.sbAuth) {
      try {
        var u = await window.sbAuth.currentUser();
        if (u && !u.is_anonymous) myId = u.id;
      } catch (e) { /* stay anonymous */ }
    }

    var rows = [];
    var mine = null;
    if (window.sbLeaderboard) {
      try { rows = (await window.sbLeaderboard(currentWindow)) || []; } catch (e) { rows = []; }
    }
    if (window.sbMyRank && myId) {
      try { mine = await window.sbMyRank(); } catch (e) { mine = null; }
    }

    renderBoard(rows, myId);
    renderMine(mine, myId);
    renderTiers(mine);
    renderScores();
  }

  function wire() {
    $('sum-title').textContent = 'Top carers · ' + WINDOW_LABEL[currentWindow];
    var chips = document.querySelectorAll('[data-w]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        for (var j = 0; j < chips.length; j++) chips[j].classList.remove('on');
        this.classList.add('on');
        currentWindow = this.getAttribute('data-w');
        $('sum-title').textContent = 'Top carers · ' + WINDOW_LABEL[currentWindow];
        load();
      });
    }
  }

  /* Exported so tools/check-community.js can test the maths headlessly. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TIERS: TIERS, SCORES: SCORES, TIER_BLURB: TIER_BLURB,
      tierFor: tierFor, nextTierFor: nextTierFor, tierProgress: tierProgress,
      badgeSvg: badgeSvg, initialsOf: initialsOf, hueOf: hueOf, rowHtml: rowHtml,
    };
  }

  if (typeof document !== 'undefined' && document.getElementById('board')) {
    wire();
    load();
  }
})();