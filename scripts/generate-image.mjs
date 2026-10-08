// Makes one picture with OpenAI's image model from a prompt file and saves it as a PNG. The key is read from .env (never printed). One image costs money: roughly $0.02 (low),
// $0.05 (medium) or $0.20 (high) for 1536x1024 with gpt-image-1; the run prints an estimate.
// Usage: node scripts/generate-image.mjs --prompt-file <file> --out <file.png> [--size 1536x1024] [--quality low|medium|high] [--model gpt-image-1]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const promptFile = opt('prompt-file'), out = opt('out');
if (!promptFile || !out) { console.error('usage: node scripts/generate-image.mjs --prompt-file <file> --out <file.png> [--size 1536x1024] [--quality medium]'); process.exit(1); }
const env = await readFile(path.join(root, '.env'), 'utf8').catch(() => '');
const key = process.env.OPENAI_API_KEY || (/^OPENAI_API_KEY=(.+)$/m.exec(env) || [])[1]?.trim();
if (!key) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }
const { imageSettings } = await import(path.join(root, 'lib', 'image-settings.js'));
const chosen = imageSettings(root);
const model = opt('model', chosen.model), size = opt('size', '1536x1024'), quality = opt('quality', chosen.quality);       // the Settings page card picks the defaults
const prompt = (await readFile(path.resolve(promptFile), 'utf8')).trim();
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model, prompt, size, quality, n: 1 })
});
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error('OpenAI error', res.status, data.error?.message || JSON.stringify(data).slice(0, 300)); process.exit(1); }
const item = data.data?.[0];
const bytes = item?.b64_json ? Buffer.from(item.b64_json, 'base64') : item?.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
if (!bytes) { console.error('No picture came back'); process.exit(1); }
await writeFile(path.resolve(out), bytes);
const est = model === 'gpt-image-1' ? { low: 0.02, medium: 0.05, high: 0.2 }[quality] : null;
console.log(`${model} ${size} ${quality}: saved ${out} (${(bytes.length / 1e6).toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)} s${est ? `, about ${est.toFixed(2)} at list prices` : ' (see the OpenAI price list for this model)'}`);
