// Builds a map config (walls, doors, fences) from a layout read off a picture: rooms and cave outlines in grid-cell units, openings, doors, fences.
// Usage: node scripts/build-walls-from-layout.mjs data/map-layouts/<name>.json
// Walls are the edges of every room and cave outline, minus the openings, with doors and fences added on top; secret doors stay as plain walls
// (their positions are saved in "secrets" of the config for the DM). Writes data/maps/<picture>.json (source 'dd2vtt': the picture already shows its walls).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const layout = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
import { readPicture } from '../lib/bmpread.js';
const px = (v, o) => Math.round((v * C + o) * 10) / 10;
// Snap each room edge to the thick dark outline drawn on the picture: scan outward from the floor along the edge and take the first dark run.
if (layout.snap) {
  const pic = await readPicture(path.join(root, layout.inkPicture || path.join('public', 'uploads', layout.picture)));
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
// Walkable ground is drawn with the 5 ft grid (tiles); rock, wall bands, ledges and chasms are not. The grid line pieces (a quarter of a square long) that are really
// printed on the picture mark the walkable ground; its edge, at a quarter-square resolution, becomes the cave walls. Edges next to a dark brown chasm become bars (movement stops, sight does not).
const inRoom = (cx, cy) => Object.values(layout.rooms).some(([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1);
const caveWalls = [], caveFences = [];
if (layout.caveMasks) {
  const pic = await readPicture(path.join(root, layout.inkPicture || path.join('public', 'uploads', layout.picture)));
  const L = (x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? 128 : pic.lum[Math.round(y) * pic.w + Math.round(x)]);
  const Q = 4;
  const evidence = (horizontal, k, q) => {
    const vals = [];
    for (let t = q / Q + 0.02; t <= (q + 1) / Q - 0.02; t += 0.02) {
      let line = 255, a = 0, b = 0, n = 0;
      for (let d = -2; d <= 2; d++) line = Math.min(line, L(horizontal ? ox + t * C : ox + k * C + d, horizontal ? oy + k * C + d : oy + t * C));
      for (let d = 7; d <= 11; d++) { a += L(horizontal ? ox + t * C : ox + k * C - d, horizontal ? oy + k * C - d : oy + t * C); b += L(horizontal ? ox + t * C : ox + k * C + d, horizontal ? oy + k * C + d : oy + t * C); n++; }
      vals.push((a / n + b / n) / 2 - line);
    }
    vals.sort((p, q2) => p - q2);
    return vals[Math.floor(vals.length / 2)];
  };
  for (const [name, cm] of Object.entries(layout.caveMasks)) {
    const [rx0, ry0, rx1, ry1] = cm.region, T = cm.min || 30, chasmLum = cm.chasmLum || 115;
    const qx0 = Math.floor(rx0 * Q), qx1 = Math.ceil(rx1 * Q), qy0 = Math.floor(ry0 * Q), qy1 = Math.ceil(ry1 * Q);
    const hCache = new Map(), vCache = new Map();
    const H = (k, q) => { const key = k + ',' + q; if (!hCache.has(key)) hCache.set(key, evidence(true, k, q) >= T); return hCache.get(key); };
    const V = (k, q) => { const key = k + ',' + q; if (!vCache.has(key)) vCache.set(key, evidence(false, k, q) >= T); return vCache.get(key); };
    const id = (i, j) => i + ',' + j;
    let mask = new Set();
    for (let j = qy0; j < qy1; j++) for (let i = qx0; i < qx1; i++) {
      if (inRoom((i + 0.5) / Q, (j + 0.5) / Q)) continue;
      const c = Math.floor(i / Q), r = Math.floor(j / Q), hl = (j % Q) < Q / 2 ? r : r + 1, vl = (i % Q) < Q / 2 ? c : c + 1;
      if (H(hl, i) && V(vl, j)) mask.add(id(i, j));
    }
    const nb = (i, j) => [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
    for (let pass = 0; pass < (cm.close ?? 1); pass++) {       // close single-quarter gaps
      const add = [];
      for (let j = qy0; j < qy1; j++) for (let i = qx0; i < qx1; i++) {
        if (mask.has(id(i, j)) || inRoom((i + 0.5) / Q, (j + 0.5) / Q)) continue;
        if (nb(i, j).filter(([a, b]) => mask.has(id(a, b))).length >= 3 || (mask.has(id(i - 1, j)) && mask.has(id(i + 1, j))) || (mask.has(id(i, j - 1)) && mask.has(id(i, j + 1)))) add.push(id(i, j));
      }
      for (const k of add) mask.add(k);
    }
    // fill small holes (furniture, stones) that are not connected to the outside
    const holeMax = cm.holeMax ?? 24, seenH = new Set();
    for (let j = qy0; j < qy1; j++) for (let i = qx0; i < qx1; i++) {
      const k0 = id(i, j);
      if (mask.has(k0) || seenH.has(k0) || inRoom((i + 0.5) / Q, (j + 0.5) / Q)) continue;
      const comp = [], st = [[i, j]]; seenH.add(k0); let open = false;
      while (st.length) {
        const [ci, cj] = st.pop(); comp.push(id(ci, cj));
        for (const [ni, nj] of nb(ci, cj)) {
          if (ni < qx0 || ni >= qx1 || nj < qy0 || nj >= qy1 || inRoom((ni + 0.5) / Q, (nj + 0.5) / Q)) { open = true; continue; }
          const kk = id(ni, nj); if (!mask.has(kk) && !seenH.has(kk)) { seenH.add(kk); st.push([ni, nj]); }
        }
      }
      if (!open && comp.length <= holeMax) for (const q of comp) mask.add(q);
    }
    // drop small specks
    const seen = new Set(); const keep = new Set();
    for (const k of mask) { if (seen.has(k)) continue; const comp = [], st = [k]; seen.add(k); while (st.length) { const q = st.pop(); comp.push(q); const [i, j] = q.split(',').map(Number); for (const [a, b] of nb(i, j)) { const kk = id(a, b); if (mask.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } } } if (comp.length >= (cm.minPiece || 40)) for (const q of comp) keep.add(q); }
    mask = keep;
    if (process.env.SHOWMASK) { for (let j = qy0; j < qy1; j += 2) { let line = String(j / Q).padStart(5) + ' '; for (let i = qx0; i < qx1; i += 2) line += inRoom((i + 0.5) / Q, (j + 0.5) / Q) ? '#' : mask.has(id(i, j)) ? 'o' : '.'; console.log(line); } }
    const sideDark = (i, j) => { // is the non-floor quarter on the other side a dark brown chasm?
      let sum = 0, n = 0; const x0 = ox + i / Q * C, y0 = oy + j / Q * C;
      for (let dx = 0.2; dx < 1; dx += 0.3) for (let dy = 0.2; dy < 1; dy += 0.3) { sum += L(x0 + dx * C / Q, y0 + dy * C / Q); n++; }
      return sum / n < chasmLum;
    };
    for (const k of mask) {
      const [i, j] = k.split(',').map(Number);
      for (const [di, dj] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const ni = i + di, nj = j + dj;
        if (mask.has(id(ni, nj)) || inRoom((ni + 0.5) / Q, (nj + 0.5) / Q)) continue;
        const e = dj === -1 ? [i / Q, j / Q, (i + 1) / Q, j / Q] : dj === 1 ? [i / Q, (j + 1) / Q, (i + 1) / Q, (j + 1) / Q] : di === -1 ? [i / Q, j / Q, i / Q, (j + 1) / Q] : [(i + 1) / Q, j / Q, (i + 1) / Q, (j + 1) / Q];
        (sideDark(ni, nj) ? caveFences : caveWalls).push(e);
      }
    }
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
for (const f of mergeAxis(caveFences)) walls.push(toPx(f, 'fence'));
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
const width = (layout.width || 2475);
cfg = { ...cfg, squares: Math.round(width / C), walls, source: 'dd2vtt', secrets: (layout.secrets || []).map((s) => ({ name: s.name, ...toPx(s.h !== undefined ? [s.from, s.h, s.to, s.h] : [s.v, s.from, s.v, s.to], 'wall') })) };
await writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
for (const copy of layout.copies || []) await writeFile(path.join(root, 'data', 'maps', copy + '.json'), JSON.stringify(cfg, null, 2) + '\n');   // the same walls for the other picture of this map (the DM version)
console.log(layout.picture + ': ' + walls.filter((w) => w.type === 'wall').length + ' walls, ' + walls.filter((w) => w.type === 'door').length + ' doors, ' + walls.filter((w) => w.type === 'fence').length + ' fences, ' + cfg.secrets.length + ' secret doors');
