// The tabletop, part of public/index.html: start-up.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   INIT
   ===================================================================== */
// Nothing is selected yet: the table says so and points to the Campaigns page.
function showNoCampaign() {
  const panel = document.querySelector('.map-panel');
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--bg, #0a0d12);text-align:center;padding:24px;';
  box.innerHTML = '<div style="font-size:22px;font-weight:800">No campaign selected</div><div style="color:var(--muted);max-width:420px">Pick a campaign to play, or start a new one. The table opens with its map, characters and saved game.</div><a class="btn btn-primary" href="/campaigns.html" style="text-decoration:none;padding:9px 18px">Open Campaigns</a>';
  (panel || document.body).appendChild(box);
  if (panel) panel.style.position = 'relative';
  $('#chatLog').innerHTML = '';
  window.addEventListener('focus', () => location.reload());          // coming back from the Campaigns page: load what was chosen
}

async function init() {
  bindUi();
  // The active campaign decides which saved board and chat to load.
  let active = null, listed = false;
  try { active = ((await api('/api/campaigns')).campaigns || []).find((c) => c.active) || null; listed = true; } catch { /* the table still works without it */ }
  state.campaignId = active ? active.id : 'default';
  if (listed && !active) { showNoCampaign(); return; }                // nothing chosen yet: ask for a campaign instead of guessing
  try { state.permadeath = (await api('/api/campaigns/' + encodeURIComponent(state.campaignId) + '/settings')).permadeath === true; } catch { state.permadeath = false; }
  await serverSave.pull();
  let board = store.get(boardKey(), null);
  // A campaign with a ready-made starting scene (and no saved board yet) begins there.
  if (!board && window.Scenes && Scenes.has(state.campaignId, active && active.template)) {
    try {
      board = await Scenes.create(state.campaignId, { template: active && active.template });
      if (board && board.mapUrl) { try { Object.keys(localStorage).filter((k) => k.startsWith('vtt.fog.')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ } }
    } catch (err) { toast(`Could not build the starting scene: ${err.message}`, 'error', 6000); }
  }
  state.dmView = store.get('vtt.dmView.' + state.campaignId, false) === true;       // per campaign: the Test Lab's DM view (ghosts of hidden creatures) never shows in a real game
  $('#dmView').checked = state.dmView;
  // Light, Save scene and the scene picker are setup tools, not table controls: they stay hidden (the DM sets the lights, and scenes come from the campaign).
  state.chat = store.get(chatKey(), []);
  if (!Array.isArray(state.chat)) state.chat = [];
  if (board && typeof board === 'object') {
    state.tokens = Array.isArray(board.tokens) ? board.tokens.filter((t) => t && t.id) : [];
    state.activeIndex = Number.isInteger(board.activeIndex) ? board.activeIndex : 0;
    state.fogEnabled = board.fogEnabled !== false;   // on by default; only the Test Lab checkbox can start a board with it off
    state.gridOpacity = 0;                      // always off at the table
    state.zoomToParty = board.zoomToParty === true;
    state.clockSeconds = Number.isFinite(board.clockSeconds) ? board.clockSeconds : 0;
    // Boards saved before the kind was recorded: the Sword Coast map is the overland one.
    state.mapKind = board.mapKind === 'town' ? 'town' : board.mapKind === 'regional' || board.mapKind === 'overland' || (!board.mapKind && /northswordcoast/.test(board.mapUrl || '')) ? 'regional' : board.mapKind === 'camp' ? 'camp' : 'battle';
    state.mapMemory = board.mapMemory && typeof board.mapMemory === 'object' ? board.mapMemory : {};
    state.knownPlaces = board.knownPlaces && typeof board.knownPlaces === 'object' && !Array.isArray(board.knownPlaces) ? board.knownPlaces : {};
    state.visitedMaps = Array.isArray(board.visitedMaps) ? board.visitedMaps.filter((u) => typeof u === 'string') : [];
    state.fogBeforeOverland = typeof board.fogBeforeOverland === 'boolean' ? board.fogBeforeOverland : null;
    state.dmPad = typeof board.dmPad === 'string' ? board.dmPad.slice(0, 1500) : '';
    state.lightsOff = board.lightsOff && typeof board.lightsOff === 'object' ? board.lightsOff : {};
    state.ambientOverride = ['bright', 'dim', 'dark'].includes(board.ambientOverride) ? board.ambientOverride : '';
    state.timeOfDay = ['day', 'dawn', 'dusk', 'night'].includes(board.timeOfDay) ? board.timeOfDay : 'day';
    state.combat = board.combat && board.combat.active && Array.isArray(board.combat.order) ? { active: true, round: Math.max(1, Number(board.combat.round) || 1), order: board.combat.order.map(String) } : { active: false, round: 0, order: [] };
  }
  $('#fogToggle').checked = state.fogEnabled;
  syncMapUi();
  syncDiceUi();
  syncScenePick();
  syncAmbienceUi();
  renderChat();
  scrollChat();
  await loadCharacters();
  await loadEffectDefs();
  await loadLightData();
  if (window.ConditionRings) ConditionRings.load().then(() => requestRender()).catch(() => {});
  await refreshClock();
  connectLive();
  if (!state.tokens.length) createDefaultTokens();
  await setMap(board?.mapUrl || null);
  if (state.zoomToParty) focusStart();
  visitMap(state.map.url);
  // A campaign you built yourself has no ready-made scene: the party opens on its first map, on that map's start pin.
  if (!board && active && active.custom && !state.map.url) {
    try {
      const first = ((await api('/api/maps/available')).maps || [])[0];
      if (first) await travelTo({ mapUrl: first.url, mapName: first.name, kind: first.kind, col: first.start.col, row: first.start.row, px: first.startPx });
    } catch { /* the DM moves the table when the story opens */ }
  }
  if (!state.chat.length) {
    let campaignNote = '';
    if (active) campaignNote = active.totalChars ? ` Campaign: ${active.name} (${active.files.length} documents loaded).` : ` Campaign: ${active.name} has no text loaded, so the DM is improvising. Add it on the Campaigns page.`;
    addChat('system', `Welcome to AI-VTT. Drag the highlighted token to move (gold outline = legal range), press End Turn to pass, and describe actions here for the AI Dungeon Master.${campaignNote}`);
  }
  commitBoard();
  loadPlaces();
  // Coming back from the Campaigns page after switching: load the other campaign's board and chat.
  window.addEventListener('focus', async () => {
    if (state.campaignId === 'default') return;
    try {
      const now = ((await api('/api/campaigns')).campaigns || []).find((c) => c.active);
      if (now && now.id !== state.campaignId) location.reload();
    } catch { /* offline: stay where we are */ }
  });
}

// Debug handle for inspection in the browser console.
window.vtt = { aiTakesItsTurn, voice, syncLook, setTimeOfDay, settleBody, bodyFits, fp, tcx, tcy, effectiveSpeed, effAcOf, isFlying, flySpeedOf, checkFall, setCondition, clearCondition, beginTurn, freeSquareNear, provokedBy, cannotReactTo, insideTemplateFp, insideTemplate, serializeToken, state, interaction, reachable, visibilityPolygon, endTurn, setMap, fitView, screenToWorld, centerOf, revealFog, resetFog, seenByParty, travelTo, restTokens, applyMapUpdates, objectLoops, fogAlphaAt: (x, y) => [sctx.getImageData(Math.round(x), Math.round(y), 1, 1).data[3], vctx.getImageData(Math.round(x), 1).data[3]], lightLevelAt, allLights, setMapLight, loadMapLighting, changeHp, startCombat, endCombat, nextCombatTurn, delayTurn, resumeTurn, tokenConditions, noteRollLines, refreshClock };

init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, 'error', 6000);
});
