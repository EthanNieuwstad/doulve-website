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
// same breakpoint.
//
// On top of the ambient auto-rotation, the whole ring is drag-to-spin:
// grabbing anywhere in .hero-visual (mouse or touch) hands control of the
// angle straight to the pointer, release carries it on as momentum that
// decays with friction, and once that momentum drops below a threshold the
// ring eases the last bit of the way to whichever badge's resting slot is
// nearest — then, if left alone for a couple of seconds, the ambient
// rotation picks back up from right there. currentAngle is one unwrapped
// (not mod-360) accumulator that every mode below reads from and writes
// to, which is what lets control hand off between auto/drag/coast/snap
// without ever visibly jumping.
(function initBadgeOrbit() {
  const orbit = document.querySelector('.badge-orbit');
  const heroVisual = document.querySelector('.hero-visual');
  if (!orbit || !heroVisual) return;
  const items = Array.from(orbit.querySelectorAll('.orbit-item'));
  if (!items.length) return;

  const ROTATION_MS = 25000; // one full loop every 25s — calm, not distracting
  const AUTO_DEG_PER_MS = 360 / ROTATION_MS; // the ambient rotation's fixed rate + direction
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

  // ---- Drag / momentum / snap tuning ----
  const VELOCITY_WINDOW_MS = 100; // release velocity is measured over this trailing window
  // Raw measured pointer velocity reads soft compared to how fast a flick
  // *feels* like it should spin the wheel, so it's boosted before anything
  // else touches it.
  const VELOCITY_MULTIPLIER = 2.2;
  // deg/s cap on (boosted) release velocity — high enough that a real flick
  // can still land multiple full rotations before it noticeably slows, but
  // bounded so one wild swipe can't spin for absurdly long.
  const MAX_VELOCITY = 2200;
  // velocity *= this every second of coasting (exponential "friction" decay).
  // Much weaker than it sounds: at MAX_VELOCITY this still covers ~3 full
  // rotations before decaying away, which is what "whips around for a
  // while" actually requires.
  const FRICTION_PER_SECOND = 0.15;
  // deg/s — coasting only hands off to the magnet-snap once the wheel is
  // genuinely almost stopped, not just "slowing down". Kept low on purpose:
  // this is what stops the snap from fighting the momentum feel.
  const SNAP_VELOCITY_THRESHOLD = 10;
  // Longer than a typical UI snap, and eased in-out rather than out-only
  // (see the 'snap' branch in transientTick) — since velocity is already
  // near zero when this engages, an ease-out-from-a-standstill would still
  // read as a sudden yank. Ease-in-out instead ramps up and back down
  // gently, so the snap reads as the tail end of the same deceleration
  // rather than a distinct magnetic action.
  const SNAP_DURATION_MS = 700;
  const AUTO_RESUME_DELAY_MS = 2600; // idle time after settling before ambient rotation resumes
  const DRAG_IGNORE_THRESHOLD_DEG = 2; // total movement below this = a tap/click, not a drag

  let radiusX = 0;
  let radiusY = 0;
  let rafId = null; // ambient auto-rotation loop
  let transientRafId = null; // coast/snap follow-through loop, independent of the ambient one
  let lastTickTime = null;
  let lastTransientTime = null;
  let currentAngle = 0; // unwrapped degrees — the single source of truth every mode reads/writes

  // 'auto' | 'drag' | 'coast' | 'snap' | 'settled'
  let mode = 'auto';

  let lastPointerAngle = 0;
  let dragMoved = false; // did this pointer sequence turn into a real drag, or just a tap?
  let totalDragDeg = 0;
  let angleHistory = []; // { t, angle } samples over the trailing VELOCITY_WINDOW_MS
  let velocityDegPerSec = 0;
  let snapFromAngle = 0;
  let snapToAngle = 0;
  let snapStartTime = 0;
  let autoResumeTimeoutId = null;

  function measure() {
    const rect = orbit.getBoundingClientRect();
    const factor = mobileQuery.matches ? MOBILE_RADIUS_FACTOR : RADIUS_FACTOR;
    radiusX = (Math.min(rect.width, rect.height) / 2) * factor;
    radiusY = radiusX * ELLIPSE_RATIO;
  }

  // transform/opacity/filter are the only properties touched here — all
  // three are compositor/paint-only, so this never triggers layout reflow
  // no matter how often it runs (auto tick, drag move, or coast/snap frame).
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
      // than three independently-timed ones — unchanged whether the angle
      // is coming from the ambient loop, a drag, or the momentum/snap.
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

  // ---- Ambient auto-rotation — same fixed rate/direction as before ----
  function autoTick(now) {
    if (lastTickTime === null) lastTickTime = now;
    const dt = now - lastTickTime;
    lastTickTime = now;
    currentAngle += AUTO_DEG_PER_MS * dt;
    layout(currentAngle);
    rafId = requestAnimationFrame(autoTick);
  }

  function startAuto() {
    if (rafId !== null) return;
    lastTickTime = null;
    rafId = requestAnimationFrame(autoTick);
  }

  function stopAuto() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---- Pointer position → orbit angle ----
  // The ring is an ellipse, not a circle (see the x/y math in layout()
  // above), so a raw atan2(dy, dx) wouldn't line up with where the badges
  // actually sit — dragging straight up/down would spin the ring much
  // faster than dragging sideways, since the vertical radius is only 45%
  // of the horizontal one. Dividing dx/dy by the same radiusX/radiusY
  // used in layout() first undoes that squish, so the resulting angle
  // always matches layout()'s own parametrization and the ring follows
  // the pointer 1:1 around the visual ellipse, not an invisible circle.
  function pointerAngleDeg(clientX, clientY) {
    const rect = orbit.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (clientX - cx) / (radiusX || 1);
    const dy = (clientY - cy) / (radiusY || 1);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  function eventPoint(evt) {
    return evt.touches && evt.touches.length ? evt.touches[0] : evt;
  }

  // Angle delta via the short way round, so crossing the -180/180 seam
  // (or wrapping past 0/360) never produces a spurious 300+ degree jump.
  function shortestAngleDiff(from, to) {
    let diff = (to - from) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }

  // ---- Transient loop: momentum coast, then magnet-snap to a badge ----
  // Runs independently of the ambient auto loop so it works even when
  // reduced-motion has that one stopped (a direct-manipulation gesture and
  // its short follow-through aren't the continuous ambient motion that
  // setting is meant to suppress).
  function transientTick(now) {
    if (lastTransientTime === null) lastTransientTime = now;
    const dt = now - lastTransientTime;
    lastTransientTime = now;

    if (mode === 'coast') {
      const dtSec = dt / 1000;
      currentAngle += velocityDegPerSec * dtSec;
      velocityDegPerSec *= Math.pow(FRICTION_PER_SECOND, dtSec);
      if (Math.abs(velocityDegPerSec) < SNAP_VELOCITY_THRESHOLD) {
        beginSnap();
      }
    } else if (mode === 'snap') {
      const progress = Math.min(1, (now - snapStartTime) / SNAP_DURATION_MS);
      // Smoothstep (ease-in-out), not ease-out: velocity entering this
      // phase is already near zero (see SNAP_VELOCITY_THRESHOLD), so a
      // curve with a steep start (like ease-out-cubic) would read as a
      // sudden yank from a standstill. Smoothstep ramps gently up from
      // zero and back down to zero, so the pull into place feels like the
      // natural tail of the same deceleration rather than a distinct step.
      const eased = progress * progress * (3 - 2 * progress);
      currentAngle = snapFromAngle + (snapToAngle - snapFromAngle) * eased;
      if (progress >= 1) settle();
    }

    layout(currentAngle);

    transientRafId = mode === 'coast' || mode === 'snap' ? requestAnimationFrame(transientTick) : null;
  }

  function startTransient() {
    if (transientRafId !== null) return;
    lastTransientTime = null;
    transientRafId = requestAnimationFrame(transientTick);
  }

  function stopTransient() {
    if (transientRafId !== null) {
      cancelAnimationFrame(transientRafId);
      transientRafId = null;
    }
  }

  function beginSnap() {
    const slot = 360 / items.length;
    snapFromAngle = currentAngle;
    snapToAngle = Math.round(currentAngle / slot) * slot; // nearest badge's resting angle
    snapStartTime = performance.now();
    mode = 'snap';
  }

  function settle() {
    mode = 'settled';
    clearAutoResumeTimer();
    if (!prefersReducedMotion) {
      autoResumeTimeoutId = setTimeout(() => {
        if (mode === 'settled') {
          mode = 'auto';
          startAuto();
        }
      }, AUTO_RESUME_DELAY_MS);
    }
    // Under reduced motion, stay settled rather than scheduling a resume —
    // matches the site-wide convention of no continuous ambient motion.
  }

  function clearAutoResumeTimer() {
    if (autoResumeTimeoutId !== null) {
      clearTimeout(autoResumeTimeoutId);
      autoResumeTimeoutId = null;
    }
  }

  // ---- Drag handlers ----
  function onPointerDown(evt) {
    if (evt.button !== undefined && evt.button !== 0) return; // primary mouse button / touch only
    if (evt.type === 'mousedown') evt.preventDefault(); // stops text-select + native image-ghost-drag, not the later click

    clearAutoResumeTimer();
    stopAuto();
    stopTransient();

    mode = 'drag';
    dragMoved = false;
    totalDragDeg = 0;
    const point = eventPoint(evt);
    lastPointerAngle = pointerAngleDeg(point.clientX, point.clientY);
    angleHistory = [{ t: performance.now(), angle: currentAngle }];

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
    window.addEventListener('touchcancel', onPointerUp);
    heroVisual.classList.add('is-dragging');
  }

  function onPointerMove(evt) {
    if (mode !== 'drag') return;
    const point = eventPoint(evt);
    const angle = pointerAngleDeg(point.clientX, point.clientY);
    const delta = shortestAngleDiff(lastPointerAngle, angle);
    lastPointerAngle = angle;
    totalDragDeg += Math.abs(delta);

    if (!dragMoved && totalDragDeg > DRAG_IGNORE_THRESHOLD_DEG) dragMoved = true;

    if (dragMoved) {
      // touch-action: none on .hero-visual (style.css) already stops this
      // fighting page scroll from the very first touch; this is just a
      // second line of defense once a drag has actually committed.
      if (evt.cancelable) evt.preventDefault();
      currentAngle += delta;
      layout(currentAngle);
    }

    const now = performance.now();
    angleHistory.push({ t: now, angle: currentAngle });
    while (angleHistory.length > 2 && now - angleHistory[0].t > VELOCITY_WINDOW_MS) {
      angleHistory.shift();
    }
  }

  function onPointerUp() {
    if (mode !== 'drag') return;
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('touchend', onPointerUp);
    window.removeEventListener('touchcancel', onPointerUp);
    heroVisual.classList.remove('is-dragging');

    if (!dragMoved) {
      // A plain tap/click, not a spin — leave the ring exactly where it
      // was and let the badge's own click (navigation) proceed untouched.
      if (prefersReducedMotion) {
        mode = 'settled';
        layout(currentAngle);
      } else {
        mode = 'auto';
        startAuto();
      }
      return;
    }

    const now = performance.now();
    const recent = angleHistory.filter((h) => now - h.t <= VELOCITY_WINDOW_MS);
    if (recent.length >= 2) {
      const first = recent[0];
      const last = recent[recent.length - 1];
      const dtSec = (last.t - first.t) / 1000;
      velocityDegPerSec = dtSec > 0 ? (last.angle - first.angle) / dtSec : 0;
    } else {
      velocityDegPerSec = 0;
    }
    velocityDegPerSec *= VELOCITY_MULTIPLIER;
    velocityDegPerSec = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocityDegPerSec));

    if (Math.abs(velocityDegPerSec) < SNAP_VELOCITY_THRESHOLD) {
      beginSnap();
    } else {
      mode = 'coast';
    }
    startTransient();
  }

  // A drag that happens to end back over a badge shouldn't trigger its
  // navigation — this capture-phase listener cancels only the click that
  // immediately follows a real drag (dragMoved); a plain tap is untouched.
  orbit.addEventListener(
    'click',
    (evt) => {
      if (dragMoved) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    },
    true
  );

  heroVisual.addEventListener('mousedown', onPointerDown);
  heroVisual.addEventListener('touchstart', onPointerDown, { passive: true });

  function sync() {
    measure(); // radius factor depends on which side of mobileQuery we're on
    if (prefersReducedMotion) {
      stopAuto();
      if (mode === 'auto') {
        mode = 'settled';
        layout(currentAngle); // static ring — no continuous motion
      }
      // a drag/coast/snap already in progress is left alone; its own loop
      // is already calling layout() every frame with the latest radius.
    } else if (mode === 'auto') {
      startAuto();
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

// ---- Work page: websites showcase carousel ----
// Native scroll-snap already handles touch/trackpad drag on the track
// with zero JS; this only adds the visible prev/next arrows and position
// dots for mouse users, since dragging a horizontal track isn't an
// obvious affordance without a visible control. No-ops entirely on any
// page other than work.html.
(function initWorkShowcase() {
  const track = document.querySelector('.web-showcase-track');
  if (!track) return;
  const slides = Array.from(track.querySelectorAll('.web-slide'));
  if (!slides.length) return;

  const prevBtn = document.querySelector('.web-showcase-arrow--prev');
  const nextBtn = document.querySelector('.web-showcase-arrow--next');
  const dots = Array.from(document.querySelectorAll('.web-showcase-dot'));

  function currentIndex() {
    const center = track.scrollLeft + track.clientWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    slides.forEach((slide, i) => {
      const slideCenter = slide.offsetLeft + slide.offsetWidth / 2;
      const dist = Math.abs(slideCenter - center);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return closest;
  }

  function goTo(index) {
    const clamped = Math.max(0, Math.min(slides.length - 1, index));
    const slide = slides[clamped];
    const target = slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    track.scrollTo({ left: target, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }

  function updateDots() {
    const idx = currentIndex();
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === idx));
  }

  if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentIndex() - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentIndex() + 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  // Keeps the dots in sync with drag/swipe/trackpad scrolling too, not
  // just the arrow/dot buttons — rAF-throttled so a fast scroll doesn't
  // recompute the nearest slide on every single scroll event.
  let scrollRaf = null;
  track.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      updateDots();
      scrollRaf = null;
    });
  });

  updateDots();
})();

// ---- Contact page: client-side validation + AJAX form submission ----
// Pure functional UI, not animation — runs unconditionally like the nav
// toggle above, regardless of motionDisabled, since a contact form has to
// work the same whether or not GSAP loaded. No-op on every other page.
//
// SETUP REQUIRED: this posts to Formspree. Sign up free at formspree.io
// (using doulve.studios@gmail.com as the account email is simplest —
// that becomes the default recipient), create one form, and Formspree
// gives you an endpoint like https://formspree.io/f/abcdwxyz. Replace
// FORM_ID in contact.html's <form action="..."> with that real ID —
// both the fetch() below and the plain-HTML fallback (if JS is ever
// blocked) read the endpoint straight from the form's own action
// attribute, so that's the only place it needs to be set.
(function initContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const successEl = document.getElementById('form-success');
  const statusEl = document.getElementById('form-status');
  const submitBtn = form.querySelector('button[type="submit"]');
  const honeypot = form.querySelector('input[name="website_url"]');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validators = {
    name: (v) => (v.trim() ? '' : 'Enter your name.'),
    email: (v) => {
      if (!v.trim()) return 'Enter your email.';
      if (!EMAIL_RE.test(v.trim())) return 'Enter a valid email address.';
      return '';
    },
    project_type: () => (form.querySelector('input[name="project_type"]:checked') ? '' : 'Pick one option.'),
    message: (v) => (v.trim() ? '' : 'Tell us a bit about the project.'),
  };

  function fieldWrap(name) {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? el.closest('.field') : null;
  }

  function showError(name, message) {
    const errorEl = document.getElementById(`error-${name}`);
    if (errorEl) errorEl.textContent = message;
    const wrap = fieldWrap(name);
    if (wrap) wrap.classList.toggle('has-error', Boolean(message));
  }

  function validateField(name) {
    const el = form.querySelector(`[name="${name}"]`);
    const value = name === 'project_type' ? '' : el ? el.value : '';
    const message = validators[name](value);
    showError(name, message);
    return !message;
  }

  // Validate as the visitor fixes things, not just on submit — clears an
  // error the moment it's resolved instead of waiting for another submit.
  ['name', 'email', 'message'].forEach((name) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) el.addEventListener('input', () => validateField(name));
  });
  form.querySelectorAll('input[name="project_type"]').forEach((el) => {
    el.addEventListener('change', () => validateField('project_type'));
  });

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();

    const results = Object.keys(validators).map(validateField);
    if (results.includes(false)) {
      statusEl.textContent = 'Please fix the highlighted fields above.';
      statusEl.classList.remove('is-pending');
      const firstInvalid = form.querySelector('.has-error input, .has-error textarea, .has-error .chip-input');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    // Honeypot tripped — a real visitor never fills this in (it's off-
    // screen and skipped via tabindex="-1"). Pretend it worked and bail
    // rather than tipping the bot off, but never actually send it.
    if (honeypot && honeypot.value.trim()) {
      form.hidden = true;
      successEl.hidden = false;
      successEl.setAttribute('tabindex', '-1');
      successEl.focus();
      return;
    }

    statusEl.textContent = 'Sending…';
    statusEl.classList.add('is-pending');
    submitBtn.disabled = true;

    fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new FormData(form),
    })
      .then((response) => {
        if (response.ok) {
          form.hidden = true;
          successEl.hidden = false;
          successEl.setAttribute('tabindex', '-1');
          successEl.focus();
        } else {
          statusEl.textContent = 'Something went wrong — please try again, or email us directly at doulve.studios@gmail.com.';
          statusEl.classList.remove('is-pending');
          submitBtn.disabled = false;
        }
      })
      .catch(() => {
        statusEl.textContent = 'Something went wrong — please try again, or email us directly at doulve.studios@gmail.com.';
        statusEl.classList.remove('is-pending');
        submitBtn.disabled = false;
      });
  });
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
  initStatCounters();
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
  //
  // An optional data-reveal-delay="0.4" (seconds) on the group holds its
  // stagger back an extra beat past the default — used on the work page's
  // three showcase sections so the heading (already fading in via the
  // section's own .reveal-panel tween above) visibly lands first, and the
  // carousel/gallery/case cards follow a moment later, rather than
  // everything arriving in the same instant. Absent everywhere else, so
  // every other page's reveal-groups are completely unaffected.
  gsap.utils.toArray('[data-reveal-group]').forEach((group) => {
    const groupDelay = parseFloat(group.dataset.revealDelay || '0');
    gsap.fromTo(group.querySelectorAll('[data-reveal-item]'),
      { opacity: 0, y: 30 },
      {
        opacity: 1,
        y: 0,
        duration: 0.55,
        delay: groupDelay,
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

// ---- About page: animated stat counters (0 -> real value on scroll) ----
// The only page using [data-count-to] — a no-op everywhere else. Each
// element already holds its correct final number as static HTML (see the
// comment above .origin-stats in about.html), so a reader with JS off or
// GSAP failed to load simply sees the right number sit still; this only
// runs at all once motionDisabled is confirmed false (called from the
// same branch that registers ScrollTrigger), so it never touches gsap
// before the plugin exists. It resets the display to 0 itself right
// before animating, rather than starting at 0 in the HTML, so there's
// never a moment where a real user (JS enabled, motion allowed) sees a
// wrong number before the scroll trigger fires.
function initStatCounters() {
  document.querySelectorAll('[data-count-to]').forEach((el) => {
    const target = parseFloat(el.dataset.countTo);
    const duration = parseFloat(el.dataset.countDuration || '1.5');
    const proxy = { value: 0 };
    el.textContent = '0';
    gsap.to(proxy, {
      value: target,
      duration,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = String(Math.round(proxy.value));
      },
      scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' },
    });
  });
}

// Hover (cards, buttons, nav) is intentionally pure CSS — see .service-card:hover
// and .btn-primary:hover in style.css. No JS-driven hover here: it would either
// duplicate the CSS transform (double-animating the same property) or need its
// own reduced-motion bookkeeping that CSS transitions get for free.
