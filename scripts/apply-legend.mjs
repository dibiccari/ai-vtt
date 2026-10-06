// Turns what legend-match.mjs found into layout features: each secret-door S glyph becomes a `secrets` entry on the nearest wall line.
// Usage: node scripts/apply-legend.mjs <layout.json> [--max 0.6]   (a glyph is placed on the closest room edge within --max squares; others are reported)
// Locked doors, bars, braziers and the like are listed in the same legend; add them here as their symbols are matched reliably (see the learn-walls skill).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const file = path.resolve(args[0]);
const max = Number(args[args.indexOf('--max') + 1] || 0.6);
const layout = JSON.parse(await readFile(file, 'utf8'));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
const found = layout.legend?.found || {};
const edges = Object.values(layout.rooms).flatMap(([x0, y0, x1, y1]) => [{ h: y0, a: x0, b: x1 }, { h: y1, a: x0, b: x1 }, { v: x0, a: y0, b: y1 }, { v: x1, a: y0, b: y1 }]);
const r2 = (v) => Math.round(v * 100) / 100;
const secrets = [];
for (const p of (found['Secret Door'] || []).filter((p) => p.score >= 0.75)) {
  const cx = (p.x - ox) / C, cy = (p.y - oy) / C;
  let best = null;
  for (const e of edges) {
    const d = e.h !== undefined ? (cx > e.a - 0.3 && cx < e.b + 0.3 ? Math.abs(cy - e.h) : 9) : (cy > e.a - 0.3 && cy < e.b + 0.3 ? Math.abs(cx - e.v) : 9);
    if (!best || d < best.d) best = { d, e };
  }
  if (!best || best.d > max) { console.log(`secret door at ${r2(cx)},${r2(cy)}: no wall within ${max} squares, left out`); continue; }
  const e = best.e;
  secrets.push(e.h !== undefined ? { h: r2(e.h), from: r2(cx - 0.35), to: r2(cx + 0.35), name: 'secret door (legend S)' } : { v: r2(e.v), from: r2(cy - 0.35), to: r2(cy + 0.35), name: 'secret door (legend S)' });
  console.log(`secret door at ${r2(cx)},${r2(cy)} -> ${e.h !== undefined ? 'horizontal wall y=' + r2(e.h) : 'vertical wall x=' + r2(e.v)}`);
}
if (secrets.length) layout.secrets = secrets;
await writeFile(file, JSON.stringify(layout, null, 2) + '\n');
console.log(secrets.length + ' secret doors written');
