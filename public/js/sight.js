// Walls, rays and line of sight: the one copy the tabletop and Map Test share (window.Sight; also loadable in Node for tests). Pure: the walls and the map size are passed in.
// A wall is {x1, y1, x2, y2, type, open, secret} in picture pixels. A closed door and a plain wall stop sight and movement; an open door stops neither (unless it is secret, which is a wall until revealed);
// a fence or a window stops movement only; chasm bars stop walkers but not flyers.
(function (root) {
  'use strict';

  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

  // Distance along the ray (origin p, unit direction d) to the nearest segment it hits; Infinity when it hits none.
  function castRay(px, py, dx, dy, segments) {
    var best = Infinity;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var ex = s.x2 - s.x1, ey = s.y2 - s.y1;
      var den = cross(dx, dy, ex, ey);
      if (Math.abs(den) < 1e-12) continue;
      var sx = s.x1 - px, sy = s.y1 - py;
      var r = cross(sx, sy, ex, ey) / den;
      var u = cross(sx, sy, dx, dy) / den;
      if (r >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && r < best) best = r;
    }
    return best;
  }

  function pointSegmentDistance(px, py, w) {
    var ex = w.x2 - w.x1, ey = w.y2 - w.y1;
    var len2 = ex * ex + ey * ey;
    var t = len2 ? ((px - w.x1) * ex + (py - w.y1) * ey) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    return Math.hypot(px - (w.x1 + t * ex), py - (w.y1 + t * ey));
  }

  // Stops movement: every wall except an open door (a secret door is a wall until the DM reveals it).
  function blockingWalls(walls) { return walls.filter(function (w) { return !(w.type === 'door' && w.open && !w.secret); }); }
  // A flyer goes over low fences, windows and chasm bars, but not walls or closed doors.
  function flyerWalls(walls) { return blockingWalls(walls).filter(function (w) { return w.type !== 'fence' && w.type !== 'window' && w.type !== 'bars'; }); }
  // Stops sight (and light): a fence or a window stops movement only.
  function sightWalls(walls) { return blockingWalls(walls).filter(function (w) { return w.type !== 'fence' && w.type !== 'window'; }); }

  // Visibility polygon from (ox, oy): rays at every wall endpoint (plus and minus a hair) and a uniform fan, each stopped by the nearest wall or the edge of the map (W x H).
  // `walls` is what stops sight (sightWalls), open doors already left out.
  function visibilityPolygon(ox, oy, walls, W, H) {
    var segments = walls.concat([
      { x1: 0, y1: 0, x2: W, y2: 0 },
      { x1: W, y1: 0, x2: W, y2: H },
      { x1: W, y1: H, x2: 0, y2: H },
      { x1: 0, y1: H, x2: 0, y2: 0 }
    ]);
    var angles = [];
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var a1 = Math.atan2(s.y1 - oy, s.x1 - ox);
      var a2 = Math.atan2(s.y2 - oy, s.x2 - ox);
      angles.push(a1 - 1e-5, a1, a1 + 1e-5, a2 - 1e-5, a2, a2 + 1e-5);
    }
    var FAN = 90;
    for (var k = 0; k < FAN; k++) angles.push(-Math.PI + (k / FAN) * Math.PI * 2);
    angles.sort(function (a, b) { return a - b; });
    var points = [];
    for (var j = 0; j < angles.length; j++) {
      var a = angles[j];
      var dx = Math.cos(a), dy = Math.sin(a);
      var dist = castRay(ox, oy, dx, dy, segments);
      if (dist !== Infinity) points.push({ x: ox + dx * dist, y: oy + dy * dist });
    }
    return points;
  }

  var api = { cross: cross, castRay: castRay, pointSegmentDistance: pointSegmentDistance, blockingWalls: blockingWalls, flyerWalls: flyerWalls, sightWalls: sightWalls, visibilityPolygon: visibilityPolygon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sight = api;
})(typeof window !== 'undefined' ? window : globalThis);
