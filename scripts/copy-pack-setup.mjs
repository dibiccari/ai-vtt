// Copies a pack map's set-up (walls, doors, pins, lights, difficult terrain, light level, sound) onto a remake of it, scaled by the ratio of the two pictures' widths, through the running server so
// the stale-save guard and the set files stay consistent. The remake must have the same shape as the pack picture (the layout was drawn from the pack's own walls).
// Usage: node scripts/copy-pack-setup.mjs --from lmop-cragmaw-hideout.png --to vtt-cragmaw-hideout-b.png [--publisher "Explorer Remakes"] [--server http://localhost:3000]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPicture } from '../lib/bmpread.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const from = opt('from'), to = opt('to'), base = opt('server', 'http://localhost:3000'), publisher = opt('publisher', 'Explorer Remakes');
if (!from || !to) { console.error('usage: node scripts/copy-pack-setup.mjs --from <pack picture> --to <remake picture> [--publisher name]'); process.exit(1); }
const size = async (f) => { const p = await readPicture(path.join(root, 'public', 'uploads', f)); return { w: p.w, h: p.h }; };
const [a, b] = [await size(from), await size(to)];
const f = b.w / a.w;
const shapeOff = Math.abs((b.h / a.h) / f - 1);
if (shapeOff > 0.02) { console.error(`the pictures have different shapes (${a.w}x${a.h} against ${b.w}x${b.h}): crop the remake to the pack's shape first`); process.exit(1); }
const get = async (file) => (await (await fetch(`${base}/api/map-config?map=${encodeURIComponent(file)}`)).json());
const { config: c } = await get(from);
if (!c) { console.error('no set-up for ' + from); process.exit(1); }
const r = (v) => Math.round(v * f * 10) / 10;
const out = {
  squares: c.squares, kind: c.kind, light: c.light, ambience: c.ambience, ambient: c.ambient, mood: c.mood, publisher,
  walls: (c.walls || []).map((w) => ({ ...w, x1: r(w.x1), y1: r(w.y1), x2: r(w.x2), y2: r(w.y2) })),
  starts: (c.starts || []).map((s) => ({ ...s, x: r(s.x), y: r(s.y) })),
  lights: (c.lights || []).map((l) => ({ ...l, x: r(l.x), y: r(l.y) })),
  difficult: (c.difficult || []).map((d) => ({ x: r(d.x), y: r(d.y), w: r(d.w), h: r(d.h) })),
  ...(c.rooms ? { rooms: c.rooms.map((q) => q.map(r)) } : {}), ...(c.secrets ? { secrets: c.secrets.map((s) => ({ ...s, x1: r(s.x1), y1: r(s.y1), x2: r(s.x2), y2: r(s.y2) })) } : {})
};
const cur = await get(to);
const res = await fetch(`${base}/api/map-config?map=${encodeURIComponent(to)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...out, ...(cur.config ? { baseVersion: cur.setVersion } : {}) }) });
console.log(`${from} (${a.w}x${a.h}) -> ${to} (${b.w}x${b.h}), scale ${f.toFixed(4)}: ${out.walls.length} walls, ${out.starts.length} pins, ${out.lights.length} lights: HTTP ${res.status}`);
