// A flickering campfire drawn over the map picture: a glow that wavers, flame tongues, a hot core and a few rising embers.
// Flicker.draw(ctx, x, y, unit, t): (x, y) is the fire's centre in the context's units, unit is the size of one map square,
// t is the time in seconds. Used by the tabletop and Map Test for lights marked "flicker" in the map config.
(function (root) {
  'use strict';

  // A wavering brightness between about 0.55 and 1 made of a few sine waves that never line up.
  function level(t, seed) {
    return 0.78 + 0.11 * Math.sin(t * 9.1 + seed) + 0.07 * Math.sin(t * 17.3 + seed * 2) + 0.05 * Math.sin(t * 31.7 + 3) + 0.03 * Math.sin(t * 53 + seed * 5);
  }

  function draw(ctx, x, y, unit, t) {
    var seed = (x * 0.013 + y * 0.007) % 6.28;
    var f = level(t, seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // The glow on the ground.
    var glowR = unit * (3.4 + 0.5 * f);
    var g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, 'rgba(255, 170, 70, ' + (0.42 * f) + ')');
    g.addColorStop(0.45, 'rgba(255, 110, 30, ' + (0.15 * f) + ')');
    g.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Flame tongues leaning and growing at different speeds.
    for (var k = 0; k < 5; k++) {
      var phase = seed + k * 1.9;
      var lean = Math.sin(t * (6 + k * 1.3) + phase) * 0.22;
      var height = unit * (0.34 + 0.2 * (0.5 + 0.5 * Math.sin(t * (9 + k * 2.1) + phase * 1.7))) * (0.75 + 0.5 * f);
      var ang = (k / 5) * Math.PI * 2 + 0.4;
      var bx = x + Math.cos(ang) * unit * 0.2, by = y + Math.sin(ang) * unit * 0.2;
      var tx = bx + Math.cos(ang) * height * 0.55 + Math.sin(ang) * height * lean, ty = by + Math.sin(ang) * height * 0.55 - Math.cos(ang) * height * lean;
      var w = unit * 0.17;
      var fg = ctx.createRadialGradient(bx, by, 0, bx, by, height);
      fg.addColorStop(0, 'rgba(255, 235, 150, 0.7)');
      fg.addColorStop(0.55, 'rgba(255, 140, 40, 0.4)');
      fg.addColorStop(1, 'rgba(255, 70, 10, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(bx - Math.sin(ang) * w, by + Math.cos(ang) * w);
      ctx.quadraticCurveTo((bx + tx) / 2 - Math.sin(ang) * w * 0.9, (by + ty) / 2 + Math.cos(ang) * w * 0.9, tx, ty);
      ctx.quadraticCurveTo((bx + tx) / 2 + Math.sin(ang) * w * 0.9, (by + ty) / 2 - Math.cos(ang) * w * 0.9, bx + Math.sin(ang) * w, by - Math.cos(ang) * w);
      ctx.closePath();
      ctx.fill();
    }

    // The hot core pulsing in the middle.
    var core = unit * (0.2 + 0.07 * f);
    var cg = ctx.createRadialGradient(x, y, 0, x, y, core * 1.6);
    cg.addColorStop(0, 'rgba(255, 245, 200, ' + (0.85 * f) + ')');
    cg.addColorStop(1, 'rgba(255, 150, 40, 0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, core * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Embers drifting up and fading.
    for (var i = 0; i < 6; i++) {
      var life = ((t * 0.32 + i * 0.167 + seed) % 1 + 1) % 1;
      var ex = x + Math.sin(t * 1.7 + i * 2.3 + seed) * unit * 0.45 * life + (i - 2.5) * unit * 0.1;
      var ey = y - life * unit * 1.9;
      ctx.fillStyle = 'rgba(255, 170, 70, ' + (0.85 * (1 - life)) + ')';
      ctx.beginPath();
      ctx.arc(ex, ey, unit * 0.04 * (1 - life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  root.Flicker = { draw: draw, level: level };
})(typeof window !== 'undefined' ? window : globalThis);
