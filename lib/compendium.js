// The SRD compendium: monsters, spells, magic items (data/srd/*.json, see data/srd/NOTICE.md). Loaded once, summarised for lists.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'srd');
const FILES = { monsters: 'monsters.json', spells: 'spells.json', 'magic-items': 'magic-items.json', equipment: 'equipment.json' };
const cache = new Map();

// Token art for a creature: the closest picture in the token collection (public/tokens). Words in the creature's name are matched
// against the token names; a creature with no word in common gets a token from the category that fits its type.
const STOP = new Set(['adult', 'ancient', 'young', 'wyrmling', 'the', 'of', 'a', 'an', 'in', 'at', 'with', 'and', 'lord', 'captain', 'swarm']);
const CATEGORY_FOR_TYPE = { aberration: ['Aberrations'], beast: ['Beasts'], dragon: ['Dragons'], undead: ['Undead'], humanoid: ['Humans', 'Warriors and Rogues'], plant: ['Plant Creatures'], giant: ['Miscellaneous Monsters'], fiend: ['Miscellaneous Monsters'], construct: ['Miscellaneous Monsters'], elemental: ['Miscellaneous Monsters'], ooze: ['Miscellaneous Monsters'], fey: ['Miscellaneous Monsters'], celestial: ['Spellcasters'], monstrosity: ['Miscellaneous Monsters'], swarm: ['Beasts'] };
let tokenIndex = null;
const words = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
async function tokens() {
  if (!tokenIndex) {
    try {
      const m = JSON.parse(await readFile(path.join(dir, '..', '..', 'public', 'tokens', 'manifest.json'), 'utf8'));
      tokenIndex = (m.tokens || []).map((t) => ({ file: t.file, category: t.category, words: new Set(words(t.name)) }));
    } catch { tokenIndex = []; }
  }
  return tokenIndex;
}
export async function monsterImage(m) {
  const list = await tokens();
  if (!list.length) return '';
  const mw = words(m.name);
  let best = null, bestScore = 0;
  for (const t of list) {
    const shared = mw.filter((w) => t.words.has(w)).length;
    if (!shared) continue;
    const score = shared * 10 + (shared === mw.length ? 5 : 0) - Math.max(0, t.words.size - mw.length) * 0.3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  if (!best) {
    const type = String(m.type || '').split(' ')[0].toLowerCase();
    const cats = CATEGORY_FOR_TYPE[type] || ['Miscellaneous Monsters'];
    const pool = list.filter((t) => cats.includes(t.category));
    if (pool.length) { let h = 0; for (const c of m.index) h = (h * 31 + c.charCodeAt(0)) >>> 0; best = pool[h % pool.length]; }
  }
  return best ? `/tokens/${best.file}` : '';
}

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
  if (!all) return null;
  const out = all.map(summaries[kind]);
  if (kind === 'monsters') for (let i = 0; i < out.length; i++) out[i].image = await monsterImage(all[i]);
  return out;
}

export async function getEntry(kind, index) {
  const all = await load(kind);
  const found = all ? all.find((e) => e.index === index) || null : null;
  return found && kind === 'monsters' ? { ...found, image: await monsterImage(found) } : found;
}
