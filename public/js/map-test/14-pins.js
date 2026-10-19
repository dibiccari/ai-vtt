'use strict';

/* ---------------- pins: click to add, click a pin to select it (name, note, make start, remove) ---------------- */
const pinSlug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function nextPinName() {
  if (!PlacePins.appliesTo(S.kind) && !S.starts.some((x) => x.name === 'start')) return 'start';       // a town or regional map has no arrival spot
  let n = PlacePins.appliesTo(S.kind) ? 1 : 2;
  while (S.starts.some((x) => x.name === 'pin-' + n)) n++;
  return 'pin-' + n;
}
const pinCard = document.createElement('div');
pinCard.id = 'pinCard';
pinCard.hidden = true;
pinCard.innerHTML = '<label>Name <input type="text" id="pcName" maxlength="40" spellcheck="false"></label>' +
  '<label>Note for the DM <input type="text" id="pcNote" maxlength="300" spellcheck="false" placeholder="e.g. the cellar door at the back"></label>' +
  '<label id="pcKnownRow" class="check" title="Players see this place from the start on a town or regional map. Unticked: the DM has the party discover it in play."><input type="checkbox" id="pcKnown"> Known to players from the start</label>' +
  '<label id="pcDmOnlyRow" class="check" title="On a town or regional map the players see the named places; tick this to keep this one to yourself"><input type="checkbox" id="pcDmOnly"> Hide from players</label>' +
  '<label id="pcRadiusRow">Arrival circle (squares) <input type="number" id="pcRadius" min="0" max="12" step="0.5"></label>' +
  '<details id="pcGuide" hidden><summary>Description</summary><div id="pcGuideText"></div></details>' +
  '<div class="pc-row"><button id="pcStart">Make start</button><button id="pcRemove" class="danger">Remove</button><button id="pcDone">Done</button></div>';
$('#stage').appendChild(pinCard);

function positionPinCard() {
  if (!S.selected || S.tool !== 'start') { pinCard.hidden = true; return; }
  const stage = $('#stage').getBoundingClientRect();
  const x = S.view.ox + S.selected.x * S.view.scale + 18, y = S.view.oy + S.selected.y * S.view.scale - 14;
  pinCard.hidden = false;
  pinCard.style.left = clamp(x, 8, Math.max(8, stage.width - 248)) + 'px';
  const h = pinCard.offsetHeight || 150;                                  // never drop past the bottom of the map: the whole card stays in view
  pinCard.style.top = clamp(y, 56, Math.max(56, stage.height - h - 8)) + 'px';
}
function selectPin(pin, focus) {
  S.selected = pin;
  if (pin) {
    $('#pcName').value = pin.name;
    $('#pcNote').value = pin.desc || '';
    $('#pcKnown').checked = pin.known === true; $('#pcKnownRow').hidden = !PlacePins.appliesTo(S.kind) || pin.name === 'start' || /^area-\d+/.test(pin.name);
    $('#pcDmOnly').checked = pin.dmOnly === true; $('#pcDmOnlyRow').hidden = !PlacePins.appliesTo(S.kind) || pin.name === 'start' || /^area-\d+/.test(pin.name);
    $('#pcStart').hidden = pin.name === 'start';
    $('#pcRadius').value = pin.radius || 0;
    $('#pcRadiusRow').hidden = pin.name !== 'start';       // only the start pin has an arrival circle; the other pins are descriptions
    const am = /^area-(\d+)/.exec(pin.name), area = am && AREAS.find((a) => a.n === Number(am[1])), pinGuide = PIN_GUIDES[pin.name];        // a module area pin shows its text from the adventure
    $('#pcGuide').hidden = !((area && area.text) || pinGuide);
    $('#pcGuide').open = false;
    $('#pcGuideText').textContent = area && area.text ? area.name + '. ' + area.text : (pinGuide || '');
  }
  positionPinCard();
  renderStartList();
  requestRender();
  if (pin && focus) { $('#pcName').focus(); $('#pcName').select(); }
}
function renamePin() {
  const pin = S.selected;
  if (!pin) return;
  const name = pinSlug($('#pcName').value);
  // pins may share a name (alternative spots, two guard posts); only "start" is unique, use Make start for that
  if (!name || (name === 'start' && S.starts.some((x) => x !== pin && x.name === 'start'))) { $('#pcName').value = pin.name; setSavedNote(name ? 'There is already a start pin: use Make start on the pin you want.' : 'A pin needs a name.'); return; }
  if (name !== pin.name) { pin.name = name; $('#pcName').value = name; $('#pcStart').hidden = name === 'start'; $('#pcRadiusRow').hidden = name !== 'start'; save(); renderStartList(); requestRender(); }
}
function removePin(pin) {
  const i = S.starts.indexOf(pin);
  if (i < 0) return;
  S.starts.splice(i, 1);
  if (S.selected === pin) S.selected = null;
  save(); positionPinCard(); renderStartList(); requestRender();
}
$('#pcName').addEventListener('change', renamePin);
$('#pcName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { renamePin(); e.target.blur(); } if (e.key === 'Escape') { $('#pcName').value = S.selected ? S.selected.name : ''; e.target.blur(); } });
$('#pcRadius').addEventListener('input', () => {
  if (!S.selected) return;
  S.selected.radius = Math.max(0, Math.min(12, Number($('#pcRadius').value) || 0));
  if (S.selected.name === 'start') { parkAtStart(); revealFog(); }
  save(); requestRender();
});
$('#pcKnown').addEventListener('change', () => { if (S.selected) { if ($('#pcKnown').checked) S.selected.known = true; else delete S.selected.known; save(); updatePlacesHint(); requestRender(); } });
$('#pcDmOnly').addEventListener('change', () => { if (S.selected) { if ($('#pcDmOnly').checked) S.selected.dmOnly = true; else delete S.selected.dmOnly; save(); requestRender(); } });
$('#pcNote').addEventListener('input', () => { if (S.selected) { S.selected.desc = $("#pcNote").value.slice(0, 300); save(); renderStartList(); } });
$('#pcStart').addEventListener('click', () => {
  const pin = S.selected;
  if (!pin) return;
  const old = S.starts.find((x) => x.name === 'start' && x !== pin);
  if (old) old.name = nextPinName();                     // the old start pin becomes an ordinary pin
  pin.name = 'start';
  $('#pcName').value = 'start'; $('#pcStart').hidden = true; $('#pcRadiusRow').hidden = false;
  parkAtStart(); revealFog();
  save(); renderStartList(); requestRender();
});
$('#pcRemove').addEventListener('click', () => { if (S.selected) removePin(S.selected); });
$('#pcDone').addEventListener('click', () => selectPin(null));
