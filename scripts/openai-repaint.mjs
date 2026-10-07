// Repaints a picture with OpenAI's image model while asking it to keep every shape where it is (image edit with high input fidelity), so a map whose walls, doors and lights were
// drawn exactly keeps them valid under the richer painting. The result must be checked: overlay the walls on it with scripts/pixel-grid.mjs. Costs money (about $0.05-0.20).
// Usage: node scripts/openai-repaint.mjs --in <picture.png> --prompt-file <file> --out <result.png> [--size 1536x1024] [--quality medium] [--fidelity high|low]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const input = opt('in'), promptFile = opt('prompt-file'), out = opt('out');
if (!input || !promptFile || !out) { console.error('usage: node scripts/openai-repaint.mjs --in <picture.png> --prompt-file <file> --out <result.png> [--size 1536x1024] [--quality medium]'); process.exit(1); }
const env = await readFile(path.join(root, '.env'), 'utf8').catch(() => '');
const key = process.env.OPENAI_API_KEY || (/^OPENAI_API_KEY=(.+)$/m.exec(env) || [])[1]?.trim();
if (!key) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }
const size = opt('size', '1536x1024'), quality = opt('quality', 'medium');
const form = new FormData();
form.append('model', 'gpt-image-1');
form.append('prompt', (await readFile(path.resolve(promptFile), 'utf8')).trim());
form.append('size', size);
form.append('quality', quality);
form.append('input_fidelity', opt('fidelity', 'high'));
form.append('image', new Blob([await readFile(path.resolve(input))], { type: 'image/png' }), path.basename(input));
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form });
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error('OpenAI error', res.status, data.error?.message || ''); process.exit(1); }
const b64 = data.data?.[0]?.b64_json;
if (!b64) { console.error('No picture came back'); process.exit(1); }
await writeFile(path.resolve(out), Buffer.from(b64, 'base64'));
console.log(`gpt-image-1 edit ${size} ${quality}: saved ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s, about $${({ low: 0.03, medium: 0.07, high: 0.25 }[quality] ?? 0.07).toFixed(2)} at list prices`);
