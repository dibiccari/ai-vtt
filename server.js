import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const CHAR_DIR = path.join(__dirname, 'data', 'characters');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
let MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TOKEN_DIR = path.join(PUBLIC_DIR, 'tokens');
const CAMPAIGN_DIR = path.join(__dirname, 'data', 'campaign');
const TOKEN_URL_RE = /^\/tokens\/[a-z0-9-]{1,40}\.(png|webp|jpg)$/;

await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(CHAR_DIR, { recursive: true });
await mkdir(TOKEN_DIR, { recursive: true });
await mkdir(CAMPAIGN_DIR, { recursive: true });
const TTS_CACHE_DIR = path.join(__dirname, 'data', 'tts-cache');
await mkdir(TTS_CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------- characters

const safeId = (id) => String(id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
const int = (v, def, min = -Infinity, max = Infinity) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function normalizeCharacter(body) {
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('Character name is required'), { status: 400 });
  const id = safeId(body.id) || `${safeId(name.replace(/\s+/g, '-')) || 'pc'}-${Date.now().toString(36)}`;
  const maxHp = int(body.maxHp, 10, 1, 999);
  const abilities = {};
  for (const key of ABILITIES) abilities[key] = int(body.abilities?.[key], 10, 1, 30);
  return {
    id,
    name,
    class: String(body.class ?? '').trim().slice(0, 40) || 'Adventurer',
    level: int(body.level, 1, 1, 20),
    hp: int(body.hp, maxHp, 0, maxHp),
    maxHp,
    ac: int(body.ac, 10, 1, 40),
    speed: int(body.speed, 30, 0, 120),
    abilities,
    color: /^#[0-9a-f]{6}$/i.test(body.color ?? '') ? body.color : '#4f9dff',
    image: TOKEN_URL_RE.test(body.image ?? '') ? body.image : ''
  };
}

async function listCharacters() {
  const files = (await readdir(CHAR_DIR)).filter((f) => f.endsWith('.json'));
  const chars = [];
  for (const file of files) {
    try {
      chars.push(JSON.parse(await readFile(path.join(CHAR_DIR, file), 'utf8')));
    } catch (err) {
      console.warn(`Skipping unreadable character file ${file}: ${err.message}`);
    }
  }
  return chars.sort((a, b) => a.name.localeCompare(b.name));
}

const saveCharacter = (c) => writeFile(path.join(CHAR_DIR, `${c.id}.json`), JSON.stringify(c, null, 2));

async function seedCharacters() {
  if ((await readdir(CHAR_DIR)).some((f) => f.endsWith('.json'))) return;
  const seeds = [
    { id: 'thorin', name: 'Thorin', class: 'Fighter', level: 3, maxHp: 31, ac: 18, speed: 25, color: '#e5534b', abilities: { str: 16, dex: 12, con: 16, int: 10, wis: 12, cha: 8 } },
    { id: 'lyra', name: 'Lyra', class: 'Wizard', level: 3, maxHp: 17, ac: 12, speed: 30, color: '#4f9dff', abilities: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 } },
    { id: 'vex', name: 'Vex', class: 'Rogue', level: 3, maxHp: 21, ac: 15, speed: 30, color: '#57c47a', abilities: { str: 10, dex: 17, con: 12, int: 13, wis: 12, cha: 14 } },
    { id: 'seraphine', name: 'Seraphine', class: 'Cleric', level: 3, maxHp: 24, ac: 16, speed: 30, color: '#e3b341', abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 } }
  ];
  for (const seed of seeds) await saveCharacter(normalizeCharacter(seed));
  console.log('Seeded 4 default characters');
}
await seedCharacters();

// ---------------------------------------------------------------- app

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/characters', asyncRoute(async (_req, res) => {
  res.json(await listCharacters());
}));

app.post('/api/characters', asyncRoute(async (req, res) => {
  const character = normalizeCharacter(req.body ?? {});
  await saveCharacter(character);
  res.json(character);
}));

app.delete('/api/characters/:id', asyncRoute(async (req, res) => {
  const id = safeId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    await unlink(path.join(CHAR_DIR, `${id}.json`));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Character not found' });
    throw err;
  }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- uploads

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'map';
      cb(null, `${base}-${Date.now().toString(36)}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') && IMAGE_EXT.has(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : Object.assign(new Error('Only PNG, JPG, WEBP or GIF images are allowed'), { status: 400 }), ok);
  }
});

app.post('/api/upload', upload.single('map'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "map")' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/maps', asyncRoute(async (_req, res) => {
  const files = (await readdir(UPLOAD_DIR)).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  res.json({ maps: files.map((f) => `/uploads/${f}`) });
}));

app.get('/api/tokens', asyncRoute(async (_req, res) => {
  const files = (await readdir(TOKEN_DIR)).filter((f) => TOKEN_URL_RE.test(`/tokens/${f}`)).sort();
  res.json({ tokens: files.map((f) => `/tokens/${f}`) });
}));

// ---------------------------------------------------------------- cloud voices (OpenAI text-to-speech)

let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
let TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';

// Each DM voice tag maps to a few OpenAI voices plus an acting direction.
const TTS_PROFILES = {
  narrator:  { voices: ['fable', 'sage'], style: 'A warm, expressive fantasy game-master narrator. Measured pace, rich storytelling, subtle drama. Slow down for tension and speed up for action.' },
  gruff:     { voices: ['onyx', 'ash'], style: 'Gruff, weathered and blunt. Low and rough, impatient, as if tired of fools.' },
  sly:       { voices: ['ash', 'echo'], style: 'Sly and smooth, quick and amused, a little mischievous, with a hint of a smirk in every line.' },
  noble:     { voices: ['echo', 'fable'], style: 'Dignified and confident, crisp diction, an air of authority and good breeding.' },
  elderly:   { voices: ['sage', 'fable'], style: 'Voice: a very old man or woman, ninety years old, frail and thin, breathy, hoarse and cracked, with a trembling quaver. Pacing: slow and halting, long pauses between phrases to catch breath, words dragging at the ends. Tone: tired, wistful and gentle, a little confused. Never strong, smooth, clear or young.' },
  child:     { voices: ['shimmer', 'coral'], style: 'Voice: a tiny child of six or seven. Extremely high-pitched, squeaky, light and breathy, with a sing-song childlike lilt. Pacing: quick and uneven, tumbling over words, sometimes giggling or gasping. Tone: wide-eyed, excited and innocent. Never sound like an adult doing a child impression.' },
  monstrous: { voices: ['onyx'], style: 'A monstrous creature. Very deep and guttural, growling, menacing, with slow heavy phrasing.' },
  ethereal:  { voices: ['shimmer', 'sage'], style: 'Ethereal and otherworldly. Airy, soft and haunting, with long pauses.' },
  feminine:  { voices: ['nova', 'coral', 'shimmer'], style: 'A warm, expressive woman. Natural, conversational and lively.' },
  masculine: { voices: ['ash', 'echo', 'onyx'], style: 'A strong, steady man. Natural, firm and clear.' }
};

// Named characters get their own voice and acting direction. Edit data/campaign/voices.json to change them.
const VOICES_FILE = path.join(CAMPAIGN_DIR, 'voices.json');
const DEFAULT_CHARACTER_VOICES = {
  'Sildar Hallwinter': { voice: 'echo', style: 'A noble, honorable human knight. Steady and sincere, a little weary from hard travel, speaking with quiet resolve.' },
  'Gundren Rockseeker': { voice: 'ash', style: 'A gruff, excitable dwarf prospector with a rough burr. Proud and brusque, thrilled about treasure.' },
  'Toblen Stonehill': { voice: 'alloy', style: 'A warm, friendly innkeeper. Cheerful and hospitable, but worried about the town underneath the welcome.' },
  'Elmar Barthen': { voice: 'fable', style: 'An old, tidy shopkeeper in his seventies. Polite, patient and a little fussy, with a thin, creaky, aged voice that wavers slightly and slows down to think.' },
  'Sister Garaele': { voice: 'coral', style: 'A calm elven priestess and secret Harper. Soft, graceful and measured, with a hint of mystery.' },
  'Halia Thornton': { voice: 'nova', style: 'A brisk, ambitious businesswoman. Polished, calculating and cool, every sentence a negotiation.' },
  'Iarno Glasstaff': { voice: 'verse', style: 'A smug, arrogant wizard who thinks he is the cleverest person in the room. Silky, contemptuous and controlled.' },
  'Klarg': { voice: 'onyx', style: 'A brutish bugbear boss. Very deep and guttural, loud and bullying, speaking in broken short sentences.' },
  'Yeemik': { voice: 'shimmer', style: 'A scheming goblin leader. Raspy, high and fast, nervous, sneaky and eager to make a deal.' },
  'Nezznar': { voice: 'sage', style: 'A cold, patient drow spellcaster known as the Black Spider. Quiet, silky and venomous, never raising his voice.' },
  'Agatha': { voice: 'ballad', style: 'A haunting banshee. Whispering, mournful and echoing, with long eerie pauses and sudden sharpness.' },
  'Reidoth': { voice: 'echo', style: 'A very old, solitary druid. Slow, gravelly and weathered, a gentle rasp and a quaver of age, with the calm of someone who prefers trees to people.' }
};
const KNOWN_OPENAI_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);

async function loadCharacterVoices() {
  try {
    const parsed = JSON.parse(await readFile(VOICES_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeFile(VOICES_FILE, JSON.stringify(DEFAULT_CHARACTER_VOICES, null, 2));
      return DEFAULT_CHARACTER_VOICES;
    }
    console.warn(`Could not read ${VOICES_FILE}: ${err.message}`);
    return DEFAULT_CHARACTER_VOICES;
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

async function resolveVoice(tag, speaker) {
  const profile = TTS_PROFILES[tag] || TTS_PROFILES.narrator;
  const table = await loadCharacterVoices();
  const named = characterVoiceFor(table, speaker);
  if (named) return { voice: named.voice, instructions: `You are voicing ${speaker}. ${named.style || profile.style}`, named: true };
  if (speaker === 'Narrator') return { voice: TTS_PROFILES.narrator.voices[0], instructions: TTS_PROFILES.narrator.style, named: true };
  // Unnamed characters: the same name always gets the same voice from the profile's list.
  const hash = [...speaker.toLowerCase()].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  const voice = profile.voices[hash % profile.voices.length];
  return { voice, instructions: speaker === 'Narrator' ? profile.style : `You are voicing ${speaker}. ${profile.style}`, named: false };
}

app.get('/api/tts/status', (_req, res) => {
  res.json({ enabled: Boolean(OPENAI_KEY), model: TTS_MODEL });
});

// Which cloud voice will each (voice tag, speaker) pair use? Used to label the UI.
app.post('/api/tts/voices', asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
  const out = [];
  for (const it of items) {
    const speaker = String(it?.speaker ?? 'Narrator').replace(/[^\w .'-]/g, '').slice(0, 60) || 'Narrator';
    const tag = TTS_PROFILES[it?.voice] ? it.voice : 'narrator';
    const r = await resolveVoice(tag, speaker);
    out.push({ speaker, voice: r.voice, named: r.named });
  }
  res.json({ voices: out });
}));

app.post('/api/tts', asyncRoute(async (req, res) => {
  if (!OPENAI_KEY) return res.status(503).json({ error: 'Cloud voices are off: set OPENAI_API_KEY in .env and restart.' });
  const text = String(req.body?.text ?? '').trim().slice(0, 1500);
  if (!text) return res.status(400).json({ error: 'text is required' });
  const tag = TTS_PROFILES[req.body?.voice] ? req.body.voice : 'narrator';
  const speaker = String(req.body?.speaker ?? 'Narrator').replace(/[^\w .'-]/g, '').slice(0, 60) || 'Narrator';
  const { voice, instructions } = await resolveVoice(tag, speaker);

  const key = createHash('sha1').update(`${TTS_MODEL}|${voice}|${instructions}|${text}`).digest('hex');
  const file = path.join(TTS_CACHE_DIR, `${key}.mp3`);
  try {
    const cached = await readFile(file);
    return res.type('audio/mpeg').send(cached);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice,
      input: text,
      response_format: 'mp3',
      ...(TTS_MODEL.startsWith('gpt-4o') ? { instructions } : {})
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

// ---------------------------------------------------------------- campaign

// Every .txt/.md file in data/campaign is given to the DM as reference material (cached between turns).
async function loadCampaign() {
  const files = (await readdir(CAMPAIGN_DIR)).filter((f) => /\.(txt|md)$/i.test(f)).sort();
  const parts = [];
  for (const file of files) {
    const text = (await readFile(path.join(CAMPAIGN_DIR, file), 'utf8')).trim();
    if (text) parts.push(`##### CAMPAIGN DOCUMENT: ${file} #####\n${text}`);
  }
  return parts.join('\n\n');
}
const campaignText = await loadCampaign();
if (campaignText) console.log(`Loaded campaign reference (~${Math.round(campaignText.length / 4000)}k tokens)`);

// ---------------------------------------------------------------- AI DM

let anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const DM_SYSTEM = `You are the Dungeon Master for a Dungeons & Dragons 5th Edition game running on a virtual tabletop.
You are the authority on rules, narrative, and the world. Narrate vividly but concisely (1-3 short paragraphs), adjudicate the players' declared actions using 5e rules, roll dice yourself when needed and show the results (e.g. "Attack: d20+5 = 17 vs AC 13 - hit"), and end by prompting the active player.

The board is a square grid; each square is 5 ft. Positions are given as integer (col,row), origin top-left. Walls are line segments in pixel coordinates where one square = gridSize pixels.
Respect each token's remaining movement (movementRemaining, in feet) and the walls.

Return mechanical changes in mapUpdates:
- moveToken: move an existing token (tokenId, col, row).
- addToken: place an NPC or monster (tokenId as a new unique id, name, col, row, color as #rrggbb).
- removeToken: remove a token (tokenId), e.g. a defeated monster.
- setHp: set a player character's current HP (characterId, hp).
- addWall: add a wall or door (x1, y1, x2, y2 in pixels, wallType "wall" or "door").
Only include updates that actually happened. Use an empty array when nothing changes on the board.

The table plays in voice mode: your reply is read aloud. Split the full reply into voiceLines, in order, so that
the voiceLines texts joined together equal the narrative. Use speaker "Narrator" with voice "narrator" for narration and
rules results; give every NPC or monster line its own entry with the NPC's name as speaker and the voice profile that
fits them best (gruff, sly, noble, elderly, child, monstrous, ethereal, feminine, masculine). Keep the same voice for the
same NPC across turns. Write dice math in a speakable way. When the player's input is marked as spoken, it was
transcribed from speech and may contain recognition errors - interpret it charitably.`;

const CAMPAIGN_RULES = `A campaign module follows. You are running it. Treat it as secret DM material: never read boxed text or stat blocks verbatim unless it is the right moment, never reveal secrets, traps, or monster stats before the players earn them, and keep track of where the party is. Use the module's NPC names, personalities, and locations. The board state tells you which map is loaded (mapName); the players move tokens themselves, so describe what their position can see.`;

const VOICES = ['narrator', 'gruff', 'sly', 'noble', 'elderly', 'child', 'monstrous', 'ethereal', 'feminine', 'masculine'];

const DM_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    mapUpdates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['moveToken', 'addToken', 'removeToken', 'setHp', 'addWall'] },
          tokenId: { type: 'string' },
          characterId: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string' },
          col: { type: 'integer' },
          row: { type: 'integer' },
          hp: { type: 'integer' },
          x1: { type: 'number' },
          y1: { type: 'number' },
          x2: { type: 'number' },
          y2: { type: 'number' },
          wallType: { type: 'string', enum: ['wall', 'door'] }
        },
        required: ['type'],
        additionalProperties: false
      }
    }
  },
  required: ['narrative', 'voiceLines', 'mapUpdates'],
  additionalProperties: false
};
DM_SCHEMA.properties.voiceLines = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      speaker: { type: 'string' },
      voice: { type: 'string', enum: VOICES },
      text: { type: 'string' }
    },
    required: ['speaker', 'voice', 'text'],
    additionalProperties: false
  }
};

function cleanVoiceLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((l) => ({
      speaker: String(l?.speaker ?? 'Narrator').slice(0, 60) || 'Narrator',
      voice: VOICES.includes(l?.voice) ? l.voice : 'narrator',
      text: String(l?.text ?? '').trim()
    }))
    .filter((l) => l.text);
}

function buildHistory(history, message, state, inputMode) {
  const messages = [];
  for (const entry of Array.isArray(history) ? history.slice(-20) : []) {
    const role = entry?.role === 'assistant' ? 'assistant' : entry?.role === 'user' ? 'user' : null;
    const text = String(entry?.content ?? '').trim();
    if (!role || !text) continue;
    // The API requires alternating roles; merge consecutive same-role turns.
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else messages.push({ role, content: text });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  const label = inputMode === 'voice' ? 'PLAYER ACTION (spoken, speech-to-text)' : 'PLAYER ACTION';
  const turn = `BOARD STATE (JSON):\n${JSON.stringify(state)}\n\n${label}:\n${message}`;
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') last.content += `\n\n${turn}`;
  else messages.push({ role: 'user', content: turn });
  return messages;
}

app.post('/api/chat', asyncRoute(async (req, res) => {
  const { message, history, activeTokenId, tokens, characters, walls, gridSize, inputMode, mapName } = req.body ?? {};
  const text = String(message ?? '').trim();
  if (!text) return res.status(400).json({ error: 'message is required' });

  if (!anthropic) {
    const narrative = 'The AI Dungeon Master is offline: no ANTHROPIC_API_KEY is configured on the server. Add it to .env and restart to bring the DM to life. Your action was received.';
    return res.json({
      narrative,
      voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }],
      mapUpdates: [],
      offline: true
    });
  }

  const state = {
    mapName: String(mapName ?? 'blank grid').slice(0, 120),
    activeTokenId: activeTokenId ?? null,
    gridSize: Number(gridSize) || 50,
    tokens: Array.isArray(tokens) ? tokens : [],
    characters: Array.isArray(characters) ? characters : [],
    walls: Array.isArray(walls) ? walls : []
  };

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: campaignText
        ? [
            { type: 'text', text: DM_SYSTEM },
            { type: 'text', text: `${CAMPAIGN_RULES}\n\n${campaignText}`, cache_control: { type: 'ephemeral' } }
          ]
        : DM_SYSTEM,
      messages: buildHistory(history, text, state, inputMode),
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: DM_SCHEMA } },
      // Server-side fallback: if a safety classifier declines, the API retries on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    });

    if (response.stop_reason === 'refusal') {
      const narrative = 'The DM declines to narrate that action. Try describing it differently.';
      return res.json({ narrative, voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }], mapUpdates: [] });
    }
    const block = response.content.find((b) => b.type === 'text');
    if (!block) throw new Error(`No text in model response (stop_reason: ${response.stop_reason})`);
    const parsed = JSON.parse(block.text);
    const narrative = String(parsed.narrative ?? '');
    const voiceLines = cleanVoiceLines(parsed.voiceLines);
    res.json({
      narrative,
      voiceLines: voiceLines.length ? voiceLines : [{ speaker: 'Narrator', voice: 'narrator', text: narrative }],
      mapUpdates: Array.isArray(parsed.mapUpdates) ? parsed.mapUpdates : []
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'The DM is overwhelmed (rate limited). Try again shortly.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error:', err.status, err.message);
      return res.status(502).json({ error: `AI DM error: ${err.message}` });
    }
    throw err;
  }
}));

// ---------------------------------------------------------------- errors

// ---------------------------------------------------------------- settings (API keys, models)

const ENV_FILE = path.join(__dirname, '.env');
const SETTINGS = {
  ANTHROPIC_API_KEY: { secret: true },
  OPENAI_API_KEY: { secret: true },
  ANTHROPIC_MODEL: { secret: false },
  TTS_MODEL: { secret: false }
};

// Keys are secrets: only this computer may read or change settings (blocks LAN devices, other sites, DNS rebinding).
function localOnly(req, res, next) {
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const host = req.get('host') || '';
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  let originOk = true;
  const origin = req.get('origin');
  if (origin) {
    try { originOk = new URL(origin).host === host; } catch { originOk = false; }
  }
  if (!loopback || !hostOk || !originOk) return res.status(403).json({ error: 'Settings can only be changed from this computer.' });
  next();
}

const hint = (key) => (key ? `ends in ${key.slice(-4)}` : '');

function applySettings() {
  MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
  OPENAI_KEY = process.env.OPENAI_API_KEY || '';
  const key = process.env.ANTHROPIC_API_KEY || '';
  anthropic = key ? new Anthropic({ apiKey: key }) : null;
}

async function updateEnvFile(updates) {
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
    anthropic: { set: Boolean(process.env.ANTHROPIC_API_KEY), hint: hint(process.env.ANTHROPIC_API_KEY), model: MODEL },
    openai: { set: Boolean(OPENAI_KEY), hint: hint(OPENAI_KEY), ttsModel: TTS_MODEL }
  });
});

app.post('/api/settings', localOnly, asyncRoute(async (req, res) => {
  const body = req.body ?? {};
  const clear = new Set(Array.isArray(body.clear) ? body.clear : []);
  const updates = {};
  for (const [name, cfg] of Object.entries(SETTINGS)) {
    if (clear.has(name)) { updates[name] = ''; continue; }
    if (typeof body[name] !== 'string') continue;
    const value = body[name].trim();
    if (!value) continue; // blank means "leave unchanged"
    const valid = cfg.secret ? /^[^\s"'`\\]{8,400}$/.test(value) : /^[\w.:-]{1,80}$/.test(value);
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

app.post('/api/settings/test', localOnly, asyncRoute(async (req, res) => {
  const which = req.body?.which;
  try {
    if (which === 'anthropic') {
      if (!anthropic) return res.json({ ok: false, error: 'No Anthropic key saved yet.' });
      await anthropic.models.list({ limit: 1 });
      return res.json({ ok: true, message: `Anthropic key accepted (model: ${MODEL}).` });
    }
    if (which === 'openai') {
      if (!OPENAI_KEY) return res.json({ ok: false, error: 'No OpenAI key saved yet.' });
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${OPENAI_KEY}` } });
      if (!r.ok) return res.json({ ok: false, error: r.status === 401 ? 'OpenAI rejected the key (401).' : `OpenAI returned ${r.status}.` });
      return res.json({ ok: true, message: 'OpenAI key accepted. Use "Hear a sample" to confirm your credit balance works.' });
    }
    res.status(400).json({ error: 'which must be "anthropic" or "openai"' });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Anthropic.APIError ? `Anthropic error ${err.status}: ${err.message}` : err.message });
  }
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`AI-VTT running at http://localhost:${PORT} (host ${HOST}, model: ${MODEL}, AI DM ${anthropic ? 'online' : 'offline - set ANTHROPIC_API_KEY'})`);
});
