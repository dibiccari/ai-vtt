// How far a painted picture kept to a wall layout: for each wall centre line (axis-aligned segments, as in public/scenarios/compare/image-test/layout.json) the picture's brightness is read across the
// wall and the shift that makes the stone band stand out most from the floor on both sides is taken as that wall's drift. It is an estimate, good to a few pixels, not a proof.
// Returns { walls, medianPx, within8, within20, worstPx } (shares are 0 to 1).
import { readPicture } from './bmpread.js';

export async function wallDrift(picturePath, layout) {
  const img = await readPicture(picturePath);
  const sx = img.w / layout.size[0], sy = img.h / layout.size[1];            // the picture may be a different size from the layout
  const L = (x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h) ? null : img.lum[Math.round(y) * img.w + Math.round(x)];
  const half = layout.wall / 2;
  const shifts = [];
  for (const w of layout.walls) {
    const horizontal = w.y1 === w.y2;
    const len = horizontal ? Math.abs(w.x2 - w.x1) : Math.abs(w.y2 - w.y1);
    if (len < 60) continue;
    const at = (along, across) => horizontal ? [(Math.min(w.x1, w.x2) + along) * sx, (w.y1 + across) * sy] : [(w.x1 + across) * sx, (Math.min(w.y1, w.y2) + along) * sy];
    // the edge strength at one offset across the wall: how much the brightness changes there, averaged along the wall (stretches near doors and corners are skipped)
    const edge = (across) => {
      let sum = 0, n = 0;
      for (let along = 50; along < len - 50; along += 5) { const [x0, y0] = at(along, across - 3), [x1, y1] = at(along, across + 3); const v0 = L(x0, y0), v1 = L(x1, y1); if (v0 != null && v1 != null) { sum += Math.abs(v1 - v0); n++; } }
      return n ? sum / n : null;
    };
    let best = null;
    for (let s = -60; s <= 60; s += 2) {
      const e1 = edge(s - half), e2 = edge(s + half);
      if (e1 == null || e2 == null) continue;
      const strength = e1 + e2;                                                 // both edges of the stone band should be strong at the right shift
      if (!best || strength > best.strength) best = { s, strength };
    }
    if (best) shifts.push(Math.abs(best.s));
  }
  shifts.sort((a, b) => a - b);
  const q = (p) => shifts.length ? shifts[Math.min(shifts.length - 1, Math.floor(p * shifts.length))] : null;
  return { walls: shifts.length, medianPx: q(0.5), within8: shifts.filter((v) => v <= 8).length / (shifts.length || 1), within20: shifts.filter((v) => v <= 20).length / (shifts.length || 1), worstPx: shifts.length ? shifts[shifts.length - 1] : null };
}
