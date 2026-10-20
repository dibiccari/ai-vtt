// settings: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { modelChoices, capsOf } from '../lib/model-caps.js';
import { readFile, writeFile } from 'node:fs/promises';
import { localOnly } from '../lib/local-only.js';
import { settings, mapGen, applySettings } from '../lib/runtime-settings.js';
import Anthropic from '@anthropic-ai/sdk';

export function registerSettings(app, deps) {
  const ENV_FILE = path.join(deps.__dirname, '.env');
  const SETTINGS = {
    ANTHROPIC_API_KEY: { secret: true },
    OPENAI_API_KEY: { secret: true },
    ANTHROPIC_MODEL: { secret: false },
    TTS_MODEL: { secret: false },
    NPC_TTS_MODEL: { secret: false },
    OPENAI_IMAGE_API_KEY: { secret: true },
    GEMINI_API_KEY: { secret: true },
    FAL_API_KEY: { secret: true },
    IMAGE_PROVIDER: { secret: false },
    VOICE_PROVIDER: { secret: false },
    NPC_VOICE_PROVIDER: { secret: false },
    DM_VOICE: { secret: false },
    DM_EFFORT: { secret: false },
    DM_SPEED: { secret: false },
    IMAGE_MODEL: { secret: false },
    IMAGE_QUALITY: { secret: false },
    DM_PROVIDER: { secret: false },
    IMAGE_PROVIDER_REGIONAL: { secret: false }, IMAGE_MODEL_REGIONAL: { secret: false }, IMAGE_QUALITY_REGIONAL: { secret: false },
    IMAGE_PROVIDER_TOWN: { secret: false }, IMAGE_MODEL_TOWN: { secret: false }, IMAGE_QUALITY_TOWN: { secret: false },
    IMAGE_PROVIDER_BATTLE: { secret: false }, IMAGE_MODEL_BATTLE: { secret: false }, IMAGE_QUALITY_BATTLE: { secret: false }
  };

  const hint = (key) => (key ? `ends in ${key.slice(-4)}` : '');

  let envWrites = Promise.resolve();       // saves that arrive together are written one after another, each reading what the one before wrote
  const updateEnvFile = (updates) => (envWrites = envWrites.catch(() => {}).then(() => writeEnvFile(updates)));
  async function writeEnvFile(updates) {
    let text = '';
    try { text = await readFile(ENV_FILE, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const lines = text.length ? text.split(/\r?\n/) : [];
    for (const [name, value] of Object.entries(updates)) {
      const re = new RegExp(`^\\s*${name}\\s*=`);
      const idx = lines.findIndex((l) => re.test(l));
      const line = `${name}=${value}`;
      if (idx >= 0) lines[idx] = line;
      else lines.push(line);
    }
    await writeFile(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n`);
  }

  app.get('/api/settings', localOnly, (_req, res) => {
    res.json({
      anthropic: { set: Boolean(process.env.ANTHROPIC_API_KEY), hint: hint(process.env.ANTHROPIC_API_KEY), model: settings.MODEL },
      dm: { provider: settings.DM_NONE ? 'none' : 'claude', model: settings.MODEL, models: modelChoices(), caps: capsOf(settings.MODEL), effort: settings.DM_EFFORT, speed: settings.DM_SPEED },
      voice: { openaiVoices: [...deps.KNOWN_OPENAI_VOICES], dmVoice: deps.chosenVoice(settings.DM_VOICE) || deps.TTS_PROFILES.narrator.voices[0], provider: settings.VOICE_PROVIDER, effective: deps.voiceProviderNow(), npc: settings.NPC_PROVIDER === 'same' ? settings.VOICE_PROVIDER : settings.NPC_PROVIDER, npcEffective: deps.npcProviderNow(), npcModel: settings.NPC_TTS_MODEL, model: settings.TTS_MODEL },
      maps: { regional: mapGen('regional'), town: mapGen('town'), battle: mapGen('battle') },
      openai: { set: Boolean(settings.OPENAI_KEY), hint: hint(settings.OPENAI_KEY), ttsModel: settings.TTS_MODEL, voiceProvider: 'openai', imageProvider: settings.IMAGE_PROVIDER, imageModel: settings.IMAGE_MODEL, imageQuality: settings.IMAGE_QUALITY, imageKey: { own: Boolean(settings.IMAGE_KEY), hint: hint(settings.IMAGE_KEY), usable: Boolean(settings.IMAGE_KEY || settings.OPENAI_KEY) },
        imageKeys: { openai: { set: Boolean(settings.IMAGE_KEY || settings.OPENAI_KEY), own: Boolean(settings.IMAGE_KEY), hint: hint(settings.IMAGE_KEY || settings.OPENAI_KEY) }, gemini: { set: Boolean(settings.GEMINI_KEY), hint: hint(settings.GEMINI_KEY) }, fal: { set: Boolean(settings.FAL_KEY), hint: hint(settings.FAL_KEY) } } }
    });
  });

  // What the AI calls have used and roughly cost (an estimate at list prices; the Anthropic Console has the real bill).
  app.get('/api/usage', localOnly, deps.asyncRoute(async (_req, res) => { res.json(await deps.usageTracker.summary()); }));
  app.post('/api/usage/reset', localOnly, deps.asyncRoute(async (_req, res) => { await deps.usageTracker.reset(); res.json(await deps.usageTracker.summary()); }));

  app.post('/api/settings', localOnly, deps.asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    const clear = new Set(Array.isArray(body.clear) ? body.clear : []);
    const updates = {};
    for (const [name, cfg] of Object.entries(SETTINGS)) {
      if (clear.has(name)) { updates[name] = ''; continue; }
      if (typeof body[name] !== 'string') continue;
      const value = body[name].trim();
      if (!value) continue; // blank means "leave unchanged"
      const valid = cfg.secret ? /^[^\s"'`\\]{8,400}$/.test(value) : /^[\w./:-]{1,80}$/.test(value);
    if (!valid) return res.status(400).json({ error: `${name} has an invalid format (no spaces or quotes allowed).` });
      updates[name] = value;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to save.' });
    await updateEnvFile(updates);
    for (const [name, value] of Object.entries(updates)) {
      if (value) process.env[name] = value; else delete process.env[name];
    }
    applySettings();
    res.json({ ok: true, saved: Object.keys(updates) });
  }));

  app.post('/api/settings/test', localOnly, deps.asyncRoute(async (req, res) => {
    const which = req.body?.which;
    try {
      if (which === 'anthropic') {
        if (!settings.anthropic) return res.json({ ok: false, error: 'No Anthropic key saved yet.' });
        await settings.anthropic.models.list({ limit: 1 });
      return res.json({ ok: true, message: `Anthropic key accepted (model: ${settings.MODEL}).` });
      }
      if (which === 'openai') {
        if (!settings.OPENAI_KEY) return res.json({ ok: false, error: 'No OpenAI key saved yet.' });
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${settings.OPENAI_KEY}` } });
        if (!r.ok) return res.json({ ok: false, error: r.status === 401 ? 'OpenAI rejected the key (401).' : `OpenAI returned ${r.status}.` });
        return res.json({ ok: true, message: 'OpenAI key accepted. Use "Hear a sample" to confirm your credit balance works.' });
      }
      const gen = mapGen(req.body?.kind);
      if (which === 'images' && gen.provider === 'none') return res.json({ ok: false, error: 'No generator is assigned to this kind of map (None).' });
      if (which === 'images' && gen.provider === 'gemini') {
        if (!settings.GEMINI_KEY) return res.json({ ok: false, error: 'No Google Gemini key saved yet.' });
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(gen.model)}`, { headers: { 'x-goog-api-key': settings.GEMINI_KEY } });
      if (r.status === 404) return res.json({ ok: false, error: `Google does not list a model called ${gen.model} for this key.` });
        if (!r.ok) return res.json({ ok: false, error: r.status === 400 || r.status === 403 ? 'Google rejected the key.' : `Google returned ${r.status}.` });
      return res.json({ ok: true, message: `${gen.model} is available to this Gemini key. Pictures are only charged when one is made.` });
      }
      if (which === 'images' && gen.provider === 'fal') {
        if (!settings.FAL_KEY) return res.json({ ok: false, error: 'No fal.ai key saved yet.' });
        return res.json({ ok: true, message: 'A fal.ai key is saved. fal.ai has no free way to check a key, so the bake-off (Tools > Image Bake-off) is the real test.' });
      }
      if (which === 'images') {
        const imageKey = settings.IMAGE_KEY || settings.OPENAI_KEY;
        if (!imageKey) return res.json({ ok: false, error: 'No OpenAI key saved yet (the images use the same key as the voices unless you give them their own).' });
      const r = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(gen.model)}`, { headers: { Authorization: `Bearer ${imageKey}` } });
      if (r.status === 404) return res.json({ ok: false, error: `This key cannot use ${gen.model} (not found). Image models may need a verified OpenAI organization.` });
        if (!r.ok) return res.json({ ok: false, error: r.status === 401 ? 'OpenAI rejected the key (401).' : `OpenAI returned ${r.status}.` });
      return res.json({ ok: true, message: `${gen.model} is available to ${settings.IMAGE_KEY ? 'the image key' : 'the shared OpenAI key'}. Pictures are only charged when one is made, so the credit balance is not checked here.` });
      }
      res.status(400).json({ error: 'which must be "anthropic", "openai" or "images"' });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Anthropic.APIError ? `Anthropic error ${err.status}: ${err.message}` : err.message });
    }
  }));
}
