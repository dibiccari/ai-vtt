// Place pins: the named places the players see on town and regional maps (Neverwinter, Phandalin, the Stonehill Inn). Shared by the tabletop and Map Test's Player view so both draw them
// the same way, and both read the same "Show places" switch (localStorage vtt.showPlaces). Start pins, numbered area pins and pins marked dmOnly are for the DM and never drawn here.
(function () {
  'use strict';
  var KEY = 'vtt.showPlaces';
  var isArea = function (n) { return /^area-\d+(-\d+)?$/.test(String(n)); };
  var P = {
    // A place pin a player may see: not the start, not a module area, not marked DM only.
    isPlace: function (pin) { return !!pin && pin.name !== 'start' && !isArea(pin.name) && pin.dmOnly !== true; },
    // Only plain (town and regional) maps show places to the players; on a battle map such pins are the DM's notes.
    appliesTo: function (kind) { return kind === 'town' || kind === 'regional'; },
    enabled: function () { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } },
    setEnabled: function (on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* not remembered */ } },
    label: function (pin) { return pin.label || String(pin.name).split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '); },
    // Draw pins given as { x, y, name, label } in the current drawing coordinates; `px` is one screen pixel in those coordinates (1 / zoom).
    // Labels never sit on top of each other: each one tries the right of its pin, then the left, then above, then below, and keeps the first spot that is free.
    draw: function (ctx, pins, px) {
      ctx.save();
      var size = 15 * px;
      ctx.font = '700 ' + size + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      var r = 6 * px, taken = [];
      var hits = function (a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; };
      pins.forEach(function (p) { taken.push({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }); });         // the dots themselves are also in the way
      pins.forEach(function (p) {
        ctx.fillStyle = '#f0c048'; ctx.strokeStyle = '#2a1d00'; ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2a1d00'; ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2); ctx.fill();
      });
      pins.forEach(function (p) {
        var text = P.label(p), w = ctx.measureText(text).width, h = size * 1.1, gap = r + 5 * px;
        var spots = [
          { x: p.x + gap, y: p.y - h / 2, align: 'left', tx: p.x + gap },
          { x: p.x - gap - w, y: p.y - h / 2, align: 'right', tx: p.x - gap },
          { x: p.x - w / 2, y: p.y - gap - h, align: 'center', tx: p.x, ty: p.y - gap - h / 2 },
          { x: p.x - w / 2, y: p.y + gap, align: 'center', tx: p.x, ty: p.y + gap + h / 2 }
        ];
        var pick = spots.filter(function (sp) { var box = { x: sp.x, y: sp.y, w: w, h: h }; return !taken.some(function (t) { return t.own !== p && hits(box, t); }); })[0] || spots[0];
        taken.push({ x: pick.x, y: pick.y, w: w, h: h, own: p });
        ctx.textAlign = pick.align;
        var ty = pick.ty !== undefined ? pick.ty : p.y;
        ctx.lineWidth = size / 4; ctx.strokeStyle = 'rgba(8, 6, 2, 0.9)'; ctx.strokeText(text, pick.tx, ty);
        ctx.fillStyle = '#fff3cf'; ctx.fillText(text, pick.tx, ty);
      });
      ctx.restore();
    }
  };
  window.PlacePins = P;
})();
