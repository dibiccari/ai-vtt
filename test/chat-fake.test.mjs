// /api/chat end to end against a FAKE Anthropic API (a local server the SDK is pointed at with ANTHROPIC_BASE_URL): free and offline.
// Checks what is sent to the model (system blocks, schema, board state, dice tray, hidden-token marker) and how the DM's reply is applied.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { startServer, makeSandbox, fakeAnthropic, boardStateOf } from './helpers/sandbox.mjs';
import { loadServerPieces, validateSchema } from '../scripts/dm-schema.mjs';

const { DM_SCHEMA } = loadServerPieces();
const LOST = 'lost-mine-of-phandelver';
let fake, s;
const reply = { rolls: ['Goblin attack: 14 to hit'], narrative: 'A goblin leaps from the brush.', voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'A goblin leaps from the brush.' }], mapUpdates: [] };
const tok = (o) => ({ id: 'x', name: 'X', col: 1, row: 1, color: '#fff', isPC: false, hidden: false, kind: 'creature', visibleToParty: true, ...o });

before(async () => {
  fake = await fakeAnthropic([reply]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: LOST });
});
after(async () => { await s.stop(); await fake.close(); });
const setReply = (r) => { fake.requests.length = 0; fake.__set(r); };

test('the request to the model: system blocks, strict schema, board state with dice tray, party and the hidden marker', async () => {
  const r = await s.post('/api/chat', { message: '[Edric] I look around', history: [{ role: 'assistant', content: 'Welcome.' }, { role: 'user', content: 'Hi' }], tokens: [tok({ id: 'pc1', name: 'Edric', isPC: true }), tok({ id: 'sec1', name: 'ZZSECRETMARKERZZ', hidden: true, visibleToParty: false })], characters: [], walls: [], gridSize: 50, mapName: 'blank', mapUrl: '' });
  assert.equal(r.status, 200, r.text);
  assert.equal(fake.requests.length, 1);
  const req = fake.requests[0];
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema, JSON.parse(JSON.stringify(DM_SCHEMA)));
  assert.ok(req.system.length >= 3);
  assert.ok(req.system.some((b) => b.cache_control), 'the campaign text is a cached block');
  assert.ok(req.system.some((b) => /TABLE SETTINGS/.test(b.text)));
  assert.ok(req.system.some((b) => /CAMPAIGN JOURNAL/.test(b.text)));
  const state = boardStateOf(req);
  assert.equal(state.diceMode, 'ai');
  for (const k of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']) assert.ok(state.diceTray[k].length > 0, k);
  assert.equal(state.party.characters.length, 4);
  const hidden = state.tokens.find((t) => t.id === 'sec1');
  assert.deepEqual([hidden.hidden, hidden.visibleToParty], [true, false], 'the table tells the DM what is hidden');
  const msgs = req.messages;
  assert.equal(msgs[0].role, 'user'); assert.equal(msgs.at(-1).role, 'user');
  assert.ok(msgs.every((m, i) => i === 0 || m.role !== msgs[i - 1].role), 'roles alternate');
  assert.deepEqual(r.json.rolls, reply.rolls); assert.equal(r.json.narrative, reply.narrative);
  assert.deepEqual(validateSchema(reply, DM_SCHEMA), []);
});

test('two requests get different dice trays (real dice every turn)', async () => {
  await s.post('/api/chat', { message: 'again' });
  await s.post('/api/chat', { message: 'and again' });
  const [a, b] = fake.requests.slice(-2).map((r) => boardStateOf(r).diceTray.d20);
  assert.notDeepEqual(a, b);
});

test('the reply is applied: SRD monsters get real numbers, bad map ids and unknown characters are reported, the journal and sheets are saved', async () => {
  setReply({
    rolls: [], narrative: 'Goblins!', voiceLines: [],
    mapUpdates: [
      { type: 'token', action: 'add', tokenId: 'g1', name: 'Goblin 1', col: 4, row: 4, color: '#0a0', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: 'goblin', value: 0, ac: 0 },
      { type: 'token', action: 'startCombat', tokenId: '', name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0 },
      { type: 'changeMap', mapId: 'atlantis', arrive: 'x', reason: 'swim' },
      { type: 'journal', category: 'event', title: 'Goblin ambush', text: 'Goblins attacked on the road.', status: 'none', when: 'Day 1' },
      { type: 'gear', action: 'coins', target: 'edric', to: '', name: '', qty: 0, weight: 0, requiresAttunement: false, effectKind: 'none', effectValue: 0, effectAbility: '', cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
      { type: 'updateCharacter', characterId: 'edric', reason: 'xp', edits: [{ field: 'xpGain', value: '50' }] },
      { type: 'updateCharacter', characterId: 'ghost', reason: 'x', edits: [{ field: 'hp', value: '1' }] }
    ]
  });
  const before = (await s.get('/api/characters')).json.find((c) => c.id === 'edric');
  const r = await s.post('/api/chat', { message: 'go' }); assert.equal(r.status, 200, r.text);
  const j = r.json;
  const add = j.mapUpdates.find((u) => u.type === 'addToken');
  assert.deepEqual([add.maxHp, add.ac, add.speed, add.monster], [7, 15, 30, 'goblin']);
  assert.ok(j.mapUpdates.some((u) => u.type === 'startCombat'));
  assert.ok(!j.mapUpdates.some((u) => ['journal', 'gear', 'updateCharacter', 'changeMap'].includes(u.type)), 'server-side updates are not passed to the table as board updates');
  assert.ok(j.characterProblems.some((p) => /atlantis/.test(p)));
  assert.ok(j.characterProblems.some((p) => /ghost/.test(p)));
  assert.deepEqual(j.journalAdded, [{ category: 'event', title: 'Goblin ambush' }]);
  assert.equal(j.characterUpdates.length, 1);
  assert.ok(j.partyNotes.some((n) => /\+5 gp/.test(n)));
  assert.equal(j.voiceLines.length, 1, 'with no voice lines the narrative is spoken as one line');
  const after = (await s.get('/api/characters')).json.find((c) => c.id === 'edric');
  assert.equal(after.coins.gp, before.coins.gp + 5); assert.equal(after.sheet.XP, '50');
  assert.equal((await s.get(`/api/campaigns/${LOST}/journal`)).json.entries.at(-1).title, 'Goblin ambush');
  // the journal now goes to the DM
  await s.post('/api/chat', { message: 'next' });
  assert.ok(fake.requests.at(-1).system.some((b) => /Goblin ambush/.test(b.text)));
});

test('a valid changeMap resolves to a picture url and arrival square', async () => {
  setReply({ ...reply, mapUpdates: [{ type: 'changeMap', mapId: 'cragmaw-hideout', arrive: 'start', reason: 'arrive' }] });
  const r = await s.post('/api/chat', { message: 'travel' });
  const m = r.json.mapUpdates[0];
  assert.equal(m.type, 'changeMap'); assert.match(m.mapUrl, /^\/uploads\/.*cragmaw-hideout/); assert.ok(Number.isInteger(m.col) && Number.isInteger(m.row));
  assert.deepEqual(r.json.characterProblems, []);
});

test('a refusal, an API error and a missing campaign are answered without crashing', async () => {
  setReply({ __stop: 'refusal', ...reply });
  const refused = await s.post('/api/chat', { message: 'x' }); assert.equal(refused.status, 200); assert.match(refused.json.narrative, /declines/);
  setReply({ __status: 400, __message: 'bad request from the fake' });
  const err = await s.post('/api/chat', { message: 'x' }); assert.equal(err.status, 502); assert.match(err.json.error, /AI DM error/);
  setReply({ narrative: 5 });
  const broken = await s.post('/api/chat', { message: 'x' });
  assert.ok(broken.status >= 200, 'the server still answers a malformed reply');
  setReply(reply);
  assert.equal((await s.get('/api/campaigns')).status, 200, 'the server is still alive');
});

test('with no campaign chosen the DM is not called (409)', async () => {
  const sb = await makeSandbox();
  await rm(path.join(sb.dir, 'data', 'campaigns', 'active.json'), { force: true });
  const f = await fakeAnthropic([reply]);
  const srv = await startServer({ sandbox: sb, env: { ANTHROPIC_API_KEY: 'sk-ant-fake', ANTHROPIC_BASE_URL: f.url } });
  try {
    assert.equal((await srv.get('/api/campaigns')).json.active, '');
    const r = await srv.post('/api/chat', { message: 'hi' });
    assert.equal(r.status, 409); assert.equal(f.requests.length, 0);
  } finally { await srv.stop(); await f.close(); }
});

test('usage: every DM call is counted (tokens and an estimated cost) in the session and the totals, and the totals can be reset', async () => {
  const before = (await s.get('/api/usage')).json;
  await s.post('/api/chat', { message: 'count this one' });
  await s.post('/api/chat', { message: 'and this one' });
  const after = (await s.get('/api/usage')).json;
  assert.equal(after.session.calls - before.session.calls, 2);
  assert.equal(after.total.calls - before.total.calls, 2);
  assert.equal(after.total.input - before.total.input, 20);      // the fake API reports 10 input and 5 output tokens per call
  assert.equal(after.total.output - before.total.output, 10);
  assert.ok(after.total.cost > before.total.cost, 'a cost estimate is added');
  assert.equal(after.estimate, true);
  assert.ok(after.byKind.dm.calls >= 2 && after.byCampaign[LOST].calls >= 2);
  const reset = (await s.post('/api/usage/reset')).json;
  assert.equal(reset.total.calls, 0); assert.equal(reset.session.calls, 0);
});

test('a second map change: arrival spots, pins and the module areas of the new map reach the DM and the creatures it places', async () => {
  // the first change: to a named arrival spot other than the start (an arrival that is not a known spot falls back to the start)
  setReply({ ...reply, mapUpdates: [{ type: 'changeMap', mapId: 'cragmaw-hideout', arrive: 'start', reason: 'arrive' }] });
  const first = (await s.post('/api/chat', { message: 'go to the hideout' })).json.mapUpdates[0];
  setReply({ ...reply, mapUpdates: [{ type: 'changeMap', mapId: 'wave-echo-cave', arrive: 'start', reason: 'arrive' }] });
  const second = (await s.post('/api/chat', { message: 'go on to the cave' })).json.mapUpdates[0];
  assert.match(second.mapUrl, /wave-echo-cave/); assert.notEqual(second.mapUrl, first.mapUrl);
  assert.ok(Number.isInteger(second.col) && Number.isInteger(second.row) && second.col >= 0 && second.row >= 0);
  assert.ok(second.mapName && second.kind, 'the table is told the name and kind of the new place');
  // the table then sends the pins of that map; the DM must be given them
  setReply(reply);
  await s.post('/api/chat', {
    message: 'look around', mapUrl: second.mapUrl,
    areas: [{ area: 1, name: 'Cave Entrance', col: 12, row: 40 }, { area: 8, name: 'Fungi Cavern', col: 30, row: 22 }],
    places: [{ name: 'old-entrance', note: 'a second way in', col: 5, row: 60 }]
  });
  const board = boardStateOf(fake.requests.at(-1));
  assert.deepEqual(board.moduleAreas.map((a) => [a.area, a.name, a.col, a.row]), [[1, 'Cave Entrance', 12, 40], [8, 'Fungi Cavern', 30, 22]]);
  assert.deepEqual(board.mapPlaces.map((p) => [p.name, p.col, p.row]), [['old-entrance', 5, 60]]);
  // a creature the DM adds on a module area keeps the square it asked for
  setReply({ ...reply, mapUpdates: [{ type: 'token', action: 'add', tokenId: 'g9', name: 'Goblin 9', col: 30, row: 22, color: '#0a0', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: 'goblin', value: 0, ac: 0 }] });
  const add = (await s.post('/api/chat', { message: 'the goblins appear' })).json.mapUpdates.find((u) => u.type === 'addToken');
  assert.deepEqual([add.col, add.row, add.maxHp], [30, 22, 7]);
  // an unknown map id is reported, not followed
  setReply({ ...reply, mapUpdates: [{ type: 'changeMap', mapId: 'moon-base', arrive: 'start', reason: 'x' }] });
  const bad = await s.post('/api/chat', { message: 'to the moon' });
  assert.ok(bad.json.characterProblems.some((p) => /moon-base/.test(p)));
  assert.ok(!bad.json.mapUpdates.some((u) => u.type === 'changeMap'));
});
