// The party: each character's gear (inventory, coins, attunement) and the shared party stash, plus the stats those items change.
// A character record keeps `inventory` and `coins`; the stash lives in data/campaigns/<id>/party.json. Item effects are applied
// on top of the sheet's own numbers, so the official sheet stays untouched (only its Equipment and coin boxes are kept in step).

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { restTrack } from './rules-track.js';

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const EFFECT_KINDS = ['ac', 'save', 'abilityMin', 'speed'];
export const MAX_ATTUNED = 3;
export const COIN_KEYS = ['cp', 'sp', 'ep', 'gp', 'pp'];
const COIN_FIELDS = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };

const clampInt = (v, lo, hi, dflt = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const nameKey = (v) => clean(v, 80).toLowerCase();

function normalizeEffect(raw) {
  const kind = EFFECT_KINDS.includes(raw?.kind) ? raw.kind : null;
  if (!kind) return null;
  const effect = { kind, value: clampInt(raw?.value, -30, 30, 0) };
  if (kind === 'abilityMin') {
    const ability = String(raw?.ability ?? '').toLowerCase().slice(0, 3);
    if (!ABILITY_KEYS.includes(ability)) return null;
    effect.ability = ability;
    effect.value = clampInt(raw?.value, 1, 30, 10);
  }
  return effect;
}

export function normalizeItem(raw) {
  const name = clean(raw?.name, 80);
  if (!name) return null;
  const weight = Number(raw?.weight);
  const effects = (Array.isArray(raw?.effects) ? raw.effects : []).map(normalizeEffect).filter(Boolean).slice(0, 6);
  const requiresAttunement = Boolean(raw?.requiresAttunement);
  return {
    id: clean(raw?.id, 40).replace(/[^a-z0-9-]/gi, '') || `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    qty: clampInt(raw?.qty, 1, 9999, 1),
    weight: Number.isFinite(weight) ? Math.min(9999, Math.max(0, Math.round(weight * 100) / 100)) : 0,
    requiresAttunement,
    attuned: requiresAttunement && Boolean(raw?.attuned),
    equipped: raw?.equipped !== false,
    effects,
    note: clean(raw?.note, 200)
  };
}

// Returns the cleaned list. At most three items can be attuned; the extras lose it (and `problems` says so).
export function normalizeInventory(list, problems = []) {
  const items = (Array.isArray(list) ? list : []).map(normalizeItem).filter(Boolean).slice(0, 200);
  let attuned = 0;
  for (const it of items) {
    if (!it.attuned) continue;
    attuned += 1;
    if (attuned > MAX_ATTUNED) {
      it.attuned = false;
      problems.push(`${it.name} could not be attuned: only ${MAX_ATTUNED} items can be attuned at once.`);
    }
  }
  return items;
}

export function normalizeCoins(raw) {
  const coins = {};
  for (const k of COIN_KEYS) coins[k] = clampInt(raw?.[k], 0, 99999999, 0);
  return coins;
}

// A character with no inventory yet: take the sheet's Equipment lines and coin boxes as the starting point.
export function seedFromSheet(character) {
  const sheet = character.sheet || {};
  const out = { ...character };
  if (!Array.isArray(character.inventory)) {
    const lines = String(sheet.Equipment ?? '').split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean);
    out.inventory = normalizeInventory(lines.map((name) => ({ name })));
  }
  if (!character.coins) {
    out.coins = normalizeCoins(Object.fromEntries(COIN_KEYS.map((k) => [k, sheet[COIN_FIELDS[k]]])));
  }
  return out;
}

const worksNow = (it) => it.equipped !== false && (!it.requiresAttunement || it.attuned);

// The numbers that matter at the table: the sheet's own values plus what attuned/worn items change, with the working shown.
// variant = the optional encumbrance rule (encumbered over Strength x 5, heavily over x 10). The standard rule only has the carrying capacity, Strength x 15.
export function computeEffective(character, variant = false) {
  const inv = Array.isArray(character.inventory) ? character.inventory : [];
  const live = inv.filter(worksNow);
  const base = { ac: Number(character.ac) || 10, speed: Number(character.speed) || 30 };
  const abilities = {};
  for (const k of ABILITY_KEYS) abilities[k] = Number(character.abilities?.[k]) || 10;

  const breakdown = { ac: [{ label: 'Sheet', value: base.ac }], speed: [{ label: 'Sheet', value: base.speed }], saves: [], abilities: {} };
  let ac = base.ac, speed = base.speed, saveBonus = 0;
  const effAbilities = { ...abilities };
  for (const it of live) {
    for (const e of it.effects || []) {
      if (e.kind === 'ac') { ac += e.value; breakdown.ac.push({ label: it.name, value: e.value }); }
      else if (e.kind === 'speed') { speed += e.value; breakdown.speed.push({ label: it.name, value: e.value }); }
      else if (e.kind === 'save') { saveBonus += e.value; breakdown.saves.push({ label: it.name, value: e.value }); }
      else if (e.kind === 'abilityMin' && e.value > effAbilities[e.ability]) {
        effAbilities[e.ability] = e.value;
        breakdown.abilities[e.ability] = it.name;
      }
    }
  }

  const coins = normalizeCoins(character.coins);
  const coinCount = COIN_KEYS.reduce((n, k) => n + coins[k], 0);
  const carried = Math.round((inv.reduce((n, it) => n + it.qty * it.weight, 0) + coinCount / 50) * 100) / 100;
  const str = effAbilities.str;
  let status = 'normal';
  if (carried > str * 15) status = 'over capacity';
  else if (variant && carried > str * 10) status = 'heavily encumbered';
  else if (variant && carried > str * 5) status = 'encumbered';

  return {
    ac, speed, saveBonus, abilities: effAbilities, breakdown,
    attuned: inv.filter((it) => it.attuned).map((it) => it.name),
    maxAttuned: MAX_ATTUNED,
    weight: { carried, capacity: str * 15, encumberedAt: str * 5, heavilyAt: str * 10, status, variant: Boolean(variant) }
  };
}

// Keep the official sheet's Equipment and coin boxes in step with the inventory (the inventory is the source of truth).
export function syncSheet(character) {
  const sheet = { ...(character.sheet || {}) };
  const inv = Array.isArray(character.inventory) ? character.inventory : [];
  sheet.Equipment = inv.map((it) => `${it.name}${it.qty > 1 ? ` x${it.qty}` : ''}${it.attuned ? ' (attuned)' : ''}`).join('\n');
  const coins = normalizeCoins(character.coins);
  for (const k of COIN_KEYS) sheet[COIN_FIELDS[k]] = String(coins[k]);
  return { ...character, sheet };
}

// What the common SRD magic items do to the numbers (the SRD gives descriptions, not data). Anything not listed has no effect here.
const SRD_ITEM_EFFECTS = {
  'ring-of-protection': [{ kind: 'ac', value: 1 }, { kind: 'save', value: 1 }],
  'cloak-of-protection': [{ kind: 'ac', value: 1 }, { kind: 'save', value: 1 }],
  'ioun-stone-of-protection': [{ kind: 'ac', value: 1 }],
  'armor-1': [{ kind: 'ac', value: 1 }], 'armor-2': [{ kind: 'ac', value: 2 }], 'armor-3': [{ kind: 'ac', value: 3 }],
  'gauntlets-of-ogre-power': [{ kind: 'abilityMin', ability: 'str', value: 19 }],
  'headband-of-intellect': [{ kind: 'abilityMin', ability: 'int', value: 19 }],
  'amulet-of-health': [{ kind: 'abilityMin', ability: 'con', value: 19 }],
  'belt-of-giant-strength-hill': [{ kind: 'abilityMin', ability: 'str', value: 21 }],
  'belt-of-giant-strength-stone': [{ kind: 'abilityMin', ability: 'str', value: 23 }],
  'belt-of-giant-strength-frost': [{ kind: 'abilityMin', ability: 'str', value: 23 }],
  'belt-of-giant-strength-fire': [{ kind: 'abilityMin', ability: 'str', value: 25 }],
  'belt-of-giant-strength-cloud': [{ kind: 'abilityMin', ability: 'str', value: 27 }],
  'belt-of-giant-strength-storm': [{ kind: 'abilityMin', ability: 'str', value: 29 }]
};

// A party item made from an SRD entry. Magic items know whether they need attunement and, for the common ones, what they do; equipment brings its weight.
export function itemFromSrd(kind, entry) {
  if (!entry) return null;
  if (kind === 'equipment') return normalizeItem({ name: entry.name, qty: 1, weight: entry.weight ?? 0, note: entry.equipment_category?.name || '' });
  const first = String(entry.desc?.[0] ?? '');
  return normalizeItem({
    name: entry.name, qty: 1, weight: 0,
    requiresAttunement: /requires attunement/i.test(first),
    effects: SRD_ITEM_EFFECTS[entry.index] || [],
    note: [entry.rarity?.name, entry.equipment_category?.name].filter(Boolean).join(' ')
  });
}

/* ---------------- resting ---------------- */

// A rest for one character. A long rest restores all hit points and every spell slot; a short rest changes no numbers here
// (hit dice are spent through healing in the combat tracker). Returns the changed character and a note for the chat.
// A long rest (official 5e): all hit points back and every spell slot restored. A short rest changes no numbers here: characters spend
// Hit Dice to heal (spendHitDice in lib/rules-track.js).
export function restCharacter(character, kind) {
  // Hit Dice, exhaustion and class resources are in lib/rules-track.js (restTrack): a short rest restores short-rest features, a long rest everything.
  if (kind !== 'long') return { character: { ...character, track: restTrack(character, 'short') }, note: `${character.name} finishes a short rest` };
  const out = { ...character, hp: Number(character.maxHp) || character.hp, track: restTrack(character, 'long') };
  const sheet = { ...(character.sheet || {}) };
  if (Object.keys(sheet).length) {
    sheet.HPCurrent = String(out.hp);
    for (let level = 1; level <= 9; level++) {
      const total = sheet[`SlotsTotal ${18 + level}`];
      if (total !== undefined && String(total).trim() !== '') sheet[`SlotsRemaining ${18 + level}`] = String(total);
    }
    out.sheet = sheet;
  }
  return { character: out, note: `${character.name} is fully rested` };
}

/* ---------------- the stash (data/campaigns/<id>/party.json) ---------------- */

const stashFile = (dir) => path.join(dir, 'party.json');
const queues = new Map();
function queued(dir, job) {
  const next = (queues.get(dir) || Promise.resolve()).then(job, job);
  queues.set(dir, next.catch(() => {}));
  return next;
}

export function normalizeStash(raw) {
  return { items: normalizeInventory((Array.isArray(raw?.items) ? raw.items : []).map((i) => ({ ...i, attuned: false }))), coins: normalizeCoins(raw?.coins) };
}

export async function readStash(dir) {
  try {
    return normalizeStash(JSON.parse(await readFile(stashFile(dir), 'utf8')));
  } catch {
    return normalizeStash({});
  }
}

export function writeStash(dir, stash) {
  return queued(dir, async () => {
    const clean = normalizeStash(stash);
    const file = stashFile(dir);
    await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, ...clean }, null, 2));
    await rename(`${file}.tmp`, file);
    return clean;
  });
}

/* ---------------- updates from the AI (and the party page) ---------------- */

const TARGET_STASH = 'stash';

// Apply the DM's gear updates. `store` supplies: list() -> characters, save(character) -> saved character, stash() / saveStash(stash).
// Returns { notes (for the chat), problems, changed (character ids and/or 'stash') }.
export async function processPartyUpdates(updates, store) {
  const notes = [];
  const problems = [];
  const changed = new Set();
  if (!updates.length) return { notes, problems, changed: [] };

  // A hand-edited record may have partial coins or items with no quantity: clean both so the arithmetic below never meets undefined.
  const characters = new Map((await store.list()).map((c) => { const s = seedFromSheet(c); return [c.id, { ...s, inventory: normalizeInventory(s.inventory), coins: normalizeCoins(s.coins) }]; }));
  let stash = await store.stash();

  const resolve = (target) => {
    const t = String(target ?? '').trim();
    if (t.toLowerCase() === TARGET_STASH) return { kind: 'stash', label: 'the party stash', items: stash.items, coins: stash.coins };
    const c = characters.get(t) || [...characters.values()].find((x) => x.name.toLowerCase() === t.toLowerCase());
    if (!c) return null;
    return { kind: 'character', id: c.id, label: c.name, character: c, items: c.inventory, coins: c.coins };
  };
  const find = (items, name) => items.find((i) => nameKey(i.name) === nameKey(name));
  const touch = (dest) => changed.add(dest.kind === 'stash' ? TARGET_STASH : dest.id);

  for (const u of updates) {
    if (!u) continue;
    if (u.type === 'addItem') {
      const dest = resolve(u.target);
      const item = normalizeItem({ ...u, attuned: false });
      if (!dest || !item) { problems.push(`The DM tried to add "${u.name ?? ''}" to someone who is not in the party.`); continue; }
      const have = find(dest.items, item.name);
      if (have) have.qty = Math.min(9999, have.qty + item.qty);
      else dest.items.push(item);
      touch(dest);
      notes.push(`${dest.label} gained ${item.name}${item.qty > 1 ? ` x${item.qty}` : ''}`);
    } else if (u.type === 'removeItem') {
      const dest = resolve(u.target);
      const have = dest && find(dest.items, u.name);
      if (!have) { problems.push(`The DM tried to remove "${u.name ?? ''}", which ${dest ? dest.label + ' does not have' : 'nobody has'}.`); continue; }
      const qty = Math.min(have.qty, clampInt(u.qty, 1, 9999, 1));
      if (qty >= have.qty) dest.items.splice(dest.items.indexOf(have), 1); else have.qty -= qty;
      touch(dest);
      notes.push(`${dest.label} lost ${have.name}${qty > 1 ? ` x${qty}` : ''}`);
    } else if (u.type === 'attuneItem' || u.type === 'unattuneItem') {
      const dest = resolve(u.characterId);
      const have = dest && dest.kind === 'character' && find(dest.items, u.name);
      if (!have) { problems.push(`The DM tried to change attunement on "${u.name ?? ''}", which that character does not carry.`); continue; }
      if (!have.requiresAttunement) { problems.push(`${have.name} does not need attunement.`); continue; }
      if (u.type === 'attuneItem') {
        if (!have.attuned && dest.items.filter((i) => i.attuned).length >= MAX_ATTUNED) { problems.push(`${dest.label} is already attuned to ${MAX_ATTUNED} items, so ${have.name} could not be attuned.`); continue; }
        have.attuned = true;
        notes.push(`${dest.label} attuned to ${have.name}`);
      } else {
        have.attuned = false;
        notes.push(`${dest.label} is no longer attuned to ${have.name}`);
      }
      touch(dest);
    } else if (u.type === 'moveItem') {
      const from = resolve(u.from), to = resolve(u.to);
      const have = from && find(from.items, u.name);
      if (!from || !to || !have) { problems.push(`The DM tried to move "${u.name ?? ''}" but the item or the people could not be found.`); continue; }
      const qty = Math.min(have.qty, clampInt(u.qty, 1, 9999, 1));
      const copy = { ...have, qty, attuned: false, id: undefined };
      const there = find(to.items, have.name);
      if (there) there.qty = Math.min(9999, there.qty + qty); else to.items.push(normalizeItem(copy));
      if (qty >= have.qty) from.items.splice(from.items.indexOf(have), 1); else have.qty -= qty;
      touch(from); touch(to);
      notes.push(`${have.name}${qty > 1 ? ` x${qty}` : ''} moved from ${from.label} to ${to.label}`);
    } else if (u.type === 'adjustCoins') {
      const dest = resolve(u.target);
      if (!dest) { problems.push('The DM tried to change coins for someone who is not in the party.'); continue; }
      const parts = [];
      for (const k of COIN_KEYS) {
        const d = clampInt(u[k], -99999999, 99999999, 0);
        if (!d) continue;
        if (dest.coins[k] + d < 0) { problems.push(`${dest.label} does not have ${-d} ${k}.`); continue; }
        dest.coins[k] += d;
        parts.push(`${d > 0 ? '+' : ''}${d} ${k}`);
      }
      if (parts.length) { touch(dest); notes.push(`${dest.label}: ${parts.join(', ')}`); }
    }
  }

  for (const id of changed) {
    if (id === TARGET_STASH) { stash = await store.saveStash(stash); continue; }
    const c = characters.get(id);
    c.inventory = normalizeInventory(c.inventory, problems);
    await store.save(syncSheet(c));
  }
  return { notes, problems, changed: [...changed] };
}
