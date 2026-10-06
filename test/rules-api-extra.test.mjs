// HTTP tests for rules tracking: the endpoints, the clock and the 24-hour long rest limit, and that a stale character save cannot overwrite the track.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/sandbox.mjs';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s.stop(); });
const party = async () => JSON.parse((await s.get('/api/party')).text);

test('rules endpoints, clock and the one-long-rest-per-24-hours limit', async () => {
  let p = await party();
  const id = p.characters[0].id;
  assert.equal(p.clock.text.startsWith('Day 1, 08:00'), true);
  assert.equal((await s.call('POST', '/api/party/exhaustion', { characterId: id, delta: 2 })).status, 200);
  assert.equal((await s.call('POST', '/api/party/supplies', { characterId: id, kind: 'food', days: 1 })).status, 200);
  p = await party();
  assert.equal(p.characters.find((c) => c.id === id).rules.exhaustion, 2);
  assert.equal(p.characters.find((c) => c.id === id).effective.speed, Math.floor(p.characters.find((c) => c.id === id).speed / 2));
  const first = JSON.parse((await s.call('POST', '/api/party/rest', { kind: 'long' })).text);
  assert.equal(first.blocked, false);
  assert.equal(JSON.parse((await s.call('POST', '/api/party/rest', { kind: 'long' })).text).blocked, true);
  p = await party();
  assert.equal(p.characters.find((c) => c.id === id).rules.exhaustion, 2);       // not fed: no recovery
  assert.equal(p.clock.hour, 16);
  await s.call('POST', '/api/party/clock', { minutes: 1440 });
  assert.equal(JSON.parse((await s.call('POST', '/api/party/rest', { kind: 'long' })).text).blocked, false);
});

test('a stale character save does not overwrite the rules track', async () => {
  const p = await party();
  const c = p.characters[1];
  await s.call('POST', '/api/party/exhaustion', { characterId: c.id, delta: 1 });
  const stale = JSON.parse((await s.get('/api/characters')).text).find((x) => x.id === c.id);
  delete stale.track;
  await s.call('POST', '/api/characters', { ...stale, hp: 1 });
  assert.equal((await party()).characters.find((x) => x.id === c.id).rules.exhaustion, 1);
});

test('an XP award to the party is split and flags a level-up', async () => {
  const p = await party();
  const n = p.characters.length;
  const before = p.characters[0].rules.xp;
  await s.call('POST', '/api/party/xp', { amount: 2700 * n, split: true });
  const after = (await party()).characters[0].rules;
  assert.equal(after.xp, before + 2700);
  assert.equal(after.readyToLevelUp, true);
});
