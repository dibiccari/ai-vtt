// The Rusty Flagon test party (Thorin, Lyra, Vex, Seraphine; level 3, 2014 rules) with the weapons, spells, slots and gear their classes would
// normally have. `base` is their stats if their file is missing. Used by scripts/make-tavern-party.mjs and by the Test Lab, which resets them to
// this starting kit (full hit points) every time it starts the scenario.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCharacter } from './charbuild.js';

export const TAVERN_CAMPAIGN = 'tavern-brawl-test';

export const TAVERN_PARTY = [
  {
    id: 'thorin', base: { name: 'Thorin', color: '#e5534b', darkvision: 60, level: 3, maxHp: 31, ac: 18, speed: 25, abilities: { str: 16, dex: 12, con: 16, int: 10, wis: 12, cha: 8 } },
    race: 'Dwarf', cls: 'Fighter', hitDie: 10, background: 'Soldier', alignment: 'Lawful Good',
    saves: ['str', 'con'], skills: ['Athletics', 'Intimidation', 'Perception', 'Survival'], expertise: [],
    acNote: 'chain mail 16 + shield 2',
    weapons: [['Longsword', 'str', '1d8', 2, 'slashing', 'Dueling +2 included; versatile 1d10 two-handed'], ['Handaxe (x2)', 'str', '1d6', 0, 'slashing', 'Thrown 20/60 ft'], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft, 20 bolts']],
    spellcasting: null,
    features: 'Fighting Style: Dueling (+2 damage with a melee weapon held in one hand and no other weapon).\nSecond Wind: once per short rest, a bonus action to regain 1d10 + 3 hit points.\nAction Surge: once per short rest, one extra action on his turn.\nMartial Archetype, Champion: Improved Critical (weapon attacks score a critical hit on a 19 or 20).\nDwarven Resilience (advantage on saves against poison, resistance to poison damage), Dwarven Combat Training, Stonecunning, Darkvision 60 ft.\nMilitary Rank (Soldier).',
    proficiencies: 'Armor: all armor, shields. Weapons: simple and martial, battleaxe, handaxe, light hammer, warhammer. Tools: smith\'s tools, dice set, land vehicles. Languages: Common, Dwarvish.',
    items: [['Chain mail', 1, 55], ['Shield', 1, 6], ['Longsword', 1, 3], ['Handaxe', 2, 2], ['Light crossbow', 1, 5], ['Crossbow bolts', 20, 0.075], ['Dungeoneer\'s pack', 1, 61.5], ['Smith\'s tools', 1, 8], ['Dice set', 1, 0], ['Insignia of rank', 1, 0], ['Common clothes', 1, 3]],
    gp: 10, personality: 'Gruff and dependable; tells it straight.', flaws: 'Slow to forgive.', backstory: 'A dwarf soldier of a mountain hold who took up a sellsword\'s coin when his company disbanded.'
  },
  {
    id: 'lyra', base: { name: 'Lyra', color: '#4f9dff', darkvision: 0, level: 3, maxHp: 20, ac: 12, speed: 30, abilities: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 }, image: '/tokens/aether-wielding-archer-40f81.png' },
    race: 'Human', cls: 'Wizard', hitDie: 6, background: 'Sage', alignment: 'Neutral Good',
    saves: ['int', 'wis'], skills: ['Arcana', 'History', 'Investigation', 'Insight'], expertise: [],
    acNote: 'no armor: 10 + Dex 2',
    weapons: [['Dagger', 'dex', '1d4', 0, 'piercing', 'Finesse, light, thrown 20/60 ft'], ['Quarterstaff', 'str', '1d6', 0, 'bludgeoning', 'Versatile 1d8 two-handed'], ['Fire Bolt', 'int', '1d10', null, 'fire', 'Ranged spell attack, 120 ft'], ['Shocking Grasp', 'int', '1d8', null, 'lightning', 'Melee spell attack; target cannot take reactions until its next turn']],
    spellcasting: { cls: 'Wizard', ability: 'INT', slots: { 1: 4, 2: 2 }, cantrips: ['Fire Bolt', 'Mage Hand', 'Shocking Grasp'], spells: { 1: ['Magic Missile', 'Shield', 'Sleep', 'Mage Armor'], 2: ['Misty Step', 'Scorching Ray'] } },
    features: 'Spellcasting (Intelligence): 3 cantrips; 6 prepared spells (Intelligence modifier + level) from a spellbook of 10; 4 first-level and 2 second-level slots.\nArcane Recovery: once per day after a short rest, recover spell slots of up to 2 combined levels (no slot above 5th).\nResearcher (Sage): knows where to find the answers she does not have.\nIn her spellbook but not prepared: Burning Hands, Detect Magic, Find Familiar, Identify.',
    proficiencies: 'Armor: none. Weapons: daggers, darts, slings, quarterstaffs, light crossbows. Tools: none. Languages: Common, Elvish, Draconic.',
    items: [['Quarterstaff', 1, 4], ['Dagger', 1, 1], ['Spellbook', 1, 3], ['Component pouch', 1, 2], ['Scholar\'s pack', 1, 10], ['Ink and a quill', 1, 0], ['Common clothes', 1, 3]],
    gp: 10, personality: 'Curious, a little too eager to see what a spell does.', flaws: 'Overconfident with her magic.', backstory: 'A scholar who left the library for a more practical education.'
  },
  {
    id: 'vex', base: { name: 'Vex', color: '#57c47a', darkvision: 60, level: 3, maxHp: 21, ac: 15, speed: 30, abilities: { str: 10, dex: 17, con: 12, int: 13, wis: 12, cha: 14 } },
    race: 'High Elf', cls: 'Rogue', hitDie: 8, background: 'Criminal', alignment: 'Chaotic Good',
    saves: ['dex', 'int'], skills: ['Stealth', 'Sleight of Hand', 'Acrobatics', 'Perception', 'Deception'], expertise: ['Stealth', 'Sleight of Hand'],
    acNote: 'studded leather 12 + Dex 3',
    weapons: [['Rapier', 'dex', '1d8', 0, 'piercing', 'Finesse'], ['Shortbow', 'dex', '1d6', 0, 'piercing', 'Range 80/320 ft, 20 arrows'], ['Dagger (x2)', 'dex', '1d4', 0, 'piercing', 'Finesse, light, thrown 20/60 ft']],
    spellcasting: { cls: 'High Elf cantrip', ability: 'INT', slots: 0, cantrips: ['Prestidigitation'], spells: {} },
    features: 'Sneak Attack (2d6): once per turn, extra damage with a finesse or ranged weapon when she has advantage or an ally is next to the target.\nExpertise: Stealth and Sleight of Hand.\nThieves\' Cant.\nCunning Action: Dash, Disengage or Hide as a bonus action.\nRoguish Archetype, Thief: Fast Hands (Cunning Action can also use an object or Sleight of Hand) and Second-Story Work (climbing costs no extra movement).\nCriminal Contact (Criminal).\nDarkvision 60 ft. Fey Ancestry. Trance (4 hours). Keen Senses (Perception). High Elf cantrip: Prestidigitation (Intelligence).',
    proficiencies: 'Armor: light. Weapons: simple, hand crossbows, longswords, rapiers, shortswords, shortbows, longbows. Tools: thieves\' tools, dice set. Languages: Common, Elvish, Thieves\' Cant.',
    items: [['Studded leather armor', 1, 13], ['Rapier', 1, 2], ['Shortbow', 1, 2], ['Arrows', 20, 0.05], ['Dagger', 2, 1], ['Thieves\' tools', 1, 1], ['Burglar\'s pack', 1, 44], ['Dark common clothes with a hood', 1, 3]],
    gp: 15, personality: 'Quick with a joke and quicker with her hands.', flaws: 'Cannot resist an unlocked door.', backstory: 'An elf who learned the trade in the back streets of a big city.'
  },
  {
    id: 'seraphine', base: { name: 'Seraphine', color: '#e3b341', darkvision: 60, level: 3, maxHp: 24, ac: 16, speed: 30, abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 } },
    race: 'Half-Elf', cls: 'Cleric', hitDie: 8, background: 'Acolyte', alignment: 'Neutral Good',
    saves: ['wis', 'cha'], skills: ['Insight', 'Medicine', 'Religion', 'Persuasion'], expertise: [],
    acNote: 'scale mail 14 + shield 2 (Dex +0)',
    weapons: [['Mace', 'str', '1d6', 0, 'bludgeoning', ''], ['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft, 20 bolts'], ['Sacred Flame', 'wis', '1d8', null, 'radiant', 'Dexterity save, 60 ft; ignores cover'], ['Guiding Bolt', 'wis', '4d6', null, 'radiant', 'Ranged spell attack, 120 ft, 1st-level slot; next attack against the target has advantage']],
    spellcasting: { cls: 'Cleric (Life)', ability: 'WIS', slots: { 1: 4, 2: 2 }, cantrips: ['Sacred Flame', 'Guidance', 'Spare the Dying'], spells: { 1: ['Bless', 'Cure Wounds', 'Healing Word', 'Guiding Bolt', 'Shield of Faith', 'Sanctuary'], 2: ['Lesser Restoration', 'Spiritual Weapon', 'Aid'] } },
    features: 'Spellcasting (Wisdom): 3 cantrips; 6 prepared spells (Wisdom modifier + level) plus the Life domain spells (Bless, Cure Wounds, Lesser Restoration, Spiritual Weapon), which are always prepared; 4 first-level and 2 second-level slots.\nDivine Domain, Life: Disciple of Life (healing spells restore 2 + the spell\'s level extra hit points), Channel Divinity: Preserve Life (heal 15 hit points, split among creatures within 30 ft), bonus proficiency with heavy armor.\nChannel Divinity: Turn Undead (1/short rest).\nShelter of the Faithful (Acolyte).\nDarkvision 60 ft. Fey Ancestry. Skill Versatility.',
    proficiencies: 'Armor: all armor, shields. Weapons: simple. Tools: none. Languages: Common, Elvish, Celestial.',
    items: [['Scale mail', 1, 45], ['Shield', 1, 6], ['Mace', 1, 4], ['Light crossbow', 1, 5], ['Crossbow bolts', 20, 0.075], ['Priest\'s pack', 1, 24], ['Holy symbol', 1, 1], ['Prayer book', 1, 1], ['Vestments', 1, 4]],
    gp: 15, personality: 'Calm in a crisis; first to the wounded.', flaws: 'Takes on everyone else\'s troubles.', backstory: 'A temple healer who followed the wounded out of the cloister.'
  }
];

// Write the four characters into charDir. Their stats, token pictures and (with keepHp) current hit points are taken from the files already there.
export async function writeTavernParty(charDir, { keepHp = true } = {}) {
  const done = [];
  for (const p of TAVERN_PARTY) {
    const file = path.join(charDir, `${p.id}.json`);
    let old = {};
    try { old = JSON.parse(await readFile(file, 'utf8')); } catch { /* missing: the base stats are used */ }
    const stat = { ...p.base, ...Object.fromEntries(['name', 'color', 'darkvision', 'abilities', 'speed', 'ac', 'level', 'maxHp', 'image'].filter((k) => old[k] !== undefined).map((k) => [k, old[k]])) };
    const c = buildCharacter({ ...p, ...stat, hp: keepHp ? old.hp : undefined, xp: 900 }, [TAVERN_CAMPAIGN]);
    await writeFile(file, JSON.stringify(c, null, 2));
    done.push(c);
  }
  return done;
}
