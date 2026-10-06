// Checks traced walls against a reference: the purchased (dd2vtt) version of the same dungeon, which has exact walls. Both are on a 5 ft grid, so the two pictures differ by a whole number of
// squares; the script finds that shift, then reports how much of the reference wall the trace has (recall) and how much of the trace the reference supports (precision), lists the
// biggest misses, and draws both on the traced picture (red = trace, green = reference moved onto it, yellow = where they agree is hidden under both).
// Usage: node scripts/compare-walls.mjs <layout.json> <reference config in data/maps> [--ref-cell 70] [--tol 0.3] [--out compare.png]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
import { drawText } from '../lib/pixfont.js';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const layout = JSON.parse(await readFile(path.resolve(args[0]), 'utf8'));
const refName = args[1];
const traced = JSON.parse(await readFile(path.join(root, 'data', 'maps', layout.picture + '.json'), 'utf8'));
const ref = JSON.parse(await readFile(path.join(root, 'data', 'maps', refName.endsWith('.json') ? refName : refName + '.json'), 'utf8'));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
const refCell = Number(opt('ref-cell', 70)), tol = Number(opt('tol', 0.3));
const toCells = (w, cell, o) => ({ x1: (w.x1 - o[0]) / cell, y1: (w.y1 - o[1]) / cell, x2: (w.x2 - o[0]) / cell, y2: (w.y2 - o[1]) / cell, type: w.type });
const T = traced.walls.filter((w) => w.type !== 'fence').map((w) => toCells(w, C, [ox, oy]));
const R = ref.walls.filter((w) => w.type !== 'fence').map((w) => toCells(w, refCell, [0, 0]));
const samples = (segs, step = 0.1) => {
  const out = [];
  for (const s of segs) { const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), n = Math.max(1, Math.round(len / step)); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; out.push({ x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t, door: s.type === 'door' }); } }
  return out;
};
// spatial hash of sample points for the near test
const hash = (pts, size = 0.5) => { const m = new Map(); for (const p of pts) { const k = Math.floor(p.x / size) + ',' + Math.floor(p.y / size); if (!m.has(k)) m.set(k, []); m.get(k).push(p); } return { m, size }; };
const near = (h, x, y, r) => { const i0 = Math.floor((x - r) / h.size), i1 = Math.floor((x + r) / h.size), j0 = Math.floor((y - r) / h.size), j1 = Math.floor((y + r) / h.size); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const p of h.m.get(i + ',' + j) || []) if (Math.hypot(p.x - x, p.y - y) <= r) return true; return false; };
const TS = samples(T), RS = samples(R).filter((p) => !p.door);
const TH = hash(TS);
let best = null;
for (let dx = -10; dx <= 10; dx++) for (let dy = -10; dy <= 10; dy++) {
  let hit = 0; for (const p of RS) if (near(TH, p.x + dx, p.y + dy, tol)) hit++;
  if (!best || hit > best.hit) best = { dx, dy, hit };
}
const { dx, dy } = best;
const RSm = RS.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
const RH = hash(RSm);
const recall = RSm.filter((p) => near(TH, p.x, p.y, tol)).length / RSm.length;
const TSw = TS.filter((p) => !p.door);
const precision = TSw.filter((p) => near(RH, p.x, p.y, tol)).length / TSw.length;
console.log(`shift: the reference sits ${dx},${dy} squares from the trace; reference wall length ${(RSm.length * 0.1).toFixed(0)} squares, traced ${(TSw.length * 0.1).toFixed(0)} squares`);
console.log(`recall ${(recall * 100).toFixed(0)}% of the reference wall is traced; precision ${(precision * 100).toFixed(0)}% of the trace is on a reference wall (within ${tol} square)`);
// clusters of reference wall with no trace near it (misses) and of trace with no reference (extras), as cell boxes
const cluster = (pts, label) => {
  const cells = new Map();
  for (const p of pts) { const k = Math.floor(p.x * 2) + ',' + Math.floor(p.y * 2); cells.set(k, (cells.get(k) || 0) + 1); }
  const seen = new Set(), out = [];
  for (const k of cells.keys()) { if (seen.has(k)) continue; const st = [k], comp = []; seen.add(k); while (st.length) { const q = st.pop(); comp.push(q); const [a, b] = q.split(',').map(Number); for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const kk = (a + da) + ',' + (b + db); if (cells.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } } }
    const n = comp.reduce((s, q) => s + cells.get(q), 0) * 0.1;
    const xs = comp.map((q) => +q.split(',')[0] / 2), ys = comp.map((q) => +q.split(',')[1] / 2);
    out.push({ n, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + 0.5, y1: Math.max(...ys) + 0.5 }); }
  out.sort((a, b) => b.n - a.n);
  console.log(label + ': ' + out.length + ' groups; biggest: ' + out.slice(0, 8).map((o) => `${o.n.toFixed(1)} sq at ${o.x0},${o.y0}..${o.x1},${o.y1}`).join(' | '));
  return out;
};
const missed = RSm.filter((p) => !near(TH, p.x, p.y, tol)), extra = TSw.filter((p) => !near(RH, p.x, p.y, tol));
cluster(missed, 'missed (reference wall with no trace)');
cluster(extra, 'extra (trace with no reference wall)');
// picture
const pic = await readPicture(path.join(root, 'public', 'uploads', layout.picture));
const S = 0.5, W = Math.round(pic.w * S), H = Math.round(pic.h * S), img = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = pic.lum[Math.round(y / S) * pic.w + Math.round(x / S)] * 0.55 + 90, k = (y * W + x) * 4; img[k] = img[k + 1] = img[k + 2] = v; img[k + 3] = 255; }
const dot = (x, y, col) => { const px = Math.round((x * C + ox) * S), py = Math.round((y * C + oy) * S); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const xx = px + a, yy = py + b; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const k = (yy * W + xx) * 4; img[k] = col[0]; img[k + 1] = col[1]; img[k + 2] = col[2]; } };
for (const p of RSm) dot(p.x, p.y, [30, 190, 60]);
for (const p of TSw) dot(p.x, p.y, near(RH, p.x, p.y, tol) ? [255, 220, 0] : [230, 40, 40]);
for (const p of missed) dot(p.x, p.y, [40, 120, 255]);
drawText(img, W, H, 'y trace ok  r extra  b missed', 8, 8, 2, [255, 255, 255]);
const out = opt('out', '/tmp/compare-walls.png');
await writeFile(out, encodePng(img, W, H));
console.log('overlay (yellow = trace agrees with reference, red = trace without reference, blue = reference wall not traced, green = reference): ' + out);
