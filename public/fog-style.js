// How fog of war looks. In a lit place the ground nobody has seen yet is hidden by a soft, cloudy WHITE fog and ground seen before but out of sight now is under a thin white haze;
// in a dark place the same layers are black, because there the cover is darkness. Shared by the tabletop and Map Test.
(function () {
  'use strict';
  var tile = null;
  // A seamless tile of soft clouds: value noise at four scales, wrapped so the edges meet.
  function makeTile() {
    var n = 256, c = document.createElement('canvas'); c.width = n; c.height = n;
    var x = c.getContext('2d'), img = x.createImageData(n, n);
    var seed = 20261015; var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    var octaves = [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]].map(function (o) {
      var g = o[0], lat = []; for (var i = 0; i < g * g; i++) lat.push(rnd()); return { g: g, a: o[1], lat: lat };
    });
    var smooth = function (t) { return t * t * (3 - 2 * t); };
    for (var py = 0; py < n; py++) for (var px = 0; px < n; px++) {
      var v = 0;
      for (var k = 0; k < octaves.length; k++) {
        var o = octaves[k], fx = px / n * o.g, fy = py / n * o.g, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
        var at = function (a, b) { return o.lat[((b % o.g) * o.g) + (a % o.g)]; };
        var top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx, bot = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        v += (top * (1 - ty) + bot * ty) * o.a;
      }
      var t = Math.max(0, Math.min(1, (v - 0.25) / 0.6)), j = (py * n + px) * 4;
      img.data[j] = 196 + 54 * t; img.data[j + 1] = 205 + 47 * t; img.data[j + 2] = 218 + 36 * t; img.data[j + 3] = 255;     // grey-blue shadows to white tops
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  window.FogStyle = {
    // The fill for the never-explored cover: clouds in a lit place, near-black in a dark one.
    shroudFill: function (ctx, dark) {
      if (dark) return '#040508';
      if (!tile) tile = makeTile();
      var pat = ctx.createPattern(tile, 'repeat');
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([3, 0, 0, 3, 0, 0]));
      return pat || '#dde3ec';
    },
    // The thin cover over ground that was seen before but is out of sight now.
    haze: function (dark) { return dark ? 'rgba(4, 5, 8, 0.55)' : 'rgba(228, 234, 243, 0.6)'; }
  };
})();
