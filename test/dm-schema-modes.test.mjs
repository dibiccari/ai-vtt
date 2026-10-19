// The DM's reply form follows the situation: a fight form and a scene form, both cut from the full schema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerPieces, validateSchema } from '../scripts/dev/dm-schema.mjs';
import { schemaForMode, modeOf, modeNote, COMBAT_ONLY_ACTIONS, SCENE_ONLY_ACTIONS } from '../lib/dm-schema-modes.js';

const { DM_SCHEMA } = loadServerPieces();
const variantsOf = (s) => s.properties.mapUpdates.items.anyOf;
const actionsOf = (s) => variantsOf(s).find((v) => v.properties.type.enum[0] === 'token').properties.action.enum;
const types = (s) => variantsOf(s).map((v) => v.properties.type.enum[0]);
const reply = (u) => ({ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'x' }], mapUpdates: u });
const tokenUpd = (action) => ({ type: 'token', action, tokenId: '', name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0 });

test('mode follows the combat tracker', () => {
  assert.equal(modeOf({ active: true }), 'combat'); assert.equal(modeOf({ active: false }), 'scene'); assert.equal(modeOf(undefined), 'scene');
  assert.match(modeNote('combat'), /fight is running/); assert.match(modeNote('scene'), /no fight/);
});

test('the fight form has no gear, journal, sheet, shop or rest', () => {
  const s = schemaForMode(DM_SCHEMA, 'combat');
  assert.deepEqual(types(s), ['token', 'setHp', 'changeMap', 'addWall'], 'a fight can end and the party move on in one reply');
  for (const a of SCENE_ONLY_ACTIONS) assert.ok(!actionsOf(s).includes(a), a + ' is not in a fight');
  for (const a of ['damage', 'endTurn', 'initiative', 'template', 'addCondition', 'move', 'xp']) assert.ok(actionsOf(s).includes(a), a);
  assert.deepEqual(validateSchema(reply([tokenUpd('damage')]), s), []);
  assert.ok(validateSchema(reply([tokenUpd('shop')]), s).length, 'a shop cannot open mid-fight');
});

test('the scene form has no turn-by-turn actions but everything else', () => {
  const s = schemaForMode(DM_SCHEMA, 'scene');
  assert.deepEqual(types(s), types(DM_SCHEMA));
  for (const a of COMBAT_ONLY_ACTIONS) assert.ok(!actionsOf(s).includes(a), a + ' is a fight action');
  for (const a of ['startCombat', 'shop', 'rest', 'move', 'door', 'xp']) assert.ok(actionsOf(s).includes(a), a);
  assert.ok(validateSchema(reply([tokenUpd('endTurn')]), s).length);
});

test('both forms are smaller than the full one and the full one is untouched', () => {
  const size = (s) => JSON.stringify(s).length;
  assert.ok(size(schemaForMode(DM_SCHEMA, 'combat')) < size(DM_SCHEMA)); assert.ok(size(schemaForMode(DM_SCHEMA, 'scene')) < size(DM_SCHEMA));
  assert.ok(actionsOf(DM_SCHEMA).includes('endTurn') && actionsOf(DM_SCHEMA).includes('shop'));
  const every = new Set([...COMBAT_ONLY_ACTIONS, ...SCENE_ONLY_ACTIONS]);
  const combat = new Set(actionsOf(schemaForMode(DM_SCHEMA, 'combat'))), scene = new Set(actionsOf(schemaForMode(DM_SCHEMA, 'scene')));
  for (const a of actionsOf(DM_SCHEMA)) assert.ok(combat.has(a) || scene.has(a), a + ' is available in some form');
  assert.ok([...every].every((a) => actionsOf(DM_SCHEMA).includes(a)), 'the mode lists name only real actions');
});
