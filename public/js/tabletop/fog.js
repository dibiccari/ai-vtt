// The tabletop, part of public/index.html: fog of war.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   FOG OF WAR (shroud + current-vision layers, destination-out)
   ===================================================================== */
const shroud = document.createElement('canvas');
const sctx = shroud.getContext('2d');
const vision = document.createElement('canvas');
const vctx = vision.getContext('2d');
let fogSaveTimer = null;

function resetShroud() {
  for (const [c, cx] of [[shroud, sctx], [vision, vctx]]) {
    c.width = state.map.width;
    c.height = state.map.height;
    cx.globalCompositeOperation = 'source-over';
  }
  sctx.fillStyle = FogStyle.shroudFill(sctx, state.ambient === 'dark');         // cloudy white fog in a lit place, darkness in a dark one
  sctx.fillRect(0, 0, shroud.width, shroud.height);
}

// Small closed wall loops (tents, boulders, crates, tree trunks) are objects you see the top of: see public/js/wallobjects.js. Cached until the walls change.
let objectCache = { version: -1, loops: [] };
function objectLoops() {
  if (objectCache.version === state.wallsVersion) return objectCache.loops;
  objectCache = { version: state.wallsVersion, loops: WallObjects.loops(state.walls.filter((w) => w.type !== 'fence' && w.type !== 'window'), 9 * GRID, state.rooms) };
  return objectCache.loops;
}

// After the fog is cut for what each party member sees: reveal the top of any small object whose edge someone can see.
function revealObjectTops() {
  if (!state.sight.length || state.objectTops === false) return;       // the map says closed wall rings keep their inside hidden
  for (const loop of objectLoops()) {
    const points = WallObjects.samples(loop, 14);
    const seers = state.sight.filter((s) => points.some((p) => visibleFrom(s, p.x, p.y)));
    if (!seers.length) continue;
    // In the dark (or for the blind) only the part of the top that is lit, or within reach, shows; otherwise the whole top does.
    const partial = anyDark() || seers.some((s) => s.feel);
    if (partial) {
      const W = state.map.width, H = state.map.height;
      for (const s of seers) {
        drawSightShape(s, loop);
        for (const c of [sctx, vctx]) { c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(sightTmp, 0, 0, W, H); c.restore(); }
      }
      continue;
    }
    for (const c of [sctx, vctx]) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      c.beginPath();
      c.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) c.lineTo(loop[i].x, loop[i].y);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
}

// The lit part of the map as a canvas (white where lit), for fog colour when the map has light zones; kept until the zones, the light or the clock's level change.
function litRegion() {
  if (!(state.lightZones || []).length || state.ambientOverride || !state.map.width) return null;
  return MapShared.litRegion(state.lightZones, ambientNow() === 'dark', state.timeOfDay, state.map.width, state.map.height);       // shared with Map Test (public/js/map-shared.js)
}
function revealFog() {
  // With fog off the whole map is shown and nothing is remembered as explored. Turning fog on later starts from what the party sees then.
  if (!fogOn()) {
    state.sight = [];
    renderTurnBar();
    requestRender();
    return;
  }
  const W = state.map.width, H = state.map.height;
  vctx.globalCompositeOperation = 'source-over';
  vctx.clearRect(0, 0, W, H);
  vctx.fillStyle = FogStyle.haze(anyDark());
  vctx.fillRect(0, 0, W, H);
  const litNow = litRegion();
  if (litNow) {                                              // light zones: the thin cover over seen ground is pale over lit ground and dark over dark ground
    const tint = document.createElement('canvas'); tint.width = W; tint.height = H;
    const tx = tint.getContext('2d'); tx.fillStyle = FogStyle.haze(false); tx.fillRect(0, 0, W, H); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(litNow, 0, 0);
    vctx.fillStyle = FogStyle.haze(true); vctx.fillRect(0, 0, W, H); vctx.globalCompositeOperation = 'destination-out'; vctx.drawImage(litNow, 0, 0); vctx.globalCompositeOperation = 'source-over'; vctx.drawImage(tint, 0, 0);
  }
  state.sight = [];
  const dark = anyDark();
  let needCanvases = dark;
  const members = [];
  for (const t of state.tokens) {
    if (!t.isPC || isElsewhere(t)) continue;
    const cx = tcx(t), cy = tcy(t);
    const poly = visibilityPolygon(cx, cy);
    if (poly.length < 3) continue;
    const c = characterFor(t);
    const feel = hasCondition(t, 'blinded') || hasCondition(t, 'unconscious') ? feetToPx(1) : 0;
    const s = { cx, cy, poly, dv: feetToPx((c && c.darkvision) || 0), feel };
    if (feel) needCanvases = true;
    members.push(s);
    state.sight.push(s);
  }
  if (needCanvases) { sizeLightCanvases(W, H); if (dark) buildLitMask(); }
  for (const s of members) {
    // Bright or dim light: line of sight is all it takes. Darkness (or blindness): only what is lit, or the darkvision / touch range.
    const simple = !dark && !s.feel;
    if (!simple) drawSightShape(s);
    for (const c of [sctx, vctx]) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      if (simple) {
        c.fillStyle = '#000';
        c.beginPath();
        c.moveTo(s.poly[0].x, s.poly[0].y);
        for (let i = 1; i < s.poly.length; i++) c.lineTo(s.poly[i].x, s.poly[i].y);
        c.closePath();
        c.clip();                                                      // nothing is revealed outside the line of sight, so the soft edge never leaks through a wall
        c.filter = 'blur(' + Math.round(GRID * 0.35) + 'px)';        // a soft edge where sight ends, not a hard cut (ignored by browsers without canvas filters)
        c.fill();
      } else {
        c.drawImage(sightTmp, 0, 0, W, H);
      }
      c.restore();
    }
  }
  revealObjectTops();
  scheduleFogSave();
  renderTurnBar();
  requestRender();
}

function scheduleFogSave() {
  clearTimeout(fogSaveTimer);
  const key = fogKey();
  fogSaveTimer = setTimeout(() => {
    try {
      const data = shroud.toDataURL('image/png');
      if (!store.setRaw(key, data)) console.info('Fog not persisted (storage full or unavailable)');
      serverSave.fog(fogId(), data);
    } catch (err) {
      console.info('Fog not persisted:', err.message);
    }
  }, 700);
}

function loadFog() {
  return new Promise((resolve) => {
    const data = store.getRaw(fogKey()) || store.getRaw(`vtt.fog.${mapKey()}`);       // fog saved before sets existed was kept per picture
    if (!data) { revealFog(); resolve(); return; }
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        sctx.globalCompositeOperation = 'source-over';
        sctx.clearRect(0, 0, shroud.width, shroud.height);
        sctx.drawImage(img, 0, 0, shroud.width, shroud.height);       // another look of the same place may be a different size
      }
      revealFog();
      resolve();
    };
    img.onerror = () => { revealFog(); resolve(); };
    img.src = data;
  });
}

function resetFog() {
  store.remove(fogKey());
  resetShroud();
  revealFog();
  toast('Explored fog reset');
}

