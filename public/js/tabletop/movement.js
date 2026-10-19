// The tabletop, part of public/index.html: reachability and the movement rules.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   MOVEMENT POOL / REACHABILITY (5e: diagonals cost 5 ft)
   ===================================================================== */
let reachCache = { sig: '', map: new Map() };

// Movement range, by rule. Every function returns a Map of square key -> feet of movement needed.
//   standard    (PHB)  every square costs 5 ft, diagonals too, so the range is a square
//   alternating (DMG)  diagonals cost 5 ft, then 10 ft, then 5 ft...
//   circle      (house rule) straight-line distance; a diagonal step is about 7 ft
const MOVE_RULES = ['circle', 'standard', 'alternating'];
const FREE_ROAM_FT = 150;           // outside a fight there is no movement budget: one drag can go this far (walls still block)
const SQRT2 = Math.SQRT2;

function reachStandard(token, radiusFt, near) {
  const maxSteps = Number.isFinite(radiusFt) ? Math.floor(radiusFt / FT_PER_SQUARE) : Infinity;
  const steps = new Map([[sqKey(token.col, token.row), 0]]);
  const queue = [[token.col, token.row]];
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i];
    const d = steps.get(sqKey(c, r));
    if (d >= maxSteps) continue;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (!inFp(nc, nr)) continue;
        const k = sqKey(nc, nr);
        if (steps.has(k)) continue;
        if (near.length && moveBlocked(c, r, nc, nr, near)) continue;
        steps.set(k, d + 1);
        queue.push([nc, nr]);
      }
    }
  }
  const cost = new Map();
  for (const [k, n] of steps) cost.set(k, n * FT_PER_SQUARE);
  return cost;
}

function reachAlternating(token, radiusFt, near) {
  // State is (square, diagonal steps so far mod 2): the first diagonal costs 5 ft, the second 10 ft, and so on.
  const best = new Map([[`${token.col},${token.row},0`, 0]]);
  const queue = [[token.col, token.row, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [c, r, p] = queue[i];
    const here = best.get(`${c},${r},${p}`);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (!inFp(nc, nr) || (near.length && moveBlocked(c, r, nc, nr, near))) continue;
        const diagonal = dc !== 0 && dr !== 0;
        const next = here + (diagonal ? (p === 0 ? 5 : 10) : 5);
        const np = diagonal ? 1 - p : p;
        const k = `${nc},${nr},${np}`;
        if (next > radiusFt + 1e-9 || next >= (best.get(k) ?? Infinity)) continue;
        best.set(k, next);
        queue.push([nc, nr, np]);
      }
    }
  }
  const cost = new Map();
  for (const [k, v] of best) {
    const sq = k.slice(0, k.lastIndexOf(','));
    if (v < (cost.get(sq) ?? Infinity)) cost.set(sq, v);
  }
  return cost;
}

function reachCircle(token, radiusFt, R, near) {
  const cost = new Map([[sqKey(token.col, token.row), 0]]);
  // Squares with a clear straight line cost their straight-line distance.
  for (let dc = -R; dc <= R; dc++) {
    for (let dr = -R; dr <= R; dr++) {
      if (dc === 0 && dr === 0) continue;
      const d = Math.hypot(dc, dr) * FT_PER_SQUARE;
      if (d > radiusFt + 1e-9) continue;
      const c = token.col + dc, r = token.row + dr;
      if (!inFp(c, r)) continue;
      if (near.length && moveBlocked(token.col, token.row, c, r, near)) continue;
      cost.set(sqKey(c, r), d);
    }
  }
  if (near.length) {
    // Squares hidden behind a wall cost the walk around it: relax outward one step at a time.
    const queue = [...cost.keys()];
    for (let i = 0; i < queue.length; i++) {
      const [c, r] = queue[i].split(',').map(Number);
      const here = cost.get(queue[i]);
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          const nc = c + dc, nr = r + dr;
          if (!inFp(nc, nr) || moveBlocked(c, r, nc, nr, near)) continue;
          const next = here + (dc !== 0 && dr !== 0 ? SQRT2 : 1) * FT_PER_SQUARE;
          const k = sqKey(nc, nr);
          if (next > radiusFt + 1e-9 || next >= (cost.get(k) ?? Infinity) - 1e-9) continue;
          cost.set(k, next);
          queue.push(k);
        }
      }
    }
  }
  return cost;
}

// ---- Difficult terrain ----
// Rectangles saved on the map (Map Test > Terrain). Each foot of movement into a difficult square costs 1 extra foot, so entering one costs double.
// a big creature moving into a footprint with any difficult square pays double
let moveFlying = false;
const difficultFp = (c, r) => { for (let i = 0; i < moveN; i++) for (let j = 0; j < moveN; j++) if (isDifficult(c + i, r + j)) return true; return false; };
function isDifficult(c, r) {
  if (!state.difficult.length) return false;
  if (!state.difficultSquares) {
    state.difficultSquares = new Set();
    for (let col = 0; col < cols(); col++) {
      for (let row = 0; row < rows(); row++) {
        const x = centerOf(col), y = centerOf(row);
        if (state.difficult.some((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h)) state.difficultSquares.add(sqKey(col, row));
      }
    }
  }
  return state.difficultSquares.has(sqKey(c, r));
}

// Cheapest cost to every square within the radius when some squares are difficult (a shortest-path search). Diagonals cost what the
// movement rule says: 5 ft (standard), 5 then 10 (alternating) or a straight-line 7.07 ft (round).
function reachTerrain(token, radiusFt, near, rule) {
  const best = new Map([[`${token.col},${token.row},0`, 0]]);
  const open = [[0, token.col, token.row, 0]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [here, c, r, p] = open.splice(bi, 1)[0];
    if (here > (best.get(`${c},${r},${p}`) ?? Infinity)) continue;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        if (!inFp(nc, nr) || (near.length && moveBlocked(c, r, nc, nr, near))) continue;
        const diagonal = dc !== 0 && dr !== 0;
        let step = FT_PER_SQUARE, np = p;
        if (diagonal) {
          if (rule === 'alternating') { step = p === 0 ? 5 : 10; np = 1 - p; }
          else if (rule === 'circle') step = SQRT2 * FT_PER_SQUARE;
        }
        const next = here + step * (!moveFlying && difficultFp(nc, nr) ? 2 : 1);
        if (next > radiusFt + 1e-9) continue;
        const k = `${nc},${nr},${np}`;
        if (next >= (best.get(k) ?? Infinity) - 1e-9) continue;
        best.set(k, next);
        open.push([next, nc, nr, np]);
      }
    }
  }
  const cost = new Map();
  for (const [k, v] of best) {
    const [c, r] = k.split(',');
    const sk = `${c},${r}`;
    if (v < (cost.get(sk) ?? Infinity)) cost.set(sk, v);
  }
  return cost;
}

// SQUEEZING (2014 PHB, "Movement and Position"): a creature can move through a space big enough for a creature one size smaller (a Large creature through a one-square corridor).
// While it squeezes each foot of movement costs 1 extra foot, it has disadvantage on attack rolls and Dexterity saves, and attacks against it have advantage.
// The table gives the creature the smaller footprint (token.squeezed, the condition 'squeezing') while its full body does not fit where it stands, and charges the extra foot.
// reachSqueeze() is a second pass over what the normal pass found: from any reachable square it tries steps the full body cannot make but the body one size smaller can.
function bodyFits(c, r, n, walls) {
  if (!inBounds(c, r) || !inBounds(c + n - 1, r + n - 1)) return false;
  const keep = moveN; moveN = n;
  let blocked = false;
  for (let i = 0; i < n && !blocked; i++) {
    for (let j = 0; j < n && !blocked; j++) {
      if (i + 1 < n) { const ax = centerOf(c + i), ay = centerOf(r + j); for (const w of walls) if (segmentsIntersect(ax, ay, centerOf(c + i + 1), ay, w)) { blocked = true; break; } }
      if (!blocked && j + 1 < n) { const ax = centerOf(c + i), ay = centerOf(r + j); for (const w of walls) if (segmentsIntersect(ax, ay, ax, centerOf(r + j + 1), w)) { blocked = true; break; } }
    }
  }
  moveN = keep;
  return !blocked;
}
function reachSqueeze(token, base, radiusFt, near, rule) {
  const n = TokenSize.squares(token.size), m = n - 1;
  const fitsMemo = new Map();
  const fits = (c, r) => { const k = sqKey(c, r); if (!fitsMemo.has(k)) fitsMemo.set(k, bodyFits(c, r, n, near)); return fitsMemo.get(k); };
  const best = new Map(base);
  const open = [...base].map(([k, v]) => [v, k]);
  const keep = moveN;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [here, k] = open.splice(bi, 1)[0];
    if (here > (best.get(k) ?? Infinity)) continue;
    const [c, r] = k.split(',').map(Number);
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc, nr = r + dr;
        const diagonal = dc !== 0 && dr !== 0;
        const stepFt = diagonal ? (rule === 'circle' ? SQRT2 * FT_PER_SQUARE : rule === 'alternating' ? 7.5 : FT_PER_SQUARE) : FT_PER_SQUARE;
        let squeeze = 0;
        moveN = n;
        const wholeBody = fits(c, r) && fits(nc, nr) && inBounds(nc + n - 1, nr + n - 1) && !moveBlocked(c, r, nc, nr, near);
        if (!wholeBody) {
          moveN = m;
          if (!inFp(nc, nr) || moveBlocked(c, r, nc, nr, near)) continue;
          squeeze = 1;
        }
        moveN = n;
        const hard = !moveFlying && difficultFp(nc, nr) ? 1 : 0;
        const next = here + stepFt * (1 + squeeze + hard);
        if (next > radiusFt + 1e-9) continue;
        const nk = sqKey(nc, nr);
        if (next >= (best.get(nk) ?? Infinity) - 1e-9) continue;
        best.set(nk, next);
        open.push([next, nk]);
      }
    }
  }
  moveN = keep;
  return best;
}
// After a creature has been moved: it squeezes while its full body does not fit where it stands.
function settleBody(t) {
  const n = TokenSize.squares(t && t.size);
  if (!t || n < 2) return;
  const walls = state.gmOverride ? [] : (isFlying(t) ? flyerWalls() : blockingWalls());
  const narrow = !bodyFits(t.col, t.row, n, walls);
  if (narrow === Boolean(t.squeezed)) return;
  t.squeezed = narrow;
  if (narrow) { setCondition(t, 'squeezing', 0); if (seenByParty(t)) addChat('system', `↳ ${t.name} squeezes through a space one size too small: each foot costs 2, disadvantage on attacks and Dexterity saves, attacks against it have advantage`); }
  else clearCondition(t, 'squeezing');
}

function reachable(token) {
  if (!token) return new Map();
  const free = !state.combat.active && !state.gmOverride;                // no fight: move freely, no turns, no budget
  const rule = state.gmOverride || free ? 'standard' : state.moveRule;
  const leashOwner = token.summon ? state.tokens.find((o) => o.id === token.summon.ownerId) : null;
  const sig = `${rule}|${free}|${state.difficult.length}|${token.id}|${token.col},${token.row}|${token.size || ''}|${token.elevation || ''}|${isFlying(token)}|${token.movementRemaining}|${state.wallsVersion}|${state.gmOverride}|${cols()}x${rows()}|${leashOwner ? leashOwner.col + ',' + leashOwner.row : ''}|` +
    state.tokens.map((t) => sqKey(t.col, t.row) + 'x' + fp(t)).join(';');
  if (reachCache.sig === sig) return reachCache.map;

  const radiusFt = state.gmOverride ? Infinity : free ? FREE_ROAM_FT : token.movementRemaining;
  const R = Number.isFinite(radiusFt) ? Math.ceil(radiusFt / FT_PER_SQUARE) : Math.max(cols(), rows());
  const x0 = tcx(token), y0 = tcy(token);
  moveN = TokenSize.squares(token.size);          // the normal pass uses the whole body (a squeezing creature gets the second pass below)
  moveFlying = isFlying(token);
  const reachPx = (R + 1) * GRID;
  // Only walls near the token can matter.
  const near = state.gmOverride ? [] : (moveFlying ? flyerWalls() : blockingWalls()).filter((w) =>
    Math.min(w.x1, w.x2) <= x0 + reachPx && Math.max(w.x1, w.x2) >= x0 - reachPx &&
    Math.min(w.y1, w.y2) <= y0 + reachPx && Math.max(w.y1, w.y2) >= y0 - reachPx);

  const cost = state.difficult.length && !state.gmOverride && !free && !moveFlying ? reachTerrain(token, radiusFt, near, rule)
    : rule === 'circle' ? reachCircle(token, radiusFt, R, near)
    : rule === 'alternating' ? reachAlternating(token, radiusFt, near)
    : reachStandard(token, radiusFt, near);
  let narrowKeys = new Set();
  if (moveN > 1 && near.length && !state.gmOverride) {
    const withSqueeze = reachSqueeze(token, cost, radiusFt, near, rule);
    const fullAt = (c, r) => bodyFits(c, r, moveN, near);
    for (const [k, v] of withSqueeze) {
      if (!cost.has(k) || v < cost.get(k) - 1e-9) cost.set(k, v);
      const [c, r] = k.split(',').map(Number);
      if (!fullAt(c, r)) narrowKeys.add(k);
    }
  }
  // A summoned thing cannot stray beyond its leash from the one who controls it.
  if (leashOwner) {
    for (const k of [...cost.keys()]) {
      const [c, r] = k.split(',').map(Number);
      if (Math.hypot(c - leashOwner.col, r - leashOwner.row) * FT_PER_SQUARE > token.summon.leashFt) cost.delete(k);
    }
  }
  // Allies may be passed through, but a move cannot end on an occupied square (any square of the footprint).
  for (const other of state.tokens) {
    if (other === token || (other.dead && !other.isPC)) continue;                 // a defeated creature lies on the ground: it does not block
    const o = { col: other.col, row: other.row, n: fp(other) };
    for (const k of [...cost.keys()]) {
      const [c, r] = k.split(',').map(Number);
      if (TokenSize.overlaps({ col: c, row: r, n: narrowKeys.has(k) ? moveN - 1 : moveN }, o)) cost.delete(k);
    }
  }
  reachCache = { sig, map: cost };
  return cost;
}

