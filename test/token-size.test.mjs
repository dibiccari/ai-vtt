// Creature size, footprints, falls and flying speeds (public/token-size.js) and how the DM's token updates carry them (server.js expandTokenUpdates).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/token-size.js';
import { loadServerPieces } from '../scripts/dm-schema.mjs';
import { loadAdventureMonsters } from '../lib/adventure-monsters.js';
const TS = globalThis.TokenSize;
const { expandTokenUpdates, DM_SCHEMA } = loadServerPieces();

test('the 2014 space table: tiny, small and medium take one square, large 2x2, huge 3x3, gargantuan 4x4', () => {
  assert.deepEqual(['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].map(TS.squares), [1, 1, 1, 2, 3, 4]);
  assert.equal(TS.squares(undefined), 1); assert.equal(TS.squares('nonsense'), 1);
  assert.equal(TS.normalize('Large'), 'large'); assert.equal(TS.normalize('Huge beast'), 'huge');
  assert.equal(TS.drawScale('tiny'), 0.5); assert.equal(TS.drawScale('huge'), 3);
});

test('footprints: cells, overlap, edge-to-edge gap, centre, centring on a pin', () => {
  assert.equal(TS.cells(3, 4, 2).length, 4);
  assert.deepEqual(TS.cells(3, 4, 2).sort(), [[3, 4], [3, 5], [4, 4], [4, 5]]);
  const big = { col: 5, row: 5, n: 2 };
  assert.equal(TS.overlaps(big, { col: 6, row: 6, n: 1 }), true);
  assert.equal(TS.overlaps(big, { col: 7, row: 5, n: 1 }), false);
  assert.equal(TS.gap(big, { col: 7, row: 5, n: 1 }), 1, 'touching = 5 ft reach');
  assert.equal(TS.gap(big, { col: 8, row: 5, n: 1 }), 2);
  assert.equal(TS.gap(big, { col: 7, row: 7, n: 1 }), 1, 'a diagonal neighbour is adjacent');
  assert.equal(TS.gap({ col: 0, row: 0, n: 1 }, { col: 1, row: 0, n: 1 }), 1);
  assert.deepEqual(TS.centre(3, 3, 2), { x: 4, y: 4 }); assert.deepEqual(TS.centre(3, 3, 1), { x: 3.5, y: 3.5 });
  assert.deepEqual(TS.topLeftFor(10, 10, 1), { col: 10, row: 10 });
  assert.deepEqual(TS.topLeftFor(10, 10, 3), { col: 9, row: 9 }, 'a huge creature is centred exactly on the pin square');
  assert.deepEqual(TS.topLeftFor(10, 10, 2), { col: 10, row: 10 });
});

test('falling and melee reach by the book: 1d6 per 10 ft (max 20d6); a reach has to cover the height', () => {
  assert.deepEqual([0, 9, 10, 25, 200, 5000].map(TS.fallDice), [0, 0, 1, 2, 20, 20]);
  assert.equal(TS.meleeReaches(5, 1, 0), true);
  assert.equal(TS.meleeReaches(5, 1, 20), false, 'a 5 ft reach cannot hit someone 20 ft up');
  assert.equal(TS.meleeReaches(10, 1, 10), true);
  assert.equal(TS.meleeReaches(5, 2, 0), false);
});

test('speeds are read from SRD entries and the adventure file format', () => {
  assert.deepEqual(TS.parseSpeeds({ walk: '10 ft.', fly: '80 ft.' }), { walk: 10, fly: 80 });
  assert.deepEqual(TS.parseSpeeds({ walk: '30 ft.' }), { walk: 30, fly: 0 });
  assert.deepEqual(TS.parseSpeeds({ walk: '0 ft., fly 60 ft.' }), { walk: 0, fly: 60 });
});

test('the DM adds a creature: size and flying speed come from the SRD or the adventure stat block', async () => {
  const dir = new URL('../data/campaigns/lost-mine-of-phandelver', import.meta.url).pathname;
  const adv = await loadAdventureMonsters(dir);
  const add = (monster, extra = {}) => ({ type: 'token', action: 'add', tokenId: 't', name: '', col: 5, row: 5, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster, value: 0, ac: 0, ...extra });
  const [eagle, ghost, owlbear, dragon, goblin, tarrasque] = await Promise.all(['giant-eagle', 'ghost', 'owlbear', 'adult-red-dragon', 'goblin', 'tarrasque'].map(async (m) => (await expandTokenUpdates([add(m)], adv))[0]));
  assert.deepEqual([eagle.size, eagle.flySpeed, eagle.speed], ['large', 80, 10]);
  assert.deepEqual([ghost.size, ghost.flySpeed, ghost.speed, ghost.hover], ['medium', 40, 0, true]);
  assert.equal(owlbear.size, 'large'); assert.equal(dragon.size, 'huge'); assert.equal(goblin.size, 'small'); assert.equal(tarrasque.size, 'gargantuan');
  const [skull, mormesk, ruffian, twig] = await Promise.all(['flameskull', 'mormesk-the-wraith', 'redbrand-ruffian', 'twig-blight'].map(async (m) => (await expandTokenUpdates([add(m)], adv))[0]));
  assert.deepEqual([skull.size, skull.flySpeed, skull.speed], ['tiny', 40, 0]);
  assert.deepEqual([mormesk.flySpeed, mormesk.speed], [60, 0]);
  assert.equal(ruffian.size, 'medium'); assert.equal(twig.size, 'small');
  const custom = (await expandTokenUpdates([add('', { condition: 'Large', value: 40, ac: 12 })], adv))[0];
  assert.equal(custom.size, 'large', 'a creature that is not in a stat block gets its size from condition');
  assert.equal((await expandTokenUpdates([add('')], adv))[0].size, 'medium');
});

test('the DM can raise a token (elevate) and change its size (resize)', async () => {
  const out = await expandTokenUpdates([
    { type: 'token', action: 'elevate', tokenId: 'e', value: 30, name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', ac: 0 },
    { type: 'token', action: 'resize', tokenId: 'e', value: 0, name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: 'Huge', rounds: 0, monster: '', ac: 0 }
  ]);
  assert.deepEqual(out, [{ type: 'elevateToken', tokenId: 'e', feet: 30 }, { type: 'resizeToken', tokenId: 'e', size: 'huge' }]);
  const actions = DM_SCHEMA.properties.mapUpdates.items.anyOf[0].properties.action.enum;
  assert.ok(actions.includes('elevate') && actions.includes('resize'));
});
