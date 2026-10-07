// Draws "Terrain Test Grounds", a small outdoor map for trying out fog of war, line of sight and difficult terrain, and writes it as a
// Universal VTT file plus a sidecar with its difficult terrain and start pins.
//   node scripts/make-terrain-test-map.mjs     writes public/scenarios/terrain-test.dd2vtt and terrain-test.config.json (40 x 30 squares, 50 px)
// Then: node scripts/import-dd2vtt.mjs public/scenarios/terrain-test.dd2vtt vtt-terrain-test
//       node scripts/apply-map-sidecar.mjs public/scenarios/terrain-test.config.json vtt-terrain-test.png
// What is on it: trees (the trunks block sight and movement), two boulders (block both), a creek you can wade (difficult terrain), a field
// of rubble with a ruined wall (difficult terrain, the wall blocks sight), a thicket of undergrowth (difficult terrain, does not block sight),
// a small house with two doors (walls block sight until a door is opened), a window (stops movement, not sight) and a dark interior lit by a lantern,
// a flickering campfire, a fenced paddock (a fence stops movement, not sight), and a high cliff: a mesa about 40 ft up whose face stops anyone on foot (a movement-only wall,
// like a fence) but not a flyer, so only a flying creature can reach its top.

import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level, ngon, rectPts, shade, mix, clamp, fbm, vnoise, hash } from '../lib/mapkit.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLS = 40, ROWS = 30, PPG = 50;
const level = new Level({ cols: COLS, rows: ROWS, ppg: PPG, seed: 20261006 });
const p = level.painter;
const R = level.rand;
const sq = (n) => n * PPG;

/* ---------------- the layout ---------------- */
const creekY = (gx) => 15 + 2.5 * Math.sin(gx * 0.35);       // the creek's centre line, in squares
const HALF = 1.4;                                            // half its width
const RUBBLE = { x: 6, y: 19, w: 5, h: 4 };                  // squares
const THICKET = { x: 20, y: 5, w: 6, h: 4 };
const HOUSE = { x: 28, y: 1.2, w: 5, h: 3.6, door: [30.2, 31.8], back: [2.2, 3.4] };       // squares; the front door is in the south wall (between these two x values), a back door in the east wall (between these two y values)
const FIRE = { x: 7, y: 12.5 };
const WINDOW = [2.2, 3.2];                                                    // squares: the window in the house's west wall (between these two y values)
const PADDOCK = { x1: 30, y1: 17, x2: 35.5, y2: 20.5, gate: [32, 33] };         // squares: a fenced field with a gate gap in the south side
const CLIFF = { x: 14, y: 24.5, w: 5, h: 5.5 };                                     // squares: the mesa, a cliff about 40 ft high; its face runs round the outside of this rectangle
const extraWalls = [];                                                         // walls that the dd2vtt format cannot carry: fences and windows, in image pixels
const TREES = [[5, 4], [9, 7], [14, 5], [22, 3], [27, 8], [35, 6], [36, 10], [3, 24], [12, 26], [19, 22], [26, 26], [33, 22], [37, 26], [17, 9]];
const BOULDERS = [{ x: 28, y: 21, rx: 1.1, ry: 0.85 }, { x: 11, y: 10.5, rx: 0.7, ry: 0.55 }];
const inRect = (gx, gy, r, pad = 0) => gx >= r.x - pad && gx <= r.x + r.w + pad && gy >= r.y - pad && gy <= r.y + r.h + pad;

/* ---------------- ground: grass, creek, banks, rubble field ---------------- */
p.fillWith((x, y) => {
  const gx = x / PPG, gy = y / PPG;
  const n = fbm(gx * 1.7, gy * 1.7, 5), n2 = fbm(gx * 6, gy * 6, 11);
  let col = [44 + n * 40 + n2 * 10, 120 + n * 56 + n2 * 14, 38 + n * 24];                     // grass: a fresh, saturated green
  const d = Math.abs(gy - creekY(gx));
  if (d < HALF + 0.35) {
    const bank = clamp((d - HALF) / 0.35, 0, 1);                                              // 0 in the water, 1 on dry ground
    if (d < HALF) {
      const depth = 1 - d / HALF, ripple = vnoise(gx * 9 + gy * 3, gy * 9, 31);
      col = [92 - depth * 30 + ripple * 24, 158 - depth * 28 + ripple * 26, 196 - depth * 22 + ripple * 20];
    } else col = [mix(176, col[0], bank), mix(158, col[1], bank), mix(112, col[2], bank)];   // muddy bank
  }
  if (inRect(gx, gy, RUBBLE, 0.4)) {                                                          // gravel under the rubble
    const t = 0.6 + vnoise(gx * 5, gy * 5, 41) * 0.4;
    col = [mix(col[0], 138 * t, 0.7), mix(col[1], 130 * t, 0.7), mix(col[2], 116 * t, 0.7)];
  }
  if (inRect(gx, gy, THICKET, 0.2)) col = [mix(col[0], 40, 0.45), mix(col[1], 78, 0.45), mix(col[2], 36, 0.45)];   // shade under the brush
  return col;
});

// a few pebbles and stones in the creek bed
for (let i = 0; i < 70; i++) {
  const gx = R() * COLS, d = (R() * 2 - 1) * HALF * 0.9;
  p.ellipse(sq(gx), sq(creekY(gx) + d), 3 + R() * 5, 2 + R() * 3, R() * 3, [140, 140, 132], 0.8);
}

/* ---------------- the ruin and the rubble ---------------- */
const wallRuns = [[6, 18.55, 4, 0.35], [10.65, 18.55, 0.35, 3]];       // [x, y, w, h] in squares: a corner of an old stone wall
for (const [x, y, w, h] of wallRuns) {
  const pts = rectPts(sq(x + w / 2), sq(y + h / 2), sq(w), sq(h));
  p.poly(pts, [112, 108, 100]);
  p.poly(pts.map((q) => ({ x: q.x, y: q.y })), shade([112, 108, 100], 0.8), 0.0);
  level.solid(pts);
  for (let k = 0; k < Math.floor((w + h) * 3); k++) p.ellipse(sq(x + R() * w), sq(y + R() * h), 4, 3, R() * 3, [150, 146, 138], 0.7);
}
for (let i = 0; i < 90; i++) {                                          // loose stones on the ground
  const gx = RUBBLE.x + R() * RUBBLE.w, gy = RUBBLE.y + R() * RUBBLE.h;
  if (wallRuns.some(([x, y, w, h]) => inRect(gx, gy, { x, y, w, h }))) continue;
  const rx = 3 + R() * 9, ry = 2 + R() * 6, g = 118 + R() * 50;
  p.ellipse(sq(gx) + 3, sq(gy) + 3, rx, ry, R() * 3, [30, 30, 28], 0.35);
  p.ellipse(sq(gx), sq(gy), rx, ry, R() * 3, [g, g - 4, g - 12]);
  p.ellipse(sq(gx) - 1, sq(gy) - 1, rx * 0.6, ry * 0.5, R() * 3, [g + 26, g + 22, g + 12], 0.7);
}

/* ---------------- the thicket ---------------- */
for (let i = 0; i < 46; i++) {
  const gx = THICKET.x + R() * THICKET.w, gy = THICKET.y + R() * THICKET.h, r = 10 + R() * 14;
  p.disc(sq(gx) + 3, sq(gy) + 4, r, [20, 40, 20], 0.35);
  p.disc(sq(gx), sq(gy), r, [38 + R() * 26, 88 + R() * 34, 40 + R() * 20]);
  p.disc(sq(gx) - r * 0.25, sq(gy) - r * 0.3, r * 0.5, [86 + R() * 30, 140 + R() * 30, 70], 0.7);
}

/* ---------------- boulders (block sight and movement) ---------------- */
for (const b of BOULDERS) {
  const cx = sq(b.x), cy = sq(b.y), rx = sq(b.rx), ry = sq(b.ry);
  p.ellipse(cx + 8, cy + 9, rx * 1.05, ry * 1.05, 0, [20, 24, 18], 0.4);
  const pts = ngon(cx, cy, rx, ry, 9, 0.3);
  p.poly(pts, [124, 120, 112]);
  p.ellipse(cx - rx * 0.15, cy - ry * 0.2, rx * 0.7, ry * 0.65, 0.4, [156, 152, 142], 0.85);
  p.ellipse(cx - rx * 0.3, cy - ry * 0.35, rx * 0.3, ry * 0.25, 0.4, [186, 182, 170], 0.7);
  level.solid(pts);
}

/* ---------------- the small house (a cutaway: floor and furniture inside, walls block sight, a door in the south wall) ---------------- */
{
  const x0 = sq(HOUSE.x), y0 = sq(HOUSE.y), x1 = sq(HOUSE.x + HOUSE.w), y1 = sq(HOUSE.y + HOUSE.h);
  p.rect(x0 + 8 + 6, y0 + 9, x1 - x0 + 5, y1 - y0 + 6, [20, 40, 18]);                 // soft shadow on the grass
  for (let yy = y0; yy < y1; yy += 12) p.rect(x0, yy, x1 - x0, 12, shade([176, 128, 80], 0.9 + hash(Math.floor(yy / 12), 4, 9) * 0.2));   // plank floor
  for (let yy = y0; yy < y1; yy += 12) p.rect(x0, yy, x1 - x0, 1, [96, 66, 40], 0.7);
  // table with two stools, a bed and a chest
  p.rect(sq(HOUSE.x + 2.6), sq(HOUSE.y + 1.2), sq(1.5), sq(0.9), [120, 82, 48]);
  p.rect(sq(HOUSE.x + 2.6), sq(HOUSE.y + 1.2), sq(1.5), 3, [152, 110, 70]);
  p.disc(sq(HOUSE.x + 2.9), sq(HOUSE.y + 2.5), sq(0.22), [104, 70, 42]);
  p.disc(sq(HOUSE.x + 3.8), sq(HOUSE.y + 2.5), sq(0.22), [104, 70, 42]);
  p.rect(sq(HOUSE.x + 0.4), sq(HOUSE.y + 0.4), sq(1.1), sq(1.9), [168, 60, 56]);
  p.rect(sq(HOUSE.x + 0.4), sq(HOUSE.y + 0.4), sq(1.1), sq(0.45), [236, 226, 206]);
  p.rect(sq(HOUSE.x + 0.4), sq(HOUSE.y + 2.5), sq(0.9), sq(0.55), [92, 60, 34]);
  p.rect(sq(HOUSE.x + 0.4), sq(HOUSE.y + 2.5), sq(0.9), 3, [150, 110, 64]);
  // walls: thick timber and stone, with a gap for the door
  const T = 7, wallCol = [92, 72, 54];
  const run = (ax, ay, bx, by) => { p.capsule(ax, ay, bx, by, T, wallCol); p.capsule(ax, ay - 2, bx, by - 2, T * 0.45, [128, 104, 80], 0.8); level.wall([{ x: ax, y: ay }, { x: bx, y: by }]); };
  run(x0, y0, x1, y0);
  run(x0, y0, x0, sq(WINDOW[0])); run(x0, sq(WINDOW[1]), x0, y1);                          // west wall, with a window
  // the window: glass between the two wall pieces; it stops movement but not sight
  p.capsule(x0, sq(WINDOW[0]), x0, sq(WINDOW[1]), T * 0.9, [52, 40, 30]);
  p.capsule(x0, sq(WINDOW[0]), x0, sq(WINDOW[1]), T * 0.55, [150, 205, 235], 0.9);
  p.capsule(x0 - 3, (sq(WINDOW[0]) + sq(WINDOW[1])) / 2, x0 + 3, (sq(WINDOW[0]) + sq(WINDOW[1])) / 2, 1, [52, 40, 30]);
  extraWalls.push({ x1: x0, y1: sq(WINDOW[0]), x2: x0, y2: sq(WINDOW[1]), type: 'fence', open: false });
  run(x1, y0, x1, sq(HOUSE.back[0])); run(x1, sq(HOUSE.back[1]), x1, y1);                 // east wall, with a gap for the back door
  run(x0, y1, sq(HOUSE.door[0]), y1); run(sq(HOUSE.door[1]), y1, x1, y1);                 // south wall, with a gap for the front door
  level.light({ x: HOUSE.x + 2.2, y: HOUSE.y + 1.8, range: 5, intensity: 1, color: 'ffffc070', name: 'lantern' });          // a steady lantern: the house is dark without it
  p.disc(sq(HOUSE.x + 2.2), sq(HOUSE.y + 1.8), 6, [255, 214, 120], 0.85);
  // doors (shown closed: a house starts shut, so it is dark to sight until a door is opened)
  const drawDoor = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay), nx = (by - ay) / len, ny = -(bx - ax) / len;
    p.capsule(ax, ay, bx, by, T * 1.2, [74, 48, 26]);                                      // frame
    p.capsule(ax, ay, bx, by, T * 0.85, [172, 118, 64]);                                   // the door slab
    for (let k = 1; k < 4; k++) { const t = k / 4; p.capsule(ax + (bx - ax) * t - nx * 3, ay + (by - ay) * t - ny * 3, ax + (bx - ax) * t + nx * 3, ay + (by - ay) * t + ny * 3, 1, [112, 74, 38], 0.8); }   // plank seams
    p.disc(ax + (bx - ax) * 0.82, ay + (by - ay) * 0.82, 3.5, [244, 208, 112]);          // handle
    p.disc(ax, ay, T * 0.7, [60, 40, 24]); p.disc(bx, by, T * 0.7, [60, 40, 24]);         // door posts
    level.door(ax, ay, bx, by, true);
  };
  drawDoor(sq(HOUSE.door[0]), y1, sq(HOUSE.door[1]), y1);
  drawDoor(x1, sq(HOUSE.back[0]), x1, sq(HOUSE.back[1]));
}

/* ---------------- the campfire (flickers on the table like the camp's) ---------------- */
{
  const cx = sq(FIRE.x), cy = sq(FIRE.y);
  p.disc(cx, cy, sq(1.25), [48, 38, 32], 0.85);                                     // scorched ground
  for (let i = 0; i < 12; i++) {                                                    // stone ring
    const a = (i / 12) * Math.PI * 2 + 0.2, rr = sq(0.82);
    p.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, sq(0.24), sq(0.19), a, [118, 114, 108]);
    p.ellipse(cx + Math.cos(a) * rr - 2, cy + Math.sin(a) * rr - 2, sq(0.15), sq(0.1), a, [150, 146, 138], 0.7);
  }
  p.disc(cx, cy, sq(0.66), [30, 24, 22]);
  for (const a of [0.3, 1.9, 3.4, 5.0]) p.capsule(cx + Math.cos(a) * sq(0.5), cy + Math.sin(a) * sq(0.5), cx - Math.cos(a) * sq(0.5), cy - Math.sin(a) * sq(0.5), sq(0.11), [88, 56, 32]);
  p.disc(cx, cy, sq(0.46), [210, 70, 20], 0.9);
  p.disc(cx, cy, sq(0.32), [255, 150, 40], 0.95);
  p.disc(cx, cy, sq(0.17), [255, 226, 120]);
  const log = (lx, ly, len, rot) => {                                                // a log to sit on
    const dx = Math.cos(rot) * len / 2, dy = Math.sin(rot) * len / 2;
    p.capsule(lx - dx + 3, ly - dy + 4, lx + dx + 3, ly + dy + 4, sq(0.27), [0, 0, 0], 0.28);
    p.capsule(lx - dx, ly - dy, lx + dx, ly + dy, sq(0.26), [96, 62, 36]);
    p.capsule(lx - dx, ly - dy - 3, lx + dx, ly + dy - 3, sq(0.1), [128, 88, 54], 0.8);
    p.disc(lx + dx, ly + dy, sq(0.23), [158, 118, 78]); p.disc(lx - dx, ly - dy, sq(0.23), [150, 110, 72]);
  };
  log(sq(FIRE.x - 2.4), sq(FIRE.y + 0.2), sq(2.2), Math.PI / 2 + 0.12);
  log(sq(FIRE.x + 2.3), sq(FIRE.y - 0.2), sq(2.2), Math.PI / 2 - 0.1);
  level.light({ x: FIRE.x, y: FIRE.y, range: 9, intensity: 1, color: 'ffff9a3c', name: 'campfire', flicker: true });
}

/* ---------------- a fenced paddock (a fence stops movement, not sight) ---------------- */
{
  const fenceRun = (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.round(len / PPG));
    p.capsule(ax, ay + 4, bx, by + 4, 2, [20, 40, 18], 0.35);                              // shadow
    p.capsule(ax, ay - 2, bx, by - 2, 2.5, [150, 108, 66]);                                // top rail
    p.capsule(ax, ay + 3, bx, by + 3, 2.5, [136, 96, 58]);                                 // lower rail
    for (let i = 0; i <= steps; i++) { const x = ax + (bx - ax) * (i / steps), y = ay + (by - ay) * (i / steps); p.disc(x, y, 5, [96, 66, 38]); p.disc(x - 1, y - 1, 2.5, [150, 112, 70]); }
    extraWalls.push({ x1: Math.round(ax), y1: Math.round(ay), x2: Math.round(bx), y2: Math.round(by), type: 'fence', open: false });
  };
  const P = PADDOCK;
  fenceRun(sq(P.x1), sq(P.y1), sq(P.x2), sq(P.y1));
  fenceRun(sq(P.x1), sq(P.y1), sq(P.x1), sq(P.y2));
  fenceRun(sq(P.x2), sq(P.y1), sq(P.x2), sq(P.y2));
  fenceRun(sq(P.x1), sq(P.y2), sq(P.gate[0]), sq(P.y2));
  fenceRun(sq(P.gate[1]), sq(P.y2), sq(P.x2), sq(P.y2));
}

/* ---------------- a high cliff: a mesa whose face stops walkers (a movement-only wall) but not flyers ---------------- */
{
  const C = CLIFF, x0 = sq(C.x), y0 = sq(C.y), x1 = sq(C.x + C.w), y1 = sq(C.y + C.h), face = sq(0.7);
  p.rect(x0 + 10, y0 + 14, x1 - x0, y1 - y0, [16, 30, 16], 0.4);                                   // shadow it throws on the grass
  for (let yy = y0; yy < y1; yy += 6) p.rect(x0, yy, x1 - x0, 6, shade([112, 102, 92], 0.82 + hash(Math.floor(yy / 6), 7, 5) * 0.3));   // the rock face, in strata
  for (let xx = x0; xx < x1; xx += 7) p.rect(xx, y0, 7, y1 - y0, [60, 52, 46], 0.06 + hash(Math.floor(xx / 7), 3, 8) * 0.12);                // vertical weathering
  p.rect(x0 + face, y0 + face, x1 - x0 - 2 * face, y1 - y0 - face, [118, 140, 82]);                  // the grassy top
  for (let i = 0; i < 60; i++) {                                                                       // tufts and stones on the top
    const tx = x0 + face + R() * (x1 - x0 - 2 * face), ty = y0 + face + R() * (y1 - y0 - face);
    if (R() < 0.5) p.disc(tx, ty, 3 + R() * 4, [96 + R() * 30, 124 + R() * 30, 70], 0.55); else p.disc(tx, ty, 2 + R() * 3, [150, 146, 138], 0.8);
  }
  p.rect(x0 + face, y0 + face, x1 - x0 - 2 * face, 3, [190, 200, 150], 0.7);                          // the lit rim of the top
  p.rect(x0, y0, x1 - x0, 3, [150, 140, 128], 0.9);
  const run = (ax, ay, bx, by) => extraWalls.push({ x1: Math.round(ax), y1: Math.round(ay), x2: Math.round(bx), y2: Math.round(by), type: 'fence', open: false });
  run(x0, y0, x1, y0); run(x0, y0, x0, y1); run(x1, y0, x1, y1); run(x0, y1, x1, y1);                  // movement-only: a creature on foot cannot cross, a flyer can
}

/* ---------------- trees (trunks block sight and movement; the leaves do not) ---------------- */
for (const [tx, ty] of TREES) {
  const cx = sq(tx), cy = sq(ty), r = sq(1.15);
  p.disc(cx + 10, cy + 12, r, [16, 30, 16], 0.38);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + hash(tx, ty, 3) * 3, rr = r * (0.55 + hash(tx, ty, i) * 0.25);
    const g = 70 + hash(ty, tx, i) * 40;
    p.disc(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, rr * 0.7, [g * 0.55, g * 1.1, g * 0.5], 0.95);
  }
  p.disc(cx - r * 0.2, cy - r * 0.25, r * 0.5, [120, 170, 90], 0.35);
  const trunk = ngon(cx, cy, sq(0.26), sq(0.26), 8, 0.4);
  p.poly(trunk, [92, 66, 42]);
  p.disc(cx - 2, cy - 2, sq(0.12), [128, 96, 62], 0.8);
  level.solid(trunk);
}

/* ---------------- write the files ---------------- */
// Difficult terrain in image pixels. The creek is one square-wide strip per column, following the water.
const difficult = [];
for (let i = 0; i < COLS; i++) {
  const c = creekY(i + 0.5);
  const y1 = Math.floor(c - HALF + 0.5), y2 = Math.ceil(c + HALF - 0.5);
  difficult.push({ x: i * PPG, y: y1 * PPG, w: PPG, h: (y2 - y1) * PPG });
}
difficult.push({ x: RUBBLE.x * PPG, y: RUBBLE.y * PPG, w: RUBBLE.w * PPG, h: RUBBLE.h * PPG });
difficult.push({ x: THICKET.x * PPG, y: THICKET.y * PPG, w: THICKET.w * PPG, h: THICKET.h * PPG });
let starts = [{ name: 'start', x: 278, y: 479 }, { name: 'far-bank', x: 36 * PPG + 25, y: 21 * PPG + 25 }];
const cliffTop = { name: 'cliff-top', x: Math.round(sq(CLIFF.x + CLIFF.w / 2)), y: Math.round(sq(CLIFF.y + 2.2)), desc: 'The top of a high cliff, about 40 ft up. Only a flyer can get here: the face stops anyone on foot.' };
// Pins and terrain you have edited in Map Test win over these defaults when the map is drawn again.
try {
  const old = JSON.parse(await readFile(path.join(root, 'data', 'maps', 'vtt-terrain-test.png.json'), 'utf8'));
  if (Array.isArray(old.starts) && old.starts.length) starts = old.starts;
  if (Array.isArray(old.difficult) && old.difficult.length) { difficult.length = 0; difficult.push(...old.difficult); }
} catch { /* first time: the defaults */ }
if (!starts.some((s) => s.name === 'cliff-top')) starts.push(cliffTop);

await level.write(path.join(root, 'public', 'scenarios', 'terrain-test.dd2vtt'), { ambient: 'ffffffff' });
await writeFile(path.join(root, 'public', 'scenarios', 'terrain-test.config.json'), JSON.stringify({ squares: COLS, light: 'bright', ambience: 'forest', starts, difficult, extraWalls, lights: level.lights.map((l) => ({ x: l.x * PPG, y: l.y * PPG, range: l.range, intensity: l.intensity, color: l.color, name: l.name, ...(l.flicker ? { flicker: true } : {}) })) }, null, 2));
await level.writePng(path.join(root, 'public', 'scenarios', '.preview-terrain.png'));
console.log(`terrain-test.dd2vtt: ${COLS}x${ROWS} squares, ${level.walls.length} sight lines, ${difficult.length} difficult-terrain rectangles`);
