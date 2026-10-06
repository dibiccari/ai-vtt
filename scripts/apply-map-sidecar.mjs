// Adds a generated map's settings (squares, light, ambience, start pins, difficult terrain) to its saved map config in data/maps/.
//   node scripts/apply-map-sidecar.mjs public/scenarios/terrain-test.config.json vtt-terrain-test.png
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [sidecar, picture] = process.argv.slice(2);
if (!sidecar || !picture) { console.error('usage: node scripts/apply-map-sidecar.mjs <sidecar.json> <picture file name>'); process.exit(1); }
const file = path.join(root, 'data', 'maps', `${picture}.json`);
const config = JSON.parse(await readFile(file, 'utf8'));
const extra = JSON.parse(await readFile(path.resolve(sidecar), 'utf8'));
// Walls the dd2vtt format cannot carry (fences and windows) are added to the imported walls.
const extraWalls = extra.extraWalls || [];
delete extra.extraWalls;
Object.assign(config, extra);
if (extraWalls.length) config.walls = (config.walls || []).filter((w) => w.type !== 'fence').concat(extraWalls);
await writeFile(file, JSON.stringify(config, null, 2));
console.log(`${picture}: ${(config.walls || []).length} walls, ${(config.starts || []).length} pins, ${(config.difficult || []).length} difficult-terrain rectangles`);
