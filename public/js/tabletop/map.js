// The tabletop, part of public/index.html: map loading and walls.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   MAP LOADING
   ===================================================================== */
function setMap(url) {
  return new Promise((resolve) => {
    if (!url) {
      state.map = { url: null, img: null, width: DEFAULT_COLS * GRID, height: DEFAULT_ROWS * GRID, drawW: 0, drawH: 0 };
      onMapChanged().then(resolve);
      return;
    }
    const img = new Image();
    img.onload = async () => {
      // A map calibrated on the Map Test page is scaled so one printed square is one board square; otherwise small
      // images are scaled up so the map is at least 12 squares on its short side.
      let squares = null;
      try {
        const res = await fetch('/api/map-config?map=' + encodeURIComponent(url.split('/').pop()));
        const c = res.ok ? (await res.json()).config : null;
        if (c && c.squares >= 5 && c.squares <= 400) squares = c.squares;
      } catch { /* no calibration: use the natural size */ }
      let setId = '';
      try { const r = await fetch('/api/mapsets/by-picture?file=' + encodeURIComponent(url.split('/').pop())); if (r.ok) setId = (await r.json()).guid || ''; } catch { /* no set: the picture keeps its own fog */ }
      const factor = squares ? (squares * GRID) / img.naturalWidth : Math.max(1, (12 * GRID) / Math.min(img.naturalWidth, img.naturalHeight));
      const drawW = img.naturalWidth * factor;
      const drawH = img.naturalHeight * factor;
      state.map = { url, img, width: Math.ceil(drawW / GRID) * GRID, height: Math.ceil(drawH / GRID) * GRID, drawW, drawH, setId };
      onMapChanged().then(resolve);
    };
    img.onerror = () => {
      toast('Could not load that map image — using the default grid', 'error');
      setMap(null).then(resolve);
    };
    img.src = url;
  });
}

// Move the table to another map: remember the scene being left (its creatures and where the party stood),
// show the new map, and put the party at the arrival spot (or where they last stood there). Used by the AI's changeMap and by the picker.
async function travelTo(u) {
  if (!u || !u.mapUrl || u.mapUrl === state.map.url) return;
  const from = state.map.url || 'default';
  const leftKind = state.mapKind;                    // what kind of place the party is leaving: arriving at a battle map from a plain one turns the fog on
  state.mapMemory[from] = {
    npcs: state.tokens.filter((t) => !t.isPC && !t.dead).map(serializeToken),         // bodies stay behind when the party leaves
    party: Object.fromEntries(state.tokens.filter((t) => t.isPC).map((t) => [t.id, { col: t.col, row: t.row }]))
  };
  if (!noFogMap() && u.kind !== 'battle') state.fogBeforeOverland = state.fogEnabled;
  // The party is still standing where it was on the old map while the new one loads: no fog is cut for them until they are placed.
  const fogWas = state.fogEnabled;
  state.fogEnabled = false;
  await setMap(u.mapUrl);
  state.fogEnabled = fogWas;
  state.mapKind = u.kind === 'regional' || u.kind === 'town' || u.kind === 'camp' ? u.kind : 'battle';
  // An arrival spot saved on the Map Test page is in image pixels; turn it into a board square at this map's scale.
  if (u.px && state.map.img) {
    const f = state.map.drawW / state.map.img.naturalWidth;
    u = { ...u, col: Math.floor(u.px.x * f / GRID), row: Math.floor(u.px.y * f / GRID) };
  }
  const memory = state.mapMemory[u.mapUrl];
  const party = state.tokens.filter((t) => t.isPC && !isElsewhere(t));
  const away = state.tokens.filter((t) => isElsewhere(t));          // those who are elsewhere stay where they are
  state.tokens = [...party, ...away];                              // creatures belong to the scene they were in (a copy: `party` must stay just the party)
  if (memory) for (const t of memory.npcs) state.tokens.push({ ...t });
  party.forEach((t) => { t.col = -100; t.row = -100; });  // out of the way while each is placed
  for (const t of party) {
    // A named arrival spot (the front door, the alley) wins; otherwise the party goes back where they last stood on that map.
    const was = !u.explicit && memory && memory.party[t.id];
    const spot = was && inBounds(was.col, was.row) ? { col: was.col, row: was.row } : freeSquareNear(clamp(u.col, 0, cols() - 1), clamp(u.row, 0, rows() - 1), fp(t));
    t.col = spot.col;
    t.row = spot.row;
    t.movementRemaining = t.speed;
  }
  if (plainMap()) {
    state.gridOpacity = 0;
    state.fogEnabled = false;
  } else {
    state.gridOpacity = 0;
    if (state.mapKind === 'camp') state.fogEnabled = false;
    else if (state.fogBeforeOverland !== null) { state.fogEnabled = state.fogBeforeOverland; state.fogBeforeOverland = null; }
    else if (!state.fogEnabled && (leftKind === 'regional' || leftKind === 'town' || leftKind === 'camp' || !leftKind)) state.fogEnabled = true;       // a game that started on a plain map (the Lost Mine starts on the Sword Coast) has never had fog on: a battle map has it by default
  }
  state.zoomToParty = !plainMap() && cols() > 45;
  $('#fogToggle').checked = state.fogEnabled;
  syncMapUi();
  state.activeIndex = 0;
  revealFog();
  focusStart();
  commitBoard();
  syncMapPick();
  visitMap(u.mapUrl);
  addChat('system', `↳ The party arrives at ${u.mapName || 'a new map'}`);
}

// Controls that make no sense on a regional map are switched off while one is showing.
function syncMapUi() {
  const regional = noFogMap();
  const plain = plainMap();
  $('#fogToggle').disabled = regional;
  $('#resetFogBtn').disabled = regional;
  const why = plain ? 'Not used on a regional or town map' : 'No fog of war on a camp map';
  $('#fogToggle').parentElement.title = regional ? why : "Fog of war: only what the party can see from where they stand is shown, and explored areas are remembered. Enemies outside the party's sight are hidden.";
  $('#resetFogBtn').title = regional ? why : 'Cover the whole map in fog again. Explored areas are forgotten.';
}

// The maps this campaign can move to, offered in the top bar.
async function loadPlaces() {
  try {
    state.availableMaps = (await api('/api/maps/available')).maps || [];
  } catch { state.availableMaps = []; }
  renderMapPick();
}

// The Map picker offers the regional map (first, always), a camp and Phandalin (always) and any other place the party has been to. Places they have not
// found yet stay off the list; the DM can still take them there, and arriving makes them selectable.
function visitMap(url) {
  if (url && !state.visitedMaps.includes(url)) { state.visitedMaps.push(url); renderMapPick(); }
}
function renderMapPick() {
  const sel = $('#mapPick');
  sel.innerHTML = '';
  const open = state.availableMaps.filter((p) => p.kind === 'regional' || p.kind === 'camp' || p.id === 'phandalin' || state.visitedMaps.includes(p.url) || p.url === state.map.url);
  open.sort((a, b) => (a.kind === 'regional' ? 0 : 1) - (b.kind === 'regional' ? 0 : 1));       // the regional map comes first; the rest keep the campaign's order
  for (const p of open) {
    const o = document.createElement('option');
    o.value = p.url;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  $('#mapPickBox').hidden = true;                // there is no map picker on the table: the DM moves the party between maps (changeMap)
  syncMapPick();
}

function syncMapPick() {
  const sel = $('#mapPick');
  if (state.availableMaps.some((p) => p.url === state.map.url)) sel.value = state.map.url;
  else if (state.availableMaps.length) sel.selectedIndex = -1;
}

// Walls saved for this map on the server (data/maps/, made on the Map Test page), converted from image pixels to board pixels.
async function serverWalls() {
  if (!state.map.url || !state.map.img) return [];
  try {
    const res = await fetch('/api/map-config?map=' + encodeURIComponent(state.map.url.split('/').pop()));
    if (!res.ok) return [];
    const { config } = await res.json();
    if (!config || !Array.isArray(config.walls)) return [];
    state.wallsInPicture = config.source === 'dd2vtt';        // the picture already shows its own walls: only doors are marked on top
    const f = state.map.drawW / state.map.img.naturalWidth;
    return config.walls.map((w) => ({
      x1: w.x1 * f, y1: w.y1 * f, x2: w.x2 * f, y2: w.y2 * f, type: w.type === 'door' ? 'door' : w.type === 'fence' ? 'fence' : w.type === 'window' ? 'window' : 'wall', open: Boolean(w.open),
      ...(w.type === 'door' && w.locked ? { locked: true } : {}), ...(w.type === 'door' && w.secret ? { secret: true } : {}), ...(w.type === 'door' && w.dc ? { dc: w.dc } : {})
    }));
  } catch {
    return [];
  }
}

async function onMapChanged() {
  state.wallsInPicture = false;
  await loadMapLighting();
  syncAmbience();
  state.walls = applyWallState(await serverWalls(), store.get(wallsKey(), null));       // the geometry always comes from the map set; only what play changed is remembered here
  state.wallsVersion++;
  clampTokensToMap();
  resetShroud();
  fitView();
  await loadFog();
  commitBoard();
  syncLook();
}

/* =====================================================================
   WALLS
   ===================================================================== */
function snapToCorner(x, y) {
  return {
    x: clamp(Math.round(x / GRID) * GRID, 0, state.map.width),
    y: clamp(Math.round(y / GRID) * GRID, 0, state.map.height)
  };
}

// What play changes about the walls is all this browser remembers: which doors are open, and the walls the DM added. The walls themselves (and the doors' locks) come from the map set every time,
// so an edit in Map Test reaches the table.
const wallKey = (w) => [w.x1, w.y1, w.x2, w.y2].map((v) => Math.round(v)).join(',');
function wallStateToSave() {
  return { v: 2, open: Object.fromEntries(state.walls.filter((w) => w.type === 'door').map((w) => [wallKey(w), Boolean(w.open)])), extra: state.walls.filter((w) => w.added).map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, type: w.type, open: Boolean(w.open), added: true })) };
}
function applyWallState(walls, saved) {
  const list = Array.isArray(walls) ? walls : [];
  if (Array.isArray(saved)) {                          // an older save kept the whole wall list: only its door states are used
    const open = Object.fromEntries(saved.filter((w) => w && w.type === 'door').map((w) => [wallKey(w), Boolean(w.open)]));
    saved = { open, extra: [] };
  }
  if (!saved || typeof saved !== 'object') return list;
  for (const w of list) if (w.type === 'door' && !w.secret && !w.locked && saved.open && Object.hasOwn(saved.open, wallKey(w))) w.open = Boolean(saved.open[wallKey(w)]);
  for (const w of Array.isArray(saved.extra) ? saved.extra : []) if (w && [w.x1, w.y1, w.x2, w.y2].every(Number.isFinite)) list.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, type: w.type === 'door' ? 'door' : 'wall', open: Boolean(w.open), added: true });
  return list;
}
function wallsChanged() {
  state.wallsVersion++;
  store.set(wallsKey(), wallStateToSave());
  revealFog();
  renderTurnBar();
}

