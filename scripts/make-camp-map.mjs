// Draws a forest campsite battle map (day and night) and writes it as Universal VTT files: picture, walls (line of sight) and lights.
//   node scripts/make-camp-map.mjs            writes public/scenarios/camp-day.dd2vtt and camp-night.dd2vtt
// Then: node scripts/import-dd2vtt.mjs public/scenarios/camp-day.dd2vtt camp-day   (and the same for camp-night)
// Everything is drawn in code (no image library, no external art): 40 x 30 squares at 50 px per square, fixed seed so it is repeatable.

import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLS = 40, ROWS = 30, PPG = 50, W = COLS * PPG, H = ROWS * PPG;
const FIRE = { x: 20, y: 15 };

/* ---------------- tiny random + noise ---------------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261004);
const hash = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

/* ---------------- pixel buffer and shapes ---------------- */
const img = new Uint8ClampedArray(W * H * 4);
function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  img[i] = img[i] * (1 - a) + r * a;
  img[i + 1] = img[i + 1] * (1 - a) + g * a;
  img[i + 2] = img[i + 2] * (1 - a) + b * a;
  img[i + 3] = 255;
}
const sq = (n) => n * PPG;                      // squares to pixels

function disc(cx, cy, r, col, alpha = 1) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
    const cov = clamp(r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5, 0, 1);
    if (cov > 0) put(x, y, col[0], col[1], col[2], cov * alpha);
  }
}
function ellipse(cx, cy, rx, ry, rot, col, alpha = 1) {
  const c = Math.cos(rot), s = Math.sin(rot), R = Math.max(rx, ry) + 2;
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
    const d = Math.hypot(u, v);
    const cov = clamp((1 - d) * Math.min(rx, ry) + 0.5, 0, 1);
    if (cov > 0) put(x, y, col[0], col[1], col[2], cov * alpha);
  }
}
function capsule(x1, y1, x2, y2, r, col, alpha = 1) {
  const minX = Math.floor(Math.min(x1, x2) - r - 1), maxX = Math.ceil(Math.max(x1, x2) + r + 1);
  const minY = Math.floor(Math.min(y1, y2) - r - 1), maxY = Math.ceil(Math.max(y1, y2) + r + 1);
  const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy || 1;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const t = clamp(((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / len2, 0, 1);
    const cov = clamp(r - Math.hypot(x + 0.5 - (x1 + vx * t), y + 0.5 - (y1 + vy * t)) + 0.5, 0, 1);
    if (cov > 0) put(x, y, col[0], col[1], col[2], cov * alpha);
  }
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function poly(pts, col, alpha = 1) {
  const minX = Math.floor(Math.min(...pts.map((p) => p.x))), maxX = Math.ceil(Math.max(...pts.map((p) => p.x)));
  const minY = Math.floor(Math.min(...pts.map((p) => p.y))), maxY = Math.ceil(Math.max(...pts.map((p) => p.y)));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    let hits = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (inPoly(x + ox, y + oy, pts)) hits++;
    if (hits) put(x, y, col[0], col[1], col[2], (hits / 4) * alpha);
  }
}
// A rectangle given its centre, size and rotation (pixels); returns its corners.
function rectPts(cx, cy, w, h, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}
const shade = (col, k) => [clamp(col[0] * k, 0, 255), clamp(col[1] * k, 0, 255), clamp(col[2] * k, 0, 255)];

/* ---------------- the level ---------------- */
const walls = [];                                // line-of-sight polylines in grid units
const addPoly = (pts) => walls.push([...pts, pts[0]].map((p) => ({ x: p.x / PPG, y: p.y / PPG })));
const lights = [];                               // grid units

// clearing shape and the two trails (south and west)
const clearRadius = (ang) => 9.2 + 1.8 * Math.sin(3 * ang + 1) + 1.1 * Math.sin(5 * ang + 2);
const trails = [
  [{ x: 20, y: 30.5 }, { x: 20.4, y: 26 }, { x: 19.2, y: 22 }, { x: 20, y: 19 }],
  [{ x: -0.5, y: 14.2 }, { x: 5, y: 14.8 }, { x: 9, y: 15.6 }, { x: 12, y: 15.2 }]
];
function distToSeg(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, t = clamp(((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}
const trailDist = (x, y) => Math.min(...trails.flatMap((t) => t.slice(1).map((p, i) => distToSeg(x, y, t[i], p))));

function paintGround() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = x / PPG, gy = y / PPG;
    const n = fbm(gx * 1.6, gy * 1.6, 1), n2 = vnoise(gx * 9, gy * 9, 5);
    // grass
    let r = mix(58, 96, n) + (n2 - 0.5) * 14, g = mix(104, 148, n) + (n2 - 0.5) * 16, b = mix(40, 64, n) + (n2 - 0.5) * 8;
    // dirt in the clearing, with a ragged edge, and along the trails
    const dx = gx - FIRE.x, dy = gy - FIRE.y, d = Math.hypot(dx, dy), rc = clearRadius(Math.atan2(dy, dx));
    const edge = (rc - d) + (vnoise(gx * 3, gy * 3, 9) - 0.5) * 2.4;
    const dirt = Math.max(smooth(clamp(edge / 1.4 + 0.5, 0, 1)), smooth(clamp((1.25 - trailDist(gx, gy) + (vnoise(gx * 4, gy * 4, 11) - 0.5)) / 0.9, 0, 1)));
    const dn = vnoise(gx * 7, gy * 7, 3), tuft = vnoise(gx * 5, gy * 5, 17) > 0.72 ? 1 : 0;
    const dr = mix(150, 178, dn), dg = mix(118, 142, dn), db = mix(80, 98, dn);
    const k = dirt * (tuft ? 0.55 : 1);
    r = mix(r, dr, k); g = mix(g, dg, k); b = mix(b, db, k);
    const i = (y * W + x) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
  }
}

const props = [];                                // things trees must keep clear of: { x, y, r } in squares
const keepClear = (x, y, r) => props.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r);

function drawCampfire() {
  const cx = sq(FIRE.x), cy = sq(FIRE.y);
  disc(cx, cy, sq(1.25), [48, 38, 32], 0.85);                                     // scorched ground
  for (let i = 0; i < 12; i++) {                                                  // stone ring
    const a = (i / 12) * Math.PI * 2 + 0.2, rr = sq(0.82);
    ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, sq(0.24), sq(0.19), a, [118, 114, 108]);
    ellipse(cx + Math.cos(a) * rr - 2, cy + Math.sin(a) * rr - 2, sq(0.15), sq(0.1), a, [150, 146, 138], 0.7);
  }
  disc(cx, cy, sq(0.66), [30, 24, 22]);
  for (const a of [0.3, 1.9, 3.4, 5.0]) capsule(cx + Math.cos(a) * sq(0.5), cy + Math.sin(a) * sq(0.5), cx - Math.cos(a) * sq(0.5), cy - Math.sin(a) * sq(0.5), sq(0.11), [88, 56, 32]);
  disc(cx, cy, sq(0.46), [210, 70, 20], 0.9);
  disc(cx, cy, sq(0.32), [255, 150, 40], 0.95);
  disc(cx, cy, sq(0.17), [255, 226, 120]);
  props.push({ x: FIRE.x, y: FIRE.y, r: 1.4 });
  lights.push({ x: FIRE.x, y: FIRE.y, range: 9, intensity: 1, color: 'ffff9a3c', name: 'campfire', flicker: true });
}

function drawLog(cx, cy, len, rot) {
  const dx = Math.cos(rot) * len / 2, dy = Math.sin(rot) * len / 2;
  capsule(cx - dx + 3, cy - dy + 4, cx + dx + 3, cy + dy + 4, sq(0.27), [0, 0, 0], 0.28);
  capsule(cx - dx, cy - dy, cx + dx, cy + dy, sq(0.26), [96, 62, 36]);
  capsule(cx - dx, cy - dy - 3, cx + dx, cy + dy - 3, sq(0.1), [128, 88, 54], 0.8);
  disc(cx + dx, cy + dy, sq(0.23), [158, 118, 78]); disc(cx + dx, cy + dy, sq(0.11), [120, 84, 52]);
  disc(cx - dx, cy - dy, sq(0.23), [150, 110, 72]); disc(cx - dx, cy - dy, sq(0.11), [114, 80, 50]);
}

function drawTent(cx, cy, w, h, rot, cloth) {
  const pts = rectPts(cx, cy, w, h, rot);
  poly(pts.map((p) => ({ x: p.x + 5, y: p.y + 6 })), [0, 0, 0], 0.3);
  poly(pts, shade(cloth, 0.86));
  // two roof planes meeting at the ridge
  const c = Math.cos(rot), s = Math.sin(rot);
  const upper = [pts[0], pts[1], { x: cx + (w / 2) * c, y: cy + (w / 2) * s }, { x: cx - (w / 2) * c, y: cy - (w / 2) * s }];
  poly(upper, shade(cloth, 1.12));
  capsule(cx - (w / 2) * c, cy - (w / 2) * s, cx + (w / 2) * c, cy + (w / 2) * s, 2.2, shade(cloth, 0.55));
  for (let i = 1; i < 6; i++) {                                                   // seams
    const t = i / 6 - 0.5, ox = cx + w * t * c, oy = cy + w * t * s;
    capsule(ox - (h / 2) * -s, oy - (h / 2) * c, ox + (h / 2) * -s, oy + (h / 2) * c, 0.8, shade(cloth, 0.7), 0.5);
  }
  addPoly(pts);
  props.push({ x: cx / PPG, y: cy / PPG, r: Math.max(w, h) / PPG / 2 + 0.6 });
  lights.push({ x: cx / PPG, y: cy / PPG, range: 2.5, intensity: 0.35, color: 'ffffd27a', name: `lantern-${lights.length}` });
}

function drawBedroll(cx, cy, rot, col) {
  const pts = rectPts(cx, cy, sq(0.7), sq(1.6), rot);
  poly(pts.map((p) => ({ x: p.x + 3, y: p.y + 4 })), [0, 0, 0], 0.25);
  poly(pts, col);
  const c = Math.cos(rot), s = Math.sin(rot);
  disc(cx - s * sq(0.55), cy + c * sq(0.55), sq(0.2), [226, 214, 190]);
  props.push({ x: cx / PPG, y: cy / PPG, r: 1.3 });
  capsule(cx + s * sq(0.1), cy - c * sq(0.1), cx - s * sq(0.5), cy + c * sq(0.5), 1.5, shade(col, 0.7), 0.7);
}

function drawCrate(cx, cy, size, rot) {
  const pts = rectPts(cx, cy, size, size, rot);
  poly(pts.map((p) => ({ x: p.x + 3, y: p.y + 4 })), [0, 0, 0], 0.3);
  poly(pts, [132, 92, 52]);
  poly(rectPts(cx, cy, size * 0.78, size * 0.78, rot), [152, 110, 66]);
  capsule(pts[0].x, pts[0].y, pts[2].x, pts[2].y, 1.4, [96, 64, 36], 0.8);
  capsule(pts[1].x, pts[1].y, pts[3].x, pts[3].y, 1.4, [96, 64, 36], 0.8);
  addPoly(pts);
  props.push({ x: cx / PPG, y: cy / PPG, r: size / PPG / 2 + 0.4 });
}

function drawBarrel(cx, cy, r) {
  disc(cx + 3, cy + 4, r, [0, 0, 0], 0.3);
  disc(cx, cy, r, [112, 76, 44]);
  disc(cx, cy, r * 0.86, [140, 100, 62]);
  disc(cx, cy, r * 0.62, [124, 88, 54]);
  disc(cx, cy, r * 0.12, [70, 46, 28]);
  props.push({ x: cx / PPG, y: cy / PPG, r: r / PPG + 0.3 });
}

function drawRock(cx, cy, r, solid) {
  ellipse(cx + 4, cy + 5, r * 1.1, r * 0.9, 0.3, [0, 0, 0], 0.3);
  ellipse(cx, cy, r, r * 0.84, 0.4, [112, 110, 104]);
  ellipse(cx - r * 0.18, cy - r * 0.2, r * 0.7, r * 0.55, 0.4, [146, 144, 136], 0.9);
  ellipse(cx - r * 0.28, cy - r * 0.3, r * 0.3, r * 0.2, 0.4, [180, 178, 170], 0.7);
  if (solid) {
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: cx + Math.cos((i / 8) * Math.PI * 2 + 0.3) * r * 0.95, y: cy + Math.sin((i / 8) * Math.PI * 2 + 0.3) * r * 0.8 }));
    addPoly(pts);
  }
  props.push({ x: cx / PPG, y: cy / PPG, r: r / PPG + 0.2 });
}

function drawTree(cx, cy, r) {
  ellipse(cx + r * 0.28, cy + r * 0.34, r * 1.02, r * 0.98, 0, [6, 20, 10], 0.38);          // shadow on the ground
  const tones = [[26, 66, 32], [36, 84, 40], [50, 106, 50], [68, 130, 62]];
  for (let layer = 0; layer < 4; layer++) {
    const rr = r * (1 - layer * 0.16), n = 6 + layer;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, off = rr * (0.28 + rand() * 0.34) * (layer ? 0.7 : 1);
      disc(cx + Math.cos(a) * off - layer * 2, cy + Math.sin(a) * off - layer * 2.5, rr * (0.46 + rand() * 0.2), shade(tones[layer], 0.9 + rand() * 0.22), 0.96);
    }
  }
  for (let i = 0; i < Math.round(r * 0.7); i++) {                                            // leaf glints
    const a = rand() * Math.PI * 2, d = rand() * r * 0.8;
    disc(cx + Math.cos(a) * d - r * 0.12, cy + Math.sin(a) * d - r * 0.16, 2 + rand() * 2.6, [112, 168, 88], 0.55);
  }
  // the trunk blocks sight; the canopy does not
  addPoly(Array.from({ length: 8 }, (_, i) => ({ x: cx + Math.cos((i / 8) * Math.PI * 2) * sq(0.28), y: cy + Math.sin((i / 8) * Math.PI * 2) * sq(0.28) })));
}

function placeProps() {
  // benches around the fire
  drawLog(sq(FIRE.x - 3.2), sq(FIRE.y + 0.3), sq(3), Math.PI / 2 + 0.12);
  drawLog(sq(FIRE.x + 3.1), sq(FIRE.y - 0.2), sq(3), Math.PI / 2 - 0.1);
  drawLog(sq(FIRE.x + 0.2), sq(FIRE.y - 3.2), sq(3), 0.05);
  drawLog(sq(FIRE.x - 2.2), sq(FIRE.y + 3.0), sq(2.4), 0.55);
  for (const l of [[FIRE.x - 3.2, FIRE.y + 0.3], [FIRE.x + 3.1, FIRE.y - 0.2], [FIRE.x + 0.2, FIRE.y - 3.2], [FIRE.x - 2.2, FIRE.y + 3]]) props.push({ x: l[0], y: l[1], r: 1.6 });
  // tents and bedrolls
  drawTent(sq(11), sq(8.2), sq(5), sq(3.6), 0.18, [204, 184, 138]);
  drawTent(sq(29.5), sq(8.6), sq(4.6), sq(3.4), -0.22, [92, 112, 72]);
  drawTent(sq(31.2), sq(21.5), sq(5), sq(3.6), 0.3, [150, 98, 70]);
  drawBedroll(sq(14.6), sq(19.6), 0.5, [122, 62, 54]);
  drawBedroll(sq(16.2), sq(21), 0.38, [70, 86, 128]);
  drawBedroll(sq(26), sq(19.4), -0.4, [96, 110, 70]);
  // supplies
  drawCrate(sq(10.2), sq(20.2), sq(1.1), 0.2);
  drawCrate(sq(11.7), sq(21), sq(0.95), -0.3);
  drawCrate(sq(10.8), sq(18.8), sq(0.9), 0.5);
  drawBarrel(sq(12.9), sq(20.4), sq(0.5));
  drawBarrel(sq(9.2), sq(21.6), sq(0.48));
  // a few boulders, two of them big enough to hide behind
  drawRock(sq(26.8), sq(11.8), sq(1.0), true);
  drawRock(sq(14.2), sq(11.2), sq(0.8), true);
  drawRock(sq(8.2), sq(13.2), sq(0.45), false);
  drawRock(sq(24.4), sq(23.2), sq(0.4), false);
  drawRock(sq(33.4), sq(15.2), sq(0.55), false);
}

function placeTrees() {
  const trees = [];
  for (let tries = 0; tries < 9000 && trees.length < 150; tries++) {
    const x = rand() * COLS, y = rand() * ROWS, r = 1.0 + rand() * 1.25;
    const dc = Math.hypot(x - FIRE.x, y - FIRE.y), ang = Math.atan2(y - FIRE.y, x - FIRE.x);
    if (dc < clearRadius(ang) + r * 0.55 - 0.4) continue;                // keep the clearing open
    if (trailDist(x, y) < 1.9 + r * 0.5) continue;                       // and the trails
    if (keepClear(x, y, r * 0.7)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < (t.r + r) * 0.62)) continue;
    trees.push({ x, y, r });
  }
  trees.sort((a, b) => a.y - b.y);
  for (const t of trees) drawTree(sq(t.x), sq(t.y), sq(t.r));
  return trees.length;
}

/* ---------------- night ---------------- */
function nightCopy(source) {
  const out = new Uint8ClampedArray(source.length);
  const lamps = lights.filter((l) => l.intensity < 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, gx = x / PPG, gy = y / PPG;
    const d = Math.hypot(gx - FIRE.x, gy - FIRE.y);
    let glow = Math.pow(clamp(1 - d / 10.5, 0, 1), 1.8) * (0.92 + 0.08 * vnoise(gx * 6, gy * 6, 21));
    for (const l of lamps) glow = Math.max(glow, Math.pow(clamp(1 - Math.hypot(gx - l.x, gy - l.y) / 3.2, 0, 1), 2) * 0.45);
    const moon = 0.9 + 0.3 * vnoise(gx * 0.7, gy * 0.7, 31);
    const vig = 1 - 0.25 * Math.pow(Math.hypot((gx - COLS / 2) / (COLS / 2), (gy - ROWS / 2) / (ROWS / 2)), 2.2);
    const r = source[i], g = source[i + 1], b = source[i + 2];
    const cold = [r * 0.26 * moon, g * 0.34 * moon, b * 0.58 * moon + 10];
    const warm = [r * 1.28 + 14, g * 0.98 + 6, b * 0.62];
    out[i] = mix(cold[0], warm[0], glow) * vig;
    out[i + 1] = mix(cold[1], warm[1], glow) * vig;
    out[i + 2] = mix(cold[2], warm[2], glow) * vig;
    out[i + 3] = 255;
  }
  // the flames themselves stay bright
  const cx = sq(FIRE.x), cy = sq(FIRE.y);
  for (const [rr, c, a] of [[0.62, [255, 120, 30], 0.55], [0.46, [255, 170, 50], 0.9], [0.3, [255, 232, 140], 1]]) {
    for (let y = Math.floor(cy - sq(rr)); y <= cy + sq(rr); y++) for (let x = Math.floor(cx - sq(rr)); x <= cx + sq(rr); x++) {
      const cov = clamp(sq(rr) - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5, 0, 1) * a;
      if (cov <= 0) continue;
      const i = (y * W + x) * 4;
      out[i] = out[i] * (1 - cov) + c[0] * cov; out[i + 1] = out[i + 1] * (1 - cov) + c[1] * cov; out[i + 2] = out[i + 2] * (1 - cov) + c[2] * cov;
    }
  }
  return out;
}

/* ---------------- PNG + Universal VTT output ---------------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 1;                                     // PNG "Sub" filter: smaller files for smooth pictures
    for (let x = 0; x < W * 4; x++) {
      const i = y * W * 4 + x;
      raw[y * (W * 4 + 1) + 1 + x] = (rgba[i] - (x >= 4 ? rgba[i - 4] : 0)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

function uvtt(pixels, night) {
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: COLS, y: ROWS }, pixels_per_grid: PPG },
    line_of_sight: walls,
    objects_line_of_sight: [],
    portals: [],
    environment: { baked_lighting: true, ambient_light: night ? 'ff1a2240' : 'ffffffff' },
    lights: (night ? lights : lights.filter((l) => l.name === 'campfire')).map((l) => ({ position: { x: l.x, y: l.y }, range: l.range, intensity: l.intensity, color: l.color, shadows: true, name: l.name, ...(l.flicker ? { flicker: true } : {}) })),
    image: encodePng(pixels).toString('base64')
  };
}

paintGround();
drawCampfire();
placeProps();
const treeCount = placeTrees();
const day = new Uint8ClampedArray(img);
const night = nightCopy(day);

const dir = path.join(root, 'public', 'scenarios');
await mkdir(dir, { recursive: true });
for (const [name, pixels, isNight] of [['camp-day', day, false], ['camp-night', night, true]]) {
  const file = path.join(dir, `${name}.dd2vtt`);
  await writeFile(file, JSON.stringify(uvtt(pixels, isNight)));
  console.log(`${name}.dd2vtt: ${COLS}x${ROWS} squares, ${walls.length} sight lines, ${isNight ? lights.length : 0} lights, ${treeCount} trees`);
}
