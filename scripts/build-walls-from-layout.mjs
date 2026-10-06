// Builds a map config (walls, doors, fences) from a layout read off a picture: rooms and cave outlines in grid-cell units, openings, doors, fences.
// Usage: node scripts/build-walls-from-layout.mjs data/map-layouts/<name>.json
// Walls are the edges of every room and cave outline, minus the openings, with doors and fences added on top; secret doors stay as plain walls
// (their positions are saved in "secrets" of the config for the DM). Writes data/maps/<picture>.json (source 'dd2vtt': the picture already shows its walls).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const layout = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
const px = (v, o) => Math.round((v * C + o) * 10) / 10;
const segs = [];
const add = (x1, y1, x2, y2) => { if (Math.hypot(x2 - x1, y2 - y1) > 1e-6) segs.push([x1, y1, x2, y2]); };
for (const [x0, y0, x1, y1] of Object.values(layout.rooms)) { add(x0, y0, x1, y0); add(x1, y0, x1, y1); add(x1, y1, x0, y1); add(x0, y1, x0, y0); }
for (const pts of Object.values(layout.caves || {})) for (let i = 0; i < pts.length; i++) add(pts[i][0], pts[i][1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
// Cut every wall into pieces of at most a quarter square, drop the pieces whose middle is inside an opening, then merge what is left.
const pieces = [];
for (const [x1, y1, x2, y2] of segs) {
  const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const p = [x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b];
    const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2;
    if ((layout.openings || []).some(([ax, ay, bx, by]) => mx > ax && mx < bx && my > ay && my < by)) continue;
    pieces.push(p);
  }
}
// Remove pieces covered by a door or secret door span? No: doors replace wall there, secrets stay walls.
const onSpan = (p, d) => { const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2; return d.h !== undefined ? Math.abs(my - d.h) < 0.05 && mx > d.from && mx < d.to : Math.abs(mx - d.v) < 0.05 && my > d.from && my < d.to; };
const kept = pieces.filter((p) => !(layout.doors || []).some((d) => onSpan(p, d)));
// merge collinear neighbours
const key = (p) => (Math.abs(p[1] - p[3]) < 1e-6 ? 'h' + Math.round(p[1] * 1000) : 'v' + Math.round(p[0] * 1000));
const groups = new Map();
for (const p of kept) { const k = key(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
const merged = [];
for (const [k, list] of groups) {
  const horiz = k[0] === 'h';
  const iv = list.map((p) => (horiz ? [Math.min(p[0], p[2]), Math.max(p[0], p[2]), p[1]] : [Math.min(p[1], p[3]), Math.max(p[1], p[3]), p[0]])).sort((a, b) => a[0] - b[0]);
  let cur = null;
  for (const [a, b, c] of iv) {
    if (cur && a <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], b);
    else { if (cur) merged.push(horiz ? [cur[0], cur[2], cur[1], cur[2]] : [cur[2], cur[0], cur[2], cur[1]]); cur = [a, b, c]; }
  }
  if (cur) merged.push(horiz ? [cur[0], cur[2], cur[1], cur[2]] : [cur[2], cur[0], cur[2], cur[1]]);
}
// Slanted cave edges were cut the same way; merging only joins axis-aligned runs, so keep the others as they are.
const slanted = pieces.filter((p) => Math.abs(p[0] - p[2]) > 1e-6 && Math.abs(p[1] - p[3]) > 1e-6);
const toPx = (s, type, extra = {}) => ({ x1: px(s[0], ox), y1: px(s[1], oy), x2: px(s[2], ox), y2: px(s[3], oy), type, open: false, ...extra });
const walls = [...merged, ...slanted].map((s) => toPx(s, 'wall'));
for (const d of layout.doors || []) walls.push(toPx(d.h !== undefined ? [d.from, d.h, d.to, d.h] : [d.v, d.from, d.v, d.to], 'door', d.locked ? { locked: true } : {}));
for (const f of layout.fences || []) {
  // a fence (bars) with a door gap: split it around any door lying on it
  const gaps = (layout.doors || []).filter((d) => d.h === f.h && d.from >= f.from && d.to <= f.to).sort((a, b) => a.from - b.from);
  let at = f.from;
  for (const g of gaps) { if (g.from > at) walls.push(toPx([at, f.h, g.from, f.h], 'fence')); at = g.to; }
  if (at < f.to) walls.push(toPx([at, f.h, f.to, f.h], 'fence'));
}
const file = path.join(root, 'data', 'maps', layout.picture + '.json');
let cfg = {};
try { cfg = JSON.parse(await readFile(file, 'utf8')); } catch { /* new map */ }
const width = (layout.width || 2475);
cfg = { ...cfg, squares: Math.round(width / C), walls, source: 'dd2vtt', secrets: (layout.secrets || []).map((s) => ({ name: s.name, ...toPx(s.h !== undefined ? [s.from, s.h, s.to, s.h] : [s.v, s.from, s.v, s.to], 'wall') })) };
await writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
console.log(layout.picture + ': ' + walls.filter((w) => w.type === 'wall').length + ' walls, ' + walls.filter((w) => w.type === 'door').length + ' doors, ' + walls.filter((w) => w.type === 'fence').length + ' fences, ' + cfg.secrets.length + ' secret doors');
