// Puts the module's numbered areas on a map as pins (area-N), from positions given in the 1400-px-wide preview of the picture.
// Usage: node scripts/place-area-pins.mjs <picture file> <scale to image px> '{"1":[x,y],...}'
// Existing area pins are replaced; other pins are kept. Positions are first guesses: drag them in Map Test to fix.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [, , picture, scaleArg, json] = process.argv;
const scale = Number(scaleArg);
const spots = JSON.parse(json);
const areas = JSON.parse(await readFile(path.join(root, 'data', 'campaigns', 'lost-mine-of-phandelver', 'areas.json'), 'utf8'))[picture] || [];
const file = path.join(root, 'data', 'maps', picture + '.json');
const cfg = JSON.parse(await readFile(file, 'utf8'));
cfg.starts = (cfg.starts || []).filter((s) => !/^area-\d+(-\d+)?$/.test(s.name));
for (const a of areas) {
  const p = spots[a.n];
  if (!p) { console.log('no position for area', a.n, a.name); continue; }
  cfg.starts.push({ name: 'area-' + a.n, x: Math.round(p[0] * scale), y: Math.round(p[1] * scale), desc: a.name });
}
await writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
console.log(picture + ': ' + cfg.starts.filter((s) => /^area-/.test(s.name)).length + ' area pins');
