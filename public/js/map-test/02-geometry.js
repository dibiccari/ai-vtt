'use strict';

/* ---------------- geometry (same algorithm as the tabletop in index.html) ---------------- */
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

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

const blockingWalls = (walls) => walls.filter((w) => !(w.type === 'door' && w.open && !w.secret));       // stops movement (a secret door is a wall)
const sightWalls = (walls) => blockingWalls(walls).filter((w) => w.type !== 'fence' && w.type !== 'window');       // stops sight: a fence or a window does not

// Cast rays at every wall endpoint (+/- epsilon) plus a uniform fan; `walls` must already exclude open doors.
function visibilityPolygon(ox, oy, walls, W, H) {
  const segments = walls.concat([
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
