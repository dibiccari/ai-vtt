// Small closed shapes made of wall segments (a tent, a boulder, a crate, a tree trunk) are things you see the top of, not rooms you
// stand in: line of sight stops at their edge, but the top should show when its edge is in view. Shared by the tabletop and Map Test.
// WallObjects.loops(walls, maxSize): the closed loops (arrays of {x,y}) at most maxSize across, from segments {x1,y1,x2,y2,type}.
// WallObjects.samples(loop, step): points a hair outside the loop's edges and corners; if any is visible the loop's top is.
(function (root) {
  'use strict';

  function loops(walls, maxSize) {
    var key = function (x, y) { return Math.round(x * 2) + ',' + Math.round(y * 2); };
    var verts = {};
    var segs = walls.filter(function (w) { return w.type !== 'door'; });
    segs.forEach(function (w, i) {
      [[w.x1, w.y1], [w.x2, w.y2]].forEach(function (p) {
        var k = key(p[0], p[1]);
        if (!verts[k]) verts[k] = { x: p[0], y: p[1], segs: [] };
        verts[k].segs.push(i);
      });
    });
    var seen = {}, out = [];
    segs.forEach(function (w, i) {
      if (seen[i]) return;
      // Walk from this segment, always taking the other segment at each end, until we are back (a loop) or run out (an open wall).
      var pts = [], cur = i, from = key(w.x1, w.y1), closed = false, guard = 0;
      while (guard++ < 400) {
        seen[cur] = true;
        var sg = segs[cur];
        var toKey = key(sg.x1, sg.y1) === from ? key(sg.x2, sg.y2) : key(sg.x1, sg.y1);
        pts.push(verts[from]);
        var v = verts[toKey];
        if (v.segs.length !== 2) break;
        var next = v.segs[0] === cur ? v.segs[1] : v.segs[0];
        if (next === i) { closed = true; break; }
        if (seen[next]) break;
        from = toKey;
        cur = next;
      }
      if (!closed || pts.length < 3) return;
      var xs = pts.map(function (q) { return q.x; }), ys = pts.map(function (q) { return q.y; });
      var size = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys));
      if (size <= maxSize) out.push(pts.map(function (q) { return { x: q.x, y: q.y }; }));
    });
    return out;
  }

  function samples(loop, step) {
    var cx = 0, cy = 0, out = [];
    loop.forEach(function (q) { cx += q.x; cy += q.y; });
    cx /= loop.length; cy /= loop.length;
    var push = function (x, y) {
      var d = Math.hypot(x - cx, y - cy) || 1;
      out.push({ x: x + ((x - cx) / d) * 5, y: y + ((y - cy) / d) * 5 });
    };
    for (var i = 0; i < loop.length; i++) {
      var a = loop[i], b = loop[(i + 1) % loop.length];
      push(a.x, a.y);
      var len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.floor(len / (step || 14)));
      for (var k = 1; k < n; k++) push(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
    }
    return out;
  }

  var api = { loops: loops, samples: samples };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WallObjects = api;
})(typeof window !== 'undefined' ? window : globalThis);
