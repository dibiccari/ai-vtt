// How fog of war looks. In a lit place the ground nobody has seen yet is hidden by a soft, cloudy WHITE fog and ground seen before but out of sight now is under a thin white haze;
// in a dark place the same layers are black, because there the cover is darkness. Shared by the tabletop and Map Test.
(function () {
  'use strict';
  var tile = null, shadeTile = null, layer = null;
  // A seamless tile of soft clouds: value noise at four scales, wrapped so the edges meet.
  function makeTile(shade) {
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
      var t = Math.max(0, Math.min(1, (v - 0.33) / 0.34)), j = (py * n + px) * 4;       // a steeper curve: more billowy light and shadow
      var lo = shade ? 70 : 0; img.data[j] = 150 - lo + 100 * t; img.data[j + 1] = 160 - lo + 92 * t; img.data[j + 2] = 178 - lo + 77 * t; img.data[j + 3] = 255;     // grey-blue shadows to white tops
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  var layer2 = null;
  // A screen-sized scratch canvas (kept between frames) with its 2d context.
  function scratch(name, cv) {
    var c = name === 'layer' ? layer : layer2;
    if (!c) { c = document.createElement('canvas'); if (name === 'layer') layer = c; else layer2 = c; }
    if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
    return c.getContext('2d');
  }
  // Two drifting cloud layers over whatever is already on x (source-atop: only where something is drawn).
  function paintClouds(x, cv, t) {
    x.globalCompositeOperation = 'source-atop';
    var passes = [[2.2, 34, 10, 0.85], [3.4, -22, 16, 0.5]];
    for (var i = 0; i < passes.length; i++) {
      var p = passes[i], pat = x.createPattern(i === 0 ? tile : shadeTile, 'repeat');
      if (!pat || !pat.setTransform) break;
      pat.setTransform(new DOMMatrix([p[0], 0, 0, p[0], t * p[1], t * p[2]]));
      x.globalAlpha = p[3]; x.fillStyle = pat; x.fillRect(0, 0, cv.width, cv.height);
    }
    x.globalAlpha = 1;
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
    // True when the white fog should move (a lit place, and the viewer has not asked for less motion).
    moves: function (dark) {
      if (dark) return false;
      try { if (localStorage.getItem('vtt.fogMotion') === 'off') return false; } catch (e) {}
      try { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return true; }
    },
    // Draws the explored layer. In a lit place two cloud layers drift slowly across the fog that is still there (the fog's own shape is kept); in the dark it is drawn as it is.
    // ctx carries the map-to-screen transform; the clouds are laid in screen space so they stay the same size when you zoom.
    // lit (optional): a canvas the size of the shroud, white where the ground is lit. Given when a map has light zones: the fog over lit ground is cloud, the fog over dark ground is black.
    draw: function (ctx, shroud, dark, now, lit) {
      var animated = FogStyle.moves(dark);
      if (dark && !lit && ctx.getTransform) {                         // darkness: the fog's shape in black, whatever colour it was painted in when the place was lit
        var cvD = ctx.canvas, mD = ctx.getTransform(), aD = ctx.globalAlpha, xD = scratch('layer', cvD);
        xD.setTransform(1, 0, 0, 1, 0, 0); xD.globalCompositeOperation = 'source-over'; xD.globalAlpha = 1; xD.clearRect(0, 0, cvD.width, cvD.height);
        xD.setTransform(mD); xD.drawImage(shroud, 0, 0); xD.setTransform(1, 0, 0, 1, 0, 0);
        xD.globalCompositeOperation = 'source-in'; xD.fillStyle = '#040508'; xD.fillRect(0, 0, cvD.width, cvD.height);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = aD; ctx.drawImage(layer, 0, 0); ctx.restore();
        return;
      }
      if ((!animated && !lit) || !ctx.getTransform) { ctx.drawImage(shroud, 0, 0); return; }
      if (!tile) tile = makeTile();
      if (!shadeTile) shadeTile = makeTile(true);
      var cv = ctx.canvas, m = ctx.getTransform(), a = ctx.globalAlpha, t = animated ? (now || 0) / 1000 : 0;
      var x = scratch('layer', cv);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, cv.width, cv.height);
      x.setTransform(m); x.drawImage(shroud, 0, 0);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-in'; x.fillStyle = lit ? '#040508' : '#b4bfcf'; x.fillRect(0, 0, cv.width, cv.height);       // the fog's shape (its alpha) in one flat colour, so every bit of cloud you see is the moving part
      if (!lit) { paintClouds(x, cv, t); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.drawImage(layer, 0, 0); ctx.restore(); return; }
      x.globalCompositeOperation = 'destination-out'; x.setTransform(m); x.drawImage(lit, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);          // black fog only over the dark ground
      var y = scratch('layer2', cv);
      y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-over'; y.globalAlpha = 1; y.clearRect(0, 0, cv.width, cv.height);
      y.setTransform(m); y.drawImage(shroud, 0, 0); y.setTransform(1, 0, 0, 1, 0, 0);
      y.globalCompositeOperation = 'source-in'; y.fillStyle = '#b4bfcf'; y.fillRect(0, 0, cv.width, cv.height);
      paintClouds(y, cv, t);
      y.globalCompositeOperation = 'destination-in'; y.setTransform(m); y.drawImage(lit, 0, 0); y.setTransform(1, 0, 0, 1, 0, 0);          // cloud fog only over the lit ground
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.drawImage(layer, 0, 0); ctx.drawImage(layer2, 0, 0); ctx.restore();
    },
    // The thin cover over ground that was seen before but is out of sight now.
    haze: function (dark) { return dark ? 'rgba(4, 5, 8, 0.55)' : 'rgba(228, 234, 243, 0.6)'; }
  };
})();
