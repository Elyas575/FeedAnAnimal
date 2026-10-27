/* ------------------------------------------------------------------ *
 * StrayFeedingMap i18n core.
 *
 * Dictionaries live in lang-en.js / lang-es.js and each one
 * registers itself as window.FTA_LANG = { code: 'es', dict: {...} } via
 * window.FTA_LANGS registry below. English is the default and the
 * fallback for any missing key.
 *
 * Usage in static HTML:
 *   <h1 data-i18n="about.title">About</h1>
 *   <input data-i18n-ph="cities.search" placeholder="Search city...">
 *   <button data-i18n-aria="nav.messages" aria-label="Messages">
 *
 * Usage in JS (any script loaded AFTER i18n.js):
 *   window.FTA_I18N.t('nav.map') -> "Mapa" / "Map"
 *
 * Language is stored in localStorage ('fta.lang.v1'), defaults to the
 * browser language when it is es, otherwise English. Changing language
 * fires 'fta:lang-change' so dynamic renderers (nav, map cards, boards)
 * can re-render without a reload.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  var STORE_KEY = 'fta.lang.v1';
  var SUPPORTED = ['en', 'es'];

  window.FTA_LANGS = window.FTA_LANGS || {};

  function normalize(code) {
    code = String(code || '').toLowerCase().slice(0, 2);
    return SUPPORTED.indexOf(code) !== -1 ? code : 'en';
  }

  function stored() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }

  function browserLang() {
    try {
      var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
      if (nav.indexOf('es') === 0) return 'es';
    } catch (e) { /* ignore */ }
    return 'en';
  }

  var current = normalize(stored() || 'en');
  var obs = null;

  function dictFor(code) {
    var entry = window.FTA_LANGS[code];
    return (entry && entry.dict) || {};
  }

  /* t('nav.map') -> translated string. Missing keys fall back to English,
     then to the key itself so the UI never renders blank. */
  function t(key, vars) {
    var en = dictFor('en');
    var d = dictFor(current);
    var s = (d && d[key] != null) ? d[key] : (en[key] != null ? en[key] : key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = String(s).split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  function get() { return current; }

  function set(code) {
    code = normalize(code);
    if (code === current) return current;
    current = code;
    try { localStorage.setItem(STORE_KEY, code); } catch (e) { /* ignore */ }
    apply();
    try {
      window.dispatchEvent(new CustomEvent('fta:lang-change', { detail: { lang: code } }));
    } catch (e) {
      /* very old browsers: fall back to a reload-free manual refresh */
      if (typeof document !== 'undefined' && document.createEvent) {
        var ev = document.createEvent('CustomEvent');
        ev.initCustomEvent('fta:lang-change', false, false, { lang: code });
        window.dispatchEvent(ev);
      }
    }
    return current;
  }

  /* Build a map from English source strings to the current language's
     strings. Used to translate unannotated text nodes (static or
     dynamically rendered) without requiring data-i18n attributes. */
  function phraseMap() {
    var en = dictFor('en');
    var d = dictFor(current);
    var m = {};
    Object.keys(en).forEach(function (k) {
      var src = en[k];
      var dst = (d && d[k] != null) ? d[k] : en[k];
      if (src != null && dst != null) {
        var s = String(src).trim();
        if (s && String(src) !== String(dst)) m[s] = String(dst);
      }
    });
    return m;
  }

  /* Walk text nodes under scope and replace any exact English phrase. */
  function translateTextNodes(scope, map) {
    if (!scope || !document.createTreeWalker) return;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode;
      if (parent && (parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' ||
          parent.nodeName === 'NOSCRIPT')) continue;
      var original = node.nodeValue;
      var trimmed = String(original || '').trim();
      if (!trimmed) continue;
      if (map[trimmed]) {
        var leading = (original.match(/^\s*/) || [''])[0];
        var trailing = (original.match(/\s*$/) || [''])[0];
        node.nodeValue = leading + map[trimmed] + trailing;
      }
    }
  }

  /* Walk the DOM and swap every annotated string. Runs on boot and after
     every language change; dynamic scripts re-render via the event. */
  function apply(root) {
    if (obs) { try { obs.disconnect(); } catch (e) { /* ignore */ } }
    var scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    try { document.documentElement.setAttribute('lang', current); } catch (e) { /* ignore */ }

    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var ph = scope.querySelectorAll('[data-i18n-ph]');
    for (var p = 0; p < ph.length; p++) {
      ph[p].setAttribute('placeholder', t(ph[p].getAttribute('data-i18n-ph')));
    }
    var aria = scope.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < aria.length; a++) {
      aria[a].setAttribute('aria-label', t(aria[a].getAttribute('data-i18n-aria')));
    }
    var titles = scope.querySelectorAll('[data-i18n-title]');
    for (var u = 0; u < titles.length; u++) {
      titles[u].setAttribute('title', t(titles[u].getAttribute('data-i18n-title')));
    }
    var html = scope.querySelectorAll('[data-i18n-html]');
    for (var h = 0; h < html.length; h++) {
      html[h].innerHTML = t(html[h].getAttribute('data-i18n-html'));
    }

    /* Universal exact-phrase translation for any remaining text nodes. */
    try { translateTextNodes(scope === document ? document.body : scope, phraseMap()); } catch (e) { /* ignore */ }

    if (obs) {
      setTimeout(function () {
        try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
      }, 0);
    }
  }

  /* Keep watching: the header, map cards and forum rows are injected after
     load, so late markup with data-i18n attributes gets translated too. */
  function watch() {
    if (!('MutationObserver' in window) || !document.body) return;
    var timer = null;
    obs = new MutationObserver(function () {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        apply();
      }, 60);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.FTA_I18N = {
    t: t, get: get, set: set, apply: apply,
    supported: SUPPORTED.slice(), storeKey: STORE_KEY,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(); watch(); });
  } else {
    apply(); watch();
  }
})();
