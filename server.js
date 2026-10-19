import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { mkdir, readdir, readFile, writeFile, unlink, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SKILLS, SAVES } from './lib/sheet-edit.js';
import { migrateCharacterIds, readAliases, canonicalId, newCharacterId } from './lib/character-ids.js';
import './public/js/token-size.js';                       // sets globalThis.TokenSize (sizes, footprints, falls, flying speeds)
import { buildQuickCharacter, quickChoices } from './lib/quick-character.js';
import { createStore as createCreatureVoiceStore } from './lib/creature-voices.js';
import { createUsageTracker } from './lib/usage.js';
import { readSettings } from './lib/settings.js';
import { seedFromSheet, normalizeInventory, normalizeCoins, computeEffective } from './lib/party.js';
import { liveMiddleware } from './lib/live.js';
import { normalizeTrack } from './lib/rules-track.js';
import { createPlayLog } from './lib/playlog.js';
import { registerUploads } from './routes/uploads.js';
import { registerCompendium } from './routes/compendium.js';
import { registerSoundTakes } from './routes/sound.js';
import { registerSoundNotes } from './routes/sound-notes.js';
import { registerMapMaker } from './routes/map-maker.js';
import { registerSafety } from './routes/safety.js';
import { registerSavedGame } from './routes/saved-game.js';
import { registerTableSettings } from './routes/table-settings.js';
import { registerJournal } from './routes/journal.js';
import { registerCampaignSelector } from './routes/campaign-selector.js';
import { registerMarket } from './routes/market.js';
import { registerParty } from './routes/party.js';
import { settings } from './lib/runtime-settings.js';
import { localOnly } from './lib/local-only.js';
import { registerVoices } from './routes/voices.js';
import { registerSettings } from './routes/settings.js';
import { registerAiDm } from './routes/ai-dm.js';
import { CAMPAIGNS_DIR, DEFAULT_CAMPAIGN_ID, TEST_CAMPAIGN_ID, ACTIVE_CAMPAIGN_FILE, TEST_CAMPAIGN_VOICES, safeCampaignId, CAMPAIGN_FILE_RE, campaignIds, readCampaignMeta, templateOfCampaign, campaignFiles, chosenCampaignId, getActiveCampaignId, loadCampaignText } from './lib/campaigns.js';
import { registerMapConfig } from './routes/map-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const CHAR_DIR = path.join(__dirname, 'data', 'characters');
// Character ids are GUIDs (lib/character-ids.js). Older slug ids are migrated once at start-up and kept as aliases. VTT_KEEP_CHARACTER_IDS=1 skips the migration (the test sandbox).
let characterAliases = {};
if (process.env.VTT_KEEP_CHARACTER_IDS !== '1') { try { const moved = migrateCharacterIds(path.join(__dirname, 'data')); if (Object.keys(moved).length) console.log(`Gave ${Object.keys(moved).length} characters GUID ids`); } catch (err) { console.warn('Character id migration failed: ' + err.message); } }
characterAliases = readAliases(path.join(__dirname, 'data'));
const canonId = (id) => canonicalId(characterAliases, String(id ?? ''));
const usageTracker = createUsageTracker(path.join(__dirname, 'data'));
const playLog = createPlayLog(path.join(__dirname, 'data'));
const creatureVoices = createCreatureVoiceStore(path.join(__dirname, 'data'));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TOKEN_DIR = path.join(PUBLIC_DIR, 'tokens');
// Each campaign is a folder in data/campaigns/<id>/ holding its text (*.md / *.txt), campaign.json and voices.json.
const LEGACY_CAMPAIGN_DIR = path.join(__dirname, 'data', 'campaign');
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
  const id = canonId(safeId(body.id)) || newCharacterId();
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
    ...(String(body.armor ?? '').trim() ? { armor: String(body.armor).trim().slice(0, 60) } : {}),
    ...(body.shield === true ? { shield: true } : {}),
    ...(campaigns.length ? { campaigns } : {}),
    ...(body.track && typeof body.track === 'object' ? { track: normalizeTrack(body.track) } : {}),
    ...(Array.isArray(body.inventory) ? { inventory: normalizeInventory(body.inventory) } : {}),
    ...(body.coins && typeof body.coins === 'object' ? { coins: normalizeCoins(body.coins) } : {}),
    ...(expertise.length ? { expertise } : {}),
    ...(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].includes(String(body.size ?? '').toLowerCase()) ? { size: String(body.size).toLowerCase() } : {}),
    ...(String(body.race ?? '').trim() ? { race: String(body.race).trim().slice(0, 40) } : {}),
    ...(String(body.subclass ?? '').trim() ? { subclass: String(body.subclass).trim().slice(0, 60) } : {}),
    ...(Array.isArray(body.feats) && body.feats.length ? { feats: body.feats.map((f) => String(f).slice(0, 60)).slice(0, 20) } : {}),
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

// Written to a temporary file and renamed, so a read that overlaps a save never sees a half-written sheet (it used to skip the character: the party came back one short).
const saveCharacter = async (c) => {
  const file = path.join(CHAR_DIR, `${c.id}.json`), tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2));
  await rename(tmp, file);
};

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
// <deps>
// What the route modules (routes/*.js) reach in this file, by name and read when a route runs (so the order things start in does not change). Maintained as routes are moved out.
const deps = Object.defineProperties({}, {
  __dirname: { get: () => __dirname },
  ACTIVE_CAMPAIGN_FILE: { get: () => ACTIVE_CAMPAIGN_FILE },
  asyncRoute: { get: () => asyncRoute },
  CAMPAIGN_FILE_RE: { get: () => CAMPAIGN_FILE_RE },
  campaignFiles: { get: () => campaignFiles },
  campaignIds: { get: () => campaignIds },
  CAMPAIGNS_DIR: { get: () => CAMPAIGNS_DIR },
  canGoFast: { get: () => canGoFast },
  canonId: { get: () => canonId },
  canSkipThinking: { get: () => canSkipThinking },
  CHAR_DIR: { get: () => CHAR_DIR },
  chosenCampaignId: { get: () => chosenCampaignId },
  chosenVoice: { get: () => chosenVoice },
  creatureVoices: { get: () => creatureVoices },
  currentMapName: { get: () => currentMapName },
  DEFAULT_CAMPAIGN_ID: { get: () => DEFAULT_CAMPAIGN_ID },
  DM_MAP_DIR: { get: () => DM_MAP_DIR },
  dmBuys: { get: () => dmBuys },
  ensureSets: { get: () => ensureSets },
  getActiveCampaignId: { get: () => getActiveCampaignId },
  IMAGE_EXT: { get: () => IMAGE_EXT },
  int: { get: () => int },
  keepJournal: { get: () => keepJournal },
  KNOWN_OPENAI_VOICES: { get: () => KNOWN_OPENAI_VOICES },
  listCharacters: { get: () => listCharacters },
  loadCampaignText: { get: () => loadCampaignText },
  loadCharacterVoices: { get: () => loadCharacterVoices },
  loadSets: { get: () => loadSets },
  localOnly: { get: () => localOnly },
  mapsForCampaign: { get: () => mapsForCampaign },
  normalizeCharacter: { get: () => normalizeCharacter },
  normalizeMapConfig: { get: () => normalizeMapConfig },
  npcProviderNow: { get: () => npcProviderNow },
  packetFileNames: { get: () => packetFileNames },
  packetPath: { get: () => packetPath },
  pictureFiles: { get: () => pictureFiles },
  picturePath: { get: () => picturePath },
  playLog: { get: () => playLog },
  PUBLIC_DIR: { get: () => PUBLIC_DIR },
  readCampaignMeta: { get: () => readCampaignMeta },
  readJson: { get: () => readJson },
  readMapConfig: { get: () => readMapConfig },
  restParty: { get: () => restParty },
  safeCampaignId: { get: () => safeCampaignId },
  safeId: { get: () => safeId },
  saveCharacter: { get: () => saveCharacter },
  setsLoaded: { get: () => setsLoaded },
  settings: { get: () => settings },
  templateOfCampaign: { get: () => templateOfCampaign },
  TEST_CAMPAIGN_ID: { get: () => TEST_CAMPAIGN_ID },
  TEST_CAMPAIGN_VOICES: { get: () => TEST_CAMPAIGN_VOICES },
  TOKEN_DIR: { get: () => TOKEN_DIR },
  TOKEN_URL_RE: { get: () => TOKEN_URL_RE },
  trackStore: { get: () => trackStore },
  TTS_CACHE_DIR: { get: () => TTS_CACHE_DIR },
  TTS_PROFILES: { get: () => TTS_PROFILES },
  UPLOAD_DIR: { get: () => UPLOAD_DIR },
  usageTracker: { get: () => usageTracker },
  voiceProviderNow: { get: () => voiceProviderNow },
  VOICES: { get: () => VOICES },
  withSavedStarts: { get: () => withSavedStarts },
  writeJsonAtomic: { get: () => writeJsonAtomic },
  writeMapConfig: { get: () => writeMapConfig },
});
// </deps>
const jsonBody = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === '/api/market/import' ? next() : jsonBody(req, res, next)));       // a pack file carries its picture and gets its own, larger limit
app.use(liveMiddleware(null, () => campaignIds()));
// Map pictures were renamed in Oct 2026 (vtt- for the maps we generated, dnd- for the Wizards of the Coast ones). A saved game or browser copy may still name the
// old file, so the old names keep working: the picture is redirected and the config and DM picture lookups use the new name.
const OLD_MAP_NAMES = {
  'camp-day.png': 'vtt-camp-day.png', 'camp-night.png': 'vtt-camp-night.png', 'dungeon-cellars.png': 'vtt-dungeon-cellars.png', 'terrain-test.png': 'vtt-terrain-test.png',
  'phandalin.jpg': 'dnd-phandalin.jpg', 'phandalin-dmversion.jpg': 'dnd-dm-phandalin.jpg',
  'phandalin-playerversion.jpg': 'dnd-phandalin-playerversion.jpg', 'northswordcoast.jpg': 'dnd-northswordcoast.jpg',
  'northswordcoast-playerversion.jpg': 'dnd-northswordcoast-playerversion.jpg', 'dnd-phandalin-dmversion.jpg': 'dnd-dm-phandalin.jpg'
};
const currentMapName = (name) => { const base = path.basename(String(name ?? '')); return OLD_MAP_NAMES[base] || (/^rusty-flagon-[^/]+\.png$/.test(base) ? 'vtt-' + base : base); };
app.use('/uploads/:file', (req, res, next) => { const now = currentMapName(req.params.file); if (now !== req.params.file) return res.redirect(301, '/uploads/' + now); next(); });
app.get('/uploads/:file', (req, res, next) => { const p = deps.packetPath(path.basename(req.params.file)); if (!p) return next(); res.sendFile(p); });     // pictures that live in a map set's packet
// The developer and test pages moved to /dev/ (bookmarks to the old addresses still work).
for (const page of ['conditions-test', 'image-test', 'levelup-test', 'sound-test', 'voice-test', 'test-lab']) app.get(`/${page}.html`, (req, res) => res.redirect(301, `/dev/${page}.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`));
app.use(express.static(PUBLIC_DIR));
// Anything that changes state or spends credit (every non-GET call to /api) must be addressed to this computer by name: a page on another site that rebinds its domain to 127.0.0.1 sends its own Host and is refused.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get('host') || '')) return res.status(403).json({ error: 'This can only be done from this computer.' });
  next();
});

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// What the character sheet page needs to lay itself out: which sheet field is which skill, save, spell line and slot row.
const SHEET_FIELDS = JSON.parse(await readFile(path.join(__dirname, 'lib', 'sheet-fields.json'), 'utf8'));
app.get('/api/sheet-layout', (_req, res) => res.json({ skills: SKILLS, saves: SAVES, spellLines: SHEET_FIELDS.spellLines, slots: SHEET_FIELDS.slots }));

// The real things a sheet can pick from (SRD 5.1): spells, weapons, armor and shields, with what is needed to work out attack bonus, damage and armor class.
let sheetOptionsCache = null;
app.get('/api/sheet-options', asyncRoute(async (_req, res) => {
  if (!sheetOptionsCache) {
    const spells = JSON.parse(await readFile(path.join(__dirname, 'data', 'srd', 'spells.json'), 'utf8'));
    const equipment = JSON.parse(await readFile(path.join(__dirname, 'data', 'srd', 'equipment.json'), 'utf8'));
    const cat = (e) => e.equipment_category?.index;
    sheetOptionsCache = {
      spells: spells.map((s) => ({ name: s.name, level: s.level, school: s.school?.name || '', classes: (s.classes || []).map((c) => c.name), concentration: Boolean(s.concentration), ritual: Boolean(s.ritual) })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      weapons: equipment.filter((e) => cat(e) === 'weapon').map((e) => ({ name: e.name, category: e.category_range || '', ranged: e.weapon_range === 'Ranged', dice: e.damage?.damage_dice || '', type: e.damage?.damage_type?.name || '', props: (e.properties || []).map((p) => p.name), range: e.range ? (e.range.long ? `${e.range.normal}/${e.range.long} ft` : `${e.range.normal} ft`) : '', versatile: e.two_handed_damage?.damage_dice || '' })).sort((a, b) => a.name.localeCompare(b.name)),
      armor: equipment.filter((e) => cat(e) === 'armor').map((e) => ({ name: e.name, category: e.armor_category || '', base: e.armor_class?.base ?? 10, dexBonus: e.armor_class?.dex_bonus !== false, maxDex: e.armor_class?.max_bonus ?? (e.armor_category === 'Medium' ? 2 : null), strMin: e.str_minimum || 0, stealth: Boolean(e.stealth_disadvantage) })).sort((a, b) => a.name.localeCompare(b.name))
    };
  }
  res.json(sheetOptionsCache);
}));

app.get('/api/character-aliases', (_req, res) => res.json(characterAliases));
app.get('/api/characters', asyncRoute(async (req, res) => {
  const rules = (await readSettings(path.join(CAMPAIGNS_DIR, await getActiveCampaignId()))).rules === '2024' ? '2024' : '2014';
  // effSpeed / effMaxHp: what exhaustion, heavy armor and speed items leave (the tabletop moves and heals by these; the stored speed and maximum stay as they are).
  res.json((await listCharacters(req.query.campaign ? safeCampaignId(req.query.campaign) : '')).map((c) => { const e = computeEffective(seedFromSheet(c), false, rules); return c.track?.exhaustion || e.speed !== (Number(c.speed) || 30) ? { ...c, effSpeed: e.speed, effMaxHp: e.maxHp } : c; }));
}));

// Quick starter characters for the new campaign wizard (lib/quick-character.js): name, race, class and level in, a full sheet out.
app.get('/api/characters/quick', (_req, res) => res.json(quickChoices()));
app.post('/api/characters/quick', localOnly, asyncRoute(async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Give the character a name.' });
  const { classes, races } = quickChoices();
  const cls = String(req.body?.cls ?? ''), race = String(req.body?.race ?? '');
  if (!classes.includes(cls)) return res.status(400).json({ error: 'Pick a class: ' + classes.join(', ') });
  if (!races.includes(race)) return res.status(400).json({ error: 'Pick a race: ' + races.join(', ') });
  const id = newCharacterId();
  const character = normalizeCharacter(buildQuickCharacter({ id, name, cls, race, level: req.body?.level }));
  await saveCharacter(character);
  res.json({ ok: true, character });
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
      if (req.body?.armor === undefined && old.armor) character.armor = old.armor;
      if (req.body?.shield === undefined && old.shield) character.shield = true;
      if (req.body?.darkvision === undefined && old.darkvision) character.darkvision = int(old.darkvision, 0, 0, 120);
      for (const k of ['size', 'race', 'subclass']) if (req.body?.[k] === undefined && old[k]) character[k] = old[k];
      if (req.body?.feats === undefined && Array.isArray(old.feats) && old.feats.length) character.feats = old.feats;
    } catch { /* new character: nothing to keep */ }
  }
  // The rules track (Hit Dice, exhaustion, features) is changed only by the rules endpoints and the DM, never by a page's copy of the character (which may be stale).
  try { const old = JSON.parse(await readFile(path.join(CHAR_DIR, `${character.id}.json`), 'utf8')); if (old.track) character.track = old.track; else delete character.track; } catch { /* new character */ }
  await saveCharacter(character);
  res.json(character);
}));

// Only the token (picture and colour) of a saved character, so changing it can never overwrite what the DM changed on the sheet in the meantime.
app.put('/api/characters/:id/token', localOnly, asyncRoute(async (req, res) => {
  const id = canonId(safeId(req.params.id));
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  let old;
  try { old = JSON.parse(await readFile(path.join(CHAR_DIR, `${id}.json`), 'utf8')); } catch { return res.status(404).json({ error: 'Character not found' }); }
  const { image, color } = req.body ?? {};
  if (image !== undefined) old.image = TOKEN_URL_RE.test(image ?? '') ? image : '';
  if (color !== undefined && /^#[0-9a-f]{6}$/i.test(color ?? '')) old.color = color;
  await saveCharacter(old);
  res.json({ ok: true, image: old.image || '', color: old.color });
}));

app.delete('/api/characters/:id', asyncRoute(async (req, res) => {
  const id = canonId(safeId(req.params.id));
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
registerUploads(app, deps);

// ---------------------------------------------------------------- per-map config (walls + grid calibration)
const { ensureSets, loadSets, normalizeMapConfig, picturePath, readMapConfig, setsLoaded, packetPath, packetFileNames, writeMapConfig } = await registerMapConfig(app, deps);

// ---------------------------------------------------------------- Market (maps saved as packs: data/market/<id>/pack.json + picture, lib/market.js)
const { pictureFiles, mapsForCampaign, withSavedStarts } = await registerMarket(app, deps);

// ---------------------------------------------------------------- compendium (SRD monsters, spells, magic items)
registerCompendium(app, deps);

// ---------------------------------------------------------------- party API (gear, coins, attunement, stash)
const { dmBuys, trackStore, restParty, keepJournal } = registerParty(app, deps);

// ---------------------------------------------------------------- sound takes: several recordings per effect to choose from by ear (Sound Test page)
const { readJson } = registerSoundTakes(app, deps);

// ---------------------------------------------------------------- sound review notes (from the Sound Test page)
registerSoundNotes(app, deps);

// ---------------------------------------------------------------- Map Maker (maps I generate for you, your requests and feedback)
registerMapMaker(app, deps);

// ---------------------------------------------------------------- safety tools
registerSafety(app, deps);

// ---------------------------------------------------------------- saved game (board, chat, explored fog)
const { writeJsonAtomic } = registerSavedGame(app, deps);

// ---------------------------------------------------------------- table settings
registerTableSettings(app, deps);

// ---------------------------------------------------------------- journal / save file API
registerJournal(app, deps);

// ---------------------------------------------------------------- campaign selector API
registerCampaignSelector(app, deps);

// ---------------------------------------------------------------- cloud voices (OpenAI text-to-speech)
const { loadCharacterVoices, canGoFast, canSkipThinking, KNOWN_OPENAI_VOICES, chosenVoice, TTS_PROFILES, voiceProviderNow, npcProviderNow } = registerVoices(app, deps);

// ---------------------------------------------------------------- campaign

// Every .txt/.md file in data/campaign is given to the DM as reference material (cached between turns).
// ---------------------------------------------------------------- campaigns

// Make sure the built-in test campaign exists and has its text. Existing files are never overwritten, so edits stay.
{
  const dir = path.join(CAMPAIGNS_DIR, TEST_CAMPAIGN_ID);
  await mkdir(dir, { recursive: true });
  try {
    const seed = await readFile(path.join(PUBLIC_DIR, 'scenarios', 'rusty-flagon-campaign.md'), 'utf8');
    try { await stat(path.join(dir, '01-the-rusty-flagon.md')); } catch { await writeFile(path.join(dir, '01-the-rusty-flagon.md'), seed); }
  } catch { /* the seed file is optional */ }
}
{
  const id = await getActiveCampaignId();
  const text = await loadCampaignText(id);
  console.log(text ? `Active campaign: ${id} (~${Math.round(text.length / 4000)}k tokens of reference text)` : `Active campaign: ${id} (no campaign text yet, the DM runs without a module)`);
}

// ---------------------------------------------------------------- AI DM
const { VOICES, DM_MAP_DIR } = await registerAiDm(app, deps);

// ---------------------------------------------------------------- errors

// ---------------------------------------------------------------- settings (API keys, models)
registerSettings(app, deps);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`AI-VTT running at http://localhost:${PORT} (host ${HOST}, model: ${settings.MODEL}, AI DM ${settings.anthropic ? 'online' : 'offline - set ANTHROPIC_API_KEY'})`);
});

