// Gives the four Rusty Flagon test characters (Thorin, Lyra, Vex, Seraphine; level 3, 2014 rules) the weapons, spells, gear and sheet fields their
// classes would normally have (the definitions are in lib/tavern-party.js). Their stats, token pictures and current hit points are kept.
// Run: node scripts/make-tavern-party.mjs        (add --full to restore full hit points as well)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeTavernParty } from '../lib/tavern-party.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'characters');
for (const c of await writeTavernParty(dir, { keepHp: !process.argv.includes('--full') })) {
  const s = c.sheet;
  console.log(`${c.name.padEnd(10)} ${c.class} ${c.level}: HP ${c.hp}/${c.maxHp}, AC ${c.ac}, init ${s.Initiative}, passive ${s.Passive}, ${c.sheet.AttacksSpellcasting.split('\n').length} attacks${s['SpellSaveDC  2'] ? `, spell DC ${s['SpellSaveDC  2']}/${s['SpellAtkBonus 2']}` : ''}`);
}
