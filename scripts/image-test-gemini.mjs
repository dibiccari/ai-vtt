// Gemini paints the Phandalin town and the regional map from the same text descriptions given to ChatGPT and FLUX (public/scenarios/compare/town/phandalin-player-full-prompt.txt and coast/coast-atlas-prompt.txt),
// text only. Writes <name>-gemini-<model>.jpg and <name>-gemini-results.json in public/scenarios/compare/image-test/. Usage: node scripts/image-test-gemini.mjs [town|region]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGeminiFromText } from '../lib/image-providers.js';
import { imageSettings } from '../lib/image-settings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const KINDS = { town: { src: 'town/phandalin-player-full-prompt.txt', aspect: '3:2' }, region: { src: 'coast/coast-atlas-prompt.txt', aspect: '2:3' } };
const kind = process.argv[2] || 'town';
if (!KINDS[kind]) { console.error('usage: node scripts/image-test-gemini.mjs [town|region]'); process.exit(1); }
const prompt = readFileSync(path.join(root, 'public', 'scenarios', 'compare', KINDS[kind].src), 'utf8').trim();
const key = imageSettings(root).keys.gemini;
const runs = [];
for (const [id, model, price] of [['nano-banana', 'gemini-nano-banana-2.1', '$0.03'], ['3-pro', 'gemini-3-pro-image', '$0.13']]) {
  const t0 = Date.now();
  const run = { id, model, price, kind };
  try {
    const { png } = await generateGeminiFromText({ model, key, prompt, aspect: KINDS[kind].aspect, size: '1K' });
    const file = `${kind}-gemini-${id}.${png[0] === 0x89 ? 'png' : 'jpg'}`;
    writeFileSync(path.join(dir, file), png);
    Object.assign(run, { ok: true, file, seconds: Math.round((Date.now() - t0) / 1000), bytes: png.length });
  } catch (err) { Object.assign(run, { ok: false, error: err.short || err.message }); }
  runs.push(run);
  console.log(kind, id, run.ok ? 'ok ' + run.file + ' ' + run.seconds + 's' : 'FAILED ' + run.error);
}
writeFileSync(path.join(dir, `${kind}-gemini-results.json`), JSON.stringify({ at: new Date().toISOString(), runs }, null, 2));
