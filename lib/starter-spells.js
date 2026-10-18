// Starter spells for the campaign wizard's quick characters: sensible picks from the SRD, in order of usefulness, taken by the class's own counts (2014 rules).
// Known casters (bard, sorcerer, warlock, ranger) learn `spells_known` spells; the wizard writes 6 + 2 per level above 1 into the spellbook; prepared casters (cleric, druid, paladin)
// prepare their ability modifier plus their level (half the level for a paladin), at least one. The numbers of cantrips and spells known come from data/srd/levels.json.
import { readFileSync } from 'node:fs';

const LEVELS = JSON.parse(readFileSync(new URL('../data/srd/levels.json', import.meta.url), 'utf8'));
const SPELLS = JSON.parse(readFileSync(new URL('../data/srd/spells.json', import.meta.url), 'utf8'));
const LEVEL_OF = new Map(SPELLS.map((s) => [s.name, s.level]));

// [name, ...] cantrips, and [spell level, name] in the order they are picked.
export const PICKS = {
  Wizard: { cantrips: ['Fire Bolt', 'Mage Hand', 'Light', 'Prestidigitation', 'Ray of Frost'], spells: [[1, 'Magic Missile'], [1, 'Shield'], [1, 'Sleep'], [1, 'Mage Armor'], [1, 'Detect Magic'], [1, 'Burning Hands'], [2, 'Misty Step'], [2, 'Scorching Ray'], [1, 'Find Familiar'], [2, 'Invisibility'], [3, 'Fireball'], [3, 'Counterspell'], [1, 'Thunderwave'], [2, 'Web'], [3, 'Fly'], [3, 'Haste'], [2, 'Mirror Image'], [1, 'Identify']] },
  Sorcerer: { cantrips: ['Fire Bolt', 'Mage Hand', 'Light', 'Prestidigitation', 'Ray of Frost', 'Minor Illusion'], spells: [[1, 'Magic Missile'], [1, 'Shield'], [1, 'Sleep'], [1, 'Burning Hands'], [2, 'Misty Step'], [2, 'Scorching Ray'], [3, 'Fireball'], [1, 'Charm Person'], [2, 'Invisibility'], [3, 'Counterspell'], [1, 'Mage Armor'], [3, 'Haste']] },
  Bard: { cantrips: ['Vicious Mockery', 'Mage Hand', 'Light', 'Minor Illusion'], spells: [[1, 'Healing Word'], [1, 'Faerie Fire'], [1, 'Cure Wounds'], [1, 'Thunderwave'], [2, 'Hold Person'], [2, 'Invisibility'], [1, 'Charm Person'], [3, 'Hypnotic Pattern'], [2, 'Shatter'], [3, 'Dispel Magic'], [2, 'Suggestion'], [1, 'Sleep'], [3, 'Fear']] },
  Warlock: { cantrips: ['Eldritch Blast', 'Mage Hand', 'Minor Illusion', 'Prestidigitation'], spells: [[1, 'Hellish Rebuke'], [1, 'Charm Person'], [1, 'Protection from Evil and Good'], [2, 'Misty Step'], [2, 'Hold Person'], [2, 'Invisibility'], [2, 'Darkness'], [2, 'Suggestion']] },
  Cleric: { cantrips: ['Sacred Flame', 'Guidance', 'Light', 'Spare the Dying', 'Thaumaturgy'], spells: [[1, 'Cure Wounds'], [1, 'Bless'], [1, 'Guiding Bolt'], [1, 'Healing Word'], [1, 'Shield of Faith'], [2, 'Spiritual Weapon'], [2, 'Lesser Restoration'], [1, 'Sanctuary'], [3, 'Spirit Guardians'], [2, 'Aid'], [3, 'Revivify'], [2, 'Hold Person'], [3, 'Dispel Magic'], [1, 'Command'], [1, 'Detect Magic']] },
  Druid: { cantrips: ['Produce Flame', 'Guidance', 'Shillelagh', 'Druidcraft'], spells: [[1, 'Cure Wounds'], [1, 'Entangle'], [1, 'Faerie Fire'], [1, 'Healing Word'], [1, 'Thunderwave'], [2, 'Barkskin'], [2, 'Flaming Sphere'], [1, 'Goodberry'], [2, 'Lesser Restoration'], [3, 'Call Lightning'], [2, 'Moonbeam'], [1, 'Fog Cloud'], [3, 'Dispel Magic']] },
  Paladin: { cantrips: [], spells: [[1, 'Bless'], [1, 'Cure Wounds'], [1, 'Shield of Faith'], [1, 'Divine Favor'], [1, 'Command'], [2, 'Aid'], [2, 'Lesser Restoration'], [2, 'Zone of Truth'], [1, 'Detect Magic']] },
  Ranger: { cantrips: [], spells: [[1, "Hunter's Mark"], [1, 'Cure Wounds'], [1, 'Goodberry'], [1, 'Fog Cloud'], [2, 'Lesser Restoration'], [2, 'Barkskin'], [2, 'Spike Growth'], [2, 'Silence']] }
};

const levelData = (cls, level) => (LEVELS.find((l) => l.index === `${cls.toLowerCase()}-${level}`) || {}).spellcasting || {};
const maxSpellLevel = (sc) => { let m = 0; for (let n = 1; n <= 9; n++) if (Number(sc[`spell_slots_level_${n}`]) > 0) m = n; return m; };

// { cantrips: [names], spells: { level: [names] } } for a class and level (1-5); `mod` is the casting ability's modifier.
export function starterSpells(cls, level, mod) {
  const picks = PICKS[cls];
  if (!picks) return { cantrips: [], spells: {} };
  const sc = levelData(cls, level), top = maxSpellLevel(sc);
  const cantrips = picks.cantrips.slice(0, Number(sc.cantrips_known) || 0);
  let count;
  if (cls === 'Wizard') count = 6 + 2 * (level - 1);
  else if (cls === 'Cleric' || cls === 'Druid') count = Math.max(1, mod + level);
  else if (cls === 'Paladin') count = Math.max(1, mod + Math.floor(level / 2));
  else count = Number(sc.spells_known) || 0;
  const spells = {};
  let n = 0;
  for (const [lv, name] of picks.spells) {
    if (n >= count) break;
    if (lv > top || LEVEL_OF.get(name) === undefined) continue;
    (spells[lv] = spells[lv] || []).push(name); n += 1;
  }
  return { cantrips, spells };
}
