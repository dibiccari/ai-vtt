// The Merchant agent: its prompt, the price limits on haggling, and the endpoint against a FAKE Anthropic API (free, offline).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';
import { merchantSystem, merchantMessages, cleanMerchantReply, merchantSchema, HAGGLE_RANGE } from '../lib/merchant.js';

const VOICES = ['narrator', 'gruff', 'sly'];
const shop = { merchant: 'Hurdred the smith', groups: ['Weapon', 'Armor'], markup: 120, base: 120 };

test('the merchant is told who it is, what it sells, its price, the dice tray and the buyer\'s bonus', () => {
  const sys = merchantSystem({ shop, buyer: { name: 'Edric', persuasion: 2, insight: 1 }, place: 'Phandalin', campaign: 'Lost Mine', tray: [14, 3, 19, 8] });
  for (const bit of ['Hurdred the smith', 'Weapon, Armor', '120%', '14, 3, 19, 8', 'Persuasion bonus is +2', 'Phandalin', 'Insight is +1']) assert.ok(sys.includes(bit), bit);
});

test('history becomes alternating messages starting with the player; the opening is a walk-in', () => {
  assert.deepEqual(merchantMessages([], '', true), [{ role: 'user', content: '(The player walks into your shop.)' }]);
  const m = merchantMessages([{ role: 'merchant', text: 'Welcome.' }, { role: 'player', text: 'Hi' }, { role: 'player', text: 'a sword?' }], 'how much?', false);
  assert.equal(m[0].role, 'user'); assert.ok(m.every((x, i) => i === 0 || x.role !== m[i - 1].role));
  assert.match(m.at(-1).content, /how much\?/);
  assert.equal(merchantMessages(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'merchant' : 'player', text: 'x' + i })), 'now', false).length <= 12, true);
});

test('haggling is limited to 30 points either side of the DM\'s price and never below 25 percent', () => {
  const clean = (m, s = shop) => cleanMerchantReply({ line: 'Hm.', voice: 'sly', rolls: [], markup: m, done: false, summary: 's' }, s, VOICES);
  assert.equal(clean(0).markup, 0, 'no change stays no change');
  assert.equal(clean(110).markup, 110); assert.equal(clean(40).markup, 120 - HAGGLE_RANGE); assert.equal(clean(500).markup, 120 + HAGGLE_RANGE);
  assert.equal(clean(10, { ...shop, markup: 40, base: 40 }).markup, 25);
  assert.equal(cleanMerchantReply({ line: 'x', voice: 'robot' }, shop, VOICES).voice, 'narrator');
  assert.equal(merchantSchema(VOICES).required.length, 6);
});

let fake, s;
before(async () => {
  fake = await fakeAnthropic([{ line: 'Welcome to my forge.', voice: 'gruff', rolls: [], markup: 0, done: false, summary: 'Greeted.' }]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
});
after(async () => { await s.stop(); await fake.close(); });

test('POST /api/merchant: a cheap model, the small schema, the buyer and shop in the prompt, the price kept within reach', async () => {
  const base = { merchant: 'Hurdred the smith', groups: ['Weapon'], markup: 100, base: 100, buyerId: ID.edric, place: 'Phandalin' };
  let r = await s.post('/api/merchant', { ...base, opening: true });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.line, 'Welcome to my forge.'); assert.equal(r.json.voice, 'gruff');
  const req = fake.requests.at(-1);
  assert.match(req.model, /haiku/); assert.equal(req.output_config.format.schema.required.length, 6);
  assert.match(req.system, /Hurdred the smith/); assert.match(req.system, /Edric/);
  fake.__set({ line: 'Fine, ten percent off.', voice: 'gruff', rolls: ['Edric Persuasion: d20 (15) + 2 = 17 vs DC 13: success'], markup: 10, done: false, summary: 'Edric haggled.' });
  r = await s.post('/api/merchant', { ...base, message: 'Come on, give me a discount.', history: [{ role: 'merchant', text: 'Welcome.' }] });
  assert.equal(r.json.markup, 70, 'a 10 percent price is pulled back to the 30 point limit'); assert.equal(r.json.rolls.length, 1);
  assert.equal((await s.post('/api/merchant', { ...base, buyerId: 'nobody', opening: true })).status, 404);
  const usage = (await s.get('/api/usage')).json;
  assert.ok(JSON.stringify(usage).includes('merchant'), 'its cost is tracked as its own kind');
});
