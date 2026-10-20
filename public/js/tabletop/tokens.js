// The tabletop, part of public/index.html: tokens, sizes, conditions and effects.
// Classic script: it shares one global scope with the other files in public/js/tabletop/, loaded in this order by index.html.
'use strict';

/* =====================================================================
   TOKENS
   ===================================================================== */
const activeToken = () => state.tokens[state.activeIndex] || null;
const isGuidId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id));
const tokenIdFor = (id) => 'tok-' + (isGuidId(id) ? String(id).slice(0, 8) : id);
const characterFor = (t) => (t?.characterId ? state.characters.find((c) => c.id === t.characterId) : null);

function makeToken({ id, name, color, characterId = null, isPC = true, col, row, speed = 30, image = '', hidden = false, kind = 'creature', size = 'medium', flySpeed = 0, hover = false }) {
  return { id, name, color, characterId, isPC, col, row, speed, image, hidden: Boolean(hidden), kind: kind === 'trap' ? 'trap' : 'creature', size: TokenSize.normalize(size), flySpeed: Number(flySpeed) > 0 ? Number(flySpeed) : 0, hover: Boolean(hover), elevation: 0, conditions: [], movementRemaining: Math.max(0, speed) };
}

// ---- Conditions and lasting effects on tokens ----
// A token's conditions are { name, rounds }; rounds is how many rounds are left (0 = until removed). The names below are the
// 5e conditions plus concentration; anything else is a short effect name such as "bless".
const CONDITIONS = {
  blinded: ['Bl', '#8e8e9a'], charmed: ['Ch', '#ff7ac8'], deafened: ['De', '#9a8e7a'], frightened: ['Fr', '#b06bff'],
  grappled: ['Gr', '#d98a3d'], incapacitated: ['In', '#cc5555'], invisible: ['Iv', '#6fd0e8'], paralyzed: ['Pa', '#e0c040'],
  petrified: ['Pe', '#9aa0a6'], poisoned: ['Po', '#4cc46a'], prone: ['Pr', '#c08a5a'], restrained: ['Re', '#d9a43d'],
  stunned: ['St', '#f0a040'], unconscious: ['Un', '#e05050'], exhaustion: ['Ex', '#a07850'], concentrating: ['Co', '#4f9dff'],
  surprised: ['Su', '#c9a0ff'], disengaged: ['Di', '#6fd0e8']
};
const tokenConditions = (t) => (Array.isArray(t?.conditions) ? t.conditions.filter((c) => c && c.name) : []);
const conditionKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
const hasCondition = (t, name) => tokenConditions(t).some((c) => c.name === name);
const conditionBadge = (name) => CONDITIONS[name] || [name.slice(0, 2).toUpperCase(), '#4f9dff'];
// What each condition does (the 5e rules, shortened). The table applies the movement part itself; the rest is for the DM and the players.
const CONDITION_HELP = {
  blinded: "Can't see; fails checks that need sight. Attacks against it have advantage, its attacks have disadvantage.",
  charmed: "Can't attack the charmer or target it with harmful effects. The charmer has advantage on social checks against it.",
  deafened: "Can't hear; fails checks that need hearing.",
  frightened: "Disadvantage on checks and attacks while the source of fear is in sight; can't willingly move closer to it.",
  grappled: 'Speed 0. Ends if the grappler is incapacitated or it is moved out of reach.',
  incapacitated: "Can't take actions or reactions.",
  invisible: 'Cannot be seen without magic or special senses. Its attacks have advantage, attacks against it have disadvantage.',
  paralyzed: "Incapacitated, can't move or speak. Fails Str and Dex saves. Attacks against it have advantage; hits within 5 ft are critical.",
  petrified: "Turned to stone: incapacitated, can't move or speak, unaware. Resistant to all damage, immune to poison and disease.",
  poisoned: 'Disadvantage on attack rolls and ability checks.',
  prone: 'Can only crawl (half speed, here) or stand up (costs half its movement). Melee attacks against it have advantage, ranged have disadvantage; its attacks have disadvantage.',
  restrained: 'Speed 0. Attacks against it have advantage, its attacks and Dex saves have disadvantage.',
  stunned: "Incapacitated, can't move, speaks falteringly. Fails Str and Dex saves. Attacks against it have advantage.",
  unconscious: "Incapacitated, can't move or speak, unaware, drops what it holds and falls prone. Attacks against it have advantage; hits within 5 ft are critical.",
  exhaustion: 'Levels of exhaustion impose growing penalties; a long rest removes one level.',
  concentrating: 'Concentrating on a spell: a hit forces a Constitution save (DC 10 or half the damage) or the spell ends.',
  surprised: "Surprised: can't move or take an action or a reaction on its first turn; the condition ends when that turn ends.",
  disengaged: "Disengaged: its movement does not provoke opportunity attacks this turn."
};
const conditionHelp = (name) => CONDITION_HELP[name] || '';
// Speed lost to conditions: held, paralyzed, petrified, stunned or unconscious creatures cannot move; prone ones crawl.
// Flying (2014 PHB "Flying Movement"): a creature with a flying speed (its own, or 60 ft from the fly spell) uses it while it is in the air (elevation above 0), or always when it has no walking speed (a ghost, a flameskull).
// An effect can give a flying speed (fly: feet, or 'walk'), keep a creature up (aloft) or hold it still (still); see public/data/effect-data.json.
const effectDefsOn = (t) => tokenConditions(t).map((c) => EFFECT_DEFS[c.name]).filter(Boolean);
const flySpeedOf = (t) => Math.max(Number(t && t.flySpeed) || 0, ...effectDefsOn(t).map((e) => (e.fly === 'walk' ? Number(t.speed) || 0 : Number(e.fly) || 0)));
const heldAloft = (t) => hasCondition(t, 'fly') || effectDefsOn(t).some((e) => e.aloft);
const isFlying = (t) => Boolean(t) && flySpeedOf(t) > 0 && ((Number(t.elevation) || 0) > 0 || !(Number(t.speed) > 0));
// Speed now: the walking or flying speed, doubled by haste, halved by slow (both: back to normal), halved when prone; none when held, stunned and so on, or lethargic after haste ends.
function effectiveSpeed(t) {
  if (['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious', 'surprised', 'lethargic'].some((n) => hasCondition(t, n)) || effectDefsOn(t).some((e) => e.still)) return 0;
  let sp = isFlying(t) ? flySpeedOf(t) : t.speed;
  if (!Number.isFinite(sp)) return sp;
  sp += effectDefsOn(t).reduce((n, e) => n + (Number(e.speedBonus) || 0), 0);       // longstrider and the like
  if (hasCondition(t, 'haste')) sp *= 2;
  if (hasCondition(t, 'slow')) sp = Math.floor(sp / 2);
  return hasCondition(t, 'prone') ? Math.floor(sp / 2) : sp;
}
// Armor Class now: the base AC plus haste (+2) and slow (-2). The base number is never changed.
const acBonusOf = (t) => (hasCondition(t, 'haste') ? 2 : 0) - (hasCondition(t, 'slow') ? 2 : 0);
const effAcOf = (t) => { const ac = acOf(t); return ac === null ? null : ac + acBonusOf(t); };
// A flying creature falls when it is knocked prone, held, paralyzed, stunned, petrified or unconscious or at 0 hit points, unless it can hover or the fly spell holds it up; it also falls when the fly spell ends.
// Fall damage is 1d6 bludgeoning per 10 ft (at most 20d6) and it lands prone: the table does not roll it, the DM is told.
const FALL_CONDITIONS = ['prone', 'grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
function checkFall(t) {
  const h = Number(t && t.elevation) || 0;
  if (h <= 0 || t.hover || heldAloft(t)) return false;
  if (flySpeedOf(t) > 0 && !FALL_CONDITIONS.some((n) => hasCondition(t, n)) && hpOf(t) !== 0) return false;
  t.elevation = 0;
  const dice = TokenSize.fallDice(h);
  if (dice > 0) setCondition(t, 'prone', 0);
  const line = `${t.name} falls ${h} ft${dice ? `: ${dice}d6 bludgeoning damage, lands prone` : ': no damage (under 10 ft)'}`;
  if (seenByParty(t)) addChat('system', '↳ ' + line);
  state.pendingNotes.push(line + (dice ? '. Roll the damage (the table does not) and apply it with a damage token update.' : '.'));
  return true;
}
// Effects (not conditions) with how long they last: loaded from /effect-data.json; the game clock (minutes since Day 1, 00:00) comes with every DM reply and from /api/party.
let EFFECT_DEFS = {};
async function loadEffectDefs() { try { EFFECT_DEFS = (await (await fetch('/data/effect-data.json')).json()).effects || {}; } catch { EFFECT_DEFS = {}; } }
// The clock readout in the top bar ("Day 1, 08:00 morning"); the same time-of-day words as lib/rules-track.js.
function renderGameClock() {
  const el = $('#gameClock');
  if (!el) return;
  if (!Number.isFinite(state.clockTotal)) { el.textContent = ''; return; }
  const m = Math.max(0, Math.round(state.clockTotal)), h = Math.floor((m % 1440) / 60);
  const part = h < 5 ? 'night' : h < 8 ? 'dawn' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  el.textContent = `Day ${Math.floor(m / 1440) + 1}, ${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} ${part}`;
}
function setClockTotal(m) { state.clockTotal = m; renderGameClock(); }
async function refreshClock() { try { const j = await (await fetch('/api/party')).json(); if (j && j.clock && Number.isFinite(j.clock.minutes)) { setClockTotal(j.clock.minutes); expireTimedConditions(); } } catch { /* no clock: timed effects only count rounds */ } }
// Live clock: the server announces every change to the party, clock or characters (a rest on the Party tab, another browser). Not in spectator mode (watch.js reloads there); with ?nosave=1 only when ?live=1.
function connectLive() {
  if (window.WATCH === true || typeof EventSource === 'undefined' || !state.campaignId || state.campaignId === 'default') return;
  if (/[?&]nosave=1/.test(location.search) && !/[?&]live=1/.test(location.search)) return;
  let timer = null, pending = false, source = null, tries = 0;
  const run = async () => {
    timer = null;
    if (state.busy) { timer = setTimeout(run, 800); return; }
    const party = pending; pending = false;
    await refreshClock();
    if (party && !state.busy) await loadCharacters();
  };
  const open = () => {
    source = new EventSource(`/api/campaigns/${encodeURIComponent(state.campaignId)}/live`);
    source.addEventListener('hello', () => { tries = 0; });
    source.addEventListener('change', (e) => {
      let d = {}; try { d = JSON.parse(e.data); } catch { /* ignore */ }
      if (d.scope !== 'party' && d.scope !== 'chat') return;           // game saves and the like are our own writes
      if (d.scope === 'party') pending = true;
      if (!timer) timer = setTimeout(run, 300);
    });
    source.onerror = () => {                                           // reconnect politely: back off up to 30 s, then catch up on what was missed
      source.close(); tries += 1;
      setTimeout(() => { open(); pending = true; if (!timer) timer = setTimeout(run, 300); }, Math.min(30000, 2000 * tries));
    };
  };
  open();
}
const minutesLeft = (c) => (Number.isFinite(c.untilMin) && Number.isFinite(state.clockTotal) ? Math.max(0, c.untilMin - state.clockTotal) : null);
function leftText(c) {
  const parts = [];
  if (c.rounds > 0) parts.push(`${c.rounds} round${c.rounds === 1 ? '' : 's'}`);
  const m = minutesLeft(c);
  if (m !== null) parts.push(m >= 120 ? `${Math.round(m / 60)} hours` : m >= 60 ? `${Math.round(m / 6) / 10} hour` : `${m} min`);
  return parts.length ? ` (${parts.join(' / ')} left)` : '';
}
const conditionLabel = (c) => c.name + leftText(c);
// A blinded or unconscious character feels only their own square (1 ft); see revealFog().

function setCondition(t, name, rounds, opts = {}) {
  const key = conditionKey(name);
  if (!t || !key) return false;
  if (!Array.isArray(t.conditions)) t.conditions = [];
  let left = Number.isFinite(rounds) && rounds > 0 ? Math.min(Math.round(rounds), 999) : 0;
  let minutes = Number.isFinite(Number(opts.minutes)) && Number(opts.minutes) > 0 ? Math.min(Math.round(Number(opts.minutes)), 60 * 24 * 30) : 0;
  const def = EFFECT_DEFS[key];
  if (def && !left && !minutes) { left = def.rounds || 0; minutes = def.minutes || 0; }          // a known effect: its own duration
  const entry = { name: key, rounds: left };
  if (minutes && Number.isFinite(state.clockTotal)) entry.untilMin = state.clockTotal + minutes;
  const source = String(opts.source || '').trim();
  if (def && def.concentration) { entry.concentration = true; if (source) entry.source = source; }
  const have = t.conditions.find((c) => c.name === key);
  if (have) { for (const k of ['untilMin', 'source', 'concentration']) delete have[k]; Object.assign(have, entry); } else t.conditions.push(entry);
  if (t === activeToken() && Number.isFinite(t.movementRemaining) && !t.conditions.some((c) => c.name === 'dashing')) t.movementRemaining = Math.min(t.movementRemaining, effectiveSpeed(t));
  if (FALL_CONDITIONS.includes(key)) checkFall(t);
  return true;
}

function clearCondition(t, name) {
  const key = conditionKey(name);
  if (!t || !Array.isArray(t.conditions)) return false;
  const before = t.conditions.length;
  t.conditions = t.conditions.filter((c) => c.name !== key);
  if (key === 'concentrating') endConcentrationEffects(t);
  const removed = t.conditions.length !== before;
  // Haste ending leaves the creature lethargic: it can't move or take actions until after its next turn (2014 PHB, haste).
  if (removed && key === 'haste' && !t.dead) { setCondition(t, 'lethargic', 2); if (seenByParty(t)) addChat('system', `↳ ${t.name} is lethargic: it can't move or take actions until after its next turn`); }
  if (removed && (key === 'fly' || EFFECT_DEFS[key]?.aloft || EFFECT_DEFS[key]?.fly)) checkFall(t);
  return removed;
}
// When a caster stops concentrating, every effect that depends on it (put on with the caster's token id as its source) ends too.
function endConcentrationEffects(caster) {
  for (const o of state.tokens) {
    const keep = tokenConditions(o).filter((c) => !(c.concentration && c.source === caster.id));
    if (keep.length === tokenConditions(o).length) continue;
    const ended = tokenConditions(o).filter((c) => c.concentration && c.source === caster.id).map((c) => c.name);
    o.conditions = keep;
    if (seenByParty(o)) addChat('system', `↳ ${o.name} loses ${ended.join(', ')} (${caster.name} stopped concentrating)`);
  }
}
// END TRIGGERS (effect-data.json "trigger"): what the table can see it enforces by the book; the rest stays with the DM.
//   harms: ends when its holder is the actor of a damaging update on another creature (sanctuary). The actor is the active combatant; outside a fight there is no
//          reliable actor, so nothing is enforced then and the DM is told to end it. An attack that misses leaves no update: the DM still ends it for those.
//   idle-round: rage ends at the end of its holder's turn if, since their last turn, they neither dealt damage to another creature, took damage, nor had a roll line in the
//          DM's reply that starts with their name and talks about an attack (so a miss counts); it also ends when they drop to 0 hit points.
//   target-down: hunter's mark and hex end when the creature carrying them drops to 0 hit points (the caster may move them to a new creature as a bonus action).
function triggerOf(c) { const d = EFFECT_DEFS[c.name]; return d && d.trigger ? d.trigger : ''; }
function endEffectByTable(t, key, why, advice) {
  if (!clearCondition(t, key)) return false;
  if (seenByParty(t)) addChat('system', `↳ ${t.name} is no longer ${key} (${why})`);
  state.pendingNotes.push(`The table ended ${key} on ${t.name}: ${why}. Do not remove it again.${advice ? ' ' + advice : ''}`);
  return true;
}
function endEffectsWithTrigger(t, trigger, why, advice) {
  let any = false;
  for (const c of [...tokenConditions(t)]) if (triggerOf(c) === trigger && endEffectByTable(t, c.name, why, advice)) any = true;
  return any;
}
// A creature made an attack or harmed another one (the table saw a damaging update, or the DM's roll lines show an attack that missed).
function noteAttackBy(actor, target) {
  if (!actor || (target && actor === target)) return;
  actor.attackedSince = true;
  endEffectsWithTrigger(actor, 'harms', 'it attacked or harmed another creature');
}
// The creature a roll line is about: the one whose name (or first name) the line starts with, in a fight or not; the longest name wins.
function rollLineActor(line) {
  let best = null, bestLen = 0;
  for (const t of state.tokens) {
    if (!t.name || t.dead) continue;
    for (const n of [String(t.name).toLowerCase(), String(t.name).split(' ')[0].toLowerCase()]) if (n && line.startsWith(n) && n.length > bestLen) { best = t; bestLen = n.length; }
  }
  return best;
}
const ATTACK_WORDS = /\b(attack|hits?|misses?|strikes?|slash|stab|shoot|fires?|smite|swing|swings)\b/;
const CHECK_WORDS = /\b(check|acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival)\b/;
function noteRollLines(lines) {
  const attacked = new Set();
  for (const raw of lines) {
    const line = String(raw).toLowerCase();
    const actor = rollLineActor(line);
    if (!actor) continue;
    if (ATTACK_WORDS.test(line) && !attacked.has(actor.id)) { attacked.add(actor.id); noteAttackBy(actor, null); }
    else if (CHECK_WORDS.test(line) && !/\bsav(e|ing)\b/.test(line)) endEffectsWithTrigger(actor, 'check-rolled', 'the 1d4 was used on an ability check');
  }
}
// The end of a combatant's turn: rage needs an attack or damage since their last turn; then the flags start over.
function endOfTurnTriggers(t) {
  if (!t) return;
  if (!t.attackedSince && !t.hurtSince) endEffectsWithTrigger(t, 'idle-round', 'a whole round passed with no attack and no damage taken');
  for (const c of tokenConditions(t)) if (triggerOf(c) === 'turn-save') state.pendingNotes.push(`${t.name}'s turn is over and ${c.name} is still on it: it repeats its saving throw now (the caster's spell save DC; slow uses Wisdom). Roll it from the dice tray and remove ${c.name} with removeCondition if it succeeds.`);
  t.attackedSince = false; t.hurtSince = false;
}

// The game clock moves with the story: every combat round is 6 seconds, so ten rounds make a minute and an effect that lasts a minute or ten runs out when the book says (the DM and rests add
// their own time). The seconds left over are kept with the board; whole minutes are added locally and sent to the server's clock.
function advanceGameClock(minutes, seconds) {
  state.clockSeconds = (Number(state.clockSeconds) || 0) + (Number(seconds) || 0);
  let m = Math.max(0, Math.round(Number(minutes) || 0));
  while (state.clockSeconds >= 60) { state.clockSeconds -= 60; m += 1; }
  if (!m) return;
  if (Number.isFinite(state.clockTotal)) setClockTotal(state.clockTotal + m);
  fetch('/api/party/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: m }) }).catch(() => {});
  expireTimedConditions();
}

// Effects with an end on the game clock run out when the clock passes it (after a DM reply, a rest or the time action).
function expireTimedConditions() {
  if (!Number.isFinite(state.clockTotal)) return false;
  let changed = false;
  for (const t of state.tokens) {
    const gone = tokenConditions(t).filter((c) => Number.isFinite(c.untilMin) && c.untilMin <= state.clockTotal);
    if (!gone.length) continue;
    t.conditions = tokenConditions(t).filter((c) => !gone.includes(c));
    for (const c of gone) { if (seenByParty(t)) addChat('system', `↳ ${t.name} is no longer ${c.name} (time ran out)`); if (c.name === 'concentrating') endConcentrationEffects(t); }
    changed = true;
  }
  if (changed) { revealFog(); commitBoard(); renderCombat(); }
  return changed;
}

// At the start of a new round every timed condition loses a round; the ones that run out are removed.
function tickConditions() {
  let changed = false;
  for (const t of state.tokens) {
    for (const c of tokenConditions(t)) {
      if (!(c.rounds > 0)) continue;
      c.rounds -= 1;
      if (c.rounds <= 0) {
        clearCondition(t, c.name);
        if (seenByParty(t)) addChat('system', `↳ ${t.name} is no longer ${c.name}`);
        changed = true;
      }
    }
    if (t.summon && t.summon.rounds > 0) {
      t.summon.rounds -= 1;
      if (t.summon.rounds <= 0) {
        state.tokens.splice(state.tokens.indexOf(t), 1);
        addChat('system', `↳ ${t.name} fades away`);
        changed = true;
      }
    }
  }
  return changed;
}

// Summoned things a character controls (Mage Hand, Spiritual Weapon). They are tokens that move on their owner's turn, never have
// an initiative of their own, must stay within `leashFt` of their owner, and expire after `rounds` rounds.
const SUMMONS = {
  'mage-hand': { name: 'Mage Hand', speed: 30, rounds: 10, leashFt: 30, color: '#9ec1ff', glyph: '✋', note: 'Manipulates objects and carries up to 10 lb; cannot attack. Must stay within 30 ft of its caster.' },
  'spiritual-weapon': { name: 'Spiritual Weapon', speed: 20, rounds: 10, leashFt: 60, color: '#f0c048', glyph: '⚔', note: 'Moves up to 20 ft and attacks as a bonus action (cleric spell). Must stay within 60 ft of its caster.' }
};
const isSummon = (t) => Boolean(t && t.summon);
const summonsOf = (owner) => state.tokens.filter((t) => t.summon && t.summon.ownerId === owner.id);

function conjure(kind, owner, id, col, row) {
  const p = SUMMONS[kind];
  if (!p || !owner) return null;
  const spot = freeSquareNear(clamp(Number.isInteger(col) ? col : owner.col + 1, 0, cols() - 1), clamp(Number.isInteger(row) ? row : owner.row, 0, rows() - 1));
  const t = makeToken({ id: id || `summon-${kind}-${Date.now().toString(36)}`, name: `${owner.name}'s ${p.name}`, color: p.color, isPC: false, kind: 'creature', speed: p.speed, ...spot });
  t.summon = { kind, ownerId: owner.id, rounds: p.rounds, leashFt: p.leashFt };
  state.tokens.push(t);
  addChat('system', `↳ ${t.name} appears (${p.note})`);
  revealFog();
  commitBoard();
  return t;
}

// ---- What the players can see ----
// Player tokens are always shown. Anything else is hidden when it is marked hidden (invisible, hiding, an undiscovered trap),
// and, while fog of war is on, whenever it is outside the party's current line of sight.
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// A party member who is somewhere else (stayed behind, scouting): shown in the "Elsewhere" line, not on this board, not in a fight here.
const isElsewhere = (t) => Boolean(t && t.isPC && typeof t.where === 'string' && t.where.trim());
function seenByParty(t) {
  if (isElsewhere(t)) return false;
  if (t.isPC) return true;
  if (t.hidden || hasCondition(t, 'invisible')) return false;
  if (!fogOn() || state.gmOverride) return true;
  // A token is seen when its centre is in sight, or (a big one) the centre of any of its squares: the edge-most visible point.
  if (fp(t) > 1) return TokenSize.cells(t.col, t.row, fp(t)).concat([[t.col + fp(t) / 2 - 0.5, t.row + fp(t) / 2 - 0.5]]).some(([c, r]) => { const x = centerOf(c), y = centerOf(r); return state.sight.some((s) => visibleFrom(s, x, y)); });
  const x = tcx(t), y = tcy(t);
  return state.sight.some((s) => visibleFrom(s, x, y));
}
const canSee = (t) => seenByParty(t) || state.dmView;
// Is a point (a door, say) in the party's sight? Used to decide whether a change there is worth a line in the chat.
function seenByPartyPoint(x, y) {
  if (!fogOn() || state.gmOverride) return true;
  return state.sight.some((s) => visibleFrom(s, x, y));
}

// Token art cache: url -> HTMLImageElement (loads lazily, re-renders when ready).
const tokenArt = new Map();
function artFor(url) {
  if (!url) return null;
  let img = tokenArt.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => requestRender();
    img.onerror = () => { img.failed = true; };
    img.src = url;
    tokenArt.set(url, img);
  }
  return img.complete && img.naturalWidth && !img.failed ? img : null;
}

// The nearest top-left square where a footprint of n x n squares fits on the map and overlaps no other token (a square near (col, row); n = 1 for a medium creature).
function freeSquareNear(col, row, n = 1) {
  const others = state.tokens.filter((t) => !(t.dead && !t.isPC)).map((t) => ({ col: t.col, row: t.row, n: fp(t) }));
  const fits = (c, r) => inBounds(c, r) && inBounds(c + n - 1, r + n - 1) && !others.some((o) => TokenSize.overlaps({ col: c, row: r, n }, o));
  for (let radius = 0; radius < Math.max(cols(), rows()); radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        if (fits(col + dc, row + dr)) return { col: col + dc, row: row + dr };
      }
    }
  }
  return { col: clamp(col, 0, cols() - n), row: clamp(row, 0, rows() - n) };
}

function createDefaultTokens() {
  state.tokens = [];
  const pcs = state.characters.slice(0, START_SQUARES.length);
  for (let i = 0; i < Math.max(4, pcs.length); i++) {
    const [col, row] = START_SQUARES[i];
    const c = pcs[i];
    state.tokens.push(c
      ? makeToken({ id: tokenIdFor(c.id), name: c.name, color: c.color, characterId: c.id, col, row, speed: c.effSpeed ?? c.speed, image: c.image || '' })
      : makeToken({ id: `tok-hero-${i + 1}`, name: DEFAULT_TOKENS[i].name, color: DEFAULT_TOKENS[i].color, col, row }));
  }
  state.activeIndex = 0;
}

let charAlias = {};
async function openShopFor(characterId, shop) {
  try {
    const party = await api('/api/party');
    const character = party.characters.find((c) => c.id === characterId);
    if (!character) { state.pendingNotes.push(`The shop could not open: no party member with id ${characterId}.`); return; }
    InventoryWizard.open({
      character, shop,
      onError: (m) => toast(m, 'error'),
      // The shopkeeper is a small agent of its own (POST /api/merchant): it greets, answers, haggles with a real Persuasion roll and may move the price; the DM stays out of it until the shop closes.
      talk: (t) => jsonPost('/api/merchant', { buyerId: characterId, merchant: shop.merchant, groups: shop.groups, markup: t.markup, base: t.base, message: t.message, opening: t.opening, history: t.history, place: state.map && state.map.name || '' }),
      onSay: (r) => {
        const lines = [{ speaker: shop.merchant, voice: r.voice, text: r.line }];
        const el = addChat('assistant', `🛒 ${shop.merchant}: ${r.line}`, lines);
        for (const roll of r.rolls || []) addChat('system', '🎲 ' + roll);
        try { voice.speak(lines, el); } catch (e) { /* no voice */ }
      },
      onClose: (info) => {
        const bits = [`${character.name} left ${shop.merchant}'s shop.`];
        if (info.summary) bits.push(`The merchant's account: ${info.summary}`);
        if (info.markup !== info.base) bits.push(`The price ended at ${info.markup}% of the book price (you set ${info.base}%).`);
        state.pendingNotes.push(bits.join(' '));
        addChat('system', `🛒 ${character.name} leaves ${shop.merchant}'s shop`);
      },
      onDone: async (out) => {
        const what = (out.notes || []).join('; ') || 'no change';
        addChat('system', `↳ ${character.name} shopped at ${shop.merchant}: ${what}`);
        state.pendingNotes.push(`${character.name} finished shopping at ${shop.merchant}. ${what}. Their coins and gear are updated; the shop is closed.`);
        await loadCharacters();
      }
    });
  } catch (err) { toast(`Could not open the shop: ${err.message}`, 'error'); }
}

function syncTokensWithCharacters() {
  const activeId = activeToken()?.id;
  for (const t of state.tokens) if (t.characterId && charAlias[t.characterId]) t.characterId = charAlias[t.characterId];
  state.tokens = state.tokens.filter((t) => !t.characterId || state.characters.some((c) => c.id === t.characterId));
  for (const t of state.tokens) {
    const c = characterFor(t);
    if (!c) continue;
    t.name = c.name;
    t.color = c.color;
    t.image = c.image || '';
    if (c.size) t.size = TokenSize.normalize(c.size);              // a character record may say Small (a halfling) or something bigger; the default is Medium
    const sp = c.effSpeed ?? c.speed;   // exhaustion slows a character
    if (t.speed !== sp) {
      t.speed = sp;
      t.movementRemaining = Math.min(t.movementRemaining, sp);
    }
  }
  // Characters made on the Character Sheets page get a token the first time the tabletop sees them.
  for (const c of state.characters) {
    if (state.tokens.some((t) => t.characterId === c.id)) continue;
    const [col, row] = START_SQUARES[state.tokens.filter((t) => t.isPC).length % START_SQUARES.length];
    const spot = freeSquareNear(clamp(col, 0, cols() - 1), clamp(row, 0, rows() - 1));
    state.tokens.push(makeToken({ id: tokenIdFor(c.id), name: c.name, color: c.color, characterId: c.id, col: spot.col, row: spot.row, speed: c.effSpeed ?? c.speed, image: c.image || '' }));
  }
  let idx = state.tokens.findIndex((t) => t.id === activeId);
  if (idx < 0) {
    // The active token left (a character was taken out of the party mid-fight, for instance): the turn passes to the next combatant in the order who is still here,
    // never to whatever token now happens to sit at the old position in the list (that once made a trap the active combatant).
    let next = null;
    if (state.combat.active) {
      const order = state.combat.order, from = order.indexOf(activeId);
      for (let k = 1; k <= order.length && !next; k++) next = state.tokens.find((t) => t.id === order[(from + k) % order.length] && !t.dead && !isElsewhere(t)) || null;
    }
    idx = next ? state.tokens.indexOf(next) : state.tokens.findIndex((t) => t.isPC);
  }
  state.activeIndex = idx >= 0 ? idx : 0;
  if (activeId && state.tokens[state.activeIndex] && state.tokens[state.activeIndex].id !== activeId) logTable('turn', `${state.tokens[state.activeIndex].name} is up, because ${activeId} left the table`);
  if (state.combat.active) state.combat.order = state.combat.order.filter((id) => state.tokens.some((t) => t.id === id));       // ids of tokens that are gone do not stay in the order
}

function clampTokensToMap() {
  for (const t of state.tokens) {
    t.col = clamp(t.col, 0, cols() - 1);
    t.row = clamp(t.row, 0, rows() - 1);
  }
}

function animateToken(t, fromX, fromY) {
  t._anim = { x: fromX, y: fromY, start: performance.now() };
  requestRender();
}

function tokenAt(wx, wy) {
  if (plainMap()) return null;
  for (let i = state.tokens.length - 1; i >= 0; i--) {
    const t = state.tokens[i];
    if (!canSee(t) || (t.dead && !t.isPC)) continue;                // bodies cannot be picked up or targeted
    if (Math.hypot(wx - tcx(t), wy - tcy(t)) <= GRID * 0.45 * Math.max(1, fp(t))) return t;
  }
  return null;
}

function doorAt(wx, wy) {
  const tolerance = Math.max(8, 10 / state.view.scale);
  let best = null, bestDist = Infinity;
  for (const w of state.walls) {
    if (w.type !== 'door' || w.secret) continue;
    const d = pointSegmentDistance(wx, wy, w);
    if (d < tolerance && d < bestDist) { best = w; bestDist = d; }
  }
  return best;
}

// The AI tracks turns: the DM sends token action endTurn (or the player tells it they are done) and the tracker moves on.
function endTurn() {
  if (state.combat.active) nextCombatTurn();
}

function serializeToken(t) {
  return { where: isElsewhere(t) ? t.where.trim() : '', readied: t.readied || '', delayed: Boolean(t.delayed), actsAfter: t.actsAfter || '', dmNote: t.dmNote || '', id: t.id, name: t.name, col: t.col, row: t.row, color: t.color, isPC: t.isPC, characterId: t.characterId, speed: t.speed, movementRemaining: t.movementRemaining, image: t.image || '', hidden: Boolean(t.hidden), kind: t.kind === 'trap' ? 'trap' : 'creature', size: TokenSize.normalize(t.size), footprint: fp(t), flySpeed: t.flySpeed || 0, hover: Boolean(t.hover), elevation: Number(t.elevation) || 0, ...(Number(t.elevation) > 0 ? { elevationNote: `${t.elevation} ft up: a melee attacker needs a reach of at least ${t.elevation} ft to hit it (5 ft reach cannot); brought down it falls ${TokenSize.fallDice(t.elevation)}d6 bludgeoning and lands prone` } : {}), speedNow: effectiveSpeed(t), effectiveAc: effAcOf(t), conditions: tokenConditions(t).map((c) => ({ name: c.name, rounds: c.rounds, ...(c.armed ? { armed: true } : {}), ...(Number.isFinite(c.untilMin) ? { untilMin: c.untilMin, minutesLeft: minutesLeft(c) } : {}), ...(c.source ? { source: c.source } : {}), ...(c.concentration ? { concentration: true } : {}) })),
    summon: t.summon || null, lightKind: t.lightKind || '', hp: t.hp, maxHp: t.maxHp, ac: t.ac, monster: t.monster || '', dexMod: t.dexMod, passivePerception: t.passivePerception || undefined, xp: t.xp || undefined, xpAwarded: t.xpAwarded ? true : undefined, initiative: t.initiative, dead: Boolean(t.dead), stable: Boolean(t.stable), deathSaves: t.deathSaves || null, spent: t.spent || null, squeezed: Boolean(t.squeezed) };
}

