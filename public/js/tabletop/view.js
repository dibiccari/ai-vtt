// The tabletop, part of public/index.html: coordinates and the view (pan, zoom).
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   COORDINATES & VIEW
   ===================================================================== */
let dpr = window.devicePixelRatio || 1;
let sized = false;
const cols = () => Math.ceil(state.map.width / GRID);
const rows = () => Math.ceil(state.map.height / GRID);
const centerOf = (cell) => cell * GRID + GRID / 2;
const sqKey = (c, r) => `${c},${r}`;
// Token size: a creature's footprint is n x n squares with (col,row) its top-left square (token-size.js). Centre, drawing and range all use the footprint centre.
// A creature squeezing through a space one size smaller takes that smaller footprint while it is there (see SQUEEZING).
const fp = (t) => { const n = TokenSize.squares(t && t.size); return t && t.squeezed && n > 1 ? n - 1 : n; };
const tcx = (t) => (t.col + fp(t) / 2) * GRID;
const tcy = (t) => (t.row + fp(t) / 2) * GRID;

function screenToWorld(sx, sy) {
  const v = state.view;
  return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
}
function eventPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function worldToCell(x, y) {
  return { col: Math.floor(x / GRID), row: Math.floor(y / GRID) };
}
function inBounds(col, row) {
  return col >= 0 && row >= 0 && col < cols() && row < rows();
}

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  requestRender();
}

function fitView() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (!w || !h) return;
  const v = state.view;
  v.scale = clamp(Math.min(w / state.map.width, h / state.map.height) * 0.94, MIN_SCALE, MAX_SCALE);
  v.ox = (w - state.map.width * v.scale) / 2;
  v.oy = (h - state.map.height * v.scale) / 2;
  updateHud();
  requestRender();
}

// Fit to width: the map as wide as the table, starting at its top (drag or scroll to see the rest).
function fitWidth() {
  const w = wrap.clientWidth;
  if (!w || !state.map.width) return;
  const v = state.view;
  v.scale = clamp((w / state.map.width) * 0.98, MIN_SCALE, MAX_SCALE);
  v.ox = (w - state.map.width * v.scale) / 2;
  v.oy = 12;
  updateHud();
  requestRender();
}

function zoomAt(sx, sy, factor) {
  const v = state.view;
  const before = screenToWorld(sx, sy);
  v.scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  v.ox = sx - before.x * v.scale;
  v.oy = sy - before.y * v.scale;
  updateHud();
  requestRender();
}

// Regional and town maps are plain pictures: no tokens, no fog, no movement, shown whole. A camp map shows tokens and the grid but has no fog of war.
function plainMap() { return state.mapKind === 'regional' || state.mapKind === 'town'; }
function noFogMap() { return state.mapKind !== 'battle' || state.mapFog === false; }
// Fog of war really applies: the table has it on AND the map is one that has fog (a map set up with the fog off is shown whole to the players).
const fogOn = () => state.fogEnabled && state.mapFog !== false;

// Opening view for boards that ask for it (a big battle map is too large to show whole): close on the active token.
// Every map opens fitted to the view, whole, whatever its size (zoom in with the + button or the wheel).
function focusStart() {
  fitView();
}

function centerOnToken(t) {
  const v = state.view;
  v.ox = wrap.clientWidth / 2 - tcx(t) * v.scale;
  v.oy = wrap.clientHeight / 2 - tcy(t) * v.scale;
  requestRender();
}

