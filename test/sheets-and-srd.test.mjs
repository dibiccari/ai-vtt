// lib/adventure-monsters.js, lib/compendium.js, lib/charbuild.js, lib/tavern-party.js and the saved character files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers/sandbox.mjs';
import { loadAdventureMonsters, adventureMonsterFor, adventureMonstersForPrompt } from '../lib/adventure-monsters.js';
import { listEntries, getEntry, monsterImage } from '../lib/compendium.js';
import { buildCharacter } from '../lib/charbuild.js';
import { TAVERN_PARTY, writeTavernParty, TAVERN_CAMPAIGN } from '../lib/tavern-party.js';
import { SKILLS, SAVES, modOf, profBonus } from '../lib/sheet-edit.js';

test('adventure monsters: the Lost Mine list loads, lookups are forgiving, the prompt lists them', async () => {
  const list = await loadAdventureMonsters(path.join(ROOT, 'data', 'campaigns', 'lost-mine-of-phandelver'));
  assert.ok(list.length >= 5);
  for (const m of list) { assert.ok(m.index && m.name && Number.isFinite(m.hit_points) && m.armor_class?.[0]?.value > 0, m.index); }
  const rr = adventureMonsterFor(list, 'Redbrand-Ruffian!');
  assert.equal(rr?.index, 'redbrand-ruffian');
  assert.equal(adventureMonsterFor(list, 'dragon-of-doom'), null);
  assert.match(adventureMonstersForPrompt(list), /redbrand-ruffian: Redbrand Ruffian, AC 14, 16 HP/);
  assert.equal(adventureMonstersForPrompt([]), '');
  const none = await loadAdventureMonsters(path.join(ROOT, 'data', 'campaigns', 'nowhere'));
  assert.deepEqual([...none], []);
});

test('compendium: SRD 5.1 counts, summaries, full entries, unknown kinds', async () => {
  assert.equal((await listEntries('monsters')).length, 334);
  assert.equal((await listEntries('spells')).length, 319);
  assert.ok((await listEntries('magic-items')).length > 300);
  assert.equal(await listEntries('nope'), null);
  const goblin = (await listEntries('monsters')).find((m) => m.index === 'goblin');
  assert.deepEqual([goblin.hp, goblin.ac, goblin.cr], [7, 15, 0.25]);
  assert.ok(goblin.image.startsWith('/tokens/'));
  const full = await getEntry('monsters', 'goblin');
  assert.equal(full.hit_points, 7); assert.ok(full.actions.length);
  assert.equal(await getEntry('monsters', 'klarg'), null, 'adventure creatures are not in the SRD');
  const fb = await getEntry('spells', 'fireball');
  assert.equal(fb.level, 3);
  assert.ok(await monsterImage(full));
});

test('compendium: every monster gets a token picture that exists', async () => {
  const tokens = new Set(JSON.parse(await readFile(path.join(ROOT, 'public', 'tokens', 'manifest.json'), 'utf8')).tokens.map((t) => '/tokens/' + t.file));
  const bad = (await listEntries('monsters')).filter((m) => !tokens.has(m.image)).map((m) => m.index);
  assert.deepEqual(bad, []);
});

const sample = () => ({
  id: 'tess', name: 'Tess', color: '#fff', darkvision: 0, race: 'Human', cls: 'Rogue', level: 5, hitDie: 8, background: 'Criminal', alignment: 'Neutral',
  abilities: { str: 8, dex: 18, con: 12, int: 10, wis: 14, cha: 10 }, saves: ['dex', 'int'], skills: ['Stealth', 'Perception'], expertise: ['Stealth'], speed: 30, ac: 15,
  weapons: [['Rapier', 'dex', '1d8', 0, 'piercing', 'Finesse']], spellcasting: null, features: '', proficiencies: '', items: [['Rapier', 1, 2], ['Rope', 2, 10]], gp: 7,
  personality: '', flaws: '', backstory: ''
});

test('buildCharacter: every number on the sheet follows from the scores, level and proficiencies', () => {
  const c = buildCharacter(sample(), ['x']);
  const s = c.sheet;
  assert.equal(c.maxHp, 8 + 1); assert.equal(c.hp, c.maxHp);
  assert.equal(s.ProfBonus, '+3'); assert.equal(s.DEX, '18');
  assert.equal(s['DEXmod '], '+4');
  assert.equal(s['Stealth '], '+10', 'dex 4 + expertise 6');
  assert.equal(s['Perception '], '+5');
  assert.equal(s.Passive, '15');
  assert.equal(s['ST Dexterity'], '+7'); assert.equal(s['ST Strength'], '-1');
  assert.equal(s[SAVES.dex.box], true); assert.equal(s[SAVES.str.box], false);
  assert.match(s.AttacksSpellcasting, /Rapier: \+7, 1d8\+4 piercing/);
  assert.deepEqual(c.campaigns, ['x']); assert.deepEqual(c.coins, { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 });
  assert.equal(c.inventory.length, 2); assert.equal(c.inventory[1].weight, 10);
  assert.deepEqual(c.expertise, ['Stealth']);
});

test('buildCharacter: spellcasting fills DC, attack bonus, spell lines and slots', () => {
  const p = { ...sample(), cls: 'Wizard', level: 3, hitDie: 6, abilities: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 }, expertise: [], skills: ['Arcana'], spellcasting: { cls: 'Wizard', ability: 'INT', slots: { 1: 4, 2: 2 }, cantrips: ['Fire Bolt'], spells: { 1: ['Shield', 'Sleep'], 2: ['Misty Step'] } } };
  const s = buildCharacter(p, []).sheet;
  assert.equal(s['SpellSaveDC  2'], '13'); assert.equal(s['SpellAtkBonus 2'], '+5');
  const values = Object.values(s);
  for (const n of ['Fire Bolt', 'Shield', 'Sleep', 'Misty Step']) assert.ok(values.includes(n), n);
  assert.equal(s['SlotsTotal 19'], '4'); assert.equal(s['SlotsRemaining 20'], '2');
});

test('tavern party: the four characters are written at full hit points, level 3, tagged for the tavern campaign', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-tavern-'));
  try {
    await cp(path.join(ROOT, 'data', 'characters'), dir, { recursive: true });
    const done = await writeTavernParty(dir, { keepHp: false });
    assert.deepEqual(done.map((c) => c.id), TAVERN_PARTY.map((p) => p.id));
    for (const c of done) { assert.equal(c.hp, c.maxHp); assert.equal(c.level, 3); assert.deepEqual(c.campaigns, [TAVERN_CAMPAIGN]); assert.equal(c.sheet.ProfBonus, '+2'); }
    const again = JSON.parse(await readFile(path.join(dir, 'thorin.json'), 'utf8'));
    assert.equal(again.id, 'thorin');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const chars = [];
for (const f of (await readdir(path.join(ROOT, 'data', 'characters'))).filter((x) => x.endsWith('.json'))) chars.push(JSON.parse(await readFile(path.join(ROOT, 'data', 'characters', f), 'utf8')));
for (const c of chars.filter((x) => x.sheet && Object.keys(x.sheet).length > 20)) {
  test(`saved character ${c.id}: the record and the official sheet agree`, () => {
    const s = c.sheet;
    assert.equal(Number(s.HPMax), c.maxHp); assert.equal(Number(s.HPCurrent), c.hp); assert.equal(Number(s.AC), c.ac);
    assert.ok(c.hp >= 0 && c.hp <= c.maxHp);
    for (const [k, f] of Object.entries({ str: ['STR', 'STRmod'], dex: ['DEX', 'DEXmod '], con: ['CON', 'CONmod'], int: ['INT', 'INTmod'], wis: ['WIS', 'WISmod'], cha: ['CHA', 'CHamod'] })) {
      assert.equal(Number(s[f[0]]), c.abilities[k], `${k} score`);
      assert.equal(Number(s[f[1]]), modOf(c.abilities[k]), `${k} modifier`);
    }
    const pb = profBonus(c.level);
    assert.equal(Number(s.ProfBonus), pb, 'proficiency bonus');
    for (const [k, sv] of Object.entries(SAVES)) assert.equal(Number(s[sv.field]), modOf(c.abilities[k]) + (s[sv.box] === true ? pb : 0), `${k} save`);
    for (const [name, sk] of Object.entries(SKILLS)) {
      const expect = modOf(c.abilities[sk.ability]) + (s[sk.box] === true ? pb * ((c.expertise || []).includes(name) ? 2 : 1) : 0);
      assert.equal(Number(s[sk.field]), expect, name);
    }
  });
}
