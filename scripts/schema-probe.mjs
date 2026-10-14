// Checks that the DM's reply schema (DM_SCHEMA in server.js) is still accepted by the API. The API refuses schemas whose compiled
// grammar is too large, and this schema is close to that limit: after adding an update type, run this (one tiny API call).
//   node scripts/schema-probe.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { SKILLS } from '../lib/sheet-edit.js';
import { CATEGORIES, STATUSES } from '../lib/journal.js';
import { EFFECT_KINDS } from '../lib/party.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const a = src.indexOf('const upd = (types, properties)');
const b = src.indexOf('DM_SCHEMA.properties.voiceLines = {');
const end = src.indexOf('\n};\n', b) + 4;
const VOICES = ['narrator', 'gruff', 'sly', 'noble', 'elderly', 'child', 'monstrous', 'ethereal', 'feminine', 'masculine'];
const schema = new Function('SKILLS', 'CATEGORIES', 'STATUSES', 'EFFECT_KINDS', 'VOICES', src.slice(a, end) + '\nreturn DM_SCHEMA;')(SKILLS, CATEGORIES, STATUSES, EFFECT_KINDS, VOICES);
const variants = schema.properties.mapUpdates.items.anyOf.length;
const { schemaForMode } = await import('../lib/dm-schema-modes.js');

// The DM gets a fight form or a scene form (lib/dm-schema-modes.js); the full form is only a source, but it is probed too so we know how much room is left.
let failed = false;
for (const [label, sch] of [['scene form', schemaForMode(schema, 'scene')], ['fight form', schemaForMode(schema, 'combat')], ['full schema (not sent)', schema]]) {
  try {
    await new Anthropic().beta.messages.create({ model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', max_tokens: 20, messages: [{ role: 'user', content: 'Say hi.' }], output_config: { effort: 'low', format: { type: 'json_schema', schema: sch } } });
    console.log(`OK   ${label} accepted (${sch.properties.mapUpdates.items.anyOf.length} update variants)`);
  } catch (err) {
    console.error(`FAIL ${label} refused: ${String(err.message).slice(0, 200)}`);
    if (label !== 'full schema (not sent)') failed = true;
  }
}
if (failed) process.exit(1);
