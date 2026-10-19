// Which module chapters the DM reads on each map (lib/module-select.js, data/campaigns/<id>/relevance.json).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { selectDocuments, filteredNote } from '../lib/module-select.js';
import { startServer, fakeAnthropic } from './helpers/sandbox.mjs';

const dir = new URL('../data/campaigns/lost-mine-of-phandelver/', import.meta.url);
const relevance = JSON.parse(readFileSync(new URL('relevance.json', dir), 'utf8'));
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).map((name) => ({ name, text: 'x'.repeat(statSync(new URL(name, dir)).size) }));
const chars = (list) => list.reduce((n, f) => n + f.text.length, 0);

test('every file the relevance list names exists, and every map of the campaign is listed', () => {
  const names = new Set(files.map((f) => f.name));
  for (const n of [...relevance.always, ...Object.values(relevance.byMap).flat()]) assert.ok(names.has(n), n + ' is not a document of the campaign');
  const maps = JSON.parse(readFileSync(new URL('maps.json', dir), 'utf8')); const list = Array.isArray(maps) ? maps : maps.maps;
  for (const m of list) assert.ok(Object.hasOwn(relevance.byMap, m.id), m.id + ' has no entry: it would send the whole module');
});

test('a goblin ambush reads its own chapter and the basics, not the other places', () => {
  const r = selectDocuments(files, relevance, 'triboar-ambush');
  assert.equal(r.filtered, true);
  const got = r.files.map((f) => f.name);
  assert.ok(got.includes('05-part-1-goblin-arrows.md') && got.includes('21-rules-index.md'));
  assert.ok(!got.includes('16-part-4-wave-echo-cave.md') && !got.includes('10-redbrand-hideout.md') && !got.includes('06-cragmaw-hideout.md'));
  assert.ok(chars(r.files) < chars(files) * 0.2, `${chars(r.files)} of ${chars(files)} characters`);
  assert.ok(r.left.includes('16-part-4-wave-echo-cave.md'));
  assert.match(filteredNote(r.left), /16-part-4-wave-echo-cave\.md/);
});

test('with no list, an unknown map or a list that matches nothing, everything is sent', () => {
  assert.equal(selectDocuments(files, null, 'triboar-ambush').files.length, files.length);
  assert.equal(selectDocuments(files, relevance, 'a-map-nobody-listed').filtered, false);
  assert.equal(selectDocuments(files, relevance, '').files.length, files.length);
  assert.equal(selectDocuments(files, { always: ['nope.md'], byMap: { m: ['nope2.md'] } }, 'm').files.length, files.length);
  assert.equal(selectDocuments(files, { always: [] }, 'm').filtered, false);
});

let fake, s;
before(async () => {
  fake = await fakeAnthropic([{ rolls: [], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'Ok.' }], mapUpdates: [] }]);
  s = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' });
});
after(async () => { await s.stop(); await fake.close(); });

test('/api/chat sends the chapters of the current map only, and the other map\'s chapters when the party is there', async () => {
  const body = (url) => ({ message: '[Edric] I look around', history: [], tokens: [], characters: [], walls: [], mapUrl: url });
  await s.post('/api/chat', body('/uploads/vtt-pack-goblin-ambush-copy.png'));
  const text = (req) => req.system.map((b) => b.text).join('\n');
  const a = text(fake.requests.at(-1));
  assert.match(a, /CAMPAIGN DOCUMENT: 05-part-1-goblin-arrows\.md/); assert.doesNotMatch(a, /CAMPAIGN DOCUMENT: 16-part-4-wave-echo-cave\.md/);
  assert.match(a, /Only the chapters for the place the party is in are shown/);
  await s.post('/api/chat', body('/uploads/vtt-pack-wave-echo-cave-copy.png'));
  const b = text(fake.requests.at(-1));
  assert.match(b, /CAMPAIGN DOCUMENT: 16-part-4-wave-echo-cave\.md/); assert.doesNotMatch(b, /CAMPAIGN DOCUMENT: 05-part-1-goblin-arrows\.md/);
  await s.post('/api/chat', body('/uploads/some-picture-nobody-listed.png'));
  assert.match(text(fake.requests.at(-1)), /CAMPAIGN DOCUMENT: 16-part-4-wave-echo-cave\.md/, 'an unknown map gets the whole module');
  const ambush = fake.requests[fake.requests.length - 3].system.reduce((n, x) => n + x.text.length, 0), all = fake.requests.at(-1).system.reduce((n, x) => n + x.text.length, 0);
  assert.ok(ambush < all * 0.5, `the goblin ambush prompt is ${ambush} characters, the whole module ${all}`);
});

test('a fight reads the rules index and the map\'s own chapter only, the areas near the tokens when the map has them, and a shorter set of instructions', async () => {
  const tok = (o) => ({ id: 'x', name: 'X', col: 1, row: 1, color: '#fff', isPC: false, hidden: false, kind: 'creature', visibleToParty: true, ...o });
  const system = (req) => req.system.map((b) => b.text).join('\n');
  const body = (extra) => ({ message: '[Edric] I attack', history: [], characters: [], walls: [], ...extra });
  // a fight at the goblin ambush: no story chapters, the map's chapter and the rules index stay
  await s.post('/api/chat', body({ mapUrl: '/uploads/vtt-pack-goblin-ambush-copy.png', combat: { active: true, round: 1, currentTokenId: 'pc1', order: [] }, tokens: [tok({ id: 'pc1', name: 'Edric', isPC: true }), tok({ id: 'g1', name: 'Goblin 1', monster: 'goblin', col: 5, row: 5 })] }));
  const fight = system(fake.requests.at(-1));
  assert.doesNotMatch(fight, /CAMPAIGN DOCUMENT: 02-introduction\.md/); assert.doesNotMatch(fight, /CAMPAIGN DOCUMENT: 04-adventure-hook\.md/);
  assert.match(fight, /CAMPAIGN DOCUMENT: 05-part-1-goblin-arrows\.md/); assert.match(fight, /CAMPAIGN DOCUMENT: 21-rules-index\.md/);
  assert.match(fight, /a fight is on/);
  assert.doesNotMatch(fight, /Changing maps: the board state lists the maps/); assert.match(fight, /Combat: the table has a combat tracker/, 'the combat rules stay');
  // the same map outside a fight reads the story chapters and the full instructions
  await s.post('/api/chat', body({ mapUrl: '/uploads/vtt-pack-goblin-ambush-copy.png', tokens: [tok({ id: 'pc1', name: 'Edric', isPC: true })] }));
  const calm = system(fake.requests.at(-1));
  assert.match(calm, /CAMPAIGN DOCUMENT: 02-introduction\.md/); assert.match(calm, /Changing maps: the board state lists the maps/);
  assert.ok(fight.length < calm.length * 0.8, `${fight.length} against ${calm.length}`);
  // a fight in Cragmaw Hideout: only the sections of the areas the tokens are near, and they stay once they have been read
  const pins = [{ area: 1, name: 'Cave Mouth', col: 6, row: 6 }, { area: 2, name: 'Goblin Blind', col: 10, row: 6 }, { area: 7, name: 'Twin Pools Cave', col: 60, row: 60 }];
  const fightAt = (col, row) => s.post('/api/chat', body({ mapUrl: '/uploads/vtt-pack-cragmaw-hideout-copy.png', areas: pins, combat: { active: true, round: 1, currentTokenId: 'pc1', order: [] }, tokens: [tok({ id: 'pc1', name: 'Edric', isPC: true, col, row })] }));
  await fightAt(7, 7);
  const first = system(fake.requests.at(-1));
  assert.match(first, /## 1\. CAVE MOUTH/); assert.match(first, /## 2\. GOBLIN BLIND/); assert.doesNotMatch(first, /## 7\. TWIN POOLS CAVE/); assert.doesNotMatch(first, /## 5\. OVERPASS/);
  assert.match(first, /only areas 1, 2/);
  await fightAt(58, 58);
  const second = system(fake.requests.at(-1));
  assert.match(second, /## 7\. TWIN POOLS CAVE/); assert.match(second, /## 1\. CAVE MOUTH/, 'the areas already read stay while the fight lasts');
});
