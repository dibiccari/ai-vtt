// A crop of a map picture with a pixel ruler (a line every 50 px, numbered every 100) so positions can be read off it, optionally with a map config's walls (red), doors (green) and lights (cyan) drawn on top.
// Usage: node scripts/pixel-grid.mjs <picture path> <x0,y0,x1,y1> <scale> <out.png> [--config data/maps/<picture>.json]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
import { drawText, textWidth } from '../lib/pixfont.js';

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--config');
const [pic, rangeArg, scaleArg, outArg] = pos;
if (!outArg) { console.error('usage: node scripts/pixel-grid.mjs <picture> <x0,y0,x1,y1> <scale> <out.png> [--config file.json]'); process.exit(1); }
const cfgPath = args.includes('--config') ? args[args.indexOf('--config') + 1] : '';
const cfg = cfgPath ? JSON.parse(await readFile(cfgPath, 'utf8')) : null;
const img = await readPicture(path.resolve(pic));
const [x0, y0, x1, y1] = rangeArg.split(',').map(Number), S = Number(scaleArg) || 1;
const W = Math.round((x1 - x0) * S), H = Math.round((y1 - y0) * S), out = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(img.w - 1, Math.round(x0 + x / S)), sy = Math.min(img.h - 1, Math.round(y0 + y / S)), i = sy * img.w + sx, o = (y * W + x) * 4; out[o] = img.rgb[i * 3]; out[o + 1] = img.rgb[i * 3 + 1]; out[o + 2] = img.rgb[i * 3 + 2]; out[o + 3] = 255; }
const blend = (x, y, c, a) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; for (let k = 0; k < 3; k++) out[o + k] = Math.round(out[o + k] * (1 - a) + c[k] * a); };
const line = (xa, ya, xb, yb, c, a, th = 1) => { const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya))); for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n, y = ya + (yb - ya) * i / n; for (let d = 0; d < th; d++) blend(Math.round(x) + d, Math.round(y), c, a); } };
const px = (x) => (x - x0) * S, py = (y) => (y - y0) * S;
for (let x = Math.ceil(x0 / 50) * 50; x <= x1; x += 50) { line(px(x), 0, px(x), H, x % 100 === 0 ? [255, 255, 0] : [255, 255, 255], x % 100 === 0 ? 0.55 : 0.22); if (x % 100 === 0) drawText(out, W, H, String(x), Math.round(px(x)) + 2, 3, 2, [255, 255, 0], [0, 0, 0]); }
for (let y = Math.ceil(y0 / 50) * 50; y <= y1; y += 50) { line(0, py(y), W, py(y), y % 100 === 0 ? [255, 255, 0] : [255, 255, 255], y % 100 === 0 ? 0.55 : 0.22); if (y % 100 === 0) drawText(out, W, H, String(y), 3, Math.round(py(y)) + 2, 2, [255, 255, 0], [0, 0, 0]); }
if (cfg) {
  const f = cfg.squares && img.w ? 1 : 1;
  for (const w of cfg.walls || []) line(px(w.x1 * f), py(w.y1 * f), px(w.x2 * f), py(w.y2 * f), w.type === 'door' ? [60, 255, 120] : w.type === 'fence' ? [80, 200, 255] : [255, 60, 60], 0.95, 2);
  for (const l of cfg.lights || []) { for (let a = 0; a < 6.3; a += 0.2) blend(Math.round(px(l.x) + Math.cos(a) * 6), Math.round(py(l.y) + Math.sin(a) * 6), [0, 255, 255], 1); }
}
await writeFile(path.resolve(outArg), encodePng(out, W, H));
console.log(`${outArg}: ${W}x${H}`);
