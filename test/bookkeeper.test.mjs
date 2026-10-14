// The Bookkeeper: the journal is written by a small model after the reply is sent, so the DM's reply form no longer carries it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';
import { bookkeeperMessage, cleanBookkeeperReply, bookkeeperSchema, BOOKKEEPER_SYSTEM } from '../lib/bookkeeper.js';
import { loadServerPieces } from '../scripts/dm-schema.mjs';
import { schemaForMode } from '../lib/dm-schema-modes.js';

test('the bookkeeper is given the turn and the journal, and its entries are cleaned', () => {
  const m = bookkeeperMessage({ message: 'I ask the innkeeper his name', narrative: 'He is Toblen.', rolls: ['Edric Persuasion: 15'], journal: '- [npc] Sildar: a friend', when: 'Day 1, 09:00' });
  for (const bit of ['Day 1, 09:00', 'Sildar', 'I ask the innkeeper', 'He is Toblen.', 'Persuasion: 15']) assert.ok(m.includes(bit), bit);
  const clean = cleanBookkeeperReply({ entries: [{ category: 'npc', title: ' Toblen ', text: 'Innkeeper.', status: 'none', when: '' }, { category: 'bogus', title: 'x', text: 'y', status: 'none', when: '' }, { category: 'event', title: '', text: 'no title', status: 'none', when: '' }, ...Array.from({ length: 6 }, (_, i) => ({ category: 'event', title: 'e' + i, text: 't', status: 'none', when: '' }))] });
  assert.equal(clean.length, 4, 'at most four, and bad ones dropped'); assert.equal(clean[0].title, 'Toblen'); assert.equal(clean[0].type, 'journal');
  assert.deepEqual(cleanBookkeeperReply(null), []);
  assert.equal(bookkeeperSchema().properties.entries.items.required.length, 5); assert.match(BOOKKEEPER_SYSTEM, /never secrets/);
});

let fake, s;
before(async () => {
  fake = await fakeAnthropic([(req) => (/bookkeeper/.test(String(req.system)) ? { entries: [{ category: 'npc', title: 'Toblen Stonehill', text: 'Runs the Stonehill Inn.', status: 'none', when: 'Day 1, 08:00' }] } : { rolls: [], narrative: 'The innkeeper says his name is Toblen Stonehill.', voiceLines: [], mapUpdates: [] })]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url, VTT_BOOKKEEPER: '1' } });
  await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' });
});
after(async () => { await s.stop(); await fake.close(); });

test('after a reply the bookkeeper writes the journal; the DM\'s form has no journal update and it is told so', async () => {
  const r = await s.post('/api/chat', { message: 'What is your name, innkeeper?' });
  assert.equal(r.status, 200, r.text);
  const dm = fake.requests[0];
  assert.ok(!dm.output_config.format.schema.properties.mapUpdates.items.anyOf.some((v) => v.properties.type.enum[0] === 'journal'));
  assert.ok(dm.system.some((b) => /bookkeeper writes the campaign journal/.test(b.text)));
  for (let i = 0; i < 60 && fake.requests.length < 2; i++) await new Promise((x) => setTimeout(x, 50));
  assert.equal(fake.requests.length, 2, 'one call for the DM and one for the bookkeeper');
  assert.match(fake.requests[1].model, /haiku/); assert.match(fake.requests[1].messages[0].content, /What is your name, innkeeper/);
  let entries = [];
  for (let i = 0; i < 60 && !entries.some((e) => e.title === 'Toblen Stonehill'); i++) { await new Promise((x) => setTimeout(x, 50)); entries = (await s.get('/api/campaigns/lost-mine-of-phandelver/journal')).json.entries || []; }
  assert.ok(entries.some((e) => e.category === 'npc' && e.title === 'Toblen Stonehill'), 'the entry is in the journal');
});
