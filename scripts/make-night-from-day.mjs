// Makes the night picture of a place from its day picture by code, so every tree, building and rock stays exactly where it is (nothing is repainted): the day picture goes cold and dark under moonlight and the lights
// that are lit at the start glow warmly (lib/mapkit.js nightFrom). Then it adds the picture to the place as its night look. Usage: node scripts/make-night-from-day.mjs <set guid> [server url]
// The lit lights come from the set: lights that start lit (not on: false) glow; a light that starts out (an unlit brazier) does not, because lighting it is done at the table.
import { copyFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPicture } from '../lib/bmpread.js';
import { encodePng, nightFrom } from '../lib/mapkit.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const guid = process.argv[2], base = process.argv[3] || 'http://localhost:3000';
if (!guid) { console.error('usage: node scripts/make-night-from-day.mjs <set guid> [server url]'); process.exit(1); }
const set = (await (await fetch(`${base}/api/mapsets/${guid}`)).json()).set;
const level = set.levels[0], dayLook = level.looks.find((l) => l.time === 'day' || l.time === 'main');
const dayFile = path.join(root, 'data', 'mapsets', guid, dayLook.player);
const img = await readPicture(dayFile);
const ppg = img.w / level.squares, cols = level.squares, rows = Math.round(img.h / ppg);
const rgba = new Uint8ClampedArray(img.w * img.h * 4);
for (let i = 0; i < img.w * img.h; i++) { rgba[i * 4] = img.rgb[i * 3]; rgba[i * 4 + 1] = img.rgb[i * 3 + 1]; rgba[i * 4 + 2] = img.rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
const lit = (dayLook.lights || []).filter((l) => l.on !== false);
const lights = lit.map((l) => ({ x: l.x / ppg, y: l.y / ppg, intensity: l.range >= 6 ? 1 : 0.5 }));
const out = nightFrom(rgba, { W: img.w, H: img.h, ppg, cols, rows }, lights, { glowRadius: 5.5, vignette: 0.3 });
const name = dayLook.player.replace(/(\.[a-z]+)$/, '-night$1');
const tmp = path.join(root, 'data', 'mapsets', guid, name);       // straight into the place's own packet
await writeFile(tmp, encodePng(out, img.w, img.h));
const res = await fetch(`${base}/api/mapsets/${guid}/looks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time: 'night', picture: name, light: 'dark', ambient: 'ff1a2240', ambience: 'night' }) });
console.log(name, `${lit.length} lit lights glow`, res.status, await res.text());
