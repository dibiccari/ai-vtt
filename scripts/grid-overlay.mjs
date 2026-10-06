// Draws a crop of a map picture with its grid cells numbered, so the assistant can read rooms in grid-cell units (column,row).
// Usage: node scripts/grid-overlay.mjs <picture> <c0,r0,c1,r1> <scale> <out.png> [--layout <layout.json>] [--rooms] [--walls <map config.json>] [--every N]
//   picture   the picture (the layout's inkPicture is best: full size); the grid (cell, origin) comes from --layout (default: the layout of the same name in data/map-layouts, else find-grid is run)
//   c0,r0,c1,r1  the cell range to draw (cells are counted from the first grid line of the layout origin; they may be negative or run past the picture)
//   scale     output pixels per picture pixel (0.5 .. 2); about 1 gives a crop of 20 x 12 cells in 1600 x 1000
//   --rooms   also draws the layout's rooms (blue), openings (green), doors (yellow) and secret doors (magenta) in cell units
//   --walls   also draws the walls of a map config (data/maps/<picture>.json): red walls, yellow doors, cyan bars
//   --every N label every Nth line (default 1; the numbers inside cells are drawn when a cell is big enough)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
import { detectGrid, ROOT } from '../lib/gridprint.js';
import { makeCrop } from '../lib/overlay.js';
import { drawText, textWidth } from '../lib/pixfont.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const valueOpts = new Set(['--layout', '--walls', '--every']);
const pos = args.filter((a, i) => !a.startsWith('--') && !valueOpts.has(args[i - 1]));
if (pos.length < 4) { console.error('usage: node scripts/grid-overlay.mjs <picture> <c0,r0,c1,r1> <scale> <out.png> [--layout file] [--rooms] [--walls config.json] [--every N]'); process.exit(1); }
const [pictureArg, rangeArg, scaleArg, outArg] = pos;
const pic = await readPicture(path.resolve(pictureArg));
let layout = null;
if (opt('layout')) layout = JSON.parse(await readFile(path.resolve(opt('layout')), 'utf8'));
const grid = layout && layout.cell ? { cell: layout.cell, origin: layout.origin || [0, 0] } : detectGrid(pic);
const C = grid.cell, [ox, oy] = grid.origin;
const [c0, r0, c1, r1] = rangeArg.split(',').map(Number);
const S = Number(scaleArg), every = Number(opt('every', 1));
const cr = makeCrop(pic, { cell: C, origin: [ox, oy] }, [c0, r0, c1, r1], S);
const { out, W, H, toX, toY, line, X0, Y0 } = cr;
// grid lines: every cell thin, every fifth stronger
for (let c = Math.ceil(c0); c <= c1; c++) line(toX(c), 0, toX(c), H - 1, c % 5 === 0 ? [255, 0, 80] : [0, 120, 255], c % 5 === 0 ? 0.75 : 0.45);
for (let r = Math.ceil(r0); r <= r1; r++) line(0, toY(r), W - 1, toY(r), r % 5 === 0 ? [255, 0, 80] : [0, 120, 255], r % 5 === 0 ? 0.75 : 0.45);
const cellPx = C * S, ts = cellPx >= 60 ? 2 : 1;
for (let c = Math.ceil(c0); c < c1; c++) for (let r = Math.ceil(r0); r < r1; r++) {
  if (cellPx >= 50) drawText(out, W, H, c + ',' + r, Math.round(toX(c)) + 3, Math.round(toY(r)) + 3, ts, [255, 255, 0]);
}
for (let c = Math.ceil(c0); c <= c1; c += every) { const label = String(c), x = Math.round(toX(c)) - Math.floor(textWidth(label, 2) / 2); drawText(out, W, H, label, x, 14, 2, [255, 255, 255], [200, 0, 60]); drawText(out, W, H, label, x, H - 24, 2, [255, 255, 255], [200, 0, 60]); }
for (let r = Math.ceil(r0); r <= r1; r += every) { const label = String(r), y = Math.round(toY(r)) - 5; drawText(out, W, H, label, 3, y, 2, [255, 255, 255], [200, 0, 60]); drawText(out, W, H, label, W - textWidth(label, 2) - 3, y, 2, [255, 255, 255], [200, 0, 60]); }
const rect = (x0, y0, x1, y1, col, thick = 2) => { const a = [toX(x0), toY(y0), toX(x1), toY(y1)]; line(a[0], a[1], a[2], a[1], col, 1, thick); line(a[2], a[1], a[2], a[3], col, 1, thick); line(a[2], a[3], a[0], a[3], col, 1, thick); line(a[0], a[3], a[0], a[1], col, 1, thick); };
if (flag('rooms') && layout) {
  for (const [name, r] of Object.entries(layout.rooms || {})) { rect(r[0], r[1], r[2], r[3], [0, 60, 255]); drawText(out, W, H, name, Math.round(toX(r[0])) + 6, Math.round(toY(r[1])) + 22, 2, [160, 220, 255], [0, 0, 80]); }
  for (const r of layout.openings || []) rect(r[0], r[1], r[2], r[3], [0, 200, 60]);
  const span = (d, col, t) => (d.h !== undefined ? line(toX(d.from), toY(d.h), toX(d.to), toY(d.h), col, 1, t) : line(toX(d.v), toY(d.from), toX(d.v), toY(d.to), col, 1, t));
  for (const d of [...(layout.detectedDoors || []), ...(layout.doors || [])]) span(d, [255, 220, 0], 4);
  for (const d of layout.secrets || []) span(d, [255, 0, 255], 4);
  for (const d of layout.fences || []) span(d, [0, 230, 230], 3);
}
if (opt('walls')) {
  const cfg = JSON.parse(await readFile(path.resolve(opt('walls')), 'utf8'));
  for (const w of cfg.walls || []) {
    const col = w.type === 'door' ? [255, 220, 0] : w.type === 'fence' ? [0, 230, 230] : [255, 30, 30];
    line((w.x1 - X0) * S, (w.y1 - Y0) * S, (w.x2 - X0) * S, (w.y2 - Y0) * S, col, 1, w.type === 'door' ? 4 : 2);
  }
}
await writeFile(path.resolve(outArg), encodePng(out, W, H));
console.log(`${path.relative(ROOT, path.resolve(outArg))}: ${W}x${H}, cells ${c0},${r0} to ${c1},${r1}, cell ${C} px at scale ${S}`);
