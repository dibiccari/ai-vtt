// Traces the walls of a painted map by finding where the floor ends: every pixel brighter than --lum (luminance 0-255) counts as floor, the rest as rock, and the outline of each floor
// area becomes wall segments (simplified so a straight wall is one piece). Meant for maps painted as light floor inside near-black rock (caves, dungeons, ruins). It is a first pass: look at
// the result with scripts/pixel-grid.mjs ... --config and fix it in Map Test with the Walls tool.
// --green    grass and leaves (green-dominant pixels brighter than --green-lum, default 55) count as floor too, for a meadow beside a cave
// Usage: node scripts/trace-floor.mjs --in <picture> --out <walls.json> --lum 60 [--cell 6] [--eps 3.5] [--min-area 900] [--hole-area 600] [--blur 1] [--invert] [--clip x0,y0,x1,y1]
//   --cell     size in pixels of one mask cell (default 6)      --eps    how far a simplified wall may stray from the outline, in pixels (default 3.5)
//   --min-area floor areas smaller than this many square pixels are ignored (specks)    --hole-area  rock islands (pillars) smaller than this are ignored
//   --invert   treat the BRIGHT pixels as rock (a dark floor in light rock)    --clip  only trace inside this rectangle (pixels)
// Writes {walls:[{x1,y1,x2,y2,type:'wall',open:false}], stats}. Run it on a picture of any size: coordinates are in picture pixels.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const input = opt('in'), out = opt('out');
if (!input || !out) { console.error('usage: node scripts/trace-floor.mjs --in <picture> --out <walls.json> --lum 60 [--cell 6] [--eps 3.5] [--min-area 900] [--hole-area 600] [--invert] [--clip x0,y0,x1,y1]'); process.exit(1); }
const LUM = Number(opt('lum', 60)), CELL = Number(opt('cell', 6)), EPS = Number(opt('eps', 3.5));
const GREEN = args.includes('--green'), GREEN_LUM = Number(opt('green-lum', 55));
const MIN_AREA = Number(opt('min-area', 900)), HOLE_AREA = Number(opt('hole-area', 600)), BLUR = Number(opt('blur', 1)), INVERT = args.includes('--invert');
const img = await readPicture(path.resolve(input));
const clip = opt('clip', '') ? opt('clip', '').split(',').map(Number) : [0, 0, img.w, img.h];
const cw = Math.ceil(img.w / CELL), ch = Math.ceil(img.h / CELL);

// 1. the mask: the average luminance of each cell against the threshold
let mask = new Uint8Array(cw * ch);
for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
  let sum = 0, n = 0, R = 0, G = 0, B = 0;
  for (let y = cy * CELL; y < Math.min(img.h, (cy + 1) * CELL); y++) for (let x = cx * CELL; x < Math.min(img.w, (cx + 1) * CELL); x++) { const i = y * img.w + x; sum += img.lum[i]; R += img.rgb[i * 3]; G += img.rgb[i * 3 + 1]; B += img.rgb[i * 3 + 2]; n++; }
  const green = GREEN && G / n > R / n + 8 && G / n > B / n + 15 && sum / n > GREEN_LUM;
  const px = cx * CELL + CELL / 2, py = cy * CELL + CELL / 2;
  const inside = px >= clip[0] && px <= clip[2] && py >= clip[1] && py <= clip[3];
  mask[cy * cw + cx] = inside && (green || (INVERT ? sum / n < LUM : sum / n > LUM)) ? 1 : 0;
}
// 2. smooth: a cell becomes floor when most of its neighbours are (repeated BLUR times), which drops single-cell noise
for (let pass = 0; pass < BLUR; pass++) {
  const next = new Uint8Array(mask);
  for (let cy = 1; cy < ch - 1; cy++) for (let cx = 1; cx < cw - 1; cx++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += mask[(cy + dy) * cw + cx + dx];
    next[cy * cw + cx] = s >= 5 ? 1 : 0;
  }
  mask = next;
}
// 3. outline edges: between a floor cell and a rock cell (or the map edge) there is a unit edge, directed so the floor is on its left
const key = (x, y) => y * (cw + 1) + x;
const nexts = new Map();       // start vertex -> list of end vertices
const add = (x1, y1, x2, y2) => { const k = key(x1, y1); if (!nexts.has(k)) nexts.set(k, []); nexts.get(k).push([x2, y2]); };
const at = (x, y) => (x < 0 || y < 0 || x >= cw || y >= ch ? 0 : mask[y * cw + x]);
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
  if (!at(x, y)) continue;
  if (!at(x, y - 1)) add(x, y, x + 1, y);          // top edge, going right
  if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);  // right edge, going down
  if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);  // bottom edge, going left
  if (!at(x - 1, y)) add(x, y + 1, x, y);          // left edge, going up
}
// 4. chain the edges into closed loops
const loops = [];
while (nexts.size) {
  const [k0, list0] = nexts.entries().next().value;
  const sx = k0 % (cw + 1), sy = Math.floor(k0 / (cw + 1));
  const loop = [[sx, sy]];
  let [cx, cy] = [sx, sy], prevDir = null;
  for (let guard = 0; guard < 4_000_000; guard++) {
    const k = key(cx, cy), list = nexts.get(k);
    if (!list || !list.length) break;
    // at a vertex with two ways on, turn to keep the floor on the left (prefer a right turn: it keeps blobs apart)
    let pick = 0;
    if (list.length > 1 && prevDir) {
      const score = (e) => { const d = [e[0] - cx, e[1] - cy]; return prevDir[0] * d[1] - prevDir[1] * d[0]; };       // cross product: > 0 is a turn to the right in screen coordinates
      pick = list.map(score).reduce((best, s, i, a) => (s > a[best] ? i : best), 0);
    }
    const e = list.splice(pick, 1)[0];
    if (!list.length) nexts.delete(k);
    prevDir = [e[0] - cx, e[1] - cy];
    [cx, cy] = e;
    if (cx === sx && cy === sy) break;
    loop.push([cx, cy]);
  }
  loops.push(loop);
}
// 5. keep real outlines, simplify them (Ramer-Douglas-Peucker, closed) and turn them into segments
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = -1, wi = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len; if (d > worst) { worst = d; wi = i; } }
  if (worst <= eps) return [a, b];
  return [...rdp(pts.slice(0, wi + 1), eps).slice(0, -1), ...rdp(pts.slice(wi), eps)];
}
const walls = [];
let kept = 0, dropped = 0;
for (const loop of loops) {
  const px = loop.map(([x, y]) => [x * CELL, y * CELL]);
  const a = area(px);                                   // > 0: an outer outline of floor; < 0: a rock island inside floor
  if (Math.abs(a) < (a > 0 ? MIN_AREA : HOLE_AREA)) { dropped++; continue; }
  // split at the farthest-apart pair so the simplification works on two open halves
  let far = 0, fi = 0; for (let i = 1; i < px.length; i++) { const d = Math.hypot(px[i][0] - px[0][0], px[i][1] - px[0][1]); if (d > far) { far = d; fi = i; } }
  const half1 = px.slice(0, fi + 1), half2 = [...px.slice(fi), px[0]];
  const simp = [...rdp(half1, EPS).slice(0, -1), ...rdp(half2, EPS).slice(0, -1)];
  for (let i = 0; i < simp.length; i++) {
    const p = simp[i], q = simp[(i + 1) % simp.length];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1) continue;
    const onEdge = (v, lim) => v <= 1 || v >= lim - 1;
    if ((onEdge(p[0], img.w) && onEdge(q[0], img.w) && p[0] === q[0]) || (onEdge(p[1], img.h) && onEdge(q[1], img.h) && p[1] === q[1])) continue;   // the picture's own border is not a wall
    walls.push({ x1: Math.round(p[0] * 10) / 10, y1: Math.round(p[1] * 10) / 10, x2: Math.round(q[0] * 10) / 10, y2: Math.round(q[1] * 10) / 10, type: 'wall', open: false });
  }
  kept++;
}
await writeFile(path.resolve(out), JSON.stringify({ walls, stats: { picture: [img.w, img.h], loopsKept: kept, loopsDropped: dropped, segments: walls.length } }));
console.log(`${path.basename(input)}: ${kept} outlines (${dropped} specks dropped), ${walls.length} wall segments -> ${out}`);
