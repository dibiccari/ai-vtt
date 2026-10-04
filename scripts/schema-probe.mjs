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

try {
  await new Anthropic().beta.messages.create({ model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', max_tokens: 20, messages: [{ role: 'user', content: 'Say hi.' }], output_config: { effort: 'low', format: { type: 'json_schema', schema } } });
  console.log(`OK   the DM reply schema is accepted (${variants} update variants)`);
} catch (err) {
  console.error(`FAIL the DM reply schema was refused (${variants} update variants): ${String(err.message).slice(0, 200)}`);
  process.exit(1);
}
