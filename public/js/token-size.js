// Creature size, footprint, height and flight: pure helpers shared by the tabletop, the server and the tests (2014 PHB "Creature Size").
// Space: Tiny 2 1/2 ft (four fit in a square), Small and Medium 5 ft, Large 10 ft (2 x 2 squares), Huge 15 ft (3 x 3), Gargantuan 20 ft or more (4 x 4 at least).
// A token's (col, row) is the top-left square of its footprint.
(function (root) {
  'use strict';

  var SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
  var SQUARES = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

  function normalize(size) {
    var s = String(size == null ? '' : size).toLowerCase().trim();
    for (var i = 0; i < SIZES.length; i++) if (s === SIZES[i] || s.indexOf(SIZES[i]) === 0) return SIZES[i];
    return 'medium';
  }
  function squares(size) { return SQUARES[normalize(size)]; }
  function drawScale(size) { return normalize(size) === 'tiny' ? 0.5 : SQUARES[normalize(size)]; }   // Tiny is drawn at half a square across
  // one step smaller (the squeezing rule: a creature can squeeze through a space for a creature one size smaller)
  function smaller(size) { var i = SIZES.indexOf(normalize(size)); return SIZES[Math.max(0, i - 1)]; }

  // The squares a footprint covers, as [col, row] pairs.
  function cells(col, row, n) {
    var out = [];
    for (var dc = 0; dc < n; dc++) for (var dr = 0; dr < n; dr++) out.push([col + dc, row + dr]);
    return out;
  }
  // Footprints a = {col,row,n} and b overlap when they share a square.
  function overlaps(a, b) {
    return a.col < b.col + b.n && b.col < a.col + a.n && a.row < b.row + b.n && b.row < a.row + a.n;
  }
  // Edge-to-edge distance in squares (0 = overlapping, 1 = touching: within 5 ft of reach). Squares count like the table's reach test: diagonals are 1.
  function gap(a, b) {
    var dx = Math.max(0, a.col - (b.col + b.n - 1), b.col - (a.col + a.n - 1));
    var dy = Math.max(0, a.row - (b.row + b.n - 1), b.row - (a.row + a.n - 1));
    return Math.max(dx, dy);
  }
  // Centre of a footprint in square units (a 1x1 token at col 3 is at 3.5; a 2x2 at col 3 is at 4).
  function centre(col, row, n) { return { x: col + n / 2, y: row + n / 2 }; }
  // Top-left square for a footprint of n squares centred on the square (cc, cr): n = 2 gets (cc, cr) as its lower-right-of-centre square, 3 is exactly centred.
  function topLeftFor(cc, cr, n) { var k = Math.floor((n - 1) / 2); return { col: cc - k, row: cr - k }; }

  // Falling: 1d6 bludgeoning per 10 feet, at most 20d6; the creature lands prone (unless it avoids the damage).
  function fallDice(feet) { return Math.max(0, Math.min(20, Math.floor(Number(feet) / 10) || 0)); }
  // Can a melee attacker with this reach (feet) hit a target `gapSquares` away horizontally (edge to edge) and `dElevFt` higher or lower?
  // The reach has to cover both the horizontal and the vertical distance.
  function meleeReaches(reachFt, gapSquares, dElevFt) {
    var horizontal = Math.max(0, gapSquares) * 5;
    return Math.max(horizontal, Math.abs(dElevFt || 0)) <= reachFt;
  }

  // Speeds from an SRD or adventure creature entry: {walk, fly}. SRD: speed {walk:"30 ft.", fly:"60 ft."}; the adventure file packs it as walk "0 ft., fly 60 ft.".
  function parseSpeeds(speed) {
    var out = { walk: NaN, fly: 0 };
    if (!speed) return out;
    var walkText = String(speed.walk == null ? '' : speed.walk);
    out.walk = parseInt(walkText, 10);
    var m = /fly\s+(\d+)/i.exec(walkText) || /^(\d+)/.exec(String(speed.fly == null ? '' : speed.fly));
    if (m) out.fly = parseInt(m[1], 10);
    return out;
  }

  // Where to put a creature the DM asked for at (col, row) when that square is a pin or already taken: somewhere in the vicinity, so a group is not stacked into one tile or a
  // tidy line. o = { col, row, n (footprint), id, taken: [{col,row,n}], fits(c, r) -> boolean (on the map, free, no wall in between) }. The choice is repeatable (a hash of the id),
  // prefers nearer squares but may leave a gap, and the area grows with how many creatures are already around (2 squares, up to 4). Returns { col, row } or null when nothing fits.
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function scatter(o) {
    var n = o.n || 1, crowd = 0, id = String(o.id || '');
    (o.taken || []).forEach(function (t) { if (Math.abs(t.col - o.col) <= 4 && Math.abs(t.row - o.row) <= 4) crowd += 1; });
    for (var R = Math.min(4, 2 + Math.floor(crowd / 3)); R <= 9; R += 1) {
      var cand = [], total = 0;
      for (var dc = -R; dc <= R; dc++) for (var dr = -R; dr <= R; dr++) {
        var c = o.col + dc, r = o.row + dr, d = Math.max(Math.abs(dc), Math.abs(dr));
        if (!o.fits(c, r)) continue;
        var w = d === 0 ? 0.6 : 1 / (0.6 + d * 0.5);                        // near squares are likelier, far ones still possible
        cand.push({ col: c, row: r, w: w }); total += w;
      }
      if (!cand.length) continue;
      var pick = hash(id + ':' + crowd) * total, run = 0;
      for (var i = 0; i < cand.length; i++) { run += cand[i].w; if (pick <= run) return { col: cand[i].col, row: cand[i].row }; }
      return { col: cand[cand.length - 1].col, row: cand[cand.length - 1].row };
    }
    return null;
  }

  var api = { scatter: scatter, SIZES: SIZES, normalize: normalize, squares: squares, drawScale: drawScale, smaller: smaller, cells: cells, overlaps: overlaps, gap: gap, centre: centre, topLeftFor: topLeftFor, fallDice: fallDice, meleeReaches: meleeReaches, parseSpeeds: parseSpeeds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TokenSize = api;
})(typeof window !== 'undefined' ? window : globalThis);
