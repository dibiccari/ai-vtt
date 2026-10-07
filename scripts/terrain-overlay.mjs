// Draws a map picture with its difficult terrain (data/maps/<picture>.json "difficult") tinted orange and the grid lines, so a guess can be reviewed without opening Map Test.
// Usage: node scripts/terrain-overlay.mjs <picture file name in public/uploads> <out.png> [scale 0.5] [c0,r0,c1,r1 to zoom on a range of squares]; the grid lines are numbered every 5 squares
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';
import { makeCrop } from '../lib/overlay.js';
import { ROOT } from '../lib/gridprint.js';

const [file, outArg, scaleArg, rangeArg] = process.argv.slice(2);
if (!file || !outArg) { console.error('usage: node scripts/terrain-overlay.mjs <picture> <out.png> [scale]'); process.exit(1); }
const config = JSON.parse(await readFile(path.join(ROOT, 'data', 'maps', file + '.json'), 'utf8'));
const pic = await readPicture(path.join(ROOT, 'public', 'uploads', file));
const cell = pic.w / config.squares, S = Number(scaleArg) || 0.5;
const cols = config.squares, rows = Math.round(pic.h / cell);
const range = rangeArg ? rangeArg.split(',').map(Number) : [0, 0, cols, rows];
const c = makeCrop(pic, { cell, origin: [0, 0] }, range, S);
for (const d of config.difficult || []) c.fillRect((d.x - c.X0) * S, (d.y - c.Y0) * S, (d.x + d.w - c.X0) * S, (d.y + d.h - c.Y0) * S, [255, 140, 0], 0.4);
for (let i = Math.ceil(range[0]); i <= range[2]; i++) c.line(c.toX(i), 0, c.toX(i), c.H, i % 5 === 0 ? [255, 255, 0] : [255, 255, 255], i % 5 === 0 ? 0.6 : 0.25, 1);
for (let j = Math.ceil(range[1]); j <= range[3]; j++) c.line(0, c.toY(j), c.W, c.toY(j), j % 5 === 0 ? [255, 255, 0] : [255, 255, 255], j % 5 === 0 ? 0.6 : 0.25, 1);
await writeFile(path.resolve(outArg), encodePng(c.out, c.W, c.H));
console.log(`${file}: ${(config.difficult || []).length} difficult rectangles drawn on ${cols}x${rows} squares -> ${outArg}`);
