// FLUX Kontext on fal.ai paints the Phandalin town from the same text description that was used for our ChatGPT version (public/scenarios/compare/town/phandalin-prompt.txt). No input picture is sent.
// Writes town-kontext.png and town-results.json in public/scenarios/compare/image-test/ for public/image-test.html. Usage: node scripts/image-test-town.mjs
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFromText } from '../lib/image-providers.js';
import { imageSettings } from '../lib/image-settings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const prompt = readFileSync(path.join(root, 'public', 'scenarios', 'compare', 'town', 'phandalin-prompt.txt'), 'utf8').trim();
copyFileSync(path.join(root, 'public', 'scenarios', 'compare', 'town', 'phandalin-prompt.txt'), path.join(dir, 'town-prompt.txt'));
const model = 'fal-ai/flux-pro/kontext/text-to-image';
const t0 = Date.now();
const result = { model, provider: 'fal', at: new Date().toISOString() };
try {
  const { png, note } = await generateFromText({ provider: 'fal', model, key: imageSettings(root).keys.fal, prompt, seed: 7 });
  writeFileSync(path.join(dir, 'town-kontext.png'), png);
  Object.assign(result, { ok: true, seconds: Math.round((Date.now() - t0) / 1000), bytes: png.length, note, file: 'town-kontext.png' });
} catch (err) { Object.assign(result, { ok: false, error: err.short || err.message }); }
writeFileSync(path.join(dir, 'town-results.json'), JSON.stringify(result, null, 2));
console.log(result.ok ? `saved town-kontext.png in ${result.seconds} s ${result.note}` : 'FAILED ' + result.error);
