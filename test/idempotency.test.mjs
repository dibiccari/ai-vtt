// Nothing is applied twice: exactly once per request (lib/request-ledger.js) and no identical reward on the replies right after it was made (lib/reward-guard.js),
// then both end to end through /api/chat against a FAKE Anthropic API (free and offline).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLedger, validRequestId } from '../lib/request-ledger.js';
import { createRewardGuard, rewardOf } from '../lib/reward-guard.js';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';

/* ---------------- the pure parts ---------------- */

test('request ledger: the first request runs, a copy while it runs is refused, a copy after it finished gets the first answer, a failure may be retried', () => {
  const l = createRequestLedger();
  assert.equal(l.begin('request-0001').fresh, true);
  assert.deepEqual(l.begin('request-0001'), { fresh: false, state: 'running' });
  l.done('request-0001', { narrative: 'first' });
  assert.deepEqual(l.begin('request-0001'), { fresh: false, state: 'done', reply: { narrative: 'first' } });
  assert.equal(l.begin('request-0002').fresh, true);
  l.fail('request-0002');
  assert.equal(l.begin('request-0002').fresh, true, 'a request that failed runs again when it is sent again');
  l.done('request-0001', { narrative: 'other' });
  assert.equal(l.begin('request-0001').reply.narrative, 'first', 'a finished request keeps its first answer');
  l.fail('request-0001');
  assert.equal(l.begin('request-0001').state, 'done', 'only a running request can be released');
});

test('request ledger: no or a bad ID means no protection, and old entries are forgotten', () => {
  const l = createRequestLedger({ ttlMs: 1000, max: 3 });
  for (const bad of [undefined, null, '', 'short', 'has spaces in it', 'x'.repeat(200), 42]) { assert.equal(validRequestId(bad), ''); assert.equal(l.begin(bad).fresh, true); assert.equal(l.begin(bad).fresh, true); }
  assert.equal(l.size(), 0);
  l.begin('request-0001', 0); l.done('request-0001', { a: 1 }, 0);
  assert.equal(l.begin('request-0001', 500).state, 'done');
  assert.equal(l.begin('request-0001', 5000).fresh, true, 'after the time to live it runs again');
  for (const n of [1, 2, 3, 4, 5]) l.begin('request-000' + n + 'x', 6000 + n);
  assert.ok(l.size() <= 3, 'the memory is bounded');
});

const coins = (o) => ({ type: 'gear', action: 'coins', target: 'edric', name: '', qty: 0, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...o });

test('reward guard: only things that add value count as rewards', () => {
  assert.equal(rewardOf(coins({ gp: 10 })).key, 'coins|edric|0,0,0,10,0');
  assert.match(rewardOf(coins({ gp: 10, sp: 5 }), () => 'Edric').label, /\+5 sp, \+10 gp for Edric|\+10 gp, \+5 sp for Edric|for Edric/);
  for (const not of [coins({ gp: -3 }), coins({ gp: 5, sp: -1 }), coins({}), { type: 'gear', action: 'setcoins', target: 'edric', gp: 40 }, { type: 'gear', action: 'buy', target: 'edric', name: 'Rope' }, { type: 'gear', action: 'remove', target: 'edric', name: 'Rope' }, { type: 'track', op: 'xp', target: 'party', amount: 0 }, { type: 'gear', action: 'add', target: 'edric', name: '' }, { type: 'damageToken', tokenId: 'x', value: 3 }, null, 'text']) assert.equal(rewardOf(not), null, JSON.stringify(not));
  assert.equal(rewardOf({ type: 'gear', action: 'add', target: 'edric', name: 'Rope', qty: 2 }).key, 'item|edric|rope|2');
  assert.equal(rewardOf({ type: 'track', op: 'xp', target: 'party', amount: 200, split: true }).key, 'xp|party|200|true');
});

test('reward guard: an identical reward on the next replies is refused, a different one is not, and the memory moves on', () => {
  const g = createRewardGuard({ window: 2 });
  const pay = coins({ gp: 10 }), other = coins({ gp: 5 }), spend = coins({ gp: -1 });
  let r = g.filter('c', [pay, spend]);
  assert.equal(r.updates.length, 2); assert.deepEqual(r.skipped, []);
  r = g.filter('c', [pay, spend, other]);
  assert.deepEqual(r.updates, [spend, other], 'the same payment again is refused, spending is not held back'); assert.equal(r.skipped.length, 1);
  r = g.filter('c', [pay]);
  assert.equal(r.updates.length, 0, 'a model that keeps repeating keeps being refused');
  g.filter('c', []); g.filter('c', []);
  r = g.filter('c', [pay]);
  assert.equal(r.updates.length, 1, 'after two replies without it, the same reward is a new one');
  assert.equal(g.filter('another', [pay]).updates.length, 1, 'each campaign has its own memory');
  g.reset('c');
  assert.equal(g.filter('c', [pay]).updates.length, 1, 'a reset forgets');
  g.reset('c');
  assert.equal(g.filter('c', [pay, pay]).updates.length, 2, 'two identical in one reply are not touched: that is the DM saying so in one breath');
});

/* ---------------- end to end ---------------- */

const LOST = 'lost-mine-of-phandelver';
let fake, s;
const upd = (o) => ({ type: 'gear', action: 'coins', target: ID.edric, to: '', name: '', qty: 0, weight: 0, requiresAttunement: false, effectKind: 'none', effectValue: 0, effectAbility: '', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...o });
const reply = (...updates) => ({ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'Elmar counts out the gold.' }], mapUpdates: updates });
const gold = async () => (await s.get('/api/characters')).json.find((c) => c.id === ID.edric).coins.gp;
const chat = (extra = {}) => s.post('/api/chat', { message: '[Edric] I take it', history: [], tokens: [], characters: [{ id: ID.edric, name: 'Edric' }], walls: [], ...extra });

before(async () => {
  fake = await fakeAnthropic([reply()]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: LOST });
});
after(async () => { await s.stop(); await fake.close(); });

test('the same request sent twice pays once, and the second answer is the first one', async () => {
  fake.__set(reply(upd({ gp: 10 }))); fake.requests.length = 0;
  const before = await gold();
  const a = await chat({ requestId: 'req-aaaa-0001' });
  const b = await chat({ requestId: 'req-aaaa-0001' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(await gold(), before + 10, 'paid once');
  assert.equal(fake.requests.filter((r) => !JSON.stringify(r.system).includes('bookkeeper')).length, 1, 'the model was asked once');
  assert.equal(b.json.replayed, true); assert.deepEqual(b.json.partyNotes, a.json.partyNotes); assert.equal(b.json.narrative, a.json.narrative);
});

test('a copy that arrives while the first is still being worked on is refused and does not pay', async () => {
  fake.__set({ ...reply(upd({ gp: 3 })), __chunkMs: 150, __chunkSize: 12 });
  const before = await gold();
  const stream = (id) => fetch(`${s.base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '[Edric] I take it', history: [], tokens: [], characters: [{ id: ID.edric, name: 'Edric' }], walls: [], stream: true, requestId: id }) }).then((r) => r.text());
  const first = stream('req-bbbb-0002');
  await new Promise((r) => setTimeout(r, 300));
  const second = await stream('req-bbbb-0002');
  assert.match(second, /already being handled/);
  const done = (await first).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(done.event, 'done');
  assert.equal(await gold(), before + 3, 'paid once');
  const again = await chat({ requestId: 'req-bbbb-0002' });
  assert.equal(again.json.replayed, true, 'the refused copy did not release the first request');
});

test('a request that failed can be sent again with the same ID', async () => {
  fake.__set({ __status: 400, __message: 'boom' });
  const bad = await chat({ requestId: 'req-cccc-0003' });
  assert.notEqual(bad.status, 200);
  fake.__set(reply(upd({ gp: 1 })));
  const before = await gold();
  const good = await chat({ requestId: 'req-cccc-0003' });
  assert.equal(good.status, 200); assert.notEqual(good.json.replayed, true);
  assert.equal(await gold(), before + 1);
});

test('the same reward on the next reply is skipped and reported; a different one is paid; start over forgets', async () => {
  await s.post(`/api/campaigns/${LOST}/start-over`, {});
  fake.__set(reply(upd({ gp: 10 })));
  const before = await gold();
  const first = await chat({ requestId: 'req-dddd-0004' });
  assert.deepEqual(first.json.characterProblems, []);
  const second = await chat({ requestId: 'req-dddd-0005' });         // a new message, the DM sends the same reward again
  assert.equal(await gold(), before + 10, 'paid once');
  assert.ok(second.json.characterProblems.some((p) => /Skipped/.test(p) && /\+10 gp for Edric/.test(p)), second.json.characterProblems.join('|'));
  fake.__set(reply(upd({ gp: 7 })));
  await chat({ requestId: 'req-dddd-0006' });
  assert.equal(await gold(), before + 17, 'a different amount is a different reward');
  await s.post(`/api/campaigns/${LOST}/start-over`, {});
  fake.__set(reply(upd({ gp: 7 })));
  await chat({ requestId: 'req-dddd-0007' });
  assert.equal(await gold(), before + 24, 'after start over the memory is empty');
});

test('spending the same price twice in a row is not held back', async () => {
  const before = await gold();
  fake.__set(reply(upd({ gp: -1 })));
  await chat({ requestId: 'req-eeee-0008' }); await chat({ requestId: 'req-eeee-0009' });
  assert.equal(await gold(), before - 2);
});
