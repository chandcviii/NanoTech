// One big SOLID microbot (images/microbot.png) drawn on a fixed, non-interactive canvas, centred on the
// hero's #microbotStage. Click (or press Enter/Space on) the microbot, or click the empty page background:
// the solid microbot dissolves into many tiny microbots, they fly to the click point, stay there for
// 2 seconds, then fly back to the original place and rebuild the solid microbot. Repeatable forever.
(() => {
  'use strict';

  const host = document.getElementById('bgMorph');
  const stage = document.getElementById('microbotStage');
  const zone = stage ? stage.querySelector('.microbot-zone') : null;

  const canvas = document.createElement('canvas');
  canvas.className = 'bg-swarm';
  canvas.setAttribute('aria-hidden', 'true');
  // Inline safety net: even if the stylesheet is missing/edited, this canvas can never enter page flow.
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2;display:block;';
  if (host && host.parentNode) host.parentNode.insertBefore(canvas, host.nextSibling);
  else document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const SPRITE_SRC = 'images/microbot.png';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TAU = Math.PI * 2;
  const TILT = 0.1;                 // base lean of the big microbot

  // ---- Timing (ms) ----
  const DISSOLVE = 500;     // solid microbot fades into the tiny microbots
  const GATHER = 800;       // time a tiny microbot needs to fly to the click point
  const SPREAD_IN = 350;    // delay between nearest and farthest one starting to fly
  const HOLD = 2000;        // swarm stays at the click point for 2 seconds
  const SPREAD_OUT = 400;   // random delay before each one leaves the click point
  const BUILD = 1000;       // time to fly back to the original place
  const FADE = 450;         // tiny microbots fade into the solid microbot again

  // ---- Idle sway (solid microbot) ----
  const SWAY_ROT = 0.07;
  const SWAY_X = 10;
  const SWAY_Y = 7;
  const SWAY_TURN = 0.06;

  const BRIGHT = 1.8;       // lifts the dark PNG so it shows on the black background (1 = original)

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  let W = 0, H = 0, dpr = 1, Hb = 300, raf = 0;
  let aspect = 0.4, sprite = null, tiny = null, big = null, TL = 12, parts = [];
  let cen = { x: 0, y: 0 }, homeVisible = true, seq = null, gx = 0, gy = 0;
  let fallbackCanvas = null;

  // Plain spindle: shown while the PNG loads, if it fails to load, and as a particle mask when the
  // browser refuses to let us read the PNG's pixels (file:// pages).
  function getFallback() {
    if (fallbackCanvas) return fallbackCanvas;
    const c = document.createElement('canvas');
    c.width = 40; c.height = 120;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 40, 0);
    grad.addColorStop(0, '#2a2728'); grad.addColorStop(0.5, '#7a7274'); grad.addColorStop(1, '#241f20');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(20, 2); g.lineTo(31, 30); g.lineTo(26, 48); g.lineTo(26, 72); g.lineTo(31, 90);
    g.lineTo(20, 118); g.lineTo(9, 90); g.lineTo(14, 72); g.lineTo(14, 48); g.lineTo(9, 30);
    g.closePath(); g.fill();
    g.beginPath(); g.arc(20, 60, 12, 0, TAU); g.fill();
    fallbackCanvas = c;
    return c;
  }

  // src is drawn (big + tiny microbots); maskSrc decides where the tiny microbots belong.
  function prepare(src, maskSrc) {
    maskSrc = maskSrc || src;
    seq = null;                                        // any running sequence refers to the old particles
    sprite = src;
    const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
    aspect = (nw / nh) || 0.33;

    const th = 48, tw = Math.max(1, Math.round(th * aspect));
    tiny = document.createElement('canvas');
    tiny.width = tw; tiny.height = th;
    const tc = tiny.getContext('2d');
    tc.imageSmoothingQuality = 'high';
    if (tc.filter !== undefined) tc.filter = 'brightness(2.2) contrast(1.05)';
    tc.drawImage(src, 0, 0, tw, th);

    const mh = clamp(Math.round(Math.sqrt(2000 / (aspect * 0.7))), 60, 130), mw = Math.max(4, Math.round(mh * aspect));
    const m = document.createElement('canvas');
    m.width = mw; m.height = mh;
    const mc = m.getContext('2d', { willReadFrequently: true });
    mc.drawImage(maskSrc, 0, 0, mw, mh);
    let d;
    try { d = mc.getImageData(0, 0, mw, mh).data; }
    catch (err) {                                      // tainted canvas (file://): use the spindle as mask
      if (maskSrc !== getFallback()) return prepare(src, getFallback());
      parts = []; return;
    }

    parts = [];
    let lo = 1, hi = 0;
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        const k = (j * mw + i) * 4;
        if (d[k + 3] < 110) continue;
        const lum = (0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]) / 255, n = parts.length;
        lo = Math.min(lo, lum); hi = Math.max(hi, lum);
        parts.push({
          lx: ((i + hash(n * 5 + 1)) / mw - 0.5) * aspect, ly: (j + hash(n * 5 + 2)) / mh - 0.5,
          lum, ang: (hash(n * 5 + 3) - 0.5) * 1.4,
          r: hash(n * 7 + 9) < 0.1 ? 10 + 14 * hash(n * 7 + 4) : 2 + 4 * hash(n * 7 + 5),
          w: (0.0005 + 0.001 * hash(n * 7 + 6)) * (hash(n * 7 + 7) < 0.5 ? -1 : 1),
          ph: hash(n * 7 + 8) * TAU, rr: hash(n * 7 + 10), curl: (hash(n * 7 + 11) - 0.5) * 0.8,
          alpha: 1, a0: 0, a1: 0, b0: 0, b1: 0
        });
      }
    }
    const span = (hi - lo) || 1;
    parts.forEach(p => { p.alpha = 0.35 + 0.65 * clamp((p.lum - lo) / span, 0, 1); });
  }

  // Pre-render the solid big microbot at the size it is shown
  function makeBig() {
    if (!sprite) return;
    const bh = Math.max(1, Math.round(Hb * dpr)), bw = Math.max(1, Math.round(bh * aspect));
    big = document.createElement('canvas');
    big.width = bw; big.height = bh;
    const bc = big.getContext('2d');
    bc.imageSmoothingQuality = 'high';
    if (bc.filter !== undefined) bc.filter = 'brightness(' + BRIGHT + ') contrast(1.05)';
    bc.drawImage(sprite, 0, 0, bw, bh);
  }

  // Size of the big microbot comes from the hero's microbot zone (falls back to a viewport guess).
  function measure() {
    if (zone) {
      const r = zone.getBoundingClientRect();
      // Increased multiplier to 1.15 and max cap to 800 for a much larger microbot
      Hb = clamp(Math.min(r.height * 1.15, (r.width * 1.15) / aspect), 100, 800);
    } else {
      Hb = clamp(Math.min(H * 0.8, W * 0.9, W * 0.4 / aspect), 200, 800);
    }
    TL = clamp(Hb / 32, 8, 16);
  }

  // The original place: centre of the microbot zone, re-read every frame so it follows page scroll.
  function placeHome() {
    if (zone) {
      const r = zone.getBoundingClientRect();
      cen.x = r.left + r.width / 2;
      cen.y = r.top + r.height / 2;
      homeVisible = r.bottom > -Hb && r.top < H + Hb;
    } else {
      cen.x = (W > 800 ? 0.8 : 0.72) * W;
      cen.y = 0.52 * H;
      homeVisible = true;
    }
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    measure();
    placeHome();
    makeBig();
    kick();
  }

  // gentle left/right sway of the solid microbot (tiny microbots follow it so the swap looks seamless)
  function swayAt(t) {
    if (reduce.matches) return { rot: TILT, ox: 0, oy: 0, sx: 1 };
    return {
      rot: TILT + Math.sin(t * 0.0008) * SWAY_ROT,
      ox: Math.sin(t * 0.0005) * SWAY_X,
      oy: Math.sin(t * 0.0009 + 1) * SWAY_Y,
      sx: 1 - SWAY_TURN * (0.5 + 0.5 * Math.sin(t * 0.0011))
    };
  }

  // live position of a tiny microbot inside the (swaying) body
  function live(p, t, s) {
    const th = t * p.w + p.ph, lx = p.lx * Hb * s.sx, ly = p.ly * Hb;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    gx = cen.x + s.ox + lx * cr - ly * sr + Math.cos(th) * p.r;
    gy = cen.y + s.oy + lx * sr + ly * cr + Math.sin(th) * p.r;
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!tiny || !big || (!homeVisible && !seq)) return;
    const s = swayAt(now);

    let solidA = 1, partA = 0;
    if (seq) {
      if (now < seq.t0 + DISSOLVE) { partA = clamp((now - seq.t0) / DISSOLVE, 0, 1); solidA = 1 - partA; }
      else if (now < seq.ret) { solidA = 0; partA = 1; }
      else { solidA = clamp((now - seq.ret) / FADE, 0, 1); partA = 1 - solidA; }
    }

    // 1) the solid big microbot
    if (solidA > 0.001) {
      ctx.globalAlpha = solidA;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cen.x + s.ox, cen.y + s.oy);
      ctx.rotate(s.rot);
      ctx.scale(s.sx, 1);
      ctx.drawImage(big, -Hb * aspect / 2, -Hb / 2, Hb * aspect, Hb);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // 2) the tiny microbots (only during a click sequence)
    if (seq && partA > 0.001) {
      const tw = TL * aspect, C = seq.C;
      for (const p of parts) {
        let x, y, ang = s.rot + p.ang + Math.sin(now * p.w + p.ph) * 0.5;
        if (now < p.b0) {
          if (now < p.a1) {                                        // dissolved, then flying to the click point
            live(p, now, s);
            const q = clamp((now - p.a0) / GATHER, 0, 1), k = q * q * q, dx = C.x - gx, dy = C.y - gy, cu = Math.sin(Math.PI * k) * p.curl;
            x = gx + dx * k - dy * cu; y = gy + dy * k + dx * cu;
            if (q > 0 && q < 1) ang = Math.atan2(dy, dx) - Math.PI / 2;
          } else {                                                 // gathered: tight swirling ball
            const rr = (4 + p.r) * clamp((now - p.a1) / 250, 0, 1), g = now * p.w * 3 + p.ph;
            x = C.x + Math.cos(g) * rr; y = C.y + Math.sin(g) * rr;
          }
        } else {                                                   // flying back to the original place
          live(p, now, s);
          const q = clamp((now - p.b0) / BUILD, 0, 1), k = 1 - Math.pow(1 - q, 3), g = now * p.w * 3 + p.ph, rr = (4 + p.r) * (1 - k);
          const dx = gx - C.x, dy = gy - C.y, cu = Math.sin(Math.PI * k) * p.curl;
          x = C.x + Math.cos(g) * rr + dx * k - dy * cu; y = C.y + Math.sin(g) * rr + dy * k + dx * cu;
          if (q > 0 && q < 1) ang = Math.atan2(dy, dx) - Math.PI / 2;
        }
        const c = Math.cos(ang) * dpr, sn = Math.sin(ang) * dpr;
        ctx.globalAlpha = p.alpha * partA;
        ctx.setTransform(c, sn, -sn, c, x * dpr, y * dpr);
        ctx.drawImage(tiny, -tw / 2, -TL / 2, tw, TL);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function frame(now) {
    raf = 0;
    if (seq && now >= seq.end) seq = null;             // sequence finished: solid microbot is fully back
    try { placeHome(); draw(now); }
    catch (err) { seq = null; console.error('Microbot animation error:', err); }   // always fall back to idle
    // Keep running while the microbot is on screen or a sequence is active; scroll/resize re-start it.
    if (!reduce.matches && !document.hidden && (homeVisible || seq)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function start(cx, cy) {
    if (seq || !tiny || !big || !parts.length || reduce.matches) return;   // one run at a time; none if reduced motion
    placeHome();
    if (!homeVisible) return;                                              // microbot scrolled away
    const now = performance.now();
    const s = swayAt(now);
    cx = clamp(cx, 0, W); cy = clamp(cy, 0, H);
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy)) || 1;
    let ret = 0;
    for (const p of parts) {
      live(p, now, s);
      const d = clamp(Math.hypot(gx - cx, gy - cy) / far, 0, 1);   // nearest ones leave first
      p.a0 = now + DISSOLVE + d * SPREAD_IN; p.a1 = p.a0 + GATHER;
      p.b0 = now + DISSOLVE + SPREAD_IN + GATHER + HOLD + p.rr * SPREAD_OUT; p.b1 = p.b0 + BUILD;
      ret = Math.max(ret, p.b1);
    }
    seq = { C: { x: cx, y: cy }, t0: now, ret, end: ret + FADE + 16 };
    kick();
  }

  // Where the swarm gathers when there is no pointer position (keyboard / assistive tech): beside the microbot.
  function keyboardTarget() {
    placeHome();
    return { x: clamp(cen.x - Hb * 1.1, 40, Math.max(40, W - 40)), y: clamp(cen.y, 40, Math.max(40, H - 40)) };
  }

  // ---- Input ----
  const onStageClick = e => {
    if (e.button !== 0) return;
    if (e.detail === 0) { const t = keyboardTarget(); start(t.x, t.y); }   // synthetic click (screen reader)
    else start(e.clientX, e.clientY);                                      // client coords = fixed-canvas coords
  };
  const onStageKey = e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();                                                    // stop Space from scrolling the page
    if (e.repeat) return;
    const t = keyboardTarget(); start(t.x, t.y);
  };
  if (stage) {
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('keydown', onStageKey);
  }

  // Clicking the empty page background also sends the swarm to that point (original behaviour).
  const isBackground = el => el === document.documentElement || el === document.body || (el && el.id === 'top');
  const onDocClick = e => {
    if (e.button !== 0 || !isBackground(e.target)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    start(e.clientX, e.clientY);
  };
  document.addEventListener('click', onDocClick);

  const onVisibility = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onScroll = () => kick();
  window.addEventListener('scroll', onScroll, { passive: true });
  const onMotion = () => { if (reduce.matches) seq = null; kick(); };
  if (reduce.addEventListener) reduce.addEventListener('change', onMotion);
  else if (reduce.addListener) reduce.addListener(onMotion);

  let resizeTimer = 0;
  const scheduleResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); };
  window.addEventListener('resize', scheduleResize);
  let ro = null;
  if (zone && 'ResizeObserver' in window) { ro = new ResizeObserver(scheduleResize); ro.observe(zone); }

  window.addEventListener('pagehide', () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; clearTimeout(resizeTimer);
    if (ro) ro.disconnect();
    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('visibilitychange', onVisibility);
    if (stage) { stage.removeEventListener('click', onStageClick); stage.removeEventListener('keydown', onStageKey); }
  });

  // ---- Start: show the placeholder at once, swap in the real PNG when it arrives ----
  prepare(getFallback());
  resize();

  const img = new Image();
  img.onload = () => { prepare(img); resize(); };
  img.onerror = () => console.warn('Microbot image failed to load:', SPRITE_SRC, '(using a plain spindle instead)');
  img.src = SPRITE_SRC;
})();