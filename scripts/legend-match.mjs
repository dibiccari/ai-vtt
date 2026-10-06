// Learns a map's legend: cuts the picture of each legend entry out of the legend panel and finds where the same symbol is drawn on the map.
// Usage: node scripts/legend-match.mjs <layout.json> [--scale 2.0] [--thr 0.55] [--only Table,Bars] [--out matches.png]
// The layout needs  "legend": { "box": [x, y, w, h], "names": ["Bars", ...] }  in picture pixels: the tall column of square swatches (names top to bottom, equal rows).
// The swatches are small crops of the same drawing as the map, drawn smaller, so each one is scaled up (--scale, found with --calibrate), turned 0/90/180/270 degrees and
// compared with the picture (normalised cross-correlation on a quarter-size copy; legend.channels.<name> = "red" matches a red symbol such as the secret-door S on the redness of the picture instead of its brightness). Peaks above --thr are written to the layout as legend.found.<name> = [{x, y, score, rot}] (picture pixels, centre).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
import { drawText } from '../lib/pixfont.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const layoutFile = path.resolve(args[0]);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const layout = JSON.parse(await readFile(layoutFile, 'utf8'));
if (!layout.legend?.box || !layout.legend?.names?.length) { console.error('The layout needs legend.box [x,y,w,h] and legend.names.'); process.exit(1); }
const only = opt('only', '') ? opt('only', '').split(',') : null;
const calibrate = args.includes('--calibrate');
const thr = Number(opt('thr', 0.55));
const pic = await readPicture(path.join(root, layout.inkPicture || path.join('public', 'uploads', layout.picture)));
const D = 4;                                                       // match on a quarter-size copy
const small = (src, w, h) => {
  const sw = Math.floor(w / D), sh = Math.floor(h / D), out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let s = 0; for (let dy = 0; dy < D; dy++) for (let dx = 0; dx < D; dx++) s += src[(y * D + dy) * w + x * D + dx]; out[y * sw + x] = s / (D * D); }
  return { w: sw, h: sh, data: out };
};
const redOf = new Float32Array(pic.w * pic.h);
for (let i = 0; i < redOf.length; i++) redOf[i] = Math.max(0, pic.rgb[i * 3] - Math.max(pic.rgb[i * 3 + 1], pic.rgb[i * 3 + 2]));
const maps = { lum: small(pic.lum, pic.w, pic.h), red: small(redOf, pic.w, pic.h) };
let map = maps.lum;
const integral = (img) => {
  const W1 = img.w + 1, S = new Float64Array(W1 * (img.h + 1)), Q = new Float64Array(W1 * (img.h + 1));
  for (let y = 0; y < img.h; y++) { let rs = 0, rq = 0; for (let x = 0; x < img.w; x++) { const v = img.data[y * img.w + x]; rs += v; rq += v * v; S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + rs; Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + rq; } }
  return { S, Q, W1 };
};
const IIs = { lum: integral(maps.lum), red: integral(maps.red) };
let II = IIs.lum;
const box = (I, x, y, w, h) => I[(y + h) * II.W1 + x + w] - I[y * II.W1 + x + w] - I[(y + h) * II.W1 + x] + I[y * II.W1 + x];

// swatches: equal rows of the legend column, a few pixels cut off each side for the black frame
const [bx, by, bw, bh] = layout.legend.box, rows = layout.legend.names.length, rowH = bh / rows, inset = layout.legend.inset ?? 5;
const swatch = (i, channel) => {
  const x0 = Math.round(bx + inset), y0 = Math.round(by + i * rowH + inset), w = Math.round(bw - 2 * inset), h = Math.round(rowH - 2 * inset);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (channel === 'red' ? redOf : pic.lum)[(y0 + y) * pic.w + x0 + x];
  return { w, h, data: out };
};
// bilinear resize of a template to (w*f/D) pixels, then rotation by quarter turns
const resize = (img, f) => {
  const w = Math.max(6, Math.round(img.w * f)), h = Math.max(6, Math.round(img.h * f)), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / f - 0.5, sy = (y + 0.5) / f - 0.5, x0 = Math.max(0, Math.min(img.w - 2, Math.floor(sx))), y0 = Math.max(0, Math.min(img.h - 2, Math.floor(sy))), fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
    out[y * w + x] = (img.data[y0 * img.w + x0] * (1 - fx) + img.data[y0 * img.w + x0 + 1] * fx) * (1 - fy) + (img.data[(y0 + 1) * img.w + x0] * (1 - fx) + img.data[(y0 + 1) * img.w + x0 + 1] * fx) * fy;
  }
  return { w, h, data: out };
};
const rotate = (img) => { const out = new Float32Array(img.w * img.h); for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out[x * img.h + (img.h - 1 - y)] = img.data[y * img.w + x]; return { w: img.h, h: img.w, data: out }; };
// normalised cross-correlation of one template over the whole small picture; returns the best score per position
function ncc(t) {
  const n = t.w * t.h; let mean = 0; for (const v of t.data) mean += v; mean /= n;
  const tz = new Float32Array(n); let tn = 0; for (let i = 0; i < n; i++) { tz[i] = t.data[i] - mean; tn += tz[i] * tz[i]; }
  tn = Math.sqrt(tn);
  const W = map.w - t.w, H = map.h - t.h, out = new Float32Array(Math.max(0, W) * Math.max(0, H));
  if (tn < 1e-6) return { W, H, out };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = box(II.S, x, y, t.w, t.h), q = box(II.Q, x, y, t.w, t.h), varI = q - s * s / n;
    if (varI < 1e-3 * n) continue;
    let num = 0;
    for (let j = 0; j < t.h; j++) { const row = (y + j) * map.w + x, trow = j * t.w; for (let i = 0; i < t.w; i++) num += tz[trow + i] * map.data[row + i]; }
    out[y * W + x] = num / (tn * Math.sqrt(varI));
  }
  return { W, H, out };
}
const legendBox = { x0: bx - 30, y0: by - 30, x1: bx + 600, y1: by + bh + 30 };      // the legend panel itself is never a match
const frame = layout.legend.skip || [];                                              // extra picture-pixel rectangles to skip: [x0,y0,x1,y1]
const found = {};
const names = layout.legend.names;
const scalesFor = (name) => calibrate ? [0.8, 1.0, 1.2, 1.4, 1.7, 2.0, 2.3, 2.6, 3.0] : [Number(layout.legend.scales?.[name] ?? opt('scale', layout.legend.scale ?? 2.0))];
const report = [];
for (let i = 0; i < rows; i++) {
  const name = names[i];
  if (only && !only.includes(name)) continue;
  const channel = layout.legend.channels?.[name] || 'lum';
  map = maps[channel]; II = IIs[channel];
  let sw = swatch(i, channel);
  const crop = layout.legend.crops?.[name];                        // [x0,y0,x1,y1] fractions of the swatch: match only the part that is the symbol, not the floor around it
  if (crop) { const cx0 = Math.round(crop[0] * sw.w), cy0 = Math.round(crop[1] * sw.h), cw = Math.round((crop[2] - crop[0]) * sw.w), ch = Math.round((crop[3] - crop[1]) * sw.h), d = new Float32Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) d[y * cw + x] = sw.data[(cy0 + y) * sw.w + cx0 + x]; sw = { w: cw, h: ch, data: d }; }
  let best = [];
  for (const scale of scalesFor(name)) {
    const base = resize(sw, scale / D);
    let t = base; const peaks = [];
    for (let rot = 0; rot < 4; rot++) {
      if (rot) t = rotate(t);
      const { W, H, out } = ncc(t);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = out[y * W + x]; if (v < thr) continue;
        const cx = (x + t.w / 2) * D, cy = (y + t.h / 2) * D;
        if (cx > legendBox.x0 && cx < legendBox.x1 && cy > legendBox.y0 && cy < legendBox.y1) continue;
        if (frame.some(([a, b, c, d]) => cx > a && cx < c && cy > b && cy < d)) continue;
        peaks.push({ x: Math.round(cx), y: Math.round(cy), score: Math.round(v * 1000) / 1000, rot: rot * 90, scale, w: t.w * D, h: t.h * D });
      }
    }
    peaks.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const p of peaks) if (!kept.some((k) => Math.abs(k.x - p.x) < Math.max(p.w, k.w) * 0.6 && Math.abs(k.y - p.y) < Math.max(p.h, k.h) * 0.6)) kept.push(p);
    if (calibrate) report.push(`${name.padEnd(14)} scale ${scale}: ${kept.length} matches, best ${kept[0]?.score ?? '-'}`);
    best = best.concat(kept);
  }
  best.sort((a, b) => b.score - a.score);
  const merged = [];
  for (const p of best) if (!merged.some((k) => Math.abs(k.x - p.x) < Math.max(p.w, k.w) * 0.6 && Math.abs(k.y - p.y) < Math.max(p.h, k.h) * 0.6)) merged.push(p);
  found[name] = merged.slice(0, 40);
  if (!calibrate) console.log(name.padEnd(14), merged.length, 'matches', merged.slice(0, 6).map((p) => `${p.score}@${p.x},${p.y}`).join('  '));
}
if (calibrate) { console.log(report.join('\n')); process.exit(0); }
layout.legend.found = { ...(layout.legend.found || {}), ...found };
await writeFile(layoutFile, JSON.stringify(layout, null, 2) + '\n');
// overlay: boxes numbered per symbol, on a half-size copy of the picture
const S2 = 0.5, W = Math.round(pic.w * S2), H = Math.round(pic.h * S2), img = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = pic.lum[Math.round(y / S2) * pic.w + Math.round(x / S2)] * 0.6 + 70, k = (y * W + x) * 4; img[k] = img[k + 1] = img[k + 2] = v; img[k + 3] = 255; }
const COLORS = [[230, 40, 40], [40, 120, 255], [30, 170, 60], [230, 140, 0], [170, 60, 200], [0, 170, 170], [200, 200, 0], [255, 80, 160], [110, 110, 110]];
names.forEach((name, i) => {
  (found[name] || []).forEach((p, n) => {
    const col = COLORS[i % COLORS.length], x0 = Math.round((p.x - p.w / 2) * S2), y0 = Math.round((p.y - p.h / 2) * S2), x1 = Math.round((p.x + p.w / 2) * S2), y1 = Math.round((p.y + p.h / 2) * S2);
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (x >= 0 && x < W && y >= 0 && y < H) { const k = (y * W + x) * 4; img[k] = col[0]; img[k + 1] = col[1]; img[k + 2] = col[2]; }
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (x >= 0 && x < W && y >= 0 && y < H) { const k = (y * W + x) * 4; img[k] = col[0]; img[k + 1] = col[1]; img[k + 2] = col[2]; }
    drawText(img, W, H, String(i), x0 + 2, y0 + 2, 2, col);
  });
});
const out = opt('out', '/tmp/legend-matches.png');
await writeFile(out, encodePng(img, W, H));
console.log('overlay:', out, '(symbol numbers: ' + names.map((n, i) => i + '=' + n).join(', ') + ')');
