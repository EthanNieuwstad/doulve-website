// Animation system for the homepage. Everything below is gated behind a
// single guard: if the user prefers reduced motion, or the GSAP CDN failed
// to load, no tween or ScrollTrigger is ever created — .motion-disabled
// forces every animated element to its final, fully visible state instead.

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsapAvailable = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
const motionDisabled = prefersReducedMotion || !gsapAvailable;

// The floating header's real height shifts slightly once Google Fonts swap
// in, so --header-h (used by scroll-margin-top and the hero's top padding)
// is measured, not hardcoded.
function syncHeaderHeight() {
  const header = document.querySelector('.site-header');
  const height = header.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--header-h', `${height}px`);
}

syncHeaderHeight();
window.addEventListener('resize', syncHeaderHeight);

// ---- Mobile nav hamburger toggle ----
// Pure functional UI, not animation — runs unconditionally regardless of
// the motionDisabled/GSAP gate below.
const navToggle = document.querySelector('.nav-toggle');
const siteHeader = document.querySelector('.site-header');

if (navToggle && siteHeader) {
  const closeNav = () => {
    siteHeader.classList.remove('nav-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navToggle.addEventListener('click', () => {
    const isOpen = siteHeader.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Tapping a link should close the menu rather than leave it open
  // underneath the page you just navigated to.
  siteHeader.querySelectorAll('.nav a').forEach((link) => {
    link.addEventListener('click', closeNav);
  });

  // Resizing back up to desktop (e.g. rotating a tablet, or a devtools
  // drag) shouldn't leave the menu stuck open once .nav-toggle is hidden.
  window.addEventListener('resize', () => {
    if (window.innerWidth > 640 && siteHeader.classList.contains('nav-open')) {
      closeNav();
    }
  });
}

// ---- Hero badge orbit ----
// Six badges circle the bird continuously. Runs at >=641px only — below
// that, style.css collapses .badge-orbit/.orbit-item with display:contents
// back into the plain stacked mobile layout, so there's nothing to
// position and the loop below is simply never started there. Respects
// prefers-reduced-motion: badges still land evenly spaced around the
// bird, just without the continuous spin.
(function initBadgeOrbit() {
  const orbit = document.querySelector('.badge-orbit');
  if (!orbit) return;
  const items = Array.from(orbit.querySelectorAll('.orbit-item'));
  if (!items.length) return;

  const ROTATION_MS = 25000; // one full loop every 25s — calm, not distracting
  const FRONT_SCALE = 1.18; // badge nearest the viewer (bottom of the ring)
  const BACK_SCALE = 0.88; // badge furthest away (top of the ring)
  const desktopQuery = window.matchMedia('(min-width: 641px)');

  let radius = 0;
  let rafId = null;
  let startTime = null;

  function measure() {
    const rect = orbit.getBoundingClientRect();
    // 0.68 keeps badges comfortably inside .hero-visual's box (accounting
    // for their own half-width) rather than right at the circle's edge.
    radius = (Math.min(rect.width, rect.height) / 2) * 0.68;
  }

  // Only transform/z-index are touched here — both are compositor-only
  // properties, so this never triggers layout reflow no matter how often
  // it runs.
  function layout(baseAngleDeg) {
    const count = items.length;
    items.forEach((item, i) => {
      const angle = (baseAngleDeg + (360 / count) * i) % 360;
      const rad = (angle * Math.PI) / 180;
      // "Front" is the bottom of the circle (angle 180deg) — closeness
      // eases smoothly from 0 (back) to 1 (front) via cosine, so there's
      // no hard jump as a badge crosses into/out of the front position.
      const closeness = (Math.cos(rad - Math.PI) + 1) / 2;
      const scale = BACK_SCALE + closeness * (FRONT_SCALE - BACK_SCALE);
      item.style.transform =
        `rotate(${angle}deg) translateY(${-radius}px) rotate(${-angle}deg) scale(${scale})`;
      // Front badge always renders above the rest of the ring — closeness
      // is already highest exactly there, so no separate sort/lookup needed.
      item.style.zIndex = String(Math.round(closeness * 1000) + 1);
    });
  }

  function tick(now) {
    if (startTime === null) startTime = now;
    const baseAngle = (((now - startTime) / ROTATION_MS) * 360) % 360;
    layout(baseAngle);
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (rafId !== null) return;
    measure();
    startTime = null;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function sync() {
    if (!desktopQuery.matches) {
      stop();
      return;
    }
    if (prefersReducedMotion) {
      stop();
      measure();
      layout(0); // static, evenly-spaced ring — no continuous motion
    } else {
      start();
    }
  }

  desktopQuery.addEventListener('change', sync);
  window.addEventListener('resize', () => {
    if (desktopQuery.matches) measure();
  });

  sync();
})();

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    syncHeaderHeight();
    if (!motionDisabled) ScrollTrigger.refresh();
  });
}

if (motionDisabled) {
  document.documentElement.classList.add('motion-disabled');
} else {
  gsap.registerPlugin(ScrollTrigger);
  initHeroTimeline();
  initScrollReveals();
}

// ---- Hero entrance: headline, tagline, and button stagger in on load ----
// power2.out (no bounce) keeps this reading as considered, not playful —
// overlapping the three tweens keeps total entrance time to ~1.1s.
// Uses fromTo (not from): these elements are permanently opacity:0 in CSS
// (so they never flash visible before GSAP loads), and .from() would read
// that same opacity:0 as its "current/end" state, animating 0 -> 0 — a
// silent no-op. fromTo states both ends explicitly instead of trusting CSS.
function initHeroTimeline() {
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
  tl.fromTo('.kicker', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 })
    .fromTo('.hero-headline .line', { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12 }, '-=0.3')
    .fromTo('.hero-foot', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 }, '-=0.2');
}

// ---- Scroll-triggered reveals: a section-level fade-in, then a finer ----
// ---- stagger for the content inside it. ----
// All use fromTo for the same reason as the hero timeline above.
//
// Every page now only contains a subset of these elements (a multi-page
// site, not one long scroll with everything present at once), so the
// singular-selector registrations below are guarded with an existence
// check first — registering a ScrollTrigger against a trigger selector
// that matches nothing produces a console warning. The array-based ones
// (.reveal-panel, [data-reveal-item]) don't need a guard: gsap.utils.toArray
// simply returns an empty array on a page that has none, and .forEach over
// that is already a safe no-op.
function initScrollReveals() {
  // Panel-level fade-ins — the "section transition" as the user scrolls
  // from one section into the next. .reveal-panel is the explicit opt-in
  // marker added to every content section that should behave this way;
  // .hero/.page-hero/.site-header deliberately don't carry it — their
  // entrance is the on-load hero timeline instead, or (for the header)
  // no entrance at all.
  gsap.utils.toArray('.reveal-panel').forEach((panel) => {
    gsap.fromTo(panel,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: panel, start: 'top 82%', toggleActions: 'play none none none' },
      }
    );
  });

  // Card grids (services, work, pricing) — stagger, landing just after the
  // panel fade above for a "panel arrives, then its cards settle in" effect.
  // Each [data-reveal-group] (a .service-grid or .pricing-grid) gets its own
  // trigger scoped to its own children, so multiple independent grids on
  // one page (or none at all) both work correctly without special-casing.
  gsap.utils.toArray('[data-reveal-group]').forEach((group) => {
    gsap.fromTo(group.querySelectorAll('[data-reveal-item]'),
      { opacity: 0, y: 30 },
      {
        opacity: 1,
        y: 0,
        duration: 0.55,
        ease: 'power2.out',
        stagger: { each: 0.12, from: 'start' },
        scrollTrigger: { trigger: group, start: 'top 80%', toggleActions: 'play none none none' },
      }
    );
  });

  // About text cluster (eyebrow, lede, body)
  if (document.querySelector('.about-inner')) {
    gsap.fromTo('.about-inner > *',
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.about-inner', start: 'top 80%', toggleActions: 'play none none none' },
      }
    );
  }

  // About photo — a gentle settle (fade + scale down to 1) rather than a slide
  if (document.querySelector('.about-photo')) {
    gsap.fromTo('.about-photo',
      { opacity: 0, scale: 1.06 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.about-panel', start: 'top 80%', toggleActions: 'play none none none' },
      }
    );
  }

  // Contact intro copy (appears in both the homepage teaser and the real
  // contact page, always inside a .contact-intro wrapper either way)
  if (document.querySelector('.contact-intro')) {
    gsap.fromTo('.contact-intro > *',
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.contact-intro', start: 'top 85%', toggleActions: 'play none none none' },
      }
    );
  }

  // Contact form fields — only present on contact.html
  if (document.querySelector('.contact-form')) {
    gsap.fromTo('.contact-form .field, .contact-form button',
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.45,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.contact-form', start: 'top 85%', toggleActions: 'play none none none' },
      }
    );
  }

  // Footer is deliberately left un-animated — a copyright line has nothing
  // to gain from motion.
}

// Hover (cards, buttons, nav) is intentionally pure CSS — see .service-card:hover
// and .btn-primary:hover in style.css. No JS-driven hover here: it would either
// duplicate the CSS transform (double-animating the same property) or need its
// own reduced-motion bookkeeping that CSS transitions get for free.
