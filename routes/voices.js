// cloud voices: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settings } from '../lib/runtime-settings.js';
import { findCreature, voiceFor, OPENAI_VOICES } from '../lib/creature-voices.js';
import { allEntries } from '../lib/compendium.js';
import { loadAdventureMonsters } from '../lib/adventure-monsters.js';
import { localOnly } from '../lib/local-only.js';
import { pronounce } from '../lib/pronounce.js';
import { createHash } from 'node:crypto';

export function registerVoices(app, deps) {
  // The newest models (the 5.5 family and Fable) always think before they answer and cannot be told not to; the others can, and the DM replies much sooner without it (replay, Nov 2026).
  const canSkipThinking = (model) => !/-5-5(?![0-9])|fable/i.test(String(model));
  // Fast mode (Anthropic, Opus 5.5 / 5 / 4.8): the same model writing about 2.5 times faster, at twice the price. It changes the speed of the writing, not the wait before it starts.
  const canGoFast = (model) => /^claude-opus-(5-5|5|4-8)$/.test(String(model));

  // Each DM voice tag maps to a few OpenAI voices plus an acting direction.
  const TTS_PROFILES = {
    narrator:  { voices: ['fable', 'sage'], style: 'A warm, expressive fantasy game-master narrator. Measured pace, rich storytelling, subtle drama. Slow down for tension and speed up for action.' },
    gruff:     { voices: ['onyx', 'ash'], style: 'A gruff, weathered old soldier. Gravelly, hoarse and rough, like he smokes and shouts a lot. Blunt and clipped, impatient, as if tired of fools.' },
    sly:       { voices: ['ash', 'echo'], style: 'A sly, scheming rogue. Silky and low, almost conspiratorial, as if sharing a secret. Smirking and amused, drawing out key words, with a sly purr and sudden quick, quiet asides.' },
    noble:     { voices: ['echo', 'fable'], style: 'A refined aristocrat with a polished upper-class British accent. Dignified, poised and commanding, with crisp, precise diction and a measured, unhurried pace. Courteous but faintly condescending, born to rule.' },
    elderly:   { voices: ['ash', 'onyx'], style: 'A very old man. Raspy, gravelly and hoarse, with a weak, shaky, breathy voice. Speak slowly, with pauses to catch his breath. Weary and gentle.' },
    child:     { voices: ['shimmer', 'coral'], style: 'Voice: a tiny child of six or seven. Extremely high-pitched, squeaky, light and breathy, with a sing-song childlike lilt. Pacing: quick and uneven, tumbling over words, sometimes giggling or gasping. Tone: wide-eyed, excited and innocent. Never sound like an adult doing a child impression.' },
    monstrous: { voices: ['onyx'], style: 'A snarling monster, not a person. Extremely deep, growling and guttural, with a wet rasp and snarls between words. Slow, heavy and menacing.' },
    ethereal:  { voices: ['shimmer', 'sage'], style: 'Ethereal and otherworldly. Airy, soft and haunting, with long pauses.' },
    feminine:  { voices: ['nova', 'coral', 'shimmer'], style: 'A woman in her thirties. High, light, soft and clearly feminine, warm and expressive, natural and conversational.' },
    beast:     { voices: ['onyx', 'echo'], style: 'A wild animal that has been given the power of speech. Low, rough and instinctive, short simple sentences, blunt and literal, with huffs, growls and sniffs between words and an animal\'s nervous or proud cadence. Not human: no polish, no long words.' },
    smallbeast: { voices: ['shimmer', 'coral'], style: 'A small animal given the power of speech: a bird, rat, cat or squirrel. Very high-pitched, tiny and quick, squeaky and breathy like a mouse, chirpy and nervous, with darting, excitable delivery and short bursts of words. Cute but wary, never a child, never polished.' },
    largebeast: { voices: ['onyx', 'ash'], style: 'A huge animal given the power of speech: a bear, horse, ox or great cat. Low-pitched and deep, slow and heavy, rumbling from the chest with a warm growl, simple blunt words, long pauses between them. Calm and powerful, the voice of something that could crush you but does not need to.' },
    undead:    { voices: ['ballad', 'onyx'], style: 'A voice from beyond the grave. Hollow, whispery and rasping, with a cold echoing quality and a dry rattle of breath. Very slow, with long unsettling pauses, flat and sorrowful, as if every word costs effort from far away.' },
    masculine: { voices: ['onyx', 'ash'], style: 'A big, burly man in his forties. Natural baritone, warm and chesty, with a confident edge. Strong, steady and commanding, unmistakably male.' }
  };

  // Named characters get their own voice and acting direction. Edit data/campaigns/<campaign>/voices.json to change them.
  const DEFAULT_CHARACTER_VOICES = {
    'Sildar Hallwinter': { voice: 'echo', style: 'A noble, honorable human knight. Steady and sincere, a little weary from hard travel, speaking with quiet resolve.' },
    'Gundren Rockseeker': { voice: 'ash', style: 'A gruff, excitable dwarf prospector with a rough burr. Proud and brusque, thrilled about treasure.' },
    'Toblen Stonehill': { voice: 'alloy', style: 'A warm, friendly innkeeper. Cheerful and hospitable, but worried about the town underneath the welcome.' },
    'Elmar Barthen': { voice: 'ash', style: 'An old, tidy shopkeeper in his seventies. Polite, patient and a little fussy, with a thin, creaky, aged voice that wavers slightly and slows down to think.' },
    'Sister Garaele': { voice: 'coral', style: 'A calm elven priestess and secret Harper. Soft, graceful and measured, with a hint of mystery.' },
    'Halia Thornton': { voice: 'nova', style: 'A brisk, ambitious businesswoman. Polished, calculating and cool, every sentence a negotiation.' },
    'Iarno Glasstaff': { voice: 'verse', style: 'A smug, arrogant wizard who thinks he is the cleverest person in the room. Silky, contemptuous and controlled.' },
    'Klarg': { voice: 'onyx', style: 'A brutish bugbear boss. Very deep and guttural, loud and bullying, speaking in broken short sentences.' },
    'Yeemik': { voice: 'alloy', style: 'A scheming goblin leader. Raspy, high and fast, nervous, sneaky and eager to make a deal.' },
    'Nezznar': { voice: 'echo', style: 'A cold, patient drow spellcaster known as the Black Spider. Quiet, silky and venomous, never raising his voice.' },
    'Agatha': { voice: 'ballad', style: 'A haunting banshee. Whispering, mournful and echoing, with long eerie pauses and sudden sharpness.' },
    'Reidoth': { voice: 'onyx', style: 'A very old, solitary druid. Slow, gravelly and weathered, a gentle rasp and a quaver of age, with the calm of someone who prefers trees to people.' }
  };
  const KNOWN_OPENAI_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);

  // Spoken forms of names the voices get wrong (data/campaigns/<id>/pronunciations.json, e.g. {"Raechyl": "Rachel"}); the written text is not changed.
  async function loadPronunciations() {
    try {
      const parsed = JSON.parse(await readFile(path.join(deps.CAMPAIGNS_DIR, await deps.getActiveCampaignId(), 'pronunciations.json'), 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }

  // The active campaign's named-character voices. The first campaign is seeded with the Phandelver cast.
  async function loadCharacterVoices(id = null) {
    const campaignId = id || await deps.getActiveCampaignId();
    const file = path.join(deps.CAMPAIGNS_DIR, campaignId, 'voices.json');
    const fallback = campaignId === deps.DEFAULT_CAMPAIGN_ID ? DEFAULT_CHARACTER_VOICES : campaignId === deps.TEST_CAMPAIGN_ID ? deps.TEST_CAMPAIGN_VOICES : {};
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (Object.keys(fallback).length) await writeFile(file, JSON.stringify(fallback, null, 2));
        return fallback;
    }
    console.warn(`Could not read ${file}: ${err.message}`);
      return fallback;
    }
  }

  // Match a spoken name ("Sildar") to a configured character ("Sildar Hallwinter").
  function characterVoiceFor(table, speaker) {
    const s = speaker.toLowerCase();
    if (s === 'narrator') return null;
    for (const [name, cfg] of Object.entries(table)) {
      const n = name.toLowerCase();
      if (n === s || (s.length >= 4 && (n.includes(s) || s.includes(n.split(' ')[0]) && n.split(' ')[0].length >= 4))) {
        return KNOWN_OPENAI_VOICES.has(cfg?.voice) ? cfg : null;
      }
    }
    return null;
  }

  // The ChatGPT voice picked in Settings > Dungeon Master voice replaces the narrator's default voice. Every other speaker (the NPCs) keeps the voice that fits them. The acting directions stay.
  const cleanSpeaker = (s) => { const name = String(s ?? 'Narrator').replace(/[^\w .'-]/g, '').slice(0, 60) || 'Narrator'; return name.toLowerCase() === 'narrator' ? 'Narrator' : name; };
  const chosenVoice = (name) => (KNOWN_OPENAI_VOICES.has(name) ? name : '');
  async function resolveVoice(tag, speaker) {
    const out = await resolveVoiceAuto(tag, speaker);
    const forced = speaker === 'Narrator' ? chosenVoice(settings.DM_VOICE) : '';
    return forced ? { ...out, voice: forced } : out;
  }
  async function resolveVoiceAuto(tag, speaker) {
    const profile = TTS_PROFILES[tag] || TTS_PROFILES.narrator;
    const table = await loadCharacterVoices();
    const named = characterVoiceFor(table, speaker);
    if (named) return { voice: named.voice, instructions: `You are voicing ${speaker}. ${named.style || profile.style}`, named: true };
    if (speaker === 'Narrator') return { voice: TTS_PROFILES.narrator.voices[0], instructions: TTS_PROFILES.narrator.style, named: true };
    // A creature of the SRD or of this adventure ("Goblin 2" is a goblin): the voice and acting notes for its kind, as edited in the Bestiary.
    const creature = findCreature(speaker, [await allEntries('monsters'), await campaignCreatures()]);
    if (creature) { const v = voiceFor(creature, await deps.creatureVoices.read()); return { voice: v.voice, instructions: `You are voicing ${speaker}. ${v.acting}`, named: true }; }
    // Unnamed characters: the same name always gets the same voice from the profile's list.
    const hash = [...speaker.toLowerCase()].reduce((n, ch) => n + ch.charCodeAt(0), 0);
    const voice = profile.voices[hash % profile.voices.length];
    return { voice, instructions: speaker === 'Narrator' ? profile.style : `You are voicing ${speaker}. ${profile.style}`, named: false };
  }

  const voiceProviderNow = () => (settings.DM_NONE ? 'none' : settings.VOICE_PROVIDER);        // the Dungeon Master's own voice (the narrator); a person running the game needs no voice at all
  const npcProviderNow = () => (settings.DM_NONE ? 'none' : settings.NPC_PROVIDER === 'same' ? settings.VOICE_PROVIDER : settings.NPC_PROVIDER);        // 'same' is only what an old setup has before NPC voices are chosen      // the characters the Dungeon Master plays (NPCs, monsters)
  app.get('/api/tts/status', deps.asyncRoute(async (_req, res) => {
    res.json({ pronunciations: await loadPronunciations(), enabled: Boolean(settings.OPENAI_KEY) && (voiceProviderNow() === 'openai' || npcProviderNow() === 'openai'), dm: voiceProviderNow(), npc: npcProviderNow(), model: settings.TTS_MODEL });
  }));

  // The active campaign's own creatures (not in the SRD).
  async function campaignCreatures() { return loadAdventureMonsters(path.join(deps.CAMPAIGNS_DIR, await deps.templateOfCampaign(await deps.getActiveCampaignId()))); }

  // The voice of every creature (the Bestiary shows and edits them): GET the lot, PUT one creature's voice or acting notes, DELETE to go back to the default.
  app.get('/api/creature-voices', deps.asyncRoute(async (_req, res) => {
    const overrides = await deps.creatureVoices.read();
    const srd = (await allEntries('monsters')).map((m) => ({ index: m.index, name: m.name, type: m.type, size: m.size, ...voiceFor(m, overrides) }));
    const adventure = (await campaignCreatures()).map((m) => ({ index: m.index, name: m.name, type: m.type, size: m.size, hit_points: m.hit_points, hit_dice: m.hit_dice, armor_class: m.armor_class, speed: m.speed, attacks: m.attacks || '', challenge_rating: m.challenge_rating, image: m.image || '', ...voiceFor(m, overrides) }));
    res.json({ voices: OPENAI_VOICES, srd, adventure });
  }));
  app.put('/api/creature-voices/:index', localOnly, deps.asyncRoute(async (req, res) => {
    const index = String(req.params.index).toLowerCase();
    const known = [...(await allEntries('monsters')), ...(await campaignCreatures())].find((m) => m.index === index);
    if (!known) return res.status(404).json({ error: 'No such creature' });
    const all = await deps.creatureVoices.set(index, req.body?.voice, req.body?.acting);
    res.json({ ok: true, ...voiceFor(known, all) });
  }));
  app.delete('/api/creature-voices/:index', localOnly, deps.asyncRoute(async (req, res) => {
    const index = String(req.params.index).toLowerCase();
    const known = [...(await allEntries('monsters')), ...(await campaignCreatures())].find((m) => m.index === index);
    if (!known) return res.status(404).json({ error: 'No such creature' });
    res.json({ ok: true, ...voiceFor(known, await deps.creatureVoices.reset(index)) });
  }));

  // Which cloud voice will each (voice tag, speaker) pair use? Used to label the UI.
  app.post('/api/tts/voices', deps.asyncRoute(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
    const out = [];
    for (const it of items) {
      const speaker = cleanSpeaker(it?.speaker);
      const tag = TTS_PROFILES[it?.voice] ? it.voice : 'narrator';
      const r = await resolveVoice(tag, speaker);
      out.push({ speaker, voice: r.voice, named: r.named });
    }
    res.json({ voices: out });
  }));

  app.post('/api/tts', deps.asyncRoute(async (req, res) => {
    if (voiceProviderNow() !== 'openai' && npcProviderNow() !== 'openai') return res.status(503).json({ error: 'ChatGPT voices are not selected in Settings.' });
    if (!settings.OPENAI_KEY) return res.status(503).json({ error: 'Cloud voices are off: set OPENAI_API_KEY in .env and restart.' });
    const text = pronounce(String(req.body?.text ?? '').trim().slice(0, 1500), await loadPronunciations());
    if (!text) return res.status(400).json({ error: 'text is required' });
    const tag = TTS_PROFILES[req.body?.voice] ? req.body.voice : 'narrator';
    const speaker = cleanSpeaker(req.body?.speaker);
    const { voice: autoVoice, instructions: autoInstructions } = await resolveVoice(tag, speaker);
    const voice = chosenVoice(String(req.body?.voiceName ?? '')) || autoVoice;       // voiceName: Settings and the Bestiary play a sample of a voice before it is saved
    const actingNotes = speaker !== 'Narrator' ? String(req.body?.acting ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000) : '';       // acting: the same, for the notes
    const instructions = actingNotes ? `You are voicing ${speaker}. ${actingNotes}` : autoInstructions;

    const model = speaker === 'Narrator' ? settings.TTS_MODEL : settings.NPC_TTS_MODEL;        // the Dungeon Master voice and the NPC voices each have their own model
    const key = createHash('sha1').update(`${model}|${voice}|${instructions}|${text}`).digest('hex');
    const file = path.join(deps.TTS_CACHE_DIR, `${key}.mp3`);
    try {
      const cached = await readFile(file);
      return res.type('audio/mpeg').send(cached);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        response_format: 'mp3',
        ...(model.startsWith('gpt-4o') ? { instructions } : {})
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('OpenAI TTS error', r.status, detail.slice(0, 300));
      const hint = r.status === 401 ? ' (check OPENAI_API_KEY)' : r.status === 429 ? ' (rate limit or no credit)' : '';
      return res.status(502).json({ error: `OpenAI text-to-speech failed with ${r.status}${hint}` });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    await writeFile(file, audio);
    res.type('audio/mpeg').send(audio);
  }));

  return { loadCharacterVoices, canGoFast, canSkipThinking, KNOWN_OPENAI_VOICES, chosenVoice, TTS_PROFILES, voiceProviderNow, npcProviderNow };
}
