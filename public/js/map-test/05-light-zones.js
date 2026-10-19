'use strict';

/* ---------------- light zones: parts of one map with their own light ---------------- */
// A zone is bright, dim, dark, or "time": it follows the time of day the toolbar says (bright by day, dim at dawn and dusk, dark at night), as the AI DM's time of day does on the tabletop. Later zones win where they overlap.
const zoneLevel = (z) => MapShared.zoneLevel(z, S.timeOfDay);       // the same rule as the tabletop (public/js/map-shared.js)
const zoneAt = (p) => { for (let i = S.lightZones.length - 1; i >= 0; i--) if (inside(S.lightZones[i].points, p.x, p.y)) return S.lightZones[i]; return null; };
// A corner of the selected zone under the pointer (within a few screen pixels).
function zoneCornerAt(p) {
  const z = S.zoneSel; if (!z) return null;
  const tol = 12 / S.view.scale; let best = null, bd = tol;
  z.points.forEach((q, i) => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; best = { z, i }; } });
  return best;
}
// The edge of the selected zone nearest the pointer, with the point on it, for adding a corner (Alt + click).
function zoneEdgeAt(p) {
  const z = S.zoneSel; if (!z) return null;
  const tol = 12 / S.view.scale; let best = null, bd = tol;
  for (let i = 0; i < z.points.length; i++) {
    const a = z.points[i], b = z.points[(i + 1) % z.points.length], dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)), x = a.x + t * dx, y = a.y + t * dy, d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = { z, after: i, x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
const cloneCanvas = (c) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; };
function zonePath(c, pts) { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y); c.closePath(); }
// Two masks (white where it counts): the lit part of the map and the dark part. The edge is sharp: a zone is a polygon, and a blurred mask would let a pass leak at the map's border.
function zoneRegions() {
  const lit = MapShared.litRegion(S.lightZones, S.light === 'dark', S.timeOfDay, S.W, S.H);
  const dark = document.createElement('canvas'); dark.width = S.W; dark.height = S.H;
  const y = dark.getContext('2d'); y.fillStyle = '#fff'; y.fillRect(0, 0, S.W, S.H); y.globalCompositeOperation = 'destination-out'; y.drawImage(lit, 0, 0);
  return { lit, dark };
}
// The lit part of the map as a canvas, kept until the zones, the base light or the look change.
function litRegion() {
  if (!S.lightZones.length || !S.W) return null;
  return MapShared.litRegion(S.lightZones, S.light === 'dark', S.timeOfDay, S.W, S.H);
}
function revealFog() {
  if (!S.W) return;
  vctx.globalCompositeOperation = 'source-over';
  vctx.clearRect(0, 0, S.W, S.H);
  const baseDark = S.light === 'dark';
  vctx.fillStyle = FogStyle.haze(baseDark);
  vctx.fillRect(0, 0, S.W, S.H);
  if (S.lightZones.length) {                                   // the thin cover over seen ground: pale over lit ground, dark over dark ground
    const lit = litRegion(), tint = document.createElement('canvas'); tint.width = S.W; tint.height = S.H;
    const tx = tint.getContext('2d'); tx.fillStyle = FogStyle.haze(false); tx.fillRect(0, 0, S.W, S.H); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(lit, 0, 0);
    vctx.fillStyle = FogStyle.haze(true); vctx.fillRect(0, 0, S.W, S.H); vctx.globalCompositeOperation = 'destination-out'; vctx.drawImage(lit, 0, 0); vctx.globalCompositeOperation = 'source-over'; vctx.drawImage(tint, 0, 0);
  }
  if (!S.lightZones.length || !S.tokens.length) { revealPass(baseDark); requestRender(); return; }
  // With zones the lit and the dark parts are revealed under their own rules: each pass runs over the whole map, then what lies outside its own part is put back as it was.
  const { lit, dark } = zoneRegions();
  for (const darkPass of [false, true]) {
    const outside = darkPass ? lit : dark;
    const keep = [cloneCanvas(sctx.canvas), cloneCanvas(vctx.canvas)];
    revealPass(darkPass);
    [sctx, vctx].forEach((c, i) => {
      const back = cloneCanvas(keep[i]), bx = back.getContext('2d');
      bx.globalCompositeOperation = 'destination-in'; bx.drawImage(outside, 0, 0);       // the old picture, only outside this pass's part
      c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(outside, 0, 0); c.restore();
      c.save(); c.globalCompositeOperation = 'source-over'; c.drawImage(back, 0, 0); c.restore();
    });
  }
  requestRender();
}
function revealPass(darkPlace) {
  const radius = (visionNow() / FT_PER_SQUARE) * cell();
  const walls = sightWalls(S.walls);
  S.polys = [];
  S.polyOwners = [];
  for (const t of S.tokens) {
    const near = walls.filter((w) => pointSegmentDistance(t.x, t.y, w) <= radius * 1.1);
    const poly = visibilityPolygon(t.x, t.y, near, S.W, S.H);
    if (poly.length < 3) continue;
    S.polys.push(poly);
    S.polyOwners.push(t);
    for (const c of [sctx, vctx]) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      // 5e: in the dark only darkvision sees without a light (dark counts as dim, out to its range); otherwise the Vision range decides.
      const seeR = darkPlace ? Math.min(radius, (S.darkvisionFt / FT_PER_SQUARE) * cell()) : radius;
      const grad = c.createRadialGradient(t.x, t.y, seeR * 0.45, t.x, t.y, Math.max(seeR, 1));
      const seeing = darkPlace ? 0.4 : 1;
      grad.addColorStop(0, 'rgba(0,0,0,' + seeing + ')'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) c.lineTo(poly[i].x, poly[i].y);
      c.closePath();
      c.clip();                                                      // nothing is revealed outside the line of sight, so the soft edge below never leaks through a wall
      c.filter = 'blur(' + Math.round(cell() * 0.35) + 'px)';        // a soft edge where sight ends
      c.fill();
      if (darkPlace) {                          // the carried light: clear to its bright radius (half), fading out at its dim radius
        const lr = Math.min(radius, (lightReachFt() / FT_PER_SQUARE) * cell());
        if (lr > 0) {
        const lg = c.createRadialGradient(t.x, t.y, 0, t.x, t.y, lr);
        lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(0.5, 'rgba(0,0,0,1)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = lg; c.fill();
        }
      }
      c.restore();
    }
  }
  if (darkPlace) revealMapLights(walls, radius);
  revealObjectTops(radius, darkPlace);
}

// In a dark place the map's own lights (wall torches, braziers) light the ground they reach: what a token can see AND a light reaches is shown, bright to half the light's range, dim out to the range.
const lightTmp = document.createElement('canvas');
function revealMapLights(walls, radius) {
  if (!S.mapLights || !S.mapLights.length || !S.tokens.length) return;
  // The token's whole line of sight (not the short-range one used for its own light, which ignores far walls).
  const sights = S.tokens.map((t) => ({ t, poly: visibilityPolygon(t.x, t.y, walls, S.W, S.H) })).filter((o) => o.poly.length >= 3);
  if (lightTmp.width !== S.W || lightTmp.height !== S.H) { lightTmp.width = S.W; lightTmp.height = S.H; }
  const tctx = lightTmp.getContext('2d');
  for (const L of S.mapLights) {
    if (S.lightsOff.has(L.id)) continue;
    const r = L.range * cell();
    const near = walls.filter((w) => pointSegmentDistance(L.x, L.y, w) <= r * 1.1);
    const lp = visibilityPolygon(L.x, L.y, near, S.W, S.H);
    if (lp.length < 3) continue;
    for (const { t, poly: tp } of sights) {
      // The light, as its own soft glow limited to what it can see, then faded out with distance from the token (no sharp edge at the token's range).
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalCompositeOperation = 'source-over'; tctx.clearRect(0, 0, S.W, S.H);
      const g = tctx.createRadialGradient(L.x, L.y, r * 0.3, L.x, L.y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.fillStyle = g;
      tctx.beginPath(); tctx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) tctx.lineTo(lp[i].x, lp[i].y);
      tctx.closePath(); tctx.fill();
      tctx.globalCompositeOperation = 'destination-in';
      const fade = tctx.createRadialGradient(t.x, t.y, radius * 0.5, t.x, t.y, radius);
      fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.fillStyle = fade; tctx.fillRect(0, 0, S.W, S.H);
      for (const c of [sctx, vctx]) {
        c.save();
        c.beginPath(); c.moveTo(tp[0].x, tp[0].y);
        for (let i = 1; i < tp.length; i++) c.lineTo(tp[i].x, tp[i].y);
        c.closePath(); c.clip();
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(lightTmp, 0, 0);
        c.restore();
      }
    }
  }
}


// The top of a small closed object (tent, boulder, crate) shows when its edge is in sight, instead of staying black.
let objectCache = { key: '', loops: [] };
function revealObjectTops(visionRadius, darkPlace = S.light === 'dark') {
  if (!S.polys.length || S.objectTops === false) return;
  // In a dark place a boulder's top is only seen where the token can see: within its darkvision or its carried light (never just because it is inside the vision range).
  const radius = darkPlace ? Math.min(visionRadius, Math.max((S.darkvisionFt / FT_PER_SQUARE) * cell(), (lightReachFt() / FT_PER_SQUARE) * cell())) : visionRadius;
  if (radius <= 0) return;
  const k = S.walls.length + ':' + (S.walls[0] ? S.walls[0].x1 + ',' + S.walls[0].y1 : '') + ':' + cell();
  if (objectCache.key !== k) objectCache = { key: k, loops: WallObjects.loops(S.walls, 9 * cell(), S.rooms) };
  for (const loop of objectCache.loops) {
    const points = WallObjects.samples(loop, Math.max(6, cell() / 3));
    // Each token reveals only the part of the top that is inside its own vision (the same soft edge as the rest of the map).
    S.polys.forEach((poly, i) => {
      const t = S.polyOwners[i];
      if (!points.some((p) => Math.hypot(p.x - t.x, p.y - t.y) <= radius * 0.9 && inside(poly, p.x, p.y))) return;
      for (const c of [sctx, vctx]) {
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath();
        c.moveTo(loop[0].x, loop[0].y);
        for (let k = 1; k < loop.length; k++) c.lineTo(loop[k].x, loop[k].y);
        c.closePath();
        c.clip();
        const grad = c.createRadialGradient(t.x, t.y, radius * 0.45, t.x, t.y, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grad;
        c.fillRect(t.x - radius, t.y - radius, radius * 2, radius * 2);
        c.restore();
      }
    });
  }
}

// Keep a flickering fire animating even when nothing else is happening (redraw about 15 times a second).
setInterval(() => { if (document.visibilityState === 'visible' && S.img && (S.lights.length || S.effects.length || fogMoves())) requestRender(); }, 66);

let revealQueued = false;
function queueReveal() {
  if (revealQueued) return;
  revealQueued = true;
  requestAnimationFrame(() => { revealQueued = false; revealFog(); });
}

// 'in sight', 'explored' or 'unseen' at a world point, read from the two fog layers.
function fogStateAt(x, y) {
  if (!S.W || x < 0 || y < 0 || x >= S.W || y >= S.H) return null;
  const px = Math.floor(x), py = Math.floor(y);
  const v = vctx.getImageData(px, py, 1, 1).data[3];
  const s = sctx.getImageData(px, py, 1, 1).data[3];
  if (v < 70) return 'in sight';
  if (s < 128) return 'explored';
  return 'unseen';
}
