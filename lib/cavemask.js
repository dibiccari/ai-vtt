// The walkable ground of a cave read from the picture (used by scripts/build-walls-from-layout.mjs and scripts/grid-evidence.mjs).
// 1. SEEDS: a quarter square is floor when both the grid line piece above/below it and the one left/right of it are printed (lib/gridprint.js makeEvidence).
//    Walkable ground is drawn with the grid, rock is not, so the seeds are sure floor but they have gaps where the printed grid is faint.
// 2. FLOOD: from the seeds, fill every neighbouring cell of the map that is not crossed by the thick dark outline (cells of C/res px; a cell is outline when a sample in it is darker
//    than cm.inkDark in at least cm.inkShare, default 0.4, of its samples). The outline closes the cave, so the fill stops there; it never goes further than cm.reach (1.2) squares from a seed,
//    so a hole in the outline cannot flood the rock.
// 3. Close small holes (furniture, stalagmites), drop specks, apply the hand corrections cm.add / cm.remove (rectangles in cell units).
// Edges of the floor become walls; edges next to a dark brown chasm become bars (fences); bar runs shorter than cm.minFence cells are dropped as noise.
import { makeEvidence } from './gridprint.js';

export function caveFloorMask(pic, layout, cm) {
  const R = cm.res ?? 8;                                  // mask cells per square side (8 = 10 px on a 82.5 px square)
  const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
  const L = (x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? 128 : pic.lum[Math.round(y) * pic.w + Math.round(x)]);
  const dark = cm.inkDark ?? layout.darkBelow ?? 80;
  // a dark pixel is outline unless it is green (bushes and briars are dark too, but they are ground you can enter): cm.greenIsInk true turns that off
  const isDark = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= pic.w || y >= pic.h) return false;
    const p = y * pic.w + x;
    if (pic.lum[p] >= dark) return false;
    if (cm.greenIsInk) return true;
    const r = pic.rgb[p * 3], g = pic.rgb[p * 3 + 1], b = pic.rgb[p * 3 + 2];
    return !(g - r > 12 && g >= b - 5);
  };
  const evidence = makeEvidence(pic, layout, 4);
  const inRoom = (cx, cy) => Object.values(layout.rooms || {}).some(([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1);
  const [rx0, ry0, rx1, ry1] = cm.region, T = cm.min || 30, chasmLum = cm.chasmLum || 115;
  const qx0 = Math.floor(rx0 * R), qx1 = Math.ceil(rx1 * R), qy0 = Math.floor(ry0 * R), qy1 = Math.ceil(ry1 * R);
  const id = (i, j) => i + ',' + j;
  const roomQ = (i, j) => inRoom((i + 0.5) / R, (j + 0.5) / R);
  const blocked = (i, j) => (cm.remove || []).some((r) => (i + 0.5) / R > r[0] && (i + 0.5) / R < r[2] && (j + 0.5) / R > r[1] && (j + 0.5) / R < r[3]);     // cm.remove: rectangles that are never floor (a legend box, the frame)
  const inside = (i, j) => i >= qx0 && i < qx1 && j >= qy0 && j < qy1 && !blocked(i, j);
  const nb = (i, j) => [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
  // outline cells
  const inkCell = new Map();
  const isInk = (i, j) => {
    const k = id(i, j);
    if (!inkCell.has(k)) {
      let dk = 0, n = 0; const x0 = ox + i / R * C, y0 = oy + j / R * C, s = C / R;      // a cell is outline when 40% of its samples are dark (texture speckles are not)
      for (let a = 0.1; a < 1; a += 0.2) for (let b = 0.1; b < 1; b += 0.2) { n++; if (isDark(x0 + a * s, y0 + b * s)) dk++; }
      inkCell.set(k, dk / n >= (cm.inkShare ?? 0.4));
    }
    return inkCell.get(k);
  };
  // 1. seeds, found on the quarter-square lattice and expanded to mask cells
  const hC = new Map(), vC = new Map();
  const Hq = (k, q) => { const key = k + ',' + q; if (!hC.has(key)) hC.set(key, evidence(true, k, q) >= T); return hC.get(key); };
  const Vq = (k, q) => { const key = k + ',' + q; if (!vC.has(key)) vC.set(key, evidence(false, k, q) >= T); return vC.get(key); };
  const q0x = Math.floor(rx0 * 4), q1x = Math.ceil(rx1 * 4), q0y = Math.floor(ry0 * 4), q1y = Math.ceil(ry1 * 4);
  let quarters = new Set();
  const qid = (i, j) => i + ',' + j;
  for (let j = q0y; j < q1y; j++) for (let i = q0x; i < q1x; i++) {
    const c = Math.floor(i / 4), r = Math.floor(j / 4), hl = (j % 4) < 2 ? r : r + 1, vl = (i % 4) < 2 ? c : c + 1;
    if (Hq(hl, i) && Vq(vl, j)) quarters.add(qid(i, j));
  }
  for (let pass = 0; pass < (cm.close ?? 1); pass++) {       // close single-quarter gaps
    const add = [];
    for (let j = q0y; j < q1y; j++) for (let i = q0x; i < q1x; i++) {
      if (quarters.has(qid(i, j))) continue;
      if (nb(i, j).filter(([a, b]) => quarters.has(qid(a, b))).length >= 3 || (quarters.has(qid(i - 1, j)) && quarters.has(qid(i + 1, j))) || (quarters.has(qid(i, j - 1)) && quarters.has(qid(i, j + 1)))) add.push(qid(i, j));
    }
    for (const k of add) quarters.add(k);
  }
  const seeds = new Set();
  const per = R / 4;
  const inSeedRect = (i, j) => (cm.seeds || []).some((r) => (i + 0.5) / R > r[0] && (i + 0.5) / R < r[2] && (j + 0.5) / R > r[1] && (j + 0.5) / R < r[3]);
  for (let j = qy0; j < qy1; j++) for (let i = qx0; i < qx1; i++) if (inside(i, j) && !roomQ(i, j) && !isInk(i, j) && inSeedRect(i, j)) seeds.add(id(i, j));     // cm.seeds: rectangles in cell units whose outline-free cells are floor (water, a faint area)
  for (const k of quarters) { const [i, j] = k.split(',').map(Number); for (let a = 0; a < per; a++) for (let b = 0; b < per; b++) { const ci = i * per + a, cj = j * per + b; if (inside(ci, cj) && !roomQ(ci, cj) && !isInk(ci, cj)) seeds.add(id(ci, cj)); } }
  // 2. flood from all seeds at once, across cells without outline, at most cm.reach squares (default 1.2) away from a seed: gaps in the grid are filled up to the outline,
  //    and where the outline itself has a hole the fill can spill at most that far into the rock.
  let mask = new Set(seeds);
  let frontier = [...seeds];
  const maxStep = Math.round((cm.reach ?? 1.2) * R);
  for (let step = 0; step < maxStep && frontier.length; step++) {
    const next = [];
    for (const k of frontier) {
      const [i, j] = k.split(',').map(Number);
      for (const [a, b] of nb(i, j)) { const kk = id(a, b); if (mask.has(kk) || !inside(a, b) || roomQ(a, b) || isInk(a, b)) continue; mask.add(kk); next.push(kk); }
    }
    frontier = next;
  }
  // a hole in the outline lets the fill spill out as a blob joined by a narrow neck: open the fill (erode, keep what still touches a seed, grow back) to cut such necks off; the seeds always stay
  {
    const r = cm.neck ?? 2;
    const eroded = new Set();
    for (const k of mask) { const [i, j] = k.split(',').map(Number); let all = true; for (let a = -r; a <= r && all; a++) for (let b = -r; b <= r; b++) if (!mask.has(id(i + a, j + b))) { all = false; break; } if (all) eroded.add(k); }
    const keepE = new Set(), seenE = new Set();
    for (const k of eroded) {
      if (seenE.has(k)) continue;
      const comp = [], st = [k]; seenE.add(k); let hasSeed = false;
      while (st.length) { const q = st.pop(); comp.push(q); if (seeds.has(q)) hasSeed = true; const [i, j] = q.split(',').map(Number); for (const [a, b] of nb(i, j)) { const kk = id(a, b); if (eroded.has(kk) && !seenE.has(kk)) { seenE.add(kk); st.push(kk); } } }
      if (hasSeed) for (const q of comp) keepE.add(q);
    }
    const opened = new Set(seeds);
    for (const k of keepE) { const [i, j] = k.split(',').map(Number); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const kk = id(i + a, j + b); if (mask.has(kk)) opened.add(kk); } }
    mask = opened;
  }
  // 3. small holes (furniture, stones) that are not connected to the outside become floor
  const holeMax = (cm.holeMax ?? 24) * (R / 4) * (R / 4), seenH = new Set();
  for (let j = qy0; j < qy1; j++) for (let i = qx0; i < qx1; i++) {
    const k0 = id(i, j);
    if (mask.has(k0) || seenH.has(k0) || roomQ(i, j)) continue;
    const comp = [], st = [[i, j]]; seenH.add(k0); let open = false;
    while (st.length) {
      const [ci, cj] = st.pop(); comp.push(id(ci, cj));
      for (const [ni, nj] of nb(ci, cj)) {
        if (!inside(ni, nj) || roomQ(ni, nj)) { open = true; continue; }
        const kk = id(ni, nj); if (!mask.has(kk) && !seenH.has(kk)) { seenH.add(kk); st.push([ni, nj]); }
      }
    }
    if (!open && comp.length <= holeMax) for (const q of comp) mask.add(q);
  }
  // drop small specks
  const seenS = new Set(), keep = new Set(), minPiece = (cm.minPiece || 40) * (R / 4) * (R / 4);
  for (const k of mask) {
    if (seenS.has(k)) continue;
    const comp = [], st = [k]; seenS.add(k);
    while (st.length) { const q = st.pop(); comp.push(q); const [i, j] = q.split(',').map(Number); for (const [a, b] of nb(i, j)) { const kk = id(a, b); if (mask.has(kk) && !seenS.has(kk)) { seenS.add(kk); st.push(kk); } } }
    if (comp.length >= minPiece) for (const q of comp) keep.add(q);
  }
  mask = keep;
  // hand corrections: rectangles in cell units that are floor (add) or rock (remove)
  const inRect = (r, i, j) => (i + 0.5) / R > r[0] && (i + 0.5) / R < r[2] && (j + 0.5) / R > r[1] && (j + 0.5) / R < r[3];
  for (const r of cm.add || []) for (let j = Math.floor(r[1] * R); j < Math.ceil(r[3] * R); j++) for (let i = Math.floor(r[0] * R); i < Math.ceil(r[2] * R); i++) if (inRect(r, i, j) && !roomQ(i, j)) mask.add(id(i, j));
  for (const r of cm.remove || []) for (const k of [...mask]) { const [i, j] = k.split(',').map(Number); if (inRect(r, i, j)) mask.delete(k); }
  const sideDark = (i, j) => {       // is the non-floor cell on the other side a dark brown chasm?
    let sum = 0, n = 0; const x0 = ox + i / R * C, y0 = oy + j / R * C;
    for (let dx = 0.2; dx < 1; dx += 0.3) for (let dy = 0.2; dy < 1; dy += 0.3) { sum += L(x0 + dx * C / R, y0 + dy * C / R); n++; }
    return sum / n < chasmLum && cm.bars !== false;
  };
  // A chasm is a dark hole with floor all around it; the dark rock beyond the outer edge of the cave is not (it joins the outside of the region). Only holes closed in by floor get bars.
  const qx0b = Math.floor(rx0 * R), qx1b = Math.ceil(rx1 * R), qy0b = Math.floor(ry0 * R), qy1b = Math.ceil(ry1 * R);
  const outside = new Set(), stack = [];
  const pushOut = (i, j) => { const k = id(i, j); if (!outside.has(k) && !mask.has(k) && !roomQ(i, j)) { outside.add(k); stack.push([i, j]); } };
  for (let i = qx0b - 1; i <= qx1b; i++) { pushOut(i, qy0b - 1); pushOut(i, qy1b); }
  for (let j = qy0b - 1; j <= qy1b; j++) { pushOut(qx0b - 1, j); pushOut(qx1b, j); }
  while (stack.length) { const [i, j] = stack.pop(); for (const [a2, b2] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) if (a2 >= qx0b - 1 && a2 <= qx1b && b2 >= qy0b - 1 && b2 <= qy1b) pushOut(a2, b2); }
  // hand-read chasm rectangles (cm.chasms, cell units): the legend's bridge symbols show where the chasm is. The edge of floor next to a chasm gets bars, any other edge a wall.
  const inChasm = (i, j) => (cm.chasms || []).some((r) => (i + 0.5) / R > r[0] && (i + 0.5) / R < r[2] && (j + 0.5) / R > r[1] && (j + 0.5) / R < r[3]);
  const walls = [], fences = [];
  for (const k of mask) {
    const [i, j] = k.split(',').map(Number);
    for (const [di, dj] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ni = i + di, nj = j + dj;
      if (mask.has(id(ni, nj)) || roomQ(ni, nj)) continue;
      const e = dj === -1 ? [i / R, j / R, (i + 1) / R, j / R] : dj === 1 ? [i / R, (j + 1) / R, (i + 1) / R, (j + 1) / R] : di === -1 ? [i / R, j / R, i / R, (j + 1) / R] : [(i + 1) / R, j / R, (i + 1) / R, (j + 1) / R];
      ((cm.chasms ? inChasm(ni, nj) : sideDark(ni, nj) && !outside.has(id(ni, nj))) ? fences : walls).push(e);
    }
  }
  // bar runs that are only a few cells long are noise (a shadow or a stone), not a chasm edge
  const minFence = (cm.minFence ?? 3) * (R / 4);
  const pk = (x, y) => Math.round(x * R) + ',' + Math.round(y * R);
  const byPoint = new Map();
  fences.forEach((e, n) => { for (const p of [pk(e[0], e[1]), pk(e[2], e[3])]) { if (!byPoint.has(p)) byPoint.set(p, []); byPoint.get(p).push(n); } });
  const done = new Set(), keptFences = [];
  fences.forEach((e, n) => {
    if (done.has(n)) return;
    const comp = [], st = [n]; done.add(n);
    while (st.length) { const m = st.pop(); comp.push(m); const f = fences[m]; for (const p of [pk(f[0], f[1]), pk(f[2], f[3])]) for (const o of byPoint.get(p)) if (!done.has(o)) { done.add(o); st.push(o); } }
    if (comp.length >= minFence) for (const m of comp) keptFences.push(fences[m]);
  });
  return { mask, res: R, isInk, walls, fences: keptFences, droppedFences: fences.length - keptFences.length };
}
