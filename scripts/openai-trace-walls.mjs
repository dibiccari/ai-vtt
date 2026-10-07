// Asks an OpenAI vision model to read a battle map picture and return its walls, doors and lights as JSON in image pixels, then writes the map set-up (data/maps/<picture>.json).
// This is the "ChatGPT alone" half of the crypt comparison: no human or Claude touches the numbers. Costs a few cents. The key is read from .env and never printed.
// Usage: node scripts/openai-trace-walls.mjs <picture path> <out config json> [--model gpt-4.1] [--squares 30]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [pic, outFile] = pos;
if (!pic || !outFile) { console.error('usage: node scripts/openai-trace-walls.mjs <picture> <out.json> [--model gpt-4.1] [--squares 30]'); process.exit(1); }
const env = await readFile(path.join(root, '.env'), 'utf8').catch(() => '');
const key = process.env.OPENAI_API_KEY || (/^OPENAI_API_KEY=(.+)$/m.exec(env) || [])[1]?.trim();
if (!key) { console.error('No OPENAI_API_KEY in .env'); process.exit(1); }
const model = opt('model', 'gpt-4.1'), squares = Number(opt('squares', 30));
const bytes = await readFile(path.resolve(pic));
const W = bytes.readUInt32BE(16), H = bytes.readUInt32BE(20);      // PNG header
const prompt = `This is a top-down battle map picture, ${W} x ${H} pixels, origin at the top-left, x to the right, y down. Read it for a virtual tabletop that needs line of sight.
Return ONLY JSON: {"walls":[{"x1":n,"y1":n,"x2":n,"y2":n}],"doors":[{"x1":n,"y1":n,"x2":n,"y2":n}],"lights":[{"x":n,"y":n,"range":n}]}.
- walls: straight line segments, in image pixels, along the INNER edge of every stone wall where the walkable floor meets the wall, around every room and corridor, and around solid objects that block sight (pillars, tombs, crates, large barrels). Closed rooms must have closed outlines with no gaps except at doors and open doorways.
- doors: one segment across each doorway or door (the opening itself), so that it can be shown as closed or open. Leave the door opening out of the walls list.
- lights: torches, braziers, candles and other light sources, x and y in pixels, range = how far the light reaches in grid squares (a square is ${(W / squares).toFixed(1)} pixels).
Be as accurate as you can: positions will be checked against the picture.`;
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify({ model, response_format: { type: 'json_object' }, max_tokens: 6000, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64'), detail: 'high' } }] }] })
});
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error('OpenAI error', res.status, data.error?.message || ''); process.exit(1); }
let j; try { j = JSON.parse(data.choices[0].message.content); } catch { console.error('The reply was not JSON'); process.exit(1); }
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const walls = [];
for (const [list, type] of [[j.walls, 'wall'], [j.doors, 'door']]) for (const w of Array.isArray(list) ? list : []) { const v = [num(w.x1), num(w.y1), num(w.x2), num(w.y2)]; if (!v.includes(null)) walls.push({ x1: v[0], y1: v[1], x2: v[2], y2: v[3], type, open: false }); }
const lights = (Array.isArray(j.lights) ? j.lights : []).map((l, i) => ({ x: num(l.x), y: num(l.y), range: Math.min(12, Math.max(2, Number(l.range) || 6)), intensity: 1, color: 'ffffa24d', name: 'light-' + (i + 1), flicker: true })).filter((l) => l.x !== null && l.y !== null);
const config = { squares, light: 'dark', ambience: 'dungeon', mood: 'dungeon', source: 'dd2vtt', walls, starts: [], lights, ambient: 'ff2a2630' };
await writeFile(path.resolve(outFile), JSON.stringify(config, null, 2));
const u = data.usage || {};
console.log(`${model}: ${walls.filter((w) => w.type === 'wall').length} walls, ${walls.filter((w) => w.type === 'door').length} doors, ${lights.length} lights in ${((Date.now() - t0) / 1000).toFixed(0)} s (${u.prompt_tokens || '?'} in, ${u.completion_tokens || '?'} out tokens, a few cents)`);
