/* Treatment site — plumbing. No visual choreography lives here except the generic reveal helpers;
   this case's cover entrance, unforgettable thing and pins go in section 7.
   1 gate · 2 init · 3 smooth scroll · 4 video manager · 5 chapter nav · 6 reveals · 7 per-case */
(() => {
  'use strict';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SAVE_DATA = matchMedia('(prefers-reduced-data: reduce)').matches || !!(navigator.connection && navigator.connection.saveData);
  const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const MOBILE = matchMedia('(max-width: 640px)').matches;

  /* ---------- 1. Soft gate ----------
     SHA-256 hex of the password. Generate:
     node -e "crypto.subtle.digest('SHA-256',new TextEncoder().encode(process.argv[1])).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))" "the-password"
     Leave the placeholder to disable the gate (audit-site.mjs will warn). Needs https or localhost (SubtleCrypto). */
  const GATE_HASH = 'REPLACE_WITH_SHA256_HEX';

  async function sha256(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function unlock() {
    document.body.classList.remove('is-locked');
    const g = document.getElementById('gate');
    if (g) g.remove();
    init();
  }
  // Called at the very end of this file: without a gate it unlocks synchronously, and init()
  // needs every `let`/`const` below to be initialised first (TDZ otherwise).
  function gate() {
    const g = document.getElementById('gate');
    const disabled = !GATE_HASH || GATE_HASH.startsWith('REPLACE') || !window.crypto?.subtle;
    if (!g || disabled) { if (disabled && GATE_HASH.startsWith('REPLACE')) console.warn('[treatment] gate disabled: set GATE_HASH in main.js'); return unlock(); }
    let ok = false;
    try { ok = sessionStorage.getItem('tr-gate') === GATE_HASH; } catch (e) {}
    if (ok) return unlock();
    const form = document.getElementById('gate-form'), input = document.getElementById('gate-input'), err = document.getElementById('gate-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const h = await sha256(input.value.trim());
      if (h === GATE_HASH) { try { sessionStorage.setItem('tr-gate', h); } catch (e2) {} unlock(); }
      else { err.hidden = false; input.select(); }
    });
    input.focus();
  }

  /* ---------- 2. Init (after the gate) ---------- */
  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    if (window.gsap) gsap.registerPlugin(...[window.ScrollTrigger, window.SplitText].filter(Boolean));
    smoothScroll();
    videoManager();
    chapterNav();
    reveals();
    perCase();
    if (window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  /* ---------- 3. Smooth scroll (Lenis, synced to GSAP's ticker) ----------
     Native scroll on touch devices (battery, feel) and under reduced motion. */
  let lenis = null;
  function smoothScroll() {
    if (REDUCED || TOUCH || typeof Lenis === 'undefined') return;
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    if (window.gsap) {
      if (window.ScrollTrigger) lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }
  const scrollTo = (el) => (lenis ? lenis.scrollTo(el) : el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' }));

  /* ---------- 4. Video manager ----------
     - <source data-src> is attached ~1.5 viewports ahead (lazy), never all at once
     - plays at ≥35% visible, pauses otherwise; at most MAX_PLAYING decoding at a time
     - data-mobile="true" swaps .mp4 → -480.mp4 on narrow viewports
     - reduced motion / save-data: posters only, click to play that one
     - iOS Low Power Mode: retries on first touch */
  const MAX_PLAYING = 8;   // 16:9 slides hold up to ~6–8 loops at once
  function videoManager() {
    const videos = [...document.querySelectorAll('video.loop')];
    if (!videos.length) return;
    const playing = new Set(), wants = new Set();

    const attach = (v) => {
      if (v.dataset.loaded) return;
      v.querySelectorAll('source[data-src]').forEach((s) => {
        let src = s.dataset.src;
        if (MOBILE && v.dataset.mobile === 'true' && /\.mp4$/.test(src)) src = src.replace(/\.mp4$/, '-480.mp4');
        s.src = src;
      });
      v.dataset.loaded = '1';
      v.load();
    };
    const schedule = () => {
      for (const v of wants) {
        if (playing.size >= MAX_PLAYING) break;
        if (playing.has(v)) continue;
        attach(v);
        const p = v.play(); if (p) p.catch(() => {});
        playing.add(v);
      }
    };
    const stop = (v) => {
      wants.delete(v);
      if (playing.has(v)) { v.pause(); playing.delete(v); }
      schedule();
    };

    const loader = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) attach(e.target); }), { rootMargin: '150% 0px' });
    const player = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.35) { wants.add(e.target); schedule(); } else stop(e.target);
    }), { threshold: [0, 0.35, 0.6] });

    const manual = REDUCED || SAVE_DATA;
    videos.forEach((v) => {
      v.muted = true; v.defaultMuted = true; v.loop = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      if (v.classList.contains('loop--cover') && !manual) { attach(v); const p = v.play(); if (p) p.catch(() => {}); playing.add(v); return; }
      if (manual) {
        v.classList.add('loop--manual');
        v.removeAttribute('autoplay');
        v.addEventListener('click', () => { attach(v); v.paused ? v.play().catch(() => {}) : v.pause(); });
        loader.observe(v);
        return;
      }
      loader.observe(v); player.observe(v);
    });

    const kick = () => playing.forEach((v) => v.play().catch(() => {}));
    window.addEventListener('touchstart', kick, { passive: true, once: true });
    window.addEventListener('click', kick, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) playing.forEach((v) => v.pause());
      else playing.forEach((v) => v.play().catch(() => {}));
    });
  }

  /* ---------- 5. Chapter nav — built from section.chapter, highlights the current one ---------- */
  function chapterNav() {
    const nav = document.getElementById('chapters');
    const chapters = [...document.querySelectorAll('section.chapter')];
    if (!nav || !chapters.length) { if (nav) nav.remove(); return; }
    nav.innerHTML = '<ol>' + chapters.map((c) => {
      const h = c.querySelector('h2');
      return `<li><a href="#${c.id}" data-for="${c.id}"><span class="chapters__num">${c.dataset.chapter || ''}</span><span class="chapters__title">${h ? h.textContent.trim() : c.id}</span></a></li>`;
    }).join('') + '</ol>';
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]'); if (!a) return;
      const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
      e.preventDefault(); scrollTo(t); history.replaceState(null, '', a.getAttribute('href'));
    });
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) nav.querySelectorAll('a').forEach((a) => a.classList.toggle('is-current', a.dataset.for === e.target.id));
    }), { rootMargin: '-40% 0px -55% 0px' });
    chapters.forEach((c) => io.observe(c));
  }

  /* ---------- 6. Generic reveals ----------
     data-reveal         → block fades/rises once when 88% down the viewport
     data-reveal="lines" → display text splits into masked lines (SplitText)
     figure.ref          → loops fade up when entering
     Under reduced motion everything is simply visible. Tune easing/durations per case. */
  function reveals() {
    if (!window.gsap || !window.ScrollTrigger) return;
    const els = [...document.querySelectorAll('[data-reveal]')];
    if (REDUCED) return;
    els.forEach((el) => {
      if (el.dataset.reveal === 'lines' && window.SplitText) {
        const split = new SplitText(el, { type: 'lines', mask: 'lines', linesClass: 'line' });
        gsap.from(split.lines, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
      } else {
        gsap.from(el, { y: 24, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      }
    });
    gsap.utils.toArray('figure.ref').forEach((f) => {
      gsap.from(f, { opacity: 0, scale: 1.02, duration: 1.1, ease: 'power2.out', scrollTrigger: { trigger: f, start: 'top 85%', once: true } });
    });
  }

  /* ---------- 7. This case ----------
     Cover entrance (one orchestrated timeline), the unforgettable thing, pinned viewer /
     horizontal chapter, custom cursor… per design-brief.md. Gate large movement behind !REDUCED. */
  function perCase() {
    // Slides are fixed canvases (--w × --h canvas px, 1:1 with their «danya» pin) — scale each to its column.
    const frames = [...document.querySelectorAll('.slide-wrap')];
    const fit = () => frames.forEach((f) => {
      const s = f.querySelector('.slide'); if (!s) return;
      const cs = getComputedStyle(s);
      const W = parseFloat(cs.getPropertyValue('--w')) || 1920, H = parseFloat(cs.getPropertyValue('--h')) || 1080;
      const k = f.clientWidth / W;
      s.style.transform = `scale(${k})`;
      f.style.height = `${H * k}px`;
    });
    fit();
    let t; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { fit(); if (window.ScrollTrigger) ScrollTrigger.refresh(); }, 120); });
    if (document.fonts) document.fonts.ready.then(fit);

    // Phones read the slide as a picture — open the prose version under it.
    if (MOBILE) document.querySelectorAll('details.text').forEach((d) => { d.open = true; });

    if (REDUCED || !window.gsap || !window.ScrollTrigger) return;
    // One entrance: the cover page rises, then the chapter index slides in.
    gsap.from('#cover .slide-wrap', { opacity: 0, y: 24, duration: 0.9, ease: 'expo.out' });
    gsap.from('#chapters', { opacity: 0, x: -12, duration: 0.8, delay: 0.55, ease: 'expo.out' });
    // Each page is uncovered once, like turning a scrapbook page.
    gsap.utils.toArray('.chapter:not(#cover) .slide-wrap').forEach((f) => {
      gsap.fromTo(f, { clipPath: 'inset(6% 0% 0% 0%)', y: 24 }, { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: f, start: 'top 88%', once: true } });
    });
  }

  gate();
})();
