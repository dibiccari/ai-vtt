// Builds a complete character record (stats, the official 5E sheet's fields, gear) from a short description, so every number on the sheet
// is derived from the ability scores, level, proficiencies and weapons and cannot disagree with itself. Used by the party scripts
// (scripts/make-lmop-party.mjs, scripts/make-tavern-party.mjs).
import { readFileSync } from 'node:fs';
import { SKILLS, SAVES, modOf, profBonus } from './sheet-edit.js';

const FIELDS = JSON.parse(readFileSync(new URL('./sheet-fields.json', import.meta.url), 'utf8'));
const signed = (n) => (n >= 0 ? '+' : '') + n;
export const SCORE = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
export const MOD = { str: 'STRmod', dex: 'DEXmod ', con: 'CONmod', int: 'INTmod', wis: 'WISmod', cha: 'CHamod' };
const WEAPON_FIELDS = [['Wpn Name', 'Wpn1 AtkBonus', 'Wpn1 Damage'], ['Wpn Name 2', 'Wpn2 AtkBonus ', 'Wpn2 Damage '], ['Wpn Name 3', 'Wpn3 AtkBonus  ', 'Wpn3 Damage ']];

// p: { id, name, color, darkvision, race, cls, level = 1, hitDie, maxHp (default: the first-level maximum), hp (current, default full), xp,
//      background, alignment, abilities, saves, skills, expertise, speed, ac, weapons, spellcasting, features, proficiencies, items, gp,
//      personality, flaws, backstory, image }
// weapons: [name, ability, damage die, extra damage, type, note]; extra null = a spell with no ability bonus on the damage.
// spellcasting: { cls, ability: 'WIS', slots: { 1: 4, 2: 2 } (or a number of 1st-level slots), cantrips: [], spells: { 1: [], 2: [] } (or level1: []) }
export function buildCharacter(p, campaigns) {
  const level = p.level || 1, pb = profBonus(level);
  const mods = Object.fromEntries(Object.keys(SCORE).map((k) => [k, modOf(p.abilities[k])]));
  const maxHp = p.maxHp ?? p.hitDie + mods.con;
  const hp = Math.min(maxHp, p.hp ?? maxHp);
  const sheet = {
    CharacterName: p.name, 'CharacterName 2': p.name, ClassLevel: `${p.cls} ${level}`, Background: p.background, 'Race ': p.race, Alignment: p.alignment, XP: String(p.xp ?? 0),
    ProfBonus: signed(pb), AC: String(p.ac), Initiative: signed(mods.dex), Speed: String(p.speed), HPMax: String(maxHp), HPCurrent: String(hp), HD: `${level}d${p.hitDie}`, HDTotal: String(level),
    GP: String(p.gp), Equipment: p.items.map(([n, q]) => (q > 1 ? `${n} (${q})` : n)).join('\n'),
    'Features and Traits': p.features, ProficienciesLang: p.proficiencies, Backstory: p.backstory,
    'PersonalityTraits ': p.personality, Flaws: p.flaws
  };
  for (const k of Object.keys(SCORE)) { sheet[SCORE[k]] = String(p.abilities[k]); sheet[MOD[k]] = signed(mods[k]); }
  for (const k of Object.keys(SAVES)) { const on = p.saves.includes(k); sheet[SAVES[k].box] = on; sheet[SAVES[k].field] = signed(mods[k] + (on ? pb : 0)); }
  for (const [name, s] of Object.entries(SKILLS)) {
    const on = p.skills.includes(name);
    sheet[s.box] = on;
    sheet[s.field] = signed(mods[s.ability] + (on ? pb * (p.expertise.includes(name) ? 2 : 1) : 0));
  }
  sheet.Passive = String(10 + mods.wis + (p.skills.includes('Perception') ? pb : 0));
  // Attacks: the sheet has three weapon lines, and the full list goes in the attacks box.
  const lines = [];
  p.weapons.forEach(([name, ab, die, extra, type, note], i) => {
    const hit = signed(mods[ab] + pb);
    const dmg = extra === null ? die : `${die}${signed(mods[ab] + extra)}`.replace(/\+0$/, '');
    lines.push(`${name}: ${hit}, ${dmg} ${type}. ${note}`);
    if (i < 3) { const f = WEAPON_FIELDS[i]; sheet[f[0]] = name; sheet[f[1]] = hit; sheet[f[2]] = `${dmg} ${type}`; }
  });
  sheet.AttacksSpellcasting = lines.join('\n');
  if (p.spellcasting) {
    const sc = p.spellcasting;
    const abMod = mods[sc.ability.toLowerCase()];
    sheet['Spellcasting Class 2'] = sc.cls; sheet['SpellcastingAbility 2'] = sc.ability;
    sheet['SpellSaveDC  2'] = String(8 + pb + abMod); sheet['SpellAtkBonus 2'] = signed(pb + abMod);
    sc.cantrips.forEach((n, i) => { sheet[FIELDS.spellLines[0][i]] = n; });
    const spells = sc.spells || { 1: sc.level1 || [] };
    for (const [lv, list] of Object.entries(spells)) list.forEach((n, i) => { sheet[FIELDS.spellLines[lv][i]] = n; });
    const slots = typeof sc.slots === 'number' ? { 1: sc.slots } : (sc.slots || {});
    for (const [lv, n] of Object.entries(slots)) { sheet[FIELDS.slots[lv].total] = String(n); sheet[FIELDS.slots[lv].remaining] = String(n); }
  }
  return {
    id: p.id, name: p.name, class: p.cls, level, hp, maxHp, ac: p.ac, speed: p.speed, abilities: p.abilities, color: p.color, darkvision: p.darkvision,
    ...(p.image ? { image: p.image } : {}),
    campaigns, sheet,
    ...(p.expertise.length ? { expertise: p.expertise } : {}),
    inventory: p.items.map(([name, qty, weight], i) => ({ id: `${p.id}-${i}`, name, qty, weight, requiresAttunement: false, attuned: false, equipped: true, effects: [], note: '' })),
    coins: { cp: 0, sp: 0, ep: 0, gp: p.gp, pp: 0 }
  };
}
