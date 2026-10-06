// Finds the doors drawn on a WotC-style picture: white rectangles about 0.65 x 0.27 of a square (or turned a quarter), lying in a wall.
// Usage: node scripts/find-doors.mjs data/map-layouts/<name>.json   (rewrites the "detectedDoors" list of the layout; each door: centre and length in grid-cell units)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = path.resolve(process.argv[2]);
const layout = JSON.parse(await readFile(file, 'utf8'));
const m = await readPicture(path.join(root, layout.inkPicture || path.join('public', 'uploads', layout.picture)));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
const W = m.w, H = m.h, N = W * H;
const mask = new Uint8Array(N);
for (let i = 0; i < N; i++) { const r = m.rgb[i * 3], g = m.rgb[i * 3 + 1], b = m.rgb[i * 3 + 2]; if (m.lum[i] > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 28) mask[i] = 1; }
const seen = new Uint8Array(N), found = [];
for (let s = 0; s < N; s++) {
  if (!mask[s] || seen[s]) continue;
  const st = [s]; seen[s] = 1; let n = 0, x0 = W, x1 = -1, y0 = H, y1 = -1;
  while (st.length) {
    const p = st.pop(), x = p % W, y = (p / W) | 0; n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st.push(p - 1); }
    if (x < W - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st.push(p + 1); }
    if (y > 0 && mask[p - W] && !seen[p - W]) { seen[p - W] = 1; st.push(p - W); }
    if (y < H - 1 && mask[p + W] && !seen[p + W]) { seen[p + W] = 1; st.push(p + W); }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, lo = Math.min(w, h), hi = Math.max(w, h);
  // a door: long side 0.55-0.75 squares, short side 0.18-0.35 squares, mostly filled
  if (n / (w * h) > 0.55 && hi >= 0.55 * C && hi <= 0.78 * C && lo >= 0.18 * C && lo <= 0.36 * C && hi / lo >= 1.8) {
    const horizontal = w > h;
    found.push({ cx: (x0 + w / 2 - ox) / C, cy: (y0 + h / 2 - oy) / C, len: hi / C, thick: lo / C, horizontal });
  }
}
// two doors lying end to end in the same wall are one double door
found.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
const doors = [];
for (const d of found) {
  const prev = doors.find((p) => p.horizontal === d.horizontal && (d.horizontal ? Math.abs(p.cy - d.cy) < 0.12 && Math.abs(p.cx - d.cx) < 0.9 : Math.abs(p.cx - d.cx) < 0.12 && Math.abs(p.cy - d.cy) < 0.9));
  if (!prev) { doors.push({ ...d }); continue; }
  const a0 = d.horizontal ? Math.min(prev.cx - prev.len / 2, d.cx - d.len / 2) : Math.min(prev.cy - prev.len / 2, d.cy - d.len / 2);
  const a1 = d.horizontal ? Math.max(prev.cx + prev.len / 2, d.cx + d.len / 2) : Math.max(prev.cy + prev.len / 2, d.cy + d.len / 2);
  if (d.horizontal) { prev.cx = (a0 + a1) / 2; } else { prev.cy = (a0 + a1) / 2; }
  prev.len = a1 - a0;
}
const r2 = (v) => Math.round(v * 100) / 100;
layout.detectedDoors = doors.map((d) => ({ [d.horizontal ? 'h' : 'v']: r2(d.horizontal ? d.cy : d.cx), from: r2((d.horizontal ? d.cx : d.cy) - d.len / 2), to: r2((d.horizontal ? d.cx : d.cy) + d.len / 2) }));
await writeFile(file, JSON.stringify(layout, null, 2) + '\n');
console.log(layout.detectedDoors.length + ' doors found');
for (const d of layout.detectedDoors) console.log(JSON.stringify(d));
