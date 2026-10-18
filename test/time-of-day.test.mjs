// Time of day (Nov 2026): the DM's `timeofday` token action. The flat update becomes a timeOfDay board update, the schema offers the action only in the scene form,
// the update reaches the table through /api/chat (against a FAKE Anthropic API), and the DM prompt explains who decides it. The tabletop side is in test/browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadServerPieces, validateSchema } from '../scripts/dm-schema.mjs';
import { schemaForMode, modeNote, SCENE_ONLY_ACTIONS } from '../lib/dm-schema-modes.js';
import { movedFor } from '../lib/services.js';
import { startServer, fakeAnthropic, boardStateOf } from './helpers/sandbox.mjs';

const { DM_SCHEMA, expandTokenUpdates } = loadServerPieces();
const T = (o) => ({ type: 'token', action: 'timeofday', tokenId: '', name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0, ...o });
const actionsOf = (s) => s.properties.mapUpdates.items.anyOf.find((v) => v.properties.type.enum[0] === 'token').properties.action.enum;
const reply = (...u) => ({ rolls: [], narrative: 'Evening comes.', voiceLines: [], mapUpdates: u });

test('every one of the four parts of the day is accepted, whatever the case or spacing, and nothing else is', async () => {
  for (const v of ['day', 'dawn', 'dusk', 'night']) {
    for (const spelled of [v, v.toUpperCase(), ` ${v} `, v[0].toUpperCase() + v.slice(1)]) {
      assert.deepEqual(await expandTokenUpdates([T({ condition: spelled })], []), [{ type: 'timeOfDay', value: v }], `"${spelled}"`);
    }
  }
  for (const bad of ['', 'midnight', 'evening', 'morning', 'noon', 'night.', 'night fall', 'nigh', '1', 'DAYS', null, undefined, 5]) assert.deepEqual(await expandTokenUpdates([T({ condition: bad })], []), [], `"${bad}" is dropped`);
});

test('the update does not need a token, a position or a value, and ignores them if sent', async () => {
  assert.deepEqual(await expandTokenUpdates([T({ condition: 'night', tokenId: 'nobody', col: 99, row: 99, value: 3, rounds: 4 })], []), [{ type: 'timeOfDay', value: 'night' }]);
  const out = await expandTokenUpdates([T({ condition: 'dusk' }), T({ action: 'move', tokenId: 'a', col: 1, row: 1 }), T({ condition: 'night' })], [{ id: 'a', col: 0, row: 0 }]);
  assert.deepEqual(out.map((u) => u.type), ['timeOfDay', 'moveToken', 'timeOfDay'], 'order is kept: dusk then the move then night');
  assert.deepEqual(out.filter((u) => u.type === 'timeOfDay').map((u) => u.value), ['dusk', 'night']);
});

test('the schema offers timeofday in the full form and the scene form, but not in a fight', () => {
  assert.ok(actionsOf(DM_SCHEMA).includes('timeofday'));
  assert.ok(actionsOf(schemaForMode(DM_SCHEMA, 'scene')).includes('timeofday'));
  assert.ok(!actionsOf(schemaForMode(DM_SCHEMA, 'combat')).includes('timeofday'));
  assert.ok(SCENE_ONLY_ACTIONS.includes('timeofday'));
  assert.deepEqual(validateSchema(reply(T({ condition: 'night' })), schemaForMode(DM_SCHEMA, 'scene')), []);
  assert.ok(validateSchema(reply(T({ condition: 'night' })), schemaForMode(DM_SCHEMA, 'combat')).length, 'a fight form refuses it');
  assert.match(modeNote('combat'), /cannot change gear/); assert.doesNotMatch(modeNote('combat'), /timeofday/);
});

test('timeofday stays in the scene form when the journal moves to the Bookkeeper or to a service', () => {
  for (const moved of [movedFor([]), movedFor(['record_journal']), movedFor(['record_journal', 'buy_item', 'award_xp'])]) assert.ok(actionsOf(schemaForMode(DM_SCHEMA, 'scene', moved)).includes('timeofday'));
});

let fake, s;
before(async () => {
  fake = await fakeAnthropic([reply()]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' });
});
after(async () => { if (s) await s.stop(); if (fake) await fake.close(); });

test('/api/chat turns the DM\'s timeofday into a timeOfDay board update for the table; a bogus part of the day never reaches it', async () => {
  fake.__set(reply(T({ condition: 'night' })));
  let r = await s.post('/api/chat', { message: 'We wait until dark.' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.mapUpdates.filter((u) => u.type === 'timeOfDay'), [{ type: 'timeOfDay', value: 'night' }]);
  assert.ok(!r.json.mapUpdates.some((u) => u.type === 'token'), 'the flat form is gone');
  fake.__set(reply(T({ condition: 'teatime' }), T({ condition: 'dawn' })));
  r = await s.post('/api/chat', { message: 'We sleep.' });
  assert.deepEqual(r.json.mapUpdates.filter((u) => u.type === 'timeOfDay').map((u) => u.value), ['dawn']);
});

test('the DM is told it decides the time of day, how to send it, and gets the current value in the lighting block it is sent', async () => {
  fake.__set(reply());
  await s.post('/api/chat', { message: 'Look around.', lighting: { ambient: 'bright', timeOfDay: 'dusk', zones: [{ name: 'Yard', light: 'dim', followsTimeOfDay: true }] }, tokens: [] });
  const req = fake.requests.at(-1);
  const text = req.system.map((b) => b.text).join('\n');
  assert.match(text, /Time of day: lighting\.timeOfDay is day, dawn, dusk or night, and YOU decide it/);
  assert.match(text, /token action timeofday \(condition day, dawn, dusk or night\)/);
  const state = boardStateOf(req);
  assert.equal(state.lighting.timeOfDay, 'dusk', 'the DM is told the part of the day the table is in');
  assert.deepEqual(state.lighting.zones, [{ name: 'Yard', light: 'dim', followsTimeOfDay: true }], 'and the light of each zone now');
  await s.post('/api/chat', { message: 'x', lighting: { ambient: 'dark', timeOfDay: 'teatime', zones: [{ name: 'n'.repeat(90), light: 'purple' }, null] } });
  const odd = boardStateOf(fake.requests.at(-1)).lighting;
  assert.equal(odd.timeOfDay, 'day', 'a made-up part of the day becomes day'); assert.deepEqual(odd.zones.map((z) => [z.name.length, z.light, z.followsTimeOfDay]), [[40, 'bright', false], [0, 'bright', false]]);
  await s.post('/api/chat', { message: 'x' });
  assert.deepEqual(boardStateOf(fake.requests.at(-1)).lighting, { ambient: 'bright', timeOfDay: 'day', mapLights: [] }, 'a table that sends nothing is day, bright, with no zones');
  await s.post('/api/chat', { message: 'x', lighting: { ambient: 'dim', timeOfDay: 'night', zones: [] } });
  assert.equal(boardStateOf(fake.requests.at(-1)).lighting.zones, undefined, 'no zones, no key');
});
