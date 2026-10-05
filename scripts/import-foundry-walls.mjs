// Copy the walls (and doors) of a Foundry VTT scene onto one of our maps. Some map packs ship a Foundry adventure bundle with walls
// even when their .dd2vtt files have none.
//   node scripts/import-foundry-walls.mjs <bundle .zip or bundle.json> <scene name pattern> <map image name>
//   e.g. node scripts/import-foundry-walls.mjs "Cragmaw Hideout  (Post Foundry).zip" "Summer" lmop-cragmaw-hideout.png
// The scene must be drawn the same size as our picture (a Foundry scene's grid size and padding decide where its walls sit).

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [source, pattern, mapName] = process.argv.slice(2);
if (!source || !pattern || !mapName) { console.error('usage: node scripts/import-foundry-walls.mjs <bundle.zip|bundle.json> <scene name pattern> <map image file name>'); process.exit(1); }

const text = source.endsWith('.json') ? await readFile(source, 'utf8') : execFileSync('unzip', ['-p', source, 'bundle.json'], { maxBuffer: 1 << 30 }).toString('utf8');
const bundle = JSON.parse(text);
const scenes = bundle.adventureData?.scenes ?? bundle.scenes ?? [];
const re = new RegExp(pattern, 'i');
const scene = scenes.find((s) => re.test(s.name));
if (!scene) { console.error(`No scene matches "${pattern}". Scenes: ${scenes.map((s) => s.name).join(' | ')}`); process.exit(1); }

// Foundry puts the picture inside a padded canvas: walls are stored in canvas coordinates, so the picture's corner is (sceneX, sceneY).
const grid = scene.grid?.size ?? scene.grid ?? 100;
const sceneX = Math.ceil((scene.width * (scene.padding ?? 0.25)) / grid) * grid;
const sceneY = Math.ceil((scene.height * (scene.padding ?? 0.25)) / grid) * grid;

const cfgFile = path.join(root, 'data', 'maps', `${mapName}.json`);
const config = JSON.parse(await readFile(cfgFile, 'utf8'));
const round = (n) => Math.round(n * 100) / 100;
const walls = [];
for (const w of scene.walls ?? []) {
  if (!Array.isArray(w.c) || w.c.length < 4 || !(w.sight > 0)) continue;       // walls that do not stop sight do not matter here
  const door = w.door === 1;                                                   // 1 = door, 2 = secret door (stays a wall until found)
  walls.push({ x1: round(w.c[0] - sceneX), y1: round(w.c[1] - sceneY), x2: round(w.c[2] - sceneX), y2: round(w.c[3] - sceneY), type: door ? 'door' : 'wall', open: door && w.ds === 1 });
}
const before = (config.walls || []).length;
config.walls = walls;
await writeFile(cfgFile, JSON.stringify(config, null, 2));
console.log(`${mapName}: ${before} walls -> ${walls.length} (${walls.filter((w) => w.type === 'door').length} doors) from scene "${scene.name}" (picture offset ${sceneX},${sceneY})`);
