// Microbot swarm background (Big Hero 6 style).
// Each microbot is two faceted tapered halves joined by a ball. Nothing moves on its own:
// the swarm only reacts to the cursor, the mouse button, and clicks.
// Speed: bots are pre-drawn as sprites, and frames are skipped while everything is at rest.
const canvas = document.getElementById('swarm');
const ctx = canvas.getContext('2d');
const R = 190, R2 = R * R, ANGLES = 64, LEVELS = 6;
let W, H, dpr, L, SP, bots = [], pulses = [], cache = [], dirty = true, last = performance.now();
const m = { x: -999, y: -999, down: false };
const modes = ['Magnet', 'Swirl', 'Repel'];
let mode = 0;

// Dark metal, shifting to blue light as a bot becomes active.
const body = ['#1a1714', '#1b1d20', '#1a2a36', '#1b3b50', '#215272', '#2a7099'];
const lit  = ['#2b2722', '#2a3036', '#2a4558', '#2d5c7a', '#3a7ea6', '#5cb8e8'];
const edge = ['#443e36', '#4a5560', '#4f8db0', '#69b9e0', '#9ae0ff', '#d8f5ff'];
const ball = ['#0d0c0b', '#101214', '#12202b', '#152e3f', '#1a4562', '#206185'];

// One half of a microbot in unit coordinates (the whole bot is 1 long).
const HALF = [[.5, -.055], [.27, -.11], [.10, -.07], [.10, .07], [.27, .11], [.5, .055]];
const LIT = [[.5, -.055], [.27, -.11], [.10, -.07], [.10, 0], [.5, 0]];

function makeSprite(k, ai) {
  const M = 8, S = Math.ceil((L + 2 * M) * dpr);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.translate(S / 2, S / 2); g.scale(dpr, dpr);
  g.rotate(ai * Math.PI / ANGLES); g.scale(L, L);
  g.lineJoin = 'round'; g.lineWidth = 1.1 / L;
  if (k >= 3) { g.shadowColor = edge[k]; g.shadowBlur = (k - 2) * 4 * dpr; }
  for (const s of [1, -1]) {
    g.beginPath(); HALF.forEach(([x, y], i) => i ? g.lineTo(x * s, y) : g.moveTo(x * s, y)); g.closePath();
    g.fillStyle = body[k]; g.fill();
    g.shadowBlur = 0;
    g.beginPath(); LIT.forEach(([x, y], i) => i ? g.lineTo(x * s, y) : g.moveTo(x * s, y)); g.closePath();
    g.fillStyle = lit[k]; g.fill();
    g.beginPath(); HALF.forEach(([x, y], i) => i ? g.lineTo(x * s, y) : g.moveTo(x * s, y)); g.closePath();
    g.strokeStyle = edge[k]; g.stroke();
    g.beginPath(); g.moveTo(.5 * s, 0); g.lineTo(.10 * s, 0); g.globalAlpha = .35; g.stroke(); g.globalAlpha = 1;
  }
  g.beginPath(); g.arc(0, 0, .085, 0, Math.PI * 2); g.fillStyle = ball[k]; g.fill(); g.strokeStyle = edge[k]; g.stroke();
  g.beginPath(); g.arc(-.022, -.03, .024, 0, Math.PI * 2); g.fillStyle = lit[k]; g.globalAlpha = .8; g.fill();
  return cv;
}
function sprite(k, ai) {
  const row = cache[k] || (cache[k] = []);
  return row[ai] || (row[ai] = makeSprite(k, ai));
}

function build() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  L = W < 700 ? 24 : 32; SP = L + 4;
  cache = []; bots = [];
  const rows = Math.ceil(H / (SP * .866)) + 2, cols = Math.ceil(W / SP) + 2;
  for (let r = -1; r < rows; r++) for (let c = -1; c < cols; c++) {
    const hx = c * SP + (r & 1 ? SP / 2 : 0), hy = r * SP * .866;
    const h = Math.sin(r * 12.9898 + c * 78.233) * 43758.5453, ha = (h - Math.floor(h)) * Math.PI;
    bots.push({ x: hx, y: hy, hx, hy, vx: 0, vy: 0, a: ha, ha, e: 0 });
  }
  dirty = true;
}

function step(dt) {
  const k = dt / 16.67, damp = Math.pow(.86, k), spring = .045 * k;
  const turn = 1 - Math.pow(.82, k), fade = 1 - Math.pow(.8, k);
  let active = false;
  for (const b of bots) {
    const dx = m.x - b.x, dy = m.y - b.y, d2 = dx * dx + dy * dy;
    let ax = 0, ay = 0, f = 0, face = null;
    if (d2 < R2) {
      const d = Math.sqrt(d2) || 1, ux = dx / d, uy = dy / d; f = 1 - d / R;
      if (mode === 0) {
        if (m.down) {
          ax = ux * f * 1.1 - uy * f * .6; ay = uy * f * 1.1 + ux * f * .6;
          if (d < 45) { ax -= ux * (45 - d) * .05; ay -= uy * (45 - d) * .05; }
        } else { ax = ux * f * .25; ay = uy * f * .25; }
        face = Math.atan2(dy, dx);
      } else if (mode === 1) {
        ax = -uy * f + ux * f * .15; ay = ux * f + uy * f * .15; face = Math.atan2(dx, -dy);
      } else {
        ax = -ux * f * 1.2; ay = -uy * f * 1.2; face = Math.atan2(dy, dx) + Math.PI / 2;
      }
    }
    for (const p of pulses) {
      const px = b.x - p.x, py = b.y - p.y, pd = Math.hypot(px, py) || 1, q = 1 - Math.abs(pd - p.t * 9) / 50;
      if (q > 0) { const s = q * (1 - p.t / 90) * 2.6; ax += px / pd * s; ay += py / pd * s; }
    }
    b.vx = (b.vx + ax * k + (b.hx - b.x) * spring) * damp;
    b.vy = (b.vy + ay * k + (b.hy - b.y) * spring) * damp;
    b.x += b.vx * k; b.y += b.vy * k;
    const sp = Math.hypot(b.vx, b.vy);
    const target = face !== null ? face : sp > .4 ? Math.atan2(b.vy, b.vx) : b.ha;
    const diff = ((target - b.a) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2; // bots are symmetric
    b.a += diff * turn;
    b.e += (Math.min(1, sp / 3 + f * .6) - b.e) * fade;
    if (sp > .01 || Math.abs(b.hx - b.x) > .05 || Math.abs(b.hy - b.y) > .05 || Math.abs(diff) > .004 || b.e > .01) active = true;
  }
  for (const p of pulses) p.t += k;
  pulses = pulses.filter(p => p.t < 90);
  return active;
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04070a'; ctx.fillRect(0, 0, W, H);
  if (m.x > -500) {
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R * 1.3);
    g.addColorStop(0, 'rgba(111,208,255,.10)'); g.addColorStop(1, 'rgba(111,208,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const half = Math.ceil((L + 16) * dpr) / dpr / 2;
  for (const b of bots) {
    const k = Math.min(LEVELS - 1, Math.floor(b.e * LEVELS));
    const ai = Math.round((((b.a % Math.PI) + Math.PI) % Math.PI) / Math.PI * ANGLES) % ANGLES;
    ctx.drawImage(sprite(k, ai), b.x - half, b.y - half, half * 2, half * 2);
  }
}

function loop(t) {
  const dt = Math.min(t - last, 40); last = t;
  const active = step(dt);
  if (active || dirty || pulses.length) { draw(); dirty = false; }
  requestAnimationFrame(loop);
}

addEventListener('pointermove', e => { m.x = e.clientX; m.y = e.clientY; dirty = true; });
addEventListener('pointerdown', e => {
  if (e.button !== 0) return;                    // left click only
  if (e.target.closest('a,button,input,.refs')) return;
  e.preventDefault();                            // stops double-click text highlighting
  m.x = e.clientX; m.y = e.clientY; m.down = true;
  pulses.push({ x: m.x, y: m.y, t: 0 });
});
const release = e => { if (!e || e.button === undefined || e.button === 0) m.down = false; };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
addEventListener('blur', () => { m.down = false; });
addEventListener('contextmenu', e => {         // no right-click menu (still allowed in References for copying)
  m.down = false;
  if (!e.target.closest || !e.target.closest('.refs')) e.preventDefault();
});
addEventListener('selectstart', e => { if (!e.target.closest || !e.target.closest('.refs')) e.preventDefault(); });
document.documentElement.addEventListener('mouseleave', () => { m.x = m.y = -999; m.down = false; dirty = true; });
addEventListener('resize', build);

build();
requestAnimationFrame(loop);

// Swarm mode button
const modeBtn = document.getElementById('modeBtn');
modeBtn.addEventListener('click', () => {
  mode = (mode + 1) % modes.length;
  modeBtn.textContent = 'Swarm mode: ' + modes[mode];
});

// Tabs for ethical concerns
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b === btn));
    document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.id !== btn.dataset.tab);
  });
});
