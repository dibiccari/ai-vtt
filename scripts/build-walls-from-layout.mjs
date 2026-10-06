// Builds a map config (walls, doors, fences) from a layout read off a picture: rooms and cave outlines in grid-cell units, openings, doors, fences.
// Usage: node scripts/build-walls-from-layout.mjs data/map-layouts/<name>.json
// Walls are the edges of every room and cave outline, minus the openings, with doors and fences added on top; secret doors stay as plain walls
// (their positions are saved in "secrets" of the config for the DM). Writes data/maps/<picture>.json (source 'dd2vtt': the picture already shows its walls).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const layout = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
import { readPicture } from '../lib/bmpread.js';
import { loadLayoutPicture, layoutPicturePath } from '../lib/gridprint.js';
import { caveFloorMask } from '../lib/cavemask.js';
const px = (v, o) => Math.round((v * C + o) * 10) / 10;
// Snap each room edge to the thick dark outline drawn on the picture: scan outward from the floor along the edge and take the first dark run.
if (layout.snap) {
  const pic = await loadLayoutPicture(layout);
  const lumAt = (x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? 255 : pic.lum[Math.round(y) * pic.w + Math.round(x)]);
  const inOpening = (cx, cy) => (layout.openings || []).some(([ax, ay, bx, by]) => cx > ax && cx < bx && cy > ay && cy < by);
  const dark = layout.darkBelow || 80, need = layout.darkShare || 0.4, reach = Math.round(C * 0.55);
  const stats = [];
  // side: 0 top, 1 right, 2 bottom, 3 left; returns the refined coordinate in cell units
  const refine = (room, side) => {
    const [x0, y0, x1, y1] = room;
    const horiz = side === 0 || side === 2;
    const line = [y0, x1, y1, x0][side];
    const a = (horiz ? x0 : y0) + 0.2, b = (horiz ? x1 : y1) - 0.2;
    const out = side === 0 || side === 3 ? -1 : 1;                          // which way is outside the room
    const samples = [];
    for (let t = a; t <= b; t += 0.04) samples.push(t);
    const share = (off) => {
      let hit = 0, n = 0;
      for (const t of samples) {
        const cx = horiz ? t : line + off / C, cy = horiz ? line + off / C : t;
        if (inOpening(cx, cy)) continue;
        n++;
        const X = (horiz ? t : line + off / C) * C + ox, Y = (horiz ? line + off / C : t) * C + oy;
        if (lumAt(X, Y) < dark) hit++;
      }
      return n ? hit / n : 0;
    };
    let start = null;
    for (let off = -Math.round(C * 0.4); off <= reach; off += 1) {           // from well inside the floor (off < 0 is inside) outward to the first thick outline
      const o = out * off;
      if (share(o) >= need) { start = o; break; }
    }
    if (start === null) { stats.push('no ink'); return line; }
    // the dark run is the thick outline: take its middle
    let last = start;
    for (let k = 1; k <= 30; k++) { const o = start + out * k; if (share(o) < need * 0.6) break; last = o; }
    return line + ((start + last) / 2) / C;
  };
  for (const [name, room] of Object.entries(layout.rooms)) {
    const before = room.slice();
    room[1] = refine(before, 0); room[2] = refine(before, 1); room[3] = refine(before, 2); room[0] = refine(before, 3);
    const moved = room.map((v, i) => Math.round((v - before[i]) * C)).join(',');
    console.log('snap', name.padEnd(8), 'moved px (x0,y0,x1,y1):', moved);
  }
}
// Walkable ground is drawn with the 5 ft grid (tiles); rock, wall bands, ledges and chasms are not. lib/cavemask.js turns the grid line pieces really printed on the picture
// (grown a little across edges the thick outline does not cross) into the floor; its edge becomes the cave walls, edges next to a dark brown chasm become bars.
const caveWalls = [], caveFences = [];
if (layout.caveMasks) {
  const pic = await loadLayoutPicture(layout);
  for (const [name, cm] of Object.entries(layout.caveMasks)) {
    const res = caveFloorMask(pic, layout, cm);
    caveWalls.push(...res.walls); caveFences.push(...res.fences);
    console.log('cave', name.padEnd(10), res.mask.size + ' floor cells (1/' + res.res + ' square), ' + res.walls.length + ' wall edges, ' + res.fences.length + ' bar edges (' + res.droppedFences + ' noisy bar edges dropped)');
  }
}
const segs = [];
for (const e of caveWalls) segs.push(e);
const add = (x1, y1, x2, y2) => { if (Math.hypot(x2 - x1, y2 - y1) > 1e-6) segs.push([x1, y1, x2, y2]); };
for (const [x0, y0, x1, y1] of Object.values(layout.rooms)) { add(x0, y0, x1, y0); add(x1, y0, x1, y1); add(x1, y1, x0, y1); add(x0, y1, x0, y0); }
for (const pts of Object.values(layout.caves || {})) for (let i = 0; i < pts.length; i++) add(pts[i][0], pts[i][1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
// Cut every wall into pieces of at most a quarter square, drop the pieces whose middle is inside an opening, then merge what is left.
const pieces = [];
for (const [x1, y1, x2, y2] of segs) {
  const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const p = [x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b];
    const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2;
    if ((layout.openings || []).some(([ax, ay, bx, by]) => mx > ax && mx < bx && my > ay && my < by)) continue;
    pieces.push(p);
  }
}
// Remove pieces covered by a door or secret door span? No: doors replace wall there, secrets stay walls.
const onSpan = (p, d) => { const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2; return d.h !== undefined ? Math.abs(my - d.h) < 0.05 && mx > d.from && mx < d.to : Math.abs(mx - d.v) < 0.05 && my > d.from && my < d.to; };
const edgeLines = [...Object.values(layout.rooms).flatMap(([x0, y0, x1, y1]) => [{ h: y0, a: x0, b: x1 }, { h: y1, a: x0, b: x1 }, { v: x0, a: y0, b: y1 }, { v: x1, a: y0, b: y1 }]), ...(layout.fences || []).map((f) => ({ h: f.h, a: f.from, b: f.to }))];
const onWall = (d) => edgeLines.some((e) => (d.h !== undefined ? e.h !== undefined && Math.abs(e.h - d.h) <= 0.6 : e.v !== undefined && Math.abs(e.v - d.v) <= 0.6) && Math.min(e.b, d.to) - Math.max(e.a, d.from) > 0.3);
const allDoors = [...(layout.detectedDoors || []).filter(onWall), ...(layout.doors || [])];
// a door removes the wall pieces of both faces of the wall band that lie within its span
const inDoor = (p, d) => { const mx = (p[0] + p[2]) / 2, my = (p[1] + p[3]) / 2; return d.h !== undefined ? Math.abs(my - d.h) <= 0.6 && mx > d.from - 0.02 && mx < d.to + 0.02 && Math.abs(p[1] - p[3]) < 1e-6 : Math.abs(mx - d.v) <= 0.6 && my > d.from - 0.02 && my < d.to + 0.02 && Math.abs(p[0] - p[2]) < 1e-6; };
const kept = pieces.filter((p) => !allDoors.some((d) => inDoor(p, d)));
// merge collinear neighbours
function mergeAxis(list) {
  const key = (p) => (Math.abs(p[1] - p[3]) < 1e-6 ? 'h' + Math.round(p[1] * 1000) : 'v' + Math.round(p[0] * 1000));
  const groups = new Map();
  for (const p of list) { const k = key(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const out = [];
  for (const [k, items] of groups) {
    const horiz = k[0] === 'h';
    const iv = items.map((p) => (horiz ? [Math.min(p[0], p[2]), Math.max(p[0], p[2]), p[1]] : [Math.min(p[1], p[3]), Math.max(p[1], p[3]), p[0]])).sort((x, y) => x[0] - y[0]);
    let cur = null;
    for (const [lo, hi, c] of iv) {
      if (cur && lo <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], hi);
      else { if (cur) out.push(horiz ? [cur[0], cur[2], cur[1], cur[2]] : [cur[2], cur[0], cur[2], cur[1]]); cur = [lo, hi, c]; }
    }
    if (cur) out.push(horiz ? [cur[0], cur[2], cur[1], cur[2]] : [cur[2], cur[0], cur[2], cur[1]]);
  }
  return out;
}
const merged = mergeAxis(kept);
// Slanted cave edges were cut the same way; merging only joins axis-aligned runs, so keep the others as they are.
const slanted = pieces.filter((p) => Math.abs(p[0] - p[2]) > 1e-6 && Math.abs(p[1] - p[3]) > 1e-6);
const toPx = (s, type, extra = {}) => ({ x1: px(s[0], ox), y1: px(s[1], oy), x2: px(s[2], ox), y2: px(s[3], oy), type, open: false, ...extra });
const walls = [...merged, ...slanted].map((s) => toPx(s, 'wall'));
for (const d of allDoors) walls.push(toPx(d.h !== undefined ? [d.from, d.h, d.to, d.h] : [d.v, d.from, d.v, d.to], 'door', d.locked ? { locked: true } : {}));
// a bridge (rectangles in cell units, read from the legend's bridge symbol) lets you cross a chasm: no bars inside it
const onBridge = (f) => (layout.bridges || []).some(([bx0, by0, bx1, by1]) => (f[0] + f[2]) / 2 > bx0 - 0.1 && (f[0] + f[2]) / 2 < bx1 + 0.1 && (f[1] + f[3]) / 2 > by0 - 0.1 && (f[1] + f[3]) / 2 < by1 + 0.1);
for (const f of mergeAxis(caveFences).filter((f) => !onBridge(f))) walls.push(toPx(f, 'fence'));
for (const f of layout.fences || []) {
  // a fence (bars) with a door gap: split it around any door lying on it
  const gaps = allDoors.filter((d) => d.h !== undefined && Math.abs(d.h - f.h) < 0.1 && d.from >= f.from - 0.2 && d.to <= f.to + 0.2).sort((a, b) => a.from - b.from);
  let at = f.from;
  for (const g of gaps) { if (g.from > at) walls.push(toPx([at, f.h, g.from, f.h], 'fence')); at = g.to; }
  if (at < f.to) walls.push(toPx([at, f.h, f.to, f.h], 'fence'));
}
const file = path.join(root, 'data', 'maps', layout.picture + '.json');
let cfg = {};
try { cfg = JSON.parse(await readFile(file, 'utf8')); } catch { /* new map */ }
const width = layout.width || Number(execFileSync('sips', ['-g', 'pixelWidth', path.join(root, 'public', 'uploads', layout.picture)]).toString().match(/pixelWidth: (\d+)/)[1]);
// the rooms as rectangles in picture pixels: the table's 'small closed wall loop = object whose top shows' rule must not treat a room as an object (see public/wallobjects.js)
const roomRects = Object.values(layout.rooms).map(([x0, y0, x1, y1]) => [px(x0, ox), px(y0, oy), px(x1, ox), px(y1, oy)]);
// arrival spots (layout.starts: name -> [column,row] in cell units, the middle of that cell) are written only when the config has none yet: pins placed on Map Test win
const starts = cfg.starts && cfg.starts.length ? cfg.starts : Object.entries(layout.starts || {}).map(([name, [c, r]]) => ({ name, x: px(c + 0.5, ox), y: px(r + 0.5, oy) }));
cfg = { ...cfg, ...(starts.length ? { starts } : {}), squares: Math.round(width / C), walls, rooms: roomRects, source: 'dd2vtt', secrets: (layout.secrets || []).map((s) => ({ name: s.name, ...toPx(s.h !== undefined ? [s.from, s.h, s.to, s.h] : [s.v, s.from, s.v, s.to], 'wall') })) };
await writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
for (const copy of layout.copies || []) await writeFile(path.join(root, 'data', 'maps', copy + '.json'), JSON.stringify(cfg, null, 2) + '\n');   // the same walls for the other picture of this map (the DM version)
console.log(layout.picture + ': ' + walls.filter((w) => w.type === 'wall').length + ' walls, ' + walls.filter((w) => w.type === 'door').length + ' doors, ' + walls.filter((w) => w.type === 'fence').length + ' fences, ' + cfg.secrets.length + ' secret doors');
