// The tabletop, part of public/index.html: character sheets, token library, map tools and event bindings.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   UI: CHARACTER SHEETS
   ===================================================================== */
async function loadCharacters() {
  try {
    const list = await api('/api/characters?campaign=' + encodeURIComponent(state.campaignId));
    state.characters = Array.isArray(list) ? list : [];
    // Older saves name characters by their old slug id ("edric"); characters have GUID ids now, so point those tokens at the new id.
    try { charAlias = await api('/api/character-aliases'); } catch (e) { /* no aliases: nothing to map */ }
  } catch (err) {
    state.characters = [];
    toast(`Could not load characters: ${err.message}`, 'error');
  }
  syncTokensWithCharacters();
}

function placeCharacterToken(c, center = true) {
  let t = state.tokens.find((x) => x.characterId === c.id);
  if (!t) {
    const mid = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
    const cell = worldToCell(mid.x, mid.y);
    const spot = freeSquareNear(clamp(cell.col, 0, cols() - 1), clamp(cell.row, 0, rows() - 1));
    t = makeToken({ id: tokenIdFor(c.id), name: c.name, color: c.color, characterId: c.id, col: spot.col, row: spot.row, speed: c.effSpeed ?? c.speed, image: c.image || '' });
    state.tokens.push(t);
    revealFog();
  }
  if (center) centerOnToken(t);
  return t;
}

/* =====================================================================
   TOKEN LIBRARY & TOKEN ART
   ===================================================================== */
function prettyMapName(url) {
  const base = String(url || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/-[0-9a-z]{6,10}$/, (m) => (/\d/.test(m) && /[a-z]/.test(m) ? '' : m));
  return base.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Map';
}

function removeTokenAt(t) {
  if (t.characterId) { toast(`${t.name} is a party character. Delete the sheet to remove them.`); return; }
  if (!confirm(`Remove ${t.name} from the map?`)) return;
  const idx = state.tokens.indexOf(t);
  state.tokens.splice(idx, 1);
  if (idx < state.activeIndex || state.activeIndex >= state.tokens.length) state.activeIndex = Math.max(0, state.activeIndex - 1);
  revealFog();
  commitBoard();
}

/* =====================================================================
   UI: MAP TOOLS
   ===================================================================== */
/* =====================================================================
   EVENT BINDINGS
   ===================================================================== */
function bindUi() {
  $('#mapPick').addEventListener('change', async (e) => {
    const p = state.availableMaps.find((x) => x.url === e.target.value);
    if (p) await travelTo({ mapUrl: p.url, mapName: p.name, kind: p.kind, col: p.start.col, row: p.start.row, px: p.startPx });
  });
  $('#resetFogBtn').addEventListener('click', () => {
    if (!fogOn()) { toast('Fog of war is off for this map.'); return; }
    if (confirm('Cover the whole map in fog again? Explored areas will be forgotten.')) resetFog();
  });
  $('#fogToggle').addEventListener('change', (e) => {
    state.fogEnabled = e.target.checked;
    saveBoard();
    revealFog();
    renderTurnBar();
  });
  $('#dmView').addEventListener('change', (e) => {
    state.dmView = e.target.checked;
    store.set('vtt.dmView.' + state.campaignId, state.dmView);
    renderTurnBar();
    renderCombat();
    requestRender();
  });
  // Sidebar tabs: the table (chat and combat), the campaign journal and the party. The last two are the Journal and Party pages shown here.
  const showTab = (name) => {
    document.querySelectorAll('.sidebar .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    for (const id of ['chat', 'journal', 'party']) $('#panel-' + id).classList.toggle('active', id === name);
    if (name === 'journal') $('#frameJournal').src = '/journal.html?embed=1&t=' + Date.now();     // reloaded each time, so it shows what the DM just wrote
    if (name === 'party') $('#frameParty').src = '/party.html?embed=1&t=' + Date.now();
    if (name === 'chat') refreshClock();                                    // a rest on the Party tab moved the game clock
    store.set('vtt.sideTab', name);
  };
  document.querySelectorAll('.sidebar .tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#lightBtn').addEventListener('click', openLightPanel);
  $('#ambienceToggle').addEventListener('change', (e) => { store.set('vtt.ambience', e.target.checked); Ambience.setEnabled(e.target.checked); if (e.target.checked) { Ambience.resume(); syncAmbience(); } });
  $('#ambienceVol').addEventListener('input', (e) => { store.set('vtt.ambienceVol', Number(e.target.value)); Ambience.setVolume(e.target.value / 100); });
  // Browsers allow sound only after a click or key press: the first one starts the ambience.
  const startAudio = () => { if (store.get('vtt.ambience', true) !== false) { Ambience.resume(); syncAmbience(); } };
  document.addEventListener('pointerdown', startAudio, { once: true });
  document.addEventListener('keydown', startAudio, { once: true });
  $('#sceneSave').addEventListener('click', saveScene);
  $('#scenePick').addEventListener('change', (e) => { $('#sceneDelete').disabled = !e.target.value; if (e.target.value) applyScene(e.target.value); });
  $('#sceneDelete').addEventListener('click', () => deleteScene($('#scenePick').value));
  $('#diceMode').addEventListener('change', (e) => { store.set('vtt.diceMode', e.target.value); syncDiceUi(); });
  $('#sendAttackRoll').addEventListener('click', () => sendAttackRoll($('#attackRoll').value));
  $('#attackRoll').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAttackRoll($('#attackRoll').value); });
  $('#autoAttackRoll').addEventListener('click', rollForMe);
  $('#rollDie').addEventListener('change', () => { $('#attackRoll').max = pickedDie().sides; });
  $('#zoomInBtn').addEventListener('click', () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.25));
  $('#zoomOutBtn').addEventListener('click', () => zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 0.8));
  $('#fitBtn').addEventListener('click', fitView);
  const placesBox = document.getElementById('showPlaces');                    // the players' switch for the named places of a town or regional map
  if (placesBox) { placesBox.checked = PlacePins.enabled(); placesBox.addEventListener('change', () => { PlacePins.setEnabled(placesBox.checked); requestRender(); }); }
  const labelsBox = document.getElementById('showLabels');                    // the players' switch for the names written on a regional map
  if (labelsBox) { labelsBox.checked = MapLabels.enabled(); labelsBox.addEventListener('change', () => { MapLabels.setEnabled(labelsBox.checked); requestRender(); }); }
  $('#fitWidthBtn').addEventListener('click', fitWidth);

  voice.init();
  $('#sendBtn').addEventListener('click', () => sendTurn());
  $('#beginBtn').addEventListener('click', () => sendTurn('[BEGIN] The players press Begin the adventure. Open the story.', { typed: true, auto: true, as: { name: 'Table' } }));
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendTurn(); }     // Enter sends, Shift+Enter starts a new line
  });
  $('#pauseBtn').addEventListener('click', () => sendTurn('[PAUSE] I am pressing the pause button. Please stop the scene here.', { typed: true }));
  $('#recapBtn').addEventListener('click', async () => {
    if (state.busy) return;
    voice.cancelSpeech();
    setBusy(true);
    try {
      const data = await jsonPost('/api/recap', {});
      const lines = Array.isArray(data.voiceLines) ? data.voiceLines : [];
      const msgEl = addChat('assistant', '📖 Previously on…\n\n' + data.narrative, lines);
      if (lines.length) voice.speak(lines, msgEl);
    } catch (err) {
      addChat('system', 'Could not get a recap: ' + err.message);
    } finally {
      setBusy(false);
    }
  });
  $('#clearChatBtn').addEventListener('click', () => {
    if (!confirm('Clear the whole chat log? The DM will lose this conversation history.')) return;
    state.chat = [];
    store.set(chatKey(), state.chat);
    renderChat();
  });

  new ResizeObserver(() => {
    resizeCanvas();
    if (!sized && wrap.clientWidth && wrap.clientHeight) { sized = true; focusStart(); }
  }).observe(wrap);
  window.matchMedia(`(resolution: ${dpr}dppx)`).addEventListener?.('change', resizeCanvas);
}

