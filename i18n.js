// Site-wide i18n engine. Finnish is the default language; English is the
// only other option for now. Loaded before script.js on every page (see
// the <script> order at the bottom of each HTML file) since script.js's
// contact-form validator needs the active translations too.
//
// How a page opts in:
//   <body data-i18n-page="home">                         -- which lang.PAGE.* block meta strings come from
//   <title data-i18n="meta.home.title">...</title>        -- innerHTML-replaced
//   <meta name="description" data-i18n-attr-content="meta.home.description">
//   <p data-i18n="home.heroKicker">Rohkeat Brändit...</p> -- innerHTML-replaced (values may contain <br>/<span>)
//   <img data-i18n-attr-alt="home.workAltEnergy" alt="Energiajuomabrändin verkkosivu">
//
// The Finnish text already sitting in the HTML (as written above) is a
// no-JS/pre-hydration fallback, not a second source of truth — translate()
// below overwrites it from lang/fi.json or lang/en.json on every load, so
// the JSON files are what actually ship. Any data-i18n-attr-X sets the
// attribute named X (alt, aria-label, content, ...); there's no
// restriction on which attributes are supported.
(function () {
  const STORAGE_KEY = 'doulve-lang';
  const DEFAULT_LANG = 'fi';
  const SUPPORTED = ['fi', 'en'];
  const cache = {}; // lang -> parsed JSON, so switching after the first load never re-fetches

  function getStoredLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(stored) ? stored : null;
    } catch (e) {
      return null; // localStorage blocked (private mode / disabled) — fall back silently
    }
  }

  function setStoredLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // Nothing we can do if storage is blocked — the switch still works
      // for this page view, it just won't persist to the next one.
    }
  }

  function resolve(dict, path) {
    return path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), dict);
  }

  // JSON values are written with HTML entities (e.g. "Web &amp; Media") so
  // they render correctly wherever they're injected via innerHTML — but
  // document.title and setAttribute() both take the string literally, with
  // no entity decoding, so an untouched value would show up as a literal
  // "&amp;" in the browser tab or an alt/aria-label. Route those two paths
  // through this first so entities resolve the same way everywhere.
  function decodeEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  async function loadLang(lang) {
    if (cache[lang]) return cache[lang];
    const res = await fetch(`lang/${lang}.json`);
    if (!res.ok) throw new Error(`Failed to load lang/${lang}.json (${res.status})`);
    const data = await res.json();
    cache[lang] = data;
    return data;
  }

  function applyToDom(dict, lang) {
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const value = resolve(dict, key);
      if (value === undefined) {
        console.warn(`[i18n] missing key "${key}" in lang/${lang}.json`);
        return;
      }
      if (el.tagName === 'TITLE') {
        document.title = decodeEntities(value);
      } else {
        el.innerHTML = value;
      }
    });

    document.querySelectorAll('*').forEach((el) => {
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('data-i18n-attr-')) continue;
        const targetAttr = attr.name.slice('data-i18n-attr-'.length);
        const key = attr.value;
        const value = resolve(dict, key);
        if (value === undefined) {
          console.warn(`[i18n] missing key "${key}" in lang/${lang}.json`);
          continue;
        }
        el.setAttribute(targetAttr, decodeEntities(value));
      }
    });
  }

  function updateSwitcherUI(lang) {
    document.querySelectorAll('.lang-switcher-code').forEach((el) => {
      el.textContent = lang.toUpperCase();
    });
    document.querySelectorAll('.lang-switcher-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.lang === lang);
      tab.setAttribute('aria-selected', String(tab.dataset.lang === lang));
    });
  }

  async function setLanguage(lang, { persist = true } = {}) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
    let dict;
    try {
      dict = await loadLang(lang);
    } catch (e) {
      console.error(e);
      if (lang !== DEFAULT_LANG) return setLanguage(DEFAULT_LANG, { persist: false });
      return;
    }
    applyToDom(dict, lang);
    updateSwitcherUI(lang);
    if (persist) setStoredLang(lang);
    window.currentLang = lang;
    document.dispatchEvent(new CustomEvent('doulve:langchange', { detail: { lang, dict } }));
  }

  // ---- Switcher popup open/close — plain UI wiring, no translation logic ----
  function initSwitcherUI() {
    document.querySelectorAll('.lang-switcher').forEach((widget) => {
      const toggle = widget.querySelector('.lang-switcher-toggle');
      const popup = widget.querySelector('.lang-switcher-popup');
      const closeBtn = widget.querySelector('.lang-switcher-close');
      const tabs = widget.querySelectorAll('.lang-switcher-tab');
      if (!toggle || !popup) return;

      function open() {
        popup.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
      }
      function close() {
        popup.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }

      toggle.addEventListener('click', (evt) => {
        evt.stopPropagation();
        popup.hidden ? open() : close();
      });
      closeBtn.addEventListener('click', close);
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          setLanguage(tab.dataset.lang);
          close();
        });
      });

      // Click-outside and Escape both dismiss without changing language —
      // standard dropdown behavior, not explicitly requested but expected.
      document.addEventListener('click', (evt) => {
        if (!popup.hidden && !widget.contains(evt.target)) close();
      });
      document.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape' && !popup.hidden) close();
      });
    });
  }

  // For dynamic (JS-generated) strings that don't live on a data-i18n
  // element — script.js's contact-form validation messages are the only
  // current user. Reads from whichever language is cached/active right
  // now; falls back to the key itself if it's ever called before the
  // first setLanguage() resolves, so a caller never gets `undefined`.
  function t(key) {
    const dict = cache[window.currentLang || DEFAULT_LANG];
    const value = dict && resolve(dict, key);
    return value !== undefined ? value : key;
  }

  window.doulveI18n = { setLanguage, loadLang, t };

  document.addEventListener('DOMContentLoaded', () => {
    initSwitcherUI();
    setLanguage(getStoredLang() || DEFAULT_LANG, { persist: false });
  });
})();
