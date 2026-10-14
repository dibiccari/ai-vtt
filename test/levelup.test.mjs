// Level-up by the 2014 rules from the SRD class tables (lib/levelup.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelUpOptions, applyLevelUp } from '../lib/levelup.js';

const mk = (cls, level, abilities, sheet = {}) => ({ id: 't', name: 'T', class: cls, level, hp: 20, maxHp: 20, ac: 12, speed: 30, abilities, sheet: { ClassLevel: `${cls} ${level}`, XP: '0', HPMax: '20', HPCurrent: '20', ...sheet } });
const FIGHTER = { str: 16, dex: 12, con: 13, int: 8, wis: 10, cha: 10 };
const WIZARD = { str: 8, dex: 14, con: 14, int: 16, wis: 10, cha: 10 };

test('the tables give the next level: hit die, features, subclass and ASI levels', () => {
  const f2 = levelUpOptions(mk('Fighter', 2, FIGHTER));
  assert.equal(f2.next, 3); assert.equal(f2.hitDie, 10); assert.equal(f2.hp.average, 6); assert.ok(f2.subclass, 'a fighter chooses an archetype at 3'); assert.equal(f2.asi, false);
  const f3 = levelUpOptions(mk('Fighter', 3, FIGHTER));
  assert.equal(f3.asi, true, 'level 4 has an Ability Score Improvement'); assert.equal(f3.subclass, null);
  const f5 = levelUpOptions(mk('Fighter', 4, FIGHTER));
  assert.equal(f5.profBonus, 3); assert.ok(f5.features.some((f) => f.name === 'Extra Attack'));
  assert.equal(levelUpOptions(mk('Fighter', 20, FIGHTER)).ok, false);
});

test('a fighter takes the average, raises Strength and gets the numbers kept in step', () => {
  const c = mk('Fighter', 3, FIGHTER, { SP: '0' });
  assert.equal(applyLevelUp(c, { hp: { mode: 'average' } }).ok, false, 'the ASI must be chosen');
  const out = applyLevelUp(c, { hp: { mode: 'average' }, asi: { kind: 'asi', increases: { str: 2 } } });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.character.level, 4); assert.equal(out.character.abilities.str, 18); assert.equal(out.character.maxHp, 20 + 6 + 1);
  assert.equal(out.character.sheet.ClassLevel, 'Fighter 4'); assert.equal(out.character.sheet.STRmod, '+4'); assert.equal(out.character.sheet.HD, '4d10');
  assert.equal(out.character.sheetLog.at(-1).reason, 'Level up to 4');
});

test('Constitution raised at level up adds hit points for every level', () => {
  const c = mk('Fighter', 3, { ...FIGHTER, con: 13 });
  const out = applyLevelUp(c, { hp: { mode: 'average' }, asi: { kind: 'asi', increases: { con: 1, str: 1 } } });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.character.abilities.con, 14); assert.equal(out.hpGain, 6 + 2 + 3, 'average 6 plus the new modifier, plus 1 for each of the three earlier levels');
});

test('ASI rules: exactly 2 points, nothing above 20, or a real feat', () => {
  const c = mk('Fighter', 3, { ...FIGHTER, str: 19 });
  assert.equal(applyLevelUp(c, { asi: { kind: 'asi', increases: { str: 2 } } }).ok, false);
  assert.equal(applyLevelUp(c, { asi: { kind: 'asi', increases: { str: 1 } } }).ok, false);
  assert.equal(applyLevelUp(c, { asi: { kind: 'feat', name: 'Nonsense' } }).ok, false);
  const feat = applyLevelUp(c, { asi: { kind: 'feat', name: 'Grappler' } });
  assert.equal(feat.ok, true, feat.error); assert.deepEqual(feat.character.feats, ['Grappler']); assert.match(feat.character.sheet['Features and Traits'], /Feat: Grappler/);
});

test('a subclass is chosen at its level', () => {
  const c = mk('Fighter', 2, FIGHTER);
  assert.equal(applyLevelUp(c, { hp: { mode: 'average' } }).ok, false);
  const out = applyLevelUp(c, { hp: { mode: 'average' }, subclass: 'Champion' });
  assert.equal(out.ok, true, out.error); assert.equal(out.character.subclass, 'Champion');
});

test('a wizard picks the new cantrip and two spellbook spells, and gets the new slots', () => {
  const c = mk('Wizard', 3, WIZARD);
  const o = levelUpOptions(c);
  assert.equal(o.spellChoices.find((s) => s.level === 0).count, 1); assert.equal(o.spellChoices.find((s) => s.level === 'any').count, 2);
  assert.equal(o.newSlots[2], 3); assert.equal(o.newSlots[3], 0, 'no 3rd level slots yet');
  const cantrip = o.spellChoices[0].options[0];
  const [a, b] = o.spellChoices[1].options.filter((s) => s.level <= 2);
  assert.equal(applyLevelUp(c, { asi: { kind: 'asi', increases: { int: 2 } }, spells: [{ name: cantrip, level: 0 }] }).ok, false, 'two spells are owed');
  assert.equal(applyLevelUp(c, { asi: { kind: 'asi', increases: { int: 2 } }, spells: [{ name: cantrip, level: 0 }, { name: 'Wish', level: 9 }, b] }).ok, false, 'a 9th level spell is not available');
  const out = applyLevelUp(c, { asi: { kind: 'asi', increases: { int: 2 } }, spells: [{ name: cantrip, level: 0 }, a, b] });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.character.sheet['SlotsTotal 20'], '3'); assert.equal(out.character.abilities.int, 18);
  const lines = Object.entries(out.character.sheet).filter(([k, v]) => /^Spells /.test(k) && v).map(([, v]) => v);
  for (const name of [cantrip, a.name, b.name]) assert.ok(lines.includes(name), name + ' is on the sheet');
});

test('rolled hit points use the die; manual ones must fit it', () => {
  const c = mk('Fighter', 1, FIGHTER);
  const rolled = applyLevelUp(c, { hp: { mode: 'roll' } }, { roll: () => 9 });
  assert.equal(rolled.hpGain, 9 + 1);
  assert.equal(applyLevelUp(c, { hp: { mode: 'manual', value: 11 } }).ok, false);
  assert.equal(applyLevelUp(c, { hp: { mode: 'manual', value: 7 } }).hpGain, 8);
});

test('multiclass characters and unknown classes are sent to the DM', () => {
  assert.equal(levelUpOptions(mk('Fighter', 3, FIGHTER, { ClassLevel: 'Fighter 2 / Rogue 1' })).ok, false);
  assert.equal(levelUpOptions(mk('Artificer', 3, FIGHTER)).ok, false);
});

import { before, after } from 'node:test';
import { startServer } from './helpers/sandbox.mjs';
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('the level-up endpoints show the options and apply the choices', async () => {
  const party = JSON.parse((await srv.get('/api/party')).text);
  const c = party.characters[0];
  const opt = JSON.parse((await srv.get('/api/party/levelup/' + c.id)).text);
  assert.equal(opt.ok, true); assert.equal(opt.next, c.level + 1);
  assert.equal((await srv.get('/api/party/levelup/nobody')).status, 404);
  const bad = await srv.call('POST', '/api/party/levelup/' + c.id, { hp: { mode: 'manual', value: 99 } });
  assert.equal(bad.status, 400);
  const body = { hp: { mode: 'average' } };
  if (opt.subclass) body.subclass = opt.subclass.options[0].name;
  if (opt.asi) body.asi = { kind: 'asi', increases: { str: 1, dex: 1 } };
  for (const s of opt.spellChoices) { body.spells = body.spells || []; if (s.level === 0) body.spells.push(...s.options.slice(0, s.count).map((n) => ({ name: n, level: 0 }))); else body.spells.push(...s.options.slice(0, s.count)); }
  const ok = await srv.call('POST', '/api/party/levelup/' + c.id, body);
  assert.equal(ok.status, 200, ok.text);
  const after1 = JSON.parse((await srv.get('/api/party')).text).characters.find((x) => x.id === c.id);
  assert.equal(after1.level, c.level + 1); assert.ok(after1.maxHp > c.maxHp);
});
