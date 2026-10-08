// Cuts the map's rectangle out of a repainted result (the layout's sidecar <layout>.json says where it is) and writes it as a PNG of --width pixels (default: the rectangle's own size).
// Usage: node scripts/crop-region.mjs --in <result.png> --layout <layout.png> --out <map.png> [--width 1536]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const [inp, lay, out] = [opt('in'), opt('layout'), opt('out')];
if (!inp || !lay || !out) { console.error('usage: node scripts/crop-region.mjs --in <result.png> --layout <layout.png> --out <map.png> [--width 1536]'); process.exit(1); }
const meta = JSON.parse(await readFile(path.resolve(lay) + '.json', 'utf8'));
const img = await readPicture(path.resolve(inp));
const s = img.w / (meta.canvas ? meta.canvas[0] : img.w);            // the result is the same size as the layout canvas
const bx = meta.x * s, by = meta.y * s, bw = meta.w * s, bh = meta.h * s;
const OW = Number(opt('width', Math.round(bw))), OH = Math.round(OW * bh / bw);
const rgba = new Uint8Array(OW * OH * 4);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const sx = bx + (x + 0.5) * bw / OW - 0.5, sy = by + (y + 0.5) * bh / OH - 0.5;
  const x0 = Math.max(0, Math.min(img.w - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(img.h - 2, Math.floor(sy))), fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0));
  for (let c = 0; c < 3; c++) {
    const g = (xx, yy) => img.rgb[(yy * img.w + xx) * 3 + c];
    rgba[(y * OW + x) * 4 + c] = Math.round(g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy);
  }
  rgba[(y * OW + x) * 4 + 3] = 255;
}
await writeFile(path.resolve(out), encodePng(rgba, OW, OH));
console.log(`cropped ${Math.round(bw)} x ${Math.round(bh)} at ${Math.round(bx)},${Math.round(by)} -> ${OW} x ${OH} ${out}`);
