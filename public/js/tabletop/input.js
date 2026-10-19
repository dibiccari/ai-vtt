// The tabletop, part of public/index.html: pointer and touch input.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   POINTER / TOUCH INPUT
   ===================================================================== */
function updateCursor(world) {
  if (interaction.mode === 'drag') { canvas.style.cursor = 'grabbing'; return; }
  if (interaction.mode === 'pan' || interaction.mode === 'pinch') { canvas.style.cursor = 'move'; return; }
  if (state.drawWalls) { canvas.style.cursor = 'crosshair'; return; }
  const t = world && tokenAt(world.x, world.y);
  if (t && (t === activeToken() || state.gmOverride)) canvas.style.cursor = 'grab';
  else if (world && doorAt(world.x, world.y)) canvas.style.cursor = 'pointer';
  else canvas.style.cursor = 'default';
}

function startPinch() {
  const [p1, p2] = [...interaction.pointers.values()];
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  interaction.pinch = {
    dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
    world: screenToWorld(mid.x, mid.y),
    scale: state.view.scale
  };
  interaction.mode = 'pinch';
}

function cancelInteraction() {
  if (interaction.mode === 'drag' && interaction.token) {
    const t = interaction.token;
    animateToken(t, interaction.wx - interaction.offX, interaction.wy - interaction.offY);
  }
  interaction.mode = null;
  interaction.token = null;
  interaction.wallStart = null;
  interaction.wallEnd = null;
  interaction.pinch = null;
  requestRender();
}

canvas.addEventListener('pointerdown', (e) => {
  const pos = eventPos(e);
  interaction.pointers.set(e.pointerId, pos);
  canvas.setPointerCapture(e.pointerId);

  if (interaction.pointers.size === 2) {
    // Second finger: abandon any single-pointer action and pinch-zoom instead.
    if (interaction.mode === 'drag' || interaction.mode === 'wall') cancelInteraction();
    startPinch();
    return;
  }
  if (interaction.pointers.size > 2) return;

  const world = screenToWorld(pos.x, pos.y);
  const isPanButton = e.button === 1 || e.button === 2;

  if (state.drawWalls && e.button === 0) {
    interaction.mode = 'wall';
    interaction.wallStart = snapToCorner(world.x, world.y);
    interaction.wallEnd = { ...interaction.wallStart };
    requestRender();
    return;
  }
  if (state.drawWalls && e.button === 2) return; // handled by contextmenu (undo)

  if (!isPanButton) {
    const t = tokenAt(world.x, world.y);
    if (t) {
      const own = isSummon(t) && activeToken() && t.summon.ownerId === activeToken().id;        // a summoned thing moves on its owner's turn
      if (t !== activeToken() && !own && !state.gmOverride) {
        if (!state.combat.active && t.isPC) { state.activeIndex = state.tokens.indexOf(t); renderTurnBar(); }     // out of combat anyone in the party can move; the one you pick is the one speaking
        else { toast(state.combat.active ? `It's ${activeToken()?.name ?? 'someone else'}'s turn. Tell the DM when you are done.` : 'The DM moves that one.'); return; }
      }
      if (state.gmOverride && t !== activeToken() && !own) {
        state.activeIndex = state.tokens.indexOf(t);
        renderTurnBar();
      }
      interaction.mode = 'drag';
      interaction.token = t;
      interaction.wx = world.x;
      interaction.wy = world.y;
      interaction.offX = world.x - tcx(t);
      interaction.offY = world.y - tcy(t);
      t._anim = null;
      updateCursor(world);
      requestRender();
      return;
    }
    const door = doorAt(world.x, world.y);
    if (door) {
      if (door.locked && !door.open) {                         // locked: the table will not open it; the DM is told someone tried it
        const n = state.walls.filter((w) => w.type === 'door').indexOf(door) + 1, who = activeToken();
        toast('The door is locked');
        state.pendingNotes.push(`${who ? who.name : 'Someone'} tried door ${n}, which is locked. Decide what happens (a key, thieves' tools, forcing it) and unlock it with action door if they get through.`);
        return;
      }
      door.open = !door.open;
      wallsChanged();
      toast(door.open ? 'Door opened' : 'Door closed');
      return;
    }
  }
  interaction.mode = 'pan';
  interaction.panStart = { x: pos.x, y: pos.y, ox: state.view.ox, oy: state.view.oy };
  updateCursor(world);
});

canvas.addEventListener('pointermove', (e) => {
  const pos = eventPos(e);
  if (interaction.pointers.has(e.pointerId)) interaction.pointers.set(e.pointerId, pos);
  const world = screenToWorld(pos.x, pos.y);

  const cell = worldToCell(world.x, world.y);
  const hover = inBounds(cell.col, cell.row) ? cell : null;
  if (hover?.col !== interaction.hoverSquare?.col || hover?.row !== interaction.hoverSquare?.row) {
    interaction.hoverSquare = hover;
    updateHud();
  }

  switch (interaction.mode) {
    case 'drag':
      interaction.wx = world.x;
      interaction.wy = world.y;
      requestRender();
      break;
    case 'wall':
      interaction.wallEnd = snapToCorner(world.x, world.y);
      requestRender();
      break;
    case 'pan': {
      const p = interaction.panStart;
      state.view.ox = p.ox + (pos.x - p.x);
      state.view.oy = p.oy + (pos.y - p.y);
      requestRender();
      break;
    }
    case 'pinch': {
      if (interaction.pointers.size < 2) break;
      const [p1, p2] = [...interaction.pointers.values()];
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const pz = interaction.pinch;
      state.view.scale = clamp(pz.scale * (d / pz.dist), MIN_SCALE, MAX_SCALE);
      state.view.ox = mid.x - pz.world.x * state.view.scale;
      state.view.oy = mid.y - pz.world.y * state.view.scale;
      updateHud();
      requestRender();
      break;
    }
    default:
      updateCursor(world);
  }
});

function finishPointer(e, cancelled) {
  if (!interaction.pointers.has(e.pointerId)) return;
  interaction.pointers.delete(e.pointerId);
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

  if (interaction.mode === 'pinch') {
    if (interaction.pointers.size === 0) interaction.mode = null;
    else if (interaction.pointers.size === 1) {
      const [p] = [...interaction.pointers.values()];
      interaction.mode = 'pan';
      interaction.panStart = { x: p.x, y: p.y, ox: state.view.ox, oy: state.view.oy };
    }
    return;
  }

  if (interaction.mode === 'drag') {
    if (cancelled) { cancelInteraction(); return; }
    const t = interaction.token;
    const target = dragTarget();
    const fromX = interaction.wx - interaction.offX;
    const fromY = interaction.wy - interaction.offY;
    interaction.mode = null;
    interaction.token = null;
    if (target.same) {
      animateToken(t, fromX, fromY);
    } else if (target.legal) {
      const fromCol = t.col, fromRow = t.row;
      t.col = target.col;
      t.row = target.row;
      logTable('move', `${t.name} dragged from (${fromCol}, ${fromRow}) to (${t.col}, ${t.row}), ${Math.round(target.cost)} ft${state.combat.active ? ', combat round ' + state.combat.round : ''}`);
      settleBody(t);
      noteOpportunityAttacks(t, fromCol, fromRow);
      if (!state.gmOverride && state.combat.active) t.movementRemaining = Math.max(0, t.movementRemaining - Math.min(t.movementRemaining, Math.round(target.cost)));
      animateToken(t, fromX, fromY);
      revealFog();
      commitBoard();
    } else {
      animateToken(t, fromX, fromY);
      logTable('move refused', `${t.name} to (${target.col}, ${target.row}): too far or blocked, ${t.movementRemaining} ft left`);
      toast(`Too far — ${t.name} has ${t.movementRemaining} ft left (walls block movement)`, 'error');
    }
    updateCursor(screenToWorld(eventPos(e).x, eventPos(e).y));
    return;
  }

  if (interaction.mode === 'wall') {
    const a = interaction.wallStart, b = interaction.wallEnd;
    interaction.mode = null;
    interaction.wallStart = null;
    interaction.wallEnd = null;
    if (!cancelled && a && b && (a.x !== b.x || a.y !== b.y)) {
      state.walls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, type: state.wallType, open: false, added: true });
      wallsChanged();
    }
    requestRender();
    return;
  }

  interaction.mode = null;
  updateCursor(null);
}

canvas.addEventListener('pointerup', (e) => finishPointer(e, false));
canvas.addEventListener('pointercancel', (e) => finishPointer(e, true));
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const pos = eventPos(e);
  const world = screenToWorld(pos.x, pos.y);
  const t = tokenAt(world.x, world.y);
  if (t) removeTokenAt(t);
});
// Double-click a token to set its conditions and lasting effects.
let condPanel = null;
function closeConditionPanel() {
  if (condPanel) { condPanel.remove(); condPanel = null; }
}
function conditionsChanged() {
  revealFog();
  commitBoard();
}
function openConditionPanel(t, clientX, clientY) {
  closeConditionPanel();
  const panel = document.createElement('div');
  panel.className = 'cond-panel';
  condPanel = panel;
  const numberBox = () => {
    const box = document.createElement('input');
    box.type = 'number';
    box.min = '1';
    box.max = '999';
    box.placeholder = 'rounds';
    box.title = 'How many rounds it lasts. Leave empty until it is removed.';
    return box;
  };
  const render = () => {
    panel.innerHTML = '';
    const head = document.createElement('h4');
    const title = document.createElement('span');
    title.textContent = `Conditions: ${t.name}`;
    const close = document.createElement('button');
    close.className = 'btn btn-sm';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', closeConditionPanel);
    head.append(title, close);
    panel.appendChild(head);
    for (const name of Object.keys(CONDITIONS)) {
      const have = tokenConditions(t).find((c) => c.name === name);
      const row = document.createElement('div');
      row.className = 'cond-row';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(have);
      const dot = document.createElement('span');
      dot.className = 'cond-dot';
      dot.style.background = CONDITIONS[name][1];
      dot.textContent = CONDITIONS[name][0];
      label.append(box, dot, document.createTextNode(' ' + name));
      const rounds = numberBox();
      rounds.value = have && have.rounds > 0 ? String(have.rounds) : '';
      const apply = () => {
        if (box.checked) setCondition(t, name, Number(rounds.value)); else clearCondition(t, name);
        conditionsChanged();
      };
      box.addEventListener('change', () => { apply(); render(); });
      rounds.addEventListener('change', () => { if (box.checked) apply(); });
      row.append(label, rounds);
      panel.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Other effect (a spell, a curse):';
    panel.appendChild(hint);
    for (const c of tokenConditions(t).filter((x) => !CONDITIONS[x.name])) {
      const row = document.createElement('div');
      row.className = 'cond-row';
      const label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = conditionLabel(c);
      const del = document.createElement('button');
      del.className = 'btn btn-sm';
      del.textContent = 'Remove';
      del.addEventListener('click', () => { clearCondition(t, c.name); conditionsChanged(); render(); });
      row.append(label, del);
      panel.appendChild(row);
    }
    const add = document.createElement('div');
    add.className = 'cond-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'e.g. bless';
    name.maxLength = 30;
    const rounds = numberBox();
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm';
    addBtn.textContent = 'Add';
    const submit = () => { if (setCondition(t, name.value, Number(rounds.value))) { conditionsChanged(); render(); } };
    addBtn.addEventListener('click', submit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    add.append(name, rounds, addBtn);
    panel.appendChild(add);
    const lightRow = document.createElement('div');
    lightRow.className = 'cond-row';
    const lightLabel = document.createElement('label');
    lightLabel.textContent = 'Carries a light';
    // Dimmest to brightest by the book: none, candle (5/10 ft), torch (20/40), lantern (30/60). A Light spell is kept until the slider is moved.
    const LIGHT_STEPS = ['', 'candle', 'torch', 'lantern'];
    const lightSel = document.createElement('input');
    lightSel.type = 'range'; lightSel.min = '0'; lightSel.max = String(LIGHT_STEPS.length - 1); lightSel.step = '1';
    const lightText = document.createElement('span');
    const showLight = () => { lightText.textContent = t.lightKind ? ` ${LIGHT_KINDS[t.lightKind][2]} (${LIGHT_KINDS[t.lightKind][0]}/${LIGHT_KINDS[t.lightKind][1]} ft)` : ' none'; };
    lightSel.value = String(Math.max(0, LIGHT_STEPS.indexOf(t.lightKind || '')));
    showLight();
    lightSel.addEventListener('input', () => { t.lightKind = LIGHT_STEPS[Number(lightSel.value)]; showLight(); conditionsChanged(); });
    lightRow.append(lightLabel, lightSel, lightText);
    panel.appendChild(lightRow);
  };
  render();
  document.body.appendChild(panel);
  const w = panel.offsetWidth, h = panel.offsetHeight;
  panel.style.left = clamp(clientX + 12, 8, window.innerWidth - w - 8) + 'px';
  panel.style.top = clamp(clientY - 20, 8, window.innerHeight - h - 8) + 'px';
}
canvas.addEventListener('dblclick', (e) => {
  if (plainMap() || state.drawWalls) return;
  const pos = eventPos(e);
  const world = screenToWorld(pos.x, pos.y);
  const t = tokenAt(world.x, world.y);
  if (t) openConditionPanel(t, e.clientX, e.clientY);
});
document.addEventListener('pointerdown', (e) => { if (condPanel && !condPanel.contains(e.target) && e.target !== canvas) closeConditionPanel(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConditionPanel(); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pos = eventPos(e);
  zoomAt(pos.x, pos.y, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
canvas.addEventListener('pointerleave', () => {
  if (!interaction.mode) { interaction.hoverSquare = null; updateHud(); }
});

window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && interaction.mode) cancelInteraction();
  if (typing) return;
});

