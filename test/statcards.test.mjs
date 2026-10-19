// Stat cards: the SRD numbers written out for the DM (lib/statcards.js) and how /api/chat puts them in the prompt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statCards, spellNamesOf, creatureCard, spellCard } from '../lib/statcards.js';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';

const monsters = JSON.parse(readFileSync(new URL('../data/srd/monsters.json', import.meta.url), 'utf8'));
const spells = JSON.parse(readFileSync(new URL('../data/srd/spells.json', import.meta.url), 'utf8'));
const mage = { name: 'Lyra', sheet: { 'Spells 1014': 'Fire Bolt', 'Spells 1015': 'Magic Missile', 'Spells 1016': 'Not A Real Spell', 'Spells 1023': 'Fireball (C)', 'CharacterName': 'Lyra' } };

test('a goblin card has the exact attacks, and a spell card the save, damage and duration', () => {
  const g = creatureCard(monsters.find((m) => m.index === 'goblin'));
  assert.match(g, /AC 15/); assert.match(g, /Scimitar: Melee Weapon Attack: \+4 to hit, reach 5 ft\./); assert.match(g, /Shortbow: Ranged Weapon Attack: \+4 to hit, range 80\/320 ft\./); assert.match(g, /Nimble Escape/);
  const f = spellCard(spells.find((s) => s.index === 'fireball'));
  assert.match(f, /Fireball \(3rd-level evocation\)/); assert.match(f, /range 150 feet/); assert.match(f, /save DEX, half on a success/); assert.match(f, /area sphere 20 ft/); assert.match(f, /8d6 at level 3/);
  const dragon = creatureCard(monsters.find((m) => m.index === 'adult-red-dragon'));
  assert.match(dragon, /Fire Breath \[recharge on roll 1d6 5\+\] \[DC 21 DEX/);
});

test('the spells a character has come from the sheet lines, and unknown names are left out', () => {
  assert.deepEqual(spellNamesOf(mage).sort(), ['Fire Bolt', 'Fireball', 'Magic Missile', 'Not A Real Spell'].sort());
  const r = statCards({ tokens: [], characters: [mage], monsters, spells });
  assert.equal(r.spellCount, 3); assert.match(r.spellsText, /Fire Bolt/); assert.match(r.spellsText, /Magic Missile/); assert.doesNotMatch(r.spellsText, /Not A Real Spell/);
  assert.equal(r.creaturesText, '');
});

test('creatures: one card per kind on the board, none for the party, the dead or custom creatures; their spells come along', () => {
  const tokens = [{ monster: 'goblin' }, { monster: 'goblin' }, { monster: 'acolyte' }, { monster: 'wolf', dead: true }, { monster: '', name: 'Klarg' }, { monster: 'goblin', isPC: true }];
  const r = statCards({ tokens, characters: [], monsters, spells });
  assert.equal(r.creatureCount, 2);
  assert.equal((r.creaturesText.match(/^Goblin \(/gm) || []).length, 1);
  assert.doesNotMatch(r.creaturesText, /Wolf/);
  assert.match(r.creaturesText, /Spells these creatures cast:/); assert.match(r.creaturesText, /Sacred Flame/); assert.match(r.creaturesText, /Bless/);
  assert.equal(statCards({ tokens: [], characters: [], monsters, spells }).creaturesText, '');
});

let fake, s;
before(async () => {
  fake = await fakeAnthropic([{ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'Ok.' }], mapUpdates: [] }]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' });
});
after(async () => { await s.stop(); await fake.close(); });

test('/api/chat puts the party spell cards (cached) and the creature cards (not cached) in the prompt', async () => {
  const tok = (o) => ({ id: 'x', name: 'X', col: 1, row: 1, color: '#fff', isPC: false, hidden: false, kind: 'creature', visibleToParty: true, ...o });
  const r = await s.post('/api/chat', { message: '[Lyra] I look around', history: [], tokens: [tok({ id: 'g1', name: 'Goblin 1', monster: 'goblin' }), tok({ id: 'pc1', name: 'Lyra', isPC: true })], characters: [mage], walls: [] });
  assert.equal(r.status, 200, r.text);
  const req = fake.requests.at(-1);
  const spellBlock = req.system.find((b) => /^SPELL CARDS/.test(b.text)), creatureBlock = req.system.find((b) => /^STAT CARDS/.test(b.text));
  assert.ok(spellBlock && spellBlock.cache_control, 'the party spells are a cached block');
  assert.match(spellBlock.text, /Magic Missile/);
  assert.ok(creatureBlock && !creatureBlock.cache_control, 'the creatures on the board change, so they are not cached');
  assert.match(creatureBlock.text, /Scimitar: Melee Weapon Attack: \+4 to hit/);
  assert.ok(req.system.findIndex((b) => b === spellBlock) < req.system.findIndex((b) => /CAMPAIGN JOURNAL/.test(b.text)), 'the cached spell block sits before the journal');
  assert.ok(req.system.some((b) => /Stat cards: when a STAT CARDS or SPELL CARDS block/.test(b.text)), 'the DM is told to use them');
  // nothing on the board and nobody with spells: no cards at all
  fake.requests.length = 0;
  await s.post('/api/chat', { message: '[Edric] hello', history: [], tokens: [tok({ id: 'pc2', name: 'Edric', isPC: true })], characters: [{ name: 'Edric', sheet: {} }], walls: [] });
  assert.ok(!fake.requests.at(-1).system.some((b) => /^(SPELL|STAT) CARDS/.test(b.text)));
});
