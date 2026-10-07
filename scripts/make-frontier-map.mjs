// Draws a rugged frontier-coast regional map in code (no image model): a sea along the west edge with a ragged shoreline and islets, windswept moorland and hills, pine forests in the
// south and east, snow-capped mountains across the north, a coast trail with a branch inland, a walled harbour town on a bay, hamlets, a ruined watchtower and castle, a river and a lake.
//   node scripts/make-frontier-map.mjs [out.png] [width] [height]      default public/scenarios/compare/frontier-claude.png at 1536 x 1024
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Painter, rng, fbm, vnoise, hash, clamp, mix, shade, tint, encodePng } from '../lib/mapkit.js';

const out = process.argv[2] || 'public/scenarios/compare/frontier-claude.png';
const W = Number(process.argv[3]) || 1536, H = Number(process.argv[4]) || 1024;
const R = rng(20261108);
const p = new Painter(W, H);
const INK = [70, 58, 42], PAPER = [238, 222, 176];
const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
function spline(pts, per = 14) {
  const res = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      res.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  res.push(pts[pts.length - 1]);
  return res;
}
const distToLine = (x, y, line) => { let best = Infinity; for (let i = 0; i < line.length - 1; i++) { const [ax, ay] = line[i], [bx, by] = line[i + 1]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1; const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1); best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t))); } return best; };

/* ---------------- the shape of the land ---------------- */
// The shoreline x for each y: a ragged coast with a bay (the harbour) at y about 0.68 H and a headland above it.
const shore = (y) => {
  const g = y / H;
  return 0.20 * W + 70 * Math.sin(g * 5.2) + 50 * (vnoise(g * 14, 2, 8) - 0.5) + 110 * smoothstep(0.56, 0.66, g) * (1 - smoothstep(0.66, 0.84, g)) * 0.0
    + 130 * Math.exp(-(((g - 0.80) / 0.075) ** 2)) - 120 * Math.exp(-(((g - 0.68) / 0.06) ** 2)) + 60 * Math.exp(-(((g - 0.40) / 0.09) ** 2));
};
const isSea = (x, y) => x < shore(y);
const seaDist = (x, y) => shore(y) - x;
const islets = [[0.065 * W, 0.17 * H, 18], [0.115 * W, 0.40 * H, 12], [0.10 * W, 0.50 * H, 9], [0.17 * W, 0.85 * H, 22], [0.12 * W, 0.93 * H, 12]];
const mountainLine = (x) => 0.215 * H + 34 * Math.sin(x / 130) + 22 * (vnoise(x / 60, 5, 3) - 0.5);
const height = (x, y) => fbm(x / W * 2.6, y / H * 2.6, 9) * 0.85 + fbm(x / W * 8, y / H * 8, 12) * 0.15 + smoothstep(0.30 * H, 0.05 * H, y) * 0.7;
const river = spline([[0.50 * W, 0.16 * H], [0.47 * W, 0.28 * H], [0.52 * W, 0.40 * H], [0.45 * W, 0.52 * H], [0.43 * W, 0.62 * H], [0.36 * W, 0.70 * H], [0.30 * W, 0.745 * H], [0.26 * W, 0.78 * H]], 14);
const lake = { x: 0.52 * W, y: 0.915 * H, rx: 60, ry: 34, rot: 0.2 };
const inLake = (x, y, pad = 0) => { const c = Math.cos(-lake.rot), s = Math.sin(-lake.rot), dx = x - lake.x, dy = y - lake.y; const u = dx * c - dy * s, v = dx * s + dy * c; return (u * u) / ((lake.rx + pad) ** 2) + (v * v) / ((lake.ry + pad) ** 2) < 1; };
const forestZone = (x, y) => {
  const n = fbm(x / 160, y / 160, 21);
  const se = smoothstep(0.34 * W, 0.58 * W, x) * smoothstep(0.50 * H, 0.70 * H, y);
  const east = smoothstep(0.66 * W, 0.78 * W, x) * smoothstep(0.26 * H, 0.38 * H, y);
  return Math.max(se, east) + (n - 0.5) * 0.9 > 0.55;
};
const town = { x: 0.255 * W, y: 0.655 * H }, tower = { x: 0.31 * W, y: 0.215 * H }, castle = { x: 0.80 * W, y: 0.205 * H };
const hamlets = [{ x: 0.585 * W, y: 0.50 * H, n: 4 }, { x: 0.74 * W, y: 0.69 * H, n: 3 }];
const trail = spline([[0.235 * W, 0.20 * H], [0.27 * W, 0.34 * H], [0.30 * W, 0.46 * H], [0.28 * W, 0.57 * H], [town.x + 36, town.y - 4], [0.355 * W, 0.675 * H], [0.43 * W, 0.67 * H], [0.50 * W, 0.70 * H], [0.60 * W, 0.80 * H], [0.68 * W, 0.92 * H], [0.72 * W, H + 10]], 10);
const branch = spline([[0.30 * W, 0.465 * H], [0.38 * W, 0.40 * H], [0.50 * W, 0.34 * H], [0.60 * W, 0.28 * H], [0.72 * W, 0.24 * H], [castle.x - 14, castle.y + 36]], 10);
const branch2 = spline([[0.50 * W, 0.34 * H], [hamlets[0].x - 20, hamlets[0].y - 30], [hamlets[0].x, hamlets[0].y + 16], [0.64 * W, 0.62 * H], [hamlets[1].x - 14, hamlets[1].y - 10]], 10);
const trails = [trail, branch, branch2, spline([[tower.x, tower.y + 20], [0.28 * W, 0.30 * H], [0.27 * W, 0.34 * H]], 8)];
const trailDist = (x, y) => Math.min(...trails.map((t) => distToLine(x, y, t)));
const riverDist = (x, y) => distToLine(x, y, river);
const landFree = (x, y, pad = 8) => !isSea(x, y) && seaDist(x, y) < -40 && riverDist(x, y) > 22 + pad && trailDist(x, y) > 8 + pad / 2 && !inLake(x, y, 14 + pad) && y > mountainLine(x) + 30 && Math.hypot(x - town.x, y - town.y) > 70;

/* ---------------- ground ---------------- */
const light = [-0.7, -0.7];
p.fillWith((x, y) => {
  const n = fbm(x / 70, y / 70, 31), n2 = vnoise(x / 5, y / 5, 17);
  if (isSea(x, y)) {
    const d = seaDist(x, y), deep = smoothstep(0, 220, d);
    let col = tint([128, 176, 178], [86, 134, 150], deep);
    col = shade(col, 0.96 + 0.08 * vnoise(x / 24, y / 24, 4) + 0.04 * n2);
    if (d < 10) col = tint([232, 240, 232], col, d / 10);                                          // surf along the shore
    return col;
  }
  const h = height(x, y), hx = height(x + 3, y) - height(x - 3, y), hy = height(x, y + 3) - height(x, y - 3);
  const slope = clamp(1 + (hx * light[0] + hy * light[1]) * 11, 0.64, 1.4);
  let col = [176 + n * 30 + n2 * 8, 168 + n * 26 + n2 * 8, 98 + n * 20];                               // windswept moor
  col = tint(col, [128, 158, 80], smoothstep(0.35, 0.65, fbm(x / 140, y / 140, 41)) * 0.55);          // greener hollows
  col = tint(col, [196, 176, 120], smoothstep(0, 40, 40 - seaDist(x, y) * -1) * 0);                    // (kept simple)
  const beach = smoothstep(26, 0, -seaDist(x, y)); col = tint(col, [214, 196, 146], beach * 0.8);
  if (y < mountainLine(x) + 40) col = tint(col, [150, 150, 130], smoothstep(mountainLine(x) + 40, mountainLine(x) - 20, y) * 0.6);
  if (forestZone(x, y)) col = tint(col, [70, 104, 60], 0.5);
  return shade(col, slope);
});
// cliffs: a darker, hatched line along stretches of the west shore
for (let y = 10; y < H - 10; y += 3) { const sx = shore(y), g = y / H; if ((g > 0.08 && g < 0.28) || (g > 0.52 && g < 0.62)) { p.capsule(sx + 1, y, sx + 7, y + 3, 1.6, [112, 92, 66], 0.75); p.capsule(sx + 3, y, sx + 10, y + 3, 0.8, INK, 0.45); } }
for (const [x, y, r] of islets) { p.disc(x + 3, y + 4, r + 5, [60, 90, 100], 0.4); p.disc(x, y, r + 4, [232, 240, 232], 0.9); p.ellipse(x, y, r, r * 0.8, 0.4, [168, 148, 112]); p.ellipse(x - r * 0.25, y - r * 0.25, r * 0.55, r * 0.4, 0.4, [200, 182, 142], 0.85); p.ring(x, y, r, 1.2, INK, 0.6); }
for (let i = 0; i < 90; i++) { const x = R() * 0.22 * W, y = R() * H; if (isSea(x, y) && seaDist(x, y) > 24 && !islets.some(([ix, iy, ir]) => Math.hypot(ix - x, iy - y) < ir + 18)) p.capsule(x, y, x + 12 + R() * 14, y + (R() - 0.5) * 3, 0.9, [236, 244, 244], 0.55); }   // waves

/* ---------------- water on land ---------------- */
river.forEach(([x, y], i) => p.disc(x, y, 7 + 7 * (i / river.length) + 3, [200, 190, 150], 0.75));
for (let i = 0; i < river.length - 1; i++) p.capsule(river[i][0], river[i][1], river[i + 1][0], river[i + 1][1], 5 + 7 * (i / river.length), [112, 164, 176]);
p.ellipse(lake.x, lake.y, lake.rx + 6, lake.ry + 6, lake.rot, [200, 190, 150]); p.ellipse(lake.x, lake.y, lake.rx, lake.ry, lake.rot, [98, 152, 172]); p.ellipse(lake.x - 10, lake.y - 6, lake.rx * 0.5, lake.ry * 0.4, lake.rot, [160, 206, 214], 0.5);

/* ---------------- trails and the bridge ---------------- */
for (const t of trails) {
  for (let i = 0; i < t.length - 1; i++) p.capsule(t[i][0], t[i][1], t[i + 1][0], t[i + 1][1], 4.6, [140, 112, 74], 0.85);
  for (let i = 0; i < t.length - 1; i += 2) p.capsule(t[i][0], t[i][1], t[i + 1][0], t[i + 1][1], 2.6, [216, 188, 134]);
}
{ // the stone bridge where the coast trail meets the river
  let best = 1e9, bi = 0; river.forEach(([x, y], i) => { const d = Math.hypot(x - 0.355 * W, y - 0.675 * H); if (d < best) { best = d; bi = i; } });
  const [bx, by] = river[bi], [nx, ny] = river[Math.min(river.length - 1, bi + 2)], l = Math.hypot(nx - bx, ny - by) || 1, tx = (nx - bx) / l, ty = (ny - by) / l;
  const pt = (a, b) => ({ x: bx - ty * a + tx * b, y: by + tx * a + ty * b });
  p.poly([pt(-24, -9), pt(24, -9), pt(24, 9), pt(-24, 9)], [186, 178, 164]); p.capsule(pt(-24, -9).x, pt(-24, -9).y, pt(24, -9).x, pt(24, -9).y, 1.6, [110, 102, 90]); p.capsule(pt(-24, 9).x, pt(-24, 9).y, pt(24, 9).x, pt(24, 9).y, 1.6, [110, 102, 90]);
}

/* ---------------- trees: pines in the forests, a few scrubby bushes on the moor ---------------- */
function pine(cx, cy, s) {
  p.poly([{ x: cx + 4 * s, y: cy + 3 * s }, { x: cx + 15 * s, y: cy + 3 * s }, { x: cx + 9 * s, y: cy - 22 * s }], [30, 50, 30], 0.3);
  p.poly([{ x: cx - 11 * s, y: cy + 4 * s }, { x: cx + 11 * s, y: cy + 4 * s }, { x: cx, y: cy - 24 * s }], [56, 94, 54]);
  p.poly([{ x: cx - 11 * s, y: cy + 4 * s }, { x: cx, y: cy + 4 * s }, { x: cx, y: cy - 24 * s }], [78, 124, 68], 0.8);
  p.capsule(cx - 11 * s, cy + 4 * s, cx, cy - 24 * s, 0.9, INK, 0.5); p.capsule(cx + 11 * s, cy + 4 * s, cx, cy - 24 * s, 0.9, INK, 0.5);
}
const pines = [];
for (let i = 0; i < 7000; i++) { const x = R() * W, y = R() * H; if (landFree(x, y, 4) && forestZone(x, y)) pines.push([x, y, 0.8 + R() * 0.55]); }
pines.sort((a, b) => a[1] - b[1]);
const kept = []; for (const q of pines) if (!kept.some((k) => Math.abs(k[0] - q[0]) < 15 && Math.abs(k[1] - q[1]) < 14)) { kept.push(q); pine(q[0], q[1], q[2]); }
for (let i = 0; i < 80; i++) { const x = R() * W, y = R() * H; if (landFree(x, y, 8) && !forestZone(x, y)) { p.ellipse(x + 2, y + 3, 14, 9, 0, [40, 60, 30], 0.3); p.ellipse(x, y, 13, 9, R() * 3, [96, 128, 62]); p.ellipse(x - 3, y - 3, 7, 4, 0, [136, 164, 90], 0.7); } }

/* ---------------- mountains across the north ---------------- */
for (let x = -30; x < W + 40; x += 62) {
  for (let row = 0; row < 2; row++) {
    const bx = x + row * 31 + (hash(Math.round(x), row, 2) - 0.5) * 24, by = mountainLine(bx) - 18 + row * 30 + (hash(row, Math.round(x), 3)) * 14, w = 82 + hash(Math.round(x), row, 4) * 40, h = 66 + hash(row, Math.round(x), 5) * 44;
    const top = { x: bx, y: by - h }, l = { x: bx - w / 2, y: by + h * 0.12 }, r = { x: bx + w / 2, y: by + h * 0.12 }, m = { x: bx + w * 0.05, y: by + h * 0.32 };
    p.poly([{ x: l.x + 5, y: l.y + 8 }, { x: r.x + 8, y: r.y + 8 }, { x: m.x + 6, y: m.y + 10 }], [50, 50, 40], 0.25);
    p.poly([top, l, m], [176, 172, 160]); p.poly([top, m, r], [120, 118, 112]);
    p.capsule(top.x, top.y, l.x, l.y, 1.3, INK, 0.8); p.capsule(top.x, top.y, r.x, r.y, 1.3, INK, 0.8); p.capsule(top.x, top.y, m.x, m.y, 1, INK, 0.5);
    p.poly([top, { x: top.x - w * 0.16, y: top.y + h * 0.30 }, { x: top.x - w * 0.04, y: top.y + h * 0.22 }, { x: top.x + w * 0.05, y: top.y + h * 0.34 }, { x: top.x + w * 0.14, y: top.y + h * 0.28 }], [248, 250, 252], 0.92);
  }
}

/* ---------------- places: harbour town, hamlets, tower and castle ruins ---------------- */
{ // the walled harbour town: a palisade ring, roofs, a quay
  const { x, y } = town;
  p.ellipse(x + 5, y + 8, 44, 40, 0, [40, 50, 40], 0.3); p.ellipse(x, y, 42, 38, 0, [176, 150, 104]); p.ellipse(x, y, 36, 32, 0, [196, 172, 124]);
  for (let a = 0; a < Math.PI * 2; a += 0.22) p.disc(x + Math.cos(a) * 42, y + Math.sin(a) * 38, 3.2, [112, 82, 52]);
  for (let i = 0; i < 12; i++) { const a = hash(i, 4, 1) * 6.28, d = 6 + hash(i, 5, 2) * 24, hx = x + Math.cos(a) * d, hy = y + Math.sin(a) * d * 0.9, rot = hash(i, 6, 3); p.poly([[-9, -6], [9, -6], [9, 6], [-9, 6]].map(([u, v]) => ({ x: hx + u * Math.cos(rot) - v * Math.sin(rot), y: hy + u * Math.sin(rot) + v * Math.cos(rot) })), i % 3 ? [188, 104, 70] : [160, 130, 96]); }
  p.capsule(x - 38, y + 14, x - 74, y + 22, 3.4, [128, 98, 64]); p.capsule(x - 38, y + 22, x - 66, y + 36, 3, [128, 98, 64]);                 // quays
  p.poly([{ x: x - 66, y: y + 22 }, { x: x - 54, y: y + 26 }, { x: x - 60, y: y + 40 }], [120, 84, 56]);                                  // a boat
}
for (const hm of hamlets) for (let i = 0; i < hm.n; i++) { const a = (i / hm.n) * 6.28 + 0.5, d = 14 + hash(i, Math.round(hm.x), 7) * 14, hx = hm.x + Math.cos(a) * d * 1.2, hy = hm.y + Math.sin(a) * d, rot = hash(i, 8, 1) - 0.5;
  p.poly([[-10, -7], [10, -7], [10, 7], [-10, 7]].map(([u, v]) => ({ x: hx + u * Math.cos(rot) - v * Math.sin(rot) + 3, y: hy + u * Math.sin(rot) + v * Math.cos(rot) + 4 })), [40, 50, 36], 0.3);
  p.poly([[-10, -7], [10, -7], [10, 7], [-10, 7]].map(([u, v]) => ({ x: hx + u * Math.cos(rot) - v * Math.sin(rot), y: hy + u * Math.sin(rot) + v * Math.cos(rot) })), [196, 160, 98]);
  p.capsule(hx - 10, hy, hx + 10, hy, 1, [120, 90, 56], 0.8); }
{ // the ruined watchtower on its hill
  const { x, y } = tower;
  p.ellipse(x, y + 6, 36, 24, 0, [150, 150, 110], 0.7); p.ellipse(x, y + 4, 26, 16, 0, [176, 170, 124], 0.8);
  p.disc(x + 3, y + 5, 15, [50, 50, 40], 0.3); p.disc(x, y, 14, [170, 164, 150]); p.disc(x, y, 9, [96, 90, 80]); p.ring(x, y, 14, 1.5, INK, 0.8);
  for (let a = 0.5; a < 6.2; a += 1.1) p.rect(x + Math.cos(a) * 13 - 2.5, y + Math.sin(a) * 13 - 2.5, 5, 5, [130, 124, 112]);
}
{ // the ruined castle in the north-east foothills
  const { x, y } = castle;
  p.rect(x - 38, y - 26, 82, 62, [50, 50, 40], 0.28); p.rect(x - 40, y - 28, 80, 60, [166, 160, 146]); p.rect(x - 30, y - 18, 60, 40, [104, 98, 86]); p.rect(x - 14, y + 14, 28, 18, [166, 160, 146]);
  for (const [cx, cy] of [[-40, -28], [40, -28], [-40, 32], [40, 32]]) { p.disc(x + cx, y + cy, 11, [60, 60, 50], 0.3); p.disc(x + cx - 1, y + cy - 1, 10, [180, 174, 160]); p.disc(x + cx - 1, y + cy - 1, 5, [100, 94, 84]); p.ring(x + cx - 1, y + cy - 1, 10, 1.2, INK, 0.8); }
  p.rect(x - 40, y - 28, 80, 60, [0, 0, 0], 0); for (let i = 0; i < 5; i++) p.rect(x - 22 + i * 10, y - 30, 6, 4, [90, 86, 76]);
  for (let i = 0; i < 7; i++) p.disc(x - 44 + R() * 90, y - 24 + R() * 64, 3 + R() * 3, [140, 134, 120], 0.9);                      // fallen stones
}

/* ---------------- parchment edge and grain ---------------- */
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
  const wob = 30 + 24 * fbm(x / 70, y / 70, 61) + 10 * vnoise(x / 14, y / 14, 62);
  const k = smoothstep(wob * 0.35, wob, edge), grain = 0.94 + 0.12 * vnoise(x / 2.2, y / 2.2, 63), i = (y * W + x) * 4;
  p.img[i] = mix(PAPER[0] * grain, p.img[i], k); p.img[i + 1] = mix(PAPER[1] * grain, p.img[i + 1], k); p.img[i + 2] = mix(PAPER[2] * grain, p.img[i + 2], k);
}
await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(path.resolve(out), encodePng(p.img, W, H));
console.log(`${out}: ${W} x ${H}, ${kept.length} pines`);
