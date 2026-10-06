// lib/sheet-edit.js: the DM's edits to a character sheet keep every derived number consistent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './helpers/sandbox.mjs';
import { applyUpdate, processCharacterUpdates, modOf, profBonus, levelForXp, levelFromClassLevel, SKILLS, SAVES } from '../lib/sheet-edit.js';

const load = async (id) => JSON.parse(await readFile(path.join(ROOT, 'data', 'characters', id + '.json'), 'utf8'));

test('modOf, profBonus, levelForXp and levelFromClassLevel', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 20, 30].map(modOf), [-5, -1, -1, 0, 0, 5, 10]);
  assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(profBonus), [2, 2, 3, 3, 4, 5, 6, 6]);
  assert.equal(levelForXp(0), 1); assert.equal(levelForXp(299), 1); assert.equal(levelForXp(300), 2); assert.equal(levelForXp(355000), 20);
  assert.equal(levelFromClassLevel('Fighter 4'), 4); assert.equal(levelFromClassLevel('Fighter 2 / Rogue 1'), 3); assert.equal(levelFromClassLevel('Fighter'), null);
});

test('every skill and save in the table maps to a real sheet field (checked at import; sanity here)', () => {
  assert.equal(Object.keys(SKILLS).length, 18); assert.equal(Object.keys(SAVES).length, 6);
});

test('xpGain adds experience and announces when a level is ready', async () => {
  const edric = await load('edric');
  const out = applyUpdate(edric, { characterId: 'edric', reason: 'goblins', edits: [{ field: 'xpGain', value: '300' }] });
  assert.equal(out.character.sheet.XP, '300');
  assert.equal(out.readyLevel, 2);
  assert.ok(out.notes.some((n) => /XP 0/.test(n)));
  assert.equal(out.character.level, 1, 'leveling up is a separate classLevel edit');
  assert.equal(edric.sheet.XP, '0', 'input not mutated');
});

test('classLevel raises level and proficiency bonus and refreshes proficient skills and saves', async () => {
  const edric = await load('edric');
  const before = Number(edric.sheet.Athletics);
  const prof = edric.sheet[SKILLS.Athletics.box] === true;
  const out = applyUpdate(edric, { edits: [{ field: 'classLevel', value: 'Fighter 5' }] });
  assert.equal(out.character.level, 5); assert.equal(out.character.class, 'Fighter');
  assert.equal(out.character.sheet.ProfBonus, '+3');
  if (prof) assert.equal(Number(out.character.sheet.Athletics), before + 1);
  assert.equal(out.rejected.length, 0);
  assert.equal(out.character.sheetLog.at(-1).by, 'ai');
});

test('classLevel without a number is rejected', async () => {
  const out = applyUpdate(await load('edric'), { edits: [{ field: 'classLevel', value: 'Fighter' }] });
  assert.equal(out.changes.length, 0); assert.equal(out.rejected.length, 1);
});

test('raising an ability score updates its modifier, the skills under it and the saving throw', async () => {
  const edric = await load('edric');
  const out = applyUpdate(edric, { edits: [{ field: 'str', value: '18' }] });
  const s = out.character.sheet;
  assert.equal(s.STR, '18'); assert.equal(s.STRmod, '+4'); assert.equal(out.character.abilities.str, 18);
  const pb = 2, athleticsProf = s[SKILLS.Athletics.box] === true;
  assert.equal(s.Athletics, `+${4 + (athleticsProf ? pb : 0)}`);
  assert.equal(s['ST Strength'], `+${4 + (s[SAVES.str.box] === true ? pb : 0)}`);
});

test('maxHp and hp are kept in range (hp never above max)', async () => {
  const out = applyUpdate(await load('edric'), { edits: [{ field: 'maxHp', value: '30' }, { field: 'hp', value: '999' }] });
  assert.equal(out.character.maxHp, 30); assert.equal(out.character.hp, 30);
  const low = applyUpdate(await load('edric'), { edits: [{ field: 'hp', value: '-5' }] });
  assert.equal(low.character.hp, 0);
});

test('a name change is refused, an unknown field is refused, a checkbox needs true or false', async () => {
  const out = applyUpdate(await load('edric'), { edits: [{ field: 'CharacterName', value: 'Mallory' }, { field: 'NoSuchField', value: 'x' }, { field: SKILLS.Arcana.box, value: 'maybe' }] });
  assert.equal(out.rejected.length, 3);
  assert.equal(out.character.name, 'Edric');
});

test('non-numeric numbers are rejected without changing anything', async () => {
  const out = applyUpdate(await load('edric'), { edits: [{ field: 'ac', value: 'high' }] });
  assert.equal(out.changes.length, 0); assert.match(out.rejected[0], /needs a number/);
});

test('skills: proficiency, expertise and removal recompute the bonus', async () => {
  const edric = await load('edric');
  const out = applyUpdate(edric, { skills: [{ name: 'stealth', proficiency: 'expertise' }, { name: 'Basket Weaving', proficiency: 'proficient' }] });
  const dex = modOf(edric.abilities.dex);
  assert.equal(out.character.sheet['Stealth '], (dex + 4 >= 0 ? '+' : '') + (dex + 4));
  assert.ok(out.character.expertise.includes('Stealth'));
  assert.equal(out.rejected.length, 1);
});

test('saves: proficiency toggles the bonus', async () => {
  const edric = await load('edric');
  const out = applyUpdate(edric, { saves: [{ ability: 'Wisdom', proficient: true }, { ability: 'luck', proficient: true }] });
  assert.equal(out.character.sheet[SAVES.wis.box], true);
  assert.equal(out.rejected.length, 1);
});

test('spells and slots: add, duplicate, remove, and a slot total keeps used slots used', async () => {
  const lyra = await load('lyra');
  const added = applyUpdate(lyra, { spells: [{ level: 1, name: 'Find Familiar' }, { level: 1, name: 'find familiar' }] });
  const lines = Object.entries(added.character.sheet).filter(([, v]) => v === 'Find Familiar');
  assert.equal(lines.length, 1, 'no duplicate line');
  const removed = applyUpdate(added.character, { spells: [{ level: 1, name: 'Find Familiar', remove: true }] });
  assert.ok(!Object.values(removed.character.sheet).includes('Find Familiar'));
  const slots = applyUpdate(lyra, { slots: [{ level: 2, total: 3 }, { level: 12, total: 1 }] });
  assert.equal(slots.rejected.length, 1);
  assert.ok(slots.notes.some((n) => /Level 2 spell slots 2 → 3/.test(n)));
});

test('processCharacterUpdates saves the result, logs it, and reports unknown characters', async () => {
  const edric = await load('edric');
  const saved = [];
  const store = { list: async () => [edric], save: async (c) => { saved.push(c); return c; } };
  const r = await processCharacterUpdates([{ characterId: 'EDRIC', edits: [{ field: 'xpGain', value: '50' }] }, { characterId: 'ghost', edits: [{ field: 'hp', value: '1' }] }, { characterId: 'Edric', edits: [{ field: 'NoSuchField', value: 'x' }] }], store);
  assert.equal(saved.length, 1); assert.equal(r.results.length, 1);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join(' '), /ghost/);
});
