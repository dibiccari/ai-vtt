// Gear changes end to end: the DM's flat `gear` updates in a /api/chat reply (against a FAKE Anthropic API, free and offline) are applied by the server to the character
// records and the shared stash: items added and stacked, removed, handed over, moved to the stash, worn and attuned (the limit of three), coins, and the effective stats and
// weight the Party page shows. Also checks what the DM is told about the party gear on the next turn.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic, boardStateOf } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';

const LOST = 'lost-mine-of-phandelver';
let fake, s;
const gear = (o) => ({ type: 'gear', action: 'add', target: ID.edric, to: '', name: '', qty: 1, weight: 0, requiresAttunement: false, effectKind: 'none', effectValue: 0, effectAbility: '', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...o });
const reply = (...updates) => ({ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'x' }], mapUpdates: updates });
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
  const j = await say(gear({ name: 'Potion of healing', qty: 2, weight: 1 }), gear({ name: 'Potion of healing', qty: 1, weight: 1 }), gear({ target: ID.rachel, name: 'Rope, hempen (50 ft)', weight: 10 }));
  assert.ok(j.partyChanged.includes(ID.edric) && j.partyChanged.includes(ID.rachel), 'both characters are marked as changed');
  assert.ok(j.partyNotes.length >= 2);
  const edric = await character(ID.edric);
  assert.equal(item(edric, 'Potion of healing').qty, 3, 'the second add stacked onto the first');
  assert.ok(item(await character(ID.rachel), 'Rope, hempen (50 ft)'));
  assert.ok(!j.mapUpdates.some((u) => u.type === 'gear'), 'gear updates are server-side, not board updates');
});

test('coins: adding and spending, and the sheet boxes follow', async () => {
  const before = (await character(ID.edric)).coins;
  const j = await say(gear({ action: 'coins', gp: 12, sp: 5 }), gear({ action: 'coins', gp: -2 }));
  const after = await character(ID.edric);
  assert.equal(after.coins.gp, before.gp + 10); assert.equal(after.coins.sp, before.sp + 5);
  assert.equal(String(after.sheet.GP), String(after.coins.gp), 'the official sheet box matches');
  assert.ok(j.partyNotes.some((n) => /gp/.test(n)));
});

test('remove: some of a stack, then the rest; removing something that is not there is a problem, not a crash', async () => {
  await say(gear({ action: 'remove', name: 'Potion of healing', qty: 1 }));
  assert.equal(item(await character(ID.edric), 'Potion of healing').qty, 2);
  await say(gear({ action: 'remove', name: 'Potion of healing', qty: 5 }));
  assert.equal(item(await character(ID.edric), 'Potion of healing'), undefined, 'asking for more than the stack removes it');
  const j = await say(gear({ action: 'remove', name: 'Vorpal sword' }));
  assert.equal(j.mapUpdates.length, 0);
  assert.ok(j.characterProblems.some((p) => /Vorpal sword/i.test(p)) || j.partyNotes.length === 0, 'a missing item is reported or ignored');
});

test('move: an item goes from one character to another and to the shared stash and back', async () => {
  await say(gear({ name: 'Lantern, hooded', weight: 2 }));
  await say(gear({ action: 'move', target: ID.edric, to: ID.rachel, name: 'Lantern, hooded', qty: 1 }));
  assert.equal(item(await character(ID.edric), 'Lantern, hooded'), undefined);
  assert.ok(item(await character(ID.rachel), 'Lantern, hooded'));
  await say(gear({ action: 'move', target: ID.rachel, to: 'stash', name: 'Lantern, hooded', qty: 1 }));
  const p1 = await party();
  assert.ok(p1.stash.items.some((i) => i.name === 'Lantern, hooded'), 'the stash has it');
  assert.equal(item(await character(ID.rachel), 'Lantern, hooded'), undefined);
  await say(gear({ action: 'move', target: 'stash', to: ID.edric, name: 'Lantern, hooded', qty: 1 }));
  assert.ok(item(await character(ID.edric), 'Lantern, hooded'));
  assert.ok(!(await party()).stash.items.some((i) => i.name === 'Lantern, hooded'));
});

test('attunement: a ring of protection counts only when worn and attuned; the limit is three items', async () => {
  await say(gear({ name: 'Ring of protection', requiresAttunement: true, effectKind: 'ac', effectValue: 1 }));
  const unworn = (await party()).characters.find((c) => c.id === ID.edric);
  const acBefore = unworn.effective.ac;
  await say(gear({ action: 'attune', name: 'Ring of protection' }));
  const ring = item(await character(ID.edric), 'Ring of protection');
  assert.equal(ring.attuned, true);
  const worn = (await party()).characters.find((c) => c.id === ID.edric);
  assert.equal(worn.effective.ac, acBefore + 1, 'a worn, attuned ring of protection adds +1 Armor Class (equipped: ' + ring.equipped + ')');
  // three more items that need attunement: only two more fit
  for (const n of ['Cloak A', 'Cloak B', 'Cloak C']) await say(gear({ name: n, requiresAttunement: true }));
  for (const n of ['Cloak A', 'Cloak B', 'Cloak C']) await say(gear({ action: 'attune', name: n }));
  const attuned = (await character(ID.edric)).inventory.filter((i) => i.attuned);
  assert.equal(attuned.length, 3, 'never more than three attuned items');
  await say(gear({ action: 'unattune', name: 'Ring of protection' }));
  assert.equal(item(await character(ID.edric), 'Ring of protection').attuned, false);
  await say(gear({ action: 'attune', name: 'Cloak C' }));
  assert.equal((await character(ID.edric)).inventory.filter((i) => i.attuned).length, 3, 'a freed slot can be filled');
});

test('the DM is told the party gear on the next turn (inventory, coins, effective stats)', async () => {
  fake.__set(reply());
  await s.post('/api/chat', { message: 'what do we carry?' });
  const board = boardStateOf(fake.requests.at(-1));
  const edric = board.party.characters.find((c) => c.id === ID.edric);
  assert.ok(edric && (edric.inventory || []).length > 0, 'the party block lists gear');
  assert.ok(JSON.stringify(edric).includes('Ring of protection'));
  assert.ok(board.party.stash);
});

test('buy: the table prices it, pays with change, adds the item and updates armor class and attacks; a buyer who cannot pay is refused', async () => {
  const c0 = await character(ID.astarion);           // a rogue in leather armor, 15 gp
  assert.equal(c0.coins.gp, 15);
  // 1. a dagger at the SRD price (2 gp), wielded: it takes a free attack line
  let j = await say(gear({ action: 'buy', target: ID.astarion, name: 'Dagger', qty: 1 }));
  assert.match(j.partyNotes.join(' '), /bought 1 × Dagger for 2 gp/i);
  let c = await character(ID.astarion);
  assert.equal(c.coins.gp, 13); assert.ok(item(c, 'Dagger')); assert.equal(c.sheet.GP, '13');
  // 2. armor he cannot afford: refused, nothing changes
  j = await say(gear({ action: 'buy', target: ID.astarion, name: 'Plate', qty: 1 }));
  assert.match(j.characterProblems.join(' '), /Not enough coin/);
  c = await character(ID.astarion);
  assert.equal(c.coins.gp, 13); assert.ok(!item(c, 'Plate Armor') && !item(c, 'Plate'));
  // 3. a price the DM names (a haggled 5 sp for a rope), with no SRD match needed
  j = await say(gear({ action: 'buy', target: ID.astarion, name: 'Wax-sealed letter', qty: 1, weight: 0, cp: 50 }));
  c = await character(ID.astarion);
  assert.equal(c.coins.gp, 12); assert.equal(c.coins.sp, 5, '13 gp minus 5 sp: the change comes back in silver');
  // 4. no price at all: told to send one
  j = await say(gear({ action: 'buy', target: ID.astarion, name: 'Mystery trinket', qty: 1 }));
  assert.match(j.characterProblems.join(' '), /no price/i);
  // 5. armor he can afford while already wearing armor goes in the pack, armor class unchanged
  await say(gear({ action: 'coins', target: ID.astarion, gp: 100 }));
  const acBefore = (await party()).characters.find((x) => x.id === ID.astarion).effective.ac;
  j = await say(gear({ action: 'buy', target: ID.astarion, name: 'Chain mail', qty: 1 }));
  assert.match(j.partyNotes.join(' '), /in the pack, not worn/);
  assert.equal((await party()).characters.find((x) => x.id === ID.astarion).effective.ac, acBefore);
});

test('shop: the token action becomes an openShop update for the table, with the merchant, kinds of stock and markup', async () => {
  const tok = (o) => ({ type: 'token', action: 'shop', tokenId: 'tok-' + ID.edric, name: '', col: 0, row: 0, value: 0, condition: '', ...o });
  const j = await say(tok({ condition: 'Hurdred the smith: Weapon, Armor', value: 120 }), tok({ condition: '' }));
  const shops = j.mapUpdates.filter((u) => u.type === 'openShop');
  assert.equal(shops.length, 2);
  assert.deepEqual([shops[0].merchant, shops[0].groups, shops[0].markup], ['Hurdred the smith', ['Weapon', 'Armor'], 120]);
  assert.deepEqual([shops[1].merchant, shops[1].groups, shops[1].markup], ['A merchant', [], 100]);
});

test('light from gear: the DM is told what each character carries that gives light, and how it is turned on', async () => {
  await say(gear({ name: 'Flame Tongue', qty: 1, weight: 3 }), gear({ name: 'Torch', qty: 2, weight: 1 }));
  fake.__set(reply());
  await s.post('/api/chat', { message: 'what gives us light?' });
  const board = boardStateOf(fake.requests.at(-1));
  const edric = board.party.characters.find((c) => c.id === ID.edric);
  const by = (kind) => (edric.lightItems || []).find((l) => l.kind === kind);
  assert.ok(by('flame-tongue') && by('flame-tongue').bright === 40 && by('flame-tongue').dim === 80 && by('flame-tongue').mode === 'lit' && /bonus action/.test(by('flame-tongue').how), JSON.stringify(edric.lightItems));
  assert.ok(by('torch') && by('torch').bright === 20, 'a torch counts too');
  assert.ok(!(board.party.characters.find((c) => c.id === ID.rachel).lightItems || []).some((l) => l.kind === 'flame-tongue'), 'only the character who carries it');
});

test('give: an item moves to another character or the stash and both sheets follow (armor class), a missing item is refused', async () => {
  await say(gear({ name: 'Chain mail', qty: 1, weight: 55 }), gear({ name: 'Rope, hempen (50 feet)', qty: 2, weight: 10 }));
  const before = await character(ID.edric);
  assert.ok(item(before, 'Chain mail'), 'Edric holds the armor');
  const acWith = before.ac;
  const r = await s.post('/api/party/give', { from: ID.edric, to: ID.rachel, name: 'Chain mail', qty: item(before, 'Chain mail').qty });
  assert.equal(r.status, 200, r.text);
  const edric = await character(ID.edric), rachel = await character(ID.rachel);
  assert.ok(!item(edric, 'Chain mail') && item(rachel, 'Chain mail'), 'it changed hands');
  assert.ok(edric.ac < acWith, 'the giver\'s armor class dropped with the armor: ' + acWith + ' to ' + edric.ac);
  const toStash = await s.post('/api/party/give', { from: ID.edric, to: 'stash', name: 'Rope, hempen (50 feet)', qty: 1 });
  assert.equal(toStash.status, 200, toStash.text);
  assert.equal(item(await character(ID.edric), 'Rope, hempen (50 feet)').qty, 1, 'one of two left');
  assert.ok((await party()).stash.items.some((i) => /rope/i.test(i.name)), 'the stash has it');
  const none = await s.post('/api/party/give', { from: ID.edric, to: ID.rachel, name: 'Vorpal sword', qty: 1 });
  assert.equal(none.status, 400, 'an item that is not there is refused');
  assert.equal((await s.post('/api/party/give', { from: ID.edric, to: ID.edric, name: 'Torch', qty: 1 })).status, 400, 'not to oneself');
});
