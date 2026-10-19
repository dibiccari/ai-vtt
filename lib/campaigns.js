// Campaigns: each one is a folder in data/campaigns/<id>/ holding its text (*.md / *.txt), campaign.json, voices.json and the rest of its files.
// This module knows where they are, which one is active and what text the Dungeon Master is given; the routes that edit them live in routes/campaign-selector.js.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectDocuments, filteredNote, areasInPlay } from './module-select.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAMPAIGNS_DIR = path.join(ROOT, 'data', 'campaigns');
export const DEFAULT_CAMPAIGN_ID = 'lost-mine-of-phandelver';
export const TEST_CAMPAIGN_ID = 'tavern-brawl-test';
export const ACTIVE_CAMPAIGN_FILE = path.join(CAMPAIGNS_DIR, 'active.json');

export const BUILT_IN_CAMPAIGNS = {
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
export const TEST_CAMPAIGN_VOICES = {
  'Marta Ironbrew': { voice: 'nova', style: 'A broad, sharp-eyed halfling innkeeper in her fifties. Warm, brisk and funny, with a no-nonsense edge when her furniture is at risk.' },
  'Bruno': { voice: 'onyx', style: 'A huge, calm bouncer. Slow, deep and patient, like a man who hates raising his voice and always wins anyway.' },
  'Gruk Tannerson': { voice: 'ash', style: 'A loud, scarred sellsword three drinks in. Boastful and gravelly, quick to take offence, laughing at his own jokes.' },
  'Dagger Dan': { voice: 'echo', style: 'A grinning, sly hanger-on. Quick, smug and sneering, always backing his boss.' },
  'Skinny Jo': { voice: 'verse', style: 'A nervous, eager hanger-on. High, quick and jumpy, laughing too soon.' },
  'Odo Pennywhistle': { voice: 'fable', style: 'A cheerful, slightly drunk regular. Warm and rambling, delighted by gossip.' },
  'Pell Brightwater': { voice: 'alloy', style: 'A cheerful, slightly drunk regular. Friendly and slurry, ready to throw a mug for the fun of it.' },
  'Nim': { voice: 'ballad', style: 'A thin, nervous spy in a gray cloak. Quiet, hurried and wary, glancing at the door between phrases.' }
};

export const safeCampaignId = (id) => String(id ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
export const CAMPAIGN_FILE_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(md|txt)$/i;

export async function campaignIds() {
  const entries = await readdir(CAMPAIGNS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export async function readCampaignMeta(id) {
  const base = (Object.hasOwn(BUILT_IN_CAMPAIGNS, id) && BUILT_IN_CAMPAIGNS[id]) || { name: id.replace(/-/g, ' '), system: 'D&D 5th Edition', levels: '', description: '' };
  try {
    const saved = JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, id, 'campaign.json'), 'utf8'));
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

// A campaign made from another ("New campaign" on the Campaigns page) remembers which one in campaign.json `template`; it shares that one's maps list, party and starting scene.
export async function templateOfCampaign(id) {
  try { return safeCampaignId((await readCampaignMeta(safeCampaignId(id))).template) || safeCampaignId(id); } catch { return safeCampaignId(id); }
}

export async function campaignFiles(id) {
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
export async function chosenCampaignId() {
  try {
    const saved = safeCampaignId(JSON.parse(await readFile(ACTIVE_CAMPAIGN_FILE, 'utf8')).id);
    if ((await campaignIds()).includes(saved)) return saved;
  } catch { /* nothing chosen yet */ }
  return '';
}

export async function getActiveCampaignId() {
  const ids = await campaignIds();
  try {
    const saved = safeCampaignId(JSON.parse(await readFile(ACTIVE_CAMPAIGN_FILE, 'utf8')).id);
    if (ids.includes(saved)) return saved;
  } catch { /* nothing chosen yet */ }
  return ids.includes(DEFAULT_CAMPAIGN_ID) ? DEFAULT_CAMPAIGN_ID : (ids[0] || DEFAULT_CAMPAIGN_ID);
}

// The text the DM is given for a campaign, cached until a file in the folder changes.
const campaignTextCache = new Map();
// ctx: { combat, areas (the area pins of the map), tokens }: in a fight only the sections of the numbered areas near the tokens are read, and the set only grows until the fight ends (so the prompt does not change with every step a token takes).
const fightAreas = new Map();
export async function loadCampaignText(id, mapId = '', ctx = {}) {
  const all = await campaignFiles(id);
  let relevance = null;
  try { relevance = JSON.parse(await readFile(path.join(CAMPAIGNS_DIR, await templateOfCampaign(id), 'relevance.json'), 'utf8')); } catch { /* every document is sent */ }
  const stickyKey = `${id}|${mapId}`;
  let areaNumbers = [];
  if (ctx.combat && relevance?.combat?.areaSource?.[mapId]) {
    const have = fightAreas.get(stickyKey) || new Set();
    for (const n of areasInPlay(ctx.areas, ctx.tokens, Number(relevance.combat.areaRadius) || 10)) have.add(n);
    fightAreas.set(stickyKey, have);
    areaNumbers = [...have].sort((a, b) => a - b);
  } else fightAreas.delete(stickyKey);
  const picked = selectDocuments(all, relevance, mapId, { combat: ctx.combat, areaNumbers });
  const files = picked.files;
  const sig = files.map((f) => `${f.name}:${f.size}:${f.mtimeMs}:${f.partial || ''}`).join('|') + (picked.fight ? '|fight' : '');
  const hit = campaignTextCache.get(id + '|' + mapId + '|' + sig.length + ':' + areaNumbers.join(','));
  if (hit && hit.sig === sig) return hit.text;
  const parts = picked.filtered ? [filteredNote(picked.left, picked.fight, picked.areas)] : [];
  for (const f of files) {
    const text = f.text.trim();
    if (text) parts.push(`##### CAMPAIGN DOCUMENT: ${f.name}${f.partial ? ` (only areas ${f.partial}, the ones near the fight)` : ''} #####\n${text}`);
  }
  const text = parts.join('\n\n');
  campaignTextCache.set(id + '|' + mapId + '|' + sig.length + ':' + areaNumbers.join(','), { sig, text });
  return text;
}
