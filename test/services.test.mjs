// The DM as orchestrator: it calls services (journal, buying, XP) as tools while it works out a reply, reads their results, then sends the final form. Against a FAKE Anthropic API (free).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';
import { buildServices, toolsFor, runService, MOVED_TO_SERVICES, enabledServices, movedFor, servicesNote, DEFAULT_SERVICES } from '../lib/services.js';
import { schemaForMode } from '../lib/dm-schema-modes.js';
import { loadServerPieces } from '../scripts/dev/dm-schema.mjs';

const { DM_SCHEMA } = loadServerPieces();
const LOST = 'lost-mine-of-phandelver';
const final = (narrative = 'Done.') => ({ rolls: [], narrative, voiceLines: [], mapUpdates: [] });

test('services: tools for the situation, plain results, unknown names and crashes are answered not thrown', async () => {
  const services = buildServices({ journal: async () => ({ text: 'ok' }), buy: async () => ({ ok: false, text: 'no gold' }), xp: async () => { throw new Error('boom'); } });
  assert.deepEqual(toolsFor(services, 'scene').map((t) => t.name), ['record_journal', 'buy_item', 'award_xp']);
  assert.deepEqual(toolsFor(services, 'combat').map((t) => t.name), ['record_journal', 'award_xp'], 'in a fight: the journal and XP, not buying');
  assert.ok(toolsFor(services, 'scene').every((t) => t.input_schema.type === 'object' && t.description.length > 40));
  assert.deepEqual(await runService(services, 'buy_item', {}), { ok: false, text: 'no gold' });
  assert.match((await runService(services, 'award_xp', {})).text, /boom/);
  assert.match((await runService(services, 'nope', {})).text, /no service/);
});

test('by default there are no DM services (they cost a round trip each and the live DM misused them); the list is configurable', () => {
  assert.deepEqual(DEFAULT_SERVICES, []); assert.deepEqual(enabledServices(undefined), []); assert.deepEqual(enabledServices('buy_item'), ['buy_item']); assert.deepEqual(enabledServices('record_journal, award_xp'), ['record_journal', 'award_xp']);
  assert.deepEqual(movedFor(['buy_item']), { variants: [], tokenActions: [], gearActions: ['buy'] });
  assert.deepEqual(movedFor(['record_journal', 'award_xp']), { variants: ['journal'], tokenActions: ['xp'], gearActions: [] });
  assert.match(servicesNote(['buy_item']), /buy_item/); assert.doesNotMatch(servicesNote(['buy_item']), /record_journal/);
});

test('what moved to services is gone from the reply form', () => {
  const scene = schemaForMode(DM_SCHEMA, 'scene', movedFor(['record_journal', 'award_xp', 'buy_item'])), v = scene.properties.mapUpdates.items.anyOf;
  assert.ok(!v.some((x) => x.properties.type.enum[0] === 'journal'));
  assert.ok(!v.find((x) => x.properties.type.enum[0] === 'token').properties.action.enum.includes('xp'));
  assert.ok(!v.find((x) => x.properties.type.enum[0] === 'gear').properties.action.enum.includes('buy'));
  assert.ok(v.find((x) => x.properties.type.enum[0] === 'gear').properties.action.enum.includes('add'), 'free gear stays');
});

let fake, s;
// A scripted DM: the first call asks for tools, the second (which carries the tool results) gives the final form.
const script = (...tools) => (req) => (req.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result')) ? final('The innkeeper nods.') : { __tool_use: tools });
before(async () => {
  fake = await fakeAnthropic([final()]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url, VTT_DM_SERVICES: 'record_journal,buy_item,award_xp' } });       // all three, to test every service
  await s.post('/api/campaigns/active', { id: LOST });
});
after(async () => { await s.stop(); await fake.close(); });

test('a tool round: the DM records a journal entry, buys a dagger and awards XP, sees the results, then answers', async () => {
  const gp0 = (await s.get('/api/characters')).json.find((c) => c.id === ID.astarion).coins.gp;
  fake.__set(script(
    { name: 'record_journal', input: { category: 'npc', title: 'Toblen Stonehill', text: 'Runs the Stonehill Inn in Phandalin.' } },
    { name: 'buy_item', input: { buyer: ID.astarion, item: 'Dagger', qty: 1 } },
    { name: 'award_xp', input: { target: 'party', amount: 100 } }));
  const before1 = fake.requests.length;
  const r = await s.post('/api/chat', { message: 'I buy a dagger from Toblen.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(fake.requests.length - before1, 2, 'one call asking for tools, one with their results');
  const first = fake.requests.at(-2), second = fake.requests.at(-1);
  assert.deepEqual(first.tools.map((t) => t.name), ['record_journal', 'buy_item', 'award_xp']);
  assert.ok(!first.output_config.format.schema.properties.mapUpdates.items.anyOf.some((v) => v.properties.type.enum[0] === 'journal'));
  assert.ok(first.system.some((b) => /SERVICES:/.test(b.text)));
  const results = second.messages.at(-1).content;
  assert.deepEqual(results.map((x) => x.type), ['tool_result', 'tool_result', 'tool_result']);
  assert.match(results[0].content, /Recorded in the journal: npc "Toblen Stonehill"/);
  assert.match(results[1].content, /bought 1 × Dagger for 2 gp/i);
  assert.match(results[2].content, /XP/);
  assert.equal(r.json.narrative, 'The innkeeper nods.');
  assert.deepEqual(r.json.journalAdded, [{ category: 'npc', title: 'Toblen Stonehill' }]);
  assert.ok(r.json.partyNotes.some((n) => /bought 1 × Dagger/i.test(n))); assert.ok(r.json.partyChanged.includes(ID.astarion));
  const after1 = (await s.get('/api/characters')).json.find((c) => c.id === ID.astarion);
  assert.equal(after1.coins.gp, gp0 - 2);
  assert.ok(Number(after1.sheet.XP) >= 25, 'the party XP was shared and saved');
  const journal = (await s.get(`/api/campaigns/${LOST}/journal`)).json;
  assert.ok(JSON.stringify(journal).includes('Toblen Stonehill'));
});

test('a refused purchase comes back to the DM as an error result and as a problem for the table', async () => {
  fake.__set(script({ name: 'buy_item', input: { buyer: ID.astarion, item: 'Plate', qty: 1 } }));
  const r = await s.post('/api/chat', { message: 'I try to buy plate armor.' });
  assert.equal(r.status, 200, r.text);
  const result = fake.requests.at(-1).messages.at(-1).content[0];
  assert.equal(result.is_error, true); assert.match(result.content, /Not enough coin/);
  assert.match(r.json.characterProblems.join(' '), /Not enough coin/);
});

test('in a fight the journal and XP services are offered, buying is not, and the fight reply form has no shop', async () => {
  fake.__set(final('The goblin falls.'));
  await s.post('/api/chat', { message: 'I attack.', combat: { active: true, round: 1, currentTokenId: 'x', order: [] } });
  const req = fake.requests.at(-1);
  assert.deepEqual(req.tools.map((t) => t.name), ['record_journal', 'award_xp']);
  assert.ok(!req.output_config.format.schema.properties.mapUpdates.items.anyOf.some((v) => ['gear', 'journal'].includes(v.properties.type.enum[0])));
});
