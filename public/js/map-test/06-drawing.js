'use strict';

/* ---------------- drawing ---------------- */
let renderQueued = false;
function fogMoves() { return S.fog && !noFog() && S.tokens.length && FogStyle.moves(S.light === 'dark' && !S.lightZones.length); }
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); positionPinCard(); positionDoorCard(); positionZoneCard(); });
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(rect.width * dpr));
  cv.height = Math.max(1, Math.round(rect.height * dpr));
  requestRender();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!S.img) return;
  const v = S.view;
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);
  ctx.drawImage(S.viewAs === 'dm' && S.dmImg && !PlacePins.appliesTo(S.kind) ? S.dmImg : S.img, 0, 0, S.W, S.H);       // a town or regional map shows its own picture with the live marks: an old DM picture has names, pins and a start circle painted into it
  { const wash = MapShared.nightWash(S.lightZones, S.light === 'dark', S.timeOfDay, S.W, S.H); if (wash) ctx.drawImage(wash, 0, 0); }       // the same night wash as the tabletop
  // Fires marked "flicker" in the config are animated over the picture.
  for (const l of S.lights) if (!S.lightsOff.has(l.id)) Flicker.draw(ctx, l.x, l.y, cell() * Math.min(1, Math.max(0.25, Math.pow(l.range / 9, 2))), performance.now() / 1000);

  const px = 1 / v.scale;
  if (S.showGrid && S.tiles !== 'none') { if (S.tiles === 'hex') drawHexes(px); else drawGrid(px); }

  if (S.fog && S.tokens.length && !noFog()) {
    ctx.save();
    ctx.globalAlpha = S.dm ? 0.5 : 1;
    FogStyle.draw(ctx, shroud, S.light === 'dark' && !S.lightZones.length, performance.now(), litRegion());
    ctx.drawImage(vision, 0, 0);
    ctx.restore();
  }

  if (S.showPoly) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.9)';
    ctx.fillStyle = 'rgba(0, 220, 255, 0.08)';
    ctx.lineWidth = 2 * px;
    for (const poly of S.polys) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  if (!noFog()) drawTokenLight();
  if (S.effects.length) Effects.draw(ctx, S.effects, performance.now() / 1000, cell());
  if (S.viewAs === 'dm') drawLightMarkers(px);
  if (S.viewAs === 'dm' && S.showLightRadius) drawLightRadii(px);
  if (S.showWalls) drawWalls(px);
  if (S.viewAs === 'dm' && (S.tool === 'zones' || S.showZones)) drawZones(px);
  if (S.tool === 'walls' && S.viewAs === 'dm') drawWallEditor(px);
  drawMoveRange(px);
  if (S.viewAs === 'dm') { drawTerrain(px); drawStarts(px); }
  else if (MapLabels.appliesTo(S.kind) && MapLabels.enabled()) MapLabels.draw(ctx, S.labels, px);
  if (S.viewAs === 'dm' && S.showPins && PlacePins.appliesTo(S.kind) && PlacePins.enabled()) PlacePins.draw(ctx, S.starts.filter((p) => p.name !== 'start' && !isAreaPin(p)).map((p) => ({ x: p.x, y: p.y, name: p.name, label: p.label, unknown: !(p.known === true && p.dmOnly !== true) })), px);       // the DM sees the places as the players do (gold); the ones they do not know yet are red
  if (S.viewAs !== 'dm' && PlacePins.appliesTo(S.kind) && PlacePins.enabled()) PlacePins.draw(ctx, S.starts.filter((p) => PlacePins.isPlace(p) && PlacePins.knownTo(p, [])), px);       // only the places known from the start: discoveries belong to a campaign's game       // Player view: the same named places the tabletop shows                 // the players never see the terrain shading, the pins or the start area
  if (!noFog()) drawTokens(px);
}

// Hexagonal tiles (regional maps): pointy-top hexagons, hexSize = width flat to flat in picture pixels, one hex is 5 miles.
function drawHexes(px) {
  // flat-top hexagons: a flat edge on the top and the bottom, a point left and right. hexSize is the distance between the two flat edges.
  const fl = S.hexSize, r = fl / Math.sqrt(3), colW = r * 1.5;
  ctx.save(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'; ctx.lineWidth = px; ctx.beginPath();
  for (let col = -1, cx = 0; cx < S.W + r * 2; col++, cx += colW) for (let cy = (col % 2 ? fl / 2 : 0) - fl; cy < S.H + fl; cy += fl) for (let i = 0; i < 6; i++) { const ang = i * Math.PI / 3, X = cx + r * Math.cos(ang), Y = cy + fl / 2 + r * Math.sin(ang); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); if (i === 5) ctx.closePath(); }
  ctx.stroke(); ctx.restore();
}

function drawGrid(px) {
  const c = cell();
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let x = 0; x <= S.W + 0.5; x += c) { ctx.moveTo(x, 0); ctx.lineTo(x, S.H); }
  for (let y = 0; y <= S.H + 0.5; y += c) { ctx.moveTo(0, y); ctx.lineTo(S.W, y); }
  ctx.stroke();
  ctx.restore();
}

// Saved pins (arrival spots): a flag with its name. Under fog of war they follow the fog like everything else: hidden in unexplored
// ground, dimmed in explored ground. The DM view, and the Pins tool while you edit, show them all.
// Movement test: what the first test token can reach in one move, costed square by square (standard 5e: a diagonal costs 5 ft; a square
// inside difficult terrain costs double; walls and closed doors stop movement). The cost is printed in each square once zoomed in.
let moveCache = { key: '', cost: null };
function segmentsCross(x1, y1, x2, y2, w) {
  const d = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(x1, y1, x2, y2, w.x1, w.y1), d2 = d(x1, y1, x2, y2, w.x2, w.y2), d3 = d(w.x1, w.y1, w.x2, w.y2, x1, y1), d4 = d(w.x1, w.y1, w.x2, w.y2, x2, y2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
const inDifficult = (x, y) => S.difficult.some((d) => x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h);
function moveCosts() {
  const t = S.tokens[0];
  if (!t) return null;
  const g = cell();
  const c0 = Math.floor(t.x / g), r0 = Math.floor(t.y / g);
  const key = [c0, r0, S.moveFt, S.squares, S.walls.length, S.difficult.length, S.walls.filter((w) => w.open).length].join('|');
  if (moveCache.key === key) return moveCache.cost;
  const reach = (S.moveFt / FT_PER_SQUARE + 2) * g;
  const near = blockingWalls(S.walls).filter((w) => Math.min(w.x1, w.x2) <= t.x + reach && Math.max(w.x1, w.x2) >= t.x - reach && Math.min(w.y1, w.y2) <= t.y + reach && Math.max(w.y1, w.y2) >= t.y - reach);
  const cols = Math.ceil(S.W / g), rows = Math.ceil(S.H / g);
  const cost = new Map([[c0 + ',' + r0, 0]]);
  const open = [[0, c0, r0]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [here, c, r] = open.splice(bi, 1)[0];
    if (here > (cost.get(c + ',' + r) ?? Infinity)) continue;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue;
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ax = (c + 0.5) * g, ay = (r + 0.5) * g, bx = (nc + 0.5) * g, by = (nr + 0.5) * g;
      if (near.some((w) => segmentsCross(ax, ay, bx, by, w))) continue;
      const next = here + FT_PER_SQUARE * (inDifficult(bx, by) ? 2 : 1);
      if (next > S.moveFt + 1e-9 || next >= (cost.get(nc + ',' + nr) ?? Infinity) - 1e-9) continue;
      cost.set(nc + ',' + nr, next);
      open.push([next, nc, nr]);
    }
  }
  moveCache = { key, cost };
  return cost;
}
function drawMoveRange(px) {
  if (!S.moveTest) return;
  const cost = moveCosts();
  if (!cost) return;
  const g = cell();
  ctx.save();
  for (const [k, ft] of cost) {
    const [c, r] = k.split(',').map(Number);
    const t = ft / S.moveFt;
    ctx.fillStyle = 'rgba(' + Math.round(60 + 190 * t) + ', ' + Math.round(210 - 70 * t) + ', 90, 0.34)';
    ctx.fillRect(c * g, r * g, g, g);
  }
  if (g / px >= 26) {
    ctx.font = Math.min(14, g / px / 3) * px + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    for (const [k, ft] of cost) { const [c, r] = k.split(',').map(Number); ctx.fillText(String(Math.round(ft)), (c + 0.5) * g, (r + 0.5) * g); }
  }
  ctx.restore();
}

// ---- Difficult terrain is painted with a round brush: the squares are kept as a set while you drag and saved as the fewest rectangles that cover them.
const gridPx = () => S.W / S.squares;
const isTerrainTool = () => S.tool === 'terrain' || S.tool === 'eraser';
const cellsOfRects = () => {
  const g = gridPx(), set = new Set();
  for (const d of S.difficult) {
    const c0 = Math.round(d.x / g), r0 = Math.round(d.y / g), c1 = Math.round((d.x + d.w) / g), r1 = Math.round((d.y + d.h) / g);
    for (let c = c0; c < c1; c++) for (let r = r0; r < r1; r++) set.add(c + ',' + r);
  }
  return set;
};
// The squares under the brush at a world point: a disc of diameter S.brush squares (size 1 is just the square under the pointer).
function brushCells(p) {
  const g = gridPx(), cols = Math.ceil(S.W / g - 1e-6), rows = Math.ceil(S.H / g - 1e-6), out = [];
  if (S.brush <= 1) { const c = Math.floor(p.x / g), r = Math.floor(p.y / g); return c >= 0 && r >= 0 && c < cols && r < rows ? [c + ',' + r] : []; }
  const R = S.brush / 2, cx = p.x / g, cy = p.y / g;
  for (let c = Math.floor(cx - R); c <= Math.ceil(cx + R); c++) for (let r = Math.floor(cy - R); r <= Math.ceil(cy + R); r++) {
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    if (Math.hypot(c + 0.5 - cx, r + 0.5 - cy) <= R) out.push(c + ',' + r);
  }
  return out;
}
// Squares to rectangles: runs along each row, then runs with the same columns on consecutive rows are joined into one taller rectangle.
function rectsOfCells(set) {
  const g = gridPx(), rows = new Map();
  for (const k of set) { const [c, r] = k.split(',').map(Number); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(c); }
  const open = new Map(), out = [];
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cs = rows.get(r).sort((a, b) => a - b), runs = [];
    for (const c of cs) { const last = runs[runs.length - 1]; if (last && last[1] === c - 1) last[1] = c; else runs.push([c, c]); }
    const next = new Map();
    for (const [a, b] of runs) {
      const key = a + ',' + b, above = open.get(key);
      if (above && above.r1 === r - 1) { above.r1 = r; next.set(key, above); } else { const rect = { a, b, r0: r, r1: r }; out.push(rect); next.set(key, rect); }
    }
    open.clear(); for (const [k, v] of next) open.set(k, v);
  }
  return out.map((q) => ({ x: Math.round(q.a * g), y: Math.round(q.r0 * g), w: Math.round((q.b - q.a + 1) * g), h: Math.round((q.r1 - q.r0 + 1) * g) }));
}
// One stroke segment from the last point to this one (so a quick drag leaves no gaps).
function brushStroke(from, to, erase) {
  const g = gridPx(), steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (g / 2)));
  let changed = false;
  for (let i = 0; i <= steps; i++) {
    const q = { x: from.x + (to.x - from.x) * (i / steps), y: from.y + (to.y - from.y) * (i / steps) };
    for (const k of brushCells(q)) { if (erase ? S.drag.cells.delete(k) : (S.drag.cells.has(k) ? false : (S.drag.cells.add(k), true))) changed = true; }
  }
  if (changed) { S.difficult = rectsOfCells(S.drag.cells); S.difficultSquares = null; }
}
function setBrush(n) {
  S.brush = Math.max(1, Math.min(12, Math.round(n)));
  $('#brush').value = String(S.brush); $('#brushVal').textContent = String(S.brush);
  requestRender();
}

// Difficult terrain: shaded rectangles (always shown, stronger while the Terrain tool is selected), plus the brush.
function drawTerrain(px) {
  const editing = isTerrainTool();
  if (!S.showTerrain && !editing) return;             // hidden unless the box is ticked or the Terrain tool or the Eraser is selected
  const list = S.difficult;
  ctx.save();
  if (editing && S.hover && !(S.drag && S.drag.kind === 'pan')) {          // the brush: the squares one press would paint or erase
    ctx.fillStyle = S.tool === 'eraser' ? 'rgba(255, 90, 90, 0.30)' : 'rgba(255, 200, 80, 0.30)';
    ctx.strokeStyle = S.tool === 'eraser' ? 'rgba(255, 110, 110, 0.95)' : 'rgba(255, 215, 120, 0.95)';
    ctx.lineWidth = 1.5 * px; ctx.setLineDash([]);
    const g = gridPx();
    for (const k of brushCells(S.hover)) { const [c, r] = k.split(',').map(Number); ctx.fillRect(c * g, r * g, g, g); ctx.strokeRect(c * g, r * g, g, g); }
  }
  if (!list.length) { ctx.restore(); return; }
  for (const d of list) {
    ctx.fillStyle = editing ? 'rgba(200, 120, 40, 0.38)' : 'rgba(230, 130, 30, 0.34)';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    if (!editing) continue;                       // outlines only while the Terrain tool is selected
    ctx.strokeStyle = 'rgba(240, 160, 70, 0.9)';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([8 * px, 6 * px]);
    ctx.strokeRect(d.x, d.y, d.w, d.h);
  }
  ctx.restore();
}

// The type of a pin: start (the arrival), areas (the module's numbered rooms), places (named pins on a town or regional map: what the players learn of) and locations (named spots on a battle or camp map).
const hiddenStart = (pin) => pin.name === 'start' && PlacePins.appliesTo(S.kind);       // a town or regional map has no start location: the party does not arrive on it, there are no tokens
const pinType = (pin) => (pin.name === 'start' ? 'start' : /^area-\d+(-\d+)?$/.test(pin.name) ? 'areas' : PlacePins.appliesTo(S.kind) ? 'places' : 'locations');
S.pinTypes = { start: true, areas: true, locations: true };      // places follow the shared Show Places switch
const pinTypeShown = (pin) => { const t = pinType(pin); return t === 'places' ? PlacePins.enabled() : S.pinTypes[t] !== false; };
function drawStarts(px) {
  ctx.save();
  ctx.font = (13 * px) + 'px "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const editing = S.tool === 'start';
  if (!S.showPins) { ctx.restore(); return; }                              // the Show pins box hides them whatever the tool
  const fogged = S.fog && S.tokens.length > 0 && !S.dm && !noFog();
  const placeMap = PlacePins.appliesTo(S.kind);                            // town and regional maps: the named places show when the Show Places switch is on, red where the players do not know them yet
  for (const s of S.starts) {
    if (hiddenStart(s)) continue;
    const place = placeMap && s.name !== 'start' && !isAreaPin(s);                // a named place, including one kept from the players
    if (!pinTypeShown(s) && !(s === S.selected)) continue;                         // a type switched off (the pin being edited stays)
    const seen = fogged ? fogStateAt(s.x, s.y) : 'in sight';
    if (seen === null || (seen === 'unseen' && !editing)) continue;
    ctx.globalAlpha = seen === 'in sight' ? 1 : 0.5;
    if (s.name === 'start' && s.radius > 0) {                             // the start's arrival area: a soft circle around the pin
      const isStart = s.name === 'start';
      ctx.save();
      ctx.fillStyle = isStart ? 'rgba(63, 210, 127, 0.16)' : 'rgba(79, 157, 255, 0.13)';
      ctx.strokeStyle = isStart ? 'rgba(63, 210, 127, 0.85)' : 'rgba(79, 157, 255, 0.8)';
      ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 6 * px]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * cell(), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    if (place) { if (s === S.selected) { ctx.strokeStyle = '#f0c048'; ctx.lineWidth = 3 * px; ctx.beginPath(); ctx.arc(s.x, s.y, 13 * px, 0, Math.PI * 2); ctx.stroke(); } continue; }       // places are drawn below with the same code the players' view uses
    ctx.fillStyle = s.name === 'start' ? 'rgba(63, 210, 127, 0.95)' : 'rgba(79, 157, 255, 0.95)';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (s === S.selected) { ctx.strokeStyle = '#f0c048'; ctx.lineWidth = 3 * px; ctx.beginPath(); ctx.arc(s.x, s.y, 13 * px, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * px; }
    ctx.fillStyle = '#fff';
    if (s.name === 'start') {                                          // the start is its own kind of pin: a green ring in its circle, no label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.beginPath(); ctx.arc(s.x, s.y, 3 * px, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(63, 210, 127, 1)'; ctx.lineWidth = 3 * px; ctx.beginPath(); ctx.arc(s.x, s.y, 11 * px, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeText(s.name, s.x + 13 * px, s.y);
      ctx.fillText(s.name, s.x + 13 * px, s.y);
    }
  }
  ctx.restore();
}

// The Day/Night (or any versions) switch in the top left of the map: the other maps in this map's group.
async function refreshVariants() {
  try {
    const res = await fetch('/api/map-configs');
    S.configs = (await res.json()).configs || [];
  } catch { S.configs = []; }
  renderVariantSwitch();
}

// Time of day next to DM | Player: Day, Dawn, Dusk, Night, the same four the AI DM sets on the tabletop. The place's Day look shows by day, dawn and dusk and its Night look at night (when it has one:
// a look is a separate picture with the same walls, pins and zones, its own light, lights and sound); without a Night look the Day picture goes under the night wash.
function renderVariantSwitch() {
  $('#variantSwitch').hidden = true;                 // the old switch at the top right is replaced by the time of day in the bar
  for (const b of document.querySelectorAll('#timeSwitch button[data-time]')) b.setAttribute('aria-pressed', String(b.dataset.time === S.timeOfDay));
}
async function ensureLook() {
  const want = S.timeOfDay === 'night' ? 'night' : 'day';
  const mate = (S.group ? S.configs.filter((c) => c.group === S.group) : []).find((c) => c.variant === want);
  if (!mate || (S.variant || 'day') === want) return false;
  const url = '/uploads/' + mate.map;
  if (url === S.url) return false;
  const keep = { ...S.view };
  $('#mapSelect').value = (S.placeOf && S.placeOf.get(url)) || url;         // the list holds one entry for the place (its day look), whichever look is showing
  await loadMap(url);
  S.view = keep;                                                              // keep the same zoom and position so the looks line up
  requestRender();
  return true;
}
function setTimeOfDay(t) {
  if (!MapShared.TIMES.includes(t)) return Promise.resolve();
  S.timeOfDay = t;                                                           // not remembered: a map opens by day, as a new game does
  renderVariantSwitch();
  return ensureLook().then(() => { if (S.W) revealFog(); requestRender(); });
}
document.querySelector('#timeSwitch').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-time]'); if (!b || b.disabled) return;
  if (!S.configs.length) await refreshVariants();                             // the list of looks can be mid-refresh when the click lands
  await setTimeOfDay(b.dataset.time);
});

// The pins of this map as a list: click one to select it and bring it into view.
