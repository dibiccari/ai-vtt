// Image tricks for reading a map picture: grayscale, contrast stretch, shadow lift (gamma), the dark "ink" mask (what the wall builder treats as outline), edges, the redness
// channel (secret-door S, room numbers) and the white mask (doors). Write a PNG you can look at, whole or a crop of grid cells.
// Usage: node scripts/enhance.mjs <picture> <mode> <out.png> [--crop c0,r0,c1,r1 --cell 82.5 --origin 1,-5] [--scale 0.5] [--dark 80] [--gamma 0.6]
//   modes: gray | stretch (histogram stretch of the 2nd-98th percentile) | lift (gamma, opens up shadows) | ink (pixels darker than --dark in red on gray) | edges (Sobel) | red | white
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const [file, mode, out] = args;
if (!file || !mode || !out) { console.error('usage: node scripts/enhance.mjs <picture> <gray|stretch|lift|ink|edges|red|white> <out.png> [--crop c0,r0,c1,r1] [--cell 82.5] [--origin 1,-5] [--scale 0.5] [--dark 80] [--gamma 0.6]'); process.exit(1); }
const pic = await readPicture(path.resolve(file));
const cell = Number(opt('cell', 82.5)), [ox, oy] = opt('origin', '1,-5').split(',').map(Number), S = Number(opt('scale', 0.5));
let [x0, y0, x1, y1] = [0, 0, pic.w, pic.h];
if (opt('crop', '')) { const [a, b, c, d] = opt('crop', '').split(',').map(Number); x0 = Math.max(0, Math.round(ox + a * cell)); y0 = Math.max(0, Math.round(oy + b * cell)); x1 = Math.min(pic.w, Math.round(ox + c * cell)); y1 = Math.min(pic.h, Math.round(oy + d * cell)); }
const sorted = Float32Array.from(pic.lum).sort();
const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
const W = Math.round((x1 - x0) * S), H = Math.round((y1 - y0) * S), img = new Uint8Array(W * H * 4);
const dark = Number(opt('dark', 80)), gamma = Number(opt('gamma', 0.6));
const L = (x, y) => pic.lum[Math.max(0, Math.min(pic.h - 1, y)) * pic.w + Math.max(0, Math.min(pic.w - 1, x))];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = x0 + Math.round(x / S), sy = y0 + Math.round(y / S), p = sy * pic.w + sx, v = pic.lum[p], k = (y * W + x) * 4;
  let r = v, g = v, b = v;
  if (mode === 'stretch') r = g = b = Math.max(0, Math.min(255, (v - lo) / (hi - lo) * 255));
  else if (mode === 'lift') r = g = b = 255 * Math.pow(v / 255, gamma);
  else if (mode === 'ink') { if (v < dark) { r = 255; g = 40; b = 40; } else { r = g = b = 90 + v * 0.5; } }
  else if (mode === 'edges') { const gx = L(sx + 1, sy - 1) + 2 * L(sx + 1, sy) + L(sx + 1, sy + 1) - L(sx - 1, sy - 1) - 2 * L(sx - 1, sy) - L(sx - 1, sy + 1), gy = L(sx - 1, sy + 1) + 2 * L(sx, sy + 1) + L(sx + 1, sy + 1) - L(sx - 1, sy - 1) - 2 * L(sx, sy - 1) - L(sx + 1, sy - 1); r = g = b = Math.min(255, Math.hypot(gx, gy) / 3); }
  else if (mode === 'red') { r = g = b = Math.max(0, pic.rgb[p * 3] - Math.max(pic.rgb[p * 3 + 1], pic.rgb[p * 3 + 2])) * 2; }
  else if (mode === 'white') { const max = Math.max(pic.rgb[p * 3], pic.rgb[p * 3 + 1], pic.rgb[p * 3 + 2]), min = Math.min(pic.rgb[p * 3], pic.rgb[p * 3 + 1], pic.rgb[p * 3 + 2]); if (v > 215 && max - min < 28) { r = 255; g = 255; b = 0; } else { r = g = b = v * 0.5; } }
  img[k] = r; img[k + 1] = g; img[k + 2] = b; img[k + 3] = 255;
}
await writeFile(out, encodePng(img, W, H));
console.log(out + ': ' + W + 'x' + H + ' (' + mode + ')');
