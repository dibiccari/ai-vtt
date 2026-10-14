// Characters have GUID ids; old slug ids are migrated once, with an alias table and rewritten references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateCharacterIds, readAliases, canonicalId, isGuid, tokenIdFor } from '../lib/character-ids.js';

const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vtt-ids-'));
  mkdirSync(path.join(dir, 'characters')); mkdirSync(path.join(dir, 'campaigns', 'c1'), { recursive: true });
  for (const id of ['edric', 'astarion']) writeFileSync(path.join(dir, 'characters', id + '.json'), JSON.stringify({ id, name: id }));
  writeFileSync(path.join(dir, 'campaigns', 'c1', 'campaign.json'), JSON.stringify({ name: 'C', party: ['edric', 'astarion', 'someone-else'] }));
  writeFileSync(path.join(dir, 'campaigns', 'c1', 'game.json'), JSON.stringify({ board: { tokens: [{ id: 'tok-edric', characterId: 'edric' }, { id: 'goblin', characterId: null }] }, chat: [{ text: 'edric' }] }));
  return dir;
};

test('migration renames the files, rewrites parties and saved boards, and keeps aliases', () => {
  const dir = fixture();
  const map = migrateCharacterIds(dir);
  assert.deepEqual(Object.keys(map).sort(), ['astarion', 'edric']);
  const files = readdirSync(path.join(dir, 'characters'));
  assert.equal(files.length, 2); assert.ok(files.every((f) => isGuid(f.replace('.json', ''))));
  const c = JSON.parse(readFileSync(path.join(dir, 'characters', map.edric + '.json'), 'utf8'));
  assert.equal(c.id, map.edric); assert.equal(c.name, 'edric');
  const camp = JSON.parse(readFileSync(path.join(dir, 'campaigns', 'c1', 'campaign.json'), 'utf8'));
  assert.deepEqual(camp.party, [map.edric, map.astarion, 'someone-else']);
  const game = JSON.parse(readFileSync(path.join(dir, 'campaigns', 'c1', 'game.json'), 'utf8'));
  assert.equal(game.board.tokens[0].characterId, map.edric); assert.equal(game.board.tokens[0].id, 'tok-edric', 'the token id stays'); assert.equal(game.chat[0].text, 'edric', 'chat text is not touched');
  const aliases = readAliases(dir);
  assert.equal(canonicalId(aliases, 'edric'), map.edric); assert.equal(canonicalId(aliases, map.edric), map.edric);
  assert.deepEqual(migrateCharacterIds(dir), {}, 'a second run changes nothing');
});

test('token ids: slug characters keep theirs, GUID characters get a short readable one', () => {
  assert.equal(tokenIdFor('edric'), 'tok-edric');
  assert.equal(tokenIdFor('9ccde74f-cb7f-40b0-b076-2892a7defc45'), 'tok-9ccde74f');
});
