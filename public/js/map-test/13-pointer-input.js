'use strict';

/* ---------------- pointer input ---------------- */
cv.addEventListener('contextmenu', (e) => e.preventDefault());

function handleDown(e) {
  if (!S.img) return;
  try { cv.setPointerCapture(e.pointerId); } catch { /* a replayed click has no live pointer */ }
  const p = toWorld(e);

  if (S.addingLight && e.button === 0 && S.viewAs === 'dm') { addLightAt(p); return; }
  if (e.button === 1 || S.spaceDown) {
    S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: S.view.ox, oy: S.view.oy };
    cv.style.cursor = 'grabbing';
    return;
  }

  if (e.button === 2) {
    if (S.tool === 'start') { const hit = startAt(p); if (hit) removePin(hit); return; }
    if (S.tool === 'lights') { const hit = lightAt(p); if (hit) { if (S.selectedLight === hit) { S.selectedLight = null; positionLightCard(); } deleteLight(hit); } return; }
    if (S.tool === 'zones') { const cn = !S.zonePen && zoneCornerAt(p); if (cn) { if (cn.z.points.length > 3) { cn.z.points.splice(cn.i, 1); zonesChanged(); } else setSavedNote('A zone needs at least three corners; right-click inside it to delete the zone.'); return; } if (S.zonePen) { S.zonePen.points.pop(); updateZoneInfo(); requestRender(); } else { const hit = zoneAt(p); if (hit) deleteZone(hit); } return; }
    if (S.tool === 'walls' && S.wallPen) { S.wallPen = null; syncWallBox(); requestRender(); return; }
    if (S.tool === 'walls') { const w = nearestWall(p, false); if (w) { wallSnapshot(); S.walls.splice(S.walls.indexOf(w), 1); if (S.wallSel === w) S.wallSel = null; afterWallEdit(); } return; }
    if (isTerrainTool()) {
      try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      S.drag = { kind: 'brush', erase: true, last: p, cells: cellsOfRects() };
      brushStroke(p, p, true); requestRender();
      return;
    }
    return;
  }
  if (e.button !== 0) return;
  if (S.tool === 'zones') {                                            // the Zones tool: add a corner while drawing, otherwise pick the zone under the pointer
    if (S.zonePen) {
      const pen = S.zonePen, first = pen.points[0];
      if (first && pen.points.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) * S.view.scale <= 12) { finishZone(); return; }
      pen.points.push({ x: Math.round(clamp(p.x, 0, S.W)), y: Math.round(clamp(p.y, 0, S.H)) }); updateZoneInfo(); requestRender(); return;
    }
    const corner = zoneCornerAt(p);
    if (corner) { S.drag = { kind: 'zonept', z: corner.z, i: corner.i, moved: false }; return; }
    if (e.altKey) { const edge = zoneEdgeAt(p); if (edge) { edge.z.points.splice(edge.after + 1, 0, { x: edge.x, y: edge.y }); S.drag = { kind: 'zonept', z: edge.z, i: edge.after + 1, moved: true }; requestRender(); return; } }
    S.zoneSel = zoneAt(p); positionZoneCard(); requestRender(); return;
  }
  if (S.tool === 'lights') {                                           // the Lights tool: select (and drag) a light, or add one on empty ground
    if (p.x < 0 || p.y < 0 || p.x > S.W || p.y > S.H) return;
    const hit = lightAt(p);
    if (hit) { selectLight(hit); S.drag = { kind: 'light', light: hit }; return; }
    const kind = $('#newLightKind').value; let n = 1; while (S.allLights.some((x) => x.id === kind + '-' + n)) n++;
    const d = LIGHT_KINDS[kind] || LIGHT_KINDS.torch, l = { x: Math.round(p.x), y: Math.round(p.y), range: d.range, intensity: 1, color: d.color, kind, name: kind + '-' + n, id: kind + '-' + n, flicker: true, on: false };       // a new light flickers and starts out unlit
    S.allLights.push(l); S.lightsOff.add(l.id); lightsChanged(); selectLight(l);
    return;
  }
  if (!isTerrainTool() && S.tool !== 'walls') {                       // a map light under the pointer is lit or put out by a click
    const lt = lightAt(p);
    if (lt && !(S.tool === 'start' && startAt(p)) && tokenAt(p) < 0) { toggleMapLight(lt.id, S.lightsOff.has(lt.id)); return; }
  }
  {                                                                    // a pin or the token under the pointer wins; otherwise a door is clicked open or shut
    const door = doorUnder(p);
    if (door && S.tool !== 'walls' && !(S.tool === 'start' && startAt(p)) && tokenAt(p) < 0 && !(S.tool === 'start' && S.viewAs === 'dm' && startAt(p))) { clickDoor(door); return; }
  }

  if (S.tool === 'token') {
    const i = tokenAt(p);
    if (i >= 0) {
      S.drag = { kind: 'token', index: i };
    } else if (p.x >= 0 && p.y >= 0 && p.x <= S.W && p.y <= S.H) {
      // there is one player token: a click on empty ground moves it there (and it can be dragged from then on)
      if (S.tokens.length) { S.tokens[0].x = p.x; S.tokens[0].y = p.y; } else S.tokens.push({ x: p.x, y: p.y });
      S.drag = { kind: 'token', index: 0 };
      save();
      updateStats();
      revealFog();
    }
  } else if (S.tool === 'start') {
    if (p.x < 0 || p.y < 0 || p.x > S.W || p.y > S.H) return;
    // Click a pin to select it (and drag it to move it); click empty ground to add a new pin and name it on the spot.
    const grab = startAt(p);
    if (tokenAt(p) >= 0 && (!grab || grab.name === 'start')) {         // the player token has no card: dragging it moves only the token; hold Shift over the start pin to move the pin (the token goes with it)
      S.drag = grab && e.shiftKey ? { kind: 'start', spot: grab } : { kind: 'token', index: tokenAt(p) };
      if (S.drag.kind === 'token' && S.selected) { S.selected = null; positionPinCard(); renderStartList(); requestRender(); }       // moving the token closes the pin card
      return;
    }
    if (grab) {
      selectPin(grab, false);
      S.drag = { kind: 'start', spot: grab };
      return;
    }
    const pin = { name: nextPinName(), x: Math.round(p.x), y: Math.round(p.y) };
    S.starts.push(pin);
    parkAtStart(); revealFog();
    save();
    selectPin(pin, true);
  } else if (S.tool === 'walls') {
    wallDown(e, p);
  } else if (isTerrainTool()) {
    if (p.x < 0 || p.y < 0 || p.x > S.W || p.y > S.H) return;
    try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    S.drag = { kind: 'brush', erase: S.tool === 'eraser', last: p, cells: cellsOfRects() };
    brushStroke(p, p, S.drag.erase); requestRender();
  }
}

// Clicking a door opens or closes it, whichever tool is chosen (the terrain brush excepted); a locked door stays shut and a secret door is a wall until it is revealed.
const doorUnder = (p) => (isTerrainTool() || S.tool === 'walls' ? null : nearestWall(p, true));
function clickDoor(w) {
  if (w.secret) { if (S.viewAs === 'dm') setSavedNote('That is a secret door: it stays a wall until it is revealed (Doors list).'); return; }
  if (w.locked && !w.open) { setSavedNote('That door is locked: unlock it in the Doors list first.'); return; }
  w.open = !w.open; wallsChanged();
}

// Click and drag on empty ground pans the map in the Pins, Token, Lights and Walls tools (in Walls, Alt + drag draws a wall; clicking a point and then another draws one too): a press on empty ground waits to see whether it becomes a drag (pan) or stays a click (the tool's own action).
cv.addEventListener('pointerdown', (e) => {
  if (!S.img) return;
  const p = toWorld(e);
  const empty = e.button === 0 && !S.spaceDown && !doorUnder(p) && (S.tool === 'start' ? !startAt(p) && tokenAt(p) < 0 : S.tool === 'token' ? tokenAt(p) < 0 : S.tool === 'lights' ? !lightAt(p) : S.tool === 'zones' ? !S.zonePen && !zoneAt(p) && !zoneCornerAt(p) : S.tool === 'walls' ? S.viewAs === 'dm' && !S.wallPen && !e.altKey && !endpointAt(p) && !nearestWall(p, false) : false);       // empty ground: a click does the tool's action, a drag pans the map
  if (!empty) { handleDown(e); return; }
  try { cv.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  S.drag = { kind: 'pending', sx: e.clientX, sy: e.clientY, ox: S.view.ox, oy: S.view.oy, press: { clientX: e.clientX, clientY: e.clientY, button: 0, pointerId: e.pointerId, shiftKey: e.shiftKey } };
});

cv.addEventListener('pointermove', (e) => {
  if (!S.img) return;
  const p = toWorld(e);
  S.hover = p;
  if (S.drag && S.drag.kind === 'pending' && Math.hypot(e.clientX - S.drag.sx, e.clientY - S.drag.sy) > 5) {
    S.drag = { kind: 'pan', sx: S.drag.sx, sy: S.drag.sy, ox: S.drag.ox, oy: S.drag.oy };
    cv.style.cursor = 'grabbing';
  }
  if (S.drag && S.drag.kind === 'pan') {
    S.view.ox = S.drag.ox + (e.clientX - S.drag.sx);
    S.view.oy = S.drag.oy + (e.clientY - S.drag.sy);
  } else if (S.drag && S.drag.kind === 'brush') {
    brushStroke(S.drag.last, p, S.drag.erase);
    S.drag.last = p;
  } else if (S.drag && ['wallpt', 'wallmove', 'wallnew'].includes(S.drag.kind)) {
    wallMove(e, p);
  } else if (S.drag && S.drag.kind === 'zonept') {
    const q = S.drag.z.points[S.drag.i]; q.x = Math.round(clamp(p.x, 0, S.W)); q.y = Math.round(clamp(p.y, 0, S.H)); S.drag.moved = true; positionZoneCard(); requestRender();
  } else if (S.drag && S.drag.kind === 'light') {
    S.drag.light.x = Math.round(clamp(p.x, 0, S.W)); S.drag.light.y = Math.round(clamp(p.y, 0, S.H)); positionLightCard();
  } else if (S.drag && S.drag.kind === 'start') {
    S.drag.spot.x = Math.round(clamp(p.x, 0, S.W));
    S.drag.spot.y = Math.round(clamp(p.y, 0, S.H));
    if (S.drag.spot.name === 'start') { parkAtStart(); queueReveal(); }           // the test token stands on the start pin: drag the pin and watch the line of sight
  } else if (S.drag && S.drag.kind === 'token') {
    const t = S.tokens[S.drag.index];
    if (t) { t.x = clamp(p.x, 0, S.W); t.y = clamp(p.y, 0, S.H); queueReveal(); }
  }
  updateReadout();
  requestRender();
});

function endDrag(e) {
  if (S.drag && S.drag.kind === 'pending') { const press = S.drag.press; S.drag = null; handleDown(press); }       // it stayed a click: do the tool's action now
  if (!S.drag) return;
  const kind = S.drag.kind;
  const drag = S.drag;
  S.drag = null;
  try { cv.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  if (kind === 'token') save();
  if (kind === 'light') lightsChanged();
  if (kind === 'zonept' && drag.moved) zonesChanged();
  if (kind === 'start') { if (drag.spot.name === 'start') parkAtStart(); save(); renderStartList(); revealFog(); requestRender(); }
  if (kind === 'brush') { S.difficultSquares = null; save(); }
  if (['wallpt', 'wallmove', 'wallnew'].includes(kind)) wallUp(drag);
  setTool(S.tool);
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { if (!S.drag) { S.hover = null; updateReadout(); requestRender(); } });

cv.addEventListener('wheel', (e) => {
  if (!S.img) return;
  e.preventDefault();
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx = (mx - S.view.ox) / S.view.scale, wy = (my - S.view.oy) / S.view.scale;
  S.view.scale = clamp(S.view.scale * Math.exp(-e.deltaY * 0.0015), 0.02, 12);
  S.view.ox = mx - wx * S.view.scale;
  S.view.oy = my - wy * S.view.scale;
  requestRender();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === ' ') { S.spaceDown = true; e.preventDefault(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.tool === 'start' && S.selected) { e.preventDefault(); removePin(S.selected); }
  if (S.tool === 'zones') {
    if (e.key === 'Enter' && S.zonePen) { e.preventDefault(); finishZone(); }
    else if (e.key === 'Escape') { S.zonePen = null; S.zoneSel = null; positionZoneCard(); updateZoneInfo(); requestRender(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && S.zoneSel && !S.zonePen) { e.preventDefault(); deleteZone(S.zoneSel); }
  }
  if (S.tool === 'walls') {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.wallSel) { e.preventDefault(); deleteWall(); }
    else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wallUndo(); }
    else if (e.key === 'Escape') { S.wallSel = null; S.wallPen = null; syncWallBox(); requestRender(); }
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') S.spaceDown = false; });
