// The image model and default quality chosen on the Settings page (IMAGE_MODEL, IMAGE_QUALITY in .env), for the scripts that paint maps (scripts/generate-image.mjs, scripts/openai-repaint.mjs).
// The OpenAI key is the same one the voices use.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const IMAGE_PROVIDERS = ['openai', 'gemini', 'fal'];
export const IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1-mini'];
export const IMAGE_QUALITIES = ['low', 'medium', 'high', '1K', '2K', '4K', 'standard'];
// kind ('regional', 'town' or 'battle'): the service, model and quality assigned to that kind of map on the Settings page; without one (or when none is assigned) the single global choice.
export function imageSettings(root, kind) {
  let env = '';
  try { env = readFileSync(path.join(root, '.env'), 'utf8'); } catch { /* no .env */ }
  const get = (name) => (process.env[name] || (new RegExp(`^${name}=(.+)$`, 'm').exec(env) || [])[1] || '').trim();
  const K = ['regional', 'town', 'battle'].includes(kind) ? '_' + kind.toUpperCase() : '';
  const own = (name) => (K ? get(name + K) : '');
  const ownProvider = own('IMAGE_PROVIDER');
  const provider = ownProvider === 'none' ? 'none' : IMAGE_PROVIDERS.includes(ownProvider) ? ownProvider : IMAGE_PROVIDERS.includes(get('IMAGE_PROVIDER')) ? get('IMAGE_PROVIDER') : 'openai';
  const model = own('IMAGE_MODEL') || get('IMAGE_MODEL') || 'gpt-image-1';
  const q = own('IMAGE_QUALITY') || get('IMAGE_QUALITY');
  const keys = { openai: get('OPENAI_IMAGE_API_KEY') || get('OPENAI_API_KEY'), gemini: get('GEMINI_API_KEY'), fal: get('FAL_API_KEY') };
  return { provider, model, quality: IMAGE_QUALITIES.includes(q) ? q : 'medium', key: keys.openai, keys };       // the pictures' own key when there is one, else the voices key
}
