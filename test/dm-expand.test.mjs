// The flat updates the DM sends (DM_SCHEMA) and the pure helpers that turn them into specific updates. The helpers are read out of server.js as text
// (scripts/dm-schema.mjs), so these tests exercise the real code without starting the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerPieces, validateSchema } from '../scripts/dm-schema.mjs';
import { EFFECT_KINDS, normalizeItem, processPartyUpdates } from '../lib/party.js';
import { applyUpdate } from '../lib/sheet-edit.js';

const { expandSheetEdits, expandTokenUpdates, gearToPartyUpdates, DM_SCHEMA, VOICES } = loadServerPieces();
const T = (action, extra = {}) => ({ type: 'token', action, tokenId: 't1', name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0, ...extra });

test('DM_SCHEMA: shape, closed objects, every update variant lists all its fields as required', () => {
  assert.deepEqual(DM_SCHEMA.required, ['rolls', 'narrative', 'voiceLines', 'mapUpdates']);
  const variants = DM_SCHEMA.properties.mapUpdates.items.anyOf;
  assert.deepEqual(variants.map((v) => v.properties.type.enum[0]), ['token', 'setHp', 'changeMap', 'gear', 'journal', 'addWall', 'updateCharacter']);
  for (const v of variants) {
    assert.equal(v.additionalProperties, false);
    assert.deepEqual([...v.required].sort(), Object.keys(v.properties).sort(), `${v.properties.type.enum[0]}: all fields required`);
  }
  assert.ok(VOICES.includes('narrator') && VOICES.includes('undead'));
});

test('validateSchema accepts a correct reply and names what is wrong in broken ones', () => {
  const ok = { rolls: ['Goblin: 14 to hit'], narrative: 'x', voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'x' }], mapUpdates: [T('move'), { type: 'setHp', characterId: 'edric', hp: 3 }] };
  assert.deepEqual(validateSchema(ok, DM_SCHEMA), []);
  assert.ok(validateSchema({ ...ok, narrative: 5 }, DM_SCHEMA).length);
  assert.ok(validateSchema({ ...ok, extra: 1 }, DM_SCHEMA).some((p) => /extra: not allowed/.test(p)));
  assert.ok(validateSchema({ ...ok, voiceLines: [{ speaker: 'a', voice: 'robot', text: 'x' }] }, DM_SCHEMA).length);
  assert.ok(validateSchema({ ...ok, mapUpdates: [{ type: 'token', action: 'dance' }] }, DM_SCHEMA).length);
  assert.ok(validateSchema({ rolls: [], narrative: '', mapUpdates: [] }, DM_SCHEMA).some((p) => /voiceLines: missing/.test(p)));
});

test('expandTokenUpdates: simple actions become their specific updates', async () => {
  const out = await expandTokenUpdates([
    T('move', { col: 3, row: 4 }), T('damage', { value: 7 }), T('heal', { value: 2 }), T('initiative', { value: 15 }), T('startCombat'), T('endCombat'), T('endTurn'),
    T('remove'), T('reveal'), T('hide'), T('addCondition', { condition: 'prone', rounds: 2 }), T('removeCondition', { condition: 'prone' }),
    T('away', { condition: 'scouting' }), T('away'), T('here'), T('rest', { value: 2 }), T('rest', { value: 1 }), T('mood', { condition: 'Combat' }), T('sfx', { condition: 'THUNDER' }),
    T('light', { condition: 'Torch', value: 1 }), T('summon', { condition: 'mage-hand', name: 'lyra', col: 1, row: 1 }), T('ready', { condition: 'shoot' }), T('template', { condition: 'Cone ', value: 15, col: 2, row: 2, name: 'goblin' })
  ]);
  const types = out.map((u) => u.type);
  assert.deepEqual(types, ['moveToken', 'damageToken', 'healToken', 'setInitiative', 'startCombat', 'endCombat', 'endTurn', 'removeToken', 'revealToken', 'hideToken', 'addCondition', 'removeCondition', 'setWhere', 'setWhere', 'setWhere', 'restParty', 'restParty', 'setMood', 'playSound', 'lightToken', 'summonToken', 'readyToken', 'template']);
  assert.deepEqual(out[0], { type: 'moveToken', tokenId: 't1', col: 3, row: 4, mode: '' });
  assert.equal(out[12].where, 'scouting'); assert.equal(out[13].where, 'elsewhere'); assert.equal(out[14].where, '');
  assert.equal(out[15].kind, 'long'); assert.equal(out[16].kind, 'short');
  assert.equal(out[17].mood, 'combat'); assert.equal(out[18].sound, 'thunder');
  assert.equal(out[19].kind, 'torch'); assert.equal(out[20].ownerId, 'lyra'); assert.equal(out[22].shape, 'cone'); assert.equal(out[22].toward, 'goblin');
});

test('expandTokenUpdates: a move marked forced or teleport carries its mode, anything else is the creature walking', async () => {
  const out = await expandTokenUpdates([T('move', { tokenId: 'g', col: 5, row: 5, condition: 'Forced' }), T('move', { tokenId: 'g', col: 6, row: 6, condition: ' teleport ' }), T('move', { tokenId: 'g', col: 7, row: 7, condition: 'sneaks' })]);
  assert.deepEqual(out.map((u) => u.mode), ['forced', 'teleport', '']);
});

test('expandTokenUpdates: non-token updates pass through, nulls and unknown actions are dropped', async () => {
  const through = { type: 'setHp', characterId: 'a', hp: 1 };
  const out = await expandTokenUpdates([null, through, T('juggle'), undefined]);
  assert.deepEqual(out, [through]);
});

test('expandTokenUpdates: add with an SRD monster fills in real hit points, AC and speed', async () => {
  const [goblin] = await expandTokenUpdates([T('add', { tokenId: 'g1', name: 'Gob', monster: 'Goblin', col: 5, row: 6, hidden: true })]);
  assert.equal(goblin.type, 'addToken'); assert.equal(goblin.monster, 'goblin'); assert.equal(goblin.name, 'Gob');
  assert.equal(goblin.maxHp, 7); assert.equal(goblin.ac, 15); assert.equal(goblin.speed, 30); assert.equal(goblin.dexMod, 2); assert.equal(goblin.hidden, true);
  assert.ok(goblin.image.startsWith('/tokens/'));
});

test('expandTokenUpdates: add without a monster uses the DM numbers; adventure creatures come from the campaign list', async () => {
  const [plain] = await expandTokenUpdates([T('add', { name: 'Trap', kind: 'trap', value: 0, ac: 0 })]);
  assert.equal(plain.monster, ''); assert.equal(plain.maxHp, 0); assert.equal(plain.kind, 'trap');
  const [custom] = await expandTokenUpdates([T('add', { name: 'Boss', value: 40, ac: 17 })]);
  assert.equal(custom.maxHp, 40); assert.equal(custom.ac, 17);
  const adv = [{ index: 'redbrand-ruffian', name: 'Redbrand Ruffian', hit_points: 16, armor_class: [{ value: 14 }], speed: { walk: '30 ft.' }, dexterity: 14, type: 'humanoid' }];
  const [rr] = await expandTokenUpdates([T('add', { monster: 'redbrand-ruffian' })], adv);
  assert.equal(rr.name, 'Redbrand Ruffian'); assert.equal(rr.maxHp, 16); assert.equal(rr.ac, 14); assert.equal(rr.dexMod, 2); assert.equal(rr.monster, '', 'not an SRD index');
});

const G = (action, extra = {}) => ({ type: 'gear', action, target: 'edric', to: '', name: 'Rope', qty: 1, weight: 0, requiresAttunement: false, effectKind: 'none', effectValue: 0, effectAbility: '', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...extra });

test('gearToPartyUpdates: every gear action maps to the party update', () => {
  const out = gearToPartyUpdates([
    null, { type: 'token' }, G('add', { qty: 2, effectKind: 'ac', effectValue: 1 }), G('add'), G('remove', { qty: 1 }), G('move', { to: 'stash' }), G('attune'), G('unattune'), G('coins', { gp: -5, sp: 2 }), G('juggle')
  ]);
  assert.deepEqual(out.map((u) => u.type), ['addItem', 'addItem', 'removeItem', 'moveItem', 'attuneItem', 'unattuneItem', 'adjustCoins']);
  assert.deepEqual(out[0].effects, [{ kind: 'ac', value: 1, ability: '' }]);
  assert.deepEqual(out[1].effects, [], 'effectKind none means no effect');
  assert.deepEqual([out[3].from, out[3].to], ['edric', 'stash']);
  assert.equal(out[4].characterId, 'edric');
  assert.equal(out[6].gp, -5);
  assert.ok(EFFECT_KINDS.every((k) => DM_SCHEMA.properties.mapUpdates.items.anyOf[3].properties.effectKind.enum.includes(k)));
});

test('gearToPartyUpdates output is accepted by processPartyUpdates', async () => {
  const c = { id: 'edric', name: 'Edric', inventory: [], coins: { cp: 0, sp: 0, ep: 0, gp: 9, pp: 0 }, abilities: {}, ac: 10, speed: 30 };
  const list = [c];
  const store = { list: async () => list, save: async (x) => { list[0] = x; return x; }, stash: async () => ({ items: [], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }), saveStash: async (s) => s };
  const r = await processPartyUpdates(gearToPartyUpdates([G('add', { name: 'Ring of Protection', requiresAttunement: true, effectKind: 'ac', effectValue: 1 }), G('attune', { name: 'Ring of Protection' }), G('coins', { gp: -4 })]), store);
  assert.deepEqual(r.problems, []);
  assert.equal(list[0].coins.gp, 5); assert.equal(list[0].inventory[0].attuned, true);
  assert.deepEqual(list[0].inventory[0].effects, [normalizeItem({ name: 'x', effects: [{ kind: 'ac', value: 1 }] }).effects[0]]);
});

test('expandSheetEdits: skill/save/spell/slots lines become lists, the rest stays an edit', () => {
  const u = expandSheetEdits({ type: 'updateCharacter', characterId: 'lyra', reason: 'level up', edits: [
    { field: 'skill Stealth', value: 'Expertise' }, { field: 'save dex', value: 'proficient' }, { field: 'save wis', value: 'no' },
    { field: 'spell add 2', value: 'Misty Step' }, { field: 'spell remove 1', value: 'Sleep' }, { field: 'slots 3', value: '2' }, { field: 'slot 1', value: '5' },
    { field: 'classLevel', value: 'Wizard 4' }, { field: 'int', value: ' 18 ' }
  ] });
  assert.deepEqual(u.skills, [{ name: 'Stealth', proficiency: 'expertise' }]);
  assert.deepEqual(u.saves, [{ ability: 'dex', proficient: true }, { ability: 'wis', proficient: false }]);
  assert.deepEqual(u.spells, [{ level: 2, name: 'Misty Step', remove: false }, { level: 1, name: 'Sleep', remove: true }]);
  assert.deepEqual(u.slots, [{ level: 3, total: 2 }, { level: 1, total: 5 }]);
  assert.deepEqual(u.edits, [{ field: 'classLevel', value: 'Wizard 4' }, { field: 'int', value: '18' }]);
  assert.equal(u.reason, 'level up');
  assert.deepEqual(expandSheetEdits({ type: 'updateCharacter' }).edits, [], 'missing edits is fine');
});

test('expandSheetEdits output is understood by applyUpdate', () => {
  const c = { id: 'p', name: 'P', class: 'Rogue', level: 1, hp: 8, maxHp: 8, ac: 12, speed: 30, abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, sheet: { ClassLevel: 'Rogue 1', ProfBonus: '+2' } };
  const out = applyUpdate(c, expandSheetEdits({ edits: [{ field: 'skill Stealth', value: 'expertise' }, { field: 'xpGain', value: '100' }] }));
  assert.deepEqual(out.rejected, []);
  assert.equal(out.character.sheet['Stealth '], '+7');
});

test('addCondition passes the minutes (value) and the caster (name) through to the table', async () => {
  const out = await expandTokenUpdates([T('addCondition', { name: 'pc-caster', condition: 'bless', rounds: 0, value: 1 })]);
  assert.equal(out[0].type, 'addCondition');
  assert.equal(out[0].condition, 'bless'); assert.equal(out[0].minutes, 1); assert.equal(out[0].source, 'pc-caster');
});
