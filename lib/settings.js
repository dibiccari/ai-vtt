// Table settings, chosen per campaign before it is played (Campaigns page > Settings) and given to the DM every turn.
// Saved in data/campaigns/<id>/settings.json. A campaign with no file gets the defaults.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RULES_VERSIONS = ['2014', '2024'];
export const DEFAULT_SETTINGS = { permadeath: false, rules: '2014', variantEncumbrance: false, tableNotes: '' };

export function cleanSettings(raw) {
  return {
    permadeath: raw?.permadeath === true,
    rules: RULES_VERSIONS.includes(String(raw?.rules)) ? String(raw.rules) : DEFAULT_SETTINGS.rules,
    variantEncumbrance: raw?.variantEncumbrance === true,
    tableNotes: String(raw?.tableNotes ?? '').trim().slice(0, 3000)
  };
}

export async function readSettings(dir) {
  try { return cleanSettings(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))); } catch { return cleanSettings({}); }
}

export async function writeSettings(dir, raw) {
  const clean = cleanSettings(raw);
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ version: 1, ...clean }, null, 2));
  return clean;
}

// What the DM is told about the table's rules.
export function settingsForPrompt(s) {
  const parts = ['TABLE SETTINGS (chosen for this campaign before play; follow them):'];
  parts.push(s.rules === '2024'
    ? 'Rules: use the 2024 revised Player\'s Handbook and 2025 Dungeon Master\'s Guide rules (current class, species and background features).'
    : 'Rules: use the 2014 Player\'s Handbook rules (the 5.1 System Reference Document) and the character options of that edition. Do not use 2024 changes.');
  parts.push(s.permadeath
    ? 'Death: permanent. Death saving throws, massive damage and the death rules work exactly as written, and a character who dies stays dead unless the party can pay for a resurrection spell.'
    : 'Death: no permanent character death. Run death saving throws as written, but when a character would die (a third failed death save, or instant death from massive damage) they do not die: they are left unconscious and out of the fight, and the story takes a setback instead, such as being captured, robbed of gear, left for dead or waking somewhere bad. Play the setback out, then bring them back at 1 hit point with a heal update. Never announce that the rule is saving them; make it part of the fiction.');
  parts.push(s.variantEncumbrance
    ? 'Encumbrance: the optional variant rule is on (a character is encumbered, speed down 10 ft, when carrying more than 5 times their Strength score in pounds, and heavily encumbered, speed down 20 ft with disadvantage on checks, attacks and Strength, Dexterity and Constitution saves, over 10 times; the limit is 15 times).'
    : 'Encumbrance: the standard rule only. Characters can carry up to 15 times their Strength score in pounds with no penalty; do not apply the optional encumbered or heavily encumbered penalties.');
  if (s.tableNotes) parts.push(`Notes about this table: ${s.tableNotes}`);
  return parts.join('\n');
}
