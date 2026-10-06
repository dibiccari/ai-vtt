// lib/party.js: normalising gear, effective stats, attunement, encumbrance, rests and the DM's gear updates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeItem, normalizeInventory, normalizeCoins, seedFromSheet, computeEffective, syncSheet, restCharacter, itemFromSrd, readStash, writeStash, processPartyUpdates, MAX_ATTUNED } from '../lib/party.js';

const hero = (extra = {}) => ({
  id: 'hero', name: 'Hero', ac: 14, speed: 30, hp: 5, maxHp: 20, abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  inventory: [], coins: {}, ...extra
});
const ring = (over = {}) => ({ name: 'Ring of Protection', requiresAttunement: true, attuned: true, effects: [{ kind: 'ac', value: 1 }, { kind: 'save', value: 1 }], ...over });

test('normalizeItem cleans fields and refuses nameless items', () => {
  assert.equal(normalizeItem({ name: '  ' }), null);
  const it = normalizeItem({ name: 'Rope', qty: -4, weight: 10.567, attuned: true });
  assert.equal(it.qty, 1); assert.equal(it.weight, 10.57); assert.equal(it.attuned, false, 'cannot be attuned unless it requires attunement');
  assert.ok(it.id);
});

test('effects: abilityMin needs a real ability, unknown kinds are dropped', () => {
  const it = normalizeItem({ name: 'Gauntlets', effects: [{ kind: 'abilityMin', ability: 'str', value: 19 }, { kind: 'abilityMin', ability: 'luck', value: 5 }, { kind: 'wish', value: 1 }, { kind: 'ac', value: 99 }] });
  assert.deepEqual(it.effects.map((e) => e.kind), ['abilityMin', 'ac']);
  assert.equal(it.effects[1].value, 30, 'values are clamped');
});

test('only three items can stay attuned', () => {
  const problems = [];
  const inv = normalizeInventory([1, 2, 3, 4].map((n) => ring({ name: `Ring ${n}` })), problems);
  assert.equal(MAX_ATTUNED, 3);
  assert.equal(inv.filter((i) => i.attuned).length, 3);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Ring 4/);
});

test('normalizeCoins clamps and fills every coin', () => {
  assert.deepEqual(normalizeCoins({ gp: '12', cp: -5, pp: 'x' }), { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 });
});

test('seedFromSheet takes Equipment lines and coin boxes when there is no inventory', () => {
  const s = seedFromSheet({ sheet: { Equipment: 'Dagger\nRope; Torch', GP: '15', SP: '3' } });
  assert.deepEqual(s.inventory.map((i) => i.name), ['Dagger', 'Rope', 'Torch']);
  assert.equal(s.coins.gp, 15); assert.equal(s.coins.sp, 3);
  const keep = seedFromSheet({ inventory: [], coins: { gp: 1 }, sheet: { Equipment: 'Ignored' } });
  assert.deepEqual(keep.inventory, []);
});

test('computeEffective: worn attuned items count, unattuned and unequipped ones do not, with the working shown', () => {
  const c = hero({ inventory: [ring(), ring({ name: 'Cursed ring', attuned: false }), { ...normalizeItem({ name: 'Shield', effects: [{ kind: 'ac', value: 2 }] }), equipped: false }, normalizeItem({ name: 'Boots of Speed', effects: [{ kind: 'speed', value: 10 }] })] });
  const e = computeEffective(c);
  assert.equal(e.ac, 15); assert.equal(e.saveBonus, 1); assert.equal(e.speed, 40);
  assert.deepEqual(e.breakdown.ac.map((b) => b.label), ['Sheet', 'Ring of Protection']);
  assert.deepEqual(e.attuned, ['Ring of Protection']);
});

test('computeEffective: abilityMin raises low scores only', () => {
  const gaunt = normalizeItem({ name: 'Gauntlets of Ogre Power', effects: [{ kind: 'abilityMin', ability: 'str', value: 19 }] });
  assert.equal(computeEffective(hero({ inventory: [gaunt] })).abilities.str, 19);
  assert.equal(computeEffective(hero({ abilities: { str: 20, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory: [gaunt] })).abilities.str, 20);
});

test('encumbrance: standard rule has only capacity (Str x 15), the variant adds x5 and x10', () => {
  const load = (lb) => hero({ inventory: [normalizeItem({ name: 'Anvil', weight: lb })] });
  assert.equal(computeEffective(load(100)).weight.status, 'normal');
  assert.equal(computeEffective(load(100), true).weight.status, 'encumbered');        // over 50
  assert.equal(computeEffective(load(120), true).weight.status, 'heavily encumbered'); // over 100
  assert.equal(computeEffective(load(151)).weight.status, 'over capacity');
  assert.equal(computeEffective(load(0)).weight.capacity, 150);
});

test('coins weigh 50 to the pound', () => {
  assert.equal(computeEffective(hero({ coins: { gp: 100 } })).weight.carried, 2);
});

test('syncSheet writes the inventory and coins onto the sheet', () => {
  const c = syncSheet(hero({ inventory: [normalizeItem({ name: 'Arrow', qty: 20 }), ring()], coins: { gp: 7, pp: 1 } }));
  assert.match(c.sheet.Equipment, /Arrow x20/); assert.match(c.sheet.Equipment, /Ring of Protection \(attuned\)/);
  assert.equal(c.sheet.GP, '7'); assert.equal(c.sheet.PP, '1');
});

test('long rest restores hit points and spell slots; short rest changes nothing', () => {
  const c = hero({ sheet: { HPCurrent: '5', 'SlotsTotal 19': '4', 'SlotsRemaining 19': '1', 'SlotsTotal 20': '2', 'SlotsRemaining 20': '0' } });
  const short = restCharacter(c, 'short');
  assert.equal(short.character.hp, 5); assert.match(short.note, /Hero finishes a short rest/);
  const long = restCharacter(c, 'long');
  assert.equal(long.character.hp, 20); assert.equal(long.character.sheet.HPCurrent, '20');
  assert.equal(long.character.sheet['SlotsRemaining 19'], '4'); assert.equal(long.character.sheet['SlotsRemaining 20'], '2');
  assert.match(long.note, /Hero is fully rested/);
  assert.equal(c.hp, 5, 'the original is not mutated');
});

test('itemFromSrd: attunement from the description, effects from the table, weight from equipment', () => {
  const magic = itemFromSrd('magic-items', { index: 'ring-of-protection', name: 'Ring of Protection', desc: ['Wondrous item, rare (requires attunement)'], rarity: { name: 'Rare' } });
  assert.equal(magic.requiresAttunement, true);
  assert.deepEqual(magic.effects.map((e) => e.kind).sort(), ['ac', 'save']);
  const gear = itemFromSrd('equipment', { name: 'Rope, hempen (50 feet)', weight: 10, equipment_category: { name: 'Adventuring Gear' } });
  assert.equal(gear.weight, 10);
  assert.equal(itemFromSrd('equipment', null), null);
});

async function withStore(chars, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-party-'));
  try {
    const list = chars.map((c) => structuredClone(c));
    const store = {
      list: async () => list,
      save: async (c) => { list[list.findIndex((x) => x.id === c.id)] = c; return c; },
      stash: () => readStash(dir),
      saveStash: (s) => writeStash(dir, s)
    };
    return await fn(store, list, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('gear updates: add, stack, remove, move to the stash, coins, attunement rules', async () => {
  await withStore([hero({ inventory: [normalizeItem({ name: 'Rope', qty: 2 })], coins: normalizeCoins({ gp: 5 }) }), hero({ id: 'sam', name: 'Sam' })], async (store, list) => {
    let r = await processPartyUpdates([{ type: 'addItem', target: 'hero', name: 'Rope', qty: 3 }, { type: 'addItem', target: 'Sam', name: 'Potion', qty: 1 }], store);
    assert.deepEqual(r.problems, []);
    assert.equal(list[0].inventory.find((i) => i.name === 'Rope').qty, 5);
    assert.equal(list[1].inventory[0].name, 'Potion');
    assert.match(list[0].sheet.Equipment, /Rope x5/, 'the sheet is kept in step');

    r = await processPartyUpdates([{ type: 'removeItem', target: 'hero', name: 'Rope', qty: 2 }, { type: 'removeItem', target: 'hero', name: 'Unicorn' }, { type: 'addItem', target: 'nobody', name: 'X' }], store);
    assert.equal(list[0].inventory[0].qty, 3);
    assert.equal(r.problems.length, 2);

    r = await processPartyUpdates([{ type: 'moveItem', from: 'hero', to: 'stash', name: 'Rope', qty: 3 }], store);
    assert.equal(list[0].inventory.length, 0);
    assert.equal((await store.stash()).items[0].qty, 3);
    assert.ok(r.changed.includes('stash') && r.changed.includes('hero'));

    r = await processPartyUpdates([{ type: 'adjustCoins', target: 'hero', gp: -3, sp: 10 }, { type: 'adjustCoins', target: 'hero', gp: -100 }], store);
    assert.equal(list[0].coins.gp, 2); assert.equal(list[0].coins.sp, 10);
    assert.equal(r.problems.length, 1, 'cannot go below zero');
  });
});

test('gear updates: attune needs an item that requires it and respects the limit of three', async () => {
  const items = [1, 2, 3, 4].map((n) => normalizeItem({ name: `Charm ${n}`, requiresAttunement: true })).concat([normalizeItem({ name: 'Plain' })]);
  await withStore([hero({ inventory: items })], async (store, list) => {
    const r = await processPartyUpdates(['Charm 1', 'Charm 2', 'Charm 3', 'Charm 4', 'Plain'].map((name) => ({ type: 'attuneItem', characterId: 'hero', name })), store);
    assert.equal(list[0].inventory.filter((i) => i.attuned).length, 3);
    assert.equal(r.problems.length, 2);
    await processPartyUpdates([{ type: 'unattuneItem', characterId: 'hero', name: 'Charm 1' }, { type: 'attuneItem', characterId: 'hero', name: 'Charm 4' }], store);
    assert.deepEqual(list[0].inventory.filter((i) => i.attuned).map((i) => i.name).sort(), ['Charm 2', 'Charm 3', 'Charm 4']);
  });
});

test('the stash never keeps attunement', async () => {
  await withStore([], async (_s, _l, dir) => {
    await writeStash(dir, { items: [{ name: 'Ring', requiresAttunement: true, attuned: true }], coins: { gp: 3 } });
    const s = await readStash(dir);
    assert.equal(s.items[0].attuned, false); assert.equal(s.coins.gp, 3);
  });
});
