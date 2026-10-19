// The tabletop, part of public/index.html: segments, rays and line of sight.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   GEOMETRY: SEGMENT INTERSECTION & RAYCASTING
   ===================================================================== */
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

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

// Distance along ray (origin p, unit dir d) to the nearest segment hit.
function castRay(px, py, dx, dy, segments) {
  let best = Infinity;
  for (const s of segments) {
    const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
    const den = cross(dx, dy, ex, ey);
    if (Math.abs(den) < 1e-12) continue;
    const sx = s.x1 - px, sy = s.y1 - py;
    const r = cross(sx, sy, ex, ey) / den;
    const u = cross(sx, sy, dx, dy) / den;
    if (r >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && r < best) best = r;
  }
  return best;
}

function pointSegmentDistance(px, py, w) {
  const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
  const len2 = ex * ex + ey * ey;
  let t = len2 ? ((px - w.x1) * ex + (py - w.y1) * ey) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (w.x1 + t * ex), py - (w.y1 + t * ey));
}

const blockingWalls = () => state.walls.filter((w) => !(w.type === 'door' && w.open && !w.secret));       // stops movement (a secret door is a wall until the DM reveals it)
// a flyer goes over low fences, windows and chasm bars, but not walls or closed doors
const flyerWalls = () => blockingWalls().filter((w) => w.type !== 'fence' && w.type !== 'window' && w.type !== 'bars');
const sightWalls = () => blockingWalls().filter((w) => w.type !== 'fence' && w.type !== 'window');                   // stops sight (a fence or a window stops movement only)

// Visibility polygon: cast rays at every wall endpoint (±epsilon) plus a uniform fan.
function visibilityPolygon(ox, oy) {
  const W = state.map.width, H = state.map.height;
  const segments = sightWalls().concat([
    { x1: 0, y1: 0, x2: W, y2: 0 },
    { x1: W, y1: 0, x2: W, y2: H },
    { x1: W, y1: H, x2: 0, y2: H },
    { x1: 0, y1: H, x2: 0, y2: 0 }
  ]);
  const angles = [];
  for (const s of segments) {
    const a1 = Math.atan2(s.y1 - oy, s.x1 - ox);
    const a2 = Math.atan2(s.y2 - oy, s.x2 - ox);
    angles.push(a1 - 1e-5, a1, a1 + 1e-5, a2 - 1e-5, a2, a2 + 1e-5);
  }
  const FAN = 90;
  for (let i = 0; i < FAN; i++) angles.push(-Math.PI + (i / FAN) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const points = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const dist = castRay(ox, oy, dx, dy, segments);
    if (dist !== Infinity) points.push({ x: ox + dx * dist, y: oy + dy * dist });
  }
  return points;
}

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

