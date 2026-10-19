// The tabletop, part of public/index.html: scenes saved ahead of time.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   SCENES: a map with its creatures, traps and lights, saved ahead of time and loaded at the table
   ===================================================================== */
const scenesKey = () => `vtt.scenes.${state.campaignId}`;
const loadScenes = () => { const s = store.get(scenesKey(), {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };

function syncScenePick() {
  const sel = $('#scenePick');
  sel.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Scenes…';
  sel.appendChild(first);
  for (const name of Object.keys(loadScenes()).sort()) { const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o); }
  $('#sceneDelete').disabled = true;
}

function saveScene() {
  const name = (prompt('Name this scene. It remembers the map and every creature, trap and light on it as they are now.') || '').trim().slice(0, 60);
  if (!name) return;
  const scenes = loadScenes();
  if (scenes[name] && !confirm(`Replace the scene "${name}"?`)) return;
  scenes[name] = {
    mapUrl: state.map.url, mapKind: state.mapKind,
    creatures: state.tokens.filter((t) => !t.isPC && !isSummon(t)).map(serializeToken),
    lightsOff: lightsOffNow(), ambientOverride: state.ambientOverride, savedAt: Date.now()
  };
  store.set(scenesKey(), scenes);
  syncScenePick();
  $('#scenePick').value = name;
  toast(`Scene "${name}" saved`, 'ok');
}

async function applyScene(name) {
  const sc = loadScenes()[name];
  if (!sc) return;
  if (!confirm(`Load the scene "${name}"? The creatures on the board now are replaced by the ones saved in it.`)) { $('#scenePick').value = ''; return; }
  const creatures = sc.creatures.map((c) => ({ ...c, conditions: Array.isArray(c.conditions) ? c.conditions : [] }));
  state.combat = { active: false, round: 0, order: [] };
  if (sc.mapUrl && sc.mapUrl !== state.map.url) {
    const place = state.availableMaps.find((p) => p.url === sc.mapUrl);
    if (place) {
      state.mapMemory[sc.mapUrl] = { npcs: creatures, party: {} };
      await travelTo({ mapUrl: place.url, mapName: place.name, kind: place.kind, col: place.start.col, row: place.start.row, px: place.startPx });
    } else {
      await setMap(sc.mapUrl);
      state.mapKind = sc.mapKind || 'battle';
      state.tokens = [...state.tokens.filter((t) => t.isPC), ...creatures];
    }
  } else {
    state.tokens = [...state.tokens.filter((t) => t.isPC || isSummon(t)), ...creatures];
  }
  state.lightsOff[state.map.url || ''] = Array.isArray(sc.lightsOff) ? sc.lightsOff : [];
  state.ambientOverride = ['bright', 'dim', 'dark'].includes(sc.ambientOverride) ? sc.ambientOverride : '';
  state.activeIndex = 0;
  revealFog();
  commitBoard();
  toast(`Scene "${name}" loaded`, 'ok');
}

function deleteScene(name) {
  if (!name || !confirm(`Delete the scene "${name}"?`)) return;
  const scenes = loadScenes();
  delete scenes[name];
  store.set(scenesKey(), scenes);
  syncScenePick();
}

