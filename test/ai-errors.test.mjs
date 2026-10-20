// What the person is told when the AI Dungeon Master cannot answer (lib/ai-errors.js), and that the chat route passes it on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { describeAiError } from '../lib/ai-errors.js';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';

const CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_1"}';

test('an out-of-credit error says so and links to the billing page', () => {
  const d = describeAiError({ status: 400, message: CREDIT });
  assert.equal(d.code, 'credit'); assert.match(d.summary, /out of credit/); assert.equal(d.help.url, 'https://console.anthropic.com/settings/billing'); assert.match(d.help.label, /credit/i);
  assert.equal(d.providerMessage, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', 'the provider\'s own sentence, without the JSON around it');
  assert.equal(d.requestId, 'req_1');
  assert.deepEqual(d.links.map((l) => l.url), ['https://console.anthropic.com/settings/billing', '/settings.html'], 'the provider\'s billing page, then this app\'s Settings');
});

test('a refused key points at Settings; other errors need no special help', () => {
  const k = describeAiError({ status: 401, message: '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}' });
  assert.equal(k.code, 'key'); assert.equal(k.help.url, '/settings.html');
  for (const e of [{ status: 400, message: '400 some other bad request' }, { status: 500, message: 'boom' }, { status: 529, message: 'overloaded' }, null, undefined, {}]) assert.equal(describeAiError(e), null);
});

let fake, s;
before(async () => { fake = await fakeAnthropic([{ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'x' }], mapUpdates: [] }]); s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } }); await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' }); });
after(async () => { await s.stop(); await fake.close(); });

test('the chat route keeps the raw error text and adds the code, a plain summary and the link', async () => {
  fake.__set({ __status: 400, __message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' });
  const r = await s.post('/api/chat', { message: '[Edric] hello', history: [], tokens: [], characters: [], walls: [] });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /credit balance is too low/, 'the raw text is still there for the transcript');
  assert.equal(r.json.code, 'credit'); assert.match(r.json.summary, /out of credit/); assert.match(r.json.help.url, /console\.anthropic\.com\/settings\/billing/);
  assert.match(r.json.providerMessage, /^Your credit balance is too low/); assert.equal(r.json.links.length, 2);
});
