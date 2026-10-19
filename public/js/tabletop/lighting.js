// The tabletop, part of public/index.html: ambient light, light sources and darkvision.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   LIGHTING: ambient light, light sources (map lights and lights tokens carry), darkvision
   ===================================================================== */
// A place is bright (daylight), dim (a lit room, dusk) or dark. In the dark a character sees only what a light source lights
// (bright light out to the bright radius, dim light out to the dim radius) or what their darkvision reaches; darkvision turns
// dark into dim. In bright or dim light, line of sight is all it takes.
const LIGHT_KINDS = { torch: [20, 40, 'Torch'], lantern: [30, 60, 'Lantern'], candle: [5, 10, 'Candle'], light: [20, 40, 'Light spell'] };
// Light from gear (public/data/light-data.json): more kinds (a Flame Tongue, a Sun Blade...) and which items give them. An item in lit mode shines when somebody lights it (the DM's light action); in held mode it shines while it is wielded.
let LIGHT_ITEMS = {}, LIGHT_NEEDS_ITEM = new Set();
async function loadLightData() {
  try {
    const d = await (await fetch('/data/light-data.json')).json();
    for (const [k, v] of Object.entries(d.kinds || {})) { LIGHT_KINDS[k] = [v.bright, v.dim, v.name]; if (v.needsItem) LIGHT_NEEDS_ITEM.add(k); }
    LIGHT_ITEMS = d.items || {};
  } catch { /* the four plain kinds still work */ }
}
const slugOfName = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const lightOfItem = (it) => LIGHT_ITEMS[it && it.srd] || LIGHT_ITEMS[slugOfName(it && it.name)] || null;
// The light a character's gear gives: the item that sets it (equipped, mode 'held') or, for a kind that needs an item, whether they wield one.
const gearLightKinds = (t, mode) => { const c = characterFor(t); return ((c && c.inventory) || []).filter((it) => it.equipped !== false).map(lightOfItem).filter((l) => l && (!mode || l.mode === mode)).map((l) => l.kind); };
const lightKindOf = (t) => t.lightKind || (t.isPC ? gearLightKinds(t, 'held')[0] : '') || '';
const ambientNow = () => state.ambientOverride || state.ambient;
const feetToPx = (ft) => (ft / FT_PER_SQUARE) * GRID;

// Lights that are on: the map's own (campfire, wall torches) and the ones tokens carry. Sizes in board pixels.
function allLights() {
  const out = [];
  const off = lightsOffNow();
  for (const l of state.lights) if (!off.includes(l.id)) out.push(l);
  for (const t of state.tokens) {
    const k = LIGHT_KINDS[lightKindOf(t)];
    if (k && !t.dead) out.push({ id: `token-${t.id}`, name: `${t.name}'s ${k[2].toLowerCase()}`, x: tcx(t), y: tcy(t), bright: feetToPx(k[0]), dim: feetToPx(k[1]) });
  }
  return out;
}

let lightPolyCache = { version: -1, map: new Map() };
function lightPoly(L) {
  if (lightPolyCache.version !== state.wallsVersion) lightPolyCache = { version: state.wallsVersion, map: new Map() };
  const key = `${Math.round(L.x)},${Math.round(L.y)}`;
  let poly = lightPolyCache.map.get(key);
  if (!poly) { poly = visibilityPolygon(L.x, L.y); lightPolyCache.map.set(key, poly); }
  return poly;
}

// 0 dark, 1 dim, 2 bright at a board point.
// A light zone is bright, dim, dark, or follows the time of day, which the AI DM sets: bright by day, dim at dawn and dusk, dark at night.
function timeLevel() { return MapShared.timeLevel(state.timeOfDay); }
const zoneLevel = (z) => MapShared.zoneLevel(z, state.timeOfDay);
// The table's own light override beats the zones; otherwise the last zone that holds the point wins, else the map's level.
function ambientAt(x, y) {
  if (state.ambientOverride || !(state.lightZones || []).length || x === undefined) return ambientNow();
  for (let i = state.lightZones.length - 1; i >= 0; i--) if (pointInPolygon(x, y, state.lightZones[i].points)) return zoneLevel(state.lightZones[i]);
  return ambientNow();
}
// Is any part of the place dark right now? Then sight uses the dark rules there (only lights and darkvision).
const anyDark = () => ambientNow() === 'dark' || (!state.ambientOverride && (state.lightZones || []).some((z) => zoneLevel(z) === 'dark'));
function lightLevelAt(x, y) {
  const amb = ambientAt(x, y);
  if (amb !== 'dark') return amb === 'bright' ? 2 : 1;
  let best = 0;
  for (const L of allLights()) {
    const d = Math.hypot(x - L.x, y - L.y);
    if (d > L.dim || !pointInPolygon(x, y, lightPoly(L))) continue;
    best = Math.max(best, d <= L.bright ? 2 : 1);
    if (best === 2) break;
  }
  return best;
}

// Can the party member whose sight is `s` see this board point?
function visibleFrom(s, x, y) {
  if (!pointInPolygon(x, y, s.poly)) return false;
  const d = Math.hypot(x - s.cx, y - s.cy);
  if (s.feel) return d <= s.feel;                      // blinded or unconscious: only their own square
  if (!anyDark()) return true;
  return d <= s.dv || lightLevelAt(x, y) > 0;
}

const litMask = document.createElement('canvas');
const lmctx = litMask.getContext('2d');
const sightTmp = document.createElement('canvas');
const stctx = sightTmp.getContext('2d');
const maskTmp = document.createElement('canvas');
const mtctx = maskTmp.getContext('2d');

// The lighting canvases are drawn at reduced size on big maps (the edges are soft anyway); drawing code keeps using board pixels.
let lightScale = 1;
function sizeLightCanvases(W, H) {
  lightScale = Math.min(1, 1400 / Math.max(W, H));
  const w = Math.ceil(W * lightScale), h = Math.ceil(H * lightScale);
  for (const c of [litMask, sightTmp, maskTmp]) { c.width = w; c.height = h; }
}
const scaled = (ctx) => ctx.setTransform(lightScale, 0, 0, lightScale, 0, 0);
const plainTransform = (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0);

// Where the light sources reach (in the dark): each light fills its sight polygon out to its dim radius, bright in the middle.
function buildLitMask() {
  scaled(lmctx);
  // The lit areas before any light source: everything in a bright or dim map, nothing in a dark one.
  const W = state.map.width, H = state.map.height;
  lmctx.globalCompositeOperation = 'source-over';
  if (ambientNow() !== 'dark') {
    lmctx.fillStyle = '#fff';
    lmctx.fillRect(0, 0, W, H);
  }
  if (!state.ambientOverride) {                              // light zones: lit ones are filled, dark ones cleared, in order (a later zone wins)
    for (const z of state.lightZones || []) {
      lmctx.globalCompositeOperation = zoneLevel(z) === 'dark' ? 'destination-out' : 'source-over';
      lmctx.fillStyle = '#fff';
      lmctx.beginPath(); lmctx.moveTo(z.points[0].x, z.points[0].y); for (let i = 1; i < z.points.length; i++) lmctx.lineTo(z.points[i].x, z.points[i].y); lmctx.closePath(); lmctx.fill();
    }
    lmctx.globalCompositeOperation = 'source-over';
  }
  lmctx.globalCompositeOperation = 'lighter';
  for (const L of allLights()) {
    const poly = lightPoly(L);
    if (poly.length < 3) continue;
    lmctx.save();
    lmctx.beginPath();
    lmctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) lmctx.lineTo(poly[i].x, poly[i].y);
    lmctx.closePath();
    lmctx.clip();
    const g = lmctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.dim);
    const mid = Math.min(0.98, L.bright / L.dim);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(mid, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    lmctx.fillStyle = g;
    lmctx.fillRect(L.x - L.dim, L.y - L.dim, L.dim * 2, L.dim * 2);
    lmctx.restore();
  }
  lmctx.globalCompositeOperation = 'source-over';
}

// What one party member sees right now, drawn as an opaque shape onto sightTmp: their line-of-sight polygon, cut down to what is lit
// or within their darkvision when it is dark (and to their own square when they are blind).
function drawSightShape(s, shape) {
  const poly = shape || s.poly;                       // the party member's sight polygon, or another shape to cut down the same way
  for (const c of [stctx, mtctx]) { plainTransform(c); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, sightTmp.width, sightTmp.height); scaled(c); }
  stctx.fillStyle = '#fff';
  stctx.beginPath();
  stctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) stctx.lineTo(poly[i].x, poly[i].y);
  stctx.closePath();
  stctx.fill();
  const dark = anyDark();
  if (!s.feel && !dark) return;
  if (!s.feel) { plainTransform(mtctx); mtctx.drawImage(litMask, 0, 0); scaled(mtctx); }
  const reach = s.feel || s.dv;
  if (reach > 0) {
    const g = mtctx.createRadialGradient(s.cx, s.cy, reach * 0.7, s.cx, s.cy, reach);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    mtctx.fillStyle = g;
    mtctx.fillRect(s.cx - reach, s.cy - reach, reach * 2, reach * 2);
  }
  plainTransform(stctx);
  stctx.globalCompositeOperation = 'destination-in';
  stctx.drawImage(maskTmp, 0, 0);
  stctx.globalCompositeOperation = 'source-over';
}

async function loadMapLighting(lookFile) {          // lookFile: the picture of another look of this place (its own light and lights); the default is the picture the map was loaded with
  state.ambience = '';
  state.ambient = 'bright';
  state.lights = [];
  state.lightZones = [];
  state.effects = [];
  state.difficult = [];
  state.areaPins = [];
  state.mapFog = true;
  state.objectTops = true;
  state.places = [];
  state.placePins = [];
  state.mapLabels = [];
  state.difficultSquares = null;
  state.rooms = [];
  if (!state.map.url || !state.map.img) return;
  try {
    const res = await fetch('/api/map-config?map=' + encodeURIComponent(lookFile || state.map.url.split('/').pop()));
    const { config } = await res.json();
    if (!config) return;
    if (!lookFile) { state.look = config.variant === 'night' ? 'night' : 'day'; state.lookFiles = await looksOf(config); }
    state.objectTops = config.objectTops !== false;
    state.mapFog = config.fog !== false;                       // Map Tools > Fog of war on this map (saved with the map)
    state.ambient = ['bright', 'dim', 'dark'].includes(config.light) ? config.light : 'bright';
    state.ambience = typeof config.ambience === 'string' ? config.ambience : '';
    const f = state.map.drawW / state.map.img.naturalWidth;
    // The module's numbered areas (pins named area-N, set on Map Test) as board squares, so the DM knows where each room is.
    // the other named pins of the map (not the start, not the numbered areas): places the DM can narrate and put creatures at, with the note written on the pin
    state.places = (Array.isArray(config.starts) ? config.starts : []).filter((s) => s.name !== 'start' && !/^area-\d+(-\d+)?$/.test(s.name)).map((s) => ({ name: s.name, note: String(s.desc || '').slice(0, 300), col: Math.floor(s.x * f / GRID), row: Math.floor(s.y * f / GRID), ...(s.known === true ? { known: true } : {}), ...(s.dmOnly === true ? { dmOnly: true } : {}) }));
    // What the players may see on a town or regional map (public/js/place-pins.js): the named places, in board pixels.
    state.placePins = (Array.isArray(config.starts) ? config.starts : []).filter((s) => PlacePins.isPlace(s)).map((s) => ({ name: s.name, label: s.label || '', known: s.known === true, x: s.x * f, y: s.y * f }));
    // The words on a regional map (public/js/map-labels.js): region, place and trail names, in board pixels.
    state.mapLabels = (Array.isArray(config.labels) ? config.labels : []).filter((l) => l && l.text && Number.isFinite(l.x) && Number.isFinite(l.y)).map((l) => ({ id: l.id, text: l.text, kind: l.kind, x: l.x * f, y: l.y * f, ...(l.size > 0 ? { size: l.size * f } : {}), ...(Number.isFinite(l.rot) ? { rot: l.rot } : {}), ...(Array.isArray(l.path) ? { path: l.path.map((p) => ({ x: p.x * f, y: p.y * f })) } : {}) }));
    state.areaPins = (Array.isArray(config.starts) ? config.starts : []).filter((s) => /^area-\d+(-\d+)?$/.test(s.name)).map((s) => ({ area: parseInt(s.name.slice(5), 10), name: String(s.desc || '').slice(0, 60), col: Math.floor(s.x * f / GRID), row: Math.floor(s.y * f / GRID) }));
    state.rooms = (Array.isArray(config.rooms) ? config.rooms : []).filter((r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)).map((r) => r.map((v) => v * f));     // real rooms: line-of-sight loops that fill one are not 'objects' (public/js/wallobjects.js)
    state.difficult = (Array.isArray(config.difficult) ? config.difficult : []).map((d) => ({ x: d.x * f, y: d.y * f, w: d.w * f, h: d.h * f }));
    const px = state.map.drawW / (config.squares || 50);          // board pixels per printed square
    state.effects = (Array.isArray(config.effects) ? config.effects : []).map((e) => ({ ...e, points: e.points.map((p) => ({ x: p.x * f, y: p.y * f })), ...(e.path ? { path: e.path.map((p) => ({ x: p.x * f, y: p.y * f })) } : {}) }));
    state.lightZones = (Array.isArray(config.lightZones) ? config.lightZones : []).filter((z) => z && Array.isArray(z.points) && z.points.length >= 3 && ['bright', 'dim', 'dark', 'time'].includes(z.level)).map((z) => ({ id: z.id, name: z.name || z.id, level: z.level, points: z.points.map((q) => ({ x: q.x * f, y: q.y * f })) }));
    state.lights = (Array.isArray(config.lights) ? config.lights : []).map((l, i) => ({
      on: l.on !== false, id: l.name || `light-${i}`, name: l.name || `light ${i + 1}`, x: l.x * f, y: l.y * f, dim: l.range * px, bright: (l.range * px) / 2, flicker: l.flicker === true
    }));
  } catch { /* no config: bright, no lights */ }
}

// The Day and Night looks of a place (separate pictures that share walls, pins and zones): { day, night } picture files, or null when the place has only one.
let mapConfigsCache = null;
async function looksOf(config) {
  if (!config || !config.group) return null;
  try {
    if (!mapConfigsCache) mapConfigsCache = (await (await fetch('/api/map-configs')).json()).configs || [];
    const day = mapConfigsCache.find((c) => c.group === config.group && c.variant === 'day'), night = mapConfigsCache.find((c) => c.group === config.group && c.variant === 'night');
    return day && night ? { day: day.map, night: night.map } : null;
  } catch { return null; }
}
// Show the look that matches the time of day the DM set: the Night picture at night, the Day picture otherwise. Only when both pictures are the same size (the walls, pins and fog are in
// picture pixels); a place with only a Day picture is darkened by the night wash instead. The look brings its own light level, lights and sound.
async function syncLook() {
  const files = state.lookFiles;
  if (!files || !state.map.img || !state.map.url) return;
  const want = state.timeOfDay === 'night' ? 'night' : 'day';
  if (state.look === want || !files[want]) return;
  const url = '/uploads/' + files[want];
  const img = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = url; });
  if (!img || img.naturalWidth !== state.map.img.naturalWidth || img.naturalHeight !== state.map.img.naturalHeight) return;
  if (state.look === want || (state.timeOfDay === 'night' ? 'night' : 'day') !== want) return;       // the time changed again while the picture loaded: that request is out of date
  state.map.img = img; state.look = want;
  await loadMapLighting(files[want]);
  try { syncAmbience(); if (fogOn()) revealFog(); } catch { /* the board is not ready yet */ }
  requestRender();
}

// A small panel: the place's light level and the map lights, with a switch for each.
let lightPanel = null;
function closeLightPanel() { if (lightPanel) { lightPanel.remove(); lightPanel = null; } }
function openLightPanel() {
  if (lightPanel) { closeLightPanel(); return; }
  const panel = document.createElement('div');
  panel.className = 'cond-panel';
  lightPanel = panel;
  const render = () => {
    panel.innerHTML = '';
    const head = document.createElement('h4');
    const title = document.createElement('span');
    title.textContent = 'Light';
    const close = document.createElement('button');
    close.className = 'btn btn-sm';
    close.textContent = '✕';
    close.addEventListener('click', closeLightPanel);
    head.append(title, close);
    panel.appendChild(head);
    const row = document.createElement('div');
    row.className = 'cond-row';
    const sel = document.createElement('select');
    for (const [v, label] of [['', `Map default (${state.ambient})`], ['bright', 'Bright (daylight)'], ['dim', 'Dim (lit room, dusk)'], ['dark', 'Dark']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o);
    }
    sel.value = state.ambientOverride || '';
    sel.addEventListener('change', () => { state.ambientOverride = sel.value; commitBoard(); revealFog(); });
    const lab = document.createElement('label'); lab.textContent = 'Light level'; lab.style.flex = '0 0 auto';
    row.append(lab, sel);
    panel.appendChild(row);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.lights.length ? 'Lights on this map (put one out and the dark returns):' : 'This map has no light sources of its own. Tokens can carry a torch or lantern (double-click a token).';
    panel.appendChild(hint);
    const off = lightsOffNow();
    for (const L of state.lights.slice(0, 40)) {
      const r = document.createElement('div');
      r.className = 'cond-row';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !off.includes(L.id);
      box.addEventListener('change', () => setMapLight(L.id, box.checked));
      label.append(box, document.createTextNode(` ${L.name} (${Math.floor(L.x / GRID)}, ${Math.floor(L.y / GRID)})`));
      r.appendChild(label);
      panel.appendChild(r);
    }
  };
  render();
  document.body.appendChild(panel);
  const b = $('#lightBtn').getBoundingClientRect();
  panel.style.left = clamp(b.left, 8, window.innerWidth - panel.offsetWidth - 8) + 'px';
  panel.style.top = (b.bottom + 6) + 'px';
}

function setMapLight(id, on) {
  const url = state.map.url || '';
  const list = (lightsOffNow()).filter((x) => x !== id);
  if (!on) list.push(id);
  state.lightsOff[url] = list;
  revealFog();
  commitBoard();
}

// Ambient sound and mood (public/js/ambience.js). The map can name its sound; otherwise it follows the kind of place and its light.
// The AI DM says what part of the day it is. The picture darkens at night, light zones that follow the time of day change their light, and the ambient sound follows.
function setTimeOfDay(v) {
  v = ['day', 'dawn', 'dusk', 'night'].includes(v) ? v : 'day';
  if (state.timeOfDay === v) return;
  state.timeOfDay = v;
  addChat('system', { day: '☀️ It is day.', dawn: '🌅 Dawn breaks.', dusk: '🌆 Dusk settles over the land.', night: '🌙 Night falls.' }[v]);
  syncLook();
  try { if (fogOn()) revealFog(); } catch { /* the board is not ready yet */ }
  try { syncAmbience(); } catch { /* no sound engine */ }
  requestRender(); commitBoard();
}
function ambienceScene() {
  if (state.ambience) return state.ambience;
  if (state.mapKind === 'regional') return 'wind';
  if (state.mapKind === 'town') return 'town';
  if (state.mapKind === 'camp') return ambientNow() === 'dark' || state.timeOfDay === 'night' ? 'night' : 'forest';
  return ambientNow() === 'dark' ? 'dungeon' : 'wind';
}
function syncAmbience() {
  if (!window.Ambience) return;
  Ambience.setScene(ambienceScene());
  Ambience.setMood(state.combat.active ? 'combat' : (state.mood || 'calm'));
}
function syncAmbienceUi() {
  const on = store.get('vtt.ambience', true) !== false;
  $('#ambienceToggle').checked = on;
  const vol = Number(store.get('vtt.ambienceVol', 50));
  $('#ambienceVol').value = Number.isFinite(vol) ? vol : 50;
  if (window.Ambience) { Ambience.setEnabled(on); Ambience.setVolume($('#ambienceVol').value / 100); }
}

const lightingForAi = () => ({
  ambient: ambientNow(),
  timeOfDay: state.timeOfDay,
  ...((state.lightZones || []).length && !state.ambientOverride ? { zones: state.lightZones.slice(0, 20).map((z) => ({ name: z.name, light: zoneLevel(z), followsTimeOfDay: z.level === 'time' })) } : {}),
  mapLights: state.lights.slice(0, 40).map((l) => ({ id: l.id, name: l.name, col: Math.floor(l.x / GRID), row: Math.floor(l.y / GRID), brightFt: Math.round(l.bright / GRID * FT_PER_SQUARE), dimFt: Math.round(l.dim / GRID * FT_PER_SQUARE), on: !lightsOffNow().includes(l.id) }))
});

document.addEventListener('pointerdown', (e) => { if (lightPanel && !lightPanel.contains(e.target) && e.target.id !== 'lightBtn') closeLightPanel(); });

