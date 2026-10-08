// FLUX Kontext on fal.ai paints a map from a text description only (no input picture): the Phandalin town ('town') or the Sword Coast-style regional map ('region'). The text is the same one used for our
// ChatGPT version. Writes <name>-kontext.png, <name>-prompt.txt and <name>-results.json in public/scenarios/compare/image-test/ for public/image-test.html. Usage: node scripts/image-test-town.mjs [town|region]
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFromText } from '../lib/image-providers.js';
import { imageSettings } from '../lib/image-settings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const KINDS = {
  town: { name: 'town', source: 'town/phandalin-player-full-prompt.txt', aspect: '3:2' },
  region: { name: 'region', source: 'coast/coast-atlas-prompt.txt', aspect: '2:3' }
};
const kind = KINDS[process.argv[2] || 'town'];
if (!kind) { console.error('usage: node scripts/image-test-town.mjs [town|region]'); process.exit(1); }
const src = path.join(root, 'public', 'scenarios', 'compare', kind.source);
const prompt = readFileSync(src, 'utf8').trim();
copyFileSync(src, path.join(dir, `${kind.name}-prompt.txt`));
const model = 'fal-ai/flux-pro/kontext/text-to-image';
const t0 = Date.now();
const result = { model, provider: 'fal', aspect: kind.aspect, at: new Date().toISOString() };
try {
  const { png, note } = await generateFromText({ provider: 'fal', model, key: imageSettings(root).keys.fal, prompt, aspect: kind.aspect, seed: 7 });
  writeFileSync(path.join(dir, `${kind.name}-kontext.png`), png);
  Object.assign(result, { ok: true, seconds: Math.round((Date.now() - t0) / 1000), bytes: png.length, note, file: `${kind.name}-kontext.png` });
} catch (err) { Object.assign(result, { ok: false, error: err.short || err.message }); }
writeFileSync(path.join(dir, `${kind.name}-results.json`), JSON.stringify(result, null, 2));
console.log(result.ok ? `saved ${kind.name}-kontext.png in ${result.seconds} s ${result.note}` : 'FAILED ' + result.error);
