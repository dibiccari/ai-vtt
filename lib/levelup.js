// Level-up by the 2014 rules, from the SRD class tables in data/srd (classes, levels, features, subclasses, spells, feats).
// levelUpOptions(character) says what the next level gives and which choices the player has to make; applyLevelUp(character, choices)
// checks those choices and turns them into one sheet update that lib/sheet-edit.js applies (so the change log and Undo work).
// Single-class characters only: a multiclass character is told to ask the Dungeon Master.
import { readFileSync } from 'node:fs';
import { applyUpdate, modOf, levelForXp, ABILITIES } from './sheet-edit.js';
import { classesOf } from './rules-track.js';
import { rollDie } from './dice.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/srd/${name}.json`, import.meta.url), 'utf8'));
const CLASSES = read('classes'), LEVELS = read('levels'), FEATURES = read('features'), SPELLS = read('spells'), FEATS = read('feats');
const featureText = new Map(FEATURES.map((f) => [f.index, f]));
const spellFields = JSON.parse(readFileSync(new URL('./sheet-fields.json', import.meta.url), 'utf8')).spellLines;

// The level a class chooses its subclass (2014 PHB; the SRD has one subclass each).
export const SUBCLASS_LEVEL = { barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2 };
// Classes that know a fixed list of spells (the rest prepare from a list).
const KNOWN_CASTERS = new Set(['bard', 'sorcerer', 'warlock', 'ranger']);
const PREPARE_CASTERS = { cleric: 'wis', druid: 'wis', paladin: 'cha', wizard: 'int' };

const classRow = (index) => CLASSES.find((c) => c.index === index);
const levelRow = (cls, level) => LEVELS.find((l) => l.class.index === cls && l.level === level && !l.subclass);
const subRows = (sub, level) => LEVELS.filter((l) => l.subclass && l.subclass.index === sub && l.level === level);
const desc = (f) => (f && Array.isArray(f.desc) ? f.desc.join('\n') : '');
const featuresAt = (cls, level, sub) => {
  const idx = [...levelRow(cls, level).features, ...(sub ? subRows(sub, level).flatMap((r) => r.features) : [])];
  return idx.filter((f) => !/^ability-score-improvement/.test(f.index)).map((f) => ({ index: f.index, name: f.name, text: desc(featureText.get(f.index)) }));
};
const slotsOf = (row) => { const s = row.spellcasting || {}; const out = {}; for (let n = 1; n <= 9; n++) out[n] = s[`spell_slots_level_${n}`] || 0; return out; };
const highestSlot = (row) => Math.max(0, ...Object.entries(slotsOf(row)).filter(([, v]) => v > 0).map(([k]) => Number(k)));
const knownSpellNames = (sheet) => {
  const out = { 0: [] };
  for (const [lvl, lines] of Object.entries(spellFields)) out[lvl] = lines.map((l) => String(sheet?.[l] || '').trim()).filter(Boolean);
  return out;
};
const classSpells = (cls, level) => SPELLS.filter((s) => s.level === level && s.classes.some((c) => c.index === cls)).map((s) => s.name).sort();

export function levelUpOptions(character) {
  const classes = classesOf(character);
  if (classes.length !== 1) return { ok: false, reason: 'This character has more than one class. Ask the Dungeon Master to level them up.' };
  const cls = classRow(classes[0].name.split(/\s+/)[0]);
  if (!cls) return { ok: false, reason: `"${classes[0].name}" is not one of the twelve SRD classes. Ask the Dungeon Master to level them up.` };
  const level = classes[0].level, next = level + 1;
  if (next > 20) return { ok: false, reason: 'Already level 20.' };
  const row = levelRow(cls.index, next), cur = levelRow(cls.index, level);
  const con = modOf(character.abilities.con);
  const sub = String(character.subclass || '');
  const subIndex = (cls.subclasses || []).find((s) => s.name.toLowerCase() === sub.toLowerCase())?.index || '';
  const needsSubclass = !sub && next === SUBCLASS_LEVEL[cls.index];
  const asi = row.ability_score_bonuses > cur.ability_score_bonuses;
  const sheet = character.sheet || {};
  const known = knownSpellNames(sheet);
  const caster = !!row.spellcasting;
  const cantripsNew = caster ? Math.max(0, (row.spellcasting.cantrips_known || 0) - (cur.spellcasting?.cantrips_known || 0)) : 0;
  let spellsNew = 0, spellsKind = '';
  if (KNOWN_CASTERS.has(cls.index)) { spellsNew = Math.max(0, (row.spellcasting.spells_known || 0) - (cur.spellcasting?.spells_known || 0)); spellsKind = 'known'; }
  else if (cls.index === 'wizard') { spellsNew = 2; spellsKind = 'spellbook'; }
  const maxSpell = caster ? highestSlot(row) : 0;
  const newSlots = caster ? slotsOf(row) : {};
  const knownAll = new Set(Object.values(known).flat().map((n) => n.toLowerCase()));
  const pickable = (level0) => classSpells(cls.index, level0).filter((n) => !knownAll.has(n.toLowerCase()));
  const spellChoices = [];
  if (cantripsNew) spellChoices.push({ level: 0, count: cantripsNew, options: pickable(0) });
  if (spellsNew) {
    const options = [];
    for (let l = 1; l <= maxSpell; l++) options.push(...pickable(l).map((name) => ({ name, level: l })));
    spellChoices.push({ level: 'any', count: spellsNew, options, kind: spellsKind });
  }
  const prepares = PREPARE_CASTERS[cls.index] ? { ability: PREPARE_CASTERS[cls.index], count: Math.max(1, next + modOf(character.abilities[PREPARE_CASTERS[cls.index]])) } : null;
  return {
    ok: true,
    class: cls.name, classIndex: cls.index, level, next, hitDie: cls.hit_die,
    xp: Number(String(sheet.XP || 0).replace(/\D/g, '')) || 0, xpReady: levelForXp(Number(String(sheet.XP || 0).replace(/\D/g, '')) || 0) >= next,
    hp: { average: Math.floor(cls.hit_die / 2) + 1, conMod: con, roll: `1d${cls.hit_die}` },
    profBonus: row.prof_bonus,
    features: featuresAt(cls.index, next, subIndex),
    asi, feats: asi ? FEATS.map((f) => ({ index: f.index, name: f.name, text: desc(f), needs: (f.prerequisites || []).map((p) => `${p.ability_score.name} ${p.minimum_score}`) })) : [],
    subclass: needsSubclass ? { options: (cls.subclasses || []).map((s) => ({ index: s.index, name: s.name })), allowCustom: true } : null,
    spellChoices, prepares, newSlots, caster
  };
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// choices: { hp: {mode:'average'|'roll'|'manual', value}, asi: {kind:'asi', increases:{str:1,..}} | {kind:'feat', name}, subclass, spells: [{name, level}], cantrips?: [names] }
export function applyLevelUp(character, choices = {}, { roll = rollDie } = {}) {
  const opt = levelUpOptions(character);
  if (!opt.ok) return { ok: false, error: opt.reason };
  const errors = [];
  const c = choices || {};
  // hit points
  let gain;
  const mode = (c.hp && c.hp.mode) || 'average';
  if (mode === 'roll') gain = roll(opt.hitDie);
  else if (mode === 'manual') { gain = Math.round(Number(c.hp.value)); if (!(gain >= 1 && gain <= opt.hitDie)) errors.push(`The hit point roll must be between 1 and ${opt.hitDie}.`); }
  else gain = opt.hp.average;
  // ability scores or a feat
  const abilities = { ...character.abilities };
  let featName = '';
  if (opt.asi) {
    const a = c.asi || {};
    if (a.kind === 'feat') {
      const f = opt.feats.find((x) => x.name.toLowerCase() === String(a.name || '').toLowerCase());
      if (!f) errors.push('Pick a feat from the list.'); else featName = f.name;
    } else {
      const inc = a.increases || {};
      if (sum(inc) !== 2) errors.push('Ability Score Improvement: raise scores by 2 points in all.');
      for (const [k, v] of Object.entries(inc)) {
        if (!ABILITIES.includes(k) || !(v >= 0 && v <= 2)) { errors.push(`Cannot raise "${k}" by ${v}.`); continue; }
        if (abilities[k] + v > 20) errors.push(`${k.toUpperCase()} cannot go above 20.`);
        abilities[k] += Number(v);
      }
    }
  } else if (c.asi) errors.push('This level has no Ability Score Improvement.');
  // subclass
  let subclass = character.subclass || '';
  if (opt.subclass) {
    const name = String(c.subclass || '').trim().slice(0, 60);
    if (!name) errors.push(`Choose a ${opt.class} subclass.`); else subclass = name;
  }
  // spells
  const picked = (Array.isArray(c.spells) ? c.spells : []).map((s) => ({ name: String(s.name || '').trim(), level: Number(s.level) }));
  const wantCantrips = opt.spellChoices.find((x) => x.level === 0)?.count || 0;
  const wantSpells = opt.spellChoices.find((x) => x.level === 'any')?.count || 0;
  const pickedCantrips = picked.filter((s) => s.level === 0), pickedSpells = picked.filter((s) => s.level > 0);
  if (pickedCantrips.length !== wantCantrips) errors.push(`Choose ${wantCantrips} new cantrip${wantCantrips === 1 ? '' : 's'}.`);
  if (pickedSpells.length !== wantSpells) errors.push(`Choose ${wantSpells} new spell${wantSpells === 1 ? '' : 's'}.`);
  for (const s of picked) {
    const group = s.level === 0 ? opt.spellChoices.find((x) => x.level === 0) : opt.spellChoices.find((x) => x.level === 'any');
    const ok = group && (s.level === 0 ? group.options.includes(s.name) : group.options.some((o) => o.name === s.name && o.level === s.level));
    if (!ok) errors.push(`${s.name || 'A spell'} is not available to a level ${opt.next} ${opt.class}.`);
  }
  if (errors.length) return { ok: false, error: errors.join(' ') };

  // hit points: the new level's die (or average) plus Constitution; a higher Constitution also counts for earlier levels
  const conNow = modOf(abilities.con), conWas = modOf(character.abilities.con);
  const hpGain = Math.max(1, gain + conNow) + (conNow - conWas) * opt.level;
  const edits = [
    { field: 'classLevel', value: `${opt.class} ${opt.next}` },
    { field: 'maxHp', value: String(character.maxHp + hpGain) },
    { field: 'hp', value: String(character.hp + hpGain) },
    { field: 'HD', value: `${opt.next}d${opt.hitDie}` }, { field: 'HDTotal', value: String(opt.next) }
  ];
  for (const k of ABILITIES) if (abilities[k] !== character.abilities[k]) edits.push({ field: k, value: String(abilities[k]) });
  const old = String(character.sheet?.['Features and Traits'] || '').trimEnd();
  const lines = opt.features.map((f) => f.name);
  if (featName) lines.push(`Feat: ${featName}`);
  if (subclass && subclass !== character.subclass) lines.push(`Subclass: ${subclass}`);
  if (lines.length) edits.push({ field: 'Features and Traits', value: `${old}${old ? '\n' : ''}Level ${opt.next}: ${lines.join(', ')}.` });
  const slots = opt.caster ? Object.entries(opt.newSlots).filter(([lvl, total]) => total > 0 || character.sheet?.[`SlotsTotal ${18 + Number(lvl)}`]).map(([lvl, total]) => ({ level: Number(lvl), total })) : [];
  const update = { reason: `Level up to ${opt.next}`, edits, spells: picked.map((s) => ({ name: s.name, level: s.level })), slots, skills: [], saves: [] };
  const out = applyUpdate(character, update);
  if (subclass !== character.subclass) out.character.subclass = subclass;
  if (featName) out.character.feats = [...new Set([...(character.feats || []), featName])];
  out.notes.unshift(`Hit points +${hpGain} (${mode === 'roll' ? `rolled ${gain}` : mode === 'manual' ? `rolled ${gain}` : `average ${gain}`} ${conNow >= 0 ? '+' : ''}${conNow} Constitution)`);
  return { ok: true, character: out.character, notes: out.notes, rejected: out.rejected, hpGain, level: opt.next };
}
