// The server's live settings (API keys, models, voice and picture choices). They come from the environment (.env) and are read again, without a restart, when Settings saves.
// One object, `settings`, is shared by everything that needs them, so nothing keeps its own copy: read `settings.MODEL` when you need it, never keep the value.
import Anthropic from '@anthropic-ai/sdk';
import { IMAGE_PROVIDERS, IMAGE_QUALITIES } from './image-settings.js';

export const EFFORTS = ['low', 'medium', 'high'];
export const settings = {};

export function applySettings(env = process.env) {
  settings.MODEL = env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  settings.TTS_MODEL = env.TTS_MODEL || 'gpt-4o-mini-tts';                       // the Dungeon Master's own voice (the narrator)
  settings.NPC_TTS_MODEL = env.NPC_TTS_MODEL || 'gpt-4o-mini-tts-2025-03-20';    // the NPC voices: their own model, so the two can differ
  settings.IMAGE_MODEL = env.IMAGE_MODEL || 'gpt-image-1';
  settings.IMAGE_KEY = env.OPENAI_IMAGE_API_KEY || '';                           // optional own key for the pictures; blank means the voices key is used
  settings.GEMINI_KEY = env.GEMINI_API_KEY || '';
  settings.FAL_KEY = env.FAL_API_KEY || '';
  settings.IMAGE_PROVIDER = IMAGE_PROVIDERS.includes(env.IMAGE_PROVIDER) ? env.IMAGE_PROVIDER : 'openai';
  settings.IMAGE_QUALITY = IMAGE_QUALITIES.includes(env.IMAGE_QUALITY) ? env.IMAGE_QUALITY : 'medium';
  settings.OPENAI_KEY = env.OPENAI_API_KEY || '';
  settings.DM_NONE = env.DM_PROVIDER === 'none';                                 // Settings > Dungeon Master: None (a person runs the game)
  settings.VOICE_PROVIDER = ['none', 'browser'].includes(env.VOICE_PROVIDER) ? env.VOICE_PROVIDER : 'openai';
  settings.NPC_PROVIDER = ['none', 'browser', 'openai'].includes(env.NPC_VOICE_PROVIDER) ? env.NPC_VOICE_PROVIDER : 'same';    // 'same' = the Dungeon Master voice's provider (an old setup that never chose)
  settings.DM_VOICE = env.DM_VOICE || '';                                        // the ChatGPT voice the narrator speaks with ('' or 'auto': the default narrator voice)
  settings.DM_EFFORT = EFFORTS.includes(env.DM_EFFORT) ? env.DM_EFFORT : 'low';  // how hard the DM thinks before it answers: low is much faster
  settings.DM_SPEED = env.DM_SPEED === 'standard' ? 'standard' : 'fast';         // fast unless Settings says otherwise (it only applies to the models that have it)
  const key = env.ANTHROPIC_API_KEY || '';
  settings.anthropic = key && !settings.DM_NONE ? new Anthropic({ apiKey: key }) : null;
  settings.anthropicAny = key ? new Anthropic({ apiKey: key }) : null;                       // the Map Maker needs the AI even when a person runs the game
  settings.MAP_DESIGNER_MODEL = env.MAP_DESIGNER_MODEL || 'claude-sonnet-5-5';              // writes the layout grid of a battle map from a description
  settings.MAP_IDEA_MODEL = env.MAP_IDEA_MODEL || 'claude-haiku-5-5';                        // 'Surprise me': a map idea, a fraction of a cent
  return settings;
}
applySettings();

// Which service paints each kind of map (Settings > Map generators): the kind's own choice, else the one global choice the scripts always used. 'none' means nobody is assigned.
export function mapGen(kind, env = process.env) {
  const K = String(kind || '').toUpperCase(), own = (n) => (['REGIONAL', 'TOWN', 'BATTLE'].includes(K) ? env[`${n}_${K}`] || '' : '');
  const prov = own('IMAGE_PROVIDER');
  return { provider: prov === 'none' ? 'none' : IMAGE_PROVIDERS.includes(prov) ? prov : settings.IMAGE_PROVIDER, model: own('IMAGE_MODEL') || settings.IMAGE_MODEL, quality: IMAGE_QUALITIES.includes(own('IMAGE_QUALITY')) ? own('IMAGE_QUALITY') : settings.IMAGE_QUALITY };
}
