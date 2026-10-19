'use strict';

/* ---------------- module areas: numbered rooms dragged onto the map as pins named area-N ---------------- */
const isAreaPin = (p) => /^area-\d+(-\d+)?$/.test(p.name);          // area-3 is the first pin of area 3, area-3-2 a second one (a room with two parts)
let AREAS = [];
let PIN_GUIDES = {};
async function loadAreas() {
  try { const r = await (await fetch('/api/map-areas?map=' + encodeURIComponent(mapName()))).json(); AREAS = r.areas || []; PIN_GUIDES = r.pinGuides || {}; } catch { AREAS = []; PIN_GUIDES = {}; }
  renderAreaList();
}
function renderAreaList() {
  const box = $('#areaBox'), list = $('#areaList');
  box.hidden = !AREAS.length;
  list.innerHTML = '';
  for (const a of AREAS) {
    const pin = S.starts.find((p) => p.name === 'area-' + a.n);
    const chip = document.createElement('button');
    chip.type = 'button'; chip.draggable = true; chip.className = 'small';
    const count = S.starts.filter((p) => p.name === 'area-' + a.n || p.name.startsWith('area-' + a.n + '-')).length;
    chip.textContent = a.n + ' ' + a.name + (count > 1 ? ' ✓ x' + count : pin ? ' ✓' : '');
    chip.title = pin ? 'Placed. Click to centre on it, or drag to move it.' : 'Drag onto the map';
    chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'area:' + a.n); e.dataTransfer.effectAllowed = 'copyMove'; });
    chip.addEventListener('click', () => { if (!pin) return; S.view.ox = $('#stage').clientWidth / 2 - pin.x * S.view.scale; S.view.oy = $('#stage').clientHeight / 2 - pin.y * S.view.scale; requestRender(); });
    list.appendChild(chip);
    if (pin) {                                                      // a second (third...) pin for an area that has several parts
      const more = document.createElement('button');
      more.type = 'button'; more.draggable = true; more.className = 'small'; more.textContent = '+';
      more.title = 'Drag onto the map to add another pin for area ' + a.n;
      more.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'area:' + a.n + ':more'); e.dataTransfer.effectAllowed = 'copy'; });
      list.appendChild(more);
    }
  }
}
cv.addEventListener('dragover', (e) => { if (AREAS.length) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
cv.addEventListener('drop', (e) => {
  const m = /^area:(\d+)(:more)?$/.exec(e.dataTransfer.getData('text/plain'));
  const area = m && AREAS.find((a) => a.n === Number(m[1]));
  if (!area || !S.img) return;
  e.preventDefault();
  const p = toWorld(e);
  const x = Math.round(clamp(p.x, 0, S.W)), y = Math.round(clamp(p.y, 0, S.H));
  let name = 'area-' + area.n;
  if (m[2]) { let k = 2; while (S.starts.some((s) => s.name === name + '-' + k)) k++; name = name + '-' + k; }
  const pin = S.starts.find((s) => s.name === name);
  if (pin) { pin.x = x; pin.y = y; } else S.starts.push({ name, x, y, desc: area.name });
  save(); renderStartList(); requestRender();
});

// Town and regional maps: the Player view shows the places marked known from the start (the tabletop adds the ones the DM has the party discover). Say so when there are none, and offer All / None.
function updatePlacesHint() {
  const places = S.starts.filter((p) => PlacePins.isPlace(p)), known = places.filter((p) => p.known === true).length;
  const applies = PlacePins.appliesTo(S.kind);
  $('#knownRow').hidden = !(applies && places.length) || S.viewAs !== 'dm';
  const hint = $('#placesHint');
  hint.hidden = !(S.viewAs === 'player' && applies && places.length > 0 && known === 0);
  hint.textContent = 'No place is marked "known from the start", so players see none yet (DM view: Players know the places from the start, or a pin\'s card).';
}
function setAllKnown(on) { for (const p of S.starts) if (PlacePins.isPlace(p)) { if (on) p.known = true; else delete p.known; } save(); updatePlacesHint(); renderStartList(); requestRender(); }
function renderStartList() {
  syncPinTypeBox();
  updatePlacesHint();
  const box = $('#startList');
  box.innerHTML = '';
  const plain = S.starts.filter((p) => !isAreaPin(p) && !hiddenStart(p));
  if (!plain.length) { box.textContent = 'No arrival spots saved for this map. With the Pins tool selected, click the map to add one.'; renderAreaList(); return; }
  const table = document.createElement('table'); table.className = 'pins-table'; table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
  const head = document.createElement('tr');
  const placeMap = PlacePins.appliesTo(S.kind);                 // Known and DM only are about what players see of named places: town and regional maps only
  for (const h of ['', 'Name', 'Known', 'DM only', '']) { const th = document.createElement('th'); th.textContent = h; th.hidden = !placeMap && (h === 'Known' || h === 'DM only'); th.title = h === 'Known' ? 'Players know this place from the start (town and regional maps)' : h === 'DM only' ? 'Never shown to the players' : ''; th.style.cssText = 'text-align:left;color:var(--muted);font-weight:600;padding:2px 4px'; head.appendChild(th); }
  table.appendChild(head);
  plain.forEach((pin) => {
    const tr = document.createElement('tr');
    if (pin === S.selected) tr.style.background = 'rgba(79,157,255,0.12)';
    const cell = (node) => { const td = document.createElement('td'); td.style.cssText = 'padding:2px 4px;vertical-align:middle'; td.appendChild(node); tr.appendChild(td); return td; };
    const go = document.createElement('button'); go.type = 'button'; go.className = 'small'; go.textContent = '◎'; go.title = pin.desc ? 'Go to this pin: ' + pin.desc : 'Go to this pin and select it';
    go.addEventListener('click', () => {
      S.view.ox = $('#stage').clientWidth / 2 - pin.x * S.view.scale;
      S.view.oy = $('#stage').clientHeight / 2 - pin.y * S.view.scale;
      S.tool !== 'start' ? setTool('start') : null;
      selectPin(pin, false);
    });
    cell(go);
    const name = document.createElement('input'); name.type = 'text'; name.value = pin.name; name.maxLength = 40; name.spellcheck = false; name.title = pin.desc || 'Edit the name'; name.style.width = '100%';
    name.addEventListener('change', () => renamePinTo(pin, name.value, name));
    cell(name).style.width = '100%';
    const isStart = pin.name === 'start';
    const known = document.createElement('input'); known.type = 'checkbox'; known.checked = pin.known === true; known.disabled = isStart;
    known.addEventListener('change', () => { if (known.checked) pin.known = true; else delete pin.known; save(); updatePlacesHint(); if (S.selected === pin) selectPin(pin, false); requestRender(); });
    cell(known).hidden = !placeMap;
    const dmOnly = document.createElement('input'); dmOnly.type = 'checkbox'; dmOnly.checked = pin.dmOnly === true; dmOnly.disabled = isStart;
    dmOnly.addEventListener('change', () => { if (dmOnly.checked) pin.dmOnly = true; else delete pin.dmOnly; save(); if (S.selected === pin) selectPin(pin, false); requestRender(); });
    cell(dmOnly).hidden = !placeMap;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'small danger'; del.textContent = '✕'; del.title = 'Delete this pin';
    del.addEventListener('click', () => removePin(pin));
    cell(del);
    table.appendChild(tr);
  });
  box.appendChild(table);
  renderAreaList();
}
// Rename a pin from the table (the same rules as the pin card: a name is needed, and only one pin is called "start").
function renamePinTo(pin, text, input) {
  const name = pinSlug(text);
  if (!name || (name === 'start' && S.starts.some((x) => x !== pin && x.name === 'start'))) { input.value = pin.name; setSavedNote(name ? 'There is already a start pin: use Make start on the pin you want.' : 'A pin needs a name.'); return; }
  if (name === pin.name) { input.value = name; return; }
  pin.name = name;
  if (S.selected === pin) { $('#pcName').value = name; $('#pcStart').hidden = name === 'start'; $('#pcRadiusRow').hidden = name !== 'start'; }
  save(); renderStartList(); requestRender();
}

function drawWalls(px) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const w of S.walls) {
    const door = w.type === 'door';
    ctx.lineWidth = (door ? 5 : 4) * px;
    const dmSees = S.viewAs === 'dm';
    ctx.strokeStyle = door && w.secret && dmSees ? 'rgba(210, 120, 255, 0.95)' : door && w.secret ? 'rgba(255, 90, 90, 0.95)' : door ? (w.open ? 'rgba(63, 210, 127, 0.95)' : w.locked ? 'rgba(255, 150, 60, 0.98)' : 'rgba(240, 192, 72, 0.95)') : w.type === 'fence' ? 'rgba(80, 200, 255, 0.95)' : w.type === 'window' ? 'rgba(190, 150, 255, 0.95)' : 'rgba(255, 90, 90, 0.95)';
    ctx.setLineDash(door && (w.open || (w.secret && dmSees)) ? [10 * px, 8 * px] : []);
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.stroke();
    if (door && dmSees && (w.locked || w.secret)) { ctx.setLineDash([]); ctx.fillStyle = w.secret ? '#d278ff' : '#ff963c'; ctx.beginPath(); ctx.arc((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, 5 * px, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// DM view: a small ring on every map light, filled amber when lit.
// Show light radius: for every map light the dim reach (dashed) and the bright reach (solid, half as far); lights that are out are grey. On a dark map the test token's carried light is drawn too.
function drawLightRadii(px) {
  const cs = cell();
  const ring = (x, y, r, colour, dashed, width) => { ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = width * px; ctx.setLineDash(dashed ? [10 * px, 7 * px] : []); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
  for (const l of S.allLights) {
    const lit = !S.lightsOff.has(l.id), c = lit ? 'rgba(255, 210, 122, 0.95)' : 'rgba(150, 156, 168, 0.7)';
    ring(l.x, l.y, l.range * cs, c, true, 2); ring(l.x, l.y, l.range * cs / 2, c, false, 2.5);
    ctx.save(); ctx.font = '700 ' + (12 * px) + 'px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = lit ? '#fff1c9' : '#c8ccd4';
    const label = Math.round(l.range * 5) + ' ft'; ctx.strokeText(label, l.x, l.y - l.range * cs - 4 * px); ctx.fillText(label, l.x, l.y - l.range * cs - 4 * px); ctx.restore();
  }
  if (S.light === 'dark') for (const t of S.tokens) {
    const reach = (lightReachFt() / FT_PER_SQUARE) * cs;
    if (reach > 0) { ring(t.x, t.y, reach, 'rgba(120, 220, 255, 0.95)', true, 2); ring(t.x, t.y, reach / 2, 'rgba(120, 220, 255, 0.95)', false, 2.5); }
  }
}
function drawLightMarkers(px) {
  for (const l of S.allLights) {
    const lit = !S.lightsOff.has(l.id);
    ctx.save();
    if (l === S.selectedLight) { ctx.strokeStyle = '#f0c048'; ctx.lineWidth = 3 * px; ctx.setLineDash([10 * px, 7 * px]); ctx.beginPath(); ctx.arc(l.x, l.y, l.range * cell(), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(l.x, l.y, l.range * cell() / 2, 0, Math.PI * 2); ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.beginPath(); ctx.arc(l.x, l.y, Math.max(cell() * 0.3, 7 * px), 0, Math.PI * 2);
    ctx.fillStyle = lit ? 'rgba(255,190,80,0.55)' : 'rgba(20,20,24,0.55)'; ctx.fill();
    ctx.lineWidth = 2 * px; ctx.strokeStyle = lit ? '#ffd27a' : '#8a8f9a'; ctx.stroke();
    ctx.restore();
  }
}

// In a dark place the test token's light warms the ground it reaches (brighter for a lantern than a candle), only where its line of sight goes.
function drawTokenLight() {
  if (S.light !== 'dark' || !S.polys.length) return;
  const strength = [0.12, 0.19, 0.24, 0.5][S.testLight], reach = (lightReachFt() / FT_PER_SQUARE) * cell();
  S.polys.forEach((poly, i) => {
    const t = S.polyOwners[i];
    ctx.save();
    ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y);
    for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k].x, poly[k].y);
    ctx.closePath(); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, reach);
    g.addColorStop(0, 'rgba(255,190,100,' + strength + ')'); g.addColorStop(0.5, 'rgba(255,160,70,' + strength * 0.55 + ')'); g.addColorStop(1, 'rgba(255,140,50,0)');
    ctx.fillStyle = g; ctx.fillRect(t.x - reach, t.y - reach, reach * 2, reach * 2);
    ctx.restore();
  });
}

function drawTokens(px) {
  const r = Math.max(cell() * 0.4, 8 * px);
  const range = (visionNow() / FT_PER_SQUARE) * cell();
  ctx.save();
  S.tokens.forEach((t, i) => {
    if (S.showPoly) {                                  // the dashed vision-range ring only shows with the Show sight outline box
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.strokeStyle = 'rgba(240, 192, 72, 0.55)';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(t.x, t.y, range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const art = artFor(S.tokenImage);
    if (art) {
      ctx.save();
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(art, t.x - r, t.y - r, r * 2, r * 2);
      ctx.restore();
      ctx.strokeStyle = '#f0c048'; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = '#1b2230';
      ctx.strokeStyle = '#f0c048';
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f0c048';
      ctx.font = `700 ${r * 1.1}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), t.x, t.y + px);
    }
  });
  ctx.restore();
}

const tokenArt = new Map();
function artFor(url) {
  if (!url) return null;
  let img = tokenArt.get(url);
  if (!img) {
    img = new Image();
    img.onload = requestRender;
    img.onerror = () => { img.failed = true; };
    img.src = url;
    tokenArt.set(url, img);
  }
  return img.complete && img.naturalWidth && !img.failed ? img : null;
}

async function loadTestTokenImages() {
  try {
    const res = await fetch('/tokens/manifest.json');
    if (!res.ok) return;
    const data = await res.json();
    const select = $('#testTokenImage');
    for (const token of Array.isArray(data.tokens) ? data.tokens : []) {
      if (!token?.file || !/^[\w-]{1,80}\.(png|webp|jpg)$/i.test(token.file)) continue;
      const option = document.createElement('option');
      option.value = '/tokens/' + token.file;
      option.textContent = String(token.name || token.file).slice(0, 100);
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === S.tokenImage)) select.value = S.tokenImage;
    else S.tokenImage = '';
  } catch { /* the numbered marker still works without the token gallery */ }
}
$('#testTokenImage').addEventListener('change', (e) => {
  S.tokenImage = e.target.value;
  store.set('vtt.maptest.tokenImage', S.tokenImage);
  requestRender();
});
