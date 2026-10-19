'use strict';

/* ---------------- controls ---------------- */
function syncControls() {
  renderDoorList();
  $('#squaresVal').textContent = S.squares;
  $('#vision').value = S.visionFt;
  $('#visionVal').textContent = S.visionFt;
  renderStartList();
  $('#lightLevel').value = S.light; showTestLight();
  $('#ambienceKind').value = S.ambience; if (S.ambPlaying) stopAmbience(); syncSpeaker();       // a new map: the sound stops
  $('#moodSel').value = S.mood;
  $('#hexSize').value = S.hexSize; $('#hexVal').textContent = S.hexSize; applyKindUi();
  refreshVariants();
}

// What a kind of map uses: battle and camp squares, regional hexagons, town nothing. Only the controls that apply are shown.
const tilesOf = (kind) => (kind === 'regional' ? 'hex' : kind === 'town' ? 'none' : 'square');
// Town and regional maps are plain pictures: no fog of war, no test token, no light or vision (the tabletop shows them whole).
const noFog = () => S.kind === 'town' || S.kind === 'regional';
function applyKindUi() {
  $('#mapKind').value = S.kind;
  const plain = noFog();
  for (const el of [$('#fog').closest('label'), $('#mapFogRow'), $('#mapFogRule'), $('#dm').closest('label'), $('#resetFogBtn'), $('#lightBox'), $('#vision').closest('label'), document.querySelector('button.tool[data-tool="token"]'), document.querySelector('button.tool[data-tool="zones"]'), $('#showZones').closest('label'), $('#showPoly').closest('label'), $('#showLightRadius').closest('label'), $('#objectTops').closest('label'), $('#testTokenImage').closest('label'), $('#showWalls').closest('label'), $('#showTerrain').closest('label'), $('#doorsGroup')]) if (el) el.hidden = plain;
  for (const el of [$('#terrainPair'), document.querySelector('button.tool[data-tool="walls"]'), document.querySelector('button.tool[data-tool="lights"]')]) if (el) el.hidden = plain || S.viewAs === 'player';       // the editing tools: not on a plain map, not in the Player view       // a sight outline is a line-of-sight tool: not on a town or regional map
  if (plain && ['zones', 'walls', 'lights', 'terrain', 'eraser'].includes(S.tool)) setTool('start');       // a town or regional map is a plain picture: no walls, lights, terrain or zones to edit
  if (plain && S.tool === 'token') setTool('start');
  syncDmBox();
  $('#showPlacesSideRow').hidden = !PlacePins.appliesTo(S.kind); $('#showPlacesSide').checked = PlacePins.enabled(); if (typeof syncPinTypeBox === 'function') syncPinTypeBox();
  $('#hexRow').hidden = S.tiles !== 'hex' || !$('#showGrid').checked;       // the width only matters while the hexagons are shown
  $('#showTilesRow').hidden = S.tiles === 'none';
  updateScaleNote();
  $('#showTilesText').textContent = S.tiles === 'hex' ? 'Show hexagons (5 miles each)' : 'Show squares (5 ft each)';
  const squareMap = S.tiles === 'square';
  { const row = $('#squaresVal').closest('label'); if (row) row.hidden = !squareMap; }
  $('#moveTest').closest('label').hidden = !squareMap;
}

// The scale of every map: one square is 5 ft, one hexagon is 5 miles. The note says how big the picture is in those units.
function updateScaleNote() {
  const el = $('#scaleNote'); if (!el) return;
  const sz = $('#sizeNote');
  if (sz) {                                                          // height x width, in pixels and in game units
    const px = S.W ? S.H + ' x ' + S.W + ' px (height x width)' : '';
    let game = '';
    if (S.tiles === 'square' && S.squares > 0 && S.W) { const down = Math.round(S.H / (S.W / S.squares)); game = down * 5 + ' x ' + S.squares * 5 + ' ft (' + down + ' x ' + S.squares + ' squares)'; }
    else if (S.tiles === 'hex' && S.hexSize > 0 && S.W) { const a = S.W / (S.hexSize * 0.866), d = S.H / S.hexSize; game = Math.round(d * 5) + ' x ' + Math.round(a * 5) + ' miles (' + d.toFixed(1) + ' x ' + a.toFixed(1) + ' hexagons)'; }
    sz.textContent = px ? 'Size: ' + px + (game ? '\n' + game : '') : '';
  }
  if (S.tiles === 'square' && S.squares > 0 && S.W) { const across = S.squares, down = Math.round(S.H / (S.W / S.squares)); el.textContent = 'One square = 5 ft. This map is ' + across + ' x ' + down + ' squares (' + across * 5 + ' x ' + down * 5 + ' ft).'; }
  else if (S.tiles === 'hex' && S.hexSize > 0 && S.W) { const across = S.W / (S.hexSize * 0.866), down = S.H / S.hexSize; el.textContent = 'One hexagon = 5 miles. This map is about ' + across.toFixed(1) + ' x ' + down.toFixed(1) + ' hexagons (about ' + Math.round(across * 5) + ' x ' + Math.round(down * 5) + ' miles).'; }
  else el.textContent = S.tiles === 'none' ? 'A town map has no tiles.' : '';
}
function setTool(tool) {
  S.tool = tool;
  if (tool !== 'start') S.selected = null;
  if (tool !== 'lights') S.selectedLight = null;
  if (tool !== 'zones') { S.zoneSel = null; S.zonePen = null; }
  $('#zoneBox').hidden = tool !== 'zones'; positionZoneCard(); updateZoneInfo();
  positionLightCard();
  if (tool !== 'walls') { S.wallSel = null; S.wallPen = null; }
  if (tool === 'walls' && !S.showWalls) { S.showWalls = true; $('#showWalls').checked = true; }
  $('#wallBox').hidden = tool !== 'walls';
  if (tool === 'walls') syncWallBox();
  positionPinCard();
  $('#brushBox').hidden = !isTerrainTool();
  document.querySelectorAll('button.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  cv.style.cursor = 'crosshair';
  requestRender();
}

function updateHint() {
  const base = `${mapName()} · ${S.W} x ${S.H} px`;
  $('#banner').textContent = S.tokens.length ? base : `${base} · Choose the Token tool and click the map to place the player token`;
}

function updateStats() {
  updateHint();
  updateScaleNote();
  const doors = S.walls.filter((w) => w.type === 'door').length;
  const open = S.walls.filter((w) => w.type === 'door' && w.open).length;
  $('#stats').textContent = `${S.walls.length - doors} walls · ${doors} doors (${open} open) · ${S.tokens.length ? 'player token placed' : 'no player token'}\n1 square = ${cell().toFixed(1)} px · vision ${Math.round((S.visionFt / FT_PER_SQUARE) * cell())} px`;
}

function updateReadout() {
  const el = $('#readout');
  if (!S.hover || !S.img) { el.textContent = 'Move the mouse over the map.'; return; }
  const c = cell();
  const col = Math.floor(S.hover.x / c), row = Math.floor(S.hover.y / c);
  const where = `x ${Math.round(S.hover.x)}, y ${Math.round(S.hover.y)}  ·  square ${col}, ${row}`;
  if (!S.fog) { el.textContent = `${where}\nFog of war is off.`; return; }
  const st = fogStateAt(S.hover.x, S.hover.y);
  const cls = st === 'in sight' ? 'in' : st === 'explored' ? 'exp' : 'un';
  el.innerHTML = '';
  el.append(document.createTextNode(where + '\n'));
  if (st) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = st.toUpperCase();
    el.append(span);
  } else {
    el.append(document.createTextNode('Outside the map.'));
  }
}

function nearestWall(p, onlyDoors) {
  const tol = SNAP_PX * 1.5 / S.view.scale;
  let best = null, bestD = tol;
  for (const w of S.walls) {
    if (onlyDoors && w.type !== 'door') continue;
    const d = pointSegmentDistance(p.x, p.y, w);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

function tokenAt(p) {
  const r = Math.max(cell() * 0.4, 8 / S.view.scale) * 1.2;
  for (let i = S.tokens.length - 1; i >= 0; i--) {
    if (Math.hypot(p.x - S.tokens[i].x, p.y - S.tokens[i].y) <= r) return i;
  }
  return -1;
}

// Map lights (a brazier, a campfire, wall torches): the list in the sidebar and a click on the light itself put them out or light them again. Test state only.
S.lightsOff = new Set(); S.allLights = []; S.effects = [];
function renderMapLightsList() {
  const box = $('#mapLightsBox'), list = $('#mapLightsList');
  box.hidden = noFog();                                    // the same table in the DM and the Player view
  list.innerHTML = '';
  if (!S.allLights.length) { const none = document.createElement('div'); none.className = 'hint'; none.textContent = 'This map has no lights.'; list.appendChild(none); return; }
  const table = document.createElement('table'); table.className = 'lights-table'; table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
  const head = document.createElement('tr');
  for (const h of ['Name', 'Flicker', 'On', '']) { const th = document.createElement('th'); th.textContent = h; th.style.cssText = 'text-align:left;color:var(--muted);font-weight:600;padding:2px 4px'; head.appendChild(th); }
  table.appendChild(head);
  for (const l of S.allLights) {
    const tr = document.createElement('tr');
    const cell = (node) => { const td = document.createElement('td'); td.style.cssText = 'padding:2px 4px;vertical-align:middle'; td.appendChild(node); tr.appendChild(td); return td; };
    const name = document.createElement('input'); name.type = 'text'; name.value = l.name || l.id; name.maxLength = 40; name.spellcheck = false; name.title = (l.kind ? l.kind + ': ' : '') + 'edit the name'; name.style.width = '100%';
    name.addEventListener('change', () => renameLight(l, name.value, name));
    cell(name).style.width = '100%';
    const fl = document.createElement('input'); fl.type = 'checkbox'; fl.checked = l.flicker === true; fl.title = 'Flickers (animated flame)';
    fl.addEventListener('change', () => { if (fl.checked) l.flicker = true; else delete l.flicker; lightsChanged(true); });
    cell(fl);
    const on = document.createElement('input'); on.type = 'checkbox'; on.checked = !S.lightsOff.has(l.id); on.dataset.light = l.id; on.title = 'Lit: ticked lights start lit';
    on.addEventListener('change', () => { if (on.checked) delete l.on; else l.on = false; toggleMapLight(l.id, on.checked); lightsChanged(); });
    cell(on);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'small danger'; del.textContent = '✕'; del.title = 'Delete this light';
    del.addEventListener('click', (ev) => { ev.preventDefault(); deleteLight(l); });
    cell(del);
    table.appendChild(tr);
  }
  list.appendChild(table);
}
function renameLight(l, text, input) {
  const n = pinSlug(text) || l.id;
  if (S.allLights.some((x) => x !== l && x.id === n)) { input.value = l.name || l.id; setSavedNote('Another light already has that name.'); return; }
  const wasOff = S.lightsOff.has(l.id); S.lightsOff.delete(l.id); l.id = n; l.name = n; if (wasOff) S.lightsOff.add(n);
  lightsChanged(true);
}
function toggleMapLight(id, on) {
  if (on) S.lightsOff.delete(id); else S.lightsOff.add(id);
  renderMapLightsList(); revealFog(); requestRender();
}
// Editing the lights (DM view): add one where you click, delete one or all. The list is saved with the map; the table's own light switches stay separate.
const LIGHT_KINDS = { torch: { range: 6, flicker: true, color: 'ffffb060' }, campfire: { range: 9, flicker: true, color: 'ffff9a3c' }, 'small-campfire': { range: 4, flicker: true, color: 'ffff9a3c' }, brazier: { range: 8, flicker: true, color: 'ffff9a3c' }, lantern: { range: 5, flicker: false, color: 'ffffc070' }, candle: { range: 2, flicker: true, color: 'ffffd080' }, crystal: { range: 5, flicker: false, color: 'ff9fd8ff' }, lava: { range: 7, flicker: true, color: 'ffff5a1e' }, daylight: { range: 10, flicker: false, color: 'ffeccd8b' } };
function refreshLights() { S.lights = S.allLights.filter((l) => l.flicker === true); S.mapLights = S.allLights; S.lightsEdited = true; renderMapLightsList(); revealFog(); save(); requestRender(); }
function deleteLight(l) { const i = S.allLights.indexOf(l); if (i < 0) return; S.allLights.splice(i, 1); S.lightsOff.delete(l.id); refreshLights(); setSavedNote('Deleted the light ' + l.id + '.'); }
function addLightAt(p) {
  const kind = $('#newLightKind').value, d = LIGHT_KINDS[kind] || LIGHT_KINDS.torch;
  let n = 1; while (S.allLights.some((x) => x.id === kind + '-' + n)) n++;
  const l = { x: Math.round(p.x), y: Math.round(p.y), range: d.range, intensity: 1, color: d.color, kind, name: kind + '-' + n, id: kind + '-' + n, flicker: true, on: false };       // a new light flickers and starts out unlit
  S.allLights.push(l); S.lightsOff.add(l.id); S.addingLight = false; $('#addLightBtn').textContent = 'Add a light'; cv.style.cursor = ''; refreshLights(); setSavedNote('Added ' + l.id + '.');
}
/* ---- the Zones tool: draw areas with their own light, edit one on a card ---- */
const ZONE_LEVELS = [['bright', 'Bright (daylight)'], ['dim', 'Dim (lit room, dusk)'], ['dark', 'Dark'], ['time', 'Follows the time of day']];
const ZONE_COLORS = { bright: '255, 214, 80', dim: '255, 150, 60', dark: '90, 120, 255', time: '60, 220, 200' };
const zoneCard = document.createElement('div');
zoneCard.id = 'zoneCard'; zoneCard.hidden = true;
zoneCard.innerHTML = '<strong style="font-size:13px">Light zone</strong>' +
  '<label>Name <input type="text" id="zcName" maxlength="40" spellcheck="false"></label>' +
  '<label>Light <select id="zcLevel">' + ZONE_LEVELS.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('') + '</select></label>' +
  '<div class="hint" style="margin:0;font-size:11px">Follows the time of day: bright by day, dim at dawn and dusk, dark at night. In Map Test the Day look is bright and the Night look dark.</div>' +
  '<div class="lc-row"><button id="zcDelete" class="danger">Delete</button><button id="zcDone">Done</button></div>';
$('#stage').appendChild(zoneCard);
function positionZoneCard() {
  const z = S.zoneSel;
  if (!z || S.tool !== 'zones' || S.viewAs !== 'dm' || S.zonePen) { zoneCard.hidden = true; return; }
  const stage = $('#stage').getBoundingClientRect();
  if (zoneCard.hidden || zoneCard.dataset.for !== z.id) { $('#zcName').value = z.name || z.id; $('#zcLevel').value = z.level; zoneCard.dataset.for = z.id; }
  zoneCard.hidden = false;
  const cx = z.points.reduce((a, q) => a + q.x, 0) / z.points.length, cy = z.points.reduce((a, q) => a + q.y, 0) / z.points.length;
  zoneCard.style.left = clamp(S.view.ox + cx * S.view.scale + 20, 8, Math.max(8, stage.width - 252)) + 'px';
  zoneCard.style.top = clamp(S.view.oy + cy * S.view.scale - 14, 56, Math.max(56, stage.height - (zoneCard.offsetHeight || 190) - 8)) + 'px';
}
function zonesChanged() { save(); revealFog(); requestRender(); updateZoneInfo(); }
function updateZoneInfo() { $('#zoneInfo').textContent = S.zonePen ? (S.zonePen.points.length < 3 ? 'Click the corners (' + S.zonePen.points.length + ' so far)' : 'Click the first corner or press Enter to finish') : S.lightZones.length + (S.lightZones.length === 1 ? ' zone' : ' zones'); $('#zoneNew').textContent = S.zonePen ? 'Cancel' : 'Draw a zone'; }
function finishZone() {
  const pen = S.zonePen; if (!pen) return;
  S.zonePen = null;
  if (pen.points.length >= 3) {
    let n = 1; while (S.lightZones.some((z) => z.id === 'zone-' + n)) n++;
    const z = { id: 'zone-' + n, name: 'zone-' + n, level: 'dark', points: pen.points.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })) };
    S.lightZones.push(z); S.zoneSel = z; zonesChanged();
  } else updateZoneInfo();
  positionZoneCard(); requestRender();
}
function deleteZone(z) { const i = S.lightZones.indexOf(z); if (i < 0) return; S.lightZones.splice(i, 1); if (S.zoneSel === z) S.zoneSel = null; positionZoneCard(); zonesChanged(); }
$('#zoneNew').addEventListener('click', () => { if (S.zonePen) { S.zonePen = null; } else { S.zonePen = { points: [] }; S.zoneSel = null; } positionZoneCard(); updateZoneInfo(); requestRender(); });
$('#zcName').addEventListener('change', () => { const z = S.zoneSel; if (!z) return; z.name = $('#zcName').value.trim().slice(0, 40) || z.id; zonesChanged(); });
$('#zcLevel').addEventListener('change', () => { const z = S.zoneSel; if (!z) return; z.level = $('#zcLevel').value; zonesChanged(); });
$('#zcDelete').addEventListener('click', () => { if (S.zoneSel) deleteZone(S.zoneSel); });
$('#zcDone').addEventListener('click', () => { S.zoneSel = null; positionZoneCard(); requestRender(); });
function drawZones(px) {
  ctx.save();
  const sel = S.zoneSel;
  for (const z of S.lightZones) {
    const lv = zoneLevel(z), rgb = ZONE_COLORS[z.level === 'time' ? 'time' : lv];
    ctx.beginPath(); ctx.moveTo(z.points[0].x, z.points[0].y); for (let i = 1; i < z.points.length; i++) ctx.lineTo(z.points[i].x, z.points[i].y); ctx.closePath();
    ctx.fillStyle = 'rgba(' + rgb + ', ' + (z === sel ? 0.30 : 0.18) + ')'; ctx.fill();
    ctx.setLineDash(z.level === 'time' ? [10 * px, 6 * px] : []); ctx.strokeStyle = 'rgba(' + rgb + ', 0.95)'; ctx.lineWidth = (z === sel ? 3.5 : 2) * px; ctx.stroke(); ctx.setLineDash([]);
    const cx = z.points.reduce((a, q) => a + q.x, 0) / z.points.length, cy = z.points.reduce((a, q) => a + q.y, 0) / z.points.length;
    ctx.font = (13 * px) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3 * px;
    const label = (z.name || z.id) + ' · ' + (z.level === 'time' ? 'time of day (' + lv + ' now)' : lv);
    ctx.strokeText(label, cx, cy); ctx.fillText(label, cx, cy);
  }
  if (sel && !S.zonePen) { ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(122, 208, 255, 0.95)'; ctx.lineWidth = 2 * px; for (const q of sel.points) { ctx.beginPath(); ctx.rect(q.x - 5 * px, q.y - 5 * px, 10 * px, 10 * px); ctx.fill(); ctx.stroke(); } }
  const pen = S.zonePen;
  if (pen && pen.points.length) {
    ctx.strokeStyle = 'rgba(122, 208, 255, 0.95)'; ctx.lineWidth = 2.5 * px; ctx.setLineDash([8 * px, 6 * px]);
    ctx.beginPath(); ctx.moveTo(pen.points[0].x, pen.points[0].y); for (let i = 1; i < pen.points.length; i++) ctx.lineTo(pen.points[i].x, pen.points[i].y);
    if (S.hover) ctx.lineTo(S.hover.x, S.hover.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(122, 208, 255, 0.95)'; pen.points.forEach((q, i) => { ctx.beginPath(); ctx.arc(q.x, q.y, (i === 0 ? 7 : 4.5) * px, 0, Math.PI * 2); ctx.fill(); });
  }
  ctx.restore();
}

/* ---- the Walls tool: a card to edit the selected door ---- */
const doorCard = document.createElement('div');
doorCard.id = 'doorCard'; doorCard.hidden = true;
doorCard.innerHTML = '<strong style="font-size:13px">Door</strong>' +
  '<label>State <select id="dcState"><option value="">Normal</option><option value="locked">Locked</option><option value="secret">Secret</option></select></label>' +
  '<label id="dcDcRow">DC to pick the lock or find the door <input type="number" id="dcDc" min="5" max="30" step="1" placeholder="DC"></label>' +
  '<label class="check"><input type="checkbox" id="dcOpen"> Starts open</label>' +
  '<div class="lc-row"><button id="dcDelete" class="danger">Delete</button><button id="dcDone">Done</button></div>';
$('#stage').appendChild(doorCard);
function positionDoorCard() {
  const d = S.wallSel;
  if (!d || d.type !== 'door' || S.tool !== 'walls' || S.viewAs !== 'dm') { doorCard.hidden = true; return; }
  const stage = $('#stage').getBoundingClientRect();
  if (doorCard.dataset.for !== String(S.walls.indexOf(d)) || doorCard.hidden) {
    $('#dcState').value = d.secret ? 'secret' : d.locked ? 'locked' : ''; $('#dcDc').value = d.dc || ''; $('#dcOpen').checked = Boolean(d.open);
    $('#dcOpen').disabled = Boolean(d.secret || d.locked); $('#dcDcRow').hidden = !(d.secret || d.locked);
    doorCard.dataset.for = String(S.walls.indexOf(d));
  }
  doorCard.hidden = false;
  const mx = (d.x1 + d.x2) / 2, my = (d.y1 + d.y2) / 2;
  doorCard.style.left = clamp(S.view.ox + mx * S.view.scale + 24, 8, Math.max(8, stage.width - 242)) + 'px';
  doorCard.style.top = clamp(S.view.oy + my * S.view.scale - 14, 56, Math.max(56, stage.height - (doorCard.offsetHeight || 200) - 8)) + 'px';
}
function applyDoorCard() {
  const d = S.wallSel; if (!d || d.type !== 'door') return;
  const st = $('#dcState').value, open = $('#dcOpen').checked, n = st && !(Number($('#dcDc').value) >= 5) ? 15 : Math.round(Number($('#dcDc').value));       // read what was typed before the snapshot refreshes the card
  wallSnapshot();
  delete d.locked; delete d.secret;
  if (st === 'locked') { d.locked = true; d.open = false; } else if (st === 'secret') { d.secret = true; d.open = false; } else d.open = open; if (st && n >= 5 && n <= 30) d.dc = n; else delete d.dc;
  $('#dcOpen').disabled = Boolean(st); if (st) $('#dcOpen').checked = false; $('#dcDcRow').hidden = !st;
  wallsChanged(); renderDoorList(); requestRender();
}
for (const id of ['#dcState', '#dcDc', '#dcOpen']) $(id).addEventListener('change', applyDoorCard);
$('#dcDelete').addEventListener('click', () => { if (S.wallSel && S.wallSel.type === 'door') deleteWall(); });
$('#dcDone').addEventListener('click', () => { S.wallSel = null; doorCard.hidden = true; syncWallBox(); requestRender(); });

/* ---- the Lights tool: a card to edit one light ---- */
const lightCard = document.createElement('div');
lightCard.id = 'lightCard'; lightCard.hidden = true;
lightCard.innerHTML = '<label>Kind <select id="lcKind">' + Object.keys(LIGHT_KINDS).map((k) => '<option value="' + k + '">' + (k === 'small-campfire' ? 'small campfire' : k) + '</option>').join('') + '<option value="">other</option></select></label>' +
  '<label>Name <input type="text" id="lcName" maxlength="40" spellcheck="false"></label>' +
  '<label>Reach (squares: dim light to this far, bright to half) <input type="number" id="lcRange" min="1" max="40" step="0.5"></label>' +
  '<label class="check"><input type="checkbox" id="lcFlicker"> Flickers (animated flame)</label>' +
  '<label class="check"><input type="checkbox" id="lcOn"> Lit at the start</label>' +
  '<div class="lc-row"><button id="lcDelete" class="danger">Delete</button><button id="lcDone">Done</button></div>';
$('#stage').appendChild(lightCard);
function positionLightCard() {
  const l = S.selectedLight;
  if (!l || S.tool !== 'lights') { lightCard.hidden = true; return; }
  const stage = $('#stage').getBoundingClientRect();
  lightCard.hidden = false;
  lightCard.style.left = clamp(S.view.ox + l.x * S.view.scale + 20, 8, Math.max(8, stage.width - 262)) + 'px';
  lightCard.style.top = clamp(S.view.oy + l.y * S.view.scale - 14, 56, Math.max(56, stage.height - (lightCard.offsetHeight || 260) - 8)) + 'px';
}
function selectLight(l) {
  S.selectedLight = l;
  if (l) {
    $('#lcKind').value = Object.prototype.hasOwnProperty.call(LIGHT_KINDS, l.kind) ? l.kind : '';
    $('#lcName').value = l.name || l.id; $('#lcRange').value = l.range; $('#lcFlicker').checked = l.flicker === true; $('#lcOn').checked = !S.lightsOff.has(l.id);
  }
  positionLightCard(); requestRender();
}
// A flame or a name changes nothing anyone sees, so (sightUnchanged) it skips the reveal: revealing again would only wear the soft edge of the explored fog away.
function lightsChanged(sightUnchanged) { S.lights = S.allLights.filter((x) => x.flicker === true); S.mapLights = S.allLights; S.lightsEdited = true; renderMapLightsList(); if (!sightUnchanged) revealFog(); save(); requestRender(); }
$('#lcKind').addEventListener('change', () => {          // a new kind brings its usual size, colour and flame; they can be changed after
  const l = S.selectedLight; if (!l) return; const k = $('#lcKind').value, d = LIGHT_KINDS[k];
  l.kind = k || undefined; if (!k) delete l.kind;
  if (d) { l.range = d.range; l.color = d.color; if (d.flicker) l.flicker = true; else delete l.flicker; }
  selectLight(l); lightsChanged();
});
$('#lcName').addEventListener('change', () => {
  const l = S.selectedLight; if (!l) return; const n = pinSlug($('#lcName').value) || l.id;
  if (S.allLights.some((x) => x !== l && x.id === n)) { $('#lcName').value = l.name || l.id; setSavedNote('Another light already has that name.'); return; }
  const wasOff = S.lightsOff.has(l.id); S.lightsOff.delete(l.id); l.id = n; l.name = n; if (wasOff) S.lightsOff.add(n);
  lightsChanged(true);
});
$('#lcRange').addEventListener('change', () => { const l = S.selectedLight; if (!l) return; l.range = Math.max(1, Math.min(40, Number($('#lcRange').value) || l.range)); $('#lcRange').value = l.range; lightsChanged(); });
$('#lcFlicker').addEventListener('change', () => { const l = S.selectedLight; if (!l) return; if ($('#lcFlicker').checked) l.flicker = true; else delete l.flicker; lightsChanged(true); });
$('#lcOn').addEventListener('change', () => { const l = S.selectedLight; if (!l) return; if ($('#lcOn').checked) { delete l.on; S.lightsOff.delete(l.id); } else { l.on = false; S.lightsOff.add(l.id); } lightsChanged(); });
$('#lcDelete').addEventListener('click', () => { const l = S.selectedLight; if (l) { S.selectedLight = null; positionLightCard(); deleteLight(l); } });
$('#lcDone').addEventListener('click', () => { S.selectedLight = null; positionLightCard(); requestRender(); });
const lightAt = (p) => S.allLights.find((l) => Math.hypot(l.x - p.x, l.y - p.y) <= Math.max(cell() * 0.6, 14 / S.view.scale)) || null;

// The saved arrival spot under the pointer, if any.
function startAt(p) {
  const r = 14 / S.view.scale;
  for (let i = S.starts.length - 1; i >= 0; i--) {
    if (hiddenStart(S.starts[i])) continue;
    if (Math.hypot(p.x - S.starts[i].x, p.y - S.starts[i].y) <= r) return S.starts[i];
  }
  return null;
}

function wallsChanged() {
  save();
  updateStats();
  revealFog();
}
