// What gear does to the sheet: coins, armor class, attack lines (lib/loadout.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payCoins, tidyCoins, totalCp, armorClass, weaponLine, sheetEditsForGear, srdFor, shopCatalog, costInCp } from '../lib/loadout.js';
import { applyUpdate } from '../lib/sheet-edit.js';

const hero = (cls, abilities, inventory, sheet = {}) => ({ id: 'h', name: 'H', class: cls, level: 1, hp: 10, maxHp: 10, ac: 10, speed: 30, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities }, inventory, sheet: { ClassLevel: `${cls} 1`, ...sheet } });
const item = (name, extra = {}) => ({ name, qty: 1, weight: 1, equipped: true, effects: [], ...extra });

test('paying: smallest coins first, change in big coins, refused when short', () => {
  const r = payCoins({ cp: 5, sp: 3, gp: 20 }, 1250);                    // 12 gp 5 sp
  assert.equal(r.ok, true); assert.equal(totalCp({ cp: 5, sp: 3, gp: 20 }) - 1250, totalCp(r.coins));
  assert.ok(Object.values(r.coins).every((n) => n >= 0));
  const exact = payCoins({ gp: 2, sp: 5 }, 250);
  assert.deepEqual(exact.coins, { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const short = payCoins({ gp: 1 }, 101);
  assert.equal(short.ok, false); assert.match(short.error, /Not enough coin/);
  assert.equal(payCoins({ pp: 1 }, 100).coins.gp, 9, '1 pp pays 1 gp and returns 9 gp');
  assert.deepEqual(tidyCoins({ cp: 25, sp: 12, gp: 3 }), { cp: 5, sp: 4, ep: 0, gp: 4, pp: 0 });
  assert.equal(costInCp({ quantity: 15, unit: 'gp' }), 1500);
});

test('SRD items are found by name however they are written', () => {
  assert.equal(srdFor({ name: 'Chain mail' }).index, 'chain-mail');
  assert.equal(srdFor({ name: 'Handaxe (2)' }).index, 'handaxe');
  assert.equal(srdFor({ name: 'Daggers x2' }).index, 'dagger');
  assert.equal(srdFor({ name: 'Moon-touched blade' }), null);
  assert.equal(srdFor({ name: 'whatever', srd: 'shield' }).index, 'shield');
});

test('armor class: armor, dexterity limits, shield, unarmored defense and warnings', () => {
  assert.equal(armorClass(hero('Fighter', { dex: 14, str: 16 }, [item('Chain mail'), item('Shield')], { ProficienciesLang: 'Armor: all armor, shields.' })).ac, 18);
  assert.equal(armorClass(hero('Rogue', { dex: 17 }, [item('Leather armor')], { ProficienciesLang: 'Armor: light.' })).ac, 14);
  const med = armorClass(hero('Cleric', { dex: 18 }, [item('Scale mail')], { ProficienciesLang: 'Armor: light, medium, shields.' }));
  assert.equal(med.ac, 14 + 2, 'scale mail 14 plus at most +2 Dexterity'); assert.ok(med.warnings.some((w) => /Stealth/.test(w)));
  const weak = armorClass(hero('Fighter', { str: 10 }, [item('Plate')], {}));
  assert.equal(weak.ac, 18); assert.ok(weak.warnings.some((w) => /Strength 15/.test(w)));
  assert.equal(armorClass(hero('Barbarian', { dex: 14, con: 16 }, [])).ac, 10 + 2 + 3);
  assert.equal(armorClass(hero('Monk', { dex: 16, wis: 14 }, [])).ac, 10 + 3 + 2);
  const monkShield = armorClass(hero('Monk', { dex: 16, wis: 14 }, [item('Shield')]));
  assert.equal(monkShield.ac, 10 + 3 + 2); assert.ok(monkShield.warnings.some((w) => /monk loses/i.test(w)));
  assert.equal(armorClass(hero('Wizard', { dex: 14 }, [item('Leather armor', { equipped: false })])).ac, 12, 'armor in the pack does nothing');
  assert.ok(armorClass(hero('Wizard', {}, [item('Chain mail')])).warnings.some((w) => /Not proficient/.test(w)));
});

test('weapon lines: ability, proficiency, finesse and ranged', () => {
  const f = hero('Fighter', { str: 16, dex: 14 }, [], { ProficienciesLang: 'Weapons: simple and martial.' });
  assert.deepEqual([weaponLine(f, srdFor({ name: 'Longsword' })).bonus, weaponLine(f, srdFor({ name: 'Longsword' })).damage], ['+5', '1d8+3 slashing']);
  assert.equal(weaponLine(f, srdFor({ name: 'Rapier' })).bonus, '+5', 'finesse takes the better of Strength and Dexterity');
  const r = hero('Rogue', { str: 8, dex: 17 }, [], { ProficienciesLang: 'Weapons: simple weapons, hand crossbows, longswords, rapiers, shortswords, shortbows.' });
  assert.equal(weaponLine(r, srdFor({ name: 'Shortbow' })).bonus, '+5'); assert.equal(weaponLine(r, srdFor({ name: 'Rapier' })).proficient, true);
  assert.equal(weaponLine(r, srdFor({ name: 'Greataxe' })).proficient, false); assert.equal(weaponLine(r, srdFor({ name: 'Greataxe' })).bonus, '+3'.replace('+3', '-1'));
});

test('changing gear changes the sheet: new armor class, a new attack line, the old one cleared', () => {
  const before = hero('Fighter', { str: 16, dex: 14 }, [item('Leather armor'), item('Longsword')], { AC: '13', ProficienciesLang: 'Armor: all armor, shields. Weapons: simple and martial.', 'Wpn Name': 'Longsword', 'Wpn1 AtkBonus': '+5', 'Wpn1 Damage': '1d8+3 slashing' });
  before.ac = 13;
  const after = JSON.parse(JSON.stringify(before));
  after.inventory = [item('Chain mail'), item('Shield'), item('Rapier'), item('Longsword', { equipped: false })];
  const r = sheetEditsForGear(before, after);
  assert.ok(r.edits.some((e) => e.field === 'ac' && e.value === '18'), 'chain mail and a shield: 13 + 5 = 18 (a +2 Dexterity-less 16 + 2)');
  assert.ok(r.edits.some((e) => e.field === 'Wpn Name' && e.value === ''), 'the unequipped longsword leaves its line');
  assert.ok(r.edits.some((e) => e.field === 'Wpn Name' && e.value === 'Rapier') || r.edits.some((e) => e.value === 'Rapier'));
  const out = applyUpdate(after, { reason: 'Gear', edits: r.edits });
  assert.equal(out.character.ac, 18); assert.equal(out.character.sheet['Wpn Name'], 'Rapier');
  assert.equal(out.character.sheetLog.at(-1).reason, 'Gear');
});

test('the shop lists the SRD gear with prices and the magic items for free', () => {
  const shop = shopCatalog([{ index: 'ring-of-protection', name: 'Ring of Protection', rarity: { name: 'Rare' }, equipment_category: { name: 'Ring' } }]);
  const sword = shop.find((s) => s.name === 'Longsword');
  assert.equal(sword.cp, 1500); assert.equal(sword.group, 'Weapon');
  assert.ok(shop.some((s) => s.group === 'Standard Gear')); assert.equal(shop.find((s) => s.name === 'Ring of Protection').group, 'Magic items');
});

import { before, after } from 'node:test';
import { startServer } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('gear endpoints: shop, paying, preview and commit change the armor class and the sheet, logged', async () => {
  const shop = (await srv.get('/api/party/shop')).json.items;
  assert.ok(shop.some((i) => i.name === 'Chain Mail' && i.cp === 7500) && shop.some((i) => i.group === 'Magic items'));
  assert.equal((await srv.post('/api/party/pay', { coins: { gp: 1 }, cost: 500 })).status, 400);
  assert.equal((await srv.post('/api/party/pay', { coins: { gp: 10 }, cost: 250 })).json.coins.gp, 7);
  const c = (await srv.get('/api/party')).json.characters.find((x) => x.id === ID.edric);
  assert.equal(c.effective.ac, 18);
  const inv = c.inventory.filter((i) => !/chain mail|shield/i.test(i.name));
  const body = { inventory: inv, coins: { ...c.coins, gp: c.coins.gp + 5 }, reason: 'Sold the armor' };
  const prev = (await srv.post(`/api/party/gear/${ID.edric}/preview`, body)).json;
  assert.equal(prev.ac, 12); assert.match(prev.notes.join(' '), /Armor Class 18 → 12/);
  assert.equal((await srv.get('/api/party')).json.characters.find((x) => x.id === ID.edric).effective.ac, 18, 'a preview saves nothing');
  const done = await srv.post(`/api/party/gear/${ID.edric}/commit`, body);
  assert.equal(done.status, 200, done.text);
  const after1 = (await srv.get('/api/party')).json.characters.find((x) => x.id === ID.edric);
  assert.equal(after1.effective.ac, 12); assert.equal(after1.coins.gp, c.coins.gp + 5);
  const sheet = (await srv.get('/api/characters')).json.find((x) => x.id === ID.edric);
  assert.equal(sheet.sheet.AC, '12'); assert.doesNotMatch(sheet.sheet.Equipment, /Chain/); assert.equal(sheet.sheet.GP, String(c.coins.gp + 5));
  assert.equal(sheet.sheetLog.at(-1).reason, 'Sold the armor');
  assert.equal((await srv.post(`/api/party/gear/nobody/preview`, body)).status, 404);
});
