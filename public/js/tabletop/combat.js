// The tabletop, part of public/index.html: the combat tracker.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   COMBAT TRACKER: initiative, rounds, hit points, death saves, action economy
   ===================================================================== */
const hpOf = (t) => { const c = characterFor(t); return c ? c.hp : (Number.isFinite(t.hp) ? t.hp : null); };
const maxHpOf = (t) => { const c = characterFor(t); return c ? (c.effMaxHp ?? c.maxHp) : (Number.isFinite(t.maxHp) && t.maxHp > 0 ? t.maxHp : null); };
const acOf = (t) => { const c = characterFor(t); return c ? c.ac : (Number.isFinite(t.ac) && t.ac > 0 ? t.ac : null); };
const dexModOf = (t) => { const c = characterFor(t); return c ? Math.floor(((c.abilities && c.abilities.dex) || 10) / 2) - 5 : (Number.isFinite(t.dexMod) ? t.dexMod : 0); };
const combatTokens = () => state.combat.order.map((id) => state.tokens.find((t) => t.id === id)).filter((t) => t && !isElsewhere(t));
// A d20 from the browser's secure random source (rejection sampling keeps every face equally likely).
const d20 = () => { const buf = new Uint32Array(1); do { crypto.getRandomValues(buf); } while (buf[0] >= 4294967280); return 1 + (buf[0] % 20); };
// Initiative rolled by the table itself, shown in the chat like every other roll (creatures the party cannot see keep their roll to themselves).
function rollInitiative(t, quiet) {
  const die = d20(), mod = dexModOf(t);
  t.initiative = die + mod;
  const line = `${t.name} d20 (${die}) ${mod < 0 ? '−' : '+'} ${Math.abs(mod)} = ${t.initiative}`;
  if (!quiet && (t.isPC || seenByParty(t))) addChat('system', `🎲 ${t.name} initiative: ${line.slice(t.name.length + 1)}`);
  return t.isPC || seenByParty(t) ? line : '';
}

// Hit points go up or down here. A creature at 0 is defeated; a player character at 0 falls unconscious and starts making death saves.
// ---- Combat extras: opportunity attacks, concentration, spell areas ----
// Table notes for the DM: things the table noticed that the DM should resolve (told with the next message).
// Reach is measured edge to edge between footprints (5 ft reach = touching), and a target in the air above that reach cannot be hit in melee.
const adjacentSq = (c1, r1, c2, r2) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)) <= 1;
const inMeleeReach = (o, mover, col, row) => TokenSize.meleeReaches(5, TokenSize.gap({ col: o.col, row: o.row, n: fp(o) }, { col, row, n: fp(mover) }), (Number(o.elevation) || 0) - (Number(mover.elevation) || 0));
const NO_REACTION = ['incapacitated', 'paralyzed', 'stunned', 'unconscious', 'petrified', 'surprised', 'slow'];
const canReact = (t) => !t.dead && hpOf(t) !== 0 && !(t.spent && t.spent.r) && !NO_REACTION.some((n) => hasCondition(t, n));

// Creatures that could make an opportunity attack because `mover` left their reach (5 ft) without Disengaging. Foes only, and only ones that can react.
function provokedBy(mover, fromCol, fromRow, toCol, toRow) {
  if (!state.combat.active || hasCondition(mover, 'disengaged') || isElsewhere(mover)) return [];
  return state.tokens.filter((o) => o !== mover && o.kind !== 'trap' && !isSummon(o) && o.isPC !== mover.isPC && !isElsewhere(o)
    && (o.isPC || seenByParty(o)) && canReact(o) && inMeleeReach(o, mover, fromCol, fromRow) && !inMeleeReach(o, mover, toCol, toRow));
}
// Foes that were next to the mover's old square and are not next to the new one but cannot make the attack, with the reason (the DM is told the facts).
function cannotReactTo(mover, fromCol, fromRow, toCol, toRow) {
  if (!state.combat.active || hasCondition(mover, 'disengaged') || isElsewhere(mover)) return [];
  return state.tokens.filter((o) => o !== mover && o.kind !== 'trap' && !isSummon(o) && o.isPC !== mover.isPC && !isElsewhere(o)
    && (o.isPC || seenByParty(o)) && !canReact(o) && inMeleeReach(o, mover, fromCol, fromRow) && !inMeleeReach(o, mover, toCol, toRow))
    .map((o) => ({ name: o.name, why: o.dead || hpOf(o) === 0 ? 'down' : o.spent && o.spent.r ? 'has already used its reaction this round' : (NO_REACTION.find((n) => hasCondition(o, n)) || 'cannot react') }));
}
function noteOpportunityAttacks(mover, fromCol, fromRow) {
  const hit = provokedBy(mover, fromCol, fromRow, mover.col, mover.row);
  const blocked = cannotReactTo(mover, fromCol, fromRow, mover.col, mover.row);
  if (blocked.length) state.pendingNotes.push(`${mover.name} left the reach of ${blocked.map((b) => b.name + ' (' + b.why + ')').join(', ')}: no opportunity attack from them.`);
  if (!hit.length) return;
  const names = hit.map((o) => o.name).join(', ');
  if (mover.isPC) {
    addChat('system', `⚔ ${mover.name} left the reach of ${names} without Disengaging: ${hit.length > 1 ? 'they' : 'it'} can make an opportunity attack (a reaction).`);
    state.pendingNotes.push(`${mover.name} moved out of the reach of ${names} without Disengaging: they may each make an opportunity attack: it uses that creature's reaction (they all still have it right now), one melee attack with a weapon or an unarmed strike. Resolve each, then send token action react with that creature's tokenId. Not for forced or teleporting movement.`);
  } else {
    addChat('system', `⚔ ${hit.map((o) => o.name).join(', ')} can make an opportunity attack against ${mover.name} for leaving ${hit.length > 1 ? 'their' : 'its'} reach (a reaction).`);
  }
}

// A concentrating creature that takes damage: Constitution save, DC 10 or half the damage, or the spell ends. Dropping to 0 ends it outright.
function concentrationCheck(t, damage, after) {
  if (!(damage > 0) || !hasCondition(t, 'concentrating')) return;
  if (after === 0) { clearCondition(t, 'concentrating'); if (seenByParty(t)) addChat('system', `↳ ${t.name} is down: concentration ends`); return; }
  const dc = Math.max(10, Math.floor(damage / 2));
  const c = characterFor(t);
  if (!c) { state.pendingNotes.push(`${t.name} took ${damage} damage while concentrating: a Constitution saving throw, DC ${dc}, or the spell ends.`); return; }
  if (store.get('vtt.diceMode', 'ai') === 'player') {
    addChat('system', `🧠 ${t.name} took ${damage} damage while concentrating: roll a Constitution saving throw, DC ${dc}, and tell the DM.`);
    state.pendingNotes.push(`${t.name} took ${damage} damage while concentrating and must roll a Constitution saving throw, DC ${dc}: wait for the player's roll.`);
    return;
  }
  const conMod = Math.floor(((c.abilities && c.abilities.con) || 10) / 2) - 5;
  const parsed = parseInt(String((c.sheet && c.sheet['ST Constitution']) || ''), 10);
  const mod = Number.isFinite(parsed) ? parsed : conMod;
  const die = d20(), total = die + mod;
  const ok = total >= dc;
  addChat('system', `🎲 ${t.name} Constitution save to keep concentrating: d20 (${die}) ${mod < 0 ? '−' : '+'} ${Math.abs(mod)} = ${total} vs DC ${dc}, ${ok ? 'holds' : 'fails'}`);
  if (!ok) { clearCondition(t, 'concentrating'); addChat('system', `↳ ${t.name} loses concentration`); state.pendingNotes.push(`${t.name} failed the concentration save: the spell they were concentrating on has ended.`); }
}

// Spell areas the DM draws: sphere (radius), cube (side), cone (length, from a creature toward a point), line (length, 5 ft wide, from a creature).
const CONE_COS = Math.cos(Math.atan(0.5));
function templateShape(raw) {
  const s = String(raw || '').toLowerCase();
  if (/sphere|radius|circle|burst/.test(s)) return 'sphere';
  if (/cube|square|box/.test(s)) return 'cube';
  if (/cone/.test(s)) return 'cone';
  if (/line|beam|bolt/.test(s)) return 'line';
  return '';
}
function insideTemplate(tp, x, y) {
  const ftPx = GRID / FT_PER_SQUARE;
  if (tp.shape === 'sphere') return Math.hypot(x - tp.x, y - tp.y) <= tp.size * ftPx + 1;
  if (tp.shape === 'cube') { const h = (tp.size / 2) * ftPx + 1; return Math.abs(x - tp.x) <= h && Math.abs(y - tp.y) <= h; }
  const vx = x - tp.x, vy = y - tp.y, dist = Math.hypot(vx, vy);
  if (dist < 1) return false;
  if (tp.shape === 'cone') return dist <= tp.size * ftPx + 1 && (vx * tp.dx + vy * tp.dy) / dist >= CONE_COS - 0.001;
  const along = vx * tp.dx + vy * tp.dy, across = Math.abs(vx * tp.dy - vy * tp.dx);
  return along >= 0 && along <= tp.size * ftPx + 1 && across <= 3 * ftPx;                // a line is 5 ft wide; a little slack for square centres
}
// A creature is inside an area when its footprint overlaps it: any square of the footprint counts (the centre of its centre for a tiny or medium one).
const insideTemplateFp = (tp, t) => TokenSize.cells(t.col, t.row, fp(t)).some(([c, r]) => insideTemplate(tp, centerOf(c), centerOf(r)));
function addTemplate(u) {
  const shape = templateShape(u.shape);
  if (String(u.shape || '').toLowerCase().trim() === 'clear') { state.templates = []; requestRender(); return; }
  const size = Math.round(Number(u.size));
  if (!shape || !(size > 0) || !Number.isInteger(u.col) || !Number.isInteger(u.row)) return;
  const caster = state.tokens.find((x) => x.id === u.tokenId) || null;
  const px = centerOf(clamp(u.col, 0, cols() - 1)), py = centerOf(clamp(u.row, 0, rows() - 1));
  let tp;
  if (shape === 'sphere' || shape === 'cube') tp = { shape, size, x: px, y: py };
  else {
    const ox = caster ? tcx(caster) : px, oy = caster ? tcy(caster) : py;
    const len = Math.hypot(px - ox, py - oy) || 1;
    tp = { shape, size, x: ox, y: oy, dx: (px - ox) / len, dy: (py - oy) / len };
  }
  tp.label = `${shape === 'sphere' ? 'Sphere' : shape === 'cube' ? 'Cube' : shape === 'cone' ? 'Cone' : 'Line'} ${size} ft`;
  tp.at = Date.now();
  state.templates.push(tp);
  const inside = state.tokens.filter((x) => x !== caster && x.kind !== 'trap' && !isSummon(x) && !isElsewhere(x) && insideTemplateFp(tp, x));
  const seen = inside.filter(seenByParty);
  addChat('system', `✨ ${tp.label}: ${seen.length ? 'catches ' + seen.map((x) => x.name).join(', ') : 'catches no one you can see'}`);
  state.pendingNotes.push(`The ${tp.label} area covers: ${inside.length ? inside.map((x) => x.name + (seenByParty(x) ? '' : ' (hidden from the players)')).join(', ') : 'no one'}. Use this list for saving throws and damage.`);
  requestRender();
}
function drawTemplates() {
  if (!state.templates.length) return;
  const now = Date.now();
  state.templates = state.templates.filter((tp) => state.combat.active || now - tp.at < 25000);       // outside a fight an area fades after a while
  if (!state.templates.length) return;
  const ftPx = GRID / FT_PER_SQUARE;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 120, 40, 0.28)';
  ctx.strokeStyle = 'rgba(255, 170, 70, 0.95)';
  ctx.lineWidth = 2 / state.view.scale;
  for (const tp of state.templates) {
    ctx.beginPath();
    let lx = tp.x, ly = tp.y;
    if (tp.shape === 'sphere') ctx.arc(tp.x, tp.y, tp.size * ftPx, 0, Math.PI * 2);
    else if (tp.shape === 'cube') { const h = (tp.size / 2) * ftPx; ctx.rect(tp.x - h, tp.y - h, h * 2, h * 2); }
    else if (tp.shape === 'cone') {
      const L = tp.size * ftPx, nx = -tp.dy, ny = tp.dx, fx = tp.x + tp.dx * L, fy = tp.y + tp.dy * L;
      ctx.moveTo(tp.x, tp.y); ctx.lineTo(fx + nx * L / 2, fy + ny * L / 2); ctx.lineTo(fx - nx * L / 2, fy - ny * L / 2); ctx.closePath();
      lx = tp.x + tp.dx * L * 0.6; ly = tp.y + tp.dy * L * 0.6;
    } else {
      const L = tp.size * ftPx, w = 2.5 * ftPx, nx = -tp.dy, ny = tp.dx;
      ctx.moveTo(tp.x + nx * w, tp.y + ny * w); ctx.lineTo(tp.x + tp.dx * L + nx * w, tp.y + tp.dy * L + ny * w);
      ctx.lineTo(tp.x + tp.dx * L - nx * w, tp.y + tp.dy * L - ny * w); ctx.lineTo(tp.x - nx * w, tp.y - ny * w); ctx.closePath();
      lx = tp.x + tp.dx * L * 0.5; ly = tp.y + tp.dy * L * 0.5;
    }
    ctx.fill(); ctx.stroke();
    ctx.font = `${12 / state.view.scale}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(tp.label, lx, ly);
    ctx.fillStyle = 'rgba(255, 120, 40, 0.28)';
  }
  ctx.restore();
  requestRender();
}

function changeHp(t, delta) {
  const max = maxHpOf(t);
  if (max === null || !Number.isFinite(delta)) return null;
  const before = hpOf(t);
  const after = clamp(before + Math.round(delta), 0, max);
  const c = characterFor(t);
  if (c) {
    c.hp = after;
    jsonPost('/api/characters', c).catch((err) => toast(`Could not save ${c.name}'s HP: ${err.message}`, 'error'));
  } else t.hp = after;
  if (delta < 0 && before > 0) { t.hurtSince = true; concentrationCheck(t, Math.abs(Math.round(delta)), after); }
  if (before === 0 && delta < 0 && t.isPC && !t.dead && hpOf(t) === 0) {
    // Damage to a character already at 0 is a failed death save (a stable one starts dying again).
    t.stable = false; clearCondition(t, 'stable'); if (!t.deathSaves) t.deathSaves = { success: 0, fail: 0 };
    addChat('system', `↳ ${t.name} is hurt while down: a failed death save`);
    setDeathSave(t, 'fail', t.deathSaves.fail + 1);
  }
  if (after === 0 && before > 0) {
    endEffectsWithTrigger(t, 'idle-round', 'it dropped to 0 hit points');
    endEffectsWithTrigger(t, 'target-down', 'it dropped to 0 hit points', 'Whoever cast it may move it to another creature as a bonus action if the spell allows it (ask or narrate it).');
    if (t.isPC) {
      setCondition(t, 'unconscious', 0); t.deathSaves = { success: 0, fail: 0 }; t.stable = false; addChat('system', `↳ ${t.name} falls unconscious and is dying`);
      if (-Math.round(delta) - before >= max) { addChat('system', `↳ Massive damage: ${t.name} is killed outright`); setDeathSave(t, 'fail', 3); }      // 5e: damage left over after 0 that equals the hit point maximum
    }
    else { t.dead = true; if (seenByParty(t)) addChat('system', `↳ ${t.name} is defeated`); }
  } else if (after > 0 && before === 0) {
    if (t.isPC) { clearCondition(t, 'unconscious'); t.deathSaves = null; t.stable = false; }
    else t.dead = false;
  }
  if (after === 0) checkFall(t);
  return { before, after };
}

function sortCombat() {
  const cur = activeToken();
  const list = combatTokens();
  list.sort((a, b) => (Number.isFinite(b.initiative) ? b.initiative : -99) - (Number.isFinite(a.initiative) ? a.initiative : -99) || dexModOf(b) - dexModOf(a) || a.name.localeCompare(b.name));
  let ids = list.map((t) => t.id);
  for (const t of list) if (t.actsAfter) ids = CombatOrder.placeAfter(ids, t.id, t.actsAfter);      // a resumed delayer acts right after the combatant it named, even on a tied number
  state.combat.order = ids;
  if (cur) state.activeIndex = Math.max(0, state.tokens.indexOf(cur));
}

function beginTurn(t) {
  t.movementRemaining = effectiveSpeed(t);
  for (const s of summonsOf(t)) s.movementRemaining = s.speed;
  t.spent = { a: false, b: false, r: false };
  t.actsAfter = '';
  t.readied = '';                                              // a readied action that never triggered is lost when the next turn starts
  state.templates = [];
  const lazy = tokenConditions(t).find((c) => c.name === 'lethargic');
  if (lazy) { lazy.armed = true; t.spent = { a: true, b: true, r: false }; }                     // the turn after haste ended: no move, no actions (a reaction is not an action)
  if (hasCondition(t, 'surprised')) { t.spent = { a: true, b: true, r: true }; if (seenByParty(t)) addChat('system', `↳ ${t.name} is surprised and loses this turn`); }
  if (seenByParty(t)) toast(`${t.name}'s turn${t.isPC && hpOf(t) === 0 && !t.stable ? ': death saving throw' : ''}`, 'ok');
}

// Death save pips: from the combat panel or from the DM (condition "death save success" / "death save fail", rounds = how many).
function setDeathSave(t, key, v) {
  if (!t.deathSaves) t.deathSaves = { success: 0, fail: 0 };
  t.deathSaves[key] = clamp(v, 0, 3);
  if (t.deathSaves.success >= 3 && !t.stable) { t.stable = true; addChat('system', `↳ ${t.name} is stable`); }
  if (t.deathSaves.fail >= 3 && !t.stable && !t.dead) {
    if (state.permadeath) { t.dead = true; addChat('system', `↳ ${t.name} has died`); }
    else { t.stable = true; addChat('system', `↳ ${t.name} is out of the fight (no permanent death at this table: the DM will play out a setback)`); }
  }
}

function startCombat() {
  if (state.combat.active) return;
  const members = state.tokens.filter((t) => t.kind !== 'trap' && !t.dead && !isSummon(t) && !isElsewhere(t));
  if (!members.length) { toast('Put some tokens on the map first'); return; }
  state.combat = { active: true, round: 1, order: members.map((t) => t.id), fresh: true };      // fresh: nobody has had a turn yet, so the DM's own initiative numbers may still reorder who is first
  const rolled = [];
  for (const t of members) {
    // Creatures are always rolled here. The players are too when the DM rolls for them; at a table where they roll their own, they give theirs.
    if (t.isPC && store.get('vtt.diceMode', 'ai') === 'player') t.initiative = null; else { const line = rollInitiative(t, true); if (line) rolled.push(line); }
    t.spent = { a: false, b: false, r: false };
  }
  if (rolled.length) addChat('system', '🎲 Initiative: ' + rolled.join(' · '));
  sortCombat();
  const first = combatTokens()[0];
  if (first) { state.activeIndex = state.tokens.indexOf(first); logTable('turn', `${first.name} is up first (round 1)`); }
  addChat('system', members.some((t) => t.isPC && !Number.isFinite(t.initiative)) ? '⚔ Combat begins. Players: tell the DM your initiative, or say "roll for me".' : '⚔ Combat begins');
  syncAmbience();
  commitBoard();
  renderCombat();
}

function joinCombat(t) {
  if (!state.combat.active || t.kind === 'trap' || isSummon(t) || state.combat.order.includes(t.id)) return;
  state.combat.order.push(t.id);
  if (t.isPC) t.initiative = null; else rollInitiative(t);
  t.spent = { a: false, b: false, r: false };
  sortCombat();
}

function nextCombatTurn() {
  const order = combatTokens();
  if (!order.length) return;
  const waiting = order.filter((t) => t.isPC && !Number.isFinite(t.initiative)).map((t) => t.name);
  if (waiting.length) { toast(`Waiting for initiative: ${waiting.join(', ')}`); return; }
  state.combat.fresh = false;
  const leaving = activeToken();
  if (leaving && hasCondition(leaving, 'surprised')) clearCondition(leaving, 'surprised');       // surprise ends when its first turn ends
  if (leaving && hasCondition(leaving, 'dashing')) clearCondition(leaving, 'dashing');
  if (leaving && tokenConditions(leaving).some((c) => c.name === 'lethargic' && c.armed)) clearCondition(leaving, 'lethargic');       // lethargy lasts until after its next turn         // a Dash lasts for the turn it was taken
  endOfTurnTriggers(leaving);
  // Defeated creatures are skipped; creatures the party cannot see are skipped too (the AI plays their turns in the narration); so are delayed ones.
  const pick = CombatOrder.nextActor(order.map((t) => ({ id: t.id, dead: t.dead, unseen: !seenByParty(t), delayed: t.delayed })), leaving ? leaving.id : '');
  const chosen = pick ? order.find((t) => t.id === pick.id) : null;
  const wrapped = Boolean(pick && pick.wrapped);
  if (!chosen) return;
  if (wrapped) {
    state.combat.round += 1;
    for (const t of order) if (t.delayed && t !== chosen) { t.delayed = false; if (seenByParty(t)) addChat('system', `↳ ${t.name} waited out the round and acts in their usual place`); }
    addChat('system', `⏱ Round ${state.combat.round}`);
    if (tickConditions()) revealFog();
    advanceGameClock(0, 6);
  }
  chosen.delayed = false;
  state.activeIndex = state.tokens.indexOf(chosen);
  logTable('turn', `${chosen.name} is up (round ${state.combat.round})${leaving && leaving !== chosen ? ', after ' + leaving.name : ''}`);       // the play log says every time the turn passes
  beginTurn(chosen);
  // A surprised combatant's turn is lost whoever it is, so the table moves on at once (nobody has to say "I end my turn").
  if (hasCondition(chosen, 'surprised') && (nextCombatTurn.depth || 0) < 20) {
    nextCombatTurn.depth = (nextCombatTurn.depth || 0) + 1;
    try { nextCombatTurn(); } finally { nextCombatTurn.depth = 0; }
    return;
  }
  commitBoard();
  renderCombat();
}

// Delay (2014 DMG optional rule): the active combatant gives up their place and acts later, after any other combatant's turn.
// While delayed they are skipped; resuming puts them right after whoever is acting now (their initiative becomes that point).
function delayTurn(t) {
  if (!state.combat.active || !t || t.delayed || activeToken() !== t) return false;
  t.delayed = true;
  if (seenByParty(t)) addChat('system', `⏸ ${t.name} delays their turn`);
  nextCombatTurn();
  return true;
}
function resumeTurn(t) {
  if (!state.combat.active || !t || !t.delayed) return false;
  const cur = activeToken();
  const items = combatTokens().map((x) => ({ id: x.id, initiative: x.initiative, delayed: x.delayed }));
  const value = cur && cur !== t ? CombatOrder.resumeInitiative(items, cur.id, t.id) : null;
  t.delayed = false;
  t.actsAfter = cur && cur !== t ? cur.id : '';
  if (value !== null) t.initiative = value;
  sortCombat();
  if (seenByParty(t)) addChat('system', `▶ ${t.name} stops delaying and will act after ${cur && cur !== t ? cur.name + "'s turn" : 'now'}`);
  if (!cur || cur === t) { state.activeIndex = state.tokens.indexOf(t); beginTurn(t); }
  commitBoard();
  return true;
}

// Experience for the creatures defeated: the table adds up their XP (the SRD value, or the module's) and shares it among the party when the fight ends, so it does not depend on the DM remembering.
// Each fallen creature is counted once. The DM is told so that it does not award the same XP again.
async function awardDefeatedXp() {
  const fallen = state.tokens.filter((t) => !t.isPC && !t.summon && t.kind !== 'trap' && Number(t.xp) > 0 && (t.dead || t.hp <= 0) && !t.xpAwarded);
  if (!fallen.length || window.WATCH === true) return;
  const total = fallen.reduce((n, t) => n + Number(t.xp), 0);
  for (const t of fallen) t.xpAwarded = true;
  try {
    const out = await jsonPost('/api/party/xp', { target: 'party', amount: total, split: true });
    const names = fallen.map((t) => t.name).join(', ');
    addChat('system', `⭐ ${total} XP shared by the party for ${names}`);
    for (const n of out.notes || []) addChat('system', '↳ ' + n);
    state.pendingNotes.push(`The table awarded ${total} XP (shared equally by the party) for the defeated: ${names}. Do not award XP for these again.${(out.notes || []).some((n) => /level/i.test(n)) ? ' ' + (out.notes || []).filter((n) => /level/i.test(n)).join(' ') : ''}`);
    await loadCharacters();
  } catch (err) {
    for (const t of fallen) t.xpAwarded = false;
    toast(`Could not award XP: ${err.message}`, 'error');
  }
}

function endCombat() {
  if (!state.combat.active) return;
  awardDefeatedXp();
  state.combat = { active: false, round: 0, order: [] };
  for (const t of state.tokens) { t.initiative = null; t.spent = null; t.delayed = false; }
  addChat('system', '⚔ Combat ends');
  syncAmbience();
  commitBoard();
  renderCombat();
}

// Creatures of the SRD, added from the tracker (names for the box come from the compendium).
let monsterNames = null;
async function loadMonsterNames() {
  if (monsterNames) return monsterNames;
  try { monsterNames = (await api('/api/compendium/monsters')).entries; } catch { monsterNames = []; }
  const list = $('#monsterList');
  list.innerHTML = '';
  for (const m of monsterNames) { const o = document.createElement('option'); o.value = m.name; list.appendChild(o); }
  return monsterNames;
}

async function addMonsters(name, count, hidden) {
  const names = await loadMonsterNames();
  const found = names.find((m) => m.name.toLowerCase() === String(name).trim().toLowerCase());
  if (!found) { toast(`"${name}" is not in the SRD bestiary`, 'error'); return; }
  const { entry } = await api('/api/compendium/monsters/' + encodeURIComponent(found.index));
  const mid = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const cell = worldToCell(mid.x, mid.y);
  const walk = parseInt(entry.speed && entry.speed.walk, 10);
  const n = clamp(Math.round(count) || 1, 1, 20);
  const sameBefore = state.tokens.filter((t) => t.monster === entry.index).length;
  for (let i = 0; i < n; i++) {
    const spot = freeSquareNear(clamp(cell.col, 0, cols() - 1), clamp(cell.row, 0, rows() - 1), TokenSize.squares(entry.size));
    const number = sameBefore + i + 1;
    const t = makeToken({
      id: `mon-${entry.index}-${Date.now().toString(36)}${i}`, name: n + sameBefore > 1 ? `${entry.name} ${number}` : entry.name,
      color: '#a04545', isPC: false, hidden, kind: 'creature', speed: Number.isFinite(walk) ? walk : 30, image: entry.image || '', size: entry.size, flySpeed: TokenSize.parseSpeeds(entry.speed).fly, hover: Boolean(entry.speed && entry.speed.hover), ...spot
    });
    Object.assign(t, { monster: entry.index, hp: entry.hit_points, maxHp: entry.hit_points, ac: entry.armor_class[0].value, dexMod: Math.floor((entry.dexterity - 10) / 2), passivePerception: Number(entry.senses && entry.senses.passive_perception) || 10 + Math.floor(((Number(entry.wisdom) || 10) - 10) / 2) });
    state.tokens.push(t);
    joinCombat(t);
  }
  revealFog();
  commitBoard();
  renderCombat();
}

function pips(count, cls, onClick) {
  const row = document.createElement('span');
  for (let i = 0; i < 3; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cb-pip ${cls}${i < count ? ' on' : ''}`;
    b.textContent = cls === 'fail' ? '✗' : '✓';
    b.title = cls === 'fail' ? 'Failed death save' : 'Successful death save';
    b.addEventListener('click', () => onClick(i < count ? i : i + 1));
    row.appendChild(b);
  }
  return row;
}

// One compact line per combatant (initiative, name, conditions, hit points, AC). The active combatant opens up to show the details (actions used,
// changing hit points, death saves); any other row opens with its arrow.
function combatRow(t) {
  const current = t === activeToken() && state.combat.active;
  const open = current || state.cbOpen.has(t.id);
  const row = document.createElement('div');
  row.className = `cb-row${current ? ' current' : ''}${t.dead ? ' dead' : ''}${t.isPC ? '' : ' npc'}`;
  const line1 = document.createElement('div');
  line1.className = 'cb-line';
  const init = document.createElement('input');
  init.type = 'number';
  init.className = 'cb-init';
  init.placeholder = '?';
  init.title = 'Initiative';
  init.value = Number.isFinite(t.initiative) ? Math.round(t.initiative * 10) / 10 : '';
  init.addEventListener('change', () => { t.initiative = init.value === '' ? null : Number(init.value); sortCombat(); commitBoard(); renderCombat(); });
  const name = document.createElement('button');
  name.className = 'cb-name';
  name.textContent = t.name + (t.dead ? ' ✖' : '');
  name.title = `Center on ${t.name}`;
  name.addEventListener('click', () => { centerOnToken(t); });
  // Initiative numbers of creatures are the DM's business: the players see the order, not the numbers.
  if (!t.isPC && !state.dmView) { const hidden = document.createElement('span'); hidden.className = 'cb-init cb-init-hidden'; hidden.textContent = '•'; hidden.title = 'Creature initiative is hidden; the order is what counts'; line1.append(hidden, name); }
  else line1.append(init, name);
  if (t.delayed) { const dl = document.createElement('span'); dl.className = 'cb-ready'; dl.textContent = '⏸'; dl.title = "Delaying: acts after another combatant's turn"; line1.appendChild(dl); }
  if (t.dmNote && state.dmView) { const dn = document.createElement('span'); dn.className = 'cb-ready cb-dmnote'; dn.textContent = '🗒'; dn.title = 'DM note: ' + t.dmNote; line1.appendChild(dn); }
  if (t.readied) { const rd = document.createElement('span'); rd.className = 'cb-ready'; rd.textContent = '⏳'; rd.title = 'Readied: ' + t.readied; line1.appendChild(rd); }
  if (t.monster) {
    const link = document.createElement('a');
    link.href = `/bestiary.html#${t.monster}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '📖';
    link.title = 'Open the stat block';
    line1.appendChild(link);
  }
  for (const c of tokenConditions(t)) {
    const chip = document.createElement('span');
    chip.className = 'cond-dot';
    chip.style.background = conditionBadge(c.name)[1];
    chip.title = conditionLabel(c) + (conditionHelp(c.name) ? ': ' + conditionHelp(c.name) : '');
    chip.textContent = conditionBadge(c.name)[0];
    line1.appendChild(chip);
  }
  const max = maxHpOf(t);
  const hp = max !== null ? hpOf(t) : null;
  if (max !== null) {
    const bar = document.createElement('div');
    bar.className = 'cb-hpbar';
    const fill = document.createElement('i');
    const pct = clamp(hp / max, 0, 1);
    fill.style.width = `${pct * 100}%`;
    fill.style.background = pct > 0.5 ? '#3fd27f' : pct > 0.25 ? '#f0c048' : '#ff6b6b';
    bar.appendChild(fill);
    const text = document.createElement('span');
    text.className = 'cb-hptext';
    // The players see an enemy's health as the bar only; the numbers show for the party and in DM view (Test Lab).
    const hideNumbers = !t.isPC && !state.dmView;
    text.textContent = hideNumbers ? '' : `${hp}/${max}`;
    if (hideNumbers) { text.style.minWidth = '0'; bar.title = pct > 0.75 ? 'Unhurt or lightly wounded' : pct > 0.5 ? 'Wounded' : pct > 0.25 ? 'Bloodied' : 'Near death'; }
    line1.append(bar, text);
  }
  const ac = effAcOf(t);
  if (ac !== null) { const s = document.createElement('span'); s.className = 'cb-ac'; s.textContent = `AC ${ac}`; if (ac !== acOf(t)) s.title = `Base AC ${acOf(t)} ${acBonusOf(t) > 0 ? '+' : '−'} ${Math.abs(acBonusOf(t))} (${acBonusOf(t) > 0 ? 'haste' : 'slow'})`; line1.appendChild(s); }
  if (!current) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'cb-more';
    more.textContent = open ? '▴' : '▾';
    more.title = open ? 'Hide the details' : 'Show actions used, change hit points';
    more.addEventListener('click', () => { if (open) state.cbOpen.delete(t.id); else state.cbOpen.add(t.id); renderCombat(); });
    line1.appendChild(more);
  }
  row.appendChild(line1);
  if (!open) return row;

  if (max !== null) {
    const line2 = document.createElement('div');
    line2.className = 'cb-line';
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '1';
    amount.className = 'cb-num';
    amount.placeholder = 'HP';
    amount.setAttribute('aria-label', `Hit points to change for ${t.name}`);
    const apply = (sign) => { const v = Number(amount.value); if (!(v > 0)) { amount.focus(); return; } changeHp(t, sign * v); commitBoard(); renderCombat(); };
    const dmg = document.createElement('button'); dmg.className = 'btn btn-sm'; dmg.textContent = '−'; dmg.title = 'Damage'; dmg.addEventListener('click', () => apply(-1));
    const heal = document.createElement('button'); heal.className = 'btn btn-sm'; heal.textContent = '+'; heal.title = 'Heal'; heal.addEventListener('click', () => apply(1));
    amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(-1); });
    line2.append(amount, dmg, heal);
    row.appendChild(line2);
    if (t.isPC && hp === 0 && !t.stable && t.deathSaves) {
      const line3 = document.createElement('div');
      line3.className = 'cb-line';
      const lab = document.createElement('span'); lab.className = 'cb-ac'; lab.textContent = 'Death saves';
      const set = (key, v) => { setDeathSave(t, key, v); commitBoard(); renderCombat(); };
      line3.append(lab, pips(t.deathSaves.success, 'ok', (v) => set('success', v)), pips(t.deathSaves.fail, 'fail', (v) => set('fail', v)));
      row.appendChild(line3);
    }
  }
  if (state.combat.active) {
    const line4 = document.createElement('div');
    line4.className = 'cb-line';
    const spent = t.spent || { a: false, b: false, r: false };
    for (const [key, label, tip] of [['a', 'Action', 'Action used this turn'], ['b', 'Bonus', 'Bonus action used this turn'], ['r', 'Reaction', 'Reaction used since the start of its turn']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cb-use${spent[key] ? ' spent' : ''}`;
      b.textContent = label;
      b.title = tip;
      b.addEventListener('click', () => { t.spent = { ...spent, [key]: !spent[key] }; commitBoard(); renderCombat(); });
      line4.appendChild(b);
    }
    row.appendChild(line4);
  }
  return row;
}

function renderCombat() {
  const box = $('#combatPanel');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = !state.combat.active;            // the panel only exists while there is a fight
  if (!state.combat.active) return;
  const head = document.createElement('div');
  head.className = 'cb-head';
  const title = document.createElement('span');
  title.className = 'cb-title';
  const cur = activeToken();
  title.innerHTML = state.combat.active ? `⚔ Combat <small>round ${state.combat.round}${cur ? ' · ' + esc(cur.name) + "'s turn" : ''}</small>` : '⚔ Combat <small>not started</small>';
  head.appendChild(title);
  // No buttons here: the DM starts and ends the fight (token actions startCombat and endCombat), so to stop one, ask it.
  // There is no Start combat button: the DM starts a fight (token action startCombat) when the players act against someone or say they roll for
  // initiative. Once it is running the buttons above let a person step in.
  // Creatures and conjured things (a Spiritual Weapon, Mage Hand) are put on the map by the DM, not from here.
  box.appendChild(head);
  if (state.dmView && state.dmPad) { const pad = document.createElement('div'); pad.className = 'cb-note cb-dmpad'; pad.textContent = '🗒 DM notes: ' + state.dmPad; box.appendChild(pad); }
  if (state.combat.active) {
    const rows = combatTokens().filter(canSee);
    for (const t of rows) box.appendChild(combatRow(t));
    const waiting = combatTokens().filter((t) => t.isPC && !Number.isFinite(t.initiative));
    if (waiting.length) { const n = document.createElement('div'); n.className = 'cb-note'; n.textContent = `Waiting for initiative: ${waiting.map((t) => t.name).join(', ')}`; box.appendChild(n); }
  } else {
    // Out of combat the tracker still shows hit points of anything that has them, so damage can be tracked before a fight too.
    for (const t of state.tokens.filter((x) => canSee(x) && maxHpOf(x) !== null && (x.isPC ? false : true))) box.appendChild(combatRow(t));
  }
}

// A rest ends lasting effects on the player tokens; a long rest also clears exhaustion and the dying state. (Hit points and spell
// slots are restored on the server; the characters are reloaded after.)
function restTokens(kind) {
  // Timed effects and concentration have ended by the end of a rest. A long rest also brings the dying back on their feet (the dead stay
  // dead). Exhaustion is left for the DM to reduce by a level.
  for (const t of state.tokens.filter((x) => x.isPC)) {
    t.conditions = tokenConditions(t).filter((c) => !(c.rounds > 0) && c.name !== 'concentrating' && !(kind === 'long' && !t.dead && c.name === 'unconscious'));
    if (kind === 'long' && !t.dead) { t.deathSaves = null; t.stable = false; }
  }
  revealFog();
  commitBoard();
}

// Attack d20 for tables where the player rolls their own dice.
function syncDiceUi() {
  const mode = store.get('vtt.diceMode', 'ai') === 'player' ? 'player' : 'ai';
  $('#diceMode').value = mode;
}
// The player's own roll: a number they typed from real dice, or a real random roll made by the server ("Roll for me"). Either way it goes to the DM as a chat message.
const pickedDie = () => { const [sides, mode] = $('#rollDie').value.split('|'); return { sides: Number(sides), mode }; };
const modeWords = (mode) => (mode === 'advantage' ? ' with advantage' : mode === 'disadvantage' ? ' with disadvantage' : '');
function sendAttackRoll(value) {
  const { sides, mode } = pickedDie();
  const n = Math.round(Number(value));
  if (!(n >= 1 && n <= sides)) { toast(`Enter the number on the d${sides} (1 to ${sides})`); $('#attackRoll').focus(); return; }
  $('#attackRoll').value = '';
  sendTurn(`I rolled ${n} on the d${sides}${modeWords(mode)}.`, { typed: true });
}
async function rollForMe() {
  const { sides, mode } = pickedDie();
  try {
    const r = await jsonPost('/api/roll', { expr: `d${sides}`, mode });
    const detail = r.mode !== 'normal' ? ` (${r.rolls.join(' and ')})` : '';
    sendTurn(`I rolled ${r.total} on the d${sides}${modeWords(mode)}${detail}.`, { typed: true });
  } catch (err) { toast(err.message, 'error'); }
}
const combatForAi = () => ({
  active: state.combat.active, round: state.combat.round, currentTokenId: activeToken() ? activeToken().id : '',
  order: combatTokens().map((t) => ({ tokenId: t.id, initiative: Number.isFinite(t.initiative) ? t.initiative : null, delayed: Boolean(t.delayed) }))
});

