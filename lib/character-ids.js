// Character ids are GUIDs. Characters made before that had name slugs ("edric"); migrateCharacterIds() renames those files once,
// rewrites every saved reference (campaign parties, saved boards) and keeps an old-id -> new-id table in data/character-aliases.json
// so an old link, an old browser save or the DM's old habit of saying "edric" still finds the character.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const isGuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id ?? ''));
export const newCharacterId = () => randomUUID();
// The id a character's token gets: the slug ids keep their old token ids, a GUID gives a short readable one for the DM.
export const tokenIdFor = (id) => 'tok-' + (isGuid(id) ? String(id).slice(0, 8) : id);

const aliasFile = (dataDir) => path.join(dataDir, 'character-aliases.json');
export function readAliases(dataDir) {
  try { const a = JSON.parse(readFileSync(aliasFile(dataDir), 'utf8')); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; } catch { return {}; }
}
export const canonicalId = (aliases, id) => (aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id);

// Replace character ids in saved JSON where they are known to live: `characterId` values and the `party` list.
function rewrite(node, map, key = '') {
  if (Array.isArray(node)) return node.map((v) => (key === 'party' && typeof v === 'string' && map[v] ? map[v] : rewrite(v, map, key)));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = k === 'characterId' && typeof v === 'string' && map[v] ? map[v] : rewrite(v, map, k);
    return out;
  }
  return node;
}

// Returns the new aliases (old -> new) made by this run.
export function migrateCharacterIds(dataDir) {
  const charDir = path.join(dataDir, 'characters');
  if (!existsSync(charDir)) return {};
  const map = {};
  for (const file of readdirSync(charDir).filter((f) => f.endsWith('.json'))) {
    let c;
    try { c = JSON.parse(readFileSync(path.join(charDir, file), 'utf8')); } catch { continue; }
    if (!c || isGuid(c.id)) continue;
    const id = newCharacterId();
    map[c.id] = id;
    writeFileSync(path.join(charDir, `${id}.json`), JSON.stringify({ ...c, id }, null, 2));
    unlinkSync(path.join(charDir, file));
  }
  if (!Object.keys(map).length) return {};
  const campDir = path.join(dataDir, 'campaigns');
  if (existsSync(campDir)) {
    for (const camp of readdirSync(campDir)) {
      for (const f of ['campaign.json', 'game.json']) {
        const p = path.join(campDir, camp, f);
        if (!existsSync(p)) continue;
        try { writeFileSync(p, JSON.stringify(rewrite(JSON.parse(readFileSync(p, 'utf8')), map), null, 2)); } catch { /* an unreadable save is left as it is; the alias table still resolves old ids */ }
      }
    }
  }
  const all = { ...readAliases(dataDir), ...map };
  for (const [old, id] of Object.entries(all)) if (map[id]) all[old] = map[id];                      // keep chains short
  writeFileSync(aliasFile(dataDir), JSON.stringify(all, null, 2));
  return map;
}

