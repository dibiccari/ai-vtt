// One-time image quality test: paints the same prompt (public/scenarios/compare/image-test/prompt.txt) at low, medium and high with the image model chosen on the Settings page, and records the
// results for public/image-test.html. Costs about $0.27 with gpt-image-1 (0.02 + 0.05 + 0.20). Usage: node scripts/image-test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSettings } from '../lib/image-settings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const model = imageSettings(root).model;
const results = { model, size: '1536x1024', at: new Date().toISOString(), runs: [] };
for (const quality of ['low', 'medium', 'high']) {
  const out = path.join(dir, `${quality}.png`);
  const t0 = Date.now();
  let log = '', ok = true;
  try { log = execFileSync('node', [path.join(root, 'scripts', 'generate-image.mjs'), '--prompt-file', path.join(dir, 'prompt.txt'), '--out', out, '--size', '1536x1024', '--quality', quality], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { ok = false; log = String(err.stderr || err.message).trim(); }
  const run = { quality, ok, seconds: Math.round((Date.now() - t0) / 1000), log: log.trim().split('\n').pop() };
  if (ok) run.bytes = statSync(out).size;
  results.runs.push(run);
  console.log(quality, ok ? 'ok' : 'FAILED', run.log);
  writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  if (!ok) break;
}
