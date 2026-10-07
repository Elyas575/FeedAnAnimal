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
    /* Chats is the LinkedIn-style Messaging entry: a button (not a link) that
       toggles the thread popover. The popover's "See all" hands off to the
       full inbox page. data-nav="inbox" keeps the active pill working when
       the volunteer IS on inbox.html. */
    { id: 'inbox',       label: 'Chats',       icon: 'forum',        href: 'inbox.html', chatButton: true },
    { id: 'about',       label: 'About',       icon: 'info',         href: 'about.html' },
  ];

  var NAV_ON = 'fta-nav-on';
  var NAV_OFF = 'fta-nav-off';

  /* Mobile-only bottom tab bar (CheapFoodMap style). Two tabs left of the
     elevated centre pill, two on the right. The centre pill itself is built
     by centerPillHtml(): on the map page it is the List/Map view switch,
     everywhere else it is a link back to the map. */
  var BOTTOM_TABS = [
    { id: 'cities',    label: 'Cities',    icon: 'public',      href: 'index.html#cities' },
    { id: 'community', label: 'Community', icon: 'chat_bubble',  href: 'community.html' },
    { id: 'activity',  label: 'Activity',  icon: 'history',      href: 'activity.html' },
    /* Chats replaces About here. On a phone the bottom bar is the only
       persistent nav, and a volunteer with a waiting reply should not have
       to find a thread through a footer link. About stays in the desktop
       nav and the page footers. */
    { id: 'inbox',     label: 'Chats',     icon: 'forum',        href: 'inbox.html', badge: true },
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
    '#site-top-header #fta-chat-pop{position:absolute;top:calc(100% + 8px);right:16px;width:min(340px,calc(100vw - 32px));',
    'background:#fff;border:1px solid #e9e1df;border-radius:16px;box-shadow:0 18px 48px rgba(30,27,26,.18);',
    'padding:10px;z-index:60}',
    '#site-top-header{position:fixed;top:0;left:0;right:0;z-index:50;',
    'background:rgba(255,255,255,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
    'border-bottom:1px solid #e9e1df;box-shadow:0 1px 2px rgba(30,27,26,.05)}',
    /* Single source of truth for the bar height, so a page that has to pad
       itself (about.html, 404.html, ...) can never drift from the real bar. */
    /* ---- LinkedIn-style desktop nav items --------------------------------
       Icon sits ABOVE the label, like LinkedIn's Home / My Network / Jobs /
       Messaging row. Each item is a column flexbox with room for an unread
       pill pinned to the icon's top-right (the Chats button uses it). */
    '#site-nav .fta-nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:2px;min-width:60px;padding:6px 8px;border-radius:8px;line-height:1.2;position:relative;text-decoration:none}',
    '#site-nav .fta-nav-item .material-symbols-outlined{font-size:22px;line-height:1}',
    '#site-nav .fta-nav-item .fta-nav-label{font-size:11px;white-space:nowrap}',
    '#site-nav button.fta-nav-item{background:none;border:0;cursor:pointer;font:inherit}',
    '#site-nav [data-chat-badge]{position:absolute;top:2px;right:8px;z-index:1}',
    '#site-nav .fta-nav-item.fta-nav-on{color:#1e1b1a;font-weight:700}',
    '#site-nav .fta-nav-item.fta-nav-on .material-symbols-outlined{color:#a03b0e}',
    '#site-nav .fta-nav-item.fta-nav-off{color:#8b7269;font-weight:500}',
    '#site-nav .fta-nav-item.fta-nav-off .material-symbols-outlined{color:#8b7269}',
    '#site-nav .fta-nav-item.fta-nav-off:hover{color:#1e1b1a;background:#f5ecea}',
    '#site-nav .fta-nav-item.fta-nav-off:hover .material-symbols-outlined{color:#1e1b1a}',
    /* ---- unread badge -------------------------------------------------
       One CSS class drives the desktop popover pill AND the mobile tab
       dot, so the two can never show different numbers. */
    '.fta-chat-badge{position:absolute;top:2px;left:50%;margin-left:4px;',
    'min-width:17px;height:17px;padding:0 4px;border-radius:999px;',
    'background:#a03b0e;color:#fff;font-size:10px;font-weight:800;line-height:17px;',
    'text-align:center;box-shadow:0 0 0 2px #fff}',
    '.fta-chat-badge[hidden]{display:none}',

    /* ---- desktop chat popover (LinkedIn-style) ---------------------- */
    '#fta-chat-pop[hidden]{display:none}',
    '#fta-chat-pop .fta-cp-head{display:flex;align-items:center;justify-content:space-between;',
    'padding:12px 14px;border-bottom:1px solid #efe6e4;font-weight:800;font-size:15px}',
    '#fta-chat-pop .fta-cp-list{max-height:min(420px,60vh);overflow-y:auto}',
    '#fta-chat-pop .fta-cp-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;',
    'padding:10px 14px;border:0;border-bottom:1px solid #f5efee;background:#fff;',
    'cursor:pointer;font-family:inherit;transition:background .12s}',
    '#fta-chat-pop .fta-cp-row:hover{background:#fdf4f0}',
    '#fta-chat-pop .fta-cp-row.unread{background:#fff4ec}',
    '#fta-chat-pop .fta-cp-empty{padding:22px 14px;text-align:center;color:#8b7269;font-size:13px;line-height:1.6}',

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
    '#site-top-header .fta-logo{flex:0 0 auto;width:48px;height:48px;border-radius:9999px;',
    'display:flex;align-items:center;justify-content:center;font-size:20px;background:#a03b0e;',
    'box-shadow:0 1px 2px rgba(30,27,26,.15)}',
    '@media (min-width:640px){#site-top-header .fta-logo{width:44px;height:44px}}',
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
    /* ---- account card (profile + log out, opened from the signed-in chip) ---- */
    '#site-top-header #fta-account-pop{position:absolute;top:calc(100% + 8px);right:16px;width:min(290px,calc(100vw - 32px));',
    'background:#fff;border:1px solid #e9e1df;border-radius:16px;box-shadow:0 18px 48px rgba(30,27,26,.18);',
    'padding:14px;z-index:60}',
    '#site-top-header #fta-account-pop[hidden]{display:none}',
    '#site-top-header .fta-account-id{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid #f1eae7}',
    '#site-top-header .fta-account-avatar{width:40px;height:40px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:#fff}',
    '#site-top-header .fta-account-text{min-width:0}',
    '#site-top-header .fta-account-name{display:block;font-size:15px;font-weight:800;color:#2e1c12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#site-top-header .fta-account-email{display:block;font-size:12.5px;color:#8b7269;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#site-top-header .fta-account-signout{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:12px;',
    'padding:10px 14px;border-radius:12px;border:1px solid #f0d9d2;background:#fff5f2;color:#ba1a1a;font-weight:800;font-size:14px;cursor:pointer}',
    '#site-top-header .fta-account-signout:hover{background:#ffe9e3}',
    '#site-top-header .fta-account-signout:disabled{opacity:.6;cursor:default}',
    '#site-top-header .fta-account-signout .material-symbols-outlined{font-size:18px}',
    '#site-top-header #fta-account-error{margin-top:8px;font-size:12px;color:#ba1a1a}',
    '#site-top-header #fta-account-error[hidden]{display:none}',
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

  function navItemHtml(l, active) {
    var on = l.id === active;
    /* The Chats entry IS the message bell: a button that toggles the
       LinkedIn-style thread popover. It keeps data-nav="inbox" so the
       active pill still lights when the volunteer is on inbox.html. */
    if (l.chatButton) {
      return '<button type="button" id="fta-chat-btn" data-nav="' + esc(l.id) + '"'
        + ' aria-haspopup="true" aria-expanded="false"'
        + ' aria-label="Messages" title="Messages"'
        + (on ? ' aria-current="page"' : '')
        + ' class="fta-nav-item ' + (on ? NAV_ON : NAV_OFF) + '">'
        + '<span class="material-symbols-outlined">' + esc(l.icon) + '</span>'
        + '<span class="fta-nav-label">' + esc(l.label) + '</span>'
        + '<span class="fta-chat-badge" data-chat-badge="desktop" hidden></span>'
        + '</button>';
    }
    return '<a href="' + esc(l.href) + '" data-nav="' + esc(l.id) + '"'
      + (on ? ' aria-current="page"' : '')
      + ' class="fta-nav-item ' + (on ? NAV_ON : NAV_OFF) + '">'
      + '<span class="material-symbols-outlined">' + esc(l.icon) + '</span>'
      + '<span class="fta-nav-label">' + esc(l.label) + '</span></a>';
  }

  function headerHtml() {
    var active = currentId();
    var links = LINKS.map(function (l) { return navItemHtml(l, active); }).join('');

    return '<header id="site-top-header" class="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-surface-container-highest shadow-sm">'
      + '<div class="fta-hd-inner h-[68px] w-full px-4 lg:px-8 flex items-center justify-between gap-4">'
      + '<div class="fta-hd-left flex items-center gap-3 min-w-0">'
        + '<a href="index.html" class="fta-hd-brandlink flex items-center gap-2.5 group min-w-0">'
          + '<span class="fta-logo h-20 w-20 sm:h-16 sm:w-16 shrink-0 rounded-full flex items-center justify-center text-xl shadow-sm" style="background:#fff"><img src="logo/logo.png" alt="FeedAnAnimalMap logo" class="h-full w-full object-contain px-1"></span>'
          + '<span class="fta-brand text-lg sm:text-2xl font-bold tracking-tight text-on-surface group-hover:text-primary transition-colors leading-none min-w-0 truncate whitespace-nowrap">FeedAnAnimalMap</span>'
        + '</a>'
      + '</div>'
      + '<nav id="site-nav" class="hidden md:flex items-center gap-1">' + links + '</nav>'
      + '<div class="fta-hd-right flex items-center gap-2.5 shrink-0">'
        /* The thread popover lives one level up so it anchors under the
           Chats nav button, not inside a separate bell wrapper. */
        + '<div id="fta-chat-pop" hidden role="dialog" aria-label="Your conversations">'
            + '<div class="fta-cp-head"><span>Messages</span>'
              + '<a href="inbox.html" class="text-xs font-bold" style="color:#a03b0e">See all</a>'
            + '</div>'
            + '<div class="fta-cp-list" id="fta-chat-list"></div>'
          + '</div>'
        + '<button type="button" class="fta-support flex h-10 px-3 sm:px-5 rounded-xl sm:rounded-full bg-[#E54848] hover:bg-[#d63c3c] text-white font-medium text-sm items-center gap-1.5 shadow-sm active:scale-95 transition-all" title="Support Animal Relief">'
          + '<span class="material-symbols-outlined text-[18px] fill-current">favorite</span><span class="fta-support-label hidden sm:inline">Support</span>'
        + '</button>'
        + '<a id="auth-link" href="auth.html" class="fta-signin h-10 px-4 rounded-full border border-surface-container-highest bg-white text-on-surface hover:bg-surface-container font-medium text-sm flex items-center justify-center transition-colors shadow-sm">'
          + '<span class="fta-signin-icon material-symbols-outlined text-[18px] mr-1 hidden sm:inline">person</span><span id="auth-link-label">Sign in</span>'
        + '</a>'
        /* Account card behind the signed-in chip: avatar, name, email and
           the Log out button. Hidden until the chip is clicked. */
        + '<div id="fta-account-pop" hidden role="dialog" aria-label="Your account">'
          + '<div class="fta-account-id">'
            + '<span class="fta-account-avatar" id="fta-account-avatar">?</span>'
            + '<span class="fta-account-text">'
              + '<b class="fta-account-name" id="fta-account-name">Account</b>'
              + '<small class="fta-account-email" id="fta-account-email"></small>'
            + '</span>'
          + '</div>'
          + '<button type="button" id="fta-account-signout" class="fta-account-signout">'
            + '<span class="material-symbols-outlined" aria-hidden="true">logout</span>'
            + '<span>Log out</span>'
          + '</button>'
          + '<div id="fta-account-error" hidden></div>'
        + '</div>'
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
      + ' class="fta-bn-tab flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1 rounded-xl transition-colors relative"'
      + ' style="color:' + (on ? BOTTOM_ACCENT : BOTTOM_IDLE) + '">'
      + '<span class="material-symbols-outlined text-[22px]">' + esc(l.icon) + '</span>'
      + '<span class="fta-bn-label text-[10px] font-bold tracking-tight whitespace-nowrap">' + esc(l.label) + '</span>'
      + (l.badge ? '<span class="fta-chat-badge" data-chat-badge="mobile" hidden></span>' : '')
      + '</a>';
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

  /* ------------------------------------------------------------------ *
   * Unread badge + desktop popover.
   *
   * Reads the SAME sbInbox() the inbox page reads, so the pill, the
   * popover list and inbox.html can never disagree about what is unread.
   * Everything degrades silently: without Supabase, or without the chat
   * tables, the bell simply has no badge.
   * ------------------------------------------------------------------ */
  var CHAT_HUES = ['#a03b0e', '#7c4a21', '#4b6b3a', '#2f6f6a', '#3b5a8a', '#6b3a7a', '#8a5a2b', '#5a6b2f'];

  function chatHue(name) {
    var src = String(name == null ? '' : name), h = 0;
    for (var i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
    return CHAT_HUES[h % CHAT_HUES.length];
  }

  function chatInitials(name) {
    var parts = String(name == null ? '' : name).trim().split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function chatAgo(iso) {
    var at = Date.parse(iso);
    if (!isFinite(at)) return '';
    var mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    if (mins < 1440) return Math.round(mins / 60) + 'h';
    var d = Math.round(mins / 1440);
    if (d < 7) return d + 'd';
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function chatPopRow(t) {
    var who = t.peerName || 'Volunteer';
    var preview = t.lastBody ? (t.lastMine ? 'You: ' + t.lastBody : t.lastBody) : 'No messages yet';
    return '<button type="button" class="fta-cp-row' + (t.unread ? ' unread' : '') + '"'
      + ' data-animal="' + esc(t.animalId || '') + '"'
      /* The conversation id travels too. Without it the map has to guess the
         other person from the animal's care log, which names whoever fed it
         LAST - so tapping "Lala" could open a blank thread with a third
         volunteer. This row already knows; carry it. */
      + ' data-conversation="' + esc(t.id || '') + '">'
      + '<span class="relative w-9 h-9 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"'
        + ' style="background:' + esc(chatHue(who)) + '">'
        + '<span style="color:#fff;font-size:13px;font-weight:800">' + esc(chatInitials(who)) + '</span></span>'
      + '<span style="flex:1;min-width:0">'
        + '<span style="display:flex;align-items:baseline;justify-content:space-between;gap:6px">'
          + '<b style="font-size:13.5px;color:#1e1b1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(who) + '</b>'
          + '<span style="font-size:10.5px;color:#8b7269;flex-shrink:0">' + esc(chatAgo(t.lastAt)) + '</span>'
        + '</span>'
        + '<span style="display:block;font-size:12px;color:#57423b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
          + esc(preview) + '</span>'
        + (t.animalName ? '<span style="font-size:10.5px;color:#a03b0e;font-weight:700">about ' + esc(t.animalName) + '</span>' : '')
      + '</span>'
      + (t.unread ? '<span class="fta-chat-badge" style="position:static;box-shadow:none">' + (t.unread > 99 ? '99+' : t.unread) + '</span>' : '')
    + '</button>';
  }

  /* Both badges are written from one count, so the desktop pill and the
     mobile tab can never show different numbers. */
  function paintBadges(count) {
    var n = Number(count) || 0;
    var nodes = document.querySelectorAll('[data-chat-badge]');
    Array.prototype.forEach.call(nodes, function (el) {
      el.textContent = n > 99 ? '99+' : String(n);
      if (n > 0) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    });
  }

  function closeChatPop() {
    var pop = document.getElementById('fta-chat-pop');
    var btn = document.getElementById('fta-chat-btn');
    if (pop) pop.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  async function loadChatBell() {
    var inbox = window.sbInbox;
    if (typeof inbox !== 'function') return;
    var rows = [];
    try { rows = (await inbox(8)) || []; } catch (e) { rows = []; }

    var unread = rows.reduce(function (sum, t) { return sum + (Number(t.unread) || 0); }, 0);
    paintBadges(unread);

    var list = document.getElementById('fta-chat-list');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<div class="fta-cp-empty">No messages yet.<br>Open an animal on the map and tap the chat button.</div>';
      return;
    }
    list.innerHTML = rows.slice(0, 6).map(chatPopRow).join('');
  }

  function wireChatBell() {
    var btn = document.getElementById('fta-chat-btn');
    var pop = document.getElementById('fta-chat-pop');
    if (!btn || !pop) return;

    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = pop.hasAttribute('hidden');
      if (open) {
        pop.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        loadChatBell();
      } else {
        closeChatPop();
      }
    });

    /* Click anywhere else closes it, and Escape always closes it - the two
       behaviours a popover is expected to have. The button contains spans,
       so the guard tests containment, not identity: clicking the icon
       itself must not count as "anywhere else". */
    document.addEventListener('click', function (event) {
      if (pop.hasAttribute('hidden')) return;
      if (!pop.contains(event.target) && !btn.contains(event.target)) closeChatPop();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !pop.hasAttribute('hidden')) closeChatPop();
    });

    pop.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var row = target.closest('[data-conversation]');
      if (!row) return;
      /* Hand the thread to the map, which owns the composer. Both ids go:
         the animal centres the pin, the conversation opens THIS thread. */
      var animal = row.getAttribute('data-animal') || '';
      var conversation = row.getAttribute('data-conversation') || '';
      var href = 'index.html';
      if (conversation) {
        href += '#chat=' + encodeURIComponent(animal || conversation) +
          '&conversation=' + encodeURIComponent(conversation);
      } else if (animal) {
        href += '#chat=' + encodeURIComponent(animal);
      }
      window.location.href = href;
    });

    /* Badge on load, then roughly every minute. Deliberately not realtime:
       a volunteer is not watching the bell, and polling keeps the socket
       budget for the open thread itself. */
    loadChatBell();
    setTimeout(loadChatBell, 2000);
    setInterval(loadChatBell, 60000);

    /* Opening a thread from the inbox clears its badge on the way out. */
    window.addEventListener('fta:chat-opened', loadChatBell);
  }

  /* ------------------------------------------------------------------ *
   * Account card. The signed-in chip used to be a plain link to         *
   * auth.html, which forwards signed-in visitors home - so there was no  *
   * reachable sign-out anywhere on the map. Clicking the chip now opens  *
   * a small card with the profile (avatar, name, email) and a Log out    *
   * button. Signed out, the chip still links to auth.html as before.     *
   * ------------------------------------------------------------------ */
  function accountCardEl() {
    return document.getElementById('fta-account-pop');
  }

  function closeAccountCard() {
    var pop = accountCardEl();
    if (pop) pop.setAttribute('hidden', '');
  }

  /* profiles.display_name > email prefix - the same name the chip shows. */
  function accountNameOf(user) {
    if (!user) return 'Account';
    if (user.user_metadata && user.user_metadata.display_name) return user.user_metadata.display_name;
    if (user.email) return user.email.split('@')[0];
    return 'Volunteer';
  }

  function fillAccountCard(user) {
    var name = accountNameOf(user);
    var put = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    put('fta-account-name', name);
    put('fta-account-email', (user && user.email) || '');
    var avatar = document.getElementById('fta-account-avatar');
    if (avatar) {
      avatar.textContent = chatInitials(name);
      avatar.style.background = chatHue((user && (user.email || user.id)) || '');
    }
    var err = document.getElementById('fta-account-error');
    if (err) { err.textContent = ''; err.setAttribute('hidden', ''); }
  }

  /* Anchor the card under whichever chip opened it: the desktop and mobile
     chips sit at different offsets, so the right edge is measured from the
     chip, then clamped so the card never leaves the viewport. */
  function openAccountCard(chip, user) {
    var pop = accountCardEl();
    if (!pop) return;
    fillAccountCard(user);
    pop.removeAttribute('hidden');
    var header = document.getElementById('site-top-header');
    if (header && chip && chip.getBoundingClientRect) {
      var headerBox = header.getBoundingClientRect();
      var chipBox = chip.getBoundingClientRect();
      var width = pop.offsetWidth || 290;
      var right = Math.round(headerBox.right - chipBox.right);
      var maxRight = Math.max(8, (window.innerWidth || 1280) - width - 10);
      pop.style.right = Math.min(Math.max(right, 8), maxRight) + 'px';
    }
  }

  async function wireAccountCard() {
    var chips = [];
    ['auth-link', 'auth-link-m'].forEach(function (id) {
      var link = document.getElementById(id);
      if (link) chips.push(link);
    });
    if (!chips.length) return;
    /* Anonymous sessions still show "Sign in": the card is for accounts
       that can genuinely sign out and back in. */
    var current = null;
    var refresh = async function () {
      try {
        /* Deliberately NOT sbEnsureAuth(): it creates an anonymous session
           when signed out, and the card must never change who is signed in. */
        if (!window.sbAuth) return;
        var user = await window.sbAuth.currentUser();
        current = (user && !user.is_anonymous) ? user : null;
      } catch (e) { /* the card is cosmetic - never block the page */ }
    };
    chips.forEach(function (chip) {
      chip.addEventListener('click', function (event) {
        if (!current) return;   /* signed out: follow the href to auth.html */
        var pop = accountCardEl();
        if (!pop) return;
        event.preventDefault();
        if (pop.hasAttribute('hidden')) openAccountCard(chip, current);
        else closeAccountCard();
      });
    });
    var pop = accountCardEl();
    if (pop) {
      var outBtn = document.getElementById('fta-account-signout');
      if (outBtn) {
        outBtn.addEventListener('click', async function () {
          if (outBtn.disabled) return;
          outBtn.disabled = true;
          try {
            if (window.sbAuth) await window.sbAuth.signOut();
            location.reload();
          } catch (e) {
            outBtn.disabled = false;
            var err = document.getElementById('fta-account-error');
            if (err) {
              err.textContent = 'Sign out failed: ' + ((e && e.message) || e);
              err.removeAttribute('hidden');
            }
          }
        });
      }
      /* Clicking anywhere else (or Escape) dismisses the card; clicks on
         the chips toggle it, so they must not count as "anywhere else". */
      document.addEventListener('click', function (event) {
        if (pop.hasAttribute('hidden')) return;
        if (pop.contains(event.target)) return;
        for (var i = 0; i < chips.length; i++) {
          if (chips[i].contains(event.target)) return;
        }
        closeAccountCard();
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeAccountCard();
      });
    }
    refresh();
    if (window.sbAuth) {
      try { window.sbAuth.onChange(refresh); } catch (e) {}
    }
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
    wireChatBell();
    wireAccountCard();
    refreshActive();
    refreshBottom();
    // Same-page hash switches (Cities, topic threads)
    // must move the pill without a reload.
    window.addEventListener('hashchange', refreshActive);
    window.addEventListener('hashchange', refreshBottom);
  }

  /* Re-apply the active state after in-page hash navigation. Covers both
     links and the Chats button, which carries data-nav="inbox". */
  function refreshActive() {
    var active = currentId();
    var items = document.querySelectorAll('#site-nav [data-nav]');
    if (!items.length) return;
    Array.prototype.forEach.call(items, function (a) {
      var on = a.getAttribute('data-nav') === active;
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      a.classList.remove(NAV_ON, NAV_OFF);
      a.classList.add(on ? NAV_ON : NAV_OFF);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LINKS: LINKS, BOTTOM_TABS: BOTTOM_TABS, headerHtml: headerHtml,
      bottomNavHtml: bottomNavHtml, currentId: currentId, refreshActive: refreshActive,
      refreshBottom: refreshBottom, chatPopRow: chatPopRow, paintBadges: paintBadges,
      chatInitials: chatInitials, chatHue: chatHue, chatAgo: chatAgo };
  }
})();