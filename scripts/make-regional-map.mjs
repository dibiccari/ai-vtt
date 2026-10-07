// Draws a pastoral regional map in code (no image model): rolling hills with hill-shading, a patchwork of farm fields with hedgerows, a winding river with a mill and a stone bridge,
// a lake, villages of grassy-hill homes and cottages, dirt roads, orchards, woods, an old forest in the west and a mountain ridge in the east, on parchment.
//   node scripts/make-regional-map.mjs [out.png] [width] [height]      default public/scenarios/compare/shire-claude.png at 1536 x 1024
// Everything is drawn from a fixed seed with lib/mapkit.js' Painter, so the same picture comes out every time. No text, no grid: a hex grid is laid over it by the map editor.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Painter, rng, fbm, vnoise, hash, clamp, mix, shade, tint, encodePng, ngon } from '../lib/mapkit.js';

const out = process.argv[2] || 'public/scenarios/compare/shire-claude.png';
const W = Number(process.argv[3]) || 1536, H = Number(process.argv[4]) || 1024;
const R = rng(20261107);
const p = new Painter(W, H);
const INK = [74, 62, 44], PAPER = [238, 222, 176];
const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

/* ---------------- the lay of the land ---------------- */
const height = (x, y) => {
  const gx = x / W, gy = y / H;
  let h = fbm(gx * 2.4, gy * 2.4, 5) * 0.85 + fbm(gx * 7, gy * 7, 11) * 0.15;
  h += smoothstep(0.74, 0.97, gx) * 0.9;                               // the ridge in the east
  return h;
};
// Catmull-Rom through points, sampled
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

const river = spline([[0.60 * W, -20], [0.57 * W, 0.10 * H], [0.50 * W, 0.24 * H], [0.55 * W, 0.40 * H], [0.47 * W, 0.53 * H], [0.43 * W, 0.68 * H], [0.36 * W, 0.84 * H], [0.31 * W, H + 20]]);
const riverW = (i) => 13 + 8 * (i / river.length) + 2 * Math.sin(i * 0.4);
const lake = { x: 0.66 * W, y: 0.80 * H, rx: 70, ry: 42, rot: -0.3 };
const inLake = (x, y, pad = 0) => { const c = Math.cos(-lake.rot), s = Math.sin(-lake.rot), dx = x - lake.x, dy = y - lake.y; const u = dx * c - dy * s, v = dx * s + dy * c; return (u * u) / ((lake.rx + pad) ** 2) + (v * v) / ((lake.ry + pad) ** 2) < 1; };
const riverDist = (x, y) => distToLine(x, y, river);
const forestEdge = (y) => 0.16 * W + 55 * (vnoise(y / 90, 3, 2) - 0.5) + 30 * Math.sin(y / 140);
const inForest = (x, y) => x < forestEdge(y);
const bridgeIdx = river.findIndex((pt) => pt[1] > 0.505 * H);
const B = river[bridgeIdx], Bn = river[bridgeIdx + 2];
const villages = [{ x: 0.27 * W, y: 0.40 * H, n: 7, name: 'west' }, { x: 0.30 * W, y: 0.74 * H, n: 5 }, { x: 0.69 * W, y: 0.27 * H, n: 6 }, { x: 0.74 * W, y: 0.58 * H, n: 7 }, { x: 0.45 * W, y: 0.13 * H, n: 3 }];
const road = (pts) => spline(pts, 10).map(([x, y], i) => [x + 3 * Math.sin(i * 0.7), y + 3 * Math.cos(i * 0.5)]);
const roads = [
  road([[0.15 * W, 0.46 * H], [villages[0].x, villages[0].y + 24], [0.36 * W, 0.50 * H], [B[0] - 36, B[1]], [B[0] + 36, B[1] + 6], [0.58 * W, 0.56 * H], [villages[3].x - 24, villages[3].y]]),
  road([[villages[1].x + 10, villages[1].y - 24], [0.34 * W, 0.62 * H], [villages[0].x + 20, villages[0].y + 34]]),
  road([[villages[3].x, villages[3].y - 20], [0.72 * W, 0.44 * H], [villages[2].x - 8, villages[2].y + 26]]),
  road([[villages[3].x + 22, villages[3].y + 12], [0.76 * W, 0.70 * H], [0.84 * W, 0.78 * H], [0.86 * W, 0.92 * H]]),
  road([[villages[2].x, villages[2].y - 22], [0.62 * W, 0.17 * H], [villages[4].x + 14, villages[4].y + 8]]),
  road([[villages[0].x - 20, villages[0].y - 6], [0.20 * W, 0.34 * H], [0.14 * W, 0.28 * H]])
];
const roadDist = (x, y) => Math.min(...roads.map((r) => distToLine(x, y, r)));
const villageDist = (x, y) => Math.min(...villages.map((v) => Math.hypot(x - v.x, y - v.y)));
const free = (x, y, pad = 10) => riverDist(x, y) > 30 + pad && !inLake(x, y, 16 + pad) && roadDist(x, y) > 9 + pad / 2 && villageDist(x, y) > 40 && x < 0.80 * W;

/* ---------------- ground: parchment, grass, hill-shading ---------------- */
const light = [-0.7, -0.7];
p.fillWith((x, y) => {
  const h = height(x, y), hx = height(x + 3, y) - height(x - 3, y), hy = height(x, y + 3) - height(x, y - 3);
  const slope = clamp(1 + (hx * light[0] + hy * light[1]) * 11, 0.62, 1.42);
  const n = fbm(x / 60, y / 60, 31), n2 = vnoise(x / 6, y / 6, 17);
  let col = [112 + n * 40 + n2 * 10, 156 + n * 38 + n2 * 10, 70 + n * 22];                      // grass, a little lighter on high ground
  col = tint(col, [150, 180, 96], clamp((h - 0.5) * 0.7, 0, 0.5));
  if (x > 0.78 * W) col = tint(col, [130, 140, 120], smoothstep(0.78 * W, 0.95 * W, x) * 0.85);        // the foothills turn grey
  if (inForest(x, y)) col = tint(col, [64, 112, 56], 0.55);
  return shade(col, slope);
});

/* ---------------- fields: a tilted patchwork around the villages, with hedgerows ---------------- */
const ang = -0.38, ca = Math.cos(ang), sa = Math.sin(ang);
const CELL = [66, 46];
const CROPS = [[218, 198, 98], [150, 182, 72], [176, 142, 92], [158, 200, 100], [200, 178, 84]];
for (let u = -900; u < 1700; u += CELL[0]) {
  for (let v = -900; v < 1500; v += CELL[1]) {
    const cx = u * ca - v * sa + W / 2, cy = u * sa + v * ca + H / 2;
    if (cx < 40 || cy < 40 || cx > W - 40 || cy > H - 40) continue;
    const dv = villageDist(cx, cy);
    if (dv > 215 || dv < 46 || !free(cx, cy, 16) || inForest(cx, cy)) continue;
    if (hash(Math.round(u), Math.round(v), 9) > 0.78) continue;                                       // gaps: meadows and lanes
    const crop = CROPS[Math.floor(hash(Math.round(u), Math.round(v), 4) * CROPS.length)];
    const hw = CELL[0] / 2 - 3, hh = CELL[1] / 2 - 3;
    const corner = (dx, dy) => ({ x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca });
    const pts = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
    if (pts.some((q) => !free(q.x, q.y, 6))) continue;
    p.poly(pts, shade(crop, 0.92 + hash(Math.round(u), Math.round(v), 5) * 0.16));
    for (let k = -hh + 5; k < hh; k += 6) { const a = corner(-hw, k), b = corner(hw, k); p.capsule(a.x, a.y, b.x, b.y, 0.7, shade(crop, 0.78), 0.55); }          // furrows
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; p.capsule(a.x, a.y, b.x, b.y, 1.3, [70, 108, 50], 0.9); }                              // hedgerow
  }
}

/* ---------------- water ---------------- */
river.forEach(([x, y], i) => p.disc(x, y, riverW(i) + 4, [204, 188, 140], 0.8));             // muddy banks
for (let i = 0; i < river.length - 1; i++) {
  const [ax, ay] = river[i], [bx, by] = river[i + 1], w = riverW(i);
  p.capsule(ax, ay, bx, by, w, tint([96, 158, 196], [70, 128, 176], 0.4 + 0.3 * Math.sin(i * 0.3)));
}
for (let i = 3; i < river.length - 3; i += 5) { const [x, y] = river[i], [nx, ny] = river[i + 2]; p.capsule(x - 3, y - 2, x + (nx - x) * 0.6, y + (ny - y) * 0.6 - 2, 1, [200, 228, 240], 0.7); }   // ripples
p.ellipse(lake.x, lake.y, lake.rx + 7, lake.ry + 7, lake.rot, [204, 188, 140]);
p.ellipse(lake.x, lake.y, lake.rx, lake.ry, lake.rot, [88, 150, 190]);
p.ellipse(lake.x - 14, lake.y - 8, lake.rx * 0.55, lake.ry * 0.4, lake.rot, [150, 200, 224], 0.55);
for (let i = 0; i < 9; i++) p.capsule(lake.x - 40 + i * 9, lake.y - 12 + (i % 3) * 12, lake.x - 28 + i * 9, lake.y - 12 + (i % 3) * 12, 0.9, [214, 236, 244], 0.7);

/* ---------------- roads ---------------- */
for (const r of roads) {
  for (let i = 0; i < r.length - 1; i++) p.capsule(r[i][0], r[i][1], r[i + 1][0], r[i + 1][1], 5.4, [150, 118, 76], 0.9);
  for (let i = 0; i < r.length - 1; i++) p.capsule(r[i][0], r[i][1], r[i + 1][0], r[i + 1][1], 3.6, [214, 184, 128]);
}
{ // the stone bridge, across the river at its narrow place
  const dx = Bn[0] - B[0], dy = Bn[1] - B[1], l = Math.hypot(dx, dy) || 1, tx = dx / l, ty = dy / l, nx = -ty, ny = tx, hw = 34, hh = 11;
  const pt = (a, b) => ({ x: B[0] + nx * a + tx * b, y: B[1] + ny * a + ty * b });
  p.poly([pt(-hw, -hh), pt(hw, -hh), pt(hw, hh), pt(-hw, hh)], [182, 176, 164]);
  p.capsule(pt(-hw, -hh).x, pt(-hw, -hh).y, pt(hw, -hh).x, pt(hw, -hh).y, 2, [110, 104, 94]);
  p.capsule(pt(-hw, hh).x, pt(-hw, hh).y, pt(hw, hh).x, pt(hw, hh).y, 2, [110, 104, 94]);
  for (let k = -hw + 8; k < hw; k += 9) p.capsule(pt(k, -hh + 2).x, pt(k, -hh + 2).y, pt(k, hh - 2).x, pt(k, hh - 2).y, 0.7, [140, 134, 122], 0.8);
}

/* ---------------- trees ---------------- */
function tree(cx, cy, r, k = 1) {
  p.disc(cx + r * 0.35, cy + r * 0.5, r * 1.0, [30, 54, 28], 0.34);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + hash(Math.round(cx), Math.round(cy), 3) * 3, rr = r * (0.55 + hash(Math.round(cy), Math.round(cx), i) * 0.2); const g = (76 + hash(Math.round(cx), i, 8) * 40) * k; p.disc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, rr * 0.75, [g * 0.55, g * 1.05, g * 0.5], 0.96); }
  p.disc(cx - r * 0.2, cy - r * 0.28, r * 0.5, [140, 190, 100], 0.4);
  p.ring(cx, cy, r * 0.98, 1, [38, 70, 34], 0.35);
}
const placed = [];
const tryTree = (x, y, r, k) => { if (placed.some((q) => Math.hypot(q[0] - x, q[1] - y) < (q[2] + r) * 0.72)) return false; placed.push([x, y, r]); tree(x, y, r, k); return true; };
const forestTrees = [];
for (let i = 0; i < 4200; i++) { const x = R() * 0.30 * W, y = R() * H; if (x < forestEdge(y) && riverDist(x, y) > 24 && roadDist(x, y) > 10) forestTrees.push([x, y, 15 + R() * 10]); }
forestTrees.sort((a, b) => a[1] - b[1]).forEach(([x, y, r]) => tryTree(x, y, r, 0.9));
for (const [cx, cy] of [[0.40 * W, 0.30 * H], [0.60 * W, 0.46 * H], [0.52 * W, 0.78 * H], [0.84 * W, 0.40 * H], [0.20 * W, 0.62 * H], [0.78 * W, 0.12 * H]]) {             // copses
  for (let i = 0; i < 9; i++) { const a = R() * 6.28, d = R() * 44; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d; if (free(x, y, 4) && !inForest(x, y)) tryTree(x, y, 11 + R() * 7, 1); }
}
for (let i = 0; i < 70; i++) { const x = 0.18 * W + R() * 0.62 * W, y = R() * H; if (free(x, y, 8) && villageDist(x, y) > 60) tryTree(x, y, 10 + R() * 7, 1.05); }
{ // an orchard by the south-west village: rows of small trees
  const ox = villages[1].x - 120, oy = villages[1].y + 36;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { const x = ox + i * 26, y = oy + j * 26; if (free(x, y, 2)) tryTree(x, y, 10, 1.15); }
}

/* ---------------- villages ---------------- */
function hillHome(cx, cy, s) {
  p.ellipse(cx + 3, cy + 5, 20 * s, 14 * s, 0, [30, 54, 28], 0.35);
  p.ellipse(cx, cy, 20 * s, 14 * s, 0, [118, 170, 76]);
  p.ellipse(cx - 4 * s, cy - 4 * s, 12 * s, 7 * s, 0, [160, 206, 108], 0.7);
  p.ring(cx, cy, 14 * s, 1, [60, 100, 44], 0.35);
  p.disc(cx + 4 * s, cy + 6 * s, 4.6 * s, [120, 78, 44]);                                         // the round door
  p.ring(cx + 4 * s, cy + 6 * s, 4.6 * s, 1.1, [66, 44, 26]);
  p.disc(cx + 4 * s, cy + 6 * s, 1 * s, [232, 196, 80]);
  p.capsule(cx - 8 * s, cy - 8 * s, cx - 8 * s, cy - 13 * s, 1.6, [120, 112, 100]);                // a chimney
}
function cottage(cx, cy, rot, s) {
  const pts = (hw, hh) => [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) }));
  p.poly(pts(14 * s + 3, 10 * s + 4).map((q) => ({ x: q.x + 3, y: q.y + 4 })), [30, 54, 28], 0.35);
  p.poly(pts(14 * s, 10 * s), [196, 108, 70]);
  const half = pts(14 * s, 5 * s * 0.4).map((q) => ({ x: q.x, y: q.y }));
  p.poly([pts(14 * s, 10 * s)[0], pts(14 * s, 10 * s)[1], { x: (pts(14 * s, 10 * s)[1].x + pts(14 * s, 10 * s)[2].x) / 2, y: (pts(14 * s, 10 * s)[1].y + pts(14 * s, 10 * s)[2].y) / 2 }, { x: (pts(14 * s, 10 * s)[0].x + pts(14 * s, 10 * s)[3].x) / 2, y: (pts(14 * s, 10 * s)[0].y + pts(14 * s, 10 * s)[3].y) / 2 }], [226, 138, 90]);
  const o = pts(14 * s, 10 * s); for (let i = 0; i < 4; i++) p.capsule(o[i].x, o[i].y, o[(i + 1) % 4].x, o[(i + 1) % 4].y, 0.9, [92, 52, 34], 0.9);
  void half;
}
for (const v of villages) {
  for (let i = 0; i < v.n; i++) {
    const a = (i / v.n) * Math.PI * 2 + hash(i, Math.round(v.x), 1) * 1.2, d = 18 + hash(i, Math.round(v.y), 2) * 34;
    const x = v.x + Math.cos(a) * d * 1.3, y = v.y + Math.sin(a) * d;
    if (riverDist(x, y) < 40 || inLake(x, y, 20)) continue;
    if (i % 3 === 2) cottage(x, y, hash(i, 7, 3) * 0.8 - 0.4, 1.1); else hillHome(x, y, 1.05 + hash(i, 3, 5) * 0.3);
  }
  for (let i = 0; i < 3; i++) { const x = v.x + (R() - 0.5) * 70, y = v.y + 26 + R() * 18; p.rect(x, y, 14, 4, [116, 88, 56], 0.8); }                // garden fences
}
{ // the mill, by the river below the north-east road
  const i = Math.floor(river.length * 0.30), [mx, my] = river[i];
  p.rect(mx + 18, my - 14, 34, 26, [164, 138, 104]); p.poly([{ x: mx + 14, y: my - 14 }, { x: mx + 56, y: my - 14 }, { x: mx + 35, y: my - 30 }], [186, 100, 66]);
  p.ring(mx + 4, my, 14, 4, [106, 78, 50]); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; p.capsule(mx + 4, my, mx + 4 + Math.cos(a) * 14, my + Math.sin(a) * 14, 1.2, [106, 78, 50]); }
}

/* ---------------- the mountain ridge in the east ---------------- */
for (let y = 10; y < H + 30; y += 74) {
  for (let k = 0; k < 2; k++) {
    const bx = 0.905 * W + (k - 0.5) * 78 + (hash(Math.round(y), k, 6) - 0.5) * 26, by = y + (hash(k, Math.round(y), 7)) * 30, w = 84 + hash(Math.round(y), k, 3) * 34, h = 70 + hash(k, Math.round(y), 2) * 40;
    const top = { x: bx, y: by - h }, l = { x: bx - w / 2, y: by + h * 0.18 }, r = { x: bx + w / 2, y: by + h * 0.18 }, m = { x: bx + w * 0.06, y: by + h * 0.34 };
    p.poly([{ x: l.x + 5, y: l.y + 7 }, { x: r.x + 7, y: r.y + 7 }, { x: m.x + 6, y: m.y + 10 }], [40, 54, 40], 0.25);
    p.poly([top, l, m], [158, 170, 184]);
    p.poly([top, m, r], [102, 116, 136]);
    p.capsule(top.x, top.y, l.x, l.y, 1.3, INK, 0.75); p.capsule(top.x, top.y, r.x, r.y, 1.3, INK, 0.75); p.capsule(top.x, top.y, m.x, m.y, 1, INK, 0.5);
    p.poly([top, { x: top.x - w * 0.10, y: top.y + h * 0.20 }, { x: top.x + w * 0.04, y: top.y + h * 0.23 }], [236, 240, 246], 0.85);                   // a little snow
  }
}

/* ---------------- parchment: an uneven torn edge, paper grain, a soft ink wash ---------------- */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    const wob = 34 + 26 * fbm(x / 70, y / 70, 61) + 12 * vnoise(x / 14, y / 14, 62);
    const k = smoothstep(wob * 0.35, wob, edge);
    const grain = 0.94 + 0.12 * vnoise(x / 2.2, y / 2.2, 63);
    const i = (y * W + x) * 4;
    const paper = [PAPER[0] * grain, PAPER[1] * grain, PAPER[2] * grain];
    p.img[i] = mix(paper[0], p.img[i], k); p.img[i + 1] = mix(paper[1], p.img[i + 1], k); p.img[i + 2] = mix(paper[2], p.img[i + 2], k);
  }
}

await mkdir(path.dirname(path.resolve(out)), { recursive: true });
await writeFile(path.resolve(out), encodePng(p.img, W, H));
console.log(`${out}: ${W} x ${H}, ${placed.length} trees, ${villages.length} villages, ${roads.length} roads`);
void R; void ngon;
