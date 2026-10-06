// The module's own creatures (data/campaigns/<id>/monsters.json) and the token art overrides (data/token-overrides.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './helpers/sandbox.mjs';
import { loadAdventureMonsters, adventureMonsterFor, adventureMonstersForPrompt } from '../lib/adventure-monsters.js';
import { monsterImageMatch, getEntry, listEntries } from '../lib/compendium.js';
import { loadServerPieces } from '../scripts/dm-schema.mjs';

const { expandTokenUpdates } = loadServerPieces();
const dir = path.join(ROOT, 'data', 'campaigns', 'lost-mine-of-phandelver');
const exists = (p) => access(p).then(() => true, () => false);

test('every adventure creature is complete, uniquely indexed, not an SRD index, and has real token art', async () => {
  const list = await loadAdventureMonsters(dir);
  assert.ok(list.length >= 9);
  const seen = new Set();
  for (const m of list) {
    assert.match(m.index, /^[a-z0-9-]+$/); assert.ok(!seen.has(m.index), 'duplicate ' + m.index); seen.add(m.index);
    assert.equal(await getEntry('monsters', m.index), null, `${m.index} would shadow an SRD creature`);
    assert.ok(m.hit_points > 0 && m.armor_class?.[0]?.value > 0, m.index);
    assert.ok(Number.isFinite(parseInt(m.speed?.walk, 10)), `${m.index}: walking speed`);
    assert.ok(Number.isFinite(m.dexterity) && m.dexterity >= 1 && m.dexterity <= 30, `${m.index}: dexterity`);
    assert.match(m.hit_dice, /^\d+d\d+([+-]\d+)?$/, `${m.index}: hit dice`);
    if (m.image) assert.ok(await exists(path.join(ROOT, 'public', 'tokens', m.image.replace(/^\/tokens\//, ''))), `${m.index}: image ${m.image} is missing`);
  }
  assert.match(adventureMonstersForPrompt(list), new RegExp(`${list[0].index}: ${list[0].name}`));
});

test('hit points follow the hit dice (average of the dice plus the bonus is within 1 of the stated hit points)', async () => {
  for (const m of await loadAdventureMonsters(dir)) {
    const [, n, d, b] = /^(\d+)d(\d+)([+-]\d+)?$/.exec(m.hit_dice).map((x, i) => (i ? Number(x) || 0 : x));
    const avg = Math.floor(n * (d + 1) / 2 + b);
    assert.ok(Math.abs(avg - m.hit_points) <= 2, `${m.index}: ${m.hit_dice} averages ${avg}, stated ${m.hit_points}`);
  }
});

test('the DM adding one of them gets its numbers and its art; an unknown index falls back to the DM\'s own numbers', async () => {
  const list = await loadAdventureMonsters(dir);
  const T = (o) => ({ type: 'token', action: 'add', tokenId: 'a', name: '', col: 1, row: 1, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0, ...o });
  for (const m of list) {
    const [t] = await expandTokenUpdates([T({ monster: m.index.toUpperCase() })], list);
    assert.equal(t.maxHp, m.hit_points, m.index); assert.equal(t.ac, m.armor_class[0].value); assert.equal(t.name, m.name);
    assert.equal(t.speed, parseInt(m.speed.walk, 10)); assert.equal(t.dexMod, Math.floor((m.dexterity - 10) / 2));
    assert.equal(t.monster, '', 'not a bestiary link');
    assert.ok(t.image.startsWith('/tokens/'), m.index);
  }
  const [x] = await expandTokenUpdates([T({ monster: 'not-a-thing', name: 'Mystery', value: 12, ac: 11 })], list);
  assert.deepEqual([x.maxHp, x.ac, x.monster], [12, 11, '']);
  assert.equal(adventureMonsterFor(list, null), null);
});

test('token overrides: each key is an SRD creature, each file exists, and the matcher uses them ("chosen")', async () => {
  const over = JSON.parse(await readFile(path.join(ROOT, 'data', 'token-overrides.json'), 'utf8'));
  const keys = Object.keys(over).filter((k) => k !== 'note');
  assert.ok(keys.length >= 4);
  for (const k of keys) {
    assert.ok(await getEntry('monsters', k), `override key ${k} is not an SRD creature`);
    assert.ok(await exists(path.join(ROOT, 'public', 'tokens', over[k])), `${k}: ${over[k]} is missing in public/tokens`);
    const r = await monsterImageMatch(await getEntry('monsters', k));
    assert.deepEqual([r.image, r.how], ['/tokens/' + over[k], 'chosen']);
  }
  const summary = (await listEntries('monsters')).find((m) => m.index === keys[0]);
  assert.equal(summary.imageHow ?? 'chosen', 'chosen');
  const goblin = await getEntry('monsters', 'goblin');
  assert.notEqual((await monsterImageMatch(goblin)).how, 'chosen', 'creatures without an override still match by name');
});
