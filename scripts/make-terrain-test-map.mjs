// Draws "Terrain Test Grounds", a small outdoor map for trying out fog of war, line of sight and difficult terrain, and writes it as a
// Universal VTT file plus a sidecar with its difficult terrain and start pins.
//   node scripts/make-terrain-test-map.mjs     writes public/scenarios/terrain-test.dd2vtt and terrain-test.config.json (40 x 30 squares, 50 px)
// Then: node scripts/import-dd2vtt.mjs public/scenarios/terrain-test.dd2vtt terrain-test
//       node scripts/apply-map-sidecar.mjs public/scenarios/terrain-test.config.json terrain-test.png
// What is on it: trees (the trunks block sight and movement), two boulders (block both), a creek you can wade (difficult terrain), a field
// of rubble with a ruined wall (difficult terrain, the wall blocks sight), a thicket of undergrowth (difficult terrain, does not block sight).

import { writeFile } from 'node:fs/promises';
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
const TREES = [[5, 4], [9, 7], [14, 5], [22, 3], [27, 8], [33, 5], [36, 10], [3, 24], [12, 26], [19, 22], [26, 26], [33, 22], [37, 26], [17, 9]];
const BOULDERS = [{ x: 28, y: 21, rx: 1.1, ry: 0.85 }, { x: 11, y: 10.5, rx: 0.7, ry: 0.55 }];
const inRect = (gx, gy, r, pad = 0) => gx >= r.x - pad && gx <= r.x + r.w + pad && gy >= r.y - pad && gy <= r.y + r.h + pad;

/* ---------------- ground: grass, creek, banks, rubble field ---------------- */
p.fillWith((x, y) => {
  const gx = x / PPG, gy = y / PPG;
  const n = fbm(gx * 1.7, gy * 1.7, 5), n2 = fbm(gx * 6, gy * 6, 11);
  let col = [64 + n * 46 + n2 * 10, 104 + n * 52 + n2 * 12, 52 + n * 30];                     // grass
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
const starts = [{ name: 'start', x: 3 * PPG + 25, y: 7 * PPG + 25 }, { name: 'far-bank', x: 36 * PPG + 25, y: 21 * PPG + 25 }];

await level.write(path.join(root, 'public', 'scenarios', 'terrain-test.dd2vtt'), { ambient: 'ffffffff' });
await writeFile(path.join(root, 'public', 'scenarios', 'terrain-test.config.json'), JSON.stringify({ squares: COLS, light: 'bright', ambience: 'forest', starts, difficult }, null, 2));
await level.writePng(path.join(root, 'public', 'scenarios', '.preview-terrain.png'));
console.log(`terrain-test.dd2vtt: ${COLS}x${ROWS} squares, ${level.walls.length} sight lines, ${difficult.length} difficult-terrain rectangles`);
