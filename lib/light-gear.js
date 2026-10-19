// Light a character can carry (public/data/light-data.json): which items give light, how big, and how it is turned on.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let DATA = { kinds: {}, items: {} };
try { DATA = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'light-data.json'), 'utf8')); } catch { /* no data: no gear light */ }

export const LIGHT_KINDS = DATA.kinds || {};
export const slugOf = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The light entry for one inventory item (matched by its SRD index, else its name), or null.
export function lightOfItem(item) {
  const entry = (item?.srd && DATA.items?.[item.srd]) || DATA.items?.[slugOf(item?.name)] || null;
  const kind = entry && LIGHT_KINDS[entry.kind];
  return kind ? { kind: entry.kind, mode: entry.mode, how: entry.how, bright: kind.bright, dim: kind.dim, name: kind.name, needsItem: Boolean(kind.needsItem) } : null;
}

// What a character carries that gives light, for the DM: the item, the light kind, its sizes, whether it is lit by somebody or shines while held, and whether it is equipped.
export function lightItemsFor(inventory) {
  const out = [];
  for (const it of Array.isArray(inventory) ? inventory : []) {
    const l = lightOfItem(it);
    if (l) out.push({ item: it.name, kind: l.kind, mode: l.mode, how: l.how, bright: l.bright, dim: l.dim, equipped: it.equipped !== false });
  }
  return out;
}

// The light kind a character's gear gives by itself (mode held, equipped), or ''.
export function heldLightKind(inventory) {
  for (const it of Array.isArray(inventory) ? inventory : []) {
    const l = lightOfItem(it);
    if (l && l.mode === 'held' && it.equipped !== false) return l.kind;
  }
  return '';
}
