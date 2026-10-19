// The tabletop, part of public/index.html: drawing the table.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   RENDERING
   ===================================================================== */
let renderQueued = false;
let animating = false;

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

// Night, dusk and dawn over a day picture: a dark blue wash over the ground whose light follows the time of day (everywhere the map is not dark by itself, and the zones that follow the time of day;
// a zone with a fixed light keeps it). A picture that is already a night one (the map's own light is dark) is left alone. Map lights glow on top because they are drawn after.
let washCache = { key: '', canvas: null };       // the last wash drawn (kept so a test can look at it)
function drawNightWash() {
  if (!state.map.width) return;
  const c = MapShared.nightWash(state.lightZones || [], state.ambient === 'dark', state.timeOfDay, state.map.width, state.map.height);
  washCache = { key: state.timeOfDay, canvas: c };
  if (c) ctx.drawImage(c, 0, 0);
}
function render(now) {
  renderQueued = false;
  animating = false;
  const v = state.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.ox, dpr * v.oy);

  drawBackground();
  drawNightWash();
  drawGrid();
  drawWallSegments(1);
  drawTokens(false, now);
  drawFog();
  drawMapLabels();
  drawPlacePins();
  if (state.drawWalls || state.gmOverride) drawWallSegments(0.85);
  drawReachable();
  drawTemplates();
  drawTokens(true, now);
  drawDragPreview();
  drawWallPreview();

  if (animating) requestRender();
}

// The places of a town or regional map, over the picture (the players' own switch: the Show places box on the map).
// The places the players know on this map: marked known from the start, or discovered (the DM sends token action discover).
function knownPlacePins() {
  const found = (state.knownPlaces && state.knownPlaces[state.map.url]) || [];
  return (state.placePins || []).filter((p) => PlacePins.knownTo(p, found));
}
// The names written on a regional map (the players' own switch: the Show labels box on the map).
function drawMapLabels() {
  const has = MapLabels.appliesTo(state.mapKind) && (state.mapLabels || []).length > 0;
  const box = document.getElementById('labelsToggle');
  if (box && box.hidden === has) box.hidden = !has;
  if (!has || !MapLabels.enabled()) return;
  MapLabels.draw(ctx, state.mapLabels, 1 / state.view.scale);
}
function drawPlacePins() {
  const shown = PlacePins.appliesTo(state.mapKind) ? knownPlacePins() : [];
  const has = shown.length > 0;
  const box = document.getElementById('placesToggle');
  if (box && box.hidden === has) box.hidden = !has;                           // the box only shows on a town or regional map that has places
  if (!has || !PlacePins.enabled()) return;
  PlacePins.draw(ctx, shown, 1 / state.view.scale);
}

function drawBackground() {
  const { width, height, img, drawW, drawH } = state.map;
  ctx.fillStyle = '#2c313a';
  ctx.fillRect(0, 0, width, height);
  if (img) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, drawW, drawH);
    drawFlickeringLights();
  }
}

// Fires and torches marked "flicker" in the map config are animated over the picture (not when put out).
function flickerLights() {
  const off = lightsOffNow();
  return state.lights.filter((l) => l.flicker && !off.includes(l.id));
}
// Which map lights are out: what the saved game says for this map, or, before anything was saved, the lights the map starts unlit (an unlit brazier).
function lightsOffNow() {
  const url = state.map.url || '';
  if (state.lightsOff[url] === undefined) state.lightsOff[url] = state.lights.filter((l) => l.on === false).map((l) => l.id);
  return state.lightsOff[url];
}
function drawFlickeringLights() {
  const t = performance.now() / 1000;
  if (state.effects.length) Effects.draw(ctx, state.effects, t, GRID);
  for (const L of flickerLights()) Flicker.draw(ctx, L.x, L.y, GRID * Math.min(1, Math.max(0.25, Math.pow(L.dim / GRID / 9, 2))), t);     // a torch burns smaller than a campfire
}
setInterval(() => { if (document.visibilityState === 'visible' && !plainMap() && (flickerLights().length || state.effects.length || (fogOn() && FogStyle.moves(state.ambient === 'dark' && !litRegion())))) requestRender(); }, 66);

function drawGrid() {
  const { width, height } = state.map;
  if (state.gridOpacity <= 0) return;
  ctx.save();
  ctx.lineWidth = 1 / state.view.scale;
  ctx.strokeStyle = `rgba(255, 255, 255, ${state.gridOpacity})`;
  ctx.beginPath();
  for (let x = 0; x <= width; x += GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
  for (let y = 0; y <= height; y += GRID) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();
  ctx.lineWidth = 2 / state.view.scale;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.strokeRect(0, 0, width, height);
  ctx.restore();
}

function drawWallSegments(alpha) {
  if (!state.walls.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (const w of state.walls) {
    const isDoor = w.type === 'door' && !w.secret;           // a secret door is drawn, and works, like the wall it hides in
    if (state.wallsInPicture && !isDoor && !state.drawWalls && !state.gmOverride) continue;
    ctx.setLineDash(isDoor && w.open ? [10, 8] : []);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = isDoor ? (w.open ? 'rgba(213, 140, 63, 0.75)' : '#d58c3f') : '#c7ccd6';
    ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
    if (isDoor && w.locked && !w.open) {                      // a padlock on a locked door
      const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
      ctx.setLineDash([]); ctx.fillStyle = '#1c1f26'; ctx.strokeStyle = '#f0c048'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#f0c048'; ctx.fillRect(mx - 4, my - 1, 8, 6); ctx.beginPath(); ctx.arc(mx, my - 2, 3.2, Math.PI, 0); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  if (state.drawWalls) {
    ctx.fillStyle = '#ff6b6b';
    for (const w of state.walls) {
      ctx.beginPath(); ctx.arc(w.x1, w.y1, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w.x2, w.y2, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawFog() {
  if (!fogOn()) return;
  ctx.save();
  ctx.globalAlpha = state.gmOverride ? 0.5 : 1;
  FogStyle.draw(ctx, shroud, state.ambient === 'dark' && !litRegion(), performance.now(), litRegion());
  ctx.globalAlpha = state.gmOverride ? 0.5 : 1;
  ctx.drawImage(vision, 0, 0);
  ctx.restore();
}

function drawReachable() {
  const t = interaction.mode === 'drag' && interaction.token && isSummon(interaction.token) ? interaction.token : activeToken();
  if (!t || state.drawWalls || state.gmOverride || plainMap() || !state.combat.active) return;       // the range only shows in a fight; outside one there is no budget
  const reach = reachable(t);
  const set = new Set(reach.keys());
  set.add(sqKey(t.col, t.row));
  // the squares the whole body can cover: a big creature standing on any reachable top-left square covers fp x fp squares from it
  const body = new Set();
  for (const k of set) {
    const [c, r] = k.split(',').map(Number);
    for (let dc = 0; dc < fp(t); dc++) for (let dr = 0; dr < fp(t); dr++) body.add(sqKey(c + dc, r + dr));
  }
  ctx.save();
  ctx.fillStyle = 'rgba(240, 192, 72, 0.10)';
  for (const k of body) {
    const [c, r] = k.split(',').map(Number);
    ctx.fillRect(c * GRID, r * GRID, GRID, GRID);
  }
  ctx.strokeStyle = 'rgba(240, 192, 72, 0.85)';
  ctx.lineWidth = 2 / state.view.scale;
  ctx.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
  ctx.beginPath();
  if (state.moveRule === 'circle') {
    // Round rule: the true circle at the movement radius.
    ctx.arc(tcx(t), tcy(t), (t.movementRemaining / FT_PER_SQUARE) * GRID, 0, Math.PI * 2);
  } else {
    // Boundary outline: edges whose neighbour is outside the reachable set.
    for (const k of body) {
      const [c, r] = k.split(',').map(Number);
      const x = c * GRID, y = r * GRID;
      if (!body.has(sqKey(c, r - 1))) { ctx.moveTo(x, y); ctx.lineTo(x + GRID, y); }
      if (!body.has(sqKey(c, r + 1))) { ctx.moveTo(x, y + GRID); ctx.lineTo(x + GRID, y + GRID); }
      if (!body.has(sqKey(c - 1, r))) { ctx.moveTo(x, y); ctx.lineTo(x, y + GRID); }
      if (!body.has(sqKey(c + 1, r))) { ctx.moveTo(x + GRID, y); ctx.lineTo(x + GRID, y + GRID); }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function tokenDisplayPos(t, now) {
  if (interaction.mode === 'drag' && interaction.token === t) {
    return { x: interaction.wx - interaction.offX, y: interaction.wy - interaction.offY };
  }
  const tx = tcx(t), ty = tcy(t);
  if (t._anim) {
    const p = Math.min(1, (now - t._anim.start) / 180);
    if (p >= 1) { t._anim = null; return { x: tx, y: ty }; }
    animating = true;
    const e = 1 - Math.pow(1 - p, 3);
    return { x: t._anim.x + (tx - t._anim.x) * e, y: t._anim.y + (ty - t._anim.y) * e };
  }
  return { x: tx, y: ty };
}

function drawTokens(pcs, now) {
  if (plainMap()) return;          // regional and town maps are just maps: no tokens on them
  const active = activeToken();
  const ordered = state.tokens.filter((t) => (pcs ? (t.isPC || (state.dmView && !seenByParty(t))) : (!t.isPC && seenByParty(t))));
  // Draw the dragged token last so it floats above the others.
  ordered.sort((a, b) => (a === interaction.token) - (b === interaction.token));
  for (const t of ordered) {
    const { x, y } = tokenDisplayPos(t, now);
    const isActive = t === active;
    const radius = GRID * (TokenSize.normalize(t.size) === 'tiny' ? 0.2 : 0.4 + 0.5 * (fp(t) - 1));        // a footprint of n squares is drawn n squares across; Tiny at half a square
    const dragging = interaction.mode === 'drag' && interaction.token === t;
    const ghost = !t.isPC && !seenByParty(t);
    const glyph = t.kind === 'trap' ? '⚠' : isSummon(t) ? (SUMMONS[t.summon.kind] || {}).glyph || '✦' : initials(t.name);
    ctx.save();
    if (ghost || t.dead) ctx.globalAlpha = t.dead ? 0.4 : 0.45;
    else if (window.ConditionRings) ctx.globalAlpha = ConditionRings.tokenAlpha(tokenConditions(t).map((c) => c.name));
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = dragging ? 18 : 8;
    ctx.shadowOffsetY = dragging ? 6 : 2;
    if (isActive) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240, 192, 72, 0.35)';
      ctx.fill();
    }
    const art = artFor(t.image);
    const r = radius * (dragging ? 1.08 : 1);
    if (art) {
      // The supplied token PNGs are already round with their own frame; draw them whole.
      const size = (r + 4) * 2;
      ctx.drawImage(art, x - size / 2, y - size / 2, size, size);
      ctx.shadowColor = 'transparent';
      if (isActive || !t.isPC) {
        ctx.beginPath();
        ctx.arc(x, y, size / 2 - 1, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = isActive ? '#f0c048' : '#ff6b6b';
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.color || '#888';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 3;
      ctx.strokeStyle = isActive ? '#f0c048' : (t.isPC ? '#ffffff' : '#ff6b6b');
      if (!t.isPC) ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.round(GRID * 0.3)}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.strokeText(glyph, x, y + 1);
      ctx.fillText(glyph, x, y + 1);
    }

    // Conditions are rings round the token (the 15 official ones, each with its colour and line style; the name is written along the ring when the token is big enough on screen), effects are pills
    // beside it (concentrating, spells such as bless). The hit-point bar and the name tag move out by the width of the rings.
    if (!ghost && !t.dead) ctx.globalAlpha = 1;                      // an invisible token is faint, its rings and bars are not
    const condNames = tokenConditions(t).map((c) => c.name);
    let ringReach = 0;
    if (condNames.length && window.ConditionRings) {
      const named = state.view.scale * radius >= 24;
      ringReach = ConditionRings.draw(ctx, x, y, radius + 4, condNames, 0.75, { labels: named });
      ConditionRings.drawEffects(ctx, x, y, radius + 4 + ringReach, condNames, 0.62, { labels: state.view.scale * radius >= 18 });
    }
    const hpMax = maxHpOf(t), hpNow = hpOf(t);
    if (hpMax > 0) {
      const bw = GRID * 0.8 * Math.max(1, fp(t)), bh = 5, bx = x - bw / 2, by = y + radius + 4 + ringReach;
      const pct = clamp(hpNow / hpMax, 0, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = pct > 0.5 ? '#3fd27f' : pct > 0.25 ? '#f0c048' : '#ff6b6b';
      ctx.fillRect(bx, by, bw * pct, bh);
    }
    if ((Number(t.elevation) || 0) > 0) {
      const label = `↑${t.elevation}`;
      ctx.font = `800 ${Math.round(GRID * 0.22)}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ew = ctx.measureText(label).width + 8, ex = x + radius - ew / 2, ey = y - radius + 8;
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'rgba(7, 9, 13, 0.9)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(ex - ew / 2, ey - 8, ew, 16, 8); ctx.fill(); } else ctx.fillRect(ex - ew / 2, ey - 8, ew, 16);
      ctx.fillStyle = '#9ad7ff';
      ctx.fillText(label, ex, ey + 1);
    }
    if (t.dead) {
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.7, y - radius * 0.7); ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
      ctx.moveTo(x + radius * 0.7, y - radius * 0.7); ctx.lineTo(x - radius * 0.7, y + radius * 0.7);
      ctx.stroke();
    }
    if (state.view.scale > 0.45 || isActive) {
      ctx.font = `700 ${Math.round(GRID * 0.22)}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = ghost ? `${t.name} (${t.hidden ? (t.kind === 'trap' ? 'hidden trap' : 'hidden') : 'out of sight'})` : t.name;
      const tw = ctx.measureText(label).width + 10;
      const ly = y - radius - 11 - ringReach;
      ctx.fillStyle = 'rgba(7, 9, 13, 0.85)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - tw / 2, ly - 8, tw, 16, 8); else ctx.rect(x - tw / 2, ly - 8, tw, 16);
      ctx.fill();
      ctx.fillStyle = isActive ? '#f0c048' : '#edf1f7';
      ctx.fillText(label, x, ly + 1);
    }
    ctx.restore();
  }
}

function dragTarget() {
  const t = interaction.token;
  const x = interaction.wx - interaction.offX;
  const y = interaction.wy - interaction.offY;
  const n = fp(t);
  // (x, y) is where the token's centre is: the top-left square of its footprint is half its width up and left of it
  const cell = { col: clamp(Math.round(x / GRID - n / 2), 0, cols() - n), row: clamp(Math.round(y / GRID - n / 2), 0, rows() - n) };
  const same = cell.col === t.col && cell.row === t.row;
  const cost = reachable(t).get(sqKey(cell.col, cell.row));
  return { ...cell, same, cost, legal: same || cost !== undefined };
}

function drawDragPreview() {
  if (interaction.mode !== 'drag' || !interaction.token) return;
  const t = interaction.token;
  const target = dragTarget();
  const s = state.view.scale;
  ctx.save();
  ctx.fillStyle = target.legal ? 'rgba(63, 210, 127, 0.28)' : 'rgba(255, 107, 107, 0.30)';
  ctx.strokeStyle = target.legal ? '#3fd27f' : '#ff6b6b';
  ctx.lineWidth = 2 / s;
  const nn = fp(t);
  ctx.fillRect(target.col * GRID, target.row * GRID, GRID * nn, GRID * nn);
  ctx.strokeRect(target.col * GRID, target.row * GRID, GRID * nn, GRID * nn);
  ctx.setLineDash([6 / s, 5 / s]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.moveTo(tcx(t), tcy(t));
  ctx.lineTo((target.col + nn / 2) * GRID, (target.row + nn / 2) * GRID);
  ctx.stroke();
  ctx.setLineDash([]);
  const label = target.same ? '0 ft'
    : target.legal ? (state.gmOverride ? 'GM move' : (state.combat.active ? `${Math.round(target.cost)} ft` : 'move'))
    : 'Out of range';
  ctx.font = `700 ${14 / s}px Inter, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lx = (target.col + nn / 2) * GRID, ly = target.row * GRID - 14 / s;
  const tw = ctx.measureText(label).width + 14 / s;
  ctx.fillStyle = 'rgba(7, 9, 13, 0.9)';
  ctx.fillRect(lx - tw / 2, ly - 11 / s, tw, 22 / s);
  ctx.fillStyle = target.legal ? '#3fd27f' : '#ff6b6b';
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

function drawWallPreview() {
  if (interaction.mode !== 'wall' || !interaction.wallStart || !interaction.wallEnd) return;
  const a = interaction.wallStart, b = interaction.wallEnd;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = state.wallType === 'door' ? 'rgba(213, 140, 63, 0.9)' : 'rgba(255, 107, 107, 0.9)';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
  const lenFt = Math.round((Math.hypot(b.x - a.x, b.y - a.y) / GRID) * FT_PER_SQUARE);
  ctx.font = `700 ${13 / state.view.scale}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${lenFt} ft`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10 / state.view.scale);
  ctx.restore();
}

