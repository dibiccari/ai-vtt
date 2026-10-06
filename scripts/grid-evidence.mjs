// Shows where grid line pieces are really printed on a map picture (walkable ground has them, rock and chasms do not), and what the wall builder takes as floor.
// Usage: node scripts/grid-evidence.mjs <layout.json> <c0,r0,c1,r1> <scale> <out.png> [--min 30]
//   green pieces = printed grid line pieces found (a quarter square long); the cell grid is drawn faintly
//   --ink    with --mask: also marks the cells taken as thick outline (red)
//   --mask   also tints what the wall builder's cave mask takes as floor (needs "caveMasks" in the layout; runs the same code as build-walls-from-layout.mjs)
// Use it to see where the printed grid is faint: a gap in the green pieces inside a cave is a gap the outline may leak through.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from '../lib/mapkit.js';
import { makeEvidence, loadLayoutPicture, ROOT } from '../lib/gridprint.js';
import { makeCrop } from '../lib/overlay.js';
import { caveFloorMask } from '../lib/cavemask.js';
import { drawText, textWidth } from '../lib/pixfont.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !['--min'].includes(args[i - 1]));
if (pos.length < 4) { console.error('usage: node scripts/grid-evidence.mjs <layout.json> <c0,r0,c1,r1> <scale> <out.png> [--min 30] [--mask]'); process.exit(1); }
const layout = JSON.parse(await readFile(path.resolve(pos[0]), 'utf8'));
const range = pos[1].split(',').map(Number), S = Number(pos[2]);
const pic = await loadLayoutPicture(layout);
const min = Number(opt('min', 30)), Q = 4;
const ev = makeEvidence(pic, layout, Q);
const cr = makeCrop(pic, { cell: layout.cell, origin: layout.origin || [0, 0] }, range, S);
const { out, W, H, toX, toY, line } = cr;
if (args.includes('--mask')) {
  for (const [name, cm] of Object.entries(layout.caveMasks || {})) {
    const { mask, res, isInk } = caveFloorMask(pic, layout, cm);
    if (args.includes('--ink')) for (let j = Math.floor(range[1] * res); j < Math.ceil(range[3] * res); j++) for (let i = Math.floor(range[0] * res); i < Math.ceil(range[2] * res); i++) if (isInk(i, j)) cr.fillRect(toX(i / res), toY(j / res), toX((i + 1) / res), toY((j + 1) / res), [255, 0, 0], 0.55);
    for (const k of mask) { const [i, j] = k.split(',').map(Number); cr.fillRect(toX(i / res), toY(j / res), toX((i + 1) / res), toY((j + 1) / res), [255, 160, 0], 0.3); }
  }
}
for (let c = Math.ceil(range[0]); c <= range[2]; c++) line(toX(c), 0, toX(c), H - 1, [0, 120, 255], 0.25);
for (let r = Math.ceil(range[1]); r <= range[3]; r++) line(0, toY(r), W - 1, toY(r), [0, 120, 255], 0.25);
let found = 0, total = 0;
for (let k = Math.ceil(range[1]); k <= range[3]; k++) for (let q = Math.floor(range[0] * Q); q < Math.ceil(range[2] * Q); q++) {
  total++; if (ev(true, k, q) >= min) { found++; line(toX(q / Q) + 2, toY(k), toX((q + 1) / Q) - 2, toY(k), [0, 255, 0], 1, 3); }
}
for (let k = Math.ceil(range[0]); k <= range[2]; k++) for (let q = Math.floor(range[1] * Q); q < Math.ceil(range[3] * Q); q++) {
  total++; if (ev(false, k, q) >= min) { found++; line(toX(k), toY(q / Q) + 2, toX(k), toY((q + 1) / Q) - 2, [0, 255, 0], 1, 3); }
}
const step = range[2] - range[0] <= 17 ? 1 : 2;
for (let c = Math.ceil(range[0]); c <= range[2]; c += step) drawText(out, W, H, String(c), Math.round(toX(c)) - 6, 12, 2, [255, 255, 255], [200, 0, 60]);
for (let r = Math.ceil(range[1]); r <= range[3]; r += step) drawText(out, W, H, String(r), 3, Math.round(toY(r)) - 5, 2, [255, 255, 255], [200, 0, 60]);
await writeFile(path.resolve(pos[3]), encodePng(out, W, H));
console.log(`${path.relative(ROOT, path.resolve(pos[3]))}: ${found} of ${total} grid line pieces printed (threshold ${min})`);
