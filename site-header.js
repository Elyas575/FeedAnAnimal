/* ------------------------------------------------------------------ *
 * Shared site header.
 *
 * Every page renders the SAME navbar from this one definition, so it can
 * never drift out of sync between index.html, activity.html, auth.html,
 * community.html, about.html, privacy.html and terms.html.
 *
 * A page opts in with:  <script src="site-header.js"></script>
 * plus an empty <div id="site-header"></div> placeholder, which is filled
 * automatically; document.body then gets `has-site-header` for spacing.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* The one true nav. `id` matches the page file name; the active item is
     derived from location.pathname, never hard-coded per page. */
  var LINKS = [
    { id: 'index',       label: 'Map',         icon: 'location_on',  href: 'index.html' },
    { id: 'cities',      label: 'Cities',      icon: 'public',       href: 'index.html#cities' },
    { id: 'community',   label: 'Community',   icon: 'chat_bubble',  href: 'community.html' },
    { id: 'activity',    label: 'Activity',    icon: 'history',      href: 'activity.html' },
    { id: 'about',       label: 'About',       icon: 'info',         href: 'about.html' },
  ];

  var ACTIVE = 'bg-primary-fixed/50 text-primary border-primary/30 shadow-sm';
  var IDLE = 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentId() {
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (!file || file === '/') return 'index';
    // location.hash ALWAYS starts with '#', e.g. '#cities' - compare with it.
    var hash = (location.hash || '').toLowerCase();
    if (file.indexOf('community') === 0) return 'community';
    if (file.indexOf('about') === 0) return 'about';
    if (hash.indexOf('#cities') === 0) return 'cities';
    return file.replace('.html', '');
  }

  function headerHtml() {
    var active = currentId();
    var links = LINKS.map(function (l) {
      var on = l.id === active;
      return '<a href="' + esc(l.href) + '" data-nav="' + esc(l.id) + '"'
        + (on ? ' aria-current="page"' : '')
        + ' class="px-4 py-1.5 rounded-full flex items-center gap-1.5 text-sm transition-all '
        + (on ? 'font-semibold border ' + ACTIVE : IDLE) + '">'
        + '<span class="material-symbols-outlined text-[18px] ' + (on ? 'text-primary' : 'text-outline') + '">' + esc(l.icon) + '</span>'
        + '<span>' + esc(l.label) + '</span></a>';
    }).join('');

    return '<header class="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-surface-container-highest shadow-sm">'
      + '<div class="h-[68px] w-full px-4 lg:px-8 flex items-center justify-between gap-4">'
      + '<div class="flex items-center gap-3 shrink-0">'
        + '<a href="index.html" class="flex items-center gap-2.5 group">'
          + '<span class="h-9 w-9 rounded-full flex items-center justify-center text-xl shadow-sm" style="background:#a03b0e">🐾</span>'
          + '<span class="text-xl sm:text-2xl font-bold tracking-tight text-on-surface group-hover:text-primary transition-colors leading-none">FeedAnAnimalMap</span>'
        + '</a>'
      + '</div>'
      + '<nav class="hidden md:flex items-center gap-1.5">' + links + '</nav>'
      + '<div class="flex items-center gap-2.5 shrink-0">'
        + '<button type="button" class="hidden sm:flex h-10 px-5 rounded-full bg-[#E54848] hover:bg-[#d63c3c] text-white font-medium text-sm items-center gap-1.5 shadow-sm active:scale-95 transition-all" title="Support Animal Relief">'
          + '<span class="material-symbols-outlined text-[18px] fill-current">favorite</span><span>Support</span>'
        + '</button>'
        + '<a id="auth-link" href="auth.html" class="h-10 px-4 rounded-full border border-surface-container-highest bg-white text-on-surface hover:bg-surface-container font-medium text-sm flex items-center justify-center transition-colors shadow-sm">'
          + '<span class="material-symbols-outlined text-[18px] mr-1">person</span><span id="auth-link-label">Sign in</span>'
        + '</a>'
      + '</div>'
      + '</div></header>';
  }

  /* Keep the Sign in label showing the signed-in name, on every page. */
  async function wireAuthLink() {
    var label = document.getElementById('auth-link-label');
    var link = document.getElementById('auth-link');
    if (!label || !link) return;
    var refresh = async function () {
      try {
        var auth = window.sbAuth || null;
        if (!auth) return;
        var user = await auth.currentUser();
        if (user && user.email) {
          label.textContent = user.email.split('@')[0];
          link.setAttribute('title', 'Signed in as ' + user.email);
        } else if (user && !user.is_anonymous) {
          label.textContent = 'Account';
        } else {
          label.textContent = 'Sign in';
        }
      } catch (e) { /* keep Sign in */ }
    };
    refresh();
    try {
      var auth = window.sbAuth || null;
      if (auth && auth.client() && auth.client().auth && auth.client().auth.onAuthStateChange) {
        auth.client().auth.onAuthStateChange(function () { refresh(); });
      }
    } catch (e) { /* ignore */ }
    setTimeout(refresh, 2000);
  }

  function mount() {
    var slot = document.getElementById('site-header');
    if (slot && !slot.innerHTML.trim()) {
      slot.outerHTML = headerHtml();
      if (document.body) document.body.classList.add('has-site-header');
    }
    wireAuthLink();
    refreshActive();
    // Same-page hash switches (Cities, topic threads)
    // must move the pill without a reload.
    window.addEventListener('hashchange', refreshActive);
  }

  /* Re-apply the active pill after in-page hash navigation. */
  function refreshActive() {
    var active = currentId();
    var items = document.querySelectorAll('nav a[data-nav]');
    if (!items.length) return;
    Array.prototype.forEach.call(items, function (a) {
      var on = a.getAttribute('data-nav') === active;
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      var icon = a.querySelector('.material-symbols-outlined');
      a.className = 'px-4 py-1.5 rounded-full flex items-center gap-1.5 text-sm transition-all '
        + (on ? 'font-semibold border ' + ACTIVE : IDLE);
      if (icon) icon.className = 'material-symbols-outlined text-[18px] ' + (on ? 'text-primary' : 'text-outline');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LINKS: LINKS, headerHtml: headerHtml, currentId: currentId, refreshActive: refreshActive };
  }
})();