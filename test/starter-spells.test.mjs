// Starter spells of the campaign wizard's quick characters (lib/starter-spells.js): every pick is a real SRD spell of the level it is filed under and on the class's own list,
// the counts follow the class tables for levels 1 to 5, non-casters and a level 1 paladin or ranger get none, and nothing is picked twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { starterSpells, PICKS } from '../lib/starter-spells.js';
import { buildQuickCharacter, CLASS_KITS } from '../lib/quick-character.js';

const read = (f) => JSON.parse(readFileSync(new URL('../data/srd/' + f, import.meta.url), 'utf8'));
const SPELLS = new Map(read('spells.json').map((s) => [s.name, s]));
const LEVELS = read('levels.json');
// The SRD data file leaves Faerie Fire off the bard's list, but the SRD's own bard list has it (PHB too).
const DATA_GAPS = new Set(['Bard:Faerie Fire']);
const onList = (cls, s) => s.classes.some((c) => c.name === cls) || DATA_GAPS.has(`${cls}:${s.name}`);
const CASTERS = ['Wizard', 'Sorcerer', 'Bard', 'Warlock', 'Cleric', 'Druid', 'Paladin', 'Ranger'];
const sc = (cls, lv) => (LEVELS.find((l) => l.index === `${cls.toLowerCase()}-${lv}`) || {}).spellcasting || {};
const top = (s) => { let m = 0; for (let n = 1; n <= 9; n++) if (s[`spell_slots_level_${n}`] > 0) m = n; return m; };
const total = (r) => Object.values(r.spells).reduce((n, l) => n + l.length, 0);

test('every picked spell exists in the SRD at the level it is listed under and is on that class\'s spell list', () => {
  for (const cls of CASTERS) {
    for (const name of PICKS[cls].cantrips) { const s = SPELLS.get(name); assert.ok(s, `${cls} cantrip ${name} exists`); assert.equal(s.level, 0, `${name} is a cantrip`); assert.ok(onList(cls, s), `${name} is on the ${cls} list`); }
    const seen = new Set();
    for (const [lv, name] of PICKS[cls].spells) {
      const s = SPELLS.get(name); assert.ok(s, `${cls} spell ${name} exists`);
      assert.equal(s.level, lv, `${name} is level ${s.level}, filed under ${lv}`);
      assert.ok(onList(cls, s), `${name} is on the ${cls} list`);
      assert.ok(!seen.has(name), `${cls}: ${name} is picked once`); seen.add(name);
    }
    assert.equal(new Set(PICKS[cls].cantrips).size, PICKS[cls].cantrips.length, `${cls}: no cantrip twice`);
  }
});

test('counts follow the class tables for levels 1 to 5 and never ask for a spell level the class cannot cast yet', () => {
  for (const cls of CASTERS) for (let lv = 1; lv <= 5; lv++) {
    const table = sc(cls, lv), r = starterSpells(cls, lv, 3), t = top(table);
    assert.equal(r.cantrips.length, Math.min(Number(table.cantrips_known) || 0, PICKS[cls].cantrips.length), `${cls} ${lv}: cantrips`);
    for (const l of Object.keys(r.spells)) assert.ok(Number(l) <= t, `${cls} ${lv}: no level ${l} spell with a top slot of ${t}`);
    const want = cls === 'Wizard' ? 6 + 2 * (lv - 1) : cls === 'Cleric' || cls === 'Druid' ? 3 + lv : cls === 'Paladin' ? 3 + Math.floor(lv / 2) : Number(table.spells_known) || 0;
    if (t === 0) assert.equal(total(r), 0, `${cls} ${lv}: no slots, no spells`);
    else assert.equal(total(r), want, `${cls} ${lv}: spells (${JSON.stringify(r.spells)})`);
  }
});

test('a negative or zero casting modifier still prepares one spell for a cleric, druid or paladin who can cast', () => {
  assert.equal(total(starterSpells('Cleric', 1, -1)), 1); assert.equal(total(starterSpells('Druid', 1, -5)), 1); assert.equal(total(starterSpells('Paladin', 2, -4)), 1);
  assert.equal(total(starterSpells('Cleric', 1, 0)), 1); assert.equal(total(starterSpells('Cleric', 2, 0)), 2);
});

test('classes without spells, and unknown classes, get nothing; a level 1 paladin or ranger gets no spells', () => {
  for (const cls of ['Fighter', 'Barbarian', 'Rogue', 'Monk', 'Nonsense']) assert.deepEqual(starterSpells(cls, 3, 3), { cantrips: [], spells: {} }, cls);
  assert.equal(total(starterSpells('Paladin', 1, 3)), 0); assert.equal(total(starterSpells('Ranger', 1, 3)), 0);
  assert.deepEqual(starterSpells('Paladin', 3, 3).cantrips, []); assert.deepEqual(starterSpells('Ranger', 5, 3).cantrips, []);
});

test('the same inputs always pick the same spells, in order (no randomness)', () => {
  assert.deepEqual(starterSpells('Wizard', 5, 3), starterSpells('Wizard', 5, 3));
  const a = starterSpells('Wizard', 1, 3), b = starterSpells('Wizard', 3, 3);
  for (const l of Object.keys(a.spells)) assert.deepEqual(b.spells[l].slice(0, a.spells[l].length), a.spells[l], 'a higher level only adds spells');
});

test('a quick character carries its starter spells on the record and every one is written on the sheet', () => {
  const spellsOnSheet = (c) => Object.entries(c.sheet || {}).filter(([k, v]) => /^Spells /.test(k) && v).map(([, v]) => String(v));
  for (const cls of CASTERS) for (const lv of [1, 3, 5]) {
    const c = buildQuickCharacter({ id: `t-${cls}-${lv}`, name: 'T', cls, race: 'Human', level: lv });
    const mod = Math.floor((c.abilities[CLASS_KITS[cls].cast.ability.toLowerCase()] - 10) / 2);
    const want = starterSpells(cls, lv, mod);
    const names = [...want.cantrips, ...Object.values(want.spells).flat()];
    const got = spellsOnSheet(c);
    for (const n of names) assert.ok(got.includes(n), `${cls} ${lv}: ${n} is on the sheet (sheet has ${got.join(', ')})`);
  }
  for (const cls of ['Fighter', 'Rogue', 'Barbarian', 'Monk']) assert.deepEqual(spellsOnSheet(buildQuickCharacter({ id: 't-' + cls, name: 'T', cls, race: 'Elf', level: 5 })), [], cls + ' has no spells');
  assert.deepEqual(spellsOnSheet(buildQuickCharacter({ id: 't-pal1', name: 'T', cls: 'Paladin', race: 'Human', level: 1 })), []);
  assert.deepEqual(spellsOnSheet(buildQuickCharacter({ id: 't-ran1', name: 'T', cls: 'Ranger', race: 'Human', level: 1 })), []);
});
