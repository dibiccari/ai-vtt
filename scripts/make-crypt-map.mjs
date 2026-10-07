// Draws "The Sunken Crypt", a torch-lit crypt of four rooms under a ruined chapel, 30 x 20 squares on a 1536 x 1024 picture (about 51.2 px a square), and writes it as a Universal VTT file with its
// walls, doors and lights. It is the code-drawn half of a comparison with a picture painted by an image model (public/scenarios/compare/).
//   node scripts/make-crypt-map.mjs          writes public/scenarios/compare/crypt-claude.dd2vtt
// The layout comes first (rooms and corridors as floor cells); the walls are the edges between floor and rock, so they always match the picture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level, rectPts, ngon, shade, mix, clamp, smooth, fbm, vnoise, hash } from '../lib/mapkit.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLS = 30, ROWS = 20, PPG = 51.2;
const level = new Level({ cols: COLS, rows: ROWS, ppg: PPG, seed: 20261109 });
const p = level.painter;
const R = level.rand;
const sq = (n) => n * PPG;

/* ---------------- the plan: rooms and corridors as cell rectangles [x, y, w, h] ---------------- */
const ROOMS = {
  hall:    { rect: [2, 3, 8, 7], tone: [128, 120, 110], name: 'Entry hall' },
  chamber: { rect: [13, 2, 10, 9], tone: [118, 112, 108], name: 'Pillared chamber' },
  crypt:   { rect: [2, 13, 9, 6], tone: [108, 112, 120], name: 'Sarcophagus crypt' },
  store:   { rect: [17, 14, 11, 5], tone: [142, 104, 66], name: 'Storeroom', planks: true }
};
const CORRIDORS = [
  [10, 5, 3, 2],      // hall - chamber
  [18, 11, 2, 3],     // chamber - store
  [4, 10, 2, 3],      // hall - crypt
  [11, 16, 6, 2]      // crypt - store
];
const DOORS = [[10, 5, 10, 7], [13, 5, 13, 7], [18, 11, 20, 11], [18, 14, 20, 14], [4, 10, 6, 10], [4, 13, 6, 13], [11, 16, 11, 18], [17, 16, 17, 18]];

const floor = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
const roomOf = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const carve = ([x, y, w, h], id) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { floor[j][i] = true; if (id) roomOf[j][i] = id; } };
for (const [id, r] of Object.entries(ROOMS)) carve(r.rect, id);
for (const c of CORRIDORS) carve(c, null);
const isFloor = (i, j) => i >= 0 && j >= 0 && i < COLS && j < ROWS && floor[j][i];

/* ---------------- walls: every edge between a floor cell and rock, minus the doors ---------------- */
const edges = [];   // { x1, y1, x2, y2, rockSide: [dx, dy] } in pixels
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
  if (!floor[j][i]) continue;
  if (!isFloor(i, j - 1)) edges.push({ x1: sq(i), y1: sq(j), x2: sq(i + 1), y2: sq(j), rock: [0, -1] });
  if (!isFloor(i, j + 1)) edges.push({ x1: sq(i), y1: sq(j + 1), x2: sq(i + 1), y2: sq(j + 1), rock: [0, 1] });
  if (!isFloor(i - 1, j)) edges.push({ x1: sq(i), y1: sq(j), x2: sq(i), y2: sq(j + 1), rock: [-1, 0] });
  if (!isFloor(i + 1, j)) edges.push({ x1: sq(i + 1), y1: sq(j), x2: sq(i + 1), y2: sq(j + 1), rock: [1, 0] });
}

/* ---------------- the picture: rock, flagstones, wall rims ---------------- */
const nearFloor = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (isFloor(i + di, j + dj)) return true; return false; };

function paintGround() {
  p.fillWith((x, y) => {
    const gx = x / PPG, gy = y / PPG, i = Math.floor(gx), j = Math.floor(gy);
    if (!isFloor(i, j)) {
      if (!nearFloor(i, j)) {                                    // deep rock: dark, veined, cool
        const n = fbm(gx * 2.4, gy * 2.4, 3), crack = Math.abs(vnoise(gx * 3.1, gy * 3.1, 17) - 0.5) < 0.025 ? 0.55 : 1;
        const v = (12 + n * 22) * crack;
        return [v * 0.95, v * 0.97, v * 1.05];
      }
      // the wall itself, a full cell thick: dressed stone blocks in a running bond with dark mortar and a lit top edge
      const bw = 25, bh = 12.5, row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, col = Math.floor((x + off) / bw);
      const lx = (x + off) - col * bw, ly = y - row * bh, st = hash(col, row, 31);
      const mortar = Math.min(lx, bw - lx, ly, bh - ly) < 1.3 ? 0.5 : 1;
      const lit = (lx < 2.5 || ly < 2.5) ? 1.14 : 1;
      const k = (0.8 + st * 0.35) * mortar * lit * (0.85 + 0.25 * fbm(gx * 1.7, gy * 1.7, 41));
      return [86 * k, 80 * k, 74 * k];
    }
    const room = ROOMS[roomOf[j][i]];
    const tone = room ? room.tone : [112, 106, 98];
    if (room && room.planks) {                                   // wooden planks, laid east-west with staggered joints
      const ph = 16.67, row = Math.floor(y / ph), ly = y - row * ph, joint = (hash(row, 7, 2) * 160) | 0, seg = Math.floor((x + joint) / 150);
      const lx = (x + joint) - seg * 150, grain = 0.88 + 0.22 * vnoise(x / 40, y / 2.2, 9), plank = 0.82 + hash(seg, row, 13) * 0.3;
      const gap = ly < 1.2 || lx < 1.4 ? 0.5 : 1;
      const dirt = 0.86 + 0.24 * fbm(gx * 1.6, gy * 1.6, 9);
      const k = grain * plank * gap * dirt;
      return [tone[0] * k, tone[1] * k, tone[2] * k];
    }
    // flagstones: half-cell blocks in a running bond, each its own shade, with dark grout
    const bw = PPG / 2, bh = PPG / 2;
    const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0;
    const col = Math.floor((x + off) / bw);
    const lx = (x + off) - col * bw, ly = y - row * bh;
    const stone = hash(col, row, 5);
    const grout = Math.min(lx, bw - lx, ly, bh - ly) < 1.6 ? 0.55 : 1;
    const bevel = (lx < 3 || ly < 3) ? 1.12 : (lx > bw - 3 || ly > bh - 3) ? 0.9 : 1;
    const grime = 0.82 + 0.3 * fbm(gx * 1.4, gy * 1.4, 9) + 0.12 * (vnoise(x / 5, y / 5, 11) - 0.5);
    let k = (0.84 + stone * 0.3) * grout * bevel * grime;
    if (room && room === ROOMS.chamber) {                         // an inlaid ring of darker stone around the brazier
      const d = Math.hypot(gx - 17.5, gy - 6.4);
      if (d > 3.2 && d < 3.55) k *= 0.62; else if (d < 3.2) k *= 1.06;
    }
    return [tone[0] * k, tone[1] * k, tone[2] * k];
  });
}

// A soft shadow the walls cast on the floor beside them.
function paintWallRims() {
  for (const e of edges) {
    const [rx, ry] = e.rock;
    for (let s = 0; s < 9; s++) {
      const o = s * 1.5;
      p.poly([
        { x: e.x1 - rx * o, y: e.y1 - ry * o }, { x: e.x2 - rx * o, y: e.y2 - ry * o },
        { x: e.x2 - rx * (o + 1.5), y: e.y2 - ry * (o + 1.5) }, { x: e.x1 - rx * (o + 1.5), y: e.y1 - ry * (o + 1.5) }
      ], [0, 0, 0], 0.22 * (1 - s / 10));
    }
    p.poly([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, { x: e.x2 + rx * 2.5, y: e.y2 + ry * 2.5 }, { x: e.x1 + rx * 2.5, y: e.y1 + ry * 2.5 }], [24, 20, 18], 0.9);   // dark joint where wall meets floor
  }
}

// Merge collinear edge runs into long walls for the sight lines.
function addWalls() {
  const merged = [];
  const used = new Set();
  const key = (e) => `${e.x1},${e.y1},${e.x2},${e.y2}`;
  const byStart = new Map();
  for (const e of edges) byStart.set(`${e.x1},${e.y1},${e.rock}`, e);
  for (const e of edges) {
    if (used.has(key(e))) continue;
    let a = { ...e }, next;
    used.add(key(e));
    while ((next = byStart.get(`${a.x2},${a.y2},${e.rock}`)) && !used.has(key(next)) && (next.x2 - next.x1) * (a.y2 - a.y1) === (next.y2 - next.y1) * (a.x2 - a.x1)) {
      used.add(key(next));
      a.x2 = next.x2; a.y2 = next.y2;
    }
    merged.push(a);
  }
  for (const m of merged) level.wall([{ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 }]);
}

/* ---------------- doors ---------------- */
function drawDoors() {
  for (const [ax, ay, bx, by] of DOORS) {
    const x1 = sq(ax), y1 = sq(ay), x2 = sq(bx), y2 = sq(by);
    const horizontal = y1 === y2;
    level.door(x1, y1, x2, y2);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    for (const half of [-1, 1]) {
      const w = sq(0.94), h = 12;
      const px = horizontal ? cx + half * sq(0.5) : cx, py = horizontal ? cy : cy + half * sq(0.5);
      const pts = rectPts(px, py, horizontal ? w : h, horizontal ? h : w, 0);
      p.poly(pts.map((q) => ({ x: q.x + 2, y: q.y + 3 })), [0, 0, 0], 0.35);
      p.poly(pts, [112, 76, 42]);
      p.poly(rectPts(px, py, horizontal ? w - 6 : h - 5, horizontal ? h - 5 : w - 6, 0), [138, 96, 56]);
      for (let k = -1; k <= 1; k += 2) p.disc(horizontal ? px + k * w * 0.36 : px, horizontal ? py : py + k * w * 0.36, 2.4, [40, 36, 34]);     // iron studs
    }
    p.disc(cx, cy, 3.4, [186, 160, 70]);                                                                                                       // handle
  }
}

/* ---------------- props ---------------- */
function torch(gx, gy, side) {
  // a wall torch: bracket on the wall, flame, and a light that flickers
  const x = sq(gx), y = sq(gy);
  p.disc(x, y, 7, [52, 42, 34]);
  p.disc(x, y, 4, [255, 190, 70]);
  level.light({ x: gx, y: gy, range: 6, intensity: 1, color: 'ffffa24d', name: `torch-${level.lights.length + 1}`, flicker: true });
  void side;
}
function pillar(gx, gy) {
  const x = sq(gx), y = sq(gy), r = sq(0.42);
  p.disc(x + 5, y + 6, r, [0, 0, 0], 0.35);
  p.disc(x, y, r, [96, 92, 88]);
  p.disc(x - 2, y - 2, r * 0.82, [138, 132, 126]);
  p.disc(x - 5, y - 5, r * 0.4, [168, 162, 154], 0.7);
  p.ring(x, y, r, 2, [66, 62, 58]);
  level.solid(ngon(x, y, r * 0.95, r * 0.95, 10));
}
function crate(gx, gy, size, rot) {
  const x = sq(gx), y = sq(gy), s = sq(size);
  const pts = rectPts(x, y, s, s, rot);
  p.poly(pts.map((q) => ({ x: q.x + 3, y: q.y + 4 })), [0, 0, 0], 0.35);
  p.poly(pts, [112, 78, 44]);
  p.poly(rectPts(x, y, s * 0.8, s * 0.8, rot), [142, 102, 60]);
  p.capsule(pts[0].x, pts[0].y, pts[2].x, pts[2].y, 1.4, [84, 56, 32], 0.8);
  p.capsule(pts[1].x, pts[1].y, pts[3].x, pts[3].y, 1.4, [84, 56, 32], 0.8);
  level.solid(pts);
}
function barrel(gx, gy, r = 0.42) {
  const x = sq(gx), y = sq(gy), rr = sq(r);
  p.disc(x + 3, y + 4, rr, [0, 0, 0], 0.35);
  p.disc(x, y, rr, [96, 64, 36]);
  p.disc(x, y, rr * 0.86, [128, 90, 54]);
  p.ring(x, y, rr * 0.55, 2, [74, 50, 30], 0.8);
  p.disc(x, y, rr * 0.12, [60, 40, 24]);
  level.solid(ngon(x, y, rr * 0.9, rr * 0.9, 8));
}
function table(gx, gy, w, h, rot = 0) {
  const x = sq(gx), y = sq(gy);
  const pts = rectPts(x, y, sq(w), sq(h), rot);
  p.poly(pts.map((q) => ({ x: q.x + 4, y: q.y + 5 })), [0, 0, 0], 0.35);
  p.poly(pts, [98, 66, 38]);
  p.poly(rectPts(x, y, sq(w) - 6, sq(h) - 6, rot), [128, 88, 52]);
  level.solid(pts);
}
function sarcophagus(gx, gy, vertical) {
  const x = sq(gx), y = sq(gy), w = vertical ? sq(1.1) : sq(2.1), h = vertical ? sq(2.1) : sq(1.1);
  const pts = rectPts(x, y, w, h, 0);
  p.poly(pts.map((q) => ({ x: q.x + 4, y: q.y + 5 })), [0, 0, 0], 0.4);
  p.poly(pts, [118, 122, 128]);
  p.poly(rectPts(x, y, w - 10, h - 10, 0), [152, 156, 162]);
  p.poly(rectPts(x, y, vertical ? w - 30 : w - 40, vertical ? h - 40 : h - 30, 0), [136, 140, 146]);
  p.disc(vertical ? x : x - w * 0.32, vertical ? y - h * 0.32 : y, 7, [170, 174, 180]);          // a carved head
  level.solid(pts);
}
function chest(gx, gy, rot = 0) {
  const x = sq(gx), y = sq(gy);
  const pts = rectPts(x, y, sq(0.9), sq(0.6), rot);
  p.poly(pts.map((q) => ({ x: q.x + 3, y: q.y + 4 })), [0, 0, 0], 0.35);
  p.poly(pts, [104, 66, 34]);
  p.poly(rectPts(x, y, sq(0.78), sq(0.46), rot), [132, 88, 48]);
  p.poly(rectPts(x, y, 7, sq(0.6), rot), [196, 162, 66]);
  level.solid(pts);
}
function bones(gx, gy) {
  const x = sq(gx), y = sq(gy);
  for (let i = 0; i < 4; i++) {
    const a = R() * Math.PI * 2, d = R() * sq(0.35);
    p.capsule(x + Math.cos(a) * d - 8, y + Math.sin(a) * d - 3, x + Math.cos(a) * d + 8, y + Math.sin(a) * d + 3, 2.2, [208, 200, 182]);
  }
  p.disc(x + 6, y - 6, 6, [214, 206, 188]);
  p.disc(x + 4, y - 7, 1.5, [40, 36, 30]); p.disc(x + 8, y - 7, 1.5, [40, 36, 30]);
}
function rubble(gx, gy, n = 9) {
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, d = R() * sq(0.7), r = 4 + R() * 8;
    const x = sq(gx) + Math.cos(a) * d, y = sq(gy) + Math.sin(a) * d;
    p.ellipse(x + 2, y + 3, r, r * 0.8, R() * 3, [0, 0, 0], 0.3);
    p.ellipse(x, y, r, r * 0.8, R() * 3, [104 + R() * 24, 98 + R() * 22, 92 + R() * 20]);
    p.ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.4, 0, [150, 144, 136], 0.6);
  }
}
function pool(gx, gy, rx, ry) {
  const x = sq(gx), y = sq(gy);
  p.ellipse(x, y, sq(rx) + 8, sq(ry) + 8, 0.2, [64, 58, 52]);                       // the stone curb
  p.ellipse(x, y, sq(rx), sq(ry), 0.2, [34, 74, 96]);
  p.ellipse(x - 6, y - 4, sq(rx) * 0.8, sq(ry) * 0.75, 0.2, [48, 106, 132], 0.9);
  for (let k = 0; k < 4; k++) p.ring(x + (k - 1.5) * 14, y + ((k * 7) % 11) - 5, 10 + k * 6, 1.5, [150, 200, 220], 0.28);
}
function stairs(gx, gy, w, h) {
  const x = sq(gx), y = sq(gy);
  for (let s = 0; s < 8; s++) {
    const k = 1 - s / 10;
    p.poly(rectPts(x + sq(w) / 2, y + (s + 0.5) * (sq(h) / 8), sq(w), sq(h) / 8 - 1, 0), shade([126, 118, 108], k));
    p.rect(x, y + s * (sq(h) / 8), sq(w), 2, [0, 0, 0], 0.25);
  }
}

function dressRooms() {
  // Entry hall: stairs up in the corner, two pillars, a table and crates
  stairs(2.2, 3.3, 2.4, 2.6);
  pillar(4.5, 7.2); pillar(7.8, 7.2);
  torch(6, 3.05); torch(9.95, 8.4); torch(2.05, 8.2);
  table(7.2, 4.6, 2, 1.1); crate(8.6, 8.9, 0.8, 0.2); barrel(2.9, 9.2);
  // Pillared chamber: an altar, a brazier, four pillars, bones
  for (const [x, y] of [[15, 4.2], [20, 4.2], [15, 8.4], [20, 8.4]]) pillar(x, y);
  table(17.5, 3.4, 3, 1.1);
  p.disc(sq(17.5), sq(6.4), sq(0.8), [60, 54, 50]); p.disc(sq(17.5), sq(6.4), sq(0.55), [30, 24, 22]);
  level.light({ x: 17.5, y: 6.4, range: 7, intensity: 1, color: 'ffffa24d', name: 'brazier', flicker: true });
  p.disc(sq(17.5), sq(6.4), sq(0.34), [255, 170, 60]); p.disc(sq(17.5), sq(6.4), sq(0.18), [255, 236, 150]);
  torch(13.05, 3.2); torch(22.95, 3.2); torch(22.95, 9); torch(17.5, 2.05); bones(21.4, 9.6); rubble(14, 9.9, 6);
  // Sarcophagus crypt: four tombs, bones, a pool
  sarcophagus(4.6, 15.2, false); sarcophagus(8.4, 15.2, false); sarcophagus(4.6, 17.5, false); sarcophagus(8.4, 17.5, false);
  bones(2.9, 13.9); rubble(9.9, 13.9, 5); torch(2.05, 15.5); torch(10.95, 15); torch(6.5, 18.95);
  // Storeroom: crates, barrels, a chest, a table
  crate(18.4, 15.2, 1.0, 0.1); crate(19.6, 15.6, 0.9, -0.2); barrel(26.8, 15.1); barrel(26.8, 16.2); barrel(25.7, 15.1);
  table(23, 17.5, 2.6, 1.0); chest(18.6, 17.9, 0.1); torch(20, 14.05); torch(25, 14.05); torch(22.5, 18.95);
  torch(11.5, 15.95);
}

/* ---------------- lighting: darken the whole picture, then add the torchlight back ---------------- */
function lighting() {
  const d = p.img;
  for (let i = 0; i < d.length; i += 4) { d[i] *= 0.6; d[i + 1] *= 0.58; d[i + 2] *= 0.58; }
  // torchlight: warm, reaching floors fully and the wall faces partly, but never the solid rock beyond
  for (const l of level.lights) {
    const cx = sq(l.x), cy = sq(l.y), r = sq(l.range * 0.95), str = l.name === 'brazier' ? 0.66 : 0.52;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(p.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(p.w - 1, Math.ceil(cx + r)); x++) {
      const i = Math.floor(x / PPG), j = Math.floor(y / PPG);
      const mask = isFloor(i, j) ? 1 : (nearFloor(i, j) ? 0.55 : 0);
      if (!mask) continue;
      const f = Math.pow(clamp(1 - Math.hypot(x - cx, y - cy) / r, 0, 1), 1.6) * str * mask;
      if (f <= 0) continue;
      const k = (y * p.w + x) * 4;
      d[k] += 255 * f; d[k + 1] += 150 * f; d[k + 2] += 60 * f;
    }
  }
  // the flames and their sconces
  for (const l of level.lights) {
    const x = sq(l.x), y = sq(l.y);
    p.disc(x, y, 8, [40, 34, 30]);
    p.disc(x, y, 6, [255, 170, 60]);
    p.disc(x, y, 4, [255, 214, 120]);
    p.disc(x, y, 2, [255, 248, 210]);
  }
}

paintGround();
paintWallRims();
addWalls();
drawDoors();
dressRooms();
lighting();

const file = path.join(root, 'public', 'scenarios', 'compare', 'crypt-claude.dd2vtt');
await level.write(file, { ambient: 'ff2a2630' });
await level.writePng(path.join(root, 'public', 'scenarios', 'compare', 'crypt-claude.png'));
console.log(`crypt-claude.dd2vtt: ${COLS}x${ROWS} squares, ${level.walls.length} sight lines, ${level.portals.length} doors, ${level.lights.length} lights`);
