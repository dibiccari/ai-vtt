// Gear changes end to end: the DM's flat `gear` updates in a /api/chat reply (against a FAKE Anthropic API, free and offline) are applied by the server to the character
// records and the shared stash: items added and stacked, removed, handed over, moved to the stash, worn and attuned (the limit of three), coins, and the effective stats and
// weight the Party page shows. Also checks what the DM is told about the party gear on the next turn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic, boardStateOf } from './helpers/sandbox.mjs';

const LOST = 'lost-mine-of-phandelver';
let fake, s;
const gear = (o) => ({ type: 'gear', action: 'add', target: 'edric', to: '', name: '', qty: 1, weight: 0, requiresAttunement: false, effectKind: 'none', effectValue: 0, effectAbility: '', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...o });
const reply = (...updates) => ({ rolls: [], narrative: 'The party sorts its gear.', voiceLines: [], mapUpdates: updates });
const say = async (...updates) => { fake.__set(reply(...updates)); const r = await s.post('/api/chat', { message: 'gear' }); assert.equal(r.status, 200, r.text); return r.json; };
const character = async (id) => (await s.get('/api/characters')).json.find((c) => c.id === id);
const party = async () => (await s.get('/api/party')).json;
const item = (c, name) => (c.inventory || []).find((i) => i.name === name);

before(async () => {
  fake = await fakeAnthropic([reply()]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: LOST });
});
after(async () => { await s.stop(); await fake.close(); });

test('add: a new item lands in the inventory, the same name stacks, and the table is told', async () => {
  const j = await say(gear({ name: 'Potion of healing', qty: 2, weight: 1 }), gear({ name: 'Potion of healing', qty: 1, weight: 1 }), gear({ target: 'rachel', name: 'Rope, hempen (50 ft)', weight: 10 }));
  assert.ok(j.partyChanged.includes('edric') && j.partyChanged.includes('rachel'), 'both characters are marked as changed');
  assert.ok(j.partyNotes.length >= 2);
  const edric = await character('edric');
  assert.equal(item(edric, 'Potion of healing').qty, 3, 'the second add stacked onto the first');
  assert.ok(item(await character('rachel'), 'Rope, hempen (50 ft)'));
  assert.ok(!j.mapUpdates.some((u) => u.type === 'gear'), 'gear updates are server-side, not board updates');
});

test('coins: adding and spending, and the sheet boxes follow', async () => {
  const before = (await character('edric')).coins;
  const j = await say(gear({ action: 'coins', gp: 12, sp: 5 }), gear({ action: 'coins', gp: -2 }));
  const after = await character('edric');
  assert.equal(after.coins.gp, before.gp + 10); assert.equal(after.coins.sp, before.sp + 5);
  assert.equal(String(after.sheet.GP), String(after.coins.gp), 'the official sheet box matches');
  assert.ok(j.partyNotes.some((n) => /gp/.test(n)));
});

test('remove: some of a stack, then the rest; removing something that is not there is a problem, not a crash', async () => {
  await say(gear({ action: 'remove', name: 'Potion of healing', qty: 1 }));
  assert.equal(item(await character('edric'), 'Potion of healing').qty, 2);
  await say(gear({ action: 'remove', name: 'Potion of healing', qty: 5 }));
  assert.equal(item(await character('edric'), 'Potion of healing'), undefined, 'asking for more than the stack removes it');
  const j = await say(gear({ action: 'remove', name: 'Vorpal sword' }));
  assert.equal(j.mapUpdates.length, 0);
  assert.ok(j.characterProblems.some((p) => /Vorpal sword/i.test(p)) || j.partyNotes.length === 0, 'a missing item is reported or ignored');
});

test('move: an item goes from one character to another and to the shared stash and back', async () => {
  await say(gear({ name: 'Lantern, hooded', weight: 2 }));
  await say(gear({ action: 'move', target: 'edric', to: 'rachel', name: 'Lantern, hooded', qty: 1 }));
  assert.equal(item(await character('edric'), 'Lantern, hooded'), undefined);
  assert.ok(item(await character('rachel'), 'Lantern, hooded'));
  await say(gear({ action: 'move', target: 'rachel', to: 'stash', name: 'Lantern, hooded', qty: 1 }));
  const p1 = await party();
  assert.ok(p1.stash.items.some((i) => i.name === 'Lantern, hooded'), 'the stash has it');
  assert.equal(item(await character('rachel'), 'Lantern, hooded'), undefined);
  await say(gear({ action: 'move', target: 'stash', to: 'edric', name: 'Lantern, hooded', qty: 1 }));
  assert.ok(item(await character('edric'), 'Lantern, hooded'));
  assert.ok(!(await party()).stash.items.some((i) => i.name === 'Lantern, hooded'));
});

test('attunement: a ring of protection counts only when worn and attuned; the limit is three items', async () => {
  await say(gear({ name: 'Ring of protection', requiresAttunement: true, effectKind: 'ac', effectValue: 1 }));
  const unworn = (await party()).characters.find((c) => c.id === 'edric');
  const acBefore = unworn.effective.ac;
  await say(gear({ action: 'attune', name: 'Ring of protection' }));
  const ring = item(await character('edric'), 'Ring of protection');
  assert.equal(ring.attuned, true);
  const worn = (await party()).characters.find((c) => c.id === 'edric');
  assert.equal(worn.effective.ac, acBefore + 1, 'a worn, attuned ring of protection adds +1 Armor Class (equipped: ' + ring.equipped + ')');
  // three more items that need attunement: only two more fit
  for (const n of ['Cloak A', 'Cloak B', 'Cloak C']) await say(gear({ name: n, requiresAttunement: true }));
  for (const n of ['Cloak A', 'Cloak B', 'Cloak C']) await say(gear({ action: 'attune', name: n }));
  const attuned = (await character('edric')).inventory.filter((i) => i.attuned);
  assert.equal(attuned.length, 3, 'never more than three attuned items');
  await say(gear({ action: 'unattune', name: 'Ring of protection' }));
  assert.equal(item(await character('edric'), 'Ring of protection').attuned, false);
  await say(gear({ action: 'attune', name: 'Cloak C' }));
  assert.equal((await character('edric')).inventory.filter((i) => i.attuned).length, 3, 'a freed slot can be filled');
});

test('the DM is told the party gear on the next turn (inventory, coins, effective stats)', async () => {
  fake.__set(reply());
  await s.post('/api/chat', { message: 'what do we carry?' });
  const board = boardStateOf(fake.requests.at(-1));
  const edric = board.party.characters.find((c) => c.id === 'edric');
  assert.ok(edric && (edric.inventory || []).length > 0, 'the party block lists gear');
  assert.ok(JSON.stringify(edric).includes('Ring of protection'));
  assert.ok(board.party.stash);
});
