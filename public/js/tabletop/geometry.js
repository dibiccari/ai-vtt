// The tabletop, part of public/index.html: segments, rays and line of sight.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   GEOMETRY: SEGMENT INTERSECTION & RAYCASTING
   ===================================================================== */
// The shared pieces (public/js/sight.js): the rays, the wall kinds and the visibility polygon take the walls as arguments; the wrappers below pass the table's.
const { cross, castRay, pointSegmentDistance } = Sight;

// Does segment p1->p2 intersect wall segment w? (endpoints inclusive)
function segmentsIntersect(p1x, p1y, p2x, p2y, w) {
  const dx = p2x - p1x, dy = p2y - p1y;
  const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
  const den = cross(dx, dy, ex, ey);
  if (Math.abs(den) < 1e-9) return false;
  const sx = w.x1 - p1x, sy = w.y1 - p1y;
  const r = cross(sx, sy, ex, ey) / den;
  const u = cross(sx, sy, dx, dy) / den;
  return r >= 0 && r <= 1 && u >= 0 && u <= 1;
}

const blockingWalls = () => Sight.blockingWalls(state.walls);       // stops movement (a secret door is a wall until the DM reveals it)
// a flyer goes over low fences, windows and chasm bars, but not walls or closed doors
const flyerWalls = () => Sight.flyerWalls(state.walls);
const sightWalls = () => Sight.sightWalls(state.walls);                   // stops sight (a fence or a window stops movement only)

// Visibility polygon: cast rays at every wall endpoint (±epsilon) plus a uniform fan.
function visibilityPolygon(ox, oy) { return Sight.visibilityPolygon(ox, oy, sightWalls(), state.map.width, state.map.height); }

// moveN is the footprint (squares across) of the creature whose range is being worked out; (c, r) are top-left squares. A big creature
// is blocked when any square of its body would cross a wall (so it cannot squeeze through a gap narrower than itself), or when a wall
// stands inside the footprint it would end on.
let moveN = 1;
const inFp = (c, r) => inBounds(c, r) && inBounds(c + moveN - 1, r + moveN - 1);
function moveBlocked(c1, r1, c2, r2, walls) {
  if (moveN > 1) {
    for (let i = 0; i < moveN; i++) {
      for (let j = 0; j < moveN; j++) {
        const x1 = centerOf(c1 + i), y1 = centerOf(r1 + j), x2 = centerOf(c2 + i), y2 = centerOf(r2 + j);
        for (const w of walls) if (segmentsIntersect(x1, y1, x2, y2, w)) return true;
        // a wall between two squares of the destination footprint
        if (i + 1 < moveN) { const ax = centerOf(c2 + i), ay = centerOf(r2 + j); for (const w of walls) if (segmentsIntersect(ax, ay, centerOf(c2 + i + 1), ay, w)) return true; }
        if (j + 1 < moveN) { const ax = centerOf(c2 + i), ay = centerOf(r2 + j); for (const w of walls) if (segmentsIntersect(ax, ay, ax, centerOf(r2 + j + 1), w)) return true; }
      }
    }
    return false;
  }
  const x1 = centerOf(c1), y1 = centerOf(r1), x2 = centerOf(c2), y2 = centerOf(r2);
  for (const w of walls) {
    if (segmentsIntersect(x1, y1, x2, y2, w)) return true;
  }
  return false;
}

