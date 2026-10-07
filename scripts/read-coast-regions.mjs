// Reads the LAYOUT of a regional map picture (which blocks are sea, forest, hills, mountains, marsh, meadow) by colour and texture, in 8 x 8 pixel blocks, and writes the result as a small JSON
// grid for our own drawing code. It looks at where things are, nothing else; nothing of the picture's art is kept and nothing is sent anywhere.
//   node scripts/read-coast-regions.mjs <picture> <out.json> [out-preview.png]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';

const [pic, out, prev] = process.argv.slice(2);
const img = await readPicture(path.resolve(pic));
const B = 8, w = Math.floor(img.w / B), h = Math.floor(img.h / B);
const CL = ['land', 'sea', 'forest', 'hills', 'mountain', 'marsh', 'edge'];
const cls = new Uint8Array(w * h);
for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) {
  let r = 0, g = 0, b = 0, n = 0, br = [];
  for (let y = 0; y < B; y += 2) for (let x = 0; x < B; x += 2) { const i = ((by * B + y) * img.w + bx * B + x) * 3; r += img.rgb[i]; g += img.rgb[i + 1]; b += img.rgb[i + 2]; n++; br.push((img.rgb[i] + img.rgb[i + 1] + img.rgb[i + 2]) / 3); }
  r /= n; g /= n; b /= n; const m = br.reduce((a, c) => a + c, 0) / n, sd = Math.sqrt(br.reduce((a, c) => a + (c - m) ** 2, 0) / n);
  const px = bx * B, py = by * B;
  let c = 0;
  if (px < 90 || py < 70 || px > 2570 || py > 3540) c = 6;                                     // the frame
  else if (b > r + 22 && b > g - 4 && m > 120) c = 1;                                           // sea: blue
  else if (g > r + 8 && g > b + 14 && m < 150 && sd > 26) c = 2;                                // forest: dark, green, textured
  else if (r > g - 2 && sd > 52 && m < 150) c = 4;                                              // mountains: dark warm and very contrasty
  else if (r > g - 6 && r > b + 30 && sd > 30) c = 3;                                           // hills: warm and textured
  else if (g > r && g > b + 20 && m > 125 && m < 175 && sd > 22 && b > 120) c = 5;              // marsh and lake shallows (teal-ish green)
  cls[by * w + bx] = c;
}
// smooth: majority of the 3 x 3 neighbourhood
const sm = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const cnt = new Array(7).fill(0); for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx)); cnt[cls[yy * w + xx]]++; } let best = 0; for (let k = 1; k < 7; k++) if (cnt[k] > cnt[best]) best = k; sm[y * w + x] = cnt[best] >= 8 ? best : cls[y * w + x]; }
await writeFile(path.resolve(out), JSON.stringify({ block: B, w, h, picture: path.basename(pic), width: img.w, height: img.h, classes: CL, rows: Array.from({ length: h }, (_, y) => Array.from(sm.slice(y * w, (y + 1) * w)).join('')) }));
if (prev) {
  const pal = [[226, 214, 160], [110, 160, 205], [40, 110, 60], [200, 170, 100], [130, 124, 120], [120, 160, 130], [60, 50, 40]];
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { const c = pal[sm[p]]; rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = 255; }
  await writeFile(path.resolve(prev), encodePng(rgba, w, h));
}
const counts = new Array(7).fill(0); for (const c of sm) counts[c]++;
console.log(`${w} x ${h} blocks; ` + CL.map((n, i) => `${n} ${((counts[i] / (w * h)) * 100).toFixed(0)}%`).join(', '));
