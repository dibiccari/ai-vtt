// The Map Maker wizard's server side: an idea ("Surprise me"), a layout from a description (checked, and fixed once if it is not playable), and a hand-edited grid checked again.
// Against a pretend Anthropic API: free and offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';

const GOOD = ['##########', '#P.......#', '#........#', '######D###', '#........#', '#..L...E.#', '#..O.....#', '##########'];
const LOST = ['##########', '#P.......#', '#........#', '##########', '#........#', '#........#', '#........#', '##########'];
const reply = (rows, extra = {}) => ({ name: 'Test hall', summary: 'Two rooms and a door.', rows, ...extra });

let fake, s, none;
before(async () => {
  fake = await fakeAnthropic([reply(GOOD)]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  none = await startServer();
});
after(async () => { await s.stop(); await none.stop(); await fake.close(); });
const designer = (n = 0) => fake.requests.filter((r) => /battle maps/.test(JSON.stringify(r.system || ''))).slice(n);

test('a description becomes a checked layout with an SVG, and says what it cost', async () => {
  fake.__set(reply(GOOD)); fake.requests.length = 0;
  const r = await s.post('/api/map-maker/layout', { description: 'a small keep with a guard room and a storeroom', cols: 10, rows: 8 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true); assert.deepEqual(r.json.grid, GOOD); assert.equal(r.json.name, 'Test hall'); assert.equal(r.json.attempts, 1);
  assert.match(r.json.svg, /<svg[^>]+data-cols="10"/); assert.equal(typeof r.json.cost, 'number'); assert.ok(r.json.legend.length >= 9);
  const req = designer()[0];
  assert.match(JSON.stringify(req.messages), /small keep with a guard room/); assert.match(JSON.stringify(req.system), /exactly 10 characters wide and 8 rows tall/);
  assert.equal(req.model, 'claude-sonnet-5-5', 'a mid-priced model, not Opus');
});

test('a layout with a room nothing connects to is sent back once with what is wrong, and the corrected one is used', async () => {
  fake.__set((req) => (JSON.stringify(req.messages).includes('The grid has problems') ? reply(GOOD) : reply(LOST))); fake.requests.length = 0;
  const r = await s.post('/api/map-maker/layout', { description: 'two rooms', cols: 10, rows: 8 });
  assert.equal(r.json.ok, true); assert.equal(r.json.attempts, 2); assert.deepEqual(r.json.grid, GOOD);
  assert.match(JSON.stringify(designer()[1].messages), /cannot be reached from the party start/);
});

test('a layout the model cannot fix is still returned, with its problems, so the person can edit it', async () => {
  fake.__set(reply(LOST));
  const r = await s.post('/api/map-maker/layout', { description: 'two rooms', cols: 10, rows: 8 });
  assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.attempts, 2);
  assert.ok(r.json.problems.some((p) => p.level === 'error' && /cannot be reached/.test(p.text)));
  assert.ok(r.json.svg.length > 100, 'there is still something to look at and fix');
});

test('a hand-edited grid is checked and drawn again without calling the AI', async () => {
  fake.requests.length = 0;
  const bad = await s.post('/api/map-maker/layout/check', { grid: LOST });
  assert.equal(bad.json.ok, false);
  const fixed = await s.post('/api/map-maker/layout/check', { grid: LOST.map((r, i) => (i === 3 ? '#####D####' : r)) });
  assert.equal(fixed.json.ok, true, JSON.stringify(fixed.json.problems)); assert.equal(fixed.json.stats.doors, 1);
  assert.equal((await s.post('/api/map-maker/layout/check', { grid: GOOD.join('\n') })).json.ok, true, 'a string with line breaks works too');
  assert.equal(fake.requests.length, 0, 'no AI call');
});

test('the idea button asks the cheap model for the kind of map, and a missing description or key is said plainly', async () => {
  fake.__set({ description: 'x' }); fake.requests.length = 0;
  const r = await s.post('/api/map-maker/surprise', { kind: 'regional' });
  assert.equal(r.status, 200); assert.equal(typeof r.json.description, 'string'); assert.ok(r.json.description.length > 0);
  assert.equal(fake.requests[0].model, 'claude-haiku-5-5'); assert.match(JSON.stringify(fake.requests[0]), /regional map idea/); assert.match(JSON.stringify(fake.requests[0].system), /overland region/);
  assert.equal((await s.post('/api/map-maker/layout', { description: '  ' })).status, 400);
  const nokey = await none.post('/api/map-maker/surprise', { kind: 'battle' });
  assert.equal(nokey.status, 503); assert.equal(nokey.json.help.url, '/settings.html');
});

test('an out-of-credit error comes back with the provider help the page needs for its banner', async () => {
  fake.__set({ __status: 400, __message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' });
  const r = await s.post('/api/map-maker/layout', { description: 'a keep', cols: 10, rows: 8 });
  assert.equal(r.status, 502); assert.equal(r.json.code, 'credit'); assert.match(r.json.help.url, /console\.anthropic\.com\/settings\/billing/);
});

test('the wizard asks for a size by name and orientation, and says what is on offer', async () => {
  const o = (await s.get('/api/map-maker/options')).json;
  assert.deepEqual(o.kinds.map((k) => k.id), ['battle', 'town', 'regional']); assert.deepEqual(o.sizes.map((x) => x.id), ['small', 'medium', 'large', 'huge', 'enormous']);
  fake.__set(reply(GOOD)); fake.requests.length = 0;
  await s.post('/api/map-maker/layout', { description: 'a cave system', size: 'enormous', orientation: 'portrait' });
  assert.match(JSON.stringify(designer()[0].system), /exactly 64 characters wide and 96 rows tall/, 'enormous, turned on its side');
  fake.requests.length = 0;
  await s.post('/api/map-maker/layout', { description: 'a tavern', size: 'small' });
  assert.match(JSON.stringify(designer()[0].system), /exactly 30 characters wide and 20 rows tall/);
});

test('a change asked for in words sends the current grid and the sentence, keeps the size, and the answer is checked like any layout', async () => {
  const CHANGED = ['##########', '#P.......#', '#...O....#', '######D###', '#........#', '#..L...E.#', '#..O.....#', '##########'];
  fake.__set(reply(CHANGED, { name: 'Test hall' })); fake.requests.length = 0;
  const r = await s.post('/api/map-maker/layout/revise', { grid: GOOD, instruction: 'put a pillar in the upper room', description: 'a small keep' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.grid, CHANGED); assert.equal(r.json.ok, true); assert.equal(typeof r.json.cost, 'number');
  const req = designer()[0], asked = JSON.stringify(req.messages);
  assert.match(asked, /put a pillar in the upper room/); assert.match(asked, /#P\.\.\.\.\.\.\.#/); assert.match(asked, /a small keep/);
  assert.match(JSON.stringify(req.system), /exactly 10 characters wide and 8 rows tall/, 'the size of the map in front of the person is kept');
  // an unplayable answer is sent back once with its problems, as for a first design
  fake.__set((rq) => (rq.messages.length > 1 ? reply(CHANGED) : reply(LOST))); fake.requests.length = 0;
  const fixed = await s.post('/api/map-maker/layout/revise', { grid: GOOD, instruction: 'cut the door out' });
  assert.equal(fixed.json.attempts, 2); assert.equal(fixed.json.ok, true);
  // nothing to change, or no map to change
  assert.equal((await s.post('/api/map-maker/layout/revise', { grid: GOOD, instruction: '  ' })).status, 400);
  const none = await s.post('/api/map-maker/layout/revise', { grid: [], instruction: 'bigger' });
  assert.equal(none.status, 502); assert.match(none.json.error, /no layout/i);
});

test('the examples list offers the Cragmaw Hideout as a small map, written from the adventure text', async () => {
  const r = (await s.get('/api/map-maker/examples?kind=battle')).json;
  const ex = r.examples.find((e) => e.id === 'cragmaw-hideout');
  assert.equal(ex.size, 'small'); assert.equal(ex.orientation, 'landscape');
  for (const word of ['stream', 'kennel', 'Klarg', 'twin pools', 'goblin den', 'briar']) assert.match(ex.description.toLowerCase(), new RegExp(word.toLowerCase()), word);
  assert.ok(ex.description.length < 2500);
  assert.deepEqual((await s.get('/api/map-maker/examples?kind=town')).json.examples, [], 'only battle maps have one so far');
});

test('the designer is given room to think and write, and when it only thinks the person is told so plainly', async () => {
  const { tokenRoom } = await import('../lib/map-designer.js');
  assert.equal(tokenRoom(30, 20), 12720); assert.ok(tokenRoom(96, 64) <= 21000, 'under what the SDK allows without streaming'); assert.ok(tokenRoom(8, 8) > 12000);
  fake.__set(reply(GOOD)); fake.requests.length = 0;
  await s.post('/api/map-maker/layout', { description: 'a keep', size: 'small' });
  const asked = designer()[0]; assert.equal(asked.max_tokens, 12720); assert.equal(asked.output_config.effort, 'low');
  fake.__set({ __thinkingOnly: true });
  const r = await s.post('/api/map-maker/layout', { description: 'a keep', size: 'small' });
  assert.equal(r.status, 502); assert.match(r.json.error, /ran out of room while thinking/);
  fake.__set(reply(GOOD));
});

test('a grid a square or two off the size asked for is trimmed or padded to it; one far off is sent back', async () => {
  const { fitToSize } = await import('../lib/map-designer.js');
  const long = GOOD.map((r) => r + '#'), short = GOOD.slice(0, 7);
  const a = fitToSize(long, 10, 8); assert.equal(a.adjusted, true); assert.ok(a.rows.every((r) => r.length === 10) && a.rows.length === 8);
  const b = fitToSize(short, 10, 8); assert.equal(b.rows.length, 8); assert.equal(b.rows[7], '#'.repeat(10));
  assert.equal(fitToSize(GOOD, 10, 8).adjusted, false);
  assert.equal(fitToSize(GOOD, 30, 20).off > 2, true);
  // through the route: 11-wide rows come back as 10 wide with a warning and no length complaint; a 10 x 8 grid for a 30 x 20 map is sent back once
  fake.__set(reply(long)); fake.requests.length = 0;
  const r = await s.post('/api/map-maker/layout', { description: 'a keep', cols: 10, rows: 8 });
  assert.equal(r.json.cols, 10); assert.ok(r.json.problems.some((p) => /trimmed or padded/.test(p.text))); assert.ok(!r.json.problems.some((p) => /not all the same length/.test(p.text)));
  fake.__set(reply(GOOD)); fake.requests.length = 0;
  const far = await s.post('/api/map-maker/layout', { description: 'a keep', size: 'small' });
  assert.equal(far.json.attempts, 2, 'sent back once'); assert.equal(far.json.ok, false);
  assert.match(JSON.stringify(designer()[1].messages), /must be exactly 30 characters wide and 20 rows tall/);
  fake.__set(reply(GOOD));
});
