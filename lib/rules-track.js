// Rules the table tracks besides gear (official 5e 2014; the 2024 differences are in small tables): XP and levels, Hit Dice,
// exhaustion, limited-use class resources, and the in-game clock (which enforces one long rest per 24 hours).
// All of it is plain data on the character record (`track`) and a per-campaign clock file; everything here is pure
// except readClock/writeClock, so it is unit tested (test/rules-track.test.mjs).

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { rollDie } from './dice.js';

const clampInt = (v, lo, hi, dflt = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

/* ---------------- XP and levels ---------------- */

// Minimum XP for levels 1..20 (the same table in the 2014 and 2024 rules).
export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export const levelForXp = (xp) => {
  let level = 1;
  XP_THRESHOLDS.forEach((need, i) => { if (Number(xp) >= need) level = i + 1; });
  return level;
};
export const xpForNextLevel = (level) => (level >= 20 ? null : XP_THRESHOLDS[level]);

// XP of a monster by challenge rating (SRD / Monster Manual table).
export const CR_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };
export const xpForCr = (cr) => CR_XP[String(cr).trim()] ?? 0;

// Split the XP of defeated monsters (a list of CRs, or { cr, count }) equally among the party members.
export function splitXp(monsters, partySize) {
  const total = (Array.isArray(monsters) ? monsters : []).reduce((n, m) => n + (m && typeof m === 'object' ? xpForCr(m.cr) * clampInt(m.count, 1, 999, 1) : xpForCr(m)), 0);
  const size = Math.max(1, clampInt(partySize, 1, 99, 1));
  return { total, each: Math.floor(total / size) };
}

/* ---------------- classes, Hit Dice ---------------- */

const HIT_DIE = { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, artificer: 8, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, sorcerer: 6, wizard: 6 };

// [{ name, level, die }] from "Fighter 3 / Rogue 1" (the sheet's class and level text); falls back to the record's class and level.
export function classesOf(character) {
  const text = String(character?.sheet?.ClassLevel ?? '');
  const out = [];
  for (const part of text.split(/[\/,&+]/)) {
    const m = part.trim().match(/^([A-Za-z][A-Za-z' -]*?)\s+(\d{1,2})$/);
    if (m) out.push({ name: m[1].trim().toLowerCase(), level: Number(m[2]) });
  }
  if (!out.length) out.push({ name: String(character?.class ?? 'adventurer').trim().toLowerCase(), level: clampInt(character?.level, 1, 20, 1) });
  return out.map((c) => ({ ...c, die: HIT_DIE[c.name.split(/\s+/)[0]] || 8 }));
}
export const totalLevel = (character) => classesOf(character).reduce((n, c) => n + c.level, 0);

/* ---------------- the track record on a character ---------------- */

export const RECHARGES = ['short', 'long'];

// raw -> { hdSpent: {d10: n}, exhaustion 0-6, resources? [{name,max,used,recharge,auto}] }
export function normalizeTrack(raw) {
  const hdSpent = {};
  for (const [k, v] of Object.entries(raw?.hdSpent && typeof raw.hdSpent === 'object' ? raw.hdSpent : {})) if (/^d(4|6|8|10|12)$/.test(k) && clampInt(v, 0, 20) > 0) hdSpent[k] = clampInt(v, 0, 20);
  const out = { hdSpent, exhaustion: clampInt(raw?.exhaustion, 0, 6), noFood: clampInt(raw?.noFood, 0, 99), noWater: clampInt(raw?.noWater, 0, 99) };
  if (Array.isArray(raw?.resources)) {
    out.resources = raw.resources.slice(0, 20).map((r) => {
      const name = clean(r?.name, 40);
      if (!name) return null;
      const max = clampInt(r?.max, 1, 999, 1);
      return { name, max, used: clampInt(r?.used, 0, max), recharge: RECHARGES.includes(r?.recharge) ? r.recharge : 'long', ...(r?.auto ? { auto: true } : {}) };
    }).filter(Boolean);
  }
  return out;
}

export function hitDice(character) {
  const spent = normalizeTrack(character?.track).hdSpent;
  const pools = new Map();
  for (const c of classesOf(character)) pools.set(c.die, (pools.get(c.die) || 0) + c.level);
  const list = [...pools.entries()].sort((a, b) => b[0] - a[0]).map(([die, total]) => {
    const used = Math.min(total, spent[`d${die}`] || 0);
    return { die, total, spent: used, left: total - used };
  });
  return { pools: list, total: list.reduce((n, p) => n + p.total, 0), left: list.reduce((n, p) => n + p.left, 0) };
}

const withTrack = (character, track) => ({ ...character, track });
const conMod = (character) => Math.floor((clampInt(character?.abilities?.con, 1, 30, 10) - 10) / 2);

// Spend `count` Hit Dice on a short rest: each die rolled plus the Constitution modifier (at least 0), healing up to maximum hit points.
// `die` picks a size (8 for d8); otherwise the largest remaining. `roll` is injectable for tests.
export function spendHitDice(character, count, { die = 0, roll = rollDie, rules = '2014' } = {}) {
  const track = normalizeTrack(character.track);
  const maxHp = exhaustionNumbers(track.exhaustion, 0, clampInt(character.maxHp, 1, 999, 1), rules).maxHp;   // exhaustion 4 halves it
  let hp = clampInt(character.hp, 0, maxHp, 0);
  const rolls = [];
  let healed = 0;
  for (let i = 0; i < clampInt(count, 0, 20); i++) {
    const pool = hitDice(withTrack(character, track)).pools.find((p) => p.left > 0 && (!die || p.die === Number(die)));
    if (!pool) break;
    const r = roll(pool.die);
    const gain = Math.max(0, r + conMod(character));
    const real = Math.min(gain, maxHp - hp);
    hp += real;
    healed += real;
    track.hdSpent[`d${pool.die}`] = (track.hdSpent[`d${pool.die}`] || 0) + 1;
    rolls.push({ die: pool.die, roll: r, con: conMod(character), heal: gain });
  }
  const left = hitDice(withTrack(character, track)).left;
  const note = rolls.length ? `${character.name} spends ${rolls.length} Hit Di${rolls.length === 1 ? 'e' : 'ce'} (${rolls.map((x) => `d${x.die}: ${x.roll}${x.con >= 0 ? '+' : ''}${x.con}`).join(', ')}) and heals ${healed}; ${left} left` : `${character.name} has no Hit Dice left`;
  return { character: { ...character, hp, track }, rolls, healed, note };
}

// A long rest regains spent Hit Dice up to half the total (at least one), the largest dice first.
export function regainHitDice(character) {
  const track = normalizeTrack(character.track);
  const info = hitDice(withTrack(character, track));
  let back = Math.max(1, Math.floor(info.total / 2));
  for (const p of info.pools) {
    const give = Math.min(back, p.spent);
    if (give > 0) { track.hdSpent[`d${p.die}`] = p.spent - give; if (!track.hdSpent[`d${p.die}`]) delete track.hdSpent[`d${p.die}`]; back -= give; }
  }
  return track;
}

/* ---------------- exhaustion ---------------- */

export const EXHAUSTION_2014 = ['', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws', 'Hit point maximum halved', 'Speed reduced to 0', 'Death'];
export const exhaustionEffects = (level, rules = '2014') => {
  const n = clampInt(level, 0, 6);
  if (!n) return [];
  if (rules === '2024') return n >= 6 ? ['Death'] : [`-${2 * n} to every d20 Test`, `Speed reduced by ${5 * n} ft`];
  return EXHAUSTION_2014.slice(1, n + 1);
};

// Add (or, negative, remove) exhaustion levels. Level 6 is death.
export function changeExhaustion(character, delta, rules = '2014') {
  const track = normalizeTrack(character.track);
  const was = track.exhaustion;
  track.exhaustion = clampInt(was + Math.round(Number(delta) || 0), 0, 6);
  const dead = track.exhaustion >= 6;
  const note = track.exhaustion === was ? `${character.name} stays at exhaustion ${was}` : dead ? `${character.name} reaches exhaustion 6 and dies` : `${character.name} exhaustion ${was} -> ${track.exhaustion}`;
  const cap = rules !== '2024' && track.exhaustion >= 4 ? Math.max(1, Math.floor((Number(character.maxHp) || 1) / 2)) : Infinity;   // hit points above the new maximum are lost
  const hp = dead ? 0 : Math.min(Number(character.hp) || 0, cap);
  return { character: { ...character, track, hp }, dead, note };
}

/* ---------------- limited-use class resources ---------------- */

const stepBy = (level, steps) => { let v = 0; for (const [at, val] of steps) if (level >= at) v = val; return v; };

// The standard limited-use features of each class (2014), by class level: [{ name, max, recharge }].
export function classResources(cls, character = {}) {
  const L = cls.level;
  const chaMod = Math.max(1, Math.floor((clampInt(character?.abilities?.cha, 1, 30, 10) - 10) / 2));
  const out = [];
  const add = (name, max, recharge) => { if (max > 0) out.push({ name, max, recharge, auto: true }); };
  switch (cls.name.split(/\s+/)[0]) {
    case 'barbarian': add('Rage', L >= 20 ? 99 : stepBy(L, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]), 'long'); break;
    case 'bard': add('Bardic Inspiration', chaMod, L >= 5 ? 'short' : 'long'); break;
    case 'cleric': add('Channel Divinity', stepBy(L, [[2, 1], [6, 2], [18, 3]]), 'short'); break;
    case 'druid': add('Wild Shape', L >= 2 ? 2 : 0, 'short'); break;
    case 'fighter':
      add('Second Wind', 1, 'short');
      add('Action Surge', stepBy(L, [[2, 1], [17, 2]]), 'short');
      add('Indomitable', stepBy(L, [[9, 1], [13, 2], [17, 3]]), 'long');
      break;
    case 'monk': add('Ki points', L >= 2 ? L : 0, 'short'); break;
    case 'paladin': add('Lay on Hands (HP pool)', 5 * L, 'long'); add('Channel Divinity', L >= 3 ? 1 : 0, 'short'); break;
    case 'sorcerer': add('Sorcery points', L >= 2 ? L : 0, 'long'); break;
    case 'wizard': add('Arcane Recovery', 1, 'long'); break;
    default: break;
  }
  return out;
}

// The character's resources: the class defaults (auto ones follow level changes and keep what was used) plus any the DM added.
export function resourcesOf(character) {
  const track = normalizeTrack(character.track);
  const stored = track.resources || [];
  const defaults = classesOf(character).flatMap((c) => classResources(c, character));
  const out = defaults.map((d) => {
    const old = stored.find((r) => r.auto && r.name.toLowerCase() === d.name.toLowerCase());
    return { ...d, used: Math.min(d.max, old ? old.used : 0) };
  });
  for (const r of stored) if (!r.auto) out.push(r);
  return out;
}

// Spend (delta > 0) or regain (delta < 0) uses. A resource that does not exist is created when `max` is given (a feature from a race, subclass or item).
export function changeResource(character, name, delta, { max = 0, recharge = 'long' } = {}) {
  const resources = resourcesOf(character);
  const key = clean(name, 40).toLowerCase();
  let r = resources.find((x) => x.name.toLowerCase() === key) || resources.find((x) => x.name.toLowerCase().startsWith(key) && key.length >= 3);
  if (!r && max > 0 && key) { r = { name: clean(name, 40), max: clampInt(max, 1, 999), used: 0, recharge: RECHARGES.includes(recharge) ? recharge : 'long' }; resources.push(r); }
  if (!r) return { character, ok: false, note: `${character.name} has no resource called "${name}"` };
  const before = r.used;
  r.used = clampInt(r.used + Math.round(Number(delta) || 0), 0, r.max);
  const note = `${character.name}: ${r.name} ${r.max - r.used}/${r.max} left`;
  return { character: { ...character, track: { ...normalizeTrack(character.track), resources } }, ok: r.used !== before || delta === 0, note: r.used === before && delta > 0 ? `${character.name} has no ${r.name} left` : note };
}

/* ---------------- resting ---------------- */

// Apply a rest to a character's track. Short: resources that come back on a short rest. Long: every resource, half the Hit Dice,
// one level of exhaustion. (Hit points and spell slots are restored by restCharacter in lib/party.js.)
export function restTrack(character, kind) {
  const resources = resourcesOf(character).map((r) => (kind === 'long' || r.recharge === 'short' ? { ...r, used: 0 } : r));
  const track = kind === 'long' ? regainHitDice(character) : normalizeTrack(character.track);
  // 2014: a long rest lowers exhaustion by one only if the character has also had food and drink.
  if (kind === 'long' && track.exhaustion > 0 && !track.noFood && !track.noWater) track.exhaustion -= 1;
  track.resources = resources;
  return track;
}

export const SHORT_REST_MINUTES = 60;
export const LONG_REST_MINUTES = 480;

/* ---------------- the game clock ---------------- */

// minute = minutes since Day 1, 00:00. lastLongRestStart = the minute the last long rest began (null = none yet).
export const DEFAULT_CLOCK = { minute: 8 * 60, lastLongRestStart: null };

export function normalizeClock(raw) {
  const lrs = raw?.lastLongRestStart;
  return { minute: clampInt(raw?.minute, 0, 1e9, DEFAULT_CLOCK.minute), lastLongRestStart: lrs === null || lrs === undefined ? null : clampInt(lrs, 0, 1e9, 0) };
}
export const timeOfDay = (hour) => (hour < 5 ? 'night' : hour < 8 ? 'dawn' : hour < 12 ? 'morning' : hour < 14 ? 'midday' : hour < 18 ? 'afternoon' : hour < 21 ? 'evening' : 'night');
export function describeClock(clock) {
  const c = normalizeClock(clock);
  const day = Math.floor(c.minute / 1440) + 1;
  const hour = Math.floor((c.minute % 1440) / 60);
  const min = c.minute % 60;
  return { day, hour, minute: min, text: `Day ${day}, ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} (${timeOfDay(hour)})`, timeOfDay: timeOfDay(hour), minutes: c.minute, lastLongRestStart: c.lastLongRestStart, longRestReady: canLongRest(c).ok, longRestIn: canLongRest(c).waitMinutes };
}
export const advanceClock = (clock, minutes) => { const c = normalizeClock(clock); return { ...c, minute: c.minute + clampInt(minutes, 0, 60 * 24 * 30) }; };
export const setClock = (clock, { day, hour, minute }) => ({ ...normalizeClock(clock), minute: (clampInt(day, 1, 1e6, 1) - 1) * 1440 + clampInt(hour, 0, 23) * 60 + clampInt(minute, 0, 59) });

// One long rest per 24 hours: a new one cannot begin until 24 hours after the last one began.
export function canLongRest(clock) {
  const c = normalizeClock(clock);
  if (c.lastLongRestStart === null) return { ok: true, waitMinutes: 0 };
  const wait = c.lastLongRestStart + 1440 - c.minute;
  return { ok: wait <= 0, waitMinutes: Math.max(0, wait) };
}

// A completed rest on the clock: the new clock (time passes) or a refusal for a second long rest inside 24 hours.
export function restOnClock(clock, kind) {
  const c = normalizeClock(clock);
  if (kind === 'long') {
    const can = canLongRest(c);
    if (!can.ok) return { ok: false, clock: c, note: `Too soon for another long rest: only one counts per 24 hours (about ${Math.ceil(can.waitMinutes / 60)} more hours). No benefit.` };
    return { ok: true, clock: { minute: c.minute + LONG_REST_MINUTES, lastLongRestStart: c.minute }, note: 'Long rest: eight hours pass' };
  }
  return { ok: true, clock: { ...c, minute: c.minute + SHORT_REST_MINUTES }, note: 'Short rest: one hour passes' };
}

const clockFile = (dir) => path.join(dir, 'clock.json');
export async function readClock(dir) {
  try { return normalizeClock(JSON.parse(await readFile(clockFile(dir), 'utf8'))); } catch { return normalizeClock({}); }
}
export async function writeClock(dir, clock) {
  const clean2 = normalizeClock(clock);
  const file = clockFile(dir);
  await writeFile(`${file}.tmp`, JSON.stringify(clean2, null, 2));
  await rename(`${file}.tmp`, file);
  return clean2;
}

/* ---------------- what the party page and the DM see ---------------- */

export function trackView(character, rules = '2014') {
  const sheetXp = Number(String(character?.sheet?.XP ?? '').replace(/[^0-9]/g, ''));
  const xp = Number.isFinite(sheetXp) ? sheetXp : 0;
  const level = totalLevel(character);
  const track = normalizeTrack(character.track);
  const next = xpForNextLevel(level);
  const hd = hitDice(character);
  return {
    xp, level, nextLevelAt: next, xpToNext: next === null ? 0 : Math.max(0, next - xp), levelForXp: levelForXp(xp), readyToLevelUp: level < 20 && levelForXp(xp) > level,
    hitDice: hd,
    exhaustion: track.exhaustion, noFood: track.noFood, noWater: track.noWater, exhaustionEffects: exhaustionEffects(track.exhaustion, rules),
    resources: resourcesOf(character)
  };
}

/* ---------------- exhaustion as numbers ---------------- */

// What an exhaustion level does to speed and maximum hit points, and which d20 rolls suffer (2014 levels; 2024: -5 ft and -2 on d20 Tests per level).
export function exhaustionNumbers(level, speed, maxHp, rules = '2014') {
  const n = clampInt(level, 0, 6);
  const out = { level: n, speed, maxHp, disadvantage: { checks: false, attacks: false, saves: false }, d20Penalty: 0, labels: [] };
  if (!n) return out;
  if (rules === '2024') {
    out.speed = Math.max(0, speed - 5 * n);
    out.d20Penalty = 2 * n;
    out.labels.push(`speed -${5 * n} ft`, `-${2 * n} to d20 Tests`);
  } else {
    out.disadvantage = { checks: n >= 1, attacks: n >= 3, saves: n >= 3 };
    if (n >= 5) { out.speed = 0; out.labels.push('speed 0'); }
    else if (n >= 2) { out.speed = Math.floor(speed / 2); out.labels.push('speed halved'); }
    if (n >= 4) { out.maxHp = Math.max(1, Math.floor(maxHp / 2)); out.labels.push('hit point maximum halved'); }
  }
  if (n >= 6) { out.speed = 0; out.labels.push('dead'); }
  return out;
}

/* ---------------- food and water ---------------- */

// Official 2014 (PHB, Food and Water): a day needs a pound of food and a gallon of water. A character can go 3 + Constitution modifier
// days (at least 1) without food; each further day without food brings one level of exhaustion. Without enough water the DM calls for
// a DC 15 Constitution save and adds a level with the exhaust action on a failure. The table keeps the counters (days since a proper
// meal or drink) so a long rest knows whether the character has been fed and watered.
export const daysWithoutFood = (character) => Math.max(1, 3 + conMod(character));
export function setSupplies(character, kind, days, rules = '2014') {
  const track = normalizeTrack(character.track);
  const key = kind === 'water' ? 'noWater' : 'noFood';
  const was = track[key];
  track[key] = clampInt(days, 0, 99);
  let next = { ...character, track };
  let note = `${character.name}: ${track[key]} day${track[key] === 1 ? '' : 's'} without ${kind === 'water' ? 'water' : 'food'}`;
  if (key === 'noFood') {
    const limit = daysWithoutFood(character);
    const levels = Math.max(0, track.noFood - limit) - Math.max(0, was - limit);
    if (levels > 0) { const out = changeExhaustion(next, levels, rules); next = out.character; note += `; starving: ${out.note}`; }
  }
  return { character: next, note };
}
