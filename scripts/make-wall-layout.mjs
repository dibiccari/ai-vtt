// Draws a plain line-drawing LAYOUT of a map from its saved walls, doors and pins (data/mapsets): the floor reachable from the pins is light, everything else is rock, walls are dark bands, doors brown
// gaps, pins small dots. It never reads the map's picture, only its size. The drawing is what ChatGPT repaints (Method B: scripts/openai-repaint.mjs) so the painted map keeps the exact layout and the
// original walls and pins stay valid on it.
// Usage: node scripts/make-wall-layout.mjs --picture <file in public/uploads> --out <layout.png> [--width 1536 | --canvas 1536x1024] [--seeds start,area-1,...] [--pins]
//                                          [--floor r,g,b] [--rock r,g,b] [--wall r,g,b]
//   --canvas  a canvas of exactly this size (the image editor only returns 1536x1024, 1024x1536 or 1024x1024); the map is scaled to fit and centred. <out>.json records {scale, x, y, w, h, canvas}: the map's
//             rectangle on the canvas, which scripts/crop-region.mjs cuts back out of the repainted result.
//   --seeds   pin names to flood the floor from (default: every pin)     --pins  draw the pins as dots
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../lib/mapkit.js';
import { readPicture } from '../lib/bmpread.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const picture = opt('picture'), out = opt('out');
if (!picture || !out) { console.error('usage: node scripts/make-wall-layout.mjs --picture <file> --out <layout.png> [--width 1536 | --canvas 1536x1024] [--seeds a,b] [--pins] [--floor r,g,b] [--rock r,g,b]'); process.exit(1); }
let set = null;
for (const f of await readdir(path.join(root, 'data', 'mapsets'))) {
  const d = JSON.parse(await readFile(path.join(root, 'data', 'mapsets', f), 'utf8'));
  if (d.levels.some((lv) => lv.looks.some((l) => l.player === picture))) { set = d; break; }
}
if (!set) { console.error('no map set holds ' + picture); process.exit(1); }
const level = set.levels.find((lv) => lv.looks.some((l) => l.player === picture));
const src = await readPicture(path.join(root, 'public', 'uploads', picture)).then((p) => ({ w: p.w, h: p.h }));      // only the size of the picture is used
let W, H, k, ox = 0, oy = 0;
if (opt('canvas')) { [W, H] = opt('canvas').split('x').map(Number); k = Math.min(W / src.w, H / src.h); ox = Math.round((W - src.w * k) / 2); oy = Math.round((H - src.h * k) / 2); }
else { W = Number(opt('width', 1536)); k = W / src.w; H = Math.round(src.h * k); }
const X = (v) => v * k + ox, Y = (v) => v * k + oy;
const rgb = (v, d) => (v ? v.split(',').map(Number) : d);
const FLOOR = rgb(opt('floor'), [196, 178, 140]), ROCK = rgb(opt('rock'), [10, 10, 12]), WALL = rgb(opt('wall'), [70, 66, 62]), DOOR = [140, 96, 52];
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { img[i * 4] = ROCK[0]; img[i * 4 + 1] = ROCK[1]; img[i * 4 + 2] = ROCK[2]; img[i * 4 + 3] = 255; }
// 1. rasterise the walls as a blocking mask (a little thick so the flood cannot slip between pieces)
const block = new Uint8Array(W * H);
const stamp = (x, y, r, val) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= r * r + 0.5) block[yy * W + xx] = val; } };
const line = (x1, y1, x2, y2, r, fn) => { const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1))); for (let i = 0; i <= n; i++) fn(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, r); };
for (const w of level.walls) if (w.type !== 'door' && w.type !== 'fence') line(X(w.x1), Y(w.y1), X(w.x2), Y(w.y2), 2, (x, y, r) => stamp(x, y, r, 1));
for (const w of level.walls) if (w.type === 'door' && !w.secret) line(X(w.x1), Y(w.y1), X(w.x2), Y(w.y2), 2, (x, y, r) => stamp(x, y, r, 0));
// 2. flood the floor from the pins
const want = (opt('seeds', '') || '').split(',').filter(Boolean);
const seeds = level.starts.filter((s) => !want.length || want.includes(s.name));
const floor = new Uint8Array(W * H);
const stack = [];
for (const s of seeds) { const x = Math.round(X(s.x)), y = Math.round(Y(s.y)); if (x >= 0 && y >= 0 && x < W && y < H && !block[y * W + x]) stack.push(y * W + x); }
while (stack.length) {
  const i = stack.pop();
  if (floor[i] || block[i]) continue;
  floor[i] = 1;
  const x = i % W, y = (i / W) | 0;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}
let floorPx = 0; for (let i = 0; i < W * H; i++) if (floor[i]) floorPx++;
const leaked = floorPx / (src.w * k * src.h * k) > 0.6;
// 3. paint: floor, then walls and doors on top
const paint = (i, c) => { img[i * 4] = c[0]; img[i * 4 + 1] = c[1]; img[i * 4 + 2] = c[2]; };
for (let i = 0; i < W * H; i++) if (floor[i]) paint(i, FLOOR);
const draw = (x, y, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= r * r + 0.5) paint(yy * W + xx, c); } };
for (const w of level.walls) {
  if (w.type === 'fence') line(X(w.x1), Y(w.y1), X(w.x2), Y(w.y2), 1, (x, y, r) => draw(x, y, r, [120, 90, 56]));
  else if (w.type !== 'door') line(X(w.x1), Y(w.y1), X(w.x2), Y(w.y2), 3, (x, y, r) => draw(x, y, r, WALL));
}
for (const w of level.walls) if (w.type === 'door') line(X(w.x1), Y(w.y1), X(w.x2), Y(w.y2), 3, (x, y, r) => draw(x, y, r, DOOR));
if (args.includes('--pins')) for (const s of level.starts) draw(X(s.x), Y(s.y), 5, [200, 40, 40]);
await writeFile(path.resolve(out), encodePng(img, W, H));
await writeFile(path.resolve(out) + '.json', JSON.stringify({ scale: k, x: ox, y: oy, w: Math.round(src.w * k), h: Math.round(src.h * k), canvas: [W, H], picture: [src.w, src.h] }));
console.log(`${picture}: canvas ${W} x ${H}, map ${Math.round(src.w * k)} x ${Math.round(src.h * k)} at ${ox},${oy}, ${level.walls.length} walls${leaked ? ' (the flood leaked: the walls do not close the rooms)' : ''} -> ${out}`);
