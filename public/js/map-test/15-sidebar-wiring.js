'use strict';

/* ---------------- sidebar wiring ---------------- */
document.querySelectorAll('button.tool').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.tool === 'start' && !S.showPins) { S.showPins = true; $('#showPins').checked = true; }       // clicking the Pins tool turns the pins back on; nothing else does
  setTool(b.dataset.tool);
}));
$('#mapSelect').addEventListener('change', (e) => loadMap(e.target.value).then(() => ensureLook()).then(renderVariantSwitch));
$('#campaignFilter').addEventListener('change', (e) => { store.set('vtt.maptest.campaign', e.target.value); loadMapList(); });
// The Campaign filter lists every campaign; it keeps the choice you made last.
async function fillCampaignFilter() {
  const sel = $('#campaignFilter');
  if (sel.dataset.filled) return;
  sel.dataset.filled = '1';
  try {
    const list = (await (await fetch('/api/campaigns')).json()).campaigns || [];
    for (const c of list) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name || c.id; sel.appendChild(o); }
  } catch { /* no campaign list: the filter offers only All and None */ }
  sel.value = store.get('vtt.maptest.campaign', '') || '';
  if (sel.value !== (store.get('vtt.maptest.campaign', '') || '')) sel.value = '';
}
$('#publisher').value = store.get('vtt.maptest.publisher', '') || '';
$('#publisher').addEventListener('change', (e) => { store.set('vtt.maptest.publisher', e.target.value); loadMapList(); });
$('#testDv').value = String(S.darkvisionFt);
$('#testDv').addEventListener('change', (e) => { S.darkvisionFt = Number(e.target.value); store.set('vtt.maptest.dv', S.darkvisionFt); revealFog(); });
$('#lightLevel').addEventListener('change', (e) => { S.light = e.target.value; showTestLight(); resetFog(); save(); });       // the fog's colour follows the light, so the explored layer starts again
// Hear the selected ambient sound: the speaker button plays or stops it (not saved, only a way of listening). Automatic follows the kind of place and its light, as the tabletop does.
function ambienceToPlay() {
  const v = $('#ambienceKind').value;
  if (v === 'none') return '';
  if (v) return v;
  const dark = S.light === 'dark';
  return S.kind === 'regional' ? 'wind' : S.kind === 'town' ? 'town' : S.kind === 'camp' ? (dark ? 'night' : 'forest') : (dark ? 'dungeon' : 'wind');
}
function syncSpeaker() {
  const btn = $('#ambPlay'), scene = ambienceToPlay();
  btn.disabled = !scene || !window.Ambience;
  btn.title = !scene ? 'No sound is selected' : S.ambPlaying ? 'Stop the sound' : 'Play the selected sound';
  if ((!scene || !window.Ambience) && S.ambPlaying) stopAmbience();
  btn.setAttribute('aria-pressed', String(Boolean(S.ambPlaying)));
}
function stopAmbience() { S.ambPlaying = false; try { Ambience.stop('scene'); } catch { /* no sound engine */ } $('#ambPlay').setAttribute('aria-pressed', 'false'); }
function playAmbience() {
  const scene = ambienceToPlay(); if (!scene || !window.Ambience) return;
  try { Ambience.unlock(); Ambience.allowRetired(true); Ambience.setEnabled(true); Ambience.setVolume(0.6); Ambience.setScene(scene); S.ambPlaying = true; } catch { S.ambPlaying = false; }
}
$('#ambPlay').addEventListener('click', () => { if (S.ambPlaying) stopAmbience(); else playAmbience(); syncSpeaker(); });
$('#ambienceKind').addEventListener('change', (e) => { S.ambience = e.target.value; save(); if (S.ambPlaying) { if (ambienceToPlay()) playAmbience(); else stopAmbience(); } syncSpeaker(); });
// Moods (from the Market's list): picking one also sets the light level and the ambient sound that go with it.
let MOODS = [];
fetch('/api/market').then((r) => r.json()).then((shop) => {
  MOODS = shop.moods || [];
  for (const m of MOODS.filter((x) => x.id)) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; $('#moodSel').appendChild(o); }
  $('#moodSel').value = S.mood;
}).catch(() => {});
$('#moodSel').addEventListener('change', (e) => {
  S.mood = e.target.value;
  const m = MOODS.find((x) => x.id === S.mood);
  if (m && m.light) { S.light = m.light; $('#lightLevel').value = S.light; }
  if (m && m.ambience) { S.ambience = m.ambience; $('#ambienceKind').value = S.ambience; }
  save();
});

$('#vision').addEventListener('input', (e) => {
  S.visionFt = Number(e.target.value);
  $('#visionVal').textContent = S.visionFt;
  save();
  updateStats();
  revealFog();
});
$('#moveTest').addEventListener('change', (e) => { S.moveTest = e.target.checked; requestRender(); });
$('#fog').addEventListener('change', (e) => { S.fog = e.target.checked; syncDmBox(); requestRender(); updateReadout(); });       // only a way of looking: nothing is saved
$('#mapFog').addEventListener('change', (e) => { S.mapFog = e.target.checked; S.fog = S.mapFog; $('#fog').checked = S.fog; syncDmBox(); save(); requestRender(); updateReadout(); });       // saved with the map: the tabletop reads it
// DM view (see through fog) only means something while fog of war is on: with the fog off (or on a map that has none) the box is unticked and inactive.
function syncDmBox() {
  const showBox = $('#fog'); showBox.disabled = !S.mapFog; showBox.title = S.mapFog ? 'Only for looking: show or hide the fog while you work. It does not change whether the map has fog.' : 'This map has no fog (Fog of war on this map is off)';
  if (!S.mapFog) { S.fog = false; showBox.checked = false; }
  const on = S.fog && !noFog(); const box = $('#dm'); box.disabled = !on; box.checked = on && S.dm; box.title = on ? '' : 'Only used while Show Fog is on'; }
$('#dm').addEventListener('change', (e) => { S.dm = e.target.checked; requestRender(); });
S.showZones = store.get('vtt.maptest.zones', false) === true; $('#showZones').checked = S.showZones; $('#showZones').addEventListener('change', (e) => { S.showZones = e.target.checked; store.set('vtt.maptest.zones', S.showZones); requestRender(); });
S.showLightRadius = store.get('vtt.maptest.lightRadius', false) === true; $('#showLightRadius').checked = S.showLightRadius;
$('#objectTops').addEventListener('change', (e) => { S.objectTops = e.target.checked; save(); resetFog(); });       // explored ground is remembered, so the layer starts again
$('#showLightRadius').addEventListener('change', (e) => { S.showLightRadius = e.target.checked; store.set('vtt.maptest.lightRadius', S.showLightRadius); requestRender(); });
$('#showPoly').addEventListener('change', (e) => { S.showPoly = e.target.checked; requestRender(); });
$('#showWalls').addEventListener('change', (e) => { S.showWalls = e.target.checked; requestRender(); });
$('#addLightBtn').addEventListener('click', () => { S.addingLight = !S.addingLight; $('#addLightBtn').textContent = S.addingLight ? 'Click the map… (cancel)' : 'Add a light'; cv.style.cursor = S.addingLight ? 'crosshair' : ''; });
$('#knownAll').addEventListener('click', () => setAllKnown(true)); $('#knownNone').addEventListener('click', () => setAllKnown(false));
{ const fg = $('#fogGroup'); try { if (localStorage.getItem('vtt.maptest.fogOpen') === '0') fg.open = false; } catch (e) { /* open */ } fg.addEventListener('toggle', () => { try { localStorage.setItem('vtt.maptest.fogOpen', fg.open ? '1' : '0'); } catch (e) { /* not remembered */ } }); }          // the Fog and sight section is an accordion, open by default
{ const pg = $('#pinsGroup'); try { pg.open = localStorage.getItem('vtt.maptest.pinsOpen') === '1'; } catch (e) { /* closed */ } pg.addEventListener('toggle', () => { try { localStorage.setItem('vtt.maptest.pinsOpen', pg.open ? '1' : '0'); } catch (e) { /* not remembered */ } }); }          // the Pins section is an accordion, closed by default
{ const mg = $('#mapGroup'); try { if (localStorage.getItem('vtt.maptest.mapOpen') === '0') mg.open = false; } catch (e) { /* open */ } mg.addEventListener('toggle', () => { try { localStorage.setItem('vtt.maptest.mapOpen', mg.open ? '1' : '0'); } catch (e) { /* not remembered */ } }); }          // the Map section is an accordion, open by default
{ const lg = $('#mapLightsBox'); try { lg.open = localStorage.getItem('vtt.maptest.lightsOpen') === '1'; } catch (e) { /* closed */ } lg.addEventListener('toggle', () => { try { localStorage.setItem('vtt.maptest.lightsOpen', lg.open ? '1' : '0'); } catch (e) { /* not remembered */ } }); }          // the Light sources section is an accordion, closed by default
{ const dg = $('#doorsGroup'); try { dg.open = localStorage.getItem('vtt.maptest.doorsOpen') === '1'; } catch (e) { /* closed */ } dg.addEventListener('toggle', () => { try { localStorage.setItem('vtt.maptest.doorsOpen', dg.open ? '1' : '0'); } catch (e) { /* not remembered */ } }); }          // the Doors section is an accordion, remembered
const placesSwitched = (on) => { PlacePins.setEnabled(on); $('#showPlaces').checked = on; $('#showPlacesSide').checked = on; requestRender(); };
$('#showPlaces').addEventListener('change', (e) => placesSwitched(e.target.checked));
$('#showPlacesSide').addEventListener('change', (e) => placesSwitched(e.target.checked));
for (const box of document.querySelectorAll('#pinTypeBox input[data-pintype]')) box.addEventListener('change', () => { S.pinTypes[box.dataset.pintype] = box.checked; requestRender(); });
function syncPinTypeBox() {                       // only the types this kind of map has
  const placeMap = PlacePins.appliesTo(S.kind), has = (t) => S.starts.some((p) => pinType(p) === t);
  $('#pinTypeStart').hidden = !has('start') || placeMap; $('#pinTypeAreas').hidden = !has('areas'); $('#pinTypeLocations').hidden = placeMap || !has('locations');
  $('#pinTypeBox').hidden = $('#pinTypeStart').hidden && $('#pinTypeAreas').hidden && $('#pinTypeLocations').hidden && !placeMap;
}
$('#showLabels').addEventListener('change', (e) => { MapLabels.setEnabled(e.target.checked); requestRender(); });
$('#showPins').addEventListener('change', (e) => { S.showPins = e.target.checked; requestRender(); });
$('#brush').addEventListener('input', (e) => setBrush(Number(e.target.value)));
document.addEventListener('keydown', (e) => {
  if (!isTerrainTool() || e.target.closest('input, textarea, select')) return;
  if (e.key === '[') setBrush(S.brush - 1); else if (e.key === ']') setBrush(S.brush + 1);
});
$('#showTerrain').addEventListener('change', (e) => { S.showTerrain = e.target.checked; requestRender(); });
$('#showGrid').addEventListener('change', (e) => { S.showGrid = e.target.checked; applyKindUi(); requestRender(); });
$('#mapKind').addEventListener('change', (e) => { S.kind = e.target.value; S.tiles = tilesOf(S.kind); applyKindUi(); save(); requestRender(); });
$('#testLight').addEventListener('input', (e) => { S.testLight = Number(e.target.value); store.set('vtt.maptest.light', S.testLight); showTestLight(); revealFog(); });
showTestLight();
$('#hexSize').addEventListener('input', (e) => { S.hexSize = Number(e.target.value); $('#hexVal').textContent = S.hexSize; updateScaleNote(); save(); requestRender(); });

$('#resetFogBtn').addEventListener('click', resetFog);
$('#fitBtn').addEventListener('click', fitView);
$('#fitWidthBtn').addEventListener('click', fitWidth);
// zoom buttons: one step about the middle of the map pane, like the tabletop's + and − (the mouse wheel still zooms about the pointer)
const zoomStep = (factor) => {
  if (!S.img) return;
  const rect = cv.getBoundingClientRect(), mx = rect.width / 2, my = rect.height / 2;
  const wx = (mx - S.view.ox) / S.view.scale, wy = (my - S.view.oy) / S.view.scale;
  S.view.scale = clamp(S.view.scale * factor, 0.02, 12);
  S.view.ox = mx - wx * S.view.scale;
  S.view.oy = my - wy * S.view.scale;
  requestRender();
};
$('#zoomInBtn').addEventListener('click', () => zoomStep(1.25));
$('#zoomOutBtn').addEventListener('click', () => zoomStep(0.8));
