// Interactive microbot background
// The two background images are cut along the triangle mesh. On click, the cells ripple outward from the
// click point: each one collapses and re-forms as the other pattern (the swarm itself lives in swarm.js).
// Clicking again runs it the other way. Everything draws on one fixed canvas that never blocks clicks.
//
// SCROLL FIX: a click is stored as an event with its DOCUMENT position (clientX/Y + scroll offset), start
// time and expiry. The wave front is measured from that document point, so a cell's progress depends on
// (event, time, cell's document position = screen position + current scroll). Scrolling therefore moves the
// ripple with the page content instead of leaving it pinned to the screen; the wave keeps expanding across
// the whole page (also off-screen) until its own duration ends. Every click is its own event.
(() => {
  'use strict';

  const canvas = document.getElementById('bgMorph');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Background 1 is ORDER[0] (shown on load). Swap the two names to start with the other pattern.
  const PATTERNS = { honeycomb: 'images/background_1.png', triangles: 'images/background_2.png' };
  const ORDER = ['honeycomb', 'triangles'];
  const MESH = ORDER.indexOf('triangles');            // cells are cut along this image's rods

  // Triangle mesh measured on the image (image pixels): first node, node spacing, row spacing.
  const LATTICE = { x0: 170, y0: 85, dx: 178, dy: 145 };
  const IMG_W = 1698, IMG_H = 926;                    // fallback until the files report their size

  const WAVE = 1000;                                  // ms for the ripple to reach the far corner of the screen
  const JITTER = 220;                                 // random ms added to each cell's start
  const DUR_MIN = 820, DUR_VAR = 280;                 // ms each cell takes to collapse and re-form
  const TAU = Math.PI * 2;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const imgs = ORDER.map(() => new Image());
  const ready = ORDER.map(() => false);

  let W = 0, H = 0, dpr = 1;
  let covs = [null, null];
  let tiles = [];
  let mode = 0;                                       // pattern requested by the latest click (0 = Background 1)
  let baseMode = 0;                                   // pattern every cell shows when no ripple is running
  let animEnd = 0, rafId = 0, pending = null;
  const events = [];                                  // running ripples, oldest first
  const active = [];

  const docEl = document.documentElement;
  const pageX = () => window.scrollX || window.pageXOffset || 0;
  const pageY = () => window.scrollY || window.pageYOffset || 0;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeIn = t => t * t * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // Same "cover" fit for every image: scaled uniformly, centered, never stretched.
  function cover(img) {
    const iw = img.naturalWidth || IMG_W, ih = img.naturalHeight || IMG_H;
    const cs = Math.max(W / iw, H / ih);
    return { iw, ih, cs, ox: (W - iw * cs) / 2, oy: (H - ih * cs) / 2 };
  }

  // Draw the part of an image that sits under the screen rectangle (bx, by, bw, bh).
  function blit(c, img, cv, bx, by, bw, bh, tx, ty) {
    let sx = (bx - cv.ox) / cv.cs, sy = (by - cv.oy) / cv.cs, sw = bw / cv.cs, sh = bh / cv.cs;
    let dx = bx - tx, dy = by - ty, dw = bw, dh = bh;
    if (sx < 0) { dx -= sx * cv.cs; dw += sx * cv.cs; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy * cv.cs; dh += sy * cv.cs; sh += sy; sy = 0; }
    if (sx + sw > cv.iw) { dw -= (sx + sw - cv.iw) * cv.cs; sw = cv.iw - sx; }
    if (sy + sh > cv.ih) { dh -= (sy + sh - cv.ih) * cv.cs; sh = cv.ih - sy; }
    if (sw > 0 && sh > 0) c.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  // ---- Cells --------------------------------------------------------------------------------------------
  function buildTiles() {
    tiles = [];
    const mc = covs[MESH];
    // The lattice was measured on a 1698x926 image; scale it to whatever size the real file is.
    const kx = mc.iw / IMG_W, ky = mc.ih / IMG_H;
    const x0 = LATTICE.x0 * kx, y0 = LATTICE.y0 * ky, dx = LATTICE.dx * kx, dy = LATTICE.dy * ky;
    const sx = x => mc.ox + x * mc.cs, sy = y => mc.oy + y * mc.cs;
    const minX = -mc.ox / mc.cs, maxX = (W - mc.ox) / mc.cs;
    const minY = -mc.oy / mc.cs, maxY = (H - mc.oy) / mc.cs;
    const split = dx * mc.cs > 130 ? 1 : 0;           // cut big cells into four smaller ones

    const add = (a, b, c, level) => {
      if (level > 0) {
        const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
        const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
        add(a, ab, ca, level - 1); add(ab, b, bc, level - 1);
        add(ca, bc, c, level - 1); add(ab, bc, ca, level - 1);
        return;
      }
      const xs = [sx(a[0]), sx(b[0]), sx(c[0])], ys = [sy(a[1]), sy(b[1]), sy(c[1])];
      if ((xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]) < 0) {   // same winding for every cell
        [xs[1], xs[2]] = [xs[2], xs[1]]; [ys[1], ys[2]] = [ys[2], ys[1]];
      }
      if (Math.max(...xs) < -4 || Math.min(...xs) > W + 4 || Math.max(...ys) < -4 || Math.min(...ys) > H + 4) return;
      const cx = (xs[0] + xs[1] + xs[2]) / 3, cy = (ys[0] + ys[1] + ys[2]) / 3;
      const n = tiles.length;
      const t = { cx, cy, ex: [], ey: [], h1: hash(n * 3 + 1), h2: hash(n * 3 + 2), h3: hash(n * 3 + 3), v: 0 };
      for (let k = 0; k < 3; k++) {                    // outline pushed out 0.9px so neighbours overlap (no seams)
        const vx = xs[k] - cx, vy = ys[k] - cy, len = Math.hypot(vx, vy) || 1;
        t.ex.push(xs[k] + vx / len * 0.9); t.ey.push(ys[k] + vy / len * 0.9);
      }
      t.bx = Math.min(...t.ex) - 1; t.by = Math.min(...t.ey) - 1;
      t.bw = Math.max(...t.ex) + 1 - t.bx; t.bh = Math.max(...t.ey) + 1 - t.by;
      t.a = hash(n + 7.3) * TAU;
      t.sgn = hash(n + 91.7) < 0.5 ? -1 : 1;
      t.dur = DUR_MIN + t.h2 * DUR_VAR;                // how long this cell takes to flip
      t.jit = t.h1 * JITTER;                           // this cell's random extra delay
      tiles.push(t);
    };

    const r0 = Math.floor((minY - y0) / dy) - 1, r1 = Math.ceil((maxY - y0) / dy) + 1;
    for (let r = r0; r <= r1; r++) {
      const y = y0 + r * dy;
      const base = (r & 1) ? x0 - dx / 2 : x0;
      const i0 = Math.floor((minX - base) / dx) - 1, i1 = Math.ceil((maxX - base) / dx) + 1;
      for (let i = i0; i <= i1; i++) {
        const x = base + i * dx;
        add([x, y], [x - dx / 2, y + dy], [x + dx / 2, y + dy], split);   // triangle pointing up
        add([x, y], [x + dx, y], [x + dx / 2, y + dy], split);            // triangle pointing down
      }
    }
  }

  function layout(force) {
    const w = window.innerWidth, h = window.innerHeight;
    // Mobile browsers resize a little when their toolbar slides away; keep the canvas as is for that.
    if (!force && W && w === W && h < H && H - h < 160) return false;
    W = w; H = h;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // the artwork is ~1700px wide, more pixels add nothing
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    covs = imgs.map(cover);
    buildTiles();                                        // running ripples live in `events`, so they survive this
    return true;
  }

  // ---- Drawing ------------------------------------------------------------------------------------------
  function pathCell(t) {
    ctx.moveTo(t.ex[0], t.ey[0]); ctx.lineTo(t.ex[1], t.ey[1]); ctx.lineTo(t.ex[2], t.ey[2]); ctx.closePath();
  }

  function drawFragment(t, idx, s, rot, ox, oy) {
    ctx.save();
    ctx.translate(t.cx + ox, t.cy + oy);
    if (rot) ctx.rotate(rot);
    ctx.scale(s, s);
    ctx.translate(-t.cx, -t.cy);
    ctx.beginPath(); pathCell(t); ctx.clip();
    blit(ctx, imgs[idx], covs[idx], t.bx, t.by, t.bw, t.bh, 0, 0);
    ctx.restore();
  }

  // Value of a cell (0 = Background 1 ... 1 = Background 2) at time `now`, for the current scroll (sx, sy).
  // Events are replayed newest -> oldest. A newer ripple that has reached the cell turns it around from where
  // it is at that moment (same rule as before), so the result is the blend  A + B * (value further back).
  function valueAt(t, now, sx, sy) {
    const px = t.cx + sx, py = t.cy + sy;                // the cell's position in DOCUMENT coordinates
    let A = 0, B = 1, tc = now;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const dx = px - ev.x, dy = py - ev.y;
      const d = Math.min(Math.sqrt(dx * dx + dy * dy) / ev.ref, ev.dMax);
      const s = ev.t0 + Math.pow(d, 0.85) * WAVE + t.jit;   // moment the wave front reaches this cell
      if (tc <= s) continue;                                // not reached yet at the time we are looking at
      const k = (tc - s) / t.dur;
      if (k >= 1) return A + B * ev.mode;                   // this ripple has finished with the cell
      A += B * ev.mode * k; B *= 1 - k; tc = s;
    }
    return A + B * baseMode;
  }

  function renderTransition(now) {
    const sx = pageX(), sy = pageY();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    active.length = 0;

    // Layer 1: Background 1 everywhere (cells that have not started yet simply show through).
    let c = covs[0];
    ctx.drawImage(imgs[0], c.ox, c.oy, c.iw * c.cs, c.ih * c.cs);

    // Layer 2: every cell that has fully become Background 2, drawn in a single clipped pass.
    ctx.save();
    ctx.beginPath();
    let done = false;
    for (const t of tiles) {
      const v = t.v = valueAt(t, now, sx, sy);
      if (v >= 0.999) { t.v = 1; pathCell(t); done = true; }
      else if (v > 0.001) active.push(t);
      else t.v = 0;
    }
    if (done) {
      ctx.clip();
      c = covs[1];
      ctx.drawImage(imgs[1], c.ox, c.oy, c.iw * c.cs, c.ih * c.cs);
    }
    ctx.restore();

    // Layer 3: cells mid-change. Clear their old spot, then draw the shrinking / growing fragment.
    if (active.length) {
      ctx.fillStyle = '#000';
      ctx.beginPath();
      for (const t of active) pathCell(t);
      ctx.fill();
    }
    for (const t of active) {
      const v = t.v;
      const idx = v <= 0.5 ? 0 : 1;
      const s = idx === 0 ? 1 - easeIn(v * 2) : easeOut((v - 0.5) * 2);   // pulled in fast, settles softly
      if (s > 0.01) {
        const k = 1 - s, ang = t.a + now * 0.0004, mag = k * 24 * (0.4 + t.h3);
        drawFragment(t, idx, s, k * 2.094 * t.sgn * (idx ? -1 : 1), Math.cos(ang) * mag, Math.sin(ang) * mag);
      }
    }

  }

  function renderIdle() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const c = covs[baseMode];
    ctx.drawImage(imgs[baseMode], c.ox, c.oy, c.iw * c.cs, c.ih * c.cs);
  }

  // ---- Loop (runs only while a ripple is alive) ---------------------------------------------------------
  function frame(now) {
    rafId = 0;
    if (events.length && now >= animEnd) {              // every ripple has reached every cell: commit the result
      baseMode = events[events.length - 1].mode;
      events.length = 0;
      animEnd = 0;
    }
    if (events.length) { renderTransition(now); kick(); }
    else renderIdle();
  }
  function kick() { if (!rafId && ready[0]) rafId = requestAnimationFrame(frame); }

  // ---- Switching ----------------------------------------------------------------------------------------
  // x, y are DOCUMENT coordinates.
  function trigger(x, y) {
    if (!ready[0]) return;
    if (!ready[1]) { pending = [x, y]; return; }      // second image still downloading: run it once it lands
    if (events.length) return;                       // accept another click only after this transition finishes
    mode = 1 - mode;
    if (reduce.matches) {                              // reduced motion: swap straight away, no animation
      baseMode = mode; events.length = 0; animEnd = 0; kick();
      return;
    }
    const now = performance.now();
    const sx = pageX(), sy = pageY();
    // Same speed as before: the wave needs WAVE ms to reach the screen corner that is farthest from the click.
    const vx = clamp(x - sx, 0, W), vy = clamp(y - sy, 0, H);
    const ref = Math.max(Math.hypot(vx, vy), Math.hypot(W - vx, vy), Math.hypot(vx, H - vy), Math.hypot(W - vx, H - vy)) || 1;
    // The canvas only shows the viewport. Don't extend the cooldown across the full document height.
    const dMax = 1;
    const end = now + WAVE + JITTER + DUR_MIN + DUR_VAR + 16;
    events.push({ x, y, ref, dMax, mode, t0: now, end });
    animEnd = Math.max(animEnd, end);
    kick();
  }

  // ---- Input --------------------------------------------------------------------------------------------
  // Only the page background counts: the html/body margins and the empty space inside <main>.
  const isBackground = el => el === document.documentElement || el === document.body || (el && el.id === 'top');

  // swarm.js publishes an exact hit test of the visible microbot shape. While the pointer is on the microbot
  // the background stays quiet, so one click or hover never triggers both interactions.
  const overMicrobot = e => typeof window.__microbotHit === 'function' && window.__microbotHit(e.clientX, e.clientY);

  document.addEventListener('click', e => {
    if (e.button !== 0 || !isBackground(e.target) || overMicrobot(e)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    trigger(e.clientX + pageX(), e.clientY + pageY());   // viewport -> document coordinates
  });
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    document.documentElement.classList.toggle('bg-hover', isBackground(e.target) && !overMicrobot(e));
  }, { passive: true });
  document.addEventListener('mouseout', e => {
    if (!e.relatedTarget) document.documentElement.classList.remove('bg-hover');
  });
  // The tab was in the background: rAF paused, so just catch up (frame() commits any finished ripples).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (layout(false)) kick(); }, 120);
  });
  const onMotionChange = () => {
    if (reduce.matches) { baseMode = mode; events.length = 0; animEnd = 0; }
    kick();
  };
  if (reduce.addEventListener) reduce.addEventListener('change', onMotionChange);
  else if (reduce.addListener) reduce.addListener(onMotionChange);

  // ---- Start --------------------------------------------------------------------------------------------
  layout(true);
  imgs.forEach((img, i) => {
    img.decoding = 'async';
    img.onload = () => {
      ready[i] = true;
      layout(true);
      kick();
      if (i === 0) requestAnimationFrame(() => canvas.classList.add('is-ready'));
      if (i === 1 && pending) { const p = pending; pending = null; trigger(p[0], p[1]); }
    };
    img.onerror = () => console.warn('Background image failed to load:', PATTERNS[ORDER[i]]);
    img.src = PATTERNS[ORDER[i]];
  });
})();
