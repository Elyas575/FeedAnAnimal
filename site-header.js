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

  /* Mobile-only bottom tab bar (CheapFoodMap style). Two tabs left of the
     elevated centre pill, two on the right. The centre pill itself is built
     by centerPillHtml(): on the map page it is the List/Map view switch,
     everywhere else it is a link back to the map. */
  var BOTTOM_TABS = [
    { id: 'cities',    label: 'Cities',    icon: 'public',      href: 'index.html#cities' },
    { id: 'community', label: 'Community', icon: 'chat_bubble',  href: 'community.html' },
    { id: 'activity',  label: 'Activity',  icon: 'history',      href: 'activity.html' },
    { id: 'about',     label: 'About',     icon: 'info',         href: 'about.html' },
  ];

  var BOTTOM_ACCENT = '#f4511e';  /* vivid action orange, from the mock */
  var BOTTOM_IDLE = '#8b7269';

  /* ------------------------------------------------------------------ *
   * Plain CSS for the injected chrome.                                  *
   * The Tailwind Play CDN compiles by scanning the DOM, so utilities    *
   * that only ever appear in THIS injected markup are not guaranteed to *
   * exist yet (same reasoning as the map pins in index.html). Every     *
   * rule below is scoped under #site-top-header / #site-bottom-nav so   *
   * it outranks any utility class regardless of compile order.          *
   * ------------------------------------------------------------------ */
  var CHROME_CSS = [
    /* ---- top header ---- */
    '#site-top-header{position:fixed;top:0;left:0;right:0;z-index:50;',
    'background:rgba(255,255,255,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    'border-bottom:1px solid #e9e1df;box-shadow:0 1px 2px rgba(30,27,26,.05)}',
    /* Single source of truth for the bar height, so a page that has to pad
       itself (about.html, 404.html, ...) can never drift from the real bar. */
    ':root{--site-header-h:68px}',
    /* The navbar is injected into <body>, so it inherits whatever typography
       each page set there. The map page renders at Tailwind's 1.5 while
       about.html sets line-height:1.7 - that difference silently made every
       header line box ~13% taller inside a FIXED-height bar, overflowing and
       misaligning it, which is glaring once page content scrolls underneath
       the translucent, blurred bar. Pin the metrics here so every page
       renders the navbar exactly like the home page. */
    '#site-top-header,#site-top-header *{line-height:1.5}',
    '#site-top-header .fta-hd-inner{display:flex;align-items:center;justify-content:space-between;',
    'gap:16px;width:100%;height:68px;padding:0 16px;box-sizing:border-box}',
    '@media (min-width:1024px){#site-top-header .fta-hd-inner{padding:0 32px}}',
    '#site-top-header .fta-hd-left{display:flex;align-items:center;gap:12px;min-width:0}',
    '#site-top-header .fta-hd-brandlink{display:flex;align-items:center;gap:10px;min-width:0;text-decoration:none}',
    '#site-top-header .fta-logo{flex:0 0 auto;width:40px;height:40px;border-radius:9999px;',
    'display:flex;align-items:center;justify-content:center;font-size:20px;background:#a03b0e;',
    'box-shadow:0 1px 2px rgba(30,27,26,.15)}',
    '@media (min-width:640px){#site-top-header .fta-logo{width:36px;height:36px}}',
    '#site-top-header .fta-brand{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    'font-size:17px;font-weight:700;letter-spacing:-.02em;line-height:1;color:#1e1b1a}',
    '@media (min-width:640px){#site-top-header .fta-brand{font-size:24px}}',
    '#site-top-header .fta-hd-brandlink:hover .fta-brand{color:#a03b0e}',
    '#site-top-header .fta-hd-right{display:flex;align-items:center;gap:10px;flex-shrink:0}',
    '#site-top-header .fta-support{display:flex;align-items:center;gap:6px;height:40px;padding:0 12px;',
    'border:0;border-radius:12px;background:#E54848;color:#fff;font-family:inherit;font-size:14px;',
    'font-weight:500;box-shadow:0 1px 2px rgba(30,27,26,.15);cursor:pointer;',
    'transition:transform .15s ease,background .15s ease}',
    '#site-top-header .fta-support:active{transform:scale(.95)}',
    '#site-top-header .fta-support:hover{background:#d63c3c}',
    '@media (min-width:640px){#site-top-header .fta-support{padding:0 20px;border-radius:9999px}}',
    '@media (max-width:639px){#site-top-header .fta-support-label,#site-top-header .fta-signin-icon{display:none}}',
    '#site-top-header .fta-signin{height:40px;padding:0 16px;border-radius:9999px;border:1px solid #e9e1df;',
    'background:#fff;color:#1e1b1a;font-family:inherit;font-size:14px;font-weight:500;text-decoration:none;',
    'display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(30,27,26,.05);',
    'transition:background .15s ease}',
    '#site-top-header .fta-signin:hover{background:#f5ecea}',
    /* ---- bottom tab bar (mobile only) ---- */
    '#site-bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;display:none;',
    'background:rgba(255,255,255,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    'border-top:1px solid #e9e1df;box-shadow:0 -8px 24px rgba(30,27,26,.10);',
    'padding-bottom:env(safe-area-inset-bottom)}',
    '@media (max-width:767px){#site-bottom-nav{display:block}}',
    '#site-bottom-nav .fta-bn-bar{display:flex;align-items:stretch;justify-content:space-around;padding:8px 4px 6px}',
    /* Tabs grow EQUALLY (flex:1 1 0) so the left pair and the right pair always
       have the same width -> the centre pill sits exactly at 50% of the bar,
       regardless of how wide "Community" vs "About" render. */
    '#site-bottom-nav .fta-bn-tab{display:flex;flex:1 1 0;min-width:0;flex-direction:column;align-items:center;justify-content:center;',
    'gap:2px;padding:4px;border-radius:12px;text-decoration:none;color:#8b7269;',
    '-webkit-tap-highlight-color:transparent;transition:color .15s ease}',
    '#site-bottom-nav .fta-bn-tab[aria-current="page"]{color:#f4511e}',
    '#site-bottom-nav .fta-bn-tab .material-symbols-outlined{font-size:22px;color:inherit}',
    '#site-bottom-nav .fta-bn-tab .fta-bn-label{font-size:10px;font-weight:700;letter-spacing:-.01em;',
    'white-space:nowrap;color:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
    /* Pill sits VERTICALLY CENTRED in the bar (matches the reference), not
       raised above it: no negative margin, centred on the flex cross-axis. */
    '#site-bottom-nav .fta-bn-pill{display:flex;align-items:center;gap:6px;flex-shrink:0;align-self:center;height:44px;',
    'padding:0 16px;border:0;border-radius:9999px;background:#f4511e;color:#fff;',
    'font-family:inherit;font-size:13px;font-weight:800;text-decoration:none;position:relative;z-index:10;',
    'box-shadow:0 10px 20px rgba(244,81,30,.40);cursor:pointer;-webkit-tap-highlight-color:transparent;',
    'transition:transform .15s ease}',
    '#site-bottom-nav .fta-bn-pill:active{transform:scale(.95)}',
    '#site-bottom-nav .fta-bn-pill .material-symbols-outlined{font-size:20px;color:#fff}',
    /* ---- footer: desktop only (hidden on mobile screens like the mock) ---- */
    '#site-footer{display:none}',
    '@media (min-width:768px){#site-footer{display:block}}',
  ].join('');

  function injectStyle() {
    if (!document.head || document.getElementById('site-chrome-style')) return;
    var style = document.createElement('style');
    style.id = 'site-chrome-style';
    style.textContent = CHROME_CSS;
    document.head.appendChild(style);
  }

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

    return '<header id="site-top-header" class="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-surface-container-highest shadow-sm">'
      + '<div class="fta-hd-inner h-[68px] w-full px-4 lg:px-8 flex items-center justify-between gap-4">'
      + '<div class="fta-hd-left flex items-center gap-3 min-w-0">'
        + '<a href="index.html" class="fta-hd-brandlink flex items-center gap-2.5 group min-w-0">'
          + '<span class="fta-logo h-10 w-10 sm:h-9 sm:w-9 shrink-0 rounded-full flex items-center justify-center text-xl shadow-sm" style="background:#a03b0e">🐾</span>'
          + '<span class="fta-brand text-lg sm:text-2xl font-bold tracking-tight text-on-surface group-hover:text-primary transition-colors leading-none min-w-0 truncate whitespace-nowrap">FeedAnAnimalMap</span>'
        + '</a>'
      + '</div>'
      + '<nav class="hidden md:flex items-center gap-1.5">' + links + '</nav>'
      + '<div class="fta-hd-right flex items-center gap-2.5 shrink-0">'
        + '<button type="button" class="fta-support flex h-10 px-3 sm:px-5 rounded-xl sm:rounded-full bg-[#E54848] hover:bg-[#d63c3c] text-white font-medium text-sm items-center gap-1.5 shadow-sm active:scale-95 transition-all" title="Support Animal Relief">'
          + '<span class="material-symbols-outlined text-[18px] fill-current">favorite</span><span class="fta-support-label hidden sm:inline">Support</span>'
        + '</button>'
        + '<a id="auth-link" href="auth.html" class="fta-signin h-10 px-4 rounded-full border border-surface-container-highest bg-white text-on-surface hover:bg-surface-container font-medium text-sm flex items-center justify-center transition-colors shadow-sm">'
          + '<span class="fta-signin-icon material-symbols-outlined text-[18px] mr-1 hidden sm:inline">person</span><span id="auth-link-label">Sign in</span>'
        + '</a>'
      + '</div>'
      + '</div></header>';
  }

  /* Is this page the map page? (index.html, or the site root) */
  function onMapPage() {
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return !file || file === '/' || file.indexOf('index') === 0;
  }

  function bottomTabHtml(l, active) {
    var on = l.id === active;
    return '<a href="' + esc(l.href) + '" data-bnav="' + esc(l.id) + '"'
      + (on ? ' aria-current="page"' : '')
      + ' class="fta-bn-tab flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-xl transition-colors"'
      + ' style="color:' + (on ? BOTTOM_ACCENT : BOTTOM_IDLE) + '">'
      + '<span class="material-symbols-outlined text-[22px]">' + esc(l.icon) + '</span>'
      + '<span class="fta-bn-label text-[10px] font-bold tracking-tight whitespace-nowrap">' + esc(l.label) + '</span></a>';
  }

  /* The elevated orange centre pill: List/Map switch on the map page,
     a link back to the map everywhere else. index.js binds the button by id. */
  function centerPillHtml() {
    var cls = 'fta-bn-pill flex shrink-0 items-center gap-1.5 h-11 px-4 self-center rounded-full text-white text-[13px] font-extrabold shadow-xl active:scale-95 transition-all relative z-10';
    var style = ' style="background:' + BOTTOM_ACCENT + '"';
    if (onMapPage()) {
      return '<button id="mobile-view-toggle" type="button" aria-label="Switch between the map and the list" class="' + cls + '"' + style + '>'
        + '<span id="mobile-view-toggle-icon" class="material-symbols-outlined text-[20px]">list</span>'
        + '<span id="mobile-view-toggle-label">List</span></button>';
    }
    return '<a href="index.html" aria-label="Open the animal map" class="' + cls + '"' + style + '>'
      + '<span class="material-symbols-outlined text-[20px]">map</span><span>Map</span></a>';
  }

  function bottomNavHtml() {
    var active = currentId();
    return '<nav id="site-bottom-nav" aria-label="Primary" '
      + 'class="md:hidden fixed inset-x-0 bottom-0 z-50 bg-white/95 backdrop-blur-md border-t border-surface-container-highest" '
      + 'style="padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -8px 24px rgba(30,27,26,.10)">'
      + '<div class="fta-bn-bar relative flex items-stretch justify-around px-1 pt-2 pb-1.5">'
      + bottomTabHtml(BOTTOM_TABS[0], active)
      + bottomTabHtml(BOTTOM_TABS[1], active)
      + centerPillHtml()
      + bottomTabHtml(BOTTOM_TABS[2], active)
      + bottomTabHtml(BOTTOM_TABS[3], active)
      + '</div></nav>';
  }

  function injectBottomNav() {
    if (!document.body || document.getElementById('site-bottom-nav')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = bottomNavHtml();
    document.body.appendChild(wrap.firstChild);
  }

  /* Re-apply the active tab on the bottom bar (hash navigation, back button). */
  function refreshBottom() {
    var nav = document.getElementById('site-bottom-nav');
    if (!nav) return;
    var active = currentId();
    var items = nav.querySelectorAll('a[data-bnav]');
    Array.prototype.forEach.call(items, function (a) {
      var on = a.getAttribute('data-bnav') === active;
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      a.style.color = on ? BOTTOM_ACCENT : BOTTOM_IDLE;
    });
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
    injectStyle();
    var slot = document.getElementById('site-header');
    if (slot && !slot.innerHTML.trim()) {
      slot.outerHTML = headerHtml();
      if (document.body) document.body.classList.add('has-site-header');
    }
    injectBottomNav();
    wireAuthLink();
    refreshActive();
    refreshBottom();
    // Same-page hash switches (Cities, topic threads)
    // must move the pill without a reload.
    window.addEventListener('hashchange', refreshActive);
    window.addEventListener('hashchange', refreshBottom);
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
    module.exports = { LINKS: LINKS, BOTTOM_TABS: BOTTOM_TABS, headerHtml: headerHtml,
      bottomNavHtml: bottomNavHtml, currentId: currentId, refreshActive: refreshActive,
      refreshBottom: refreshBottom };
  }
})();