// A starter character from four choices (name, class, race, level 1-5), for the new campaign wizard: the standard array of ability scores placed by the class's priorities,
// the race's bonuses (2014 PHB), the class's hit die, saves, a few skills, armor and weapons, and spell slots for casters. Cantrips and spells are left empty
// for the player to choose on the Character Sheets page. Built with lib/charbuild.js so every number on the sheet follows from the scores.
import { buildCharacter } from './charbuild.js';
import { modOf } from './sheet-edit.js';

const ARRAY = [15, 14, 13, 12, 10, 8];
const FULL = { 1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2] };
const HALF = { 1: [], 2: [2], 3: [3], 4: [3], 5: [4, 2] };
const PACT = { 1: [1], 2: [2], 3: [0, 2], 4: [0, 2], 5: [0, 0, 2] };
const slotMap = (table, level) => Object.fromEntries((table[level] || []).map((n, i) => [i + 1, n]).filter(([, n]) => n > 0));

// weapons: [name, ability, die, extra (damage modifier bonus), type, note]; ac(mods) gives Armor Class from the final modifiers.
export const CLASS_KITS = {
  Barbarian: { hitDie: 12, order: ['str', 'con', 'dex', 'wis', 'cha', 'int'], saves: ['str', 'con'], skills: ['Athletics', 'Perception', 'Survival'], ac: (m) => 10 + m.dex + m.con, acNote: 'unarmored defense', weapons: [['Greataxe', 'str', '1d12', 0, 'slashing', 'Heavy, two-handed'], ['Handaxe', 'str', '1d6', 0, 'slashing', 'Thrown 20/60 ft']], items: [['Greataxe', 1, 7], ['Handaxe', 2, 2], ["Explorer's pack", 1, 59], ['Javelin', 4, 2]], gp: 10, proficiencies: 'Armor: light, medium, shields. Weapons: simple and martial.', features: 'Rage and Unarmored Defense (write the details from your class).' },
  Bard: { hitDie: 8, order: ['cha', 'dex', 'con', 'wis', 'int', 'str'], saves: ['dex', 'cha'], skills: ['Performance', 'Persuasion', 'Deception', 'Perception'], ac: (m) => 11 + m.dex, acNote: 'leather armor', weapons: [['Rapier', 'dex', '1d8', 0, 'piercing', 'Finesse'], ['Dagger', 'dex', '1d4', 0, 'piercing', 'Finesse, thrown 20/60 ft']], items: [['Leather armor', 1, 10], ['Rapier', 1, 2], ['Dagger', 1, 1], ["Entertainer's pack", 1, 38], ['Lute', 1, 2]], gp: 10, proficiencies: 'Armor: light. Weapons: simple, hand crossbow, longsword, rapier, shortsword. Tools: three musical instruments.', cast: { cls: 'Bard', ability: 'CHA', table: FULL } },
  Cleric: { hitDie: 8, order: ['wis', 'con', 'str', 'cha', 'dex', 'int'], saves: ['wis', 'cha'], skills: ['Insight', 'Religion', 'Medicine', 'Persuasion'], ac: (m) => 14 + Math.min(m.dex, 2) + 2, acNote: 'scale mail 14 + shield 2', weapons: [['Mace', 'str', '1d6', 0, 'bludgeoning', ''], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft']], items: [['Scale mail', 1, 45], ['Shield', 1, 6], ['Mace', 1, 4], ['Light crossbow', 1, 5], ["Priest's pack", 1, 24], ['Holy symbol', 1, 1]], gp: 10, proficiencies: 'Armor: light, medium, shields. Weapons: simple.', cast: { cls: 'Cleric', ability: 'WIS', table: FULL } },
  Druid: { hitDie: 8, order: ['wis', 'con', 'dex', 'int', 'cha', 'str'], saves: ['int', 'wis'], skills: ['Nature', 'Perception', 'Survival', 'Medicine'], ac: (m) => 11 + m.dex + 2, acNote: 'leather armor + wooden shield', weapons: [['Scimitar', 'dex', '1d6', 0, 'slashing', 'Finesse, light'], ['Quarterstaff', 'str', '1d6', 0, 'bludgeoning', 'Versatile 1d8']], items: [['Leather armor', 1, 10], ['Wooden shield', 1, 6], ['Scimitar', 1, 3], ["Explorer's pack", 1, 59], ['Druidic focus', 1, 1]], gp: 10, proficiencies: 'Armor: light, medium, shields (no metal). Weapons: clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears.', cast: { cls: 'Druid', ability: 'WIS', table: FULL } },
  Fighter: { hitDie: 10, order: ['str', 'con', 'dex', 'wis', 'cha', 'int'], saves: ['str', 'con'], skills: ['Athletics', 'Perception', 'Intimidation'], ac: () => 18, acNote: 'chain mail 16 + shield 2', weapons: [['Longsword', 'str', '1d8', 0, 'slashing', 'Versatile 1d10'], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft']], items: [['Chain mail', 1, 55], ['Shield', 1, 6], ['Longsword', 1, 3], ['Light crossbow', 1, 5], ["Dungeoneer's pack", 1, 61]], gp: 10, proficiencies: 'Armor: all armor, shields. Weapons: simple and martial.', features: 'Second Wind (bonus action: heal 1d10 + your level, once per short rest).' },
  Monk: { hitDie: 8, order: ['dex', 'wis', 'con', 'str', 'int', 'cha'], saves: ['str', 'dex'], skills: ['Acrobatics', 'Stealth', 'Insight'], ac: (m) => 10 + m.dex + m.wis, acNote: 'unarmored defense', weapons: [['Unarmed strike', 'dex', '1d4', 0, 'bludgeoning', 'Martial arts'], ['Shortsword', 'dex', '1d6', 0, 'piercing', 'Finesse, light']], items: [['Shortsword', 1, 2], ["Explorer's pack", 1, 59], ['Dart', 10, 0.25]], gp: 5, proficiencies: 'Weapons: simple, shortswords. Tools: one artisan tool or instrument.' },
  Paladin: { hitDie: 10, order: ['str', 'cha', 'con', 'wis', 'dex', 'int'], saves: ['wis', 'cha'], skills: ['Athletics', 'Persuasion', 'Religion'], ac: () => 18, acNote: 'chain mail 16 + shield 2', weapons: [['Longsword', 'str', '1d8', 0, 'slashing', 'Versatile 1d10'], ['Javelin', 'str', '1d6', 0, 'piercing', 'Thrown 30/120 ft']], items: [['Chain mail', 1, 55], ['Shield', 1, 6], ['Longsword', 1, 3], ['Javelin', 5, 2], ["Priest's pack", 1, 24], ['Holy symbol', 1, 1]], gp: 10, proficiencies: 'Armor: all armor, shields. Weapons: simple and martial.', features: 'Divine Sense and Lay on Hands (write the details from your class).', cast: { cls: 'Paladin', ability: 'CHA', table: HALF } },
  Ranger: { hitDie: 10, order: ['dex', 'wis', 'con', 'str', 'int', 'cha'], saves: ['str', 'dex'], skills: ['Survival', 'Stealth', 'Perception', 'Nature'], ac: (m) => 14 + Math.min(m.dex, 2), acNote: 'scale mail', weapons: [['Longbow', 'dex', '1d8', 0, 'piercing', 'Range 150/600 ft'], ['Shortsword', 'dex', '1d6', 0, 'piercing', 'Finesse, light']], items: [['Scale mail', 1, 45], ['Longbow', 1, 2], ['Arrows', 20, 0.05], ['Shortsword', 2, 2], ["Explorer's pack", 1, 59]], gp: 10, proficiencies: 'Armor: light, medium, shields. Weapons: simple and martial.', cast: { cls: 'Ranger', ability: 'WIS', table: HALF } },
  Rogue: { hitDie: 8, order: ['dex', 'int', 'con', 'cha', 'wis', 'str'], saves: ['dex', 'int'], skills: ['Stealth', 'Perception', 'Acrobatics', 'Sleight of Hand', 'Deception'], expertise: ['Stealth', 'Sleight of Hand'], ac: (m) => 11 + m.dex, acNote: 'leather armor', weapons: [['Shortsword', 'dex', '1d6', 0, 'piercing', 'Finesse, light. Sneak Attack 1d6 per two levels, rounded up'], ['Shortbow', 'dex', '1d6', 0, 'piercing', 'Range 80/320 ft']], items: [['Leather armor', 1, 10], ['Shortsword', 1, 2], ['Shortbow', 1, 2], ['Arrows', 20, 0.05], ['Dagger', 2, 1], ["Thieves' tools", 1, 1], ["Burglar's pack", 1, 44]], gp: 10, proficiencies: "Armor: light. Weapons: simple, hand crossbow, longsword, rapier, shortsword. Tools: thieves' tools." },
  Sorcerer: { hitDie: 6, order: ['cha', 'con', 'dex', 'wis', 'int', 'str'], saves: ['con', 'cha'], skills: ['Persuasion', 'Arcana', 'Insight'], ac: (m) => 10 + m.dex, acNote: 'no armor', weapons: [['Dagger', 'dex', '1d4', 0, 'piercing', 'Finesse, thrown 20/60 ft'], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft']], items: [['Dagger', 2, 1], ['Light crossbow', 1, 5], ["Dungeoneer's pack", 1, 61], ['Arcane focus', 1, 1]], gp: 10, proficiencies: 'Weapons: daggers, darts, slings, quarterstaffs, light crossbows.', cast: { cls: 'Sorcerer', ability: 'CHA', table: FULL } },
  Warlock: { hitDie: 8, order: ['cha', 'con', 'dex', 'wis', 'int', 'str'], saves: ['wis', 'cha'], skills: ['Arcana', 'Deception', 'Intimidation'], ac: (m) => 11 + m.dex, acNote: 'leather armor', weapons: [['Dagger', 'dex', '1d4', 0, 'piercing', 'Finesse, thrown 20/60 ft'], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft']], items: [['Leather armor', 1, 10], ['Dagger', 2, 1], ['Light crossbow', 1, 5], ["Scholar's pack", 1, 10], ['Arcane focus', 1, 1]], gp: 10, proficiencies: 'Armor: light. Weapons: simple.', cast: { cls: 'Warlock', ability: 'CHA', table: PACT } },
  Wizard: { hitDie: 6, order: ['int', 'con', 'dex', 'wis', 'cha', 'str'], saves: ['int', 'wis'], skills: ['Arcana', 'Investigation', 'History'], ac: (m) => 10 + m.dex, acNote: 'no armor', weapons: [['Quarterstaff', 'str', '1d6', 0, 'bludgeoning', 'Versatile 1d8'], ['Dagger', 'dex', '1d4', 0, 'piercing', 'Finesse, thrown 20/60 ft']], items: [['Quarterstaff', 1, 4], ['Dagger', 1, 1], ["Scholar's pack", 1, 10], ['Spellbook', 1, 3], ['Arcane focus', 1, 1]], gp: 10, proficiencies: 'Weapons: daggers, darts, slings, quarterstaffs, light crossbows.', cast: { cls: 'Wizard', ability: 'INT', table: FULL } }
};

// 2014 PHB races: ability bonuses, speed, darkvision (feet). Subraces are left to the sheet.
export const RACES = {
  Human: { bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30, darkvision: 0 },
  Dwarf: { bonus: { con: 2 }, speed: 25, darkvision: 60 },
  Elf: { bonus: { dex: 2 }, speed: 30, darkvision: 60 },
  Halfling: { bonus: { dex: 2 }, speed: 25, darkvision: 0 },
  Dragonborn: { bonus: { str: 2, cha: 1 }, speed: 30, darkvision: 0 },
  Gnome: { bonus: { int: 2 }, speed: 25, darkvision: 60 },
  'Half-Elf': { bonus: { cha: 2, dex: 1, con: 1 }, speed: 30, darkvision: 60 },
  'Half-Orc': { bonus: { str: 2, con: 1 }, speed: 30, darkvision: 60 },
  Tiefling: { bonus: { cha: 2, int: 1 }, speed: 30, darkvision: 60 }
};
const COLORS = ['#e5534b', '#3fd27f', '#4f9dff', '#e3b341', '#a78bfa', '#ff7ac8', '#57c47a', '#f0a040'];

export const quickChoices = () => ({ classes: Object.keys(CLASS_KITS), races: Object.keys(RACES), levels: [1, 2, 3, 4, 5] });

// id: a free character id; the caller checks it against the saved characters.
export function buildQuickCharacter({ id, name, cls, race, level = 1, color, campaigns }) {
  const kit = CLASS_KITS[cls], rc = RACES[race];
  if (!kit) throw new Error('Unknown class ' + cls);
  if (!rc) throw new Error('Unknown race ' + race);
  const lv = Math.max(1, Math.min(5, Math.round(Number(level) || 1)));
  const abilities = {};
  kit.order.forEach((k, i) => { abilities[k] = ARRAY[i] + (rc.bonus[k] || 0); });
  const mods = Object.fromEntries(Object.entries(abilities).map(([k, v]) => [k, modOf(v)]));
  const avg = Math.floor(kit.hitDie / 2) + 1;
  const maxHp = kit.hitDie + mods.con + (lv - 1) * (avg + mods.con);
  const slots = kit.cast ? slotMap(kit.cast.table, lv) : {};
  const hasSlots = Object.keys(slots).length > 0;
  const p = {
    id, name, color: color || COLORS[Math.abs([...id].reduce((n, ch) => n + ch.charCodeAt(0), 0)) % COLORS.length], darkvision: rc.darkvision,
    race, cls, level: lv, hitDie: kit.hitDie, maxHp: Math.max(1, maxHp), background: '', alignment: '', abilities,
    saves: kit.saves, skills: kit.skills, expertise: lv >= 1 ? (kit.expertise || []) : [], speed: rc.speed, ac: kit.ac(mods),
    weapons: kit.weapons, spellcasting: kit.cast && hasSlots ? { cls: kit.cast.cls, ability: kit.cast.ability, slots, cantrips: [], spells: { 1: [] } } : null,
    features: [kit.features || '', `Starter character made in the new campaign wizard (${race} ${cls} ${lv}): armor ${kit.acNote}. Fill in the class features, ${hasSlots ? 'cantrips and spells, ' : ''}background and personality on the Character Sheets page.`].filter(Boolean).join('\n'),
    proficiencies: kit.proficiencies, items: kit.items, gp: kit.gp, personality: '', flaws: '', backstory: ''
  };
  return buildCharacter(p, campaigns);
}
