import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readdir, readFile, writeFile, unlink, rename, stat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SKILLS, processCharacterUpdates } from './lib/sheet-edit.js';
import { mapsFor, mapsForPrompt, resolveChangeMap, entriesToList, cleanMapList, mapsFromList, MAP_KINDS } from './lib/campaign-maps.js';
import { listEntries, getEntry, monsterImage } from './lib/compendium.js';
import { readSafety, writeSafety, safetyForPrompt } from './lib/safety.js';
import { rollExpr, diceTray } from './lib/dice.js';
import { writeTavernParty } from './lib/tavern-party.js';
import { readSettings, writeSettings, settingsForPrompt } from './lib/settings.js';
import { itemFromSrd, restCharacter, MAX_ATTUNED, EFFECT_KINDS, seedFromSheet, normalizeInventory, normalizeCoins, computeEffective, syncSheet, readStash, writeStash, processPartyUpdates } from './lib/party.js';
import { CATEGORIES, STATUSES, readSave, replaceEntries, addJournalUpdates, journalForPrompt } from './lib/journal.js';

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
// Each campaign is a folder in data/campaigns/<id>/ holding its text (*.md / *.txt), campaign.json and voices.json.
const CAMPAIGNS_DIR = path.join(__dirname, 'data', 'campaigns');
const LEGACY_CAMPAIGN_DIR = path.join(__dirname, 'data', 'campaign');
const DEFAULT_CAMPAIGN_ID = 'lost-mine-of-phandelver';
const TEST_CAMPAIGN_ID = 'tavern-brawl-test';
const ACTIVE_CAMPAIGN_FILE = path.join(CAMPAIGNS_DIR, 'active.json');
const TOKEN_URL_RE = /^\/tokens\/[a-z0-9-]{1,40}\.(png|webp|jpg)$/;

await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(CHAR_DIR, { recursive: true });
await mkdir(TOKEN_DIR, { recursive: true });
await mkdir(CAMPAIGNS_DIR, { recursive: true });
// One-time move of the old single-campaign folder (data/campaign) into the first campaign.
try {
  await stat(LEGACY_CAMPAIGN_DIR);
  try {
    await stat(path.join(CAMPAIGNS_DIR, DEFAULT_CAMPAIGN_ID));
  } catch {
    await rename(LEGACY_CAMPAIGN_DIR, path.join(CAMPAIGNS_DIR, DEFAULT_CAMPAIGN_ID));
    console.log('Moved data/campaign to data/campaigns/' + DEFAULT_CAMPAIGN_ID);
  }
} catch { /* no old folder */ }
await mkdir(path.join(CAMPAIGNS_DIR, DEFAULT_CAMPAIGN_ID), { recursive: true });
const TTS_CACHE_DIR = path.join(__dirname, 'data', 'tts-cache');
await mkdir(TTS_CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------- characters

const safeId = (id) => String(id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
const int = (v, def, min = -Infinity, max = Infinity) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// The official 5E sheet's form values, keyed by PDF field name (text as strings, checkboxes as booleans).
function normalizeSheet(raw) {
  const sheet = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return sheet;
  for (const [key, value] of Object.entries(raw).slice(0, 700)) {
    const name = String(key).slice(0, 80);
    if (typeof value === 'boolean') sheet[name] = value;
    else if (typeof value === 'string' || typeof value === 'number') sheet[name] = String(value).slice(0, 5000);
  }
  return sheet;
}

function normalizeCharacter(body) {
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('Character name is required'), { status: 400 });
  const id = safeId(body.id) || `${safeId(name.replace(/\s+/g, '-')) || 'pc'}-${Date.now().toString(36)}`;
  const maxHp = int(body.maxHp, 10, 1, 999);
  const abilities = {};
  for (const key of ABILITIES) abilities[key] = int(body.abilities?.[key], 10, 1, 30);
  const sheet = normalizeSheet(body.sheet);
  const expertise = Array.isArray(body.expertise) ? [...new Set(body.expertise.filter((s) => typeof s === 'string' && SKILLS[s]))] : [];
  const campaigns = (Array.isArray(body.campaigns) ? body.campaigns : []).map((c) => String(c ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60)).filter(Boolean).slice(0, 20);
  const sheetLog = (Array.isArray(body.sheetLog) ? body.sheetLog : []).slice(-40).map((e) => ({
    at: String(e?.at ?? '').slice(0, 40),
    by: String(e?.by ?? 'ai').slice(0, 20),
    reason: String(e?.reason ?? '').slice(0, 200),
    changes: (Array.isArray(e?.changes) ? e.changes : []).slice(0, 80).map((c) => ({ field: String(c?.field ?? '').slice(0, 80), from: String(c?.from ?? '').slice(0, 200), to: String(c?.to ?? '').slice(0, 200) }))
  }));
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
    image: TOKEN_URL_RE.test(body.image ?? '') ? body.image : '',
    ...(Object.keys(sheet).length ? { sheet } : {}),
    darkvision: int(body.darkvision, 0, 0, 120),
    ...(campaigns.length ? { campaigns } : {}),
    ...(Array.isArray(body.inventory) ? { inventory: normalizeInventory(body.inventory) } : {}),
    ...(body.coins && typeof body.coins === 'object' ? { coins: normalizeCoins(body.coins) } : {}),
    ...(expertise.length ? { expertise } : {}),
    ...(sheetLog.length ? { sheetLog } : {})
  };
}

// A campaign's party is the list of character ids in its campaign.json (`party`, chosen when the campaign is created or on its Settings). Without one, a character's own `campaigns` tag decides (none = every campaign). Pass a campaign id to get only its party.
async function listCharacters(campaign) {
  const template = campaign ? await templateOfCampaign(campaign) : '';
  const party = campaign ? (await readCampaignMeta(safeCampaignId(campaign))).party : null;
  const files = (await readdir(CHAR_DIR)).filter((f) => f.endsWith('.json'));
  const chars = [];
  for (const file of files) {
    try {
      chars.push(JSON.parse(await readFile(path.join(CHAR_DIR, file), 'utf8')));
    } catch (err) {
      console.warn(`Skipping unreadable character file ${file}: ${err.message}`);
    }
  }
  if (campaign && Array.isArray(party)) return chars.filter((c) => party.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return chars.filter((c) => !campaign || !Array.isArray(c.campaigns) || !c.campaigns.length || c.campaigns.includes(campaign) || c.campaigns.includes(template)).sort((a, b) => a.name.localeCompare(b.name));
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
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/api/characters', asyncRoute(async (req, res) => {
  res.json(await listCharacters(req.query.campaign ? safeCampaignId(req.query.campaign) : ''));
}));

app.post('/api/characters', asyncRoute(async (req, res) => {
  const character = normalizeCharacter(req.body ?? {});
  // Saves that do not carry the full sheet (the tabletop's quick form, HP buttons) keep the one already stored.
  if (req.body?.sheet === undefined) {
    try {
      const old = JSON.parse(await readFile(path.join(CHAR_DIR, `${character.id}.json`), 'utf8'));
      if (old.sheet && Object.keys(old.sheet).length) character.sheet = old.sheet;
      if (req.body?.expertise === undefined && old.expertise?.length) character.expertise = old.expertise;
      if (req.body?.sheetLog === undefined && old.sheetLog?.length) character.sheetLog = old.sheetLog;
      if (req.body?.inventory === undefined && old.inventory) character.inventory = normalizeInventory(old.inventory);
      if (req.body?.coins === undefined && old.coins) character.coins = normalizeCoins(old.coins);
      if (req.body?.campaigns === undefined && old.campaigns?.length) character.campaigns = old.campaigns;
      if (req.body?.darkvision === undefined && old.darkvision) character.darkvision = int(old.darkvision, 0, 0, 120);
    } catch { /* new character: nothing to keep */ }
  }
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
  limits: { fileSize: 50 * 1024 * 1024 },
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

// ---------------------------------------------------------------- per-map config (walls + grid calibration)
// Stored in data/maps/<image file name>.json so it survives browser changes. Wall coordinates are in image pixels.

const MAP_CONFIG_DIR = path.join(__dirname, 'data', 'maps');
await mkdir(MAP_CONFIG_DIR, { recursive: true });

function mapConfigFile(name) {
  const base = path.basename(String(name ?? ''));
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(base) || !IMAGE_EXT.has(path.extname(base).toLowerCase())) {
    throw Object.assign(new Error('map must be the file name of an uploaded image'), { status: 400 });
  }
  return path.join(MAP_CONFIG_DIR, `${base}.json`);
}

function normalizeMapConfig(body) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  const walls = [];
  for (const w of Array.isArray(body?.walls) ? body.walls.slice(0, 20000) : []) {
    const [x1, y1, x2, y2] = [num(w?.x1), num(w?.y1), num(w?.x2), num(w?.y2)];
    if ([x1, y1, x2, y2].includes(null)) continue;
    walls.push({ x1, y1, x2, y2, type: w.type === 'door' ? 'door' : 'wall', open: Boolean(w.open) });
  }
  const starts = [];
  for (const s of Array.isArray(body?.starts) ? body.starts.slice(0, 60) : []) {
    const name = String(s?.name ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const [x, y] = [num(s?.x), num(s?.y)];
    const desc = String(s?.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (name && x !== null && y !== null && !starts.some((o) => o.name === name)) starts.push({ name, x, y, ...(desc ? { desc } : {}) });
  }
  // Light sources from a .dd2vtt file (image pixels; range in squares). Kept for the lighting work.
  const lights = [];
  for (const l of Array.isArray(body?.lights) ? body.lights.slice(0, 500) : []) {
    const [x, y, range, intensity] = [num(l?.x), num(l?.y), num(l?.range), num(l?.intensity)];
    if ([x, y, range].includes(null)) continue;
    lights.push({ x, y, range, intensity: intensity ?? 1, color: /^[0-9a-f]{6,8}$/i.test(String(l?.color ?? '')) ? String(l.color).toLowerCase() : 'ffffff', ...(l?.flicker === true ? { flicker: true } : {}), ...(String(l?.name ?? '').trim() ? { name: String(l.name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) } : {}) });
  }
  // Difficult terrain: rectangles in image pixels. Moving into a square whose centre is inside one costs double.
  const difficult = [];
  for (const d of Array.isArray(body?.difficult) ? body.difficult.slice(0, 600) : []) {
    const [x, y, w, h] = [num(d?.x), num(d?.y), num(d?.w), num(d?.h)];
    if ([x, y, w, h].includes(null) || w <= 0 || h <= 0) continue;
    difficult.push({ x, y, w, h });
  }
  const config = { squares: int(body?.squares, 50, 5, 400), walls, starts };
  if (difficult.length) config.difficult = difficult;
  if (lights.length) config.lights = lights;
  // How bright the place is before any light source: daylight (bright), a lit room or dusk (dim), or darkness.
  if (['bright', 'dim', 'dark'].includes(body?.light)) config.light = body.light;
  if (['none', 'forest', 'night', 'wind', 'cave', 'dungeon', 'tavern', 'town', 'rain', 'fire'].includes(body?.ambience)) config.ambience = body.ambience;
  if (/^[0-9a-f]{6,8}$/i.test(String(body?.ambient ?? ''))) config.ambient = String(body.ambient).toLowerCase();
  if (body?.source === 'dd2vtt') config.source = 'dd2vtt';
  // Versions of one place (a day and a night map, a summer and a winter map) share a group and have a variant name each.
  const slug = (v, max) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  if (slug(body?.group, 40)) {
    config.group = slug(body.group, 40);
    config.variant = slug(body?.variant, 20) || 'main';
  }
  return config;
}

app.get('/api/map-config', asyncRoute(async (req, res) => {
  try {
    res.json({ config: JSON.parse(await readFile(mapConfigFile(req.query.map), 'utf8')) });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    res.json({ config: null });
  }
}));

// Which maps have saved config, and where it came from (source is 'dd2vtt' for maps set up from a Universal VTT file).
app.get('/api/map-configs', asyncRoute(async (_req, res) => {
  const out = [];
  for (const f of await readdir(MAP_CONFIG_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(await readFile(path.join(MAP_CONFIG_DIR, f), 'utf8'));
      const start = (Array.isArray(c.starts) ? c.starts : []).find((s) => s && s.name === 'start');
      out.push({ map: f.slice(0, -5), source: c.source || null, walls: Array.isArray(c.walls) ? c.walls.length : 0, group: c.group || null, variant: c.variant || null,
        squares: Number(c.squares) || 0, light: c.light || 'bright', ambience: c.ambience || '', startPin: start ? { x: start.x, y: start.y } : null, pins: Array.isArray(c.starts) ? c.starts.length : 0 });
    } catch { /* skip unreadable config */ }
  }
  res.json({ configs: out });
}));

app.put('/api/map-config', localOnly, asyncRoute(async (req, res) => {
  const config = normalizeMapConfig(req.body);
  const file = mapConfigFile(req.query.map);
  // The Map Test page does not know about lights: keep the ones already saved.
  if (!config.lights) {
    try {
      const old = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(old.lights) && old.lights.length) config.lights = old.lights;
      if (old.ambient && !config.ambient) config.ambient = old.ambient;
      if (old.light && !config.light) config.light = old.light;
      if (old.ambience && !config.ambience) config.ambience = old.ambience;
      if (req.body?.difficult === undefined && Array.isArray(old.difficult) && old.difficult.length) config.difficult = old.difficult;
    } catch { /* no earlier config */ }
  }
  await writeFile(file, JSON.stringify(config, null, 2));
  res.json({ ok: true, walls: config.walls.length });
}));

// The places the active campaign can move the table to (only maps that are installed).
// The maps a campaign can use: the list saved on the Campaigns page (maps.json), or the built-in registry for the shipped campaigns.
const pictureFiles = async () => (await readdir(UPLOAD_DIR)).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
async function savedMapList(id) {
  try { return JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, safeCampaignId(id), 'maps.json'), 'utf8')).maps; } catch { return null; }
}
async function mapsForCampaign(id) {
  const files = await pictureFiles();
  const saved = await savedMapList(id);
  return Array.isArray(saved) ? mapsFromList(saved, files) : mapsFor(await templateOfCampaign(id), files);
}

app.get('/api/campaigns/:id/maps', asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.params.id);
  const saved = await savedMapList(id);
  const files = await pictureFiles();
  res.json({ custom: Array.isArray(saved), maps: Array.isArray(saved) ? cleanMapList(saved, files).list : entriesToList(mapsFor(await templateOfCampaign(id), files)), uploads: files.sort(), kinds: MAP_KINDS });
}));

app.put('/api/campaigns/:id/maps', localOnly, asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.params.id);
  if (!id || !(await campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
  const { list, problems } = cleanMapList(req.body?.maps, await pictureFiles());
  await writeFile(path.join(CAMPAIGNS_DIR, id, 'maps.json'), JSON.stringify({ version: 1, maps: list }, null, 2));
  res.json({ ok: true, maps: list, problems });
}));

// Back to the built-in list (only the shipped campaigns have one).
app.delete('/api/campaigns/:id/maps', localOnly, asyncRoute(async (req, res) => {
  try { await unlink(path.join(CAMPAIGNS_DIR, safeCampaignId(req.params.id), 'maps.json')); } catch { /* nothing saved */ }
  res.json({ ok: true });
}));

// Arrival spots saved on the Map Test page (image pixels) are added to each map, and win over the built-in guesses.
async function withSavedStarts(maps) {
  const out = [];
  for (const m of maps) {
    let starts = [];
    try { starts = JSON.parse(await readFile(mapConfigFile(m.url.split('/').pop()), 'utf8')).starts || []; } catch { /* no saved config */ }
    out.push({ ...m, startPx: starts.find((s) => s.name === 'start') || null, spotsPx: Object.fromEntries(starts.filter((s) => s.name !== 'start').map((s) => [s.name, { x: s.x, y: s.y }])), spotNotes: Object.fromEntries(starts.filter((s) => s.desc).map((s) => [s.name, s.desc])) });
  }
  return out;
}

app.get('/api/maps/available', asyncRoute(async (_req, res) => {
  const campaign = await getActiveCampaignId();
  const maps = await withSavedStarts(await mapsForCampaign(campaign));
  res.json({ campaign, maps: maps.map((m) => ({ id: m.id, name: m.name, kind: m.kind, description: m.description, url: m.url, startPx: m.startPx ? { x: m.startPx.x, y: m.startPx.y } : null, start: { col: m.start[0], row: m.start[1] }, spots: Object.fromEntries(Object.entries(m.spots).map(([k, [col, row]]) => [k, { col, row }])) })) });
}));

// ---------------------------------------------------------------- compendium (SRD monsters, spells, magic items)

app.get('/api/compendium/:kind', asyncRoute(async (req, res) => {
  const entries = await listEntries(req.params.kind);
  if (!entries) return res.status(404).json({ error: 'Unknown compendium' });
  res.json({ entries });
}));

app.get('/api/compendium/:kind/:index', asyncRoute(async (req, res) => {
  const entry = await getEntry(req.params.kind, String(req.params.index).toLowerCase().replace(/[^a-z0-9-]/g, ''));
  if (!entry) return res.status(404).json({ error: 'Not found' });
  res.json({ entry });
}));

// ---------------------------------------------------------------- party API (gear, coins, attunement, stash)

const partyView = (c, variant = false) => {
  const seeded = seedFromSheet(c);
  return { id: seeded.id, name: seeded.name, class: seeded.class, level: seeded.level, hp: seeded.hp, maxHp: seeded.maxHp, color: seeded.color, image: seeded.image, abilities: seeded.abilities, darkvision: seeded.darkvision || 0, ac: seeded.ac, speed: seeded.speed, inventory: normalizeInventory(seeded.inventory), coins: normalizeCoins(seeded.coins), effective: computeEffective(seeded, variant) };
};

app.get('/api/party', asyncRoute(async (_req, res) => {
  const campaign = await getActiveCampaignId();
  const variant = (await readSettings(path.join(CAMPAIGNS_DIR, campaign))).variantEncumbrance;
  const characters = (await listCharacters(campaign)).map((c) => partyView(c, variant));
  res.json({ campaign, characters, stash: await readStash(path.join(CAMPAIGNS_DIR, campaign)), maxAttuned: MAX_ATTUNED });
}));

// Replace one character's gear (the party page saves the whole list). Extra attunements beyond three are dropped and reported.
app.put('/api/party/characters/:id', asyncRoute(async (req, res) => {
  const id = safeId(req.params.id);
  let old;
  try { old = JSON.parse(await readFile(path.join(CHAR_DIR, `${id}.json`), 'utf8')); } catch { return res.status(404).json({ error: 'Character not found' }); }
  const problems = [];
  const next = { ...old, inventory: normalizeInventory(req.body?.inventory, problems), coins: normalizeCoins(req.body?.coins), ...(req.body?.darkvision !== undefined ? { darkvision: int(req.body.darkvision, 0, 0, 120) } : {}) };
  const saved = normalizeCharacter(syncSheet(next));
  await saveCharacter(saved);
  res.json({ character: partyView(saved, (await readSettings(path.join(CAMPAIGNS_DIR, await getActiveCampaignId()))).variantEncumbrance), problems });
}));

// A party item built from an SRD magic item or piece of equipment (with its weight, attunement and, for the common ones, effects).
app.get('/api/party/srd-item', asyncRoute(async (req, res) => {
  const kind = req.query.kind === 'equipment' ? 'equipment' : 'magic-items';
  const entry = await getEntry(kind, String(req.query.index ?? '').toLowerCase().replace(/[^a-z0-9-]/g, ''));
  const item = itemFromSrd(kind === 'equipment' ? 'equipment' : 'magic', entry);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ item });
}));

// Rest the whole party: a long rest restores hit points and spell slots (the tabletop clears conditions on its own board).
async function restParty(kind) {
  const rested = [];
  for (const c of await listCharacters(await getActiveCampaignId())) {
    const { character, note } = restCharacter(c, kind);
    if (note) { await saveCharacter(normalizeCharacter(character)); rested.push(c.id); }
  }
  return { kind, rested };
}

app.post('/api/party/rest', asyncRoute(async (req, res) => {
  const kind = req.body?.kind === 'long' ? 'long' : 'short';
  res.json(await restParty(kind));
}));

app.put('/api/party/stash', asyncRoute(async (req, res) => {
  const campaign = await getActiveCampaignId();
  res.json({ stash: await writeStash(path.join(CAMPAIGNS_DIR, campaign), req.body) });
}));
// The user's own recordings (public/audio/scene-*, mood-*, sfx-*) replace the synthesised sounds.
app.get('/api/audio-files', asyncRoute(async (_req, res) => {
  try { res.json({ files: (await readdir(path.join(PUBLIC_DIR, 'audio'))).filter((f) => /\.(mp3|ogg|wav|m4a|webm|flac)$/i.test(f)).sort() }); } catch { res.json({ files: [] }); }
}));

// ---------------------------------------------------------------- sound review notes (from the Sound Test page)
const SOUND_FEEDBACK_FILE = path.join(__dirname, 'data', 'sound-feedback.json');
app.get('/api/sound-feedback', asyncRoute(async (_req, res) => {
  try { res.json(JSON.parse(await readFile(SOUND_FEEDBACK_FILE, 'utf8'))); } catch { res.json({}); }
}));
app.put('/api/sound-feedback', localOnly, asyncRoute(async (req, res) => {
  const clean = {};
  for (const [key, v] of Object.entries(req.body && typeof req.body === 'object' ? req.body : {}).slice(0, 80)) {
    if (!/^[a-z0-9-]{1,30}:[a-z0-9-]{1,30}$/.test(key)) continue;
    clean[key] = { rating: ['good', 'close', 'wrong'].includes(v?.rating) ? v.rating : '', note: String(v?.note ?? '').slice(0, 500) };
  }
  await writeFile(SOUND_FEEDBACK_FILE, JSON.stringify(clean, null, 2));
  res.json({ ok: true, saved: Object.keys(clean).length });
}));

// ---------------------------------------------------------------- Map Maker (maps I generate for you, your requests and feedback)
// Requests and feedback are written here from the Map Maker page and read by the assistant in the coding session, which then generates or
// improves the maps (scripts/make-*-map.mjs). data/map-requests.json and data/map-feedback.json.
const MAP_REQUESTS_FILE = path.join(__dirname, 'data', 'map-requests.json');
const MAP_FEEDBACK_FILE = path.join(__dirname, 'data', 'map-feedback.json');
const REQUEST_STATUS = ['new', 'working', 'done'];
const FEATURES = ['doors', 'lights', 'water', 'trees', 'difficult terrain', 'stairs', 'secret door', 'traps', 'night version'];

app.get('/api/map-maker', asyncRoute(async (_req, res) => {
  const scen = (await readdir(path.join(PUBLIC_DIR, 'scenarios'))).filter((f) => f.endsWith('.dd2vtt')).map((f) => f.slice(0, -7));
  const pictures = await pictureFiles();
  const maps = [];
  for (const stem of scen) {
    const picture = pictures.find((f) => new RegExp(`^${stem.replace(/[^a-z0-9-]/gi, '')}(-[a-z0-9]{6,10})?\\.png$`, 'i').test(f));
    if (!picture) { maps.push({ stem, picture: '', imported: false }); continue; }
    let c = {};
    try { c = JSON.parse(await readFile(mapConfigFile(picture), 'utf8')); } catch { /* no config yet */ }
    maps.push({
      stem, picture, imported: true, squares: Number(c.squares) || 0,
      walls: (c.walls || []).filter((w) => w.type !== 'door').length, doors: (c.walls || []).filter((w) => w.type === 'door').length,
      lights: (c.lights || []).length, pins: (c.starts || []).length, difficult: (c.difficult || []).length, light: c.light || 'bright'
    });
  }
  const read = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
  res.json({ maps, requests: await read(MAP_REQUESTS_FILE, []), feedback: await read(MAP_FEEDBACK_FILE, {}), features: FEATURES });
}));

app.put('/api/map-maker/requests', localOnly, asyncRoute(async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : []).slice(0, 100).map((r) => ({
    id: String(r?.id ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: String(r?.at ?? new Date().toISOString()).slice(0, 40),
    title: String(r?.title ?? '').trim().slice(0, 80),
    description: String(r?.description ?? '').trim().slice(0, 1500),
    cols: Math.min(80, Math.max(10, Math.round(Number(r?.cols)) || 40)),
    rows: Math.min(80, Math.max(10, Math.round(Number(r?.rows)) || 30)),
    features: (Array.isArray(r?.features) ? r.features : []).filter((f) => FEATURES.includes(f)),
    status: REQUEST_STATUS.includes(r?.status) ? r.status : 'new'
  })).filter((r) => r.title);
  await writeFile(MAP_REQUESTS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true, requests: list });
}));

app.put('/api/map-maker/feedback', localOnly, asyncRoute(async (req, res) => {
  const clean = {};
  for (const [pic, notes] of Object.entries(req.body && typeof req.body === 'object' ? req.body : {}).slice(0, 100)) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(pic) || !Array.isArray(notes)) continue;
    clean[pic] = notes.slice(0, 60).map((n) => ({
      id: String(n?.id ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      at: String(n?.at ?? new Date().toISOString()).slice(0, 40),
      text: String(n?.text ?? '').trim().slice(0, 1000),
      done: Boolean(n?.done)
    })).filter((n) => n.text);
  }
  await writeFile(MAP_FEEDBACK_FILE, JSON.stringify(clean, null, 2));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- safety tools

app.get('/api/campaigns/:id/safety', asyncRoute(async (req, res) => {
  res.json(await readSafety(path.join(CAMPAIGNS_DIR, safeCampaignId(req.params.id))));
}));

app.put('/api/campaigns/:id/safety', localOnly, asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.params.id);
  if (!id || !(await campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
  res.json(await writeSafety(path.join(CAMPAIGNS_DIR, id), req.body));
}));

// ---------------------------------------------------------------- saved game (board, chat, explored fog)
// The tabletop keeps its board and chat in the browser for speed and mirrors them here, so the game survives clearing the browser
// and can be continued from another computer. data/campaigns/<id>/game.json {savedAt, board, chat}; fog.json {<map url>: png data URL}.

const gamePaths = (id) => ({ game: path.join(CAMPAIGNS_DIR, id, 'game.json'), fog: path.join(CAMPAIGNS_DIR, id, 'fog.json') });
async function readJsonOr(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}
async function gameCampaign(req, res) {
  const id = safeCampaignId(req.params.id);
  if (!id || !(await campaignIds()).includes(id)) { res.status(404).json({ error: 'No such campaign' }); return null; }
  return id;
}

app.get('/api/campaigns/:id/game', asyncRoute(async (req, res) => {
  const id = await gameCampaign(req, res); if (!id) return;
  const p = gamePaths(id);
  const game = await readJsonOr(p.game, null);
  res.json({ savedAt: game?.savedAt || 0, board: game?.board || null, chat: game?.chat || [], fog: await readJsonOr(p.fog, {}) });
}));

app.put('/api/campaigns/:id/game', asyncRoute(async (req, res) => {
  const id = await gameCampaign(req, res); if (!id) return;
  const board = req.body?.board && typeof req.body.board === 'object' && !Array.isArray(req.body.board) ? req.body.board : null;
  if (!board) return res.status(400).json({ error: 'No board to save' });
  const chat = (Array.isArray(req.body?.chat) ? req.body.chat : []).slice(-200);
  const savedAt = Number.isFinite(Number(req.body?.savedAt)) ? Number(req.body.savedAt) : Date.now();
  await writeJsonAtomic(gamePaths(id).game, { savedAt, board, chat });
  res.json({ ok: true, savedAt });
}));

app.put('/api/campaigns/:id/game/fog', asyncRoute(async (req, res) => {
  const id = await gameCampaign(req, res); if (!id) return;
  const mapUrl = String(req.body?.mapUrl ?? '');
  const data = String(req.body?.data ?? '');
  if (!/^\/uploads\/[A-Za-z0-9._-]{1,120}$/.test(mapUrl) || !data.startsWith('data:image/png;base64,') || data.length > 8_000_000) return res.status(400).json({ error: 'Not a fog image' });
  const p = gamePaths(id);
  const fog = await readJsonOr(p.fog, {});
  fog[mapUrl] = data;
  await writeJsonAtomic(p.fog, fog);
  res.json({ ok: true });
}));

// Start a campaign over: forget everything the story has built up. The saved game (board, chat, fog), the journal the DM reads every turn and
// the party's shared stash all go; documents, settings, maps, party and the characters themselves stay.
app.post('/api/campaigns/:id/start-over', localOnly, asyncRoute(async (req, res) => {
  const id = await gameCampaign(req, res); if (!id) return;
  const dir = path.join(CAMPAIGNS_DIR, id);
  await replaceEntries(dir, []);
  await writeStash(dir, {});
  for (const f of Object.values(gamePaths(id))) { try { await unlink(f); } catch { /* nothing saved */ } }
  res.json({ ok: true });
}));

// Forget the saved game of a campaign.
app.delete('/api/campaigns/:id/game', asyncRoute(async (req, res) => {
  const id = await gameCampaign(req, res); if (!id) return;
  const p = gamePaths(id);
  for (const f of [p.game, p.fog]) { try { await unlink(f); } catch { /* nothing saved */ } }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- table settings

// The Test Lab starts the tavern scenario with its four characters back at their starting kit and full hit points.
app.post('/api/test-lab/reset-party', localOnly, asyncRoute(async (_req, res) => {
  const party = await writeTavernParty(CHAR_DIR, { keepHp: false });
  res.json({ ok: true, party: party.map((c) => ({ id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp })) });
}));

// Real dice, for the tabletop's Roll for me button (free: no AI call).
app.post('/api/roll', (req, res) => {
  try {
    const mode = ['advantage', 'disadvantage'].includes(req.body?.mode) ? req.body.mode : 'normal';
    res.json(rollExpr(req.body?.expr ?? 'd20', mode));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/campaigns/:id/settings', asyncRoute(async (req, res) => {
  res.json(await readSettings(path.join(CAMPAIGNS_DIR, safeCampaignId(req.params.id))));
}));

app.put('/api/campaigns/:id/settings', localOnly, asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.params.id);
  if (!id || !(await campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
  res.json(await writeSettings(path.join(CAMPAIGNS_DIR, id), req.body));
}));

// ---------------------------------------------------------------- journal / save file API

const campaignDir = (id) => {
  const cid = safeCampaignId(id);
  if (!cid) throw Object.assign(new Error('Invalid campaign'), { status: 400 });
  return path.join(CAMPAIGNS_DIR, cid);
};

app.get('/api/campaigns/:id/journal', asyncRoute(async (req, res) => {
  res.json(await readSave(campaignDir(req.params.id)));
}));

// Replace the journal: deleting one entry, importing a save, or starting over (an empty list).
app.put('/api/campaigns/:id/journal', localOnly, asyncRoute(async (req, res) => {
  const entries = await replaceEntries(campaignDir(req.params.id), req.body?.entries);
  res.json({ ok: true, count: entries.length });
}));

const RECAP_SYSTEM = `You are the Dungeon Master of a Dungeons & Dragons game, opening a new session. Write a "Previously on..." recap for the players from the journal you are given: 2 to 4 short paragraphs, spoken aloud, vivid but brief, in order, covering what the party did, who they met, what is unresolved, and the promises they made. End with where they stand now and a line that invites them to continue. Use only what the journal says; do not invent events or reveal secrets. Plain text only, no lists or headings.`;

app.post('/api/recap', asyncRoute(async (_req, res) => {
  const id = await getActiveCampaignId();
  const text = journalForPrompt((await readSave(campaignDir(id))).entries);
  if (!text) {
    const narrative = 'There is nothing to recap yet: the journal is empty. Play a little and the Dungeon Master will start writing it.';
    return res.json({ narrative, voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }], empty: true });
  }
  if (!anthropic) return res.status(503).json({ error: 'The AI Dungeon Master is offline: no ANTHROPIC_API_KEY is configured.' });
  try {
    const response = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: RECAP_SYSTEM, messages: [{ role: 'user', content: `JOURNAL:\n${text}` }] });
    const block = response.content.find((b) => b.type === 'text');
    const narrative = String(block?.text ?? '').trim();
    if (!narrative) throw new Error('The recap came back empty.');
    res.json({ narrative, voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }] });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `AI DM error: ${err.message}` });
    throw err;
  }
}));

// ---------------------------------------------------------------- campaign selector API

app.get('/api/campaigns', asyncRoute(async (_req, res) => {
  const active = await chosenCampaignId();
  const campaigns = [];
  for (const id of await campaignIds()) {
    const meta = await readCampaignMeta(id);
    const files = await campaignFiles(id);
    const totalChars = files.reduce((n, f) => n + f.chars, 0);
    let voiceCount = 0;
    try { voiceCount = Object.keys(await loadCharacterVoices(id)).length; } catch { /* none */ }
    campaigns.push({
      party: (await listCharacters(id)).map((ch) => ({ id: ch.id, name: ch.name, class: ch.class, level: ch.level, color: ch.color, image: ch.image || '' })),
      id, template: meta.template || id, name: meta.name, system: meta.system, levels: meta.levels, description: meta.description, test: Boolean(meta.test),
      active: id === active,
      files: files.map((f) => ({ name: f.name, chars: f.chars })),
      totalChars, approxTokens: Math.round(totalChars / 4), voiceCount
    });
  }
  let returnTo = '';
  try { returnTo = safeCampaignId(JSON.parse(await readFile(ACTIVE_CAMPAIGN_FILE, 'utf8')).returnTo); } catch { /* none */ }
  res.json({ active, returnTo: returnTo && returnTo !== active ? returnTo : '', campaigns });
}));

// The party of a campaign (character ids), read and changed from the Campaigns page.
app.get('/api/campaigns/:id/party', asyncRoute(async (req, res) => {
  res.json({ party: (await listCharacters(safeCampaignId(req.params.id))).map((c) => c.id) });
}));

app.put('/api/campaigns/:id/party', localOnly, asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.params.id);
  if (!id || !(await campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
  const known = new Set((await listCharacters()).map((c) => c.id));
  const party = (Array.isArray(req.body?.party) ? req.body.party : []).map((x) => String(x)).filter((x) => known.has(x));
  if (!party.length) return res.status(400).json({ error: 'A campaign needs at least one character.' });
  let saved = {};
  try { saved = JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, id, 'campaign.json'), 'utf8')); } catch { /* built-in campaigns have no campaign.json yet */ }
  await writeFile(path.join(CAMPAIGNS_DIR, id, 'campaign.json'), JSON.stringify({ ...saved, party }, null, 2));
  res.json({ ok: true, party });
}));

// Start another playthrough of a campaign: copies its documents, voices and maps list (so the maps and their starting positions are already chosen) and takes the party and table settings from the request; its journal, party stash and chat start empty.
app.post('/api/campaigns/new', localOnly, asyncRoute(async (req, res) => {
  const from = safeCampaignId(req.body?.template);
  const ids = await campaignIds();
  if (!from || !ids.includes(from)) return res.status(404).json({ error: 'No such campaign to copy' });
  const root = await templateOfCampaign(from);
  const base = await readCampaignMeta(root);
  const name = String(req.body?.name ?? '').trim().slice(0, 80) || `${base.name} (new)`;
  let id = safeCampaignId(name.replace(/\s+/g, '-')) || safeCampaignId(root + '-new');
  for (let n = 2; ids.includes(id); n++) id = safeCampaignId(`${id.replace(/-\d+$/, '')}-${n}`);
  const src = path.join(CAMPAIGNS_DIR, root), dest = path.join(CAMPAIGNS_DIR, id);
  await mkdir(dest, { recursive: true });
  for (const f of await readdir(src)) {
    if (/\.(md|txt)$/i.test(f) || ['voices.json', 'maps.json'].includes(f)) await copyFile(path.join(src, f), path.join(dest, f));
  }
  const known = new Set((await listCharacters()).map((c) => c.id));
  const party = (Array.isArray(req.body?.party) ? req.body.party : []).map((x) => String(x)).filter((x) => known.has(x));
  if (!party.length) { await rm(dest, { recursive: true, force: true }); return res.status(400).json({ error: 'Pick at least one character for the party (make new ones on the Character Sheets page first).' }); }
  await writeFile(path.join(dest, 'campaign.json'), JSON.stringify({ name, template: root, system: base.system, levels: base.levels, description: base.description, party }, null, 2));
  await writeSettings(dest, req.body?.settings);
  res.json({ ok: true, id, name, template: root, party });
}));

app.post('/api/campaigns/active', localOnly, asyncRoute(async (req, res) => {
  const id = safeCampaignId(req.body?.id);
  if (!id || !(await campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
  // returnTo: the campaign to go back to after a side trip (the Test Lab remembers the one you were playing). Switching normally forgets it.
  const asked = safeCampaignId(req.body?.returnTo);
  const returnTo = asked && asked !== id && (await campaignIds()).includes(asked) ? asked : '';
  await writeFile(ACTIVE_CAMPAIGN_FILE, JSON.stringify(returnTo ? { id, returnTo } : { id }, null, 2));
  res.json({ ok: true, active: id, returnTo });
}));

function campaignFilePath(id, name) {
  const cid = safeCampaignId(id);
  if (!cid || !CAMPAIGN_FILE_RE.test(String(name ?? ''))) throw Object.assign(new Error('Invalid campaign or file name'), { status: 400 });
  return path.join(CAMPAIGNS_DIR, cid, path.basename(String(name)));
}

app.get('/api/campaigns/:id/files/:name', asyncRoute(async (req, res) => {
  try {
    const text = await readFile(campaignFilePath(req.params.id, req.params.name), 'utf8');
    res.json({ name: req.params.name, chars: text.length, text: text.slice(0, 200000) });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    throw err;
  }
}));

app.put('/api/campaigns/:id/files/:name', localOnly, asyncRoute(async (req, res) => {
  const text = String(req.body?.text ?? '');
  if (!text.trim()) return res.status(400).json({ error: 'text is required' });
  if (text.length > 3_000_000) return res.status(413).json({ error: 'File is too large (3 million characters at most)' });
  const file = campaignFilePath(req.params.id, req.params.name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  res.json({ ok: true, chars: text.trim().length });
}));

app.delete('/api/campaigns/:id/files/:name', localOnly, asyncRoute(async (req, res) => {
  try {
    await unlink(campaignFilePath(req.params.id, req.params.name));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    throw err;
  }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- cloud voices (OpenAI text-to-speech)

let OPENAI_KEY = process.env.OPENAI_API_KEY || '';
let TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';

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

// The active campaign's named-character voices. The first campaign is seeded with the Phandelver cast.
async function loadCharacterVoices(id = null) {
  const campaignId = id || await getActiveCampaignId();
  const file = path.join(CAMPAIGNS_DIR, campaignId, 'voices.json');
  const fallback = campaignId === DEFAULT_CAMPAIGN_ID ? DEFAULT_CHARACTER_VOICES : campaignId === TEST_CAMPAIGN_ID ? TEST_CAMPAIGN_VOICES : {};
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
// ---------------------------------------------------------------- campaigns

const BUILT_IN_CAMPAIGNS = {
  [DEFAULT_CAMPAIGN_ID]: {
    name: 'Lost Mine of Phandelver',
    system: 'D&D 5th Edition',
    levels: '1-5',
    description: 'The classic starter adventure. Gundren Rockseeker has vanished on the road to Phandalin, and the party is drawn into a hunt for the lost Wave Echo Cave and its Forge of Spells.'
  }
};
BUILT_IN_CAMPAIGNS[TEST_CAMPAIGN_ID] = {
  name: 'The Rusty Flagon: Tavern Brawl',
  system: 'D&D 5th Edition',
  levels: '3',
  test: true,
  description: 'A short test scenario for the table: a tavern full of NPCs where a brawl can break out. It exercises social interaction, exploration and combat so you can see what the AI Dungeon Master allows. Set it up from the Test Lab page.'
};
const TEST_CAMPAIGN_VOICES = {
  'Marta Ironbrew': { voice: 'nova', style: 'A broad, sharp-eyed halfling innkeeper in her fifties. Warm, brisk and funny, with a no-nonsense edge when her furniture is at risk.' },
  'Bruno': { voice: 'onyx', style: 'A huge, calm bouncer. Slow, deep and patient, like a man who hates raising his voice and always wins anyway.' },
  'Gruk Tannerson': { voice: 'ash', style: 'A loud, scarred sellsword three drinks in. Boastful and gravelly, quick to take offence, laughing at his own jokes.' },
  'Dagger Dan': { voice: 'echo', style: 'A grinning, sly hanger-on. Quick, smug and sneering, always backing his boss.' },
  'Skinny Jo': { voice: 'verse', style: 'A nervous, eager hanger-on. High, quick and jumpy, laughing too soon.' },
  'Odo Pennywhistle': { voice: 'fable', style: 'A cheerful, slightly drunk regular. Warm and rambling, delighted by gossip.' },
  'Pell Brightwater': { voice: 'alloy', style: 'A cheerful, slightly drunk regular. Friendly and slurry, ready to throw a mug for the fun of it.' },
  'Nim': { voice: 'ballad', style: 'A thin, nervous spy in a gray cloak. Quiet, hurried and wary, glancing at the door between phrases.' }
};

// Make sure the built-in test campaign exists and has its text. Existing files are never overwritten, so edits stay.
{
  const dir = path.join(CAMPAIGNS_DIR, TEST_CAMPAIGN_ID);
  await mkdir(dir, { recursive: true });
  try {
    const seed = await readFile(path.join(PUBLIC_DIR, 'scenarios', 'rusty-flagon-campaign.md'), 'utf8');
    try { await stat(path.join(dir, '01-the-rusty-flagon.md')); } catch { await writeFile(path.join(dir, '01-the-rusty-flagon.md'), seed); }
  } catch { /* the seed file is optional */ }
}
const safeCampaignId = (id) => String(id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
const CAMPAIGN_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(md|txt)$/i;

async function campaignIds() {
  const entries = await readdir(CAMPAIGNS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function readCampaignMeta(id) {
  const base = BUILT_IN_CAMPAIGNS[id] || { name: id.replace(/-/g, ' '), system: 'D&D 5th Edition', levels: '', description: '' };
  try {
    const saved = JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, id, 'campaign.json'), 'utf8'));
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

// A campaign made from another ("New campaign" on the Campaigns page) remembers which one in campaign.json `template`; it shares that one's maps list, party and starting scene.
async function templateOfCampaign(id) {
  try { return safeCampaignId((await readCampaignMeta(safeCampaignId(id))).template) || safeCampaignId(id); } catch { return safeCampaignId(id); }
}

async function campaignFiles(id) {
  const dir = path.join(CAMPAIGNS_DIR, id);
  let names;
  try { names = (await readdir(dir)).filter((f) => /\.(txt|md)$/i.test(f)).sort(); } catch { return []; }
  const files = [];
  for (const name of names) {
    const [text, st] = await Promise.all([readFile(path.join(dir, name), 'utf8'), stat(path.join(dir, name))]);
    files.push({ name, chars: text.trim().length, size: st.size, mtimeMs: st.mtimeMs, text });
  }
  return files;
}

// The campaign the player has actually chosen (Continue on the Campaigns page), or '' when none is chosen yet. getActiveCampaignId() below
// falls back to Lost Mine for the parts of the server that always need some campaign.
async function chosenCampaignId() {
  try {
    const saved = safeCampaignId(JSON.parse(await readFile(ACTIVE_CAMPAIGN_FILE, 'utf8')).id);
    if ((await campaignIds()).includes(saved)) return saved;
  } catch { /* nothing chosen yet */ }
  return '';
}

async function getActiveCampaignId() {
  const ids = await campaignIds();
  try {
    const saved = safeCampaignId(JSON.parse(await readFile(ACTIVE_CAMPAIGN_FILE, 'utf8')).id);
    if (ids.includes(saved)) return saved;
  } catch { /* nothing chosen yet */ }
  return ids.includes(DEFAULT_CAMPAIGN_ID) ? DEFAULT_CAMPAIGN_ID : (ids[0] || DEFAULT_CAMPAIGN_ID);
}

// The text the DM is given for a campaign, cached until a file in the folder changes.
const campaignTextCache = new Map();
async function loadCampaignText(id) {
  const files = await campaignFiles(id);
  const sig = files.map((f) => `${f.name}:${f.size}:${f.mtimeMs}`).join('|');
  const hit = campaignTextCache.get(id);
  if (hit && hit.sig === sig) return hit.text;
  const parts = [];
  for (const f of files) {
    const text = f.text.trim();
    if (text) parts.push(`##### CAMPAIGN DOCUMENT: ${f.name} #####\n${text}`);
  }
  const text = parts.join('\n\n');
  campaignTextCache.set(id, { sig, text });
  return text;
}
{
  const id = await getActiveCampaignId();
  const text = await loadCampaignText(id);
  console.log(text ? `Active campaign: ${id} (~${Math.round(text.length / 4000)}k tokens of reference text)` : `Active campaign: ${id} (no campaign text yet, the DM runs without a module)`);
}

// ---------------------------------------------------------------- AI DM

let anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const DM_SYSTEM = `You are the Dungeon Master for a Dungeons & Dragons 5th Edition game running on a virtual tabletop.
You are the authority on rules, narrative, and the world. Narrate vividly but concisely (1-3 short paragraphs), adjudicate the players' declared actions using 5e rules, roll dice yourself when needed and show the results (e.g. "Attack: d20+5 = 17 vs AC 13 - hit"), and end by prompting the active player.

The board is a square grid; each square is 5 ft. Positions are given as integer (col,row), origin top-left. Walls are line segments in pixel coordinates where one square = gridSize pixels.
Maps of kind "regional" (a Sword Coast map) and "town" (Phandalin) are just pictures: the party's tokens are not shown on it, there is no fog and no movement limit, so do not use moveToken or addToken there. Describe the journey or the scene instead of counting squares, and use changeMap when the party reaches a place that has its own map.
If the board state has moveCorrections, they are moves you asked for earlier that the table could not do exactly (a wall or the token's speed stopped it): the token ended where the note says. Keep your narration consistent with where it really is.
Respect each token's remaining movement (movementRemaining, in feet) and the walls. The table's movementRule says how diagonals are counted: "standard" (every square costs 5 ft, diagonals too), "alternating" (diagonals cost 5 ft, then 10 ft, then 5 ft...) or "circle" (straight-line distance, so a diagonal step costs about 7 ft). Use that rule when you judge a move.

The rolls list: every die roll that decides something goes in rolls, one short line each, in the order they happened, so the table can show them in the chat before your narration. That includes attack rolls, damage, saving throws, ability checks and skill checks, initiative, death saving throws, and the numbers the players tell you they rolled (mark those "(player rolled)"). Format: who, what, the die with its value, the modifier, the total, and what it was against and the result, for example "Goblin 1 attack: d20 (14) + 4 = 18 vs AC 16, hit", "Edric damage: 1d8 (6) + 5 = 11", "Shadowheart Wisdom save: d20 (7) + 4 = 11 vs DC 13, fail", "Edric initiative (player rolled): 15 + 2 = 17". Use an empty list when nothing was rolled. Do not repeat the dice math in the narrative; describe what happened.

Return mechanical changes in mapUpdates:
- token: change a token on the board. Every token update has all its fields: set the ones the action does not use to "", 0 or false (and kind to "creature"). action "move": move an existing token (tokenId, col, row). action "add": place an NPC or monster (tokenId as a new unique id, name, col, row, color as #rrggbb, hidden, kind). Set hidden to true for anything the players must not see yet: a creature that is hiding, invisible or lying in ambush, and every trap or hazard that has not been discovered. Use kind "trap" for a trap or hazard. action "remove": remove a token (tokenId), e.g. a defeated monster. action "reveal": make a hidden token visible (tokenId) once it is found, triggered, or acts, for example a trap that goes off or a hiding creature that attacks. action "hide": hide a token again (tokenId), for example a creature that turns invisible or slips into hiding. action "damage" or "heal": change a creature's or character's hit points by value (tokenId). action "initiative": set a token's initiative to value (tokenId). action "startCombat" or "endCombat": begin or finish combat on the table's combat tracker. action "mood": change the background mood of the table's music (condition one of calm, tense, eerie, triumph; combat starts by itself with the combat tracker): use it for a stretch of the story, such as tense when something is wrong or eerie in a haunted place, and calm to return to normal. action "sfx": play a sound effect once (condition one of door, creak, thunder, bell, roar, howl, clash, magic, explosion, splash), for a dramatic moment. Use both sparingly. action "summon": a character conjures something it controls: tokenId is a new unique id, condition is mage-hand or spiritual-weapon, name is the token id of the character who cast it, and col and row are where it appears (next to the caster is fine). The table moves it on its caster's turn within the spell's range and removes it when it expires, so do not move it yourself. action "light": a token lights or puts out a light it carries (tokenId, condition one of torch, lantern, candle, light, or none to put it out), or one of the map's own light sources is lit or put out (tokenId is the light's id from the lighting block, value 1 for lit, 0 for out). action "rest": the party finishes a rest, value 1 for a short rest or 2 for a long rest (a long rest restores every character's hit points and spell slots and clears lasting effects: send it only once the rest has actually been completed, not if it was interrupted). When the party makes camp, change the map to the campsite (camp-day, or camp-night after dark) if the maps list has one. For action "add", monster is the SRD index of the creature (lowercase with hyphens, for example "goblin" or "adult-red-dragon"): the table then fills in its hit points, Armor Class and speed from the SRD stat block, so leave value and ac as 0. For a creature that is not in the SRD (an adventure's named villain, a custom monster) leave monster as "" and give its hit points in value and its Armor Class in ac. action "addCondition" or "removeCondition": put a condition or lasting effect on a token, or take it off (tokenId, condition, rounds). Use the 5e condition names in lowercase (blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion), or concentrating, or a short name for a spell effect such as bless. rounds is how many rounds it lasts (0 means until you remove it; it is ignored for removeCondition). Each token in the board state lists its conditions: apply their rules when you adjudicate, and keep them in step with the story. On the table a blinded or unconscious character sees only their own square, and an invisible creature is not shown to the party. Add a condition when something imposes it, remove it when it ends, and do not announce conditions on tokens the party cannot see.
- changeMap: move the whole table to another place (mapId from the maps list in the board state, arrive: one of that map's arrivalSpots (arrivalNotes says what some of them are), or "default", and a short reason). The party's tokens are moved to the arrival spot, and the creatures of the scene you are leaving are put away until you return. Put changeMap first in the list, then add the creatures of the new scene with addToken (hidden ones with hidden true).
- updateCharacter: change a player character's sheet. Always send characterId, a short reason, and edits, a list of { field, value }. field is one of: classLevel (the whole text, for example "Fighter 4" or "Fighter 3 / Rogue 1"), xpGain (experience points to add), maxHp, hp, tempHp, ac, speed, str, dex, con, int, wis, cha (numbers, as text), or an official sheet field name such as Equipment, "Features and Traits", ProficienciesLang, AttacksSpellcasting, CP, SP, EP, GP, PP, HDTotal, HD, XP, Inspiration. A skill is set with field "skill <name>" (for example "skill Stealth") and value none, proficient or expertise. Saving throw proficiency uses field "save <ability>" (for example "save dex") and value proficient or none. A spell is added with field "spell add <level>" and removed with "spell remove <level>", the value being the spell name (level 0 for cantrips). The total spell slots of a level use field "slots <level>" and the number as value. You cannot change a character's name. The sheet works out modifiers, proficiency bonus and passive Perception for you, so do not send those.
- setHp: set a player character's current HP (characterId, hp).
- addWall: add a wall or door (x1, y1, x2, y2 in pixels, wallType "wall" or "door").
- gear: change items, coins and attunement. See Gear.
- journal: write something into the campaign journal (category, title, text, status, when). See Keeping the journal.
Only include updates that actually happened. Use an empty array when nothing changes on the board.

Changing maps: the board state lists the maps you can use (maps) and the one in use (currentMap). When the party travels or enters a place that has its own map, change to it: a regional map for travel between places, a town map for scenes in a town, a battle map for an encounter or a dungeon. When they say they head to a place (for example "we go to town"), use changeMap to the matching map, then narrate the arrival. Do not change maps for a short walk inside the same place, and do not invent map ids. Going back to a map you left restores its creatures, so you do not need to place them again.

Combat: the table has a combat tracker (the combat block of the board state: active, round, whose turn, the order and each token's initiative, hit points and Armor Class). When a fight breaks out, send token startCombat; the table rolls initiative for the creatures, and for the players too when diceMode is "ai" (it prints each roll in the chat). When diceMode is "player" the players give their own: send an initiative update for the number they tell you, or roll it for them from the dice tray if they say "roll for me". You may instead send initiative updates with values you rolled yourself. Run the fight turn by turn: on each turn resolve the active token's action, using the board's hit points and Armor Class, and send damage or heal updates for every change in hit points (monsters at 0 hit points are defeated; a player character at 0 falls unconscious and makes death saves). Add the creatures of an encounter with action add and their SRD index so the tracker has real numbers. Send endCombat when the fight is over, then award experience. Do not announce hit points of creatures the players have not seen.

Who puts what on the map: you place every enemy, monster and NPC token (action add, with the SRD monster index when there is one) before or as a fight starts, and you move and play them all; the players never add creatures themselves. When a character casts Spiritual Weapon or Mage Hand (or the like), place it with token action summon next to the caster at once: after that the PLAYER moves it on their own turn (within its speed and its leash), and you only describe what it does and resolve its attacks when they use it.

Split party: when part of the group goes somewhere else (one stays at the inn while the others go out, someone scouts ahead, a character is captured), send token action away for that character with a short note in condition ("outside the tavern", "scouting the north road"); the board then shows only who is with this map and lists the others as elsewhere. When they rejoin, send token action here. Run the scenes of each place in turn, keep track of who is where in your narration and the journal, and when you move the whole party with changeMap, the ones marked away stay where they are. Outside combat there are no turns: the players move their characters freely and say what they do, and you narrate. Only when combat starts does the turn order apply. You keep track of whose turn it is (the combat block of the board state tells you), and there is no End Turn button: the player tells you when they are done.

Ending turns: a player's turn belongs to the player. After you resolve what a player character does, say what they still have (movement, a bonus action, an object interaction, a reaction) and ask whether they want to do anything else, then WAIT. Never end a player's turn for them, never move on to the next combatant, and never narrate what monsters do next until the player has said they are done (they say so in the chat, or press End Turn, which sends the message "<name> ends their turn."). If the player says they end their turn in the chat and combat.currentTokenId is still that character, send token action endTurn with that tokenId to advance the tracker; if currentTokenId has already moved on (the button was used), do not send it. When it is a creature's turn (combat.currentTokenId is a monster or NPC), play that creature's whole turn, roll its dice from the tray, then send endTurn with the creature's tokenId; keep going through creatures one after another until the active token is a player character, then stop, give the status recap, suggest two to four options for that character, and wait. Only play the turn of the active token: never skip ahead past a player character.

Dice: you cannot generate random numbers yourself, so the board state carries a diceTray: lists of real pre-rolled dice (d4, d6, d8, d10, d12, d20, d100). Whenever YOU roll, take the next unused numbers from the matching list, in order, starting at the front of each list, never skip to a number you like, and add the modifiers yourself. Use a fresh d20 for each check, attack or save (take two for advantage or disadvantage). Always show the die and the modifier, for example "d20 (14) + 5 = 19". Never invent a roll. The board state's diceMode is "ai" or "player". In "ai" mode you roll everything, including the players' dice. In "player" mode the players roll their own d20s (attacks, ability checks, saving throws, death saves, initiative): ask for the roll, say what is being rolled, the bonus to add and what it decides, then STOP and wait for their answer; do not roll it for them and do not continue the scene until they reply. In either mode a player may simply tell you what they rolled ("I got a 14", "nat 20"): take their number and add the modifier. A player may also say "roll for me" (or "you roll"): then roll it from the tray, show the die, and carry on. Damage dice work the same way: in "player" mode ask which they prefer if it is unclear, but default to rolling damage for them from the tray. Everything monsters do is always rolled by you.

Lighting: the lighting block of the board state gives the place's ambient light (bright, dim or dark) and the map's light sources (id, name, position, bright and dim radius in feet, whether it is on); tokens may carry a light (lightKind). The table shows each player only what their character can see: in bright or dim light, anything in line of sight; in darkness, only what a light source lights (bright light out to the bright radius, dim light out to the dim radius) or what their darkvision reaches (darkvision turns darkness into dim light, out to its range; a character with no darkvision sees nothing in the dark beyond a light). Your narration must match: when a fire goes out or a torch is doused, send a light update, and describe what the characters can and cannot see. Creatures in unlit darkness are not visible to characters without darkvision. A character carrying a light can be seen from afar in the dark.

Resting follows the official 5th Edition rules. A short rest is at least an hour: characters may spend Hit Dice to heal (each die rolled plus the Constitution modifier; apply it with heal updates), and some class features come back. A long rest is at least eight hours (no more than two hours of light activity): characters regain all their hit points and spell slots, regain spent Hit Dice up to half their total (at least one), and have their exhaustion reduced by one level; a character can benefit from only one long rest in 24 hours and must start it with at least 1 hit point. Two short rests per adventuring day is a pacing guideline, not a rule. When a rest is completed without interruption, send token action rest (value 1 short, 2 long): for a long rest the table restores hit points and spell slots, and you handle Hit Dice, exhaustion, class features and anything else in your narration and with updates. An interrupted rest gets no benefit. Food and water: a character needs about a pound of food and a gallon of water a day, and going without can cause exhaustion, so ask about supplies on a long journey. Track rations as ordinary gear items.

Gear: every player character carries an inventory (items with a quantity, a weight in pounds, whether the item needs attunement, whether they are attuned, and effects), coins (cp, sp, ep, gp, pp), and the party also has a shared stash. The party block of the board state lists them, with each character's effective stats: the sheet's numbers plus what attuned and worn items change. Use the effective AC, saving-throw bonus, speed and ability scores for your rolls and rulings. Keep gear up to date as play happens with gear updates. Every gear update has all its fields: set the ones the action does not use to "", 0, false or "none". action "add": target is a characterId or "stash", name, qty, weight (pounds, from the 5e rules), requiresAttunement for magic items that need it, and optionally one effect: effectKind "ac" (a bonus to Armor Class), "save" (a bonus to all saving throws), "speed" (feet) or "abilityMin" (the ability is raised to at least effectValue, with effectAbility str, dex, con, int, wis or cha, for example Gauntlets of Ogre Power), with effectValue its size; effectKind "none" for plain gear. action "remove": target, name, qty. action "move": target is where it comes from, to is where it goes (each a characterId or "stash"), name, qty. action "attune" or "unattune": target is the characterId, name is the item. action "coins": target, and the change in each coin (positive to gain, negative to spend, 0 for none). A character can be attuned to at most three items, and attuning takes a short rest of focus, so do not attune an item in the middle of a fight. Mention it when someone is carrying too much.

DM maps: some places come with a DM-only picture of the map (building names, secret rooms, where creatures and traps are), shown to you at the start of the message. It is for you alone: use it to describe and place things accurately, and never read out or hint at anything the players have not discovered.

Beginning the story: a message that contains [BEGIN] means the players pressed "Begin the adventure" before anything has happened. Open the story yourself: start at the first scene of the campaign document (for a published module, its opening scene and hook, assuming the party has already accepted it and is on their way), set the table (send changeMap to the right map if the opening is somewhere else than the one on the table, and place the party with token moves), describe what the characters see, hear and smell in a few vivid sentences, introduce whoever or whatever they meet first, and write the first journal entries (the place, the hook). Do not play out the players' choices or start a fight. End with one clear question for the party. Keep it to a couple of short paragraphs.

Running the table (habits that work well, especially for voice play and a player who is new to the game): before any roll say what is being rolled (for example "Wisdom check, Perception"), the modifier to add, and what the roll decides; if the player has no dice, offer to roll for them. Warn before they commit: flag range problems, advantage and disadvantage and why (for example heavy armor on Stealth, or a target beyond normal range), and explain spells that use a saving throw instead of an attack roll. If a player declares an action without knowing a rule that changes it, let them take it back, kindly. In combat roll initiative for everyone and announce the whole turn order (repeat it when asked), narrate every hit and every miss with a little color, and after each round give a short status recap (everyone's hit points, enemies remaining, who is hurt). At the start of each player turn suggest two to four sensible options, always accepting anything else they come up with, and point out tactical openings (Sneak Attack is available when an ally is next to the target, a captured enemy could answer questions). Players roll for their own characters when the table is in player dice mode; you roll for monsters, honestly, and report the numbers. One character makes a given check; another may only add the Help action if they genuinely add something. Keep replies short and spoken-sounding, with few lists, and end each turn with one clear question such as "What does Edric do?". Do not hand over what an NPC has not been asked yet, keep an accurate count of enemies, and apply every racial and class trait when a character changes. At any choice point in character creation or leveling, list all the available options, never a curated subset.

Safety: the table may have agreed lines (never appear) and veils (off-screen or one sentence), given to you in the TABLE SAFETY block when there is one. Keep to them without ever mentioning that you are doing so. If a player's message contains [PAUSE], they pressed the pause button (the X-card): stop at once, do not continue the scene, do not ask who pressed it or why, say calmly that you are pausing, and offer to skip past it, rewind, or take the story in another direction, then wait for their answer. Never push back or make anyone justify it.

Keeping the journal: the campaign journal is the party's shared memory, and the current journal is given to you below the campaign text. After a turn in which something worth remembering happened, add a journal update: category "event" for what happened (a short title and one or two sentences), "npc" for a person met (title is the name, text says who they are and how they feel about the party), "quest" for a goal (status "open" until finished, then send the same title again with status "done"), "place" for somewhere important, "loot" for treasure or magic items found, "promise" for something the party promised or is owed. Sending an npc, quest, place, loot or promise title that already exists updates that entry instead of adding another. Use when for the in-game time (for example "Day 2, evening") whenever you know it. Write only what the party knows or witnessed, never DM secrets. Do not journal small talk or every combat round, and use no journal update when nothing noteworthy happened. Read the journal before you narrate so that you stay consistent with promises, names and earlier events.

Keeping sheets up to date: apply routine changes from play with updateCharacter as they happen (XP, temporary HP, spell slots used; gear and coins have their own updates, see Gear). Award XP after a fight or goal using the rules and the monsters' XP values, split among the living party, and say what each character gained.

Levelling up is a conversation. When a character has enough XP for the next level (300, 900, 2,700, 6,500, 14,000, 23,000, 34,000, 48,000, 64,000, 85,000 and so on), tell the player and ask what they want. Do not change the sheet until they have answered. List what they gain at that level: hit points (offer the fixed average for the hit die plus Constitution modifier, or a roll), the class features of that level, a subclass at 3 for most classes, new spells or slots for casters, and at levels 4, 8, 12, 16 and 19 a choice between ability score increases and a feat. Ask them to pick (which skills or expertise, which ability scores, which spells, which feat), one short question at a time, then call updateCharacter once with everything they chose (classLevel, maxHp and hp, abilities, skill, spell and slots edits, and an edit to Features and Traits that lists the new features), and summarise what changed. Only use options that exist in 5th edition for their class and level, and say so if a request is not allowed.

Secrets stay secret. Each token in the board state has hidden, kind and visibleToParty. Never mention, name, describe or hint at a token that is hidden or not visibleToParty (a hiding or invisible creature, a trap, an enemy in another room): not in the narrative, not in the voice lines, not in a rules note. An undiscovered trap is not mentioned at all until a character finds it with a check, triggers it, or it is revealed. Narrate only what the characters can perceive from where they stand. When a hidden thing is found or acts, call revealToken and then describe it.

The table plays in voice mode: your reply is read aloud. Split the full reply into voiceLines, in order, so that
the voiceLines texts joined together equal the narrative. Use speaker "Narrator" with voice "narrator" for narration and
rules results; give every NPC or monster line its own entry with the NPC's name as speaker and the voice profile that
fits them best (gruff, sly, noble, elderly, child, monstrous, ethereal, feminine, masculine; beast for a medium animal that has been given speech, such as a wolf or dog, smallbeast for a small one (a bird, rat, cat, squirrel or toad) and largebeast for a large one (a bear, horse, ox or great cat), all with Speak with Animals, and undead for ghosts, skeletons, zombies and the dead who answer through Speak with Dead). Keep the same voice for the
same NPC across turns. Write dice math in a speakable way. When the player's input is marked as spoken, it was
transcribed from speech and may contain recognition errors - interpret it charitably.`;

const CAMPAIGN_RULES = `A campaign module follows. You are running it. Treat it as secret DM material: never read boxed text or stat blocks verbatim unless it is the right moment, never reveal secrets, traps, or monster stats before the players earn them, and keep track of where the party is. Use the module's NPC names, personalities, and locations. The board state tells you which map is loaded (mapName); the players move tokens themselves, so describe what their position can see.`;

// The sheet update arrives as one list of { field, value } edits; skills, saves, spells and slots are written as
// "skill Stealth" / "save dex" / "spell add 2" / "slots 3" and turned back into the lists lib/sheet-edit.js applies.
function expandSheetEdits(u) {
  const rest = [], skills = [], saves = [], spells = [], slots = [];
  for (const e of Array.isArray(u.edits) ? u.edits : []) {
    const field = String(e?.field ?? '').trim();
    const value = String(e?.value ?? '').trim();
    let m;
    if ((m = /^skill\s+(.+)$/i.exec(field))) skills.push({ name: m[1], proficiency: value.toLowerCase() });
    else if ((m = /^save\s+(\w+)$/i.exec(field))) saves.push({ ability: m[1], proficient: /^(proficient|true|yes)$/i.test(value) });
    else if ((m = /^spell\s+(add|remove)\s+(\d+)$/i.exec(field))) spells.push({ level: Number(m[2]), name: value, remove: m[1].toLowerCase() === 'remove' });
    else if ((m = /^slots?\s+(\d+)$/i.exec(field))) slots.push({ level: Number(m[1]), total: Number(value) });
    else rest.push({ field, value });
  }
  return { ...u, edits: rest, skills, saves, spells, slots };
}

// The DM's flat "token" update, turned into the specific board updates the tabletop applies.
async function expandTokenUpdates(updates) {
  const out = [];
  for (const u of updates) {
    if (!u) continue;
    if (u.type !== 'token') { out.push(u); continue; }
    const base = { tokenId: u.tokenId };
    if (u.action === 'move') out.push({ type: 'moveToken', ...base, col: u.col, row: u.row });
    else if (u.action === 'add') {
      // A creature from the SRD brings its real hit points, Armor Class and speed.
      const srd = u.monster ? await getEntry('monsters', String(u.monster).toLowerCase().replace(/[^a-z0-9-]/g, '')) : null;
      const walk = srd ? parseInt(srd.speed?.walk, 10) : NaN;
      out.push({
        type: 'addToken', ...base, name: u.name || srd?.name || 'Creature', col: u.col, row: u.row, color: u.color, hidden: u.hidden, kind: u.kind,
        monster: srd ? srd.index : '', image: srd ? await monsterImage(srd) : '', maxHp: srd ? srd.hit_points : Math.max(0, Number(u.value) || 0), ac: srd ? (srd.armor_class?.[0]?.value ?? 10) : Math.max(0, Number(u.ac) || 0),
        speed: Number.isFinite(walk) ? walk : 30, dexMod: srd ? Math.floor((srd.dexterity - 10) / 2) : 0
      });
    }
    else if (u.action === 'damage') out.push({ type: 'damageToken', ...base, value: u.value });
    else if (u.action === 'heal') out.push({ type: 'healToken', ...base, value: u.value });
    else if (u.action === 'initiative') out.push({ type: 'setInitiative', ...base, value: u.value });
    else if (u.action === 'light') out.push({ type: 'lightToken', tokenId: u.tokenId, kind: String(u.condition ?? '').toLowerCase(), value: u.value });
    else if (u.action === 'mood') out.push({ type: 'setMood', mood: String(u.condition ?? '').toLowerCase() });
    else if (u.action === 'sfx') out.push({ type: 'playSound', sound: String(u.condition ?? '').toLowerCase() });
    else if (u.action === 'summon') out.push({ type: 'summonToken', tokenId: u.tokenId, kind: String(u.condition ?? '').toLowerCase(), ownerId: u.name, col: u.col, row: u.row });
    else if (u.action === 'rest') out.push({ type: 'restParty', kind: Number(u.value) === 2 ? 'long' : 'short' });
    else if (u.action === 'startCombat') out.push({ type: 'startCombat' });
    else if (u.action === 'endCombat') out.push({ type: 'endCombat' });
    else if (u.action === 'endTurn') out.push({ type: 'endTurn', ...base });
    else if (u.action === 'away') out.push({ type: 'setWhere', ...base, where: String(u.condition ?? '').trim() || 'elsewhere' });
    else if (u.action === 'here') out.push({ type: 'setWhere', ...base, where: '' });
    else if (u.action === 'ready') out.push({ type: 'readyToken', ...base, text: String(u.condition ?? '').trim().slice(0, 120) });
    else if (u.action === 'template') out.push({ type: 'template', ...base, shape: String(u.condition ?? '').toLowerCase().trim(), size: u.value, col: u.col, row: u.row, toward: String(u.name ?? '') });
    else if (u.action === 'remove') out.push({ type: 'removeToken', ...base });
    else if (u.action === 'reveal') out.push({ type: 'revealToken', ...base });
    else if (u.action === 'hide') out.push({ type: 'hideToken', ...base });
    else if (u.action === 'addCondition' || u.action === 'removeCondition') out.push({ type: u.action, ...base, condition: u.condition, rounds: u.rounds });
  }
  return out;
}

// The DM's single flat "gear" update, turned into the specific updates lib/party.js applies.
function gearToPartyUpdates(updates) {
  const out = [];
  for (const u of updates) {
    if (!u || u.type !== 'gear') continue;
    if (u.action === 'add') {
      const kind = EFFECT_KINDS.includes(u.effectKind) ? u.effectKind : null;
      out.push({ type: 'addItem', target: u.target, name: u.name, qty: u.qty, weight: u.weight, requiresAttunement: u.requiresAttunement, effects: kind ? [{ kind, value: u.effectValue, ability: u.effectAbility }] : [] });
    } else if (u.action === 'remove') out.push({ type: 'removeItem', target: u.target, name: u.name, qty: u.qty });
    else if (u.action === 'move') out.push({ type: 'moveItem', from: u.target, to: u.to, name: u.name, qty: u.qty });
    else if (u.action === 'attune' || u.action === 'unattune') out.push({ type: u.action === 'attune' ? 'attuneItem' : 'unattuneItem', characterId: u.target, name: u.name });
    else if (u.action === 'coins') out.push({ type: 'adjustCoins', target: u.target, cp: u.cp, sp: u.sp, ep: u.ep, gp: u.gp, pp: u.pp });
  }
  return out;
}

const VOICES = ['narrator', 'gruff', 'sly', 'noble', 'elderly', 'child', 'monstrous', 'ethereal', 'feminine', 'masculine', 'beast', 'smallbeast', 'largebeast', 'undead'];

// The AI's reply format. Each kind of board or sheet update lists exactly its own fields (all required): the API
// limits how many optional fields a schema may have, and this also keeps the AI from sending half-formed updates.
const upd = (types, properties) => ({
  type: 'object',
  properties: { type: { type: 'string', enum: types }, ...properties },
  required: ['type', ...Object.keys(properties)],
  additionalProperties: false
});
const INT = { type: 'integer' };
const STR = { type: 'string' };
const DM_SCHEMA = {
  type: 'object',
  properties: {
    rolls: { type: 'array', items: { type: 'string' } },
    narrative: { type: 'string' },
    mapUpdates: {
      type: 'array',
      items: {
        anyOf: [
          upd(['token'], { action: { type: 'string', enum: ['move', 'add', 'remove', 'reveal', 'hide', 'addCondition', 'removeCondition', 'damage', 'heal', 'initiative', 'startCombat', 'endCombat', 'endTurn', 'away', 'here', 'ready', 'template', 'rest', 'light', 'summon', 'mood', 'sfx'] }, tokenId: STR, name: STR, col: INT, row: INT, color: STR, hidden: { type: 'boolean' }, kind: { type: 'string', enum: ['creature', 'trap'] }, condition: STR, rounds: INT, monster: STR, value: INT, ac: INT }),
          upd(['setHp'], { characterId: STR, hp: INT }),
          upd(['changeMap'], { mapId: STR, arrive: STR, reason: STR }),
          upd(['gear'], { action: { type: 'string', enum: ['add', 'remove', 'move', 'attune', 'unattune', 'coins'] }, target: STR, to: STR, name: STR, qty: INT, weight: INT, requiresAttunement: { type: 'boolean' }, effectKind: { type: 'string', enum: ['none', ...EFFECT_KINDS] }, effectValue: INT, effectAbility: STR, cp: INT, sp: INT, ep: INT, gp: INT, pp: INT }),
          upd(['journal'], { category: { type: 'string', enum: CATEGORIES }, title: STR, text: STR, status: { type: 'string', enum: STATUSES }, when: STR }),
          upd(['addWall'], { x1: INT, y1: INT, x2: INT, y2: INT, wallType: { type: 'string', enum: ['wall', 'door'] } }),
          upd(['updateCharacter'], {
            characterId: STR,
            reason: STR,
            edits: { type: 'array', items: { type: 'object', properties: { field: STR, value: STR }, required: ['field', 'value'], additionalProperties: false } },
          })
        ]
      }
    }
  },
  required: ['rolls', 'narrative', 'voiceLines', 'mapUpdates'],
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

// The DM's own version of a map (labels, secret rooms, hidden creatures and traps marked): data/dm-maps/<picture name>.png|jpg|webp. When the
// current map has one it is shown to the AI with the message; players never see it on the table.
const DM_MAP_DIR = path.join(__dirname, 'data', 'dm-maps');
const DM_MEDIA = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const dmStem = (mapFile) => path.basename(String(mapFile ?? '')).replace(/\.[^.]+$/, '');
async function dmMapFor(mapFile) {
  const stem = dmStem(mapFile);
  if (!/^[\w.-]{1,120}$/.test(stem)) return null;
  for (const [ext, type] of Object.entries(DM_MEDIA)) {
    try { return { file: path.join(DM_MAP_DIR, stem + ext), media_type: type, data: (await readFile(path.join(DM_MAP_DIR, stem + ext))).toString('base64') }; } catch { /* not this type */ }
  }
  return null;
}

app.get('/api/dm-map', asyncRoute(async (req, res) => {
  const dm = await dmMapFor(req.query.map);
  if (!dm) return res.status(404).json({ error: 'No DM map for that picture' });
  res.type(dm.media_type).send(Buffer.from(dm.data, 'base64'));
}));

// Save a DM map picture (a data URL). The Test Lab draws one for the tavern scenario.
app.put('/api/dm-map', localOnly, asyncRoute(async (req, res) => {
  const stem = dmStem(req.query.map);
  if (!/^[\w.-]{1,120}$/.test(stem)) return res.status(400).json({ error: 'Invalid map name' });
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image ?? ''));
  if (!m) return res.status(400).json({ error: 'image must be a png, jpeg or webp data URL' });
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'The picture is over 5 MB' });
  await mkdir(DM_MAP_DIR, { recursive: true });
  for (const ext of Object.keys(DM_MEDIA)) { try { await unlink(path.join(DM_MAP_DIR, stem + ext)); } catch { /* none */ } }
  await writeFile(path.join(DM_MAP_DIR, `${stem}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), bytes);
  res.json({ ok: true, bytes: bytes.length });
}));

function buildHistory(history, message, state, inputMode, dmMap) {
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
  if (dmMap) {
    const final = messages[messages.length - 1];
    final.content = [
      { type: 'text', text: 'DM-ONLY MAP of the current place follows (the players have a plain version without these marks). Use it to know where things are and to answer where things are; never reveal or hint at anything on it that the players have not discovered.' },
      { type: 'image', source: { type: 'base64', media_type: dmMap.media_type, data: dmMap.data } },
      { type: 'text', text: final.content }
    ];
  }
  return messages;
}

// What the DM is told about the party's gear: per character the items, coins and effective stats, and the shared stash.
async function partyForPrompt(campaign) {
  const brief = (i) => ({ name: i.name, qty: i.qty, weight: i.weight, requiresAttunement: i.requiresAttunement, attuned: i.attuned, equipped: i.equipped, effects: i.effects });
  const variant = (await readSettings(path.join(CAMPAIGNS_DIR, campaign))).variantEncumbrance;
  const characters = (await listCharacters(campaign)).map((c) => {
    const s = seedFromSheet(c);
    const eff = computeEffective(s, variant);
    return { id: s.id, name: s.name, inventory: normalizeInventory(s.inventory).map(brief), coins: normalizeCoins(s.coins), effective: { ac: eff.ac, speed: eff.speed, saveBonus: eff.saveBonus, abilities: eff.abilities, attuned: eff.attuned, weight: eff.weight } };
  });
  const stash = await readStash(path.join(CAMPAIGNS_DIR, campaign));
  return { characters, stash: { items: stash.items.map(brief), coins: stash.coins } };
}

app.post('/api/chat', asyncRoute(async (req, res) => {
  const { message, history, activeTokenId, tokens, characters, walls, gridSize, inputMode, mapName, movementRule, mapUrl, combat, diceMode, lighting, corrections } = req.body ?? {};
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

  if (!(await chosenCampaignId())) return res.status(409).json({ error: 'No campaign is selected. Open the Campaigns page and press Continue on one.' });
  const activeCampaign = await getActiveCampaignId();
  const availableMaps = await withSavedStarts(await mapsForCampaign(activeCampaign));
  const state = {
    mapName: String(mapName ?? 'blank grid').slice(0, 120),
    movementRule: ['standard', 'alternating', 'circle'].includes(movementRule) ? movementRule : 'standard',
    maps: availableMaps ? mapsForPrompt(availableMaps) : [],
    currentMap: availableMaps?.find((m) => m.url === mapUrl)?.id ?? null,
    activeTokenId: activeTokenId ?? null,
    gridSize: Number(gridSize) || 50,
    tokens: Array.isArray(tokens) ? tokens : [],
    characters: Array.isArray(characters) ? characters : [],
    walls: Array.isArray(walls) ? walls : [],
    diceMode: diceMode === 'player' ? 'player' : 'ai',
    diceTray: diceTray(),
    ...(Array.isArray(corrections) && corrections.length ? { moveCorrections: corrections.slice(0, 8).map((c) => String(c).slice(0, 200)) } : {}),
    lighting: lighting && typeof lighting === 'object' ? { ambient: ['bright', 'dim', 'dark'].includes(lighting.ambient) ? lighting.ambient : 'bright', mapLights: (Array.isArray(lighting.mapLights) ? lighting.mapLights : []).slice(0, 40) } : { ambient: 'bright', mapLights: [] },
    combat: combat && typeof combat === 'object' ? { active: Boolean(combat.active), round: Number(combat.round) || 0, currentTokenId: String(combat.currentTokenId ?? ''), order: (Array.isArray(combat.order) ? combat.order : []).slice(0, 60).map((o) => ({ tokenId: String(o?.tokenId ?? ''), initiative: Number.isFinite(Number(o?.initiative)) ? Number(o.initiative) : null })) } : { active: false },
    party: await partyForPrompt(activeCampaign)
  };

  try {
    const campaignText = await loadCampaignText(activeCampaign);
    const settingsText = settingsForPrompt(await readSettings(path.join(CAMPAIGNS_DIR, activeCampaign)));
    const safetyText = safetyForPrompt(await readSafety(path.join(CAMPAIGNS_DIR, activeCampaign)));
    const journalText = journalForPrompt((await readSave(path.join(CAMPAIGNS_DIR, activeCampaign))).entries);
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        { type: 'text', text: DM_SYSTEM },
        ...(campaignText ? [{ type: 'text', text: `${CAMPAIGN_RULES}\n\n${campaignText}`, cache_control: { type: 'ephemeral' } }] : []),
        // The journal changes every few turns, so it comes after the cached campaign text.
        { type: 'text', text: journalText ? `CAMPAIGN JOURNAL (what the party has done and learned so far):\n${journalText}` : 'CAMPAIGN JOURNAL: empty so far. This is the start of the adventure.' },
        { type: 'text', text: settingsText },
        ...(safetyText ? [{ type: 'text', text: safetyText }] : [])
      ],
      messages: buildHistory(history, text, state, inputMode, await dmMapFor(mapUrl)),
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
    const rolls = (Array.isArray(parsed.rolls) ? parsed.rolls : []).map((x) => String(x ?? '').trim().slice(0, 200)).filter(Boolean).slice(0, 30);
    const voiceLines = cleanVoiceLines(parsed.voiceLines);
    // Sheet edits are applied and saved here; the table gets the updated characters back to show.
    const allUpdates = await expandTokenUpdates(Array.isArray(parsed.mapUpdates) ? parsed.mapUpdates : []);
    const mapProblems = [];
    const travel = [];
    for (const u of allUpdates.filter((x) => x && x.type === 'changeMap')) {
      const out = resolveChangeMap(availableMaps, u);
      if (out.error) mapProblems.push(out.error); else travel.push(out.update);
    }
    // A map change comes first, so the creatures that follow are placed on the new map.
    const boardUpdates = [...travel.slice(0, 1), ...allUpdates.filter((u) => u && u.type !== 'updateCharacter' && u.type !== 'changeMap' && u.type !== 'journal' && u.type !== 'gear')];
    const restedIds = [];
    const restNotes = [];
    for (const u of allUpdates.filter((x) => x && x.type === 'restParty')) {
      const out = await restParty(u.kind);
      restedIds.push(...out.rested);
      restNotes.push(u.kind === 'long' ? 'Long rest: hit points and spell slots restored' : 'Short rest');
    }
    const partyResult = await processPartyUpdates(gearToPartyUpdates(allUpdates), {
      list: () => listCharacters(activeCampaign),
      save: async (c) => { const clean = normalizeCharacter(c); await saveCharacter(clean); return clean; },
      stash: () => readStash(path.join(CAMPAIGNS_DIR, activeCampaign)),
      saveStash: (st) => writeStash(path.join(CAMPAIGNS_DIR, activeCampaign), st)
    }).catch((err) => { console.warn('Party update failed:', err.message); return { notes: [], problems: ['The DM tried to change the party\'s gear, but it could not be saved.'], changed: [] }; });
    const journalAdded = await addJournalUpdates(path.join(CAMPAIGNS_DIR, activeCampaign), allUpdates.filter((u) => u && u.type === 'journal'))
      .catch((err) => { console.warn('Journal update failed:', err.message); return []; });
    const sheetResults = await processCharacterUpdates(allUpdates.filter((u) => u && u.type === 'updateCharacter').map(expandSheetEdits), {
      list: () => listCharacters(activeCampaign),
      save: async (c) => { const clean = normalizeCharacter(c); await saveCharacter(clean); return clean; }
    }).catch((err) => { console.warn('Character update failed:', err.message); return { results: [], problems: ['The DM tried to change a character sheet, but it could not be saved.'] }; });
    res.json({
      rolls,
      narrative,
      voiceLines: voiceLines.length ? voiceLines : [{ speaker: 'Narrator', voice: 'narrator', text: narrative }],
      mapUpdates: boardUpdates,
      characterUpdates: sheetResults.results,
      partyNotes: [...partyResult.notes, ...restNotes],
      partyChanged: [...new Set([...partyResult.changed, ...restedIds])],
      journalAdded: journalAdded.map((e) => ({ category: e.category, title: e.title })),
      characterProblems: [...mapProblems, ...sheetResults.problems, ...partyResult.problems]
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
  if (!loopback || !hostOk || !originOk) return res.status(403).json({ error: 'This can only be done from this computer.' });
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
