// Where a map picture lives on disk, for scripts and tests that read files directly. A picture is in the packet folder of its map set (data/mapsets/<guid>/<file>), or loose in
// public/uploads until a set adopts it. The server serves both as /uploads/<file>.
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// Map of picture file name -> absolute path, packets first.
export function pictureIndex(root) {
  const out = new Map();
  const uploads = path.join(root, 'public', 'uploads');
  for (const f of existsSync(uploads) ? readdirSync(uploads) : []) if (IMAGE_EXT.has(path.extname(f).toLowerCase())) out.set(f, path.join(uploads, f));
  const sets = path.join(root, 'data', 'mapsets');
  for (const ent of existsSync(sets) ? readdirSync(sets, { withFileTypes: true }) : []) {
    if (!ent.isDirectory()) continue;
    for (const f of readdirSync(path.join(sets, ent.name))) if (IMAGE_EXT.has(path.extname(f).toLowerCase())) out.set(f, path.join(sets, ent.name, f));
  }
  return out;
}
export const listPictures = (root) => [...pictureIndex(root).keys()];
export function picturePath(root, file) {
  const p = pictureIndex(root).get(path.basename(file));
  if (!p) throw new Error('picture not found: ' + file);
  return p;
}
// Every map set document, read from its packet (data/mapsets/<guid>/set.json) or an old flat file.
export function readSets(root, readFileSync) {
  const dir = path.join(root, 'data', 'mapsets'), out = [];
  for (const ent of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    try {
      if (ent.isDirectory()) out.push(JSON.parse(readFileSync(path.join(dir, ent.name, 'set.json'), 'utf8')));
      else if (ent.name.endsWith('.json')) out.push(JSON.parse(readFileSync(path.join(dir, ent.name), 'utf8')));
    } catch { /* not a set */ }
  }
  return out;
}
