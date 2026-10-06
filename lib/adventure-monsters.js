// Creatures that belong to an adventure and are not in the SRD (the Redbrand ruffian, Sildar, Nezznar...). They live in data/campaigns/<id>/monsters.json
// in the same shape as the SRD entries (index, name, hit_points, armor_class, speed, dexterity) so the table can fill in their numbers.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadAdventureMonsters(campaignDir) {
  try {
    const raw = JSON.parse(await readFile(path.join(campaignDir, 'monsters.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.monsters;
    const monsters = Array.isArray(list) ? list.filter((m) => m && typeof m.index === 'string' && Number.isFinite(m.hit_points)) : [];
    monsters.note = Array.isArray(raw) ? '' : String(raw.note ?? '');
    return monsters;
  } catch { const none = []; none.note = ''; return none; }
}

export function adventureMonsterFor(list, index) {
  const key = String(index ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return list.find((m) => m.index === key) || null;
}

// A short block for the DM prompt: which indexes exist beyond the SRD, with their numbers.
export function adventureMonstersForPrompt(list) {
  if (!list.length) return '';
  const lines = list.map((m) => `- ${m.index}: ${m.name}, AC ${m.armor_class?.[0]?.value ?? 10}, ${m.hit_points} HP (${m.hit_dice}), speed ${m.speed?.walk}. ${m.attacks || ''}`);
  return 'ADVENTURE CREATURES NOT IN THE SRD: when you add one of these, use its index as the monster field (the table fills in the hit points, Armor Class and speed). ' + (list.note ? list.note + ' ' : '') + '\n' + lines.join('\n');
}
