// Import a Universal VTT file (.dd2vtt) without the browser: writes its picture to public/uploads/<name>.<ext>
// and its walls, doors, grid size and lights to data/maps/<name>.<ext>.json.
//   node scripts/import-dd2vtt.mjs <file.dd2vtt> <name>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// uvtt.js is a browser script that sets a global (the package is ES modules, so it cannot be require()d).
await import(pathToFileURL(path.join(root, 'public', 'uvtt.js')).href);
const Uvtt = globalThis.Uvtt;

const [file, name] = process.argv.slice(2);
if (!file || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(name || '')) {
  console.error('usage: node scripts/import-dd2vtt.mjs <file.dd2vtt> <name (a-z, 0-9, -)>');
  process.exit(1);
}

const round = (n) => Math.round(n * 100) / 100;
const u = Uvtt.parse(await readFile(file, 'utf8'));
const bytes = Buffer.from(String(u.image || '').replace(/^data:[^,]*,/, ''), 'base64');
const kind = Uvtt.sniffImage(bytes);
if (!kind) throw new Error('The embedded picture is not a PNG, JPG or WEBP.');

const ppg = Number(u.resolution.pixels_per_grid);
const ox = Number(u.resolution.map_origin?.x) || 0;
const oy = Number(u.resolution.map_origin?.y) || 0;
const walls = Uvtt.toWalls(u, 1).map((w) => ({ ...w, x1: round(w.x1), y1: round(w.y1), x2: round(w.x2), y2: round(w.y2) }));
const lights = (u.lights || []).map((l) => ({
  x: round((Number(l.position?.x) - ox) * ppg),
  y: round((Number(l.position?.y) - oy) * ppg),
  range: Number(l.range),
  intensity: Number(l.intensity ?? 1),
  color: String(l.color || 'ffffff').replace(/^#/, '').toLowerCase(),
  ...(l.name ? { name: String(l.name) } : {})
})).filter((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.range));

const image = `${name}.${kind.ext}`;
await writeFile(path.join(root, 'public', 'uploads', image), bytes);
const config = {
  squares: Math.round(Number(u.resolution.map_size?.x)) || 50,
  walls,
  starts: [],
  source: 'dd2vtt',
  ...(lights.length ? { lights } : {}),
  ...(u.environment?.ambient_light ? { ambient: String(u.environment.ambient_light).replace(/^#/, '').toLowerCase() } : {})
};
await writeFile(path.join(root, 'data', 'maps', `${image}.json`), JSON.stringify(config, null, 2));
console.log(`${image}: ${config.squares} squares across, ${walls.filter((w) => w.type === 'wall').length} walls, ${walls.filter((w) => w.type === 'door').length} doors, ${lights.length} lights, ${(bytes.length / 1048576).toFixed(1)} MB`);
