// The SRD compendium: monsters, spells, magic items (data/srd/*.json, see data/srd/NOTICE.md). Loaded once, summarised for lists.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'srd');
const FILES = { monsters: 'monsters.json', spells: 'spells.json', 'magic-items': 'magic-items.json', equipment: 'equipment.json' };
const cache = new Map();

async function load(kind) {
  if (!FILES[kind]) return null;
  if (!cache.has(kind)) cache.set(kind, JSON.parse(await readFile(path.join(dir, FILES[kind]), 'utf8')));
  return cache.get(kind);
}

const summaries = {
  monsters: (m) => ({
    index: m.index, name: m.name, size: m.size, type: m.type, subtype: m.subtype || '', alignment: m.alignment,
    cr: m.challenge_rating, xp: m.xp, hp: m.hit_points, ac: m.armor_class?.[0]?.value ?? 10, speed: m.speed?.walk || ''
  }),
  spells: (s) => ({
    index: s.index, name: s.name, level: s.level, school: s.school?.name || '', classes: (s.classes || []).map((c) => c.name),
    concentration: Boolean(s.concentration), ritual: Boolean(s.ritual), castingTime: s.casting_time, range: s.range
  }),
  'magic-items': (i) => ({ index: i.index, name: i.name, category: i.equipment_category?.name || '', rarity: i.rarity?.name || '' }),
  equipment: (i) => ({ index: i.index, name: i.name, category: i.equipment_category?.name || '', weight: i.weight ?? 0, cost: i.cost ? `${i.cost.quantity} ${i.cost.unit}` : '' })
};

export async function listEntries(kind) {
  const all = await load(kind);
  return all ? all.map(summaries[kind]) : null;
}

export async function getEntry(kind, index) {
  const all = await load(kind);
  return all ? all.find((e) => e.index === index) || null : null;
}
