// Image bake-off: the same wall layout (public/scenarios/compare/image-test/layout.png, an inn drawn as thick stone bands) and the same prompt go to several image services, and each result is measured
// against the saved walls (lib/wall-drift.js). A contender runs only when its key is saved in Settings > Image Generator. The OpenAI pictures from the Image Test page are reused (no new charge).
// Results go to bakeoff-results.json beside the pictures and are shown on public/image-bakeoff.html.
// Usage: node scripts/image-bakeoff.mjs [--only gemini,fal] [--force]
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editFromLayout } from '../lib/image-providers.js';
import { imageSettings } from '../lib/image-settings.js';
import { wallDrift } from '../lib/wall-drift.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const args = process.argv.slice(2);
const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').filter(Boolean);
const layout = JSON.parse(readFileSync(path.join(dir, 'layout.json'), 'utf8'));
const imagePng = readFileSync(path.join(dir, 'layout.png'));
const prompt = readFileSync(path.join(dir, 'layout-prompt.txt'), 'utf8').trim();
const keys = imageSettings(root).keys;
const resultsFile = path.join(dir, 'bakeoff-results.json');
const previous = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : { runs: [] };

// The contenders. price is the list price per picture where known (estimate, check the provider's page).
const CONTENDERS = [
  { id: 'openai-medium', provider: 'openai', label: 'OpenAI gpt-image-1, medium', model: 'gpt-image-1', quality: 'medium', price: '$0.07', reuse: 'locked-medium.png' },
  { id: 'openai-high', provider: 'openai', label: 'OpenAI gpt-image-1, high', model: 'gpt-image-1', quality: 'high', price: '$0.25', reuse: 'locked-high.png' },
  { id: 'gemini-nano-banana', provider: 'gemini', label: 'Google gemini-nano-banana-2.1, 1K', model: 'gemini-nano-banana-2.1', quality: '1K', price: '$0.03' },
  { id: 'gemini-3-pro', provider: 'gemini', label: 'Google gemini-3-pro-image, 1K', model: 'gemini-3-pro-image', quality: '1K', price: '$0.13' },
  { id: 'fal-canny', provider: 'fal', label: 'FLUX Control LoRA (canny) on fal.ai', model: 'fal-ai/flux-control-lora-canny', quality: 'standard', price: 'a few cents' },
  { id: 'fal-kontext', provider: 'fal', label: 'FLUX Kontext on fal.ai', model: 'fal-ai/flux-pro/kontext', quality: 'standard', price: 'a few cents' }
];
const runs = [];
for (const c of CONTENDERS) {
  const base = { id: c.id, provider: c.provider, label: c.label, model: c.model, quality: c.quality, price: c.price, file: c.id + '.png' };
  const old = previous.runs.find((r) => r.id === c.id);
  if (only.length && !only.includes(c.provider) && !only.includes(c.id)) { if (old) runs.push(old); continue; }
  if (c.reuse) {
    copyFileSync(path.join(dir, c.reuse), path.join(dir, base.file));
    runs.push({ ...base, ok: true, reused: true, drift: await wallDrift(path.join(dir, base.file), layout) });
    console.log(c.id, 'reused', JSON.stringify(runs[runs.length - 1].drift));
    continue;
  }
  if (!keys[c.provider]) { runs.push({ ...base, ok: false, noKey: true, error: 'No key saved yet. Add one in Settings > Image Generator.' }); console.log(c.id, 'skipped: no key'); continue; }
  const t0 = Date.now();
  try {
    const { png, note } = await editFromLayout({ provider: c.provider, model: c.model, quality: c.quality, key: keys[c.provider], prompt, imagePng, width: 1536, height: 1024, seed: 7 });
    if (png[0] === 0xff && png[1] === 0xd8) base.file = c.id + '.jpg';             // some services send a JPEG: keep the right extension
    writeFileSync(path.join(dir, base.file), png);
    const drift = await wallDrift(path.join(dir, base.file), layout);
    runs.push({ ...base, ok: true, seconds: Math.round((Date.now() - t0) / 1000), bytes: png.length, note, drift });
    console.log(c.id, 'ok', JSON.stringify(drift));
  } catch (err) {
    runs.push({ ...base, ok: false, seconds: Math.round((Date.now() - t0) / 1000), error: err.short || err.message });
    console.log(c.id, 'FAILED', err.short || err.message);
  }
}
writeFileSync(resultsFile, JSON.stringify({ at: new Date().toISOString(), layout: 'layout.png', runs }, null, 2));
