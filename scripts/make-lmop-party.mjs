// Writes the Lost Mine of Phandelver party (level 1, 2014 rules) into data/characters/ and tags the older test characters
// for the tavern campaign. Run: node scripts/make-lmop-party.mjs
// Every number is derived from the ability scores, class and proficiencies below, so the sheets cannot disagree with themselves;
// the script ends by checking each sheet against the values written on the player's character sheets.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { SAVES } from '../lib/sheet-edit.js';
import { buildCharacter } from '../lib/charbuild.js';

const CHAR_DIR = new URL('../data/characters/', import.meta.url);
const CAMPAIGN = 'lost-mine-of-phandelver';


const PARTY = [
  {
    id: 'edric', name: 'Edric', color: '#e5534b', darkvision: 0,
    race: 'Human', cls: 'Fighter', hitDie: 10, background: 'Folk Hero', alignment: 'Neutral Good',
    abilities: { str: 16, dex: 14, con: 15, int: 9, wis: 13, cha: 11 },
    saves: ['str', 'con'], skills: ['Athletics', 'Perception', 'Animal Handling', 'Survival'], expertise: [],
    speed: 30, ac: 18, acNote: 'chain mail 16 + shield 2',
    weapons: [['Longsword', 'str', '1d8', 2, 'slashing', 'Dueling +2 included'], ['Handaxe (x2)', 'str', '1d6', 0, 'slashing', 'Thrown 20/60 ft']],
    spellcasting: null,
    features: 'Fighting Style: Dueling (+2 damage with a melee weapon held in one hand and no other weapon).\nSecond Wind: once per short rest, a bonus action to regain 1d10 + 1 hit points.\nRustic Hospitality (Folk Hero): common folk will shelter and hide him.',
    proficiencies: 'Armor: all armor, shields. Weapons: simple and martial. Tools: smith\'s tools, land vehicles. Languages: Common, Dwarvish.',
    items: [['Chain mail', 1, 55], ['Shield', 1, 6], ['Longsword', 1, 3], ['Handaxe', 2, 2], ['Explorer\'s pack', 1, 59], ['Smith\'s tools', 1, 8], ['Shovel', 1, 5], ['Iron pot', 1, 10], ['Common clothes', 1, 3]],
    gp: 10,
    personality: 'Steady and quiet, quick to stand between trouble and anyone weaker.',
    flaws: 'Secretly fears he is just a lucky farm boy pretending to be a hero.',
    backstory: 'Edric Blackwell is the son of a village blacksmith. At nineteen, when starving wolves came down from the hills in a hard winter, he held the village gate alone through the night with a hammer and a half-finished sword. The villagers still tell the story.',
    expect: { maxHp: 12, ac: 18, init: '+2', passive: '13', saves: { str: '+5', con: '+4' }, atk: ['+5', '1d8+5'] }
  },
  {
    id: 'rachel', name: 'Raechyl', color: '#3fd27f', darkvision: 60,
    race: 'Tiefling', cls: 'Druid', hitDie: 8, background: 'Hermit', alignment: 'Neutral Good',
    // The players kept the ability scores she had as a hill dwarf when she became a tiefling (the 2014 tiefling would add +1 INT and +2 CHA instead).
    abilities: { str: 8, dex: 13, con: 16, int: 12, wis: 16, cha: 10 },
    saves: ['int', 'wis'], skills: ['Medicine', 'Religion', 'Perception', 'Nature'], expertise: [],
    speed: 30, ac: 14, acNote: 'leather armor 11 + Dex 1 + wooden shield 2',
    weapons: [['Quarterstaff (Shillelagh)', 'wis', '1d8', 0, 'bludgeoning', 'Shillelagh: bonus action, uses Wisdom'], ['Produce Flame', 'wis', '1d8', null, 'fire', 'Ranged spell attack, 30 ft']],
    spellcasting: { cls: 'Druid', ability: 'WIS', slots: 2, cantrips: ['Shillelagh', 'Produce Flame', 'Thaumaturgy'], level1: ['Healing Word', 'Cure Wounds', 'Entangle', 'Thunderwave'] },
    features: 'Druidic: the secret language of druids.\nSpellcasting (Wisdom): 2 cantrips and 4 prepared 1st-level spells, 2 slots.\nInfernal Legacy (Tiefling): knows Thaumaturgy.\nHellish Resistance (Tiefling): resistance to fire damage.\nDarkvision 60 ft.\nDiscovery (Hermit): a secret uncovered in isolation, revealed through play.\nAt level 2: Wild Shape and a druid circle.',
    proficiencies: 'Armor: light, medium, shields (nonmetal). Weapons: clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears. Tools: herbalism kit. Languages: Common, Infernal, Elvish, Druidic.',
    items: [['Leather armor', 1, 10], ['Wooden shield', 1, 6], ['Quarterstaff', 1, 4], ['Druidic focus', 1, 0], ['Herbalism kit', 1, 3], ['Explorer\'s pack', 1, 59], ['Scroll case of notes', 1, 1], ['Winter blanket', 1, 3], ['Common clothes', 1, 3]],
    gp: 5,
    personality: 'Raechyl (formerly Maren Stonebough) listens to what she believes are the trees\' dreams.',
    flaws: '',
    backstory: 'Raechyl (known as Maren Stonebough when the story began) spent twenty years in a cave beneath an old oak, tending the forest and listening to what she believes are the trees\' dreams. Lately the dreams have turned dark, as if something in the earth is waking, and she has come down from the hills to find out what. In the first session she became a tiefling; the table kept her ability scores.',
    expect: { maxHp: 11, ac: 14, init: '+1', passive: '15', saves: { int: '+3', wis: '+5' }, atk: ['+5', '1d8+3'], dc: '13', spellAtk: '+5' }
  },
  {
    id: 'shadowheart', name: 'Shadowheart', color: '#a78bfa', darkvision: 60,
    race: 'High Elf', cls: 'Cleric', hitDie: 8, background: 'Acolyte', alignment: '',
    abilities: { str: 8, dex: 15, con: 14, int: 13, wis: 15, cha: 10 },
    saves: ['wis', 'cha'], skills: ['Arcana', 'History', 'Insight', 'Medicine', 'Perception', 'Religion', 'Persuasion'], expertise: ['Arcana', 'History'],
    speed: 30, ac: 15, acNote: 'leather armor 11 + Dex 2 + shield 2',
    weapons: [['Light crossbow', 'dex', '1d8', 0, 'piercing', 'Range 80/320 ft, 20 bolts'], ['Mace', 'str', '1d6', 0, 'bludgeoning', 'Backup'], ['Chill Touch', 'int', '1d8', null, 'necrotic', '120 ft; target cannot regain hit points until her next turn']],
    spellcasting: { cls: 'Cleric (Knowledge)', ability: 'WIS', slots: 2, cantrips: ['Sacred Flame', 'Toll the Dead', 'Guidance', 'Chill Touch'], level1: ['Guiding Bolt', 'Healing Word', 'Sanctuary', 'Command', 'Identify'] },
    features: 'Spellcasting (Wisdom): 3 cleric cantrips, 3 prepared 1st-level spells plus the domain spells Command and Identify, 2 slots. Chill Touch is her High Elf cantrip (Intelligence).\nBlessings of Knowledge: two extra languages and expertise in Arcana and History.\nShelter of the Faithful (Acolyte): Selune\'s temples will shelter and aid her.\nDarkvision 60 ft. Fey Ancestry (advantage against being charmed, immune to magical sleep). Trance (4 hours). Keen Senses (Perception).\nAt level 2: Channel Divinity.',
    proficiencies: 'Armor: light, medium, shields. Weapons: simple weapons, longsword, shortsword, shortbow, longbow. Languages: Common, Elvish, Goblin, Draconic, Dwarvish, Celestial, Gnomish.',
    items: [['Leather armor', 1, 10], ['Shield', 1, 6], ['Mace', 1, 4], ['Light crossbow', 1, 5], ['Crossbow bolts', 20, 0.075], ['Explorer\'s pack', 1, 59], ['Holy symbol of Selune', 1, 1], ['Prayer book', 1, 1], ['Incense sticks', 5, 0], ['Vestments', 1, 4], ['Common clothes', 1, 3], ['The mysterious artifact', 1, 0]],
    gp: 15,
    personality: 'Guarded, sharp-tongued, quietly hungry for answers about her past.',
    flaws: '',
    backstory: 'Born to Selune\'s faithful, Shadowheart was taken as a child and raised in a secret temple of Shar, goddess of loss and forgetting. A Sharran ritual stripped away her memories of who she was. Sent out alone with a mysterious artifact, she has since broken from Shar and now follows Selune, the Moonmaiden. Her past remains a blank, a scar on her hand flares with unexplained pain, and Shar\'s servants may want her and the artifact back.',
    expect: { maxHp: 10, ac: 15, init: '+2', passive: '14', saves: { wis: '+4', cha: '+2' }, atk: ['+4', '1d8+2'], dc: '12', spellAtk: '+4' }
  },
  {
    id: 'astarion', name: 'Astarion', color: '#f0c048', darkvision: 60,
    race: 'High Elf', cls: 'Rogue', hitDie: 8, background: 'Charlatan', alignment: 'Chaotic Neutral',
    abilities: { str: 8, dex: 17, con: 14, int: 13, wis: 13, cha: 10 },
    saves: ['dex', 'int'], skills: ['Stealth', 'Sleight of Hand', 'Acrobatics', 'Investigation', 'Perception', 'Deception', 'Persuasion'], expertise: ['Stealth', 'Sleight of Hand'],
    speed: 30, ac: 14, acNote: 'leather armor 11 + Dex 3',
    weapons: [['Shortsword', 'dex', '1d6', 0, 'piercing', 'Finesse, light'], ['Shortbow', 'dex', '1d6', 0, 'piercing', 'Range 80/320 ft, 20 arrows'], ['Dagger (x2)', 'dex', '1d4', 0, 'piercing', 'Finesse, light, thrown 20/60 ft']],
    spellcasting: { cls: 'High Elf cantrip', ability: 'INT', slots: 0, cantrips: ['Mage Hand'], level1: [] },
    features: 'Sneak Attack (1d6): once per turn, extra damage with a finesse or ranged weapon when he has advantage or an ally is next to the target.\nExpertise: Stealth and Sleight of Hand.\nThieves\' Cant.\nFalse Identity (Charlatan): a second, documented identity.\nDarkvision 60 ft. Fey Ancestry. Trance (4 hours). Keen Senses (Perception). High Elf cantrip: Mage Hand (Intelligence).\nAt level 2: Cunning Action.',
    proficiencies: 'Armor: light. Weapons: simple weapons, hand crossbows, longswords, rapiers, shortswords, shortbows, longbows. Tools: thieves\' tools, disguise kit, forgery kit. Languages: Common, Elvish, Infernal, Thieves\' Cant.',
    items: [['Leather armor', 1, 10], ['Shortsword', 1, 2], ['Shortbow', 1, 2], ['Arrows', 20, 0.05], ['Dagger', 2, 1], ['Thieves\' tools', 1, 1], ['Burglar\'s pack', 1, 44], ['Fine clothes', 1, 6], ['Disguise kit', 1, 3], ['Forgery kit', 1, 5]],
    gp: 15,
    personality: 'Vain, charming and sharp-tongued; quietly terrified of being controlled again.',
    flaws: 'Bound by a dark pact to Cazador Szarr, who will want him back.',
    backstory: 'Two hundred years ago Astarion was a magistrate in Baldur\'s Gate. Then the noble Cazador Szarr bound him with a dark pact, and for two centuries he served as Cazador\'s compelled hunter and lure. Runes he has never seen are carved into his back. The binding recently cracked and he ran. He has no vampirism: he is magically bound, not undead.',
    expect: { maxHp: 10, ac: 14, init: '+3', passive: '13', saves: { dex: '+5', int: '+3' }, atk: ['+5', '1d6+3'] }
  }
];

const build = (p) => buildCharacter(p, [CAMPAIGN]);

// Check every derived number against what the player's sheet says.
let problems = 0;
for (const p of PARTY) {
  const c = build(p);
  const s = c.sheet, e = p.expect;
  const got = { maxHp: c.maxHp, ac: c.ac, init: s.Initiative, passive: s.Passive, atk: [s['Wpn1 AtkBonus'], s['Wpn1 Damage'].split(' ')[0]] };
  const want = { maxHp: e.maxHp, ac: e.ac, init: e.init, passive: e.passive, atk: e.atk };
  const bad = [];
  for (const k of Object.keys(want)) if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) bad.push(`${k}: built ${JSON.stringify(got[k])}, sheet says ${JSON.stringify(want[k])}`);
  for (const k of Object.keys(e.saves)) if (s[SAVES[k].field] !== e.saves[k]) bad.push(`${k} save: built ${s[SAVES[k].field]}, sheet says ${e.saves[k]}`);
  if (e.dc && (s['SpellSaveDC  2'] !== e.dc || s['SpellAtkBonus 2'] !== e.spellAtk)) bad.push(`spell DC/attack: built ${s['SpellSaveDC  2']}/${s['SpellAtkBonus 2']}, sheet says ${e.dc}/${e.spellAtk}`);
  if (bad.length) { problems += bad.length; console.log(`MISMATCH ${p.name}:\n  ${bad.join('\n  ')}`); } else console.log(`ok  ${p.name}: HP ${c.maxHp}, AC ${c.ac} (${p.acNote}), init ${s.Initiative}, passive ${s.Passive}`);
  writeFileSync(new URL(`${p.id}.json`, CHAR_DIR), JSON.stringify(c, null, 2));
}
// The four older test characters belong to the tavern test campaign.
for (const f of readdirSync(CHAR_DIR).filter((n) => /^(thorin|lyra|vex|seraphine)\.json$/.test(n))) {
  const file = new URL(f, CHAR_DIR);
  const c = JSON.parse(readFileSync(file, 'utf8'));
  c.campaigns = ['tavern-brawl-test'];
  writeFileSync(file, JSON.stringify(c, null, 2));
}
if (problems) process.exit(1);
