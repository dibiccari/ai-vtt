// The image model and default quality chosen on the Settings page (IMAGE_MODEL, IMAGE_QUALITY in .env), for the scripts that paint maps (scripts/generate-image.mjs, scripts/openai-repaint.mjs).
// The OpenAI key is the same one the voices use.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1-mini'];
export const IMAGE_QUALITIES = ['low', 'medium', 'high'];
export function imageSettings(root) {
  let env = '';
  try { env = readFileSync(path.join(root, '.env'), 'utf8'); } catch { /* no .env */ }
  const get = (name) => (process.env[name] || (new RegExp(`^${name}=(.+)$`, 'm').exec(env) || [])[1] || '').trim();
  const model = get('IMAGE_MODEL') || 'gpt-image-1';
  const q = get('IMAGE_QUALITY');
  return { model, quality: IMAGE_QUALITIES.includes(q) ? q : 'medium', key: get('OPENAI_API_KEY') };
}
