'use strict';

/* ---------------- wall editor (Walls tool) ---------------- */
const round1 = (v) => Math.round(v * 10) / 10;
function wallSnapshot() { S.wallUndo.push(JSON.stringify(S.walls)); if (S.wallUndo.length > 80) S.wallUndo.shift(); syncWallBox(); }
function afterWallEdit() { S.problems = []; S.problemIx = -1; wallsChanged(); renderDoorList(); syncWallBox(); requestRender(); }
function wallUndo() {
  const snap = S.wallUndo.pop();
  if (!snap) return;
  S.walls = JSON.parse(snap); S.wallSel = null;
  afterWallEdit();
}
function deleteWall() {
  if (!S.wallSel) return;
  wallSnapshot();
  S.walls.splice(S.walls.indexOf(S.wallSel), 1); S.wallSel = null;
  afterWallEdit();
}
function syncWallBox() {
  const sel = S.wallSel;
  $('#wallDelete').disabled = !sel; $('#wallUndo').disabled = !S.wallUndo.length;
  const shown = sel ? (sel.type === 'door' ? 'door' : sel.type === 'fence' ? 'fence' : sel.type === 'window' ? 'window' : 'wall') : S.drawKind;       // the selected wall's kind, else what the next one drawn will be
  for (const k of document.querySelectorAll('#wallKinds button')) k.setAttribute('aria-pressed', String(k.dataset.kind === shown));
  positionDoorCard();
  if (!S.problems.length) $('#wallInfo').textContent = sel ? Math.round(Math.hypot(sel.x2 - sel.x1, sel.y2 - sel.y1) / cell() * 5) + ' ft long' : S.walls.length + ' walls';
}
// The wall end under the pointer (within a few screen pixels), as {w, k} where k is 1 or 2.
function endpointAt(p) {
  const tol = 14 / S.view.scale;
  let best = null, bd = tol;
  const order = S.wallSel ? [S.wallSel, ...S.walls] : S.walls;
  for (const w of order) for (const k of [1, 2]) {
    const d = Math.hypot(p.x - w['x' + k], p.y - w['y' + k]);
    if (d < bd - 1e-6) { bd = d; best = { w, k }; }
  }
  return best;
}
// Snap a point to a nearby wall end (not one of the ends being moved), so corners meet exactly.
// The wall end a point would snap to, or null when it is not near one.
function snapToEndOnly(p, skip) {
  const tol = 16 / S.view.scale; let best = null, bd = tol;
  for (const w of S.walls) for (const k of [1, 2]) {
    if (skip && skip.some((g) => g.w === w && g.k === k)) continue;
    const d = Math.hypot(p.x - w['x' + k], p.y - w['y' + k]);
    if (d < bd) { bd = d; best = { x: w['x' + k], y: w['y' + k] }; }
  }
  return best;
}
function snapToEnds(p, skip) {
  const tol = 16 / S.view.scale;
  let best = null, bd = tol;
  for (const w of S.walls) for (const k of [1, 2]) {
    if (skip && skip.some((g) => g.w === w && g.k === k)) continue;
    const d = Math.hypot(p.x - w['x' + k], p.y - w['y' + k]);
    if (d < bd) { bd = d; best = { x: w['x' + k], y: w['y' + k] }; }
  }
  return best || { x: round1(clamp(p.x, 0, S.W)), y: round1(clamp(p.y, 0, S.H)) };
}
// Click, then click again: a wall from the first point to the second; the second point starts the next wall, so a run of walls is a run of clicks (Esc, or a right-click, stops).
function penEnd(e, p) {
  let t = snapToEnds(p, null);
  if (e && e.shiftKey && S.wallPen) t = Math.abs(p.x - S.wallPen.x) > Math.abs(p.y - S.wallPen.y) ? { x: round1(p.x), y: S.wallPen.y } : { x: S.wallPen.x, y: round1(p.y) };
  return t;
}
function wallDown(e, p) {
  if (S.wallPen) {
    const t = penEnd(e, p);
    if (Math.hypot(t.x - S.wallPen.x, t.y - S.wallPen.y) >= 4 / S.view.scale) {
      wallSnapshot();
      const w = { x1: S.wallPen.x, y1: S.wallPen.y, x2: t.x, y2: t.y, type: drawType(), open: false };
      S.walls.push(w); S.wallSel = w; S.wallPen = { x: t.x, y: t.y };
      afterWallEdit();
    }
    return;
  }
  const ep = endpointAt(p);
  if (ep) {
    S.wallSel = ep.w;
    const x = ep.w['x' + ep.k], y = ep.w['y' + ep.k];
    const group = e.altKey ? [ep] : [];
    if (!e.altKey) for (const w of S.walls) for (const k of [1, 2]) if (Math.hypot(w['x' + k] - x, w['y' + k] - y) < 0.6) group.push({ w, k });
    S.drag = { kind: 'wallpt', group, snap: JSON.stringify(S.walls), moved: false };
    syncWallBox(); requestRender(); return;
  }
  const w = nearestWall(p, false);
  if (w) {
    S.wallSel = w;
    S.drag = { kind: 'wallmove', w, sx: p.x, sy: p.y, orig: { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }, snap: JSON.stringify(S.walls), moved: false };
    syncWallBox(); requestRender(); return;
  }
  if (p.x < -20 || p.y < -20 || p.x > S.W + 20 || p.y > S.H + 20) { S.wallSel = null; syncWallBox(); requestRender(); return; }       // a new wall cannot start off the map; existing ones can still be picked there
  const a = snapToEnds(p, null);
  S.wallSel = null;
  S.drag = { kind: 'wallnew', x1: a.x, y1: a.y, x2: a.x, y2: a.y, snap: JSON.stringify(S.walls), moved: false };
  syncWallBox(); requestRender();
}
function wallMove(e, p) {
  const d = S.drag;
  if (d.kind === 'wallpt') {
    let t = snapToEnds(p, d.group);
    if (e.shiftKey) {                                                 // keep it straight: level or plumb with the far end of the first wall
      const g = d.group[0], ox = g.w['x' + (g.k === 1 ? 2 : 1)], oy = g.w['y' + (g.k === 1 ? 2 : 1)];
      t = Math.abs(p.x - ox) > Math.abs(p.y - oy) ? { x: round1(p.x), y: oy } : { x: ox, y: round1(p.y) };
    }
    for (const g of d.group) { g.w['x' + g.k] = t.x; g.w['y' + g.k] = t.y; }
    d.moved = true; queueReveal();
  } else if (d.kind === 'wallmove') {
    const dx = round1(p.x - d.sx), dy = round1(p.y - d.sy);
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    const w = d.w; w.x1 = round1(d.orig.x1 + dx); w.y1 = round1(d.orig.y1 + dy); w.x2 = round1(d.orig.x2 + dx); w.y2 = round1(d.orig.y2 + dy);
    d.moved = true; queueReveal();
  } else {
    let t = snapToEnds(p, null);
    if (e.shiftKey) t = Math.abs(p.x - d.x1) > Math.abs(p.y - d.y1) ? { x: round1(p.x), y: d.y1 } : { x: d.x1, y: round1(p.y) };
    d.x2 = t.x; d.y2 = t.y; d.moved = true;
  }
}
// With the Door kind picked, a click on a wall turns that stretch of it (one square, or the whole wall when it is shorter) into a door; the rest stays wall.
function makeDoorAt(d) {
  const w = d.w, len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1); if (len < 1) return false;
  const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len, L = Math.min(len, cell());
  const t = (d.sx - w.x1) * ux + (d.sy - w.y1) * uy, from = Math.max(0, Math.min(len - L, t - L / 2));
  const at = (v) => ({ x: round1(w.x1 + ux * v), y: round1(w.y1 + uy * v) });
  const a = at(from), b = at(from + L), parts = [];
  if (from > 0.5) parts.push({ x1: w.x1, y1: w.y1, x2: a.x, y2: a.y, type: 'wall', open: false });
  const door = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, type: 'door', open: false }; parts.push(door);
  if (len - from - L > 0.5) parts.push({ x1: b.x, y1: b.y, x2: w.x2, y2: w.y2, type: 'wall', open: false });
  S.wallUndo.push(d.snap);
  const i = S.walls.indexOf(w); S.walls.splice(i, 1, ...parts); S.wallSel = door;
  afterWallEdit(); return true;
}
function wallUp(d) {
  if (!d.moved && d.kind === 'wallpt' && d.group.length) {            // a click on an existing end (no drag): the next click draws a wall from that point
    const g = d.group[0]; S.wallPen = { x: g.w['x' + g.k], y: g.w['y' + g.k] };
    syncWallBox(); requestRender(); return;
  }
  if (!d.moved && d.kind === 'wallmove' && S.drawKind === 'door' && d.w.type === 'wall' && makeDoorAt(d)) return;
  if (!d.moved && d.kind !== 'wallnew') { syncWallBox(); return; }
  if (d.kind === 'wallnew') {
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4 / S.view.scale) { S.wallPen = { x: d.x1, y: d.y1 }; $('#wallInfo').textContent = 'Click where the wall ends (Esc stops)'; requestRender(); return; }
    S.wallUndo.push(d.snap);
    const w = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, type: drawType(), open: false };
    S.walls.push(w); S.wallSel = w;
  } else S.wallUndo.push(d.snap);
  S.walls = S.walls.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) > 0.5);       // a wall dragged down to nothing is gone
  if (S.wallSel && !S.walls.includes(S.wallSel)) S.wallSel = null;
  afterWallEdit();
}
function drawWallEditor(px) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const w of S.walls) for (const k of [1, 2]) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(w['x' + k] - 3.5 * px, w['y' + k] - 3.5 * px, 7 * px, 7 * px);
  }
  if (S.hover && S.viewAs === 'dm') {                    // the wall end a click or a drop would join: a gold ring, so a wall, a door and the next wall meet exactly
    const skip = S.drag && S.drag.kind === 'wallpt' ? S.drag.group : null;
    const ep = S.drag && ['wallpt', 'wallnew'].includes(S.drag.kind) || S.wallPen ? snapToEndOnly(S.hover, skip) : (!S.drag ? (endpointAt(S.hover) ? { x: endpointAt(S.hover).w['x' + endpointAt(S.hover).k], y: endpointAt(S.hover).w['y' + endpointAt(S.hover).k] } : null) : null);
    if (ep) { ctx.strokeStyle = 'rgba(255, 214, 80, 0.95)'; ctx.lineWidth = 2.5 * px; ctx.beginPath(); ctx.arc(ep.x, ep.y, 9 * px, 0, Math.PI * 2); ctx.stroke(); }
  }
  const hov = S.hover && !S.drag ? nearestWall(S.hover, false) : null;
  if (hov && hov !== S.wallSel) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 7 * px; ctx.beginPath(); ctx.moveTo(hov.x1, hov.y1); ctx.lineTo(hov.x2, hov.y2); ctx.stroke(); }
  const sel = S.wallSel;
  if (sel) {
    ctx.strokeStyle = 'rgba(80,200,255,0.9)'; ctx.lineWidth = 7 * px; ctx.beginPath(); ctx.moveTo(sel.x1, sel.y1); ctx.lineTo(sel.x2, sel.y2); ctx.stroke();
    ctx.fillStyle = '#50c8ff'; for (const k of [1, 2]) { ctx.beginPath(); ctx.arc(sel['x' + k], sel['y' + k], 6 * px, 0, Math.PI * 2); ctx.fill(); }
  }
  if (S.wallPen && S.hover) { const t = penEnd(null, S.hover); ctx.setLineDash([8 * px, 6 * px]); ctx.strokeStyle = 'rgba(80,200,255,0.9)'; ctx.lineWidth = 4 * px; ctx.beginPath(); ctx.moveTo(S.wallPen.x, S.wallPen.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#50c8ff'; ctx.beginPath(); ctx.arc(S.wallPen.x, S.wallPen.y, 5 * px, 0, Math.PI * 2); ctx.fill(); }
  const nw = S.drag && S.drag.kind === 'wallnew' ? S.drag : null;
  if (nw) { ctx.setLineDash([8 * px, 6 * px]); ctx.strokeStyle = 'rgba(80,200,255,0.9)'; ctx.lineWidth = 4 * px; ctx.beginPath(); ctx.moveTo(nw.x1, nw.y1); ctx.lineTo(nw.x2, nw.y2); ctx.stroke(); ctx.setLineDash([]); }
  (S.problems || []).forEach((pr, i) => { ctx.strokeStyle = i === S.problemIx ? '#ffd23c' : '#ff5b5b'; ctx.lineWidth = (i === S.problemIx ? 4 : 2.5) * px; ctx.beginPath(); ctx.arc(pr.x, pr.y, 12 * px, 0, Math.PI * 2); ctx.stroke(); });
  ctx.restore();
}
// Walls that cross, walls that end close to another wall without touching it, and walls too short to see.
function findWallProblems() {
  const W = S.walls, out = [], tol = Math.max(6, cell() * 0.35), eps = 0.6;
  const seen = new Set();
  const add = (x, y, kind) => { const key = Math.round(x / 4) + ',' + Math.round(y / 4) + kind; if (!seen.has(key)) { seen.add(key); out.push({ x, y, kind }); } };
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const a = W[i], b = W[j];
    const d1 = a.x2 - a.x1, e1 = a.y2 - a.y1, d2 = b.x2 - b.x1, e2 = b.y2 - b.y1, den = d1 * e2 - e1 * d2;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((b.x1 - a.x1) * e2 - (b.y1 - a.y1) * d2) / den, u = ((b.x1 - a.x1) * e1 - (b.y1 - a.y1) * d1) / den;
    const ea = eps / Math.hypot(d1, e1), eb = eps / Math.hypot(d2, e2);
    if (t > ea && t < 1 - ea && u > eb && u < 1 - eb) add(a.x1 + t * d1, a.y1 + t * e1, 'cross');
  }
  for (const w of W) {
    if (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 3) add(w.x1, w.y1, 'tiny');
    for (const k of [1, 2]) if (w['x' + k] < -2 || w['y' + k] < -2 || w['x' + k] > S.W + 2 || w['y' + k] > S.H + 2) add(w['x' + k], w['y' + k], 'off');
    for (const k of [1, 2]) {
      const x = w['x' + k], y = w['y' + k];
      for (const o of W) {
        if (o === w) continue;
        const d = pointSegmentDistance(x, y, o);
        if (d > eps && d <= tol) add(x, y, 'gap');
      }
    }
  }
  return out;
}
const PROBLEM_TEXT = { cross: 'two walls cross', gap: 'a wall ends close to another without touching it', tiny: 'a very short wall', off: 'a wall end is off the map (click it and press Delete, or drag it back)' };
function nextProblem() {
  if (!S.problems.length || S.problemIx < 0) { S.problems = findWallProblems(); S.problemIx = -1; }
  if (!S.problems.length) { $('#wallInfo').textContent = 'No problems found'; requestRender(); return; }
  S.problemIx = (S.problemIx + 1) % S.problems.length;
  const pr = S.problems[S.problemIx];
  S.view.ox = $('#stage').clientWidth / 2 - pr.x * S.view.scale; S.view.oy = $('#stage').clientHeight / 2 - pr.y * S.view.scale;
  $('#wallInfo').textContent = 'Problem ' + (S.problemIx + 1) + ' of ' + S.problems.length + ': ' + PROBLEM_TEXT[pr.kind];
  requestRender();
}
$('#wallProblems').addEventListener('click', nextProblem);
$('#wallDelete').addEventListener('click', deleteWall);
$('#wallUndo').addEventListener('click', wallUndo);
function drawType() { return S.drawKind === 'fence' || S.drawKind === 'window' || S.drawKind === 'door' ? S.drawKind : 'wall'; }       // what the walls drawn next are (a fence stops movement but not sight)
$('#wallKinds').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]'); if (!b) return;
  S.drawKind = b.dataset.kind;                       // the next wall you draw
  const w = S.wallSel;
  if (w && w.type !== (S.drawKind === 'wall' ? 'wall' : S.drawKind)) {       // and the selected wall changes too
    wallSnapshot();
    w.type = S.drawKind;
    if (w.type !== 'door') { w.open = false; delete w.locked; delete w.secret; delete w.dc; }
    afterWallEdit();
  } else syncWallBox();
});
