// Hardening of the gear rules added in Nov 2026: magic bonuses read from names, the heavy-armor speed penalty with effective Strength, what the Party page shows,
// and giving items between characters. Pure checks first, then a sandboxed server. Tests build their own characters' gear: no literals about the user's real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';
import { magicBonus, srdFor, armorClass, wornArmorSpeedPenalty } from '../lib/loadout.js';
import { computeEffective } from '../lib/party.js';

const hero = (inventory, abilities = {}, extra = {}) => ({ id: 'h', name: 'H', class: 'Fighter', level: 1, hp: 10, maxHp: 10, ac: 10, speed: 30, abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10, ...abilities }, inventory, sheet: { ClassLevel: 'Fighter 1' }, ...extra });
const it = (name, extra = {}) => ({ name, qty: 1, weight: 1, equipped: true, effects: [], ...extra });

test('magicBonus reads +1 to +3 as its own token in a name, and nothing else', () => {
  const b = (name) => magicBonus({ name });
  assert.equal(b('Chain Mail +1'), 1); assert.equal(b('+2 Shield'), 2); assert.equal(b('Shield, +3'), 3); assert.equal(b('Longsword (+1)'), 1);
  for (const name of ['Plus 1 sword', '+4 shield', 'Shield +10', 'Dagger+1', 'Sword of Sharpness', 'Rope (50 ft) +0', '', 'Boots +11']) assert.equal(b(name), 0, `"${name}" has no bonus`);
  assert.equal(magicBonus(null), 0); assert.equal(magicBonus({}), 0);
});

test('a bonus in the name never makes a non-armor item armor, and the SRD match ignores the bonus', () => {
  assert.equal(srdFor({ name: 'Ring of Protection +1' }), null, 'a ring is not armor');
  assert.equal(srdFor({ name: 'Shield +2' }).index, 'shield'); assert.equal(srdFor({ name: 'Chain Mail +1' }).index, 'chain-mail');
  const ringOnly = hero([it('Ring of Protection +1')]);
  assert.equal(armorClass(ringOnly).ac, 12, 'a +1 ring is not worn as armor: 10 + Dex 2');
  assert.equal(armorClass(ringOnly).body, '');
  const shieldAndRing = hero([it('+1 Shield'), it('Ring of Protection +1')]);
  assert.equal(armorClass(shieldAndRing).ac, 10 + 2 + 2 + 1, 'only the shield counts, with its bonus');
  assert.equal(armorClass(hero([it('Plate Armor +1', { equipped: false })])).ac, 12, 'armor in the pack gives nothing');
});

test('armor class: bonus counted once per piece; a magic breastplate still caps medium armor Dexterity at +2', () => {
  const c = hero([it('Breastplate +1'), it('Shield +2')], { dex: 18 });
  assert.equal(armorClass(c).ac, 14 + 2 + 1 + 2 + 2, 'breastplate 14 + Dex capped at 2 + 1 magic, shield 2 + 2 magic');
});

test('heavy armor without the Strength minimum costs 10 ft; effective Strength (a passed value) can lift it', () => {
  const plate = hero([it('Plate Armor')], { str: 10 });
  assert.deepEqual(wornArmorSpeedPenalty(plate), { feet: 10, armor: 'Plate Armor', needs: 15 });
  assert.equal(wornArmorSpeedPenalty(plate, 15), null, 'Strength 15 is enough');
  assert.equal(wornArmorSpeedPenalty(plate, 14).feet, 10);
  assert.equal(wornArmorSpeedPenalty({ ...plate, inventory: [it('Plate Armor', { equipped: false })] }), null, 'armor in the pack costs nothing');
  assert.equal(wornArmorSpeedPenalty(hero([it('Chain Mail')], { str: 10 })).needs, 13);
  assert.equal(wornArmorSpeedPenalty(hero([it('Leather Armor')], { str: 3 })), null, 'light armor has no minimum');
  assert.equal(wornArmorSpeedPenalty(hero([it('Shield')], { str: 3 })), null, 'a shield is not body armor');
  assert.equal(wornArmorSpeedPenalty(hero([it('Plate Armor')], { str: 10 }), NaN).feet, 10, 'a bad Strength falls back to the sheet');
});

test('computeEffective: gauntlets of ogre power lift Strength for the armor minimum only while worn and attuned, and the working is shown', () => {
  const gauntlets = (attuned, equipped = true) => it('Gauntlets of Ogre Power', { requiresAttunement: true, attuned, equipped, effects: [{ kind: 'abilityMin', ability: 'str', value: 19 }] });
  const base = [it('Plate Armor')];
  let e = computeEffective(hero(base, { str: 8 }));
  assert.equal(e.speed, 20); assert.deepEqual(e.breakdown.speed.map((b) => b.value), [30, -10]); assert.match(e.breakdown.speed[1].label, /Plate Armor needs Strength 15/);
  e = computeEffective(hero([...base, gauntlets(false)], { str: 8 }));
  assert.equal(e.speed, 20, 'not attuned: no help'); assert.equal(e.abilities.str, 8);
  e = computeEffective(hero([...base, gauntlets(true)], { str: 8 }));
  assert.equal(e.speed, 30, 'attuned: Strength 19, no penalty'); assert.equal(e.abilities.str, 19); assert.equal(e.breakdown.abilities.str, 'Gauntlets of Ogre Power'); assert.equal(e.breakdown.speed.length, 1);
  e = computeEffective(hero([...base, gauntlets(true, false)], { str: 8 }));
  assert.equal(e.speed, 20, 'in the pack: no help');
  e = computeEffective(hero([...base, gauntlets(true)], { str: 20 }));
  assert.equal(e.abilities.str, 20, 'a higher Strength is never lowered');
});

test('computeEffective: speed items and the armor penalty add up, and speed never goes below zero', () => {
  const boots = it('Boots of Speed', { effects: [{ kind: 'speed', value: 10 }] });
  assert.equal(computeEffective(hero([it('Plate Armor'), boots], { str: 10 })).speed, 30);
  assert.equal(computeEffective(hero([it('Plate Armor')], { str: 10 }, { speed: 5 })).speed, 0, 'a speed of 5 in armor that is too heavy is 0, not -5');
  assert.equal(computeEffective(hero([it('Anvil Boots', { effects: [{ kind: 'speed', value: -30 }] })], {}, { speed: 25 })).speed, 0);
});

let s;
before(async () => { s = await startServer(); await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' }); });
after(async () => { if (s) await s.stop(); });
const putGear = async (id, inventory) => { const r = await s.put('/api/party/characters/' + id, { inventory, coins: {} }); assert.equal(r.status, 200, r.text); };
const character = async (id) => (await s.get('/api/characters')).json.find((c) => c.id === id);
const named = (c, name) => (c.inventory || []).find((i) => i.name === name);

test('GET /api/characters gives effSpeed only when heavy armor or items change the speed', async () => {
  await putGear(ID.rachel, [it('Plate Armor', { weight: 65 })]);
  const heavy = await character(ID.rachel);
  assert.equal(heavy.effSpeed, heavy.speed - 10, 'the sheet speed stays, effSpeed has the penalty');
  const gauntlets = it('Gauntlets of Ogre Power', { requiresAttunement: true, attuned: true, effects: [{ kind: 'abilityMin', ability: 'str', value: 19 }] });
  await putGear(ID.rachel, [it('Plate Armor', { weight: 65 }), gauntlets]);
  assert.equal((await character(ID.rachel)).effSpeed, undefined, 'the gauntlets cancel the penalty: nothing to report');
  const view = (await s.get('/api/party')).json.characters.find((c) => c.id === ID.rachel);
  assert.equal(view.effective.abilities.str, 19); assert.equal(view.effective.speed, view.speed ?? view.effective.speed);
  await putGear(ID.rachel, [it('Plate Armor', { weight: 65, equipped: false })]);
  assert.equal((await character(ID.rachel)).effSpeed, undefined, 'armor in the pack');
});

test('give: attunement is lost on the way, partial stacks split, a stack merges with the same name, and quantities are clamped', async () => {
  const cloak = it('Cloak of Protection', { requiresAttunement: true, attuned: true, effects: [{ kind: 'ac', value: 1 }, { kind: 'save', value: 1 }] });
  await putGear(ID.edric, [cloak, it('Dagger', { qty: 5 })]);
  await putGear(ID.rachel, [it('Dagger', { qty: 1 })]);
  let r = await s.post('/api/party/give', { from: ID.edric, to: ID.rachel, name: 'Cloak of Protection', qty: 1 });
  assert.equal(r.status, 200, r.text);
  assert.equal(named(await character(ID.edric), 'Cloak of Protection'), undefined);
  const moved = named(await character(ID.rachel), 'Cloak of Protection');
  assert.ok(moved && moved.attuned === false && moved.requiresAttunement === true && moved.effects.length === 2, 'attunement is lost, the effects stay');
  r = await s.post('/api/party/give', { from: ID.edric, to: ID.rachel, name: 'dagger', qty: 2 });
  assert.equal(r.status, 200); assert.equal(named(await character(ID.edric), 'Dagger').qty, 3); assert.equal(named(await character(ID.rachel), 'Dagger').qty, 3, 'it merged into her stack');
  r = await s.post('/api/party/give', { from: ID.edric, to: ID.rachel, name: 'Dagger', qty: 99 });
  assert.equal(r.status, 200); assert.equal(named(await character(ID.edric), 'Dagger'), undefined, 'more than he has gives all he has'); assert.equal(named(await character(ID.rachel), 'Dagger').qty, 6);
  r = await s.post('/api/party/give', { from: ID.rachel, to: ID.edric, name: 'Dagger', qty: -4 });
  assert.equal(r.status, 200); assert.equal(named(await character(ID.edric), 'Dagger').qty, 1, 'a negative number counts as one');
});

test('give: to oneself, to nobody, from nobody, an empty name and a missing item are all refused and change nothing', async () => {
  await putGear(ID.edric, [it('Dagger', { qty: 2 })]);
  const before = JSON.stringify((await character(ID.edric)).inventory);
  for (const body of [{ from: ID.edric, to: ID.edric, name: 'Dagger' }, { from: ID.edric, to: 'Nobody At All', name: 'Dagger' }, { from: 'Nobody At All', to: ID.edric, name: 'Dagger' }, { from: ID.edric, to: 'stash', name: '' }, { from: ID.edric, to: ID.rachel, name: 'Vorpal Sword' }, { from: 'stash', to: ID.rachel, name: 'Dagger' }, { to: ID.rachel, name: 'Dagger' }, {}]) {
    const r = await s.post('/api/party/give', body);
    assert.equal(r.status, 400, JSON.stringify(body) + ' -> ' + r.text);
  }
  assert.equal(JSON.stringify((await character(ID.edric)).inventory), before);
});

test('give: a character can be named instead of using the id, and the stash round trip keeps the item', async () => {
  await putGear(ID.edric, [it('Dagger', { qty: 2 })]);
  const name = (await character(ID.rachel)).name;
  let r = await s.post('/api/party/give', { from: ID.edric, to: name.toUpperCase(), name: 'Dagger', qty: 1 });
  assert.equal(r.status, 200, r.text);
  r = await s.post('/api/party/give', { from: ID.edric, to: 'stash', name: 'Dagger', qty: 1 });
  assert.equal(r.status, 200); assert.equal(named(await character(ID.edric), 'Dagger'), undefined);
  assert.equal((await s.get('/api/party')).json.stash.items.find((i) => i.name === 'Dagger').qty, 1);
  r = await s.post('/api/party/give', { from: 'stash', to: ID.edric, name: 'Dagger', qty: 1 });
  assert.equal(r.status, 200); assert.equal(named(await character(ID.edric), 'Dagger').qty, 1); assert.equal((await s.get('/api/party')).json.stash.items.find((i) => i.name === 'Dagger'), undefined);
});

test('give: worn armor changes the giver\'s armor class and the sheet follows on both sides; the receiver puts it on only if nothing else is worn', async () => {
  await putGear(ID.edric, [it('Chain Mail +1', { weight: 55 }), it('Shield')]);
  await putGear(ID.rachel, [it('Leather Armor')]);
  // bring both sheets to what their gear says, so the change below is measured from a known start
  const hand = async (from, to, name) => { const r = await s.post('/api/party/give', { from, to, name, qty: 1 }); assert.equal(r.status, 200, r.text); };
  const acBefore = (await character(ID.edric)).ac;
  await hand(ID.edric, ID.rachel, 'Shield');
  const edric = await character(ID.edric), rachel = await character(ID.rachel);
  assert.equal(edric.ac, acBefore - 2, 'the giver loses the shield\'s 2 points'); assert.equal(String(edric.sheet.AC), String(edric.ac), 'the official sheet agrees');
  assert.equal(String(rachel.sheet.AC), String(rachel.ac), 'her sheet agrees with her record');
  assert.equal(named(rachel, 'Shield').equipped, true, 'a shield goes on when she had none');
  // a second armor arriving for someone who already wears armor stays in the pack: one body armor counts at a time
  await hand(ID.edric, ID.rachel, 'Chain Mail +1');
  const after = await character(ID.rachel);
  assert.equal(named(after, 'Chain Mail +1').equipped, false, 'she keeps wearing her leather armor; the chain mail is carried');
  assert.equal(named(after, 'Leather Armor').equipped, true);
  assert.equal(armorClass(after).body, 'Leather Armor');
});
