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
// Six badges circle the bird continuously, on a tilted ellipse rather than
// a flat circle so it reads as 3D: badges in the top half of the ellipse
// pass BEHIND the bird (lower z-index than it), badges in the bottom half
// pass IN FRONT of it (higher z-index). Runs at every width, including
// mobile — below 641px the ellipse just uses a smaller radius factor (see
// MOBILE_RADIUS_FACTOR) so it shrinks to fit that narrower column instead
// of overflowing it; style.css scales the badge art down to match at that
// same breakpoint. Respects prefers-reduced-motion: badges still land
// evenly spaced around the bird, just without the continuous spin.
(function initBadgeOrbit() {
  const orbit = document.querySelector('.badge-orbit');
  if (!orbit) return;
  const items = Array.from(orbit.querySelectorAll('.orbit-item'));
  if (!items.length) return;

  const ROTATION_MS = 25000; // one full loop every 25s — calm, not distracting
  const FRONT_SCALE = 1.3; // badge nearest the viewer (bottom of the ellipse)
  const BACK_SCALE = 0.6; // badge furthest away (top of the ellipse)
  const FRONT_OPACITY = 1.0;
  const BACK_OPACITY = 0.35;
  const MAX_BLUR_PX = 3; // full blur at the very back, easing to 0 at the front
  const ELLIPSE_RATIO = 0.45; // vertical radius as a fraction of horizontal
  // ~45% bigger than the original 0.72 — badges swing out further from
  // the bird now that scale/opacity/blur carry most of the depth read.
  const RADIUS_FACTOR = 1.04;
  // Bigger than a "never bleed past the column" factor would allow —
  // by design, front-of-ring badges swing out far enough to clip against
  // .hero's edges at the extremes (acceptable; see style.css's mobile
  // .hero-visual comment) rather than reading as a cramped, timid ring.
  const MOBILE_RADIUS_FACTOR = 0.75;
  // Must match .hero-bird's z-index in style.css — badges above this line
  // in the stack (top half of the ellipse) sit below the bird; badges
  // below it (bottom half) sit above the bird.
  const BIRD_Z = 50;
  const mobileQuery = window.matchMedia('(max-width: 640px)');

  let radiusX = 0;
  let radiusY = 0;
  let rafId = null;
  let startTime = null;

  function measure() {
    const rect = orbit.getBoundingClientRect();
    const factor = mobileQuery.matches ? MOBILE_RADIUS_FACTOR : RADIUS_FACTOR;
    radiusX = (Math.min(rect.width, rect.height) / 2) * factor;
    radiusY = radiusX * ELLIPSE_RATIO;
  }

  // transform/opacity/filter are the only properties touched here — all
  // three are compositor/paint-only, so this never triggers layout reflow
  // no matter how often it runs.
  function layout(baseAngleDeg) {
    const count = items.length;
    items.forEach((item, i) => {
      const angle = (baseAngleDeg + (360 / count) * i) % 360;
      const rad = (angle * Math.PI) / 180;
      // angle 0 = top of the ellipse, 90 = right, 180 = bottom ("front"),
      // 270 = left — standard clockwise clock-face convention.
      const x = radiusX * Math.sin(rad);
      const y = -radiusY * Math.cos(rad);
      // "Front" is the bottom of the ellipse (angle 180deg) — closeness
      // eases smoothly from 0 (back) to 1 (front) via cosine, so there's
      // no hard jump as a badge crosses into/out of the front position.
      // Scale, opacity, and blur are all driven off this same value every
      // frame, so all three read as one continuous depth effect rather
      // than three independently-timed ones.
      const closeness = (Math.cos(rad - Math.PI) + 1) / 2;
      const scale = BACK_SCALE + closeness * (FRONT_SCALE - BACK_SCALE);
      const opacity = BACK_OPACITY + closeness * (FRONT_OPACITY - BACK_OPACITY);
      const blur = MAX_BLUR_PX * (1 - closeness);

      item.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      item.style.opacity = String(opacity);
      item.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';

      // y < 0 is the top half of the ellipse (visually behind the bird),
      // y >= 0 is the bottom half (in front of it). Within each half,
      // closeness still orders badges relative to each other (the one
      // nearest dead-center-front/back renders most prominently), it just
      // never crosses the bird's own z-index (50) in either direction.
      const z =
        y < 0
          ? Math.round(closeness * (BIRD_Z - 10)) + 1 // 1..40, always < bird
          : BIRD_Z + Math.round(closeness * (BIRD_Z - 10)) + 1; // 51..90, always > bird
      item.style.zIndex = String(z);
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
    if (prefersReducedMotion) {
      stop();
      measure();
      layout(0); // static, evenly-spaced ring — no continuous motion
    } else {
      measure(); // radius factor depends on which side of mobileQuery we're on
      start();
    }
  }

  mobileQuery.addEventListener('change', sync);
  window.addEventListener('resize', sync);

  sync();
})();

// ---- Content Creation belt: exact seam-free loop distance ----
// A flat -50% looks right but isn't: flexbox `gap` is only counted N-1
// times across the 2N tiles in a row (gaps sit between tiles, not around
// them), so half of the full track width lands half a gap short of where
// the duplicated set actually starts. That shows up as a small jump/pause
// at the loop point. The fix is to measure the real distance — the
// offsetLeft of the first duplicated (aria-hidden) tile is exactly the
// width of one unique set, gaps included, whether or not tiles are equal
// width — and drive the keyframes off that via --belt-shift instead of a
// hardcoded percentage. Re-measured on resize since tile width/gap both
// change at the mobile breakpoint.
(function initContentBelt() {
  const tracks = document.querySelectorAll('.belt-track');
  if (!tracks.length) return;

  function measure() {
    tracks.forEach((track) => {
      const dupTile = track.querySelector('.belt-tile[aria-hidden="true"]');
      if (!dupTile) return;
      track.style.setProperty('--belt-shift', `${dupTile.offsetLeft}px`);
    });
  }

  measure();
  window.addEventListener('resize', measure);
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
