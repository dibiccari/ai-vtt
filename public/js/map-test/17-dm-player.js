'use strict';

/* ---------------- DM | Player ---------------- */
// The DM version is a second picture of the same map (data/dm-maps, served by /api/dm-map): the player picture with the pins, areas and secrets marked. Without one the DM sees the player picture plus live marks.
function loadDmVersion() {
  S.dmImg = null; S.dmMsg = ''; updateViewUi();
  const name = mapName(); if (!name) return;
  const img = new Image();
  img.onload = () => { if (mapName() === name) { S.dmImg = img; updateViewUi(); requestRender(); } };
  img.onerror = () => updateViewUi();
  img.src = '/api/dm-map?map=' + encodeURIComponent(name) + '&t=' + Date.now();
}
function updateViewUi() {
  document.querySelectorAll('#viewSwitch button[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.viewAs)));
  $('#viewSwitch').title = S.viewAs === 'player' ? 'What the table sees' : S.dmImg ? 'DM version of the picture' : 'Player picture with live DM marks (no DM version saved)';
  renderMapLightsList(); updatePlacesHint();
  $('#placesRow').hidden = !(PlacePins.appliesTo(S.kind) && S.starts.some((p) => PlacePins.isPlace(p)));          // like the tabletop: a town or regional map that has named places
  $('#showPlaces').checked = PlacePins.enabled(); $('#showPlacesSide').checked = PlacePins.enabled(); $('#showPlacesSideRow').hidden = !PlacePins.appliesTo(S.kind);
  $('#labelsRow').hidden = !(MapLabels.appliesTo(S.kind) && S.labels.length > 0);       // like the tabletop: a regional map that has names
  $('#showLabels').checked = MapLabels.enabled();
}
function setView(v) {
  S.viewAs = v; S.dm = v === 'dm'; syncDmBox();
  // The player view has no editing of pins or terrain: those buttons go away, and a tool that is no longer there gives way to the Token tool.
  const player = v === 'player';
  document.querySelectorAll('button.tool[data-tool="start"]').forEach((b) => { b.hidden = player; }); $('#terrainPair').hidden = player || noFog();
  document.querySelectorAll('button.tool[data-tool="walls"]').forEach((b) => { b.hidden = player || noFog(); });
  document.querySelectorAll('button.tool[data-tool="lights"]').forEach((b) => { b.hidden = player || noFog(); });
  document.querySelectorAll('button.tool[data-tool="zones"]').forEach((b) => { b.hidden = player || noFog(); });
  if (player && ['start', 'terrain', 'eraser', 'walls', 'zones', 'lights'].includes(S.tool)) setTool('token'); else if (!player) $('#brushBox').hidden = !isTerrainTool();
  if (player) $('#brushBox').hidden = true;
  const keptFog = copyFog();
  updateViewUi(); resetFog(keptFog); requestRender();
}
document.getElementById('viewSwitch').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) setView(b.dataset.view); });
