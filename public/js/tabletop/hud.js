// The tabletop, part of public/index.html: toolbar, HUD and turn tracker.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   UI: TOOLBAR, HUD, TURN TRACKER
   ===================================================================== */
function updateHud() {
  const sq = interaction.hoverSquare;
  $('#hudCoords').textContent = sq ? `Col ${sq.col}, Row ${sq.row}` : `${cols()} × ${rows()} squares`;
  $('#hudZoom').textContent = `${Math.round(state.view.scale * 100)}%`;
}

// Who is acting: the speaker named above the chat box, and (in a fight) the active token's movement left.
function renderTurnBar() {
  const t = activeToken();
  $('#moveInfo').innerHTML = t && state.combat.active
    ? `<strong>${esc(t.name)}</strong> · ${t.movementRemaining}/${t.speed} ft (${Math.floor(t.movementRemaining / FT_PER_SQUARE)} sq)`
    : '';
  $('#speakerName').textContent = t ? t.name : 'the party';
  const away = state.tokens.filter(isElsewhere);
  const strip = $('#elsewhere');
  strip.hidden = !away.length;
  strip.innerHTML = away.length ? '<span>Elsewhere:</span>' + away.map((x) => `<span class="away" title="${esc(x.where)}">${esc(x.name)} · ${esc(x.where)}</span>`).join('') : '';
}

function saveBoard() {
  store.set(boardKey(), {
    mapUrl: state.map.url,
    tokens: state.tokens.map(serializeToken),
    activeIndex: state.activeIndex,
    fogEnabled: state.fogEnabled,
    gridOpacity: state.gridOpacity,
    zoomToParty: state.zoomToParty,
    clockSeconds: state.clockSeconds || 0,
    mapKind: state.mapKind,
    mapMemory: state.mapMemory,
    visitedMaps: state.visitedMaps,
    knownPlaces: state.knownPlaces,
    fogBeforeOverland: state.fogBeforeOverland,
    combat: state.combat,
    dmPad: state.dmPad,
    lightsOff: state.lightsOff,
    ambientOverride: state.ambientOverride,
    timeOfDay: state.timeOfDay
  });
}

function commitBoard() {
  saveBoard();
  renderTurnBar();
  renderCombat();
  requestRender();
}

