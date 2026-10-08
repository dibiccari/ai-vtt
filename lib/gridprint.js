// Reading the printed 5 ft grid off a map picture (used by scripts/find-grid.mjs, grid-evidence.mjs, build-walls-from-layout.mjs).
// Walkable ground on the WotC maps is drawn with thin grid lines; rock, ledges and chasms are not. So where a grid line piece is printed, there is floor.
import { readPicture } from './bmpread.js';
import path from 'node:path';
import { picturePath } from './pictures.js';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// the picture the ink and grid are read from: the layout's inkPicture (full-size DM version) or its own picture
export function layoutPicturePath(layout) {
  return path.join(ROOT, layout.inkPicture || path.relative(ROOT, picturePath(ROOT, layout.picture)));
}
export const loadLayoutPicture = (layout) => readPicture(layoutPicturePath(layout));

// Contrast of a thin dark line against its surroundings, per pixel, for vertical lines (dx) and horizontal lines (dy).
function lineProfiles(pic) {
  const { w, h, lum } = pic;
  const col = new Float64Array(w), row = new Float64Array(h);
  const A = 5;
  for (let y = A; y < h - A; y++) {
    for (let x = A; x < w - A; x++) {
      const i = y * w + x, l = lum[i];
      if (l > 235) continue;
      const vx = (lum[i - A] + lum[i + A]) / 2 - l, vy = (lum[i - A * w] + lum[i + A * w]) / 2 - l;
      if (vx > 6) col[x] += Math.min(vx, 60);
      if (vy > 6) row[y] += Math.min(vy, 60);
    }
  }
  return { col, row };
}

// comb score of a profile for a period and an offset: mean at the teeth (a +-1 px window) against the mean of the whole profile
function comb(profile, period, offset) {
  let sum = 0, n = 0;
  for (let t = offset; t < profile.length - 1; t += period) {
    const c = Math.round(t);
    sum += Math.max(profile[Math.max(0, c - 1)], profile[c], profile[Math.min(profile.length - 1, c + 1)]);
    n++;
  }
  return n ? sum / n : 0;
}
function bestOffset(profile, period) {
  let best = -1, at = 0;
  for (let o = 0; o < period; o += 0.5) { const s = comb(profile, period, o); if (s > best) { best = s; at = o; } }
  return { score: best, offset: at };
}

// Finds the cell size and the origin (offset of the first grid line from the top-left corner, 0 <= origin < cell) of the printed grid.
export function detectGrid(pic, { minCell = 25, maxCell = 220 } = {}) {
  const { col, row } = lineProfiles(pic);
  const meanAll = (p) => p.reduce((a, b) => a + b, 0) / p.length;
  const mc = meanAll(col), mr = meanAll(row);
  const results = [];
  for (let p = minCell; p <= maxCell; p += 0.25) {
    const cx = bestOffset(col, p), cy = bestOffset(row, p);
    results.push({ p, score: (cx.score / (mc || 1) + cy.score / (mr || 1)) / 2, ox: cx.offset, oy: cy.offset });
  }
  const top = Math.max(...results.map((r) => r.score));
  // the smallest period that is nearly as good as the best (a double period hits only every other line and scores about the same)
  const near = results.filter((r) => r.score >= top * 0.9);
  let pick = near.reduce((a, b) => (b.p < a.p ? b : a));
  // local maximum around the pick
  const around = results.filter((r) => Math.abs(r.p - pick.p) <= 2);
  pick = around.reduce((a, b) => (b.score > a.score ? b : a));
  // refine the period finely and the offsets
  let bestP = pick.p, bestS = -1, ox = pick.ox, oy = pick.oy;
  for (let p = pick.p - 1; p <= pick.p + 1; p += 0.02) {
    const cx = bestOffset(col, p), cy = bestOffset(row, p);
    const s = cx.score / (mc || 1) + cy.score / (mr || 1);
    if (s > bestS) { bestS = s; bestP = p; ox = cx.offset; oy = cy.offset; }
  }
  // pictures are usually made for a whole number of squares across: snap to that when it is within a tenth of a square
  const across = pic.w / bestP;
  if (Math.abs(across - Math.round(across)) < 0.1) { bestP = pic.w / Math.round(across); const cx = bestOffset(col, bestP), cy = bestOffset(row, bestP); ox = cx.offset; oy = cy.offset; }
  // fine offsets (0.1 px)
  const fine = (profile, p, o0) => { let b = -1, at = o0; for (let o = o0 - 1; o <= o0 + 1; o += 0.1) { const s = comb(profile, p, o); if (s > b) { b = s; at = o; } } return at; };
  ox = fine(col, bestP, ox); oy = fine(row, bestP, oy);
  const sharp = bestS / 2;     // how many times stronger the teeth are than the average column: below about 2 the grid is probably not found
  return { cell: Math.round(bestP * 100) / 100, origin: [Math.round(ox * 10) / 10, Math.round(oy * 10) / 10], strength: Math.round(sharp * 100) / 100, size: [pic.w, pic.h] };
}

// Evidence that a grid line piece (a quarter square long) is printed. horizontal: the line is y = k cells, the piece covers x in [q/Q, (q+1)/Q].
// The piece counts when the pixels on the line are darker than both sides by `min` (median over the piece).
export function makeEvidence(pic, layout, Q = 4) {
  const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
  const L = (x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? 128 : pic.lum[Math.round(y) * pic.w + Math.round(x)]);
  return function evidence(horizontal, k, q) {
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
}

// Is the edge between two neighbouring quarter squares crossed by the thick dark outline of the picture? (share of dark pixels along the edge)
export function makeInkEdge(pic, layout, Q = 4, dark = 80) {
  const C = layout.cell, [ox, oy] = layout.origin || [0, 0];
  const L = (x, y) => (x < 0 || y < 0 || x >= pic.w || y >= pic.h ? 128 : pic.lum[Math.round(y) * pic.w + Math.round(x)]);
  // vertical edge at x = i/Q between quarter (i-1,j) and (i,j); horizontal edge at y = j/Q between (i,j-1) and (i,j)
  return function inked(horizontal, i, j) {
    let hit = 0, n = 0;
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const a = horizontal ? (i + t) / Q : i / Q, b = horizontal ? j / Q : (j + t) / Q;
      let dk = false;
      for (let d = -6; d <= 6; d += 2) if (L(ox + (a + (horizontal ? 0 : d / C)) * C, oy + (b + (horizontal ? d / C : 0)) * C) < dark) dk = true;
      n++; if (dk) hit++;
    }
    return hit / n > 0.35;
  };
}
