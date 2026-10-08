// Image generators behind one call: paint a picture from a layout drawing and a prompt, with OpenAI (images/edits), Google Gemini or fal.ai (FLUX). Used by scripts/image-bakeoff.mjs.
// editFromLayout({ provider, model, quality, key, prompt, imagePng, width, height, seed }) returns { png: Buffer, note }. Errors carry a short readable message.
// The Gemini and fal.ai request shapes follow their documentation pages as read in Nov 2026 and have not been run against a real key yet: the first run may need small corrections.

const fail = (msg) => Object.assign(new Error(msg), { short: msg });

async function openai({ model, quality, key, prompt, imagePng, width, height }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', `${width}x${height}`);
  form.append('quality', ['low', 'medium', 'high'].includes(quality) ? quality : 'medium');
  form.append('input_fidelity', 'high');
  form.append('image', new Blob([imagePng], { type: 'image/png' }), 'layout.png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`OpenAI ${res.status}: ${data.error?.message || ''}`.trim());
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw fail('OpenAI sent no picture');
  return { png: Buffer.from(b64, 'base64'), note: '' };
}

// Gemini: the Interactions endpoint, text and image in, an image out (the field holding the picture is searched for, since the response nesting is easy to get wrong).
function findImageData(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (typeof node === 'string') return node.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(node.slice(0, 200)) ? node : null;
  if (Array.isArray(node)) { for (const v of node) { const r = findImageData(v, depth + 1); if (r) return r; } return null; }
  if (typeof node === 'object') {
    for (const k of ['data', 'b64_json', 'image_bytes', 'bytesBase64Encoded']) if (typeof node[k] === 'string' && node[k].length > 2000) return node[k];
    for (const v of Object.values(node)) { const r = findImageData(v, depth + 1); if (r) return r; }
  }
  return null;
}
async function gemini({ model, quality, key, prompt, imagePng, width, height }) {
  const ratio = Math.abs(width / height - 1.5) < 0.05 ? '3:2' : Math.abs(width / height - 1) < 0.05 ? '1:1' : width > height ? '4:3' : '3:4';
  const body = { model, input: [{ type: 'text', text: prompt }, { type: 'image', mime_type: 'image/png', data: imagePng.toString('base64') }], response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: ratio, image_size: ['1K', '2K', '4K'].includes(quality) ? quality : '1K' } };
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`Gemini ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  const b64 = findImageData(data);
  if (!b64) throw fail('Gemini sent no picture: ' + JSON.stringify(data).slice(0, 200));
  return { png: Buffer.from(b64, 'base64'), note: '' };
}

// fal.ai: FLUX Control LoRA (canny) takes the drawing as a control image; FLUX Kontext edits the drawing as a picture. Images go in as data URIs and come back as a URL.
async function fal({ model, key, prompt, imagePng, width, height, seed }) {
  const uri = 'data:image/png;base64,' + imagePng.toString('base64');
  const body = model.includes('control-lora')
    ? { prompt, control_lora_image_url: uri, image_size: { width, height }, num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'png', enable_safety_checker: false, ...(seed != null ? { seed } : {}) }
    : { prompt, image_url: uri, output_format: 'png', safety_tolerance: '5', ...(seed != null ? { seed } : {}) };
  let res = await fetch(`https://fal.run/${model}`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401) res = await fetch(`https://fal.run/${model}`, { method: 'POST', headers: { Authorization: 'Key ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`fal.ai ${res.status}: ${JSON.stringify(data.detail || data.error || data).slice(0, 220)}`);
  const url = data.images?.[0]?.url;
  if (!url) throw fail('fal.ai sent no picture: ' + JSON.stringify(data).slice(0, 200));
  const png = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { png, note: data.seed != null ? 'seed ' + data.seed : '' };
}

export async function editFromLayout(opts) {
  const run = { openai, gemini, fal }[opts.provider];
  if (!run) throw fail('unknown provider ' + opts.provider);
  if (!opts.key) throw fail('no key saved for ' + opts.provider);
  return run(opts);
}
