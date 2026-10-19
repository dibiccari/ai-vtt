// Writes the region and road names of our Sword Coast onto its map set as the `labels` layer (public/js/map-labels.js draws them in code over the picture).
// The names and positions come from public/scenarios/compare/coast/coast-names.json (fractions of the picture, read off the layout in the published picture's 2648 x 3625 pixels);
// the two roads follow the control points the map was drawn with (scripts/maps/make-coast-map.mjs: High Road, and the trail from Conyberry to Cragmaw Hideout that Triboar Trail names).
// Usage: node scripts/maps/apply-coast-labels.mjs [--server http://127.0.0.1:3000] [--map dnd-sword-coast-ours.png] [--dry-run]
// It reads the map's whole configuration, adds `labels` and saves it again (a save replaces the walls and pins, so they have to travel with it), and only rewrites the labels it owns:
// labels whose id starts with "coast-" are replaced, any other label is kept.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const server = opt('--server', 'http://127.0.0.1:3000').replace(/\/$/, '');
const mapFile = opt('--map', 'dnd-sword-coast-ours.png');
const dryRun = args.includes('--dry-run');

// Control points of the two roads in the published picture's pixels (2648 x 3625), copied from scripts/maps/make-coast-map.mjs.
const ROADS = {
  'The High Road': [[130, 100], [160, 200], [230, 330], [290, 500], [310, 700], [325, 900], [350, 1100], [400, 1200], [470, 1415], [557, 1570], [571, 1693], [577, 1750], [628, 1885], [743, 2015], [886, 2185], [985, 2330], [1030, 2430], [1014, 2543], [1036, 2757], [1054, 2970], [1100, 3140], [1186, 3257], [1293, 3314], [1435, 3400], [1607, 3543]],
  'Triboar Trail': [[2222, 1924], [2050, 2043], [1907, 2143], [1793, 2257], [1664, 2357], [1579, 2457], [1464, 2557], [1393, 2586], [1250, 2657], [1057, 2686]]
};

const MOVED = { 'Triboar Trail': [1850, 2230] };

// Catmull-Rom through the control points (the same curve the picture was drawn with), `per` samples per segment.
function spline(list, per = 10) {
  const res = [];
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[Math.max(0, i - 1)], b = list[i], c = list[i + 1], d = list[Math.min(list.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3);
      res.push([f(0), f(1)]);
    }
  }
  res.push(list[list.length - 1]);
  return res;
}
// The part of a polyline `length` long, centred on the point nearest to (x, y).
function stretchNear(line, x, y, length) {
  let best = 0, bd = Infinity;
  line.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
  const along = [0]; for (let i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const lo = along[best] - length / 2, hi = along[best] + length / 2;
  const part = line.filter((_, i) => along[i] >= lo && along[i] <= hi);
  return part.length >= 2 ? part : line.slice(Math.max(0, best - 1), best + 2);
}
// PNG width and height from the header of the picture the server serves.
async function pictureSize(file) {
  const res = await fetch(`${server}/uploads/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`the server has no picture ${file} (${res.status})`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('only PNG pictures are read here');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const names = JSON.parse(await readFile(path.join(root, 'public', 'scenarios', 'compare', 'coast', 'coast-names.json'), 'utf8'));
const size = await pictureSize(mapFile);
const k = size.w / names.width;                                               // the names are in the published picture's pixels; the set's picture is smaller
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const round = (v) => Math.round(v * 10) / 10;

const labels = [];
for (const l of names.labels) {
  if (l.kind === 'road') {
    const control = ROADS[l.text];
    const line = spline(control || [[l.x - 200, l.y], [l.x, l.y - 40], [l.x + 200, l.y]], 10);       // no known road: a gentle curve through the label's place
    const textLength = l.text.length * l.size * 0.62 * 1.1;                    // roughly how long the word is when written at the label's size
    const [cx, cy] = MOVED[l.text] || [l.x, l.y];                              // Triboar Trail's name sits further up the trail, clear of the Triboar Trail pin
    const part = control ? stretchNear(line, cx, cy, textLength * 1.15) : line;
    const path = part.filter((_, i) => i % 3 === 0 || i === part.length - 1).map((p) => ({ x: round(p[0] * k), y: round(p[1] * k) }));
    labels.push({ id: 'coast-' + slug(l.text), text: l.text, kind: 'trail', x: path[Math.floor(path.length / 2)].x, y: path[Math.floor(path.length / 2)].y, size: round(l.size * k * 1.1), path });
  } else {
    labels.push({ id: 'coast-' + slug(l.text), text: l.text, kind: 'region', x: round(l.x * k), y: round(l.y * k), size: round(l.size * k * 0.45), rot: Math.max(-90, Math.min(90, l.rot || 0)) });
  }
}

const cur = await (await fetch(`${server}/api/map-config?map=${encodeURIComponent(mapFile)}`)).json();
if (!cur.config) throw new Error(`the server has no set-up for ${mapFile}`);
const { setVersion, ...config } = cur.config;
config.labels = [...(config.labels || []).filter((l) => !String(l.id).startsWith('coast-')), ...labels];
console.log(`${labels.length} labels for ${mapFile} (${size.w} x ${size.h} px): ${labels.map((l) => `${l.text} [${l.kind}]`).join(', ')}`);
if (dryRun) { console.log(JSON.stringify(config.labels, null, 1)); process.exit(0); }
const res = await fetch(`${server}/api/map-config?map=${encodeURIComponent(mapFile)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
const out = await res.json().catch(() => ({}));
if (!res.ok || out.error) { console.error('save failed:', res.status, out.error || ''); process.exit(1); }
console.log(`saved (version ${out.version})`);
