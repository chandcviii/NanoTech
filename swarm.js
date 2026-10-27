// One big SOLID microbot (images/microbot.png) drawn on a fixed, non-interactive canvas, centred on the
// hero's #microbotStage.
//  - Click (or press Enter/Space on) the microbot itself: it dissolves into many tiny microbots that play
//    ONE random effect ('explode' or 'morph') and then rebuild the solid microbot.
//  - Click the empty page background: the microbot dissolves into tiny microbots, they fly to the click
//    point, stay there, then fly back and rebuild the solid microbot.
// Every microbot animation lasts 5 seconds in total, and only ONE can run at a time.
//
// SCROLL FIX: positions are kept in DOCUMENT coordinates; the fixed canvas draws them at
// (documentPosition - currentScroll).
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

  // ---- Swarm timing (ms): background click ----
  const DISSOLVE = 500;     // solid microbot fades into the tiny microbots
  const GATHER = 800;       // time a tiny microbot needs to fly to the click point
  const SPREAD_IN = 350;    // delay between nearest and farthest one starting to fly
  const SPREAD_OUT = 400;   // random delay before each one leaves the click point
  const BUILD = 1000;       // time to fly back to the original place
  const FADE = 450;         // tiny microbots fade into the solid microbot again
  const TOTAL = 5000;       // total length of the swarm (the hold at the click point absorbs the rest)

  // ---- Microbot click effects (random: 'explode' or 'morph'), both 5 seconds in total ----
  const EX_CHARGE = 220, EX_BURST = 850, EX_HANG = 2030, EX_RET = 1000;   // explosion & reassembly (ms)
  const MO_START = 150, MO_SPREAD = 350, MO_TRAVEL = 800, MO_HOLD1 = 600,   // swarm morphing (ms)
        MO_MSPREAD = 250, MO_MORPH = 750, MO_HOLD2 = 500, MO_RSPREAD = 300, MO_RET = 850;
  const TRAIL = 45;                 // ms of history used to face sprites along their motion
  const SHAPES = ['ring', 'hex', 'tri', 'spiral'];
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut4 = t => 1 - Math.pow(1 - t, 4);

  // ---- Idle sway (solid microbot) ----
  const SWAY_ROT = 0.07;
  const SWAY_X = 10;
  const SWAY_Y = 7;
  const SWAY_TURN = 0.06;

  const BRIGHT = 1.8;       // lifts the dark PNG so it shows on the black background (1 = original)

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---- Viewport <-> document helpers ----
  const docEl = document.documentElement;
  const pageX = () => window.scrollX || window.pageXOffset || 0;
  const pageY = () => window.scrollY || window.pageYOffset || 0;
  let W = 0, H = 0, dpr = 1, Hb = 300, raf = 0;
  const docW = () => Math.max(docEl.scrollWidth, W);
  const docH = () => Math.max(docEl.scrollHeight, H);

  let aspect = 0.4, sprite = null, tiny = null, big = null, TL = 12, parts = [];
  // cen = centre of the original microbot in DOCUMENT coordinates; homeVisible is a viewport test.
  let cen = { x: 0, y: 0 }, homeVisible = true, gx = 0, gy = 0;
  let fallbackCanvas = null;
  // The running animation (swarm or effect). There is never more than ONE entry.
  const seqs = [];
  // Precise hit testing: alpha mask of the visible microbot, how solid it currently is, last pointer position.
  let hit = null, solidNow = 1, lastPtr = null;
  // Effect state: last effect played, time of the last click, per-frame scratch buffers, scratch outputs.
  let lastFx = '', lastFxT = -1e9, scr = null, fxx = 0, fxy = 0, spx = 0, spy = 0;

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
    seqs.length = 0;                                   // a running animation refers to the old particles
    solidNow = 1;                                      // nothing is running any more: the microbot is solid
    hit = null;
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

    buildHit(maskSrc);

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
          alpha: 1
        });
      }
    }
    const span = (hi - lo) || 1;
    parts.forEach((p, n) => {
      p.alpha = 0.35 + 0.65 * clamp((p.lum - lo) / span, 0, 1);
      // static data for the click effects: scatter direction (outward + random), scatter distance, shape rank
      const rl = Math.hypot(p.lx, p.ly) || 1, a = hash(n * 13 + 5) * TAU;
      const vx = p.lx / rl * 0.55 + Math.cos(a) * 0.85, vy = p.ly / rl * 0.55 + Math.sin(a) * 0.85, vl = Math.hypot(vx, vy) || 1;
      p.ux = vx / vl; p.uy = vy / vl;
      p.dd = 0.2 + Math.pow(hash(n * 13 + 9), 1.6);       // scatter distance in microbot heights
      p.u = (n * 0.6180339887) % 1;                          // evenly scrambled 0..1 rank (golden ratio)
    });
    scr = { X: new Float32Array(parts.length), Y: new Float32Array(parts.length),
            PX: new Float32Array(parts.length), PY: new Float32Array(parts.length) };
  }

  // Hit mask: which pixels of the microbot sprite are actually visible (alpha), at a finer resolution than
  // the particle mask. Same source image and stretch as the particles, so it follows the drawn shape.
  function buildHit(m) {
    const hh = 240, hw = Math.max(4, Math.round(hh * aspect));
    const c = document.createElement('canvas');
    c.width = hw; c.height = hh;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(m, 0, 0, hw, hh);
    try {
      const d = g.getImageData(0, 0, hw, hh).data, a = new Uint8Array(hw * hh);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] >= 110 ? 1 : 0;
      hit = { w: hw, h: hh, a };
    } catch (err) { hit = null; }
  }

  // True only when the viewport point (cx, cy) lies on the visible, solid microbot. The point is mapped back
  // through the same transform the sprite is drawn with (scroll, sway offset, rotation, horizontal squash).
  // hitShape: purely geometric (is the point on the microbot's outline?). hitTest additionally needs the
  // microbot to be solid, i.e. not in the middle of an animation.
  function hitTest(cx, cy) { return solidNow >= 0.5 && hitShape(cx, cy); }
  function hitShape(cx, cy) {
    if (!hit || !big || !homeVisible) return false;
    const s = swayAt(performance.now());
    const px = cx + pageX() - (cen.x + s.ox), py = cy + pageY() - (cen.y + s.oy);
    const co = Math.cos(s.rot), si = Math.sin(s.rot);
    const lx = (px * co + py * si) / s.sx, ly = -px * si + py * co;
    const u = lx / (Hb * aspect) + 0.5, v = ly / Hb + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    return hit.a[((v * hit.h) | 0) * hit.w + ((u * hit.w) | 0)] === 1;
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

  // The original place: centre of the microbot zone in DOCUMENT coordinates (viewport rect + scroll).
  // Re-read every frame so layout changes are followed; homeVisible tells whether it is on screen now.
  function placeHome() {
    const sx = pageX(), sy = pageY();
    if (zone) {
      const r = zone.getBoundingClientRect();
      cen.x = r.left + sx + r.width / 2;
      cen.y = r.top + sy + r.height / 2;
      homeVisible = r.bottom > -Hb && r.top < H + Hb;
    } else {
      cen.x = (W > 800 ? 0.8 : 0.72) * W;
      cen.y = 0.52 * H;
      homeVisible = cen.y + Hb > sy && cen.y - Hb < sy + H;
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

  // live position (document coordinates) of a tiny microbot inside the (swaying) body
  function live(p, t, s) {
    const th = t * p.w + p.ph, lx = p.lx * Hb * s.sx, ly = p.ly * Hb;
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    gx = cen.x + s.ox + lx * cr - ly * sr + Math.cos(th) * p.r;
    gy = cen.y + s.oy + lx * sr + ly * cr + Math.sin(th) * p.r;
  }

  // Fade phases of the animation: how solid the big microbot should be and how visible its particles are.
  function phase(sq, now) {
    if (now < sq.t0 + sq.dis) { sq.part = clamp((now - sq.t0) / sq.dis, 0, 1); sq.solid = 1 - sq.part; }
    else if (now < sq.ret) { sq.solid = 0; sq.part = 1; }
    else { sq.solid = clamp((now - sq.ret) / FADE, 0, 1); sq.part = 1 - sq.solid; }
  }

  // Draw the background-click swarm. All maths is in document coordinates; only the final transform
  // subtracts the scroll.
  function drawSwarm(sq, now, s, sx, sy) {
    if (sq.part <= 0.001) return;
    const tw = TL * aspect, C = sq.C, m = TL * 2 + 4;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let x, y, ang = s.rot + p.ang + Math.sin(now * p.w + p.ph) * 0.5;
      if (now < sq.b0[i]) {
        if (now < sq.a1[i]) {                                      // dissolved, then flying to the click point
          live(p, now, s);
          const q = clamp((now - sq.a0[i]) / sq.gather, 0, 1), k = q * q * q, dx = C.x - gx, dy = C.y - gy, cu = Math.sin(Math.PI * k) * p.curl;
          x = gx + dx * k - dy * cu; y = gy + dy * k + dx * cu;
          if (q > 0 && q < 1) ang = Math.atan2(dy, dx) - Math.PI / 2;
        } else {                                                   // gathered: tight swirling ball
          const rr = (4 + p.r) * clamp((now - sq.a1[i]) / 250, 0, 1), g = now * p.w * 3 + p.ph;
          x = C.x + Math.cos(g) * rr; y = C.y + Math.sin(g) * rr;
        }
      } else {                                                     // flying back to the original place
        live(p, now, s);
        const q = clamp((now - sq.b0[i]) / sq.build, 0, 1), k = 1 - Math.pow(1 - q, 3), g = now * p.w * 3 + p.ph, rr = (4 + p.r) * (1 - k);
        const dx = gx - C.x, dy = gy - C.y, cu = Math.sin(Math.PI * k) * p.curl;
        x = C.x + Math.cos(g) * rr + dx * k - dy * cu; y = C.y + Math.sin(g) * rr + dy * k + dx * cu;
        if (q > 0 && q < 1) ang = Math.atan2(dy, dx) - Math.PI / 2;
      }
      const vx = x - sx, vy = y - sy;                              // document -> viewport
      if (vx < -m || vx > W + m || vy < -m || vy > H + m) continue; // off-screen: keep simulating, skip drawing
      const c = Math.cos(ang) * dpr, sn = Math.sin(ang) * dpr;
      ctx.globalAlpha = p.alpha * sq.part;
      ctx.setTransform(c, sn, -sn, c, vx * dpr, vy * dpr);
      ctx.drawImage(tiny, -tw / 2, -TL / 2, tw, TL);
    }
  }

  // =====================================================================================================
  // Microbot click effects: 'explode' or 'morph'. They use the particles in `parts`, the fixed canvas and
  // the single frame loop. All positions are document coordinates, drawn at (position - scroll).
  // =====================================================================================================

  // Point on a unit-size shape for a particle with rank u (0..1) and random v (0..1) -> spx, spy.
  // The same rank on two different shapes gives neighbouring points, so shape A flows into shape B.
  function shapePoint(kind, u, v) {
    const w = ((v * 7.31) % 1) - 0.5;
    if (kind === 'spiral') {                                  // three-armed galaxy
      const arm = Math.floor(v * 3) % 3, r = 0.08 + 0.92 * Math.pow(u, 0.8) + w * 0.05, a = arm * TAU / 3 + r * 5;
      spx = Math.cos(a) * r; spy = Math.sin(a) * r; return;
    }
    if (kind === 'ring') {                                    // double ring
      const r = (v < 0.28 ? 0.62 : 1) + w * 0.06, a = u * TAU;
      spx = Math.cos(a) * r; spy = Math.sin(a) * r; return;
    }
    const nv = kind === 'hex' ? 6 : 3;                        // nested hexagon / triangle outlines
    const sc = (v < 0.28 ? 0.55 : 1) * (kind === 'hex' ? 1 : 1.15) * (1 + w * 0.05);
    const f = u * nv, k = Math.floor(f), t = f - k, a0 = -Math.PI / 2 + k * TAU / nv, a1 = a0 + TAU / nv;
    spx = (Math.cos(a0) * (1 - t) + Math.cos(a1) * t) * sc;
    spy = (Math.sin(a0) * (1 - t) + Math.sin(a1) * t) * sc;
  }

  // Slowly spinning, gently breathing frame of the formation at time t.
  function frFor(sq, t, out) {
    const th = sq.spin + (t - sq.t0) * sq.rate;
    out.co = Math.cos(th); out.si = Math.sin(th);
    out.R = Hb * 0.44 * (1 + 0.04 * Math.sin(t * 0.004));
  }

  // Document position of particle i at time t for an effect -> fxx, fxy. Every phase is expressed relative to
  // the particle's live home position, so the particle always lands exactly where it belongs.
  function fxPos(sq, i, p, t, s, fr) {
    live(p, t, s);
    if (sq.type === 'explode') {
      const D = Hb * p.dd, dxs = p.ux * D, dys = p.uy * D;
      const c0x = -p.lx * Hb * 0.12, c0y = -p.ly * Hb * 0.12;          // charge: the body contracts a little
      let ox, oy;
      if (t < sq.tb) {                                                  // 1) charge, with a tiny tremble
        const c = easeIO(clamp((t - sq.t0) / EX_CHARGE, 0, 1));
        ox = c0x * c + Math.sin(t * 0.07 + p.ph) * 1.6 * c;
        oy = c0y * c + Math.cos(t * 0.06 + p.ph) * 1.6 * c;
      } else if (t < sq.r0[i]) {                                        // 2) burst outward, curving, then hang
        const k = easeOut4(clamp((t - sq.tb) / EX_BURST, 0, 1));
        const arc = Math.sin(Math.PI * k) * p.curl * D * 0.5, dr = Math.sin(t * 0.0015 + p.ph) * 5 * k;
        ox = c0x * (1 - k) + dxs * k - p.uy * arc + dr;
        oy = c0y * (1 - k) + dys * k + p.ux * arc + dr * 0.6;
      } else {                                                          // 3) reassemble, top of the body first
        const k = easeIO(clamp((t - sq.r0[i]) / EX_RET, 0, 1));
        const arc = Math.sin(Math.PI * k) * p.curl * D * 0.35, dr = Math.sin(t * 0.0015 + p.ph) * 5;
        ox = (dxs + dr) * (1 - k) - p.uy * arc;
        oy = (dys + dr * 0.6) * (1 - k) + p.ux * arc;
      }
      fxx = gx + ox; fxy = gy + oy;
      return;
    }
    // morph: particles stream (all curving the same way, like a vortex) into shape 1, flow into shape 2, return
    const hx = gx, hy = gy, u = p.u;
    const mk = easeIO(clamp((t - sq.m0 - u * MO_MSPREAD) / MO_MORPH, 0, 1));
    const ax = sq.t1x[i] + (sq.t2x[i] - sq.t1x[i]) * mk, ay = sq.t1y[i] + (sq.t2y[i] - sq.t1y[i]) * mk;
    const tx = cen.x + (ax * fr.co - ay * fr.si) * fr.R, ty = cen.y + (ax * fr.si + ay * fr.co) * fr.R;
    const g0 = sq.t0 + MO_START + u * MO_SPREAD, r0 = sq.r0b + u * MO_RSPREAD, sw = 0.3 + 0.25 * p.rr;
    const jx = Math.cos(t * p.w * 3 + p.ph) * 2.5, jy = Math.sin(t * p.w * 3 + p.ph) * 2.5;
    if (t < g0) { fxx = hx; fxy = hy; }
    else if (t < r0) {
      const k = easeIO(clamp((t - g0) / MO_TRAVEL, 0, 1)), dx = tx - hx, dy = ty - hy, cu = Math.sin(Math.PI * k) * sw;
      fxx = hx + dx * k - dy * cu + jx * k; fxy = hy + dy * k + dx * cu + jy * k;
    } else {
      const k = easeIO(clamp((t - r0) / MO_RET, 0, 1)), dx = hx - tx, dy = hy - ty, cu = Math.sin(Math.PI * k) * sw;
      fxx = tx + dx * k + dy * cu + jx * (1 - k); fxy = ty + dy * k - dx * cu + jy * (1 - k);
    }
  }

  const frA = { co: 1, si: 0, R: 1 }, frB = { co: 1, si: 0, R: 1 };

  function drawFx(sq, now, s, sx, sy) {
    if (sq.part <= 0.001 || !scr) return;
    const n = parts.length, tp = now - TRAIL, s2 = swayAt(tp), m = TL * 2 + 4;
    if (sq.type === 'morph') { frFor(sq, now, frA); frFor(sq, tp, frB); }
    const X = scr.X, Y = scr.Y, PX = scr.PX, PY = scr.PY;

    // positions now and TRAIL ms ago (viewport coords): the difference is the velocity,
    // used only to point each tiny microbot along its motion
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      fxPos(sq, i, p, now, s, frA); X[i] = fxx - sx; Y[i] = fxy - sy;
      fxPos(sq, i, p, tp, s2, frB); PX[i] = fxx - sx; PY[i] = fxy - sy;
    }

    // the tiny microbots themselves: nose along the motion when moving, otherwise as in the resting body
    const tw = TL * aspect, ccx = cen.x - sx, ccy = cen.y - sy;
    for (let i = 0; i < n; i++) {
      const x = X[i], y = Y[i];
      if (x < -m || x > W + m || y < -m || y > H + m) continue;
      const p = parts[i], dx = x - PX[i], dy = y - PY[i];
      let ang;
      if (dx * dx + dy * dy > 4) ang = Math.atan2(dy, dx) - Math.PI / 2;
      else if (sq.type === 'morph') ang = Math.atan2(y - ccy, x - ccx) - Math.PI / 2;   // radial in the formation
      else ang = s.rot + p.ang + Math.sin(now * p.w + p.ph) * 0.5;
      const c = Math.cos(ang) * dpr, sn = Math.sin(ang) * dpr;
      ctx.globalAlpha = p.alpha * sq.part;
      ctx.setTransform(c, sn, -sn, c, x * dpr, y * dpr);
      ctx.drawImage(tiny, -tw / 2, -TL / 2, tw, TL);
    }
  }

  function makeExplode(now) {
    const n = parts.length, r0 = new Float64Array(n), tb = now + EX_CHARGE;
    let last = 0;
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      r0[i] = tb + EX_BURST + EX_HANG + (p.ly + 0.5) * 300 + p.rr * 150;   // return start: top of the body first
      if (r0[i] > last) last = r0[i];
    }
    const ret = last + EX_RET;
    return { type: 'explode', t0: now, dis: 180, tb, r0, ret, end: ret + FADE + 16, solid: 1, part: 0 };
  }

  function makeMorph(now) {
    const n = parts.length;
    const t1x = new Float32Array(n), t1y = new Float32Array(n), t2x = new Float32Array(n), t2y = new Float32Array(n);
    const k1 = SHAPES[(Math.random() * SHAPES.length) | 0];
    let k2; do { k2 = SHAPES[(Math.random() * SHAPES.length) | 0]; } while (k2 === k1);
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      shapePoint(k1, p.u, p.rr); t1x[i] = spx; t1y[i] = spy;
      shapePoint(k2, p.u, p.rr); t2x[i] = spx; t2y[i] = spy;
    }
    const m0 = now + MO_START + MO_SPREAD + MO_TRAVEL + MO_HOLD1;
    const r0b = m0 + MO_MSPREAD + MO_MORPH + MO_HOLD2, ret = r0b + MO_RSPREAD + MO_RET;
    return { type: 'morph', t0: now, dis: 260, m0, r0b, t1x, t1y, t2x, t2y,
             spin: Math.random() * TAU, rate: (0.0008 + Math.random() * 0.0006) * (Math.random() < 0.5 ? -1 : 1),
             ret, end: ret + FADE + 16, solid: 1, part: 0 };
  }

  // Random choice that (almost) never plays the same effect twice in a row.
  function pickFx() {
    let t = Math.random() < 0.5 ? 'explode' : 'morph';
    if (t === lastFx && Math.random() < 0.8) t = t === 'explode' ? 'morph' : 'explode';
    return (lastFx = t);
  }

  // True while an animation (swarm or effect) is still running. Finished ones are removed first.
  function busy(now) {
    for (let i = seqs.length - 1; i >= 0; i--) if (now >= seqs[i].end) seqs.splice(i, 1);
    return seqs.length > 0;
  }

  // Start ONE microbot effect (click on the microbot). Nothing can start while another animation is
  // running, so animations never stack: only after the microbot is rebuilt can it be clicked again.
  function startFx() {
    if (!tiny || !big || !parts.length || !scr || reduce.matches) return;
    const now = performance.now();
    if (busy(now)) return;                              // an animation is still running: ignore this click
    if (now - lastFxT < 250) return;                    // one click = one effect
    lastFxT = now;
    placeHome();
    seqs.push(pickFx() === 'explode' ? makeExplode(now) : makeMorph(now));
    kick();
  }

  // Start ONE swarm (click on the empty background). cx, cy are DOCUMENT coordinates.
  // Same rule: ignored while any other animation is still running.
  function start(cx, cy) {
    if (!tiny || !big || !parts.length || reduce.matches) return;
    const now = performance.now();
    if (busy(now)) return;                              // an animation is still running: ignore this click
    if (now - lastFxT < 250) return;
    lastFxT = now;
    placeHome();
    cx = clamp(cx, 0, docW()); cy = clamp(cy, 0, docH());

    const s = swayAt(now), n = parts.length;
    const a0 = new Float64Array(n), a1 = new Float64Array(n), b0 = new Float64Array(n);
    const diag = Math.hypot(W, H) || 1;
    // distant clicks get somewhat longer flights, but the whole swarm always takes 5 seconds
    const stretch = clamp(Math.hypot(cx - cen.x, cy - cen.y) / diag, 1, 1.5);
    const gather = GATHER * stretch, build = BUILD * stretch;
    // the hold at the click point absorbs whatever is left of the 5 seconds
    const hold = Math.max(150, TOTAL - DISSOLVE - SPREAD_IN - gather - SPREAD_OUT - build - FADE);
    let ret = 0;
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      live(p, now, s);
      const d = clamp(Math.hypot(gx - cx, gy - cy) / diag, 0, 1);   // nearest ones leave first
      a0[i] = now + DISSOLVE + d * SPREAD_IN; a1[i] = a0[i] + gather;
      b0[i] = now + DISSOLVE + SPREAD_IN + gather + hold + p.rr * SPREAD_OUT;
      ret = Math.max(ret, b0[i] + build);
    }
    seqs.push({ C: { x: cx, y: cy }, t0: now, dis: DISSOLVE, gather, build, ret, end: ret + FADE + 16, a0, a1, b0, solid: 1, part: 0 });
    kick();
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!seqs.length) solidNow = 1;                     // nothing running: the microbot is solid again
    if (!tiny || !big || (!homeVisible && !seqs.length)) return;
    const sx = pageX(), sy = pageY(), s = swayAt(now);

    // The big microbot is solid only when the animation has not taken it apart.
    let solidA = 1;
    for (const sq of seqs) { phase(sq, now); solidA = Math.min(solidA, sq.solid); }
    solidNow = solidA;

    // 1) the solid big microbot
    if (homeVisible && solidA > 0.001) {
      ctx.globalAlpha = solidA;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cen.x + s.ox - sx, cen.y + s.oy - sy);
      ctx.rotate(s.rot);
      ctx.scale(s.sx, 1);
      ctx.drawImage(big, -Hb * aspect / 2, -Hb / 2, Hb * aspect, Hb);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // 2) the tiny microbots of the running animation
    for (const sq of seqs) { if (sq.type) drawFx(sq, now, s, sx, sy); else drawSwarm(sq, now, s, sx, sy); }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function frame(now) {
    raf = 0;
    for (let i = seqs.length - 1; i >= 0; i--) if (now >= seqs[i].end) seqs.splice(i, 1);   // finished: gone
    try { placeHome(); draw(now); }
    catch (err) { seqs.length = 0; solidNow = 1; console.error('Microbot animation error:', err); }   // always fall back to idle
    // Keep running while the microbot is on screen or an animation is alive; scroll/resize re-start it.
    if (!reduce.matches && !document.hidden && (homeVisible || seqs.length)) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // ---- Input ----
  // Keyboard / assistive technology (the stage stays focusable): activating it plays a microbot effect.
  // Mouse clicks never reach the stage (pointer-events:none); they go through onDocClick below.
  const onStageClick = e => { if (e.button === 0 && e.detail === 0) startFx(); };   // synthetic click (screen reader)
  const onStageKey = e => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();                                                    // stop Space from scrolling the page
    if (e.repeat) return;
    startFx();
  };
  if (stage) {
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('keydown', onStageKey);
  }

  // One document click, two separate outcomes (never both):
  //  - on the visible microbot  -> a random microbot effect (explode / morph)
  //  - on empty background      -> the swarm that gathers at that point
  // Both are ignored while another animation is still running (only ONE at a time).
  const isBackground = el => el === document.documentElement || el === document.body || (el && el.id === 'top');
  const onDocClick = e => {
    if (e.button !== 0 || !isBackground(e.target)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    if (hitShape(e.clientX, e.clientY)) { startFx(); return; }             // microbot: effect only
    start(e.clientX + pageX(), e.clientY + pageY());                       // background: swarm
  };
  document.addEventListener('click', onDocClick);

  // ---- Hover: the pointer cursor appears only over the visible microbot ----
  // (the big stage box no longer receives the mouse at all, see style.css). background.js asks hitShape()
  // through window.__microbotHit so the background never reacts while the cursor is on the microbot.
  const root = document.documentElement;
  const overMicrobot = (x, y, el) => isBackground(el) && hitTest(x, y);
  const onPointerMove = e => {
    if (e.pointerType === 'touch') return;
    lastPtr = { x: e.clientX, y: e.clientY };
    root.classList.toggle('microbot-hover', overMicrobot(e.clientX, e.clientY, e.target));
  };
  const onMouseOut = e => { if (!e.relatedTarget) { lastPtr = null; root.classList.remove('microbot-hover'); } };
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('mouseout', onMouseOut);
  window.__microbotHit = hitShape;     // geometric test: the background never reacts on the microbot's outline

  // After scrolling the content moves under a still cursor: re-evaluate what it is over.
  let hoverPending = false;
  const refreshHover = () => {
    hoverPending = false;
    if (!lastPtr) return;
    const el = document.elementFromPoint(lastPtr.x, lastPtr.y), bg = !!el && isBackground(el);
    root.classList.toggle('microbot-hover', bg && hitTest(lastPtr.x, lastPtr.y));
    root.classList.toggle('bg-hover', bg && !hitShape(lastPtr.x, lastPtr.y));
  };

  const onVisibility = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVisibility);
  const onScroll = () => {
    kick();
    if (lastPtr && !hoverPending) { hoverPending = true; requestAnimationFrame(refreshHover); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  const onMotion = () => { if (reduce.matches) { seqs.length = 0; solidNow = 1; } kick(); };
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
    seqs.length = 0;
    if (ro) ro.disconnect();
    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('mouseout', onMouseOut);
    document.removeEventListener('visibilitychange', onVisibility);
    if (window.__microbotHit === hitShape) delete window.__microbotHit;
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