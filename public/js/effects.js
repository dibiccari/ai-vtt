// Animated regions drawn over a map picture: a flowing river or stream, lava, still water. Effects.draw(ctx, effects, t, unit): effects is a list of { type, points (polygon), path (centre line, optional), speed, color },
// all in the context's units; unit is the size of one map square; t is the time in seconds. The picture underneath shows the water or lava; this adds the movement (drifting ripples and glints along the flow, a
// pulsing glow and rising sparks for lava). Used by the tabletop and Map Test. Nothing is stored per frame: everything follows from t, so every viewer sees the same picture at the same moment.
(function (root) {
  'use strict';

  var hash = function (n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // The point at a fraction s (0..1) along a path and the unit direction there.
  function along(path, lens, total, s) {
    var d = s * total, i = 0;
    while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
    var a = path[i], b = path[Math.min(i + 1, path.length - 1)], l = lens[i] || 1, k = Math.max(0, Math.min(1, d / l));
    var dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * k, y: a.y + dy * k, tx: dx / m, ty: dy / m };
  }
  function measure(path) {
    var lens = [], total = 0;
    for (var i = 0; i < path.length - 1; i++) { var l = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y); lens.push(l); total += l; }
    return { lens: lens, total: total };
  }
  function clipTo(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.clip();
  }
  // The half width of the region around a path point: how far the polygon reaches either side (found by marching out until the point is outside).
  function inside(pts, x, y) {
    var c = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i].y > y) !== (pts[j].y > y)) && (x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) c = !c;
    }
    return c;
  }
  function halfWidth(pts, p, unit) {
    var nx = -p.ty, ny = p.tx, best = unit * 0.5;
    for (var side = -1; side <= 1; side += 2) {
      var w = 0;
      while (w < unit * 4 && inside(pts, p.x + nx * side * (w + 2), p.y + ny * side * (w + 2))) w += 2;
      best = Math.max(best, w);
    }
    return best;
  }

  function river(ctx, e, t, unit) {
    var path = e.path && e.path.length >= 2 ? e.path : null;
    var speed = e.speed || 1;
    ctx.save();
    clipTo(ctx, e.points);
    if (!path) {
      // no centre line: drift sideways in rows across the polygon's bounding box
      var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      e.points.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.2, unit * 0.04);
      for (var r = 0; r < 60; r++) {
        var y = miny + hash(r) * (maxy - miny), len = unit * (0.5 + hash(r + 9) * 0.8), x = minx + (((hash(r + 3) * (maxx - minx + len)) + t * unit * 0.8 * speed) % (maxx - minx + len)) - len;
        ctx.strokeStyle = 'rgba(235,248,255,' + (0.1 + 0.18 * hash(r + 5)) + ')';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + Math.sin(t + r) * unit * 0.04); ctx.stroke();
      }
      ctx.restore(); return;
    }
    var m = e._m || (e._m = measure(path));
    var hw = e._hw || (e._hw = (function () { var out = []; for (var i = 0; i <= 40; i++) out.push(halfWidth(e.points, along(path, m.lens, m.total, i / 40), unit)); return out; })());
    var count = Math.min(260, Math.max(40, Math.round(m.total / unit * 7)));
    ctx.lineCap = 'round';
    for (var k = 0; k < count; k++) {
      var lane = hash(k * 1.7) * 2 - 1;                          // across the river, -1 to 1
      var speedK = (0.18 + 0.1 * hash(k + 40)) * speed;          // faster in the middle of the stream
      var s = ((hash(k + 11) + t * speedK * (unit * 3 / m.total) * (1.2 - 0.6 * Math.abs(lane))) % 1 + 1) % 1;
      var p = along(path, m.lens, m.total, s), h = hw[Math.min(40, Math.round(s * 40))];
      var x = p.x + (-p.ty) * lane * h * 0.85, y = p.y + p.tx * lane * h * 0.85, len = unit * (0.35 + 0.5 * hash(k + 70)), sway = Math.sin(t * 2 + k) * unit * 0.03;
      ctx.lineWidth = Math.max(1.2, unit * (0.035 + 0.03 * hash(k + 90)));
      ctx.strokeStyle = 'rgba(' + (hash(k + 5) > 0.82 ? '255,255,255,' + 0.5 : '210,238,250,' + (0.12 + 0.22 * hash(k + 6))) + ')';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + p.tx * len + (-p.ty) * sway, y + p.ty * len + p.tx * sway); ctx.stroke();
    }
    // a slow dark shimmer so the surface is not flat
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(30,70,110,' + (0.05 + 0.025 * Math.sin(t * 1.3)) + ')';
    ctx.fillRect(Math.min.apply(null, e.points.map(function (p) { return p.x; })), Math.min.apply(null, e.points.map(function (p) { return p.y; })), 1e5, 1e5);
    ctx.restore();
  }

  function lava(ctx, e, t, unit) {
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    e.points.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    ctx.save();
    clipTo(ctx, e.points);
    ctx.globalCompositeOperation = 'lighter';
    var pulse = 0.5 + 0.5 * Math.sin(t * 1.6 * (e.speed || 1));
    ctx.fillStyle = 'rgba(255,90,10,' + (0.12 + 0.12 * pulse) + ')';
    ctx.fillRect(minx, miny, maxx - minx, maxy - miny);
    for (var k = 0; k < 40; k++) {                               // glowing blobs drifting slowly
      var x = minx + hash(k) * (maxx - minx) + Math.sin(t * 0.4 + k) * unit * 0.3, y = miny + hash(k + 33) * (maxy - miny) + Math.cos(t * 0.35 + k) * unit * 0.3;
      var g = ctx.createRadialGradient(x, y, 0, x, y, unit * (0.5 + hash(k + 8)));
      g.addColorStop(0, 'rgba(255,200,60,' + (0.28 * (0.5 + 0.5 * Math.sin(t * 1.1 + k))) + ')'); g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - unit * 2, y - unit * 2, unit * 4, unit * 4);
    }
    ctx.restore();
  }

  function still(ctx, e, t, unit) {
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    e.points.forEach(function (p) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); });
    ctx.save();
    clipTo(ctx, e.points);
    ctx.lineWidth = Math.max(1, unit * 0.03);
    for (var k = 0; k < 14; k++) {                               // slow expanding rings
      var cx = minx + hash(k) * (maxx - minx), cy = miny + hash(k + 20) * (maxy - miny), ph = ((t * 0.25 * (e.speed || 1) + hash(k + 4)) % 1);
      ctx.strokeStyle = 'rgba(230,245,255,' + (0.28 * (1 - ph)) + ')';
      ctx.beginPath(); ctx.ellipse(cx, cy, unit * 0.1 + ph * unit * 0.6, (unit * 0.1 + ph * unit * 0.6) * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(ctx, effects, t, unit) {
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      if (!e || !e.points || e.points.length < 3) continue;
      if (e.type === 'river') river(ctx, e, t, unit); else if (e.type === 'lava') lava(ctx, e, t, unit); else still(ctx, e, t, unit);
    }
  }
  root.Effects = { draw: draw };
})(typeof window !== 'undefined' ? window : globalThis);
