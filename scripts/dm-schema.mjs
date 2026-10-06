// Test helpers that read server.js as TEXT (so server.js does not need to change and nothing is started): the DM reply schema (DM_SCHEMA),
// the three pure expanders for the DM's flat updates (expandTokenUpdates, gearToPartyUpdates, expandSheetEdits), and a small JSON-schema checker.
// Used by test/*.test.mjs and scripts/dm-check.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS } from '../lib/sheet-edit.js';
import { CATEGORIES, STATUSES } from '../lib/journal.js';
import { EFFECT_KINDS } from '../lib/party.js';
import { getEntry, monsterImage } from '../lib/compendium.js';
import { adventureMonsterFor } from '../lib/adventure-monsters.js';
import '../public/token-size.js';              // sets globalThis.TokenSize, used by expandTokenUpdates

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadServerPieces(serverFile = path.join(ROOT, 'server.js')) {
  const src = readFileSync(serverFile, 'utf8');
  const cut = (from, to, label) => {
    const a = src.indexOf(from), b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`server.js changed shape: cannot find ${label} (${from} .. ${to}). Update scripts/dm-schema.mjs.`);
    return src.slice(a, b);
  };
  const expanders = cut('function expandSheetEdits', "const VOICES = [", 'the update expanders');
  const schemaEnd = src.indexOf('\n};\n', src.indexOf('DM_SCHEMA.properties.voiceLines = {')) + 4;
  const schemaSrc = src.slice(src.indexOf("const VOICES = ["), schemaEnd);
  if (src.indexOf("const VOICES = [") < 0 || schemaEnd < 4) throw new Error('server.js changed shape: cannot find DM_SCHEMA. Update scripts/dm-schema.mjs.');
  const make = new Function('SKILLS', 'CATEGORIES', 'STATUSES', 'EFFECT_KINDS', 'getEntry', 'monsterImage', 'adventureMonsterFor',
    `${expanders}\n${schemaSrc}\nreturn { expandSheetEdits, expandTokenUpdates, gearToPartyUpdates, DM_SCHEMA, VOICES };`);
  return make(SKILLS, CATEGORIES, STATUSES, EFFECT_KINDS, getEntry, monsterImage, adventureMonsterFor);
}

// Checks a value against the subset of JSON schema DM_SCHEMA uses (type, enum, properties, required, additionalProperties, items, anyOf). Returns a list of problems.
export function validateSchema(value, schema, at = '$') {
  const bad = (m) => [`${at}: ${m}`];
  if (schema.anyOf) {
    const tries = schema.anyOf.map((s) => validateSchema(value, s, at));
    return tries.some((t) => t.length === 0) ? [] : bad('matches none of the allowed shapes (closest: ' + tries.sort((a, b) => a.length - b.length)[0].join('; ') + ')');
  }
  if (schema.enum && !schema.enum.includes(value)) return bad(`${JSON.stringify(value)} is not one of ${schema.enum.join('|')}`);
  const t = schema.type;
  if (t === 'string') return typeof value === 'string' ? [] : bad('not a string');
  if (t === 'integer') return Number.isInteger(value) ? [] : bad('not an integer');
  if (t === 'boolean') return typeof value === 'boolean' ? [] : bad('not a boolean');
  if (t === 'array') {
    if (!Array.isArray(value)) return bad('not an array');
    return value.flatMap((v, i) => validateSchema(v, schema.items || {}, `${at}[${i}]`));
  }
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('not an object');
    const out = [];
    for (const k of schema.required || []) if (!(k in value)) out.push(`${at}.${k}: missing`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) out.push(...validateSchema(v, schema.properties[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${at}.${k}: not allowed`);
    }
    return out;
  }
  return [];
}
