// Finds the printed grid of a map picture: the cell size and the origin (where the first grid line sits), and writes them to the layout.
// Usage: node scripts/find-grid.mjs <layout.json>             reads layout.inkPicture (or public/uploads/<layout.picture>), sets "cell" and "origin", prints the strength
//        node scripts/find-grid.mjs <picture.jpg> [--layout <layout.json>]   just prints, or writes into the layout (created when missing)
// The grid is only printed on walkable ground, so the search is a comb over the dark thin lines of the whole picture; origin is 0 <= origin < cell.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { detectGrid, layoutPicturePath, ROOT } from '../lib/gridprint.js';

const args = process.argv.slice(2);
const first = args.find((a) => !a.startsWith('--'));
if (!first) { console.error('usage: node scripts/find-grid.mjs <layout.json | picture> [--layout file] [--min 25] [--max 220]'); process.exit(1); }
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
let layoutFile = null, layout = null, pictureFile;
if (first.endsWith('.json')) {
  layoutFile = path.resolve(first);
  layout = JSON.parse(await readFile(layoutFile, 'utf8'));
  pictureFile = layoutPicturePath(layout);
} else {
  pictureFile = path.resolve(first);
  if (opt('layout')) {
    layoutFile = path.resolve(opt('layout'));
    try { layout = JSON.parse(await readFile(layoutFile, 'utf8')); } catch { layout = { picture: path.basename(pictureFile), rooms: {} }; }
  }
}
const pic = await readPicture(pictureFile);
const g = detectGrid(pic, { minCell: Number(opt('min', 25)), maxCell: Number(opt('max', 220)) });
console.log(`picture ${path.relative(ROOT, pictureFile)} ${pic.w}x${pic.h}: cell ${g.cell} px, origin ${g.origin.join(', ')}, strength ${g.strength} (teeth against average; under about 2 is doubtful), about ${(pic.w / g.cell).toFixed(1)} x ${(pic.h / g.cell).toFixed(1)} squares`);
if (layout && layoutFile) {
  // a layout that already has rooms keeps its row/column numbering: shift the detected origin by whole cells to the one nearest the old origin
  if (Array.isArray(layout.origin) && Object.keys(layout.rooms || {}).length) {
    g.origin = g.origin.map((v, i) => Math.round((v + Math.round((layout.origin[i] - v) / g.cell) * g.cell) * 10) / 10);
    console.log('kept the numbering of the existing rooms: origin ' + g.origin.join(', '));
  }
  layout.cell = g.cell; layout.origin = g.origin; layout.width = pic.w; layout.height = pic.h;
  await writeFile(layoutFile, JSON.stringify(layout, null, 2) + '\n');
  console.log('written to ' + path.relative(ROOT, layoutFile));
}
