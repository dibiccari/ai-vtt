// Market: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { mkdir, readdir, readFile, copyFile, writeFile, rm, unlink } from 'node:fs/promises';
import { MAP_TYPES, MOODS, LICENCES, whyNotShareable, cleanMeta, packId } from '../lib/market.js';
import { entriesToList, mapsFor, cleanMapList, mapsFromList, MAP_KINDS } from '../lib/campaign-maps.js';
import express from 'express';

export async function registerMarket(app, deps) {
  const MARKET_DIR = path.join(deps.__dirname, 'data', 'market');
  await mkdir(MARKET_DIR, { recursive: true });
  const marketIds = async () => (await readdir(MARKET_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const readPack = async (id) => { try { return JSON.parse(await readFile(path.join(MARKET_DIR, deps.safeId(id), 'pack.json'), 'utf8')); } catch { return null; } };
  const summary = (id, p) => ({ id, kind: p.kind, name: p.name, type: p.type, description: p.description, tags: p.tags, mood: p.mood, licence: p.licence, author: p.author, createdAt: p.createdAt, picture: `/api/market/${id}/picture`,
    walls: (p.config?.walls || []).filter((w) => w.type !== 'door').length, doors: (p.config?.walls || []).filter((w) => w.type === 'door').length, lights: (p.config?.lights || []).length, pins: (p.config?.starts || []).length, difficult: (p.config?.difficult || []).length, squares: p.config?.squares || 0 });

  app.get('/api/market', deps.asyncRoute(async (_req, res) => {
    const maps = [];
    for (const id of await marketIds()) { const p = await readPack(id); if (p && p.kind === 'map') maps.push(summary(id, p)); }
    maps.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ maps, types: MAP_TYPES, moods: MOODS, licences: LICENCES });
  }));

  // Save a map from the editor: its picture and its configuration (data/maps/<picture>.json) become a pack.
  app.post('/api/market/maps', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const picture = path.basename(String(req.body?.picture ?? ''));
    if (!(await pictureFiles()).includes(picture)) return res.status(404).json({ error: 'That map picture is not uploaded.' });
    const why = whyNotShareable(picture);
    if (why) return res.status(403).json({ error: why });
    const meta = cleanMeta(req.body, 'picture' + path.extname(picture).toLowerCase());
    if (meta.licence !== LICENCES[LICENCES.length - 1] && req.body?.rights !== true) return res.status(400).json({ error: 'Confirm that you made this map or have the right to share it (or choose the Private licence).' });
    let config = {};
    config = (await deps.readMapConfig(picture)) || {};
    const taken = new Set(await marketIds());
    const id = packId(meta.name, taken);
    await mkdir(path.join(MARKET_DIR, id), { recursive: true });
    await copyFile(deps.picturePath(picture), path.join(MARKET_DIR, id, meta.picture));
    if (meta.mood) config.mood = meta.mood;
    await writeFile(path.join(MARKET_DIR, id, 'pack.json'), JSON.stringify({ ...meta, config }, null, 2));
    res.json({ ok: true, id, pack: summary(id, { ...meta, config }) });
  }));

  app.get('/api/market/:id/picture', deps.asyncRoute(async (req, res) => {
    const p = await readPack(req.params.id);
    if (!p) return res.status(404).end();
    res.sendFile(path.join(MARKET_DIR, deps.safeId(req.params.id), p.picture));
  }));

  app.delete('/api/market/:id', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeId(req.params.id);
    if (!id || !(await marketIds()).includes(id)) return res.status(404).json({ error: 'No such pack' });
    await rm(path.join(MARKET_DIR, id), { recursive: true, force: true });
    res.json({ ok: true });
  }));

  // Add a pack's map to a campaign: the picture and set-up go into the app's map folders (once), the campaign's map list gets an entry.
  app.post('/api/market/:id/install', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeId(req.params.id), p = await readPack(id);
    if (!p) return res.status(404).json({ error: 'No such pack' });
    const cid = deps.safeCampaignId(req.body?.campaign);
    if (!cid || !(await deps.campaignIds()).includes(cid)) return res.status(404).json({ error: 'Pick a campaign to add it to.' });
    const file = `mkt-${id}${path.extname(p.picture)}`;
    const isNewPicture = !(await pictureFiles()).includes(file);
    if (isNewPicture) await copyFile(path.join(MARKET_DIR, id, p.picture), path.join(deps.UPLOAD_DIR, file));
    if (isNewPicture) await deps.writeMapConfig(file, { ...deps.normalizeMapConfig(p.config || {}), source: p.config?.source || 'market' });
    const files = await pictureFiles();
    const current = (await savedMapList(cid)) ?? entriesToList(mapsFor(await deps.templateOfCampaign(cid), files));
    if (current.some((m) => m.file === file)) return res.json({ ok: true, already: true, file });
    const entry = { id: id.slice(0, 40), file, name: p.name, kind: p.type, description: p.description };
    const { list } = cleanMapList([...current, entry], files);
    await writeFile(path.join(deps.CAMPAIGNS_DIR, cid, 'maps.json'), JSON.stringify({ version: 1, maps: list }, null, 2));
    res.json({ ok: true, file, maps: list.length });
  }));

  // A pack as one file to send to someone (the picture inside, base64).
  app.get('/api/market/:id/export', deps.asyncRoute(async (req, res) => {
    const id = deps.safeId(req.params.id), p = await readPack(id);
    if (!p) return res.status(404).json({ error: 'No such pack' });
    if (p.licence === LICENCES[LICENCES.length - 1]) return res.status(403).json({ error: 'This pack has the Private licence: it stays on this computer.' });
    const data = (await readFile(path.join(MARKET_DIR, id, p.picture))).toString('base64');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.vttpack.json"`);
    res.json({ format: 'vttpack', version: 1, ...p, picture: { ext: path.extname(p.picture).toLowerCase(), data } });
  }));

  app.post('/api/market/import', deps.localOnly, express.json({ limit: '80mb' }), deps.asyncRoute(async (req, res) => {
    const b = req.body;
    if (!b || b.format !== 'vttpack' || b.kind !== 'map') return res.status(400).json({ error: 'This is not a map pack file.' });
    const ext = String(b.picture?.ext ?? '').toLowerCase();
    if (!deps.IMAGE_EXT.has(ext) || typeof b.picture?.data !== 'string') return res.status(400).json({ error: 'The pack has no usable picture.' });
    const bytes = Buffer.from(b.picture.data, 'base64');
    if (bytes.length < 100) return res.status(400).json({ error: 'The pack picture is empty.' });
    const meta = cleanMeta({ ...b, rights: true }, 'picture' + ext);
    const id = packId(meta.name, new Set(await marketIds()));
    await mkdir(path.join(MARKET_DIR, id), { recursive: true });
    await writeFile(path.join(MARKET_DIR, id, meta.picture), bytes);
    const config = { ...deps.normalizeMapConfig(b.config || {}), ...(b.config?.mood ? { mood: b.config.mood } : {}) };
    await writeFile(path.join(MARKET_DIR, id, 'pack.json'), JSON.stringify({ ...meta, config }, null, 2));
    res.json({ ok: true, id, pack: summary(id, { ...meta, config }) });
  }));

  // The places the active campaign can move the table to (only maps that are installed).
  // The maps a campaign can use: the list saved on the Campaigns page (maps.json), or the built-in registry for the shipped campaigns.
  const pictureFiles = async () => { if (!deps.SETS) await deps.loadSets(); return [...new Set([...(await readdir(deps.UPLOAD_DIR)).filter((f) => deps.IMAGE_EXT.has(path.extname(f).toLowerCase())), ...deps.PACKET_FILES.keys()])]; };
  async function savedMapList(id) {
    try { return JSON.parse(await readFile(path.join(deps.CAMPAIGNS_DIR, deps.safeCampaignId(id), 'maps.json'), 'utf8')).maps; } catch { return null; }
  }
  async function mapsForCampaign(id) {
    const files = await pictureFiles();
    const saved = await savedMapList(id);
    return Array.isArray(saved) ? mapsFromList(saved, files) : mapsFor(await deps.templateOfCampaign(id), files);
  }

  app.get('/api/campaigns/:id/maps', deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.params.id);
    const saved = await savedMapList(id);
    const files = await pictureFiles();
    res.json({ custom: Array.isArray(saved), maps: Array.isArray(saved) ? cleanMapList(saved, files).list : entriesToList(mapsFor(await deps.templateOfCampaign(id), files)), uploads: files.sort(), kinds: MAP_KINDS });
  }));

  app.put('/api/campaigns/:id/maps', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.params.id);
    if (!id || !(await deps.campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
    const { list, problems } = cleanMapList(req.body?.maps, await pictureFiles());
    await writeFile(path.join(deps.CAMPAIGNS_DIR, id, 'maps.json'), JSON.stringify({ version: 1, maps: list }, null, 2));
    res.json({ ok: true, maps: list, problems });
  }));

  // Back to the built-in list (only the shipped campaigns have one).
  app.delete('/api/campaigns/:id/maps', deps.localOnly, deps.asyncRoute(async (req, res) => {
    try { await unlink(path.join(deps.CAMPAIGNS_DIR, deps.safeCampaignId(req.params.id), 'maps.json')); } catch { /* nothing saved */ }
    res.json({ ok: true });
  }));

  // Arrival spots saved on the Map Test page (image pixels) are added to each map, and win over the built-in guesses.
  async function withSavedStarts(maps) {
    const out = [];
    for (const m of maps) {
      let starts = [];
      try { starts = (await deps.readMapConfig(m.url.split('/').pop()))?.starts || []; } catch { /* no saved config */ }
      out.push({ ...m, startPx: starts.find((s) => s.name === 'start') || null, spotsPx: Object.fromEntries(starts.filter((s, i) => s.name !== 'start' && starts.findIndex((o) => o.name === s.name) === i).map((s) => [s.name, { x: s.x, y: s.y }])), spotNotes: Object.fromEntries(starts.filter((s, i) => s.desc && starts.findIndex((o) => o.name === s.name && o.desc) === i).map((s) => [s.name, s.desc])) });
    }
    return out;
  }

  app.get('/api/maps/available', deps.asyncRoute(async (_req, res) => {
    const campaign = await deps.getActiveCampaignId();
    const maps = await withSavedStarts(await mapsForCampaign(campaign));
    res.json({ campaign, maps: maps.map((m) => ({ id: m.id, name: m.name, kind: m.kind, description: m.description, url: m.url, startPx: m.startPx ? { x: m.startPx.x, y: m.startPx.y } : null, start: { col: m.start[0], row: m.start[1] }, spots: Object.fromEntries(Object.entries(m.spots).map(([k, [col, row]]) => [k, { col, row }])) })) });
  }));

  return { pictureFiles, mapsForCampaign, withSavedStarts };
}
