// Gives the Terrain Test Grounds a running stream (an animated river effect from the painted stream), a brazier that starts unlit and can be lit (painted into the picture, a light with flicker in the set) and keeps the
// campfire and the buildings. Idempotent: it re-reads the original picture backup the first time and always starts from it. Usage: node scripts/update-terrain-test.mjs [server url]
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPicture } from '../lib/bmpread.js';
import { Painter, encodePng } from '../lib/mapkit.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://localhost:3000';
const packet = path.join(root, 'data', 'mapsets', 'b0f61f20-0b90-461a-bf44-32dd01c42bff');
const pic = path.join(packet, 'vtt-terrain-test.png'), backup = path.join(root, 'public', 'scenarios', 'compare', 'terrain', 'terrain-before-brazier.png');
if (!existsSync(backup)) copyFileSync(pic, backup);
const img = await readPicture(backup);

// 1. the stream: for every 10 px column the longest run of bluish pixels between y 450 and 1050
const isWater = (x, y) => { const i = (y * img.w + x) * 3; return img.rgb[i + 2] >= 46 && img.rgb[i + 2] > img.rgb[i] * 0.55; };
const top = [], bottom = [];
for (let x = 0; x < img.w; x += 10) {
  let best = null, start = -1;
  for (let y = 450; y <= 1050; y++) {
    const w = isWater(x, y);
    if (w && start < 0) start = y;
    if ((!w || y === 1050) && start >= 0) { if (!best || y - start > best[1] - best[0]) best = [start, y]; start = -1; }
  }
  top.push(best ? best[0] : null); bottom.push(best ? best[1] : null);
}
const fill = (a) => { for (let i = 0; i < a.length; i++) if (a[i] == null) { let j = i; while (j < a.length && a[j] == null) j++; const l = i > 0 ? a[i - 1] : a[j], r = j < a.length ? a[j] : l; for (let k = i; k < j; k++) a[k] = l + (r - l) * (k - i + 1) / (j - i + 1); i = j; } };
fill(top); fill(bottom);
const smooth = (a, r = 3) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - r); k <= Math.min(a.length - 1, i + r); k++) { s += a[k]; n++; } return s / n; });
const T = smooth(top), B = smooth(bottom);
const xs = top.map((_, i) => i * 10);
const points = [...xs.map((x, i) => ({ x, y: Math.round(T[i]) })), ...xs.map((x, i) => ({ x, y: Math.round(B[i]) })).reverse()];
const path2 = xs.filter((_, i) => i % 4 === 0).map((x, k) => ({ x, y: Math.round((T[k * 4] + B[k * 4]) / 2) }));
console.log('stream polygon', points.length, 'points, centre line', path2.length, 'points, width about', Math.round(B.reduce((s, v, i) => s + v - T[i], 0) / B.length), 'px');

// 2. the brazier: an iron bowl of cold coals, painted into the picture where nothing is
const BX = 1560, BY = 420;
const P = new Painter(img.w, img.h);
for (let i = 0; i < img.w * img.h; i++) { P.img[i * 4] = img.rgb[i * 3]; P.img[i * 4 + 1] = img.rgb[i * 3 + 1]; P.img[i * 4 + 2] = img.rgb[i * 3 + 2]; P.img[i * 4 + 3] = 255; }
P.ellipse(BX + 7, BY + 9, 34, 29, 0, [20, 16, 10], 0.38);                               // soft shadow
for (const a of [0.4, 2.5, 4.6]) P.disc(BX + Math.cos(a) * 31, BY + Math.sin(a) * 31, 7, [50, 46, 42]);       // three legs
P.disc(BX, BY, 29, [48, 44, 40]);                                                       // iron rim
P.ring(BX, BY, 26, 3, [92, 86, 78], 0.8);
P.disc(BX, BY, 22, [30, 26, 24]);                                                       // bowl
for (let k = 0; k < 14; k++) { const a = k * 2.4, r = 3 + (k * 7) % 15; P.disc(BX + Math.cos(a) * r, BY + Math.sin(a) * r, 3.2, [64 + (k % 3) * 12, 34, 24]); }   // cold coals
await writeFile(pic, encodePng(P.img, img.w, img.h));

// 3. the set: effects, the brazier light (starts unlit), kinds on the existing lights, a ring the brazier stands in
const get = async () => (await (await fetch(`${base}/api/map-config?map=vtt-terrain-test.png`)).json());
const { config, setVersion } = await get();
const lights = (config.lights || []).filter((l) => l.name !== 'brazier').map((l) => ({ ...l, ...(l.name === 'campfire' ? { kind: 'campfire' } : l.name === 'lantern' ? { kind: 'lantern' } : {}) }));
lights.push({ x: BX, y: BY, range: 8, intensity: 1, color: 'ffff9a3c', flicker: true, name: 'brazier', kind: 'brazier', on: false });
const ring = []; for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, b = (i + 1) * Math.PI / 5; ring.push({ x1: BX + Math.cos(a) * 29, y1: BY + Math.sin(a) * 29, x2: BX + Math.cos(b) * 29, y2: BY + Math.sin(b) * 29, type: 'fence', open: false }); }
const walls = (config.walls || []).filter((w) => !(Math.hypot((w.x1 + w.x2) / 2 - BX, (w.y1 + w.y2) / 2 - BY) < 40 && w.type === 'fence')).concat(ring);
const starts = (config.starts || []).filter((s) => s.name !== 'brazier').concat([{ name: 'brazier', x: BX, y: BY - 70, desc: 'An iron brazier of cold coals beside the cabin. It can be lit.' }]);
const effects = [{ id: 'stream', type: 'river', points, path: path2, speed: 1, hazard: false }];
const res = await fetch(`${base}/api/map-config?map=vtt-terrain-test.png`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, lights, walls, starts, effects, baseVersion: setVersion }) });
console.log('saved', res.status, await res.text());
