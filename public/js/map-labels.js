// Map labels: the words on a regional map (region names, place names, trail and road names), drawn by code over the picture because image models never paint words.
// Shared by the tabletop and Map Test's Player view so both look the same, and both read the same "Show labels" switch (localStorage vtt.showLabels).
// A label is { id, text, kind: 'region'|'place'|'trail', x, y, size?, rot?, path? } in the current drawing coordinates (the tabletop scales the saved image pixels first).
// The layout helpers at the top are pure functions (positions and angles along a polyline), tested in test/map-labels.test.mjs.
(function (root) {
  'use strict';
  var KEY = 'vtt.showLabels';

  // ---------------------------------------------------------------- pure layout helpers
  // Total length of a polyline [{x,y}].
  function pathLength(pts) {
    var n = 0;
    for (var i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return n;
  }
  // The point at distance s along the polyline (clamped to its ends) and the direction of the segment it lies on (radians).
  function pointAt(pts, s) {
    if (pts.length < 2) return { x: pts.length ? pts[0].x : 0, y: pts.length ? pts[0].y : 0, angle: 0 };
    var left = Math.max(0, s);
    for (var i = 1; i < pts.length; i++) {
      var seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (left <= seg || i === pts.length - 1) {
        var t = seg > 0 ? Math.min(1, left / seg) : 0;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, angle: Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) };
      }
      left -= seg;
    }
    return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, angle: 0 };
  }
  // Text reads left to right: if the path mostly runs leftwards, walk it the other way round so no word is upside down.
  function readable(pts) {
    if (pts.length < 2) return pts;
    var a = pts[0], b = pts[pts.length - 1];
    return b.x < a.x ? pts.slice().reverse() : pts;
  }
  // Place glyphs along a polyline. `widths` is the width of each glyph, `spacing` the extra gap between glyphs (all in the same units as the path).
  // The text is centred on the path; each glyph sits at the middle of its own width and is turned to the path's direction there (smoothed over the glyph's width so a bend does not tear a letter).
  // Returns [{ i, x, y, angle }] (angle in radians) and the text width; a text longer than the path starts at the path's start.
  function layoutAlong(points, widths, spacing) {
    var pts = readable(points || []), gap = spacing || 0, out = [], total = 0, i;
    for (i = 0; i < widths.length; i++) total += widths[i] + (i ? gap : 0);
    if (pts.length < 2 || !widths.length) return { glyphs: out, width: total, length: pts.length > 1 ? pathLength(pts) : 0 };
    var len = pathLength(pts), at = Math.max(0, (len - total) / 2);
    for (i = 0; i < widths.length; i++) {
      var mid = at + widths[i] / 2;
      var p = pointAt(pts, mid), a = pointAt(pts, mid - widths[i] / 2), b = pointAt(pts, mid + widths[i] / 2);
      var angle = (a.x === b.x && a.y === b.y) ? p.angle : Math.atan2(b.y - a.y, b.x - a.x);
      out.push({ i: i, x: p.x, y: p.y, angle: angle });
      at += widths[i] + gap;
    }
    return { glyphs: out, width: total, length: len };
  }
  // The straight line a label without a path sits on: centred on (x, y), rot degrees, `w` long.
  function straightPath(x, y, rotDeg, w) {
    var a = (rotDeg || 0) * Math.PI / 180, dx = Math.cos(a) * w / 2, dy = Math.sin(a) * w / 2;
    return [{ x: x - dx, y: y - dy }, { x: x + dx, y: y + dy }];
  }

  // ---------------------------------------------------------------- looks per kind
  // size: default letter height in picture pixels; minScreen: never smaller than this many screen pixels (readable when zoomed out);
  // fadeFrom / fadeTo: the screen size at which the label starts to fade and is gone (zoomed in so far that the words would shout over the map).
  var STYLE = {
    region: { size: 46, spacing: 0.22, minScreen: 11, fadeFrom: 110, fadeTo: 230, weight: '700', family: 'Georgia, "Times New Roman", serif', fill: 'rgba(38, 24, 10, 0.62)', halo: 'rgba(255, 248, 228, 0.7)', upper: true },
    place: { size: 18, spacing: 0.02, minScreen: 11, fadeFrom: 90, fadeTo: 190, weight: '700', family: 'Georgia, "Times New Roman", serif', fill: 'rgba(30, 20, 8, 0.9)', halo: 'rgba(255, 248, 228, 0.85)', upper: false },
    trail: { size: 20, spacing: 0.1, minScreen: 11, fadeFrom: 80, fadeTo: 170, weight: 'italic 600', family: 'Georgia, "Times New Roman", serif', fill: 'rgba(110, 24, 18, 0.88)', halo: 'rgba(255, 248, 228, 0.85)', upper: false }
  };
  function visibility(kind, screenSize) {
    var st = STYLE[kind] || STYLE.place;
    if (screenSize <= st.fadeFrom) return 1;
    if (screenSize >= st.fadeTo) return 0;
    return 1 - (screenSize - st.fadeFrom) / (st.fadeTo - st.fadeFrom);
  }
  // The size a label is drawn at in drawing coordinates: its own size, but never below minScreen screen pixels (px = one screen pixel in drawing coordinates).
  function drawSize(label, px) {
    var st = STYLE[label.kind] || STYLE.place;
    return Math.max(label.size > 0 ? label.size : st.size, st.minScreen * px);
  }

  var L = {
    pathLength: pathLength, pointAt: pointAt, readable: readable, layoutAlong: layoutAlong, straightPath: straightPath, visibility: visibility, drawSize: drawSize, STYLE: STYLE,
    // Labels belong on regional maps.
    appliesTo: function (kind) { return kind === 'regional'; },
    enabled: function () { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } },
    setEnabled: function (on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* not remembered */ } },
    // Draw labels given in the current drawing coordinates; `px` is one screen pixel in those coordinates (1 / zoom). Returns how many were drawn (not faded out completely).
    draw: function (ctx, labels, px) {
      var drawn = 0;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      (labels || []).forEach(function (lb) {
        if (!lb || !lb.text) return;
        var st = STYLE[lb.kind] || STYLE.place, size = drawSize(lb, px), alpha = visibility(lb.kind, size / px);
        if (alpha <= 0.01) return;
        var text = st.upper ? String(lb.text).toUpperCase() : String(lb.text);
        ctx.font = st.weight + ' ' + size + 'px ' + st.family;
        var chars = Array.from(text), widths = chars.map(function (c) { return ctx.measureText(c).width; });
        var gap = size * st.spacing;
        var path = lb.path && lb.path.length >= 2 ? lb.path : null;
        var first = layoutAlong(path || straightPath(lb.x, lb.y, lb.rot, 1), widths, gap);
        if (!path) path = straightPath(lb.x, lb.y, lb.rot, first.width);
        else if (first.width > first.length && first.length > 0) {          // the name is longer than its path: make the letters smaller so it fits
          var k = first.length / first.width * 0.96;
          size *= k; widths = widths.map(function (w) { return w * k; }); gap *= k; ctx.font = st.weight + ' ' + size + 'px ' + st.family;
        }
        var lay = layoutAlong(path, widths, gap);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = size * 0.24; ctx.strokeStyle = st.halo; ctx.fillStyle = st.fill;
        for (var pass = 0; pass < 2; pass++) {                              // every halo first, then every letter, so a halo never covers the next letter
          lay.glyphs.forEach(function (g) {
            ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.angle);
            if (pass === 0) ctx.strokeText(chars[g.i], 0, 0); else ctx.fillText(chars[g.i], 0, 0);
            ctx.restore();
          });
        }
        drawn++;
      });
      ctx.restore();
      return drawn;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.MapLabels = L;
})(typeof window !== 'undefined' ? window : globalThis);
