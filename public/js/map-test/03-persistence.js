'use strict';

/* ---------------- persistence ---------------- */
const mapName = () => (S.url || '').split('/').pop();
let serverSaveTimer = null;

// Browser storage keeps tokens and view settings; walls and calibration also go to the server (data/maps/).
function save() {
  if (!S.url) return;
  if (S.starts.some((p) => p.name === 'start')) S.missingStart.delete(mapName()); else S.missingStart.add(mapName());
  refreshMapLabels();
  store.set(testKey(), { squares: S.squares, walls: S.walls, tokens: S.tokens, visionFt: S.visionFt });
  clearTimeout(serverSaveTimer);
  const name = mapName();
  const fields = JSON.parse(JSON.stringify({ squares: S.squares, walls: S.walls, starts: S.starts, difficult: S.difficult, source: S.source, group: S.group, variant: S.variant, light: S.light, ambience: S.ambience, mood: S.mood, tiles: S.tiles, hexSize: S.hexSize, kind: S.kind, lightZones: S.lightZones, ...(S.mapFog === false ? { fog: false } : {}), ...(S.objectTops === false ? { objectTops: false } : {}), ...(S.lightsEdited ? { lights: S.allLights.map(({ id, ...rest }) => rest), lightsEdited: true } : {}) }));;
  pendingSave = () => { saveChain = saveChain.then(sendSave, sendSave); return saveChain; };
  const sendSave = async () => {
    if (S.stale) { setSavedNote('Not saved: this map was changed elsewhere. Reload the page.'); return; }
    try {
      const res = await fetch('/api/map-config?map=' + encodeURIComponent(name), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, baseVersion: S.setVersion })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { if (res.status === 409) S.stale = true; throw new Error(out.error || 'HTTP ' + res.status); }
      if (Number.isFinite(out.version)) S.setVersion = out.version;
      setSavedNote('Saved to the server');
    } catch (err) {
      setSavedNote('Not saved to the server: ' + err.message);
    }
  };
  serverSaveTimer = setTimeout(() => { const run = pendingSave; pendingSave = null; if (run) run(); }, 500);
}
let pendingSave = null, saveChain = Promise.resolve();
// A change waiting for its half second is written now, so the next look of the same place reads it.
async function flushSave() {
  clearTimeout(serverSaveTimer);
  const run = pendingSave; pendingSave = null;
  if (run) await run();
}

let noteTimer = null;
function setSavedNote(text) {
  $('#saved').textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('#saved').textContent = ''; }, 4000);
}

async function fetchServerConfig(name) {
  try {
    const res = await fetch('/api/map-config?map=' + encodeURIComponent(name));
    if (!res.ok) return null;
    const data = await res.json();
    S.setVersion = data.setVersion || 0; S.stale = false;
    return data.config;
  } catch { return null; }
}

function validWall(w) {
  return w && [w.x1, w.y1, w.x2, w.y2].every((n) => typeof n === 'number' && isFinite(n));
}

function cleanWalls(list) {
  return (Array.isArray(list) ? list : []).filter(validWall).map((w) => ({
    x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, type: w.type === 'door' ? 'door' : w.type === 'fence' ? 'fence' : w.type === 'window' ? 'window' : 'wall', open: Boolean(w.open) && !(w.type === 'door' && w.secret),
    ...(w.type === 'door' && w.locked ? { locked: true } : {}), ...(w.type === 'door' && w.secret ? { secret: true } : {}), ...(w.type === 'door' && w.dc ? { dc: w.dc } : {})
  }));
}
