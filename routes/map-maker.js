// Map Maker: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { designLayout, surpriseMap, DEFAULT_COLS, DEFAULT_ROWS } from '../lib/map-designer.js';
import { compileLayout, layoutSvg, scaleTo, LEGEND, SIZES } from '../lib/map-layout.js';
import { paint, paintOptions } from '../lib/map-painter.js';
import { settings, mapGen } from '../lib/runtime-settings.js';
import { describeAiError } from '../lib/ai-errors.js';
import { costOf, normalizeUsage } from '../lib/usage.js';

export function registerMapMaker(app, deps) {
  // Requests and feedback are written here from the Map Maker page and read by the assistant in the coding session, which then generates or
  // improves the maps (scripts/make-*-map.mjs). data/map-requests.json and data/map-feedback.json.
  const MAP_REQUESTS_FILE = path.join(deps.__dirname, 'data', 'map-requests.json');
  const MAP_FEEDBACK_FILE = path.join(deps.__dirname, 'data', 'map-feedback.json');
  const REQUEST_STATUS = ['new', 'working', 'done'];
  const FEATURES = ['doors', 'lights', 'water', 'trees', 'difficult terrain', 'stairs', 'secret door', 'traps', 'night version'];

  // ---- the wizard: an idea, then a layout (battle maps), then a picture. The AI calls are paid, so each says what it cost.
  const aiError = (res, err) => {
    if (err && err.code === 'designer') return res.status(502).json({ error: err.message });
    const help = describeAiError(err);
    return res.status(502).json({ error: `AI error: ${err?.message || err}`, ...(help || {}) });
  };
  const costOfUsage = (model, usageList) => usageList.reduce((sum, u) => sum + costOf(model, normalizeUsage(u)), 0);
  const layoutReply = (compiled, extra = {}) => ({ ok: compiled.ok, grid: compiled.cells, cols: compiled.cols, rows: compiled.rows, svg: compiled.cols ? layoutSvg(compiled) : '', problems: compiled.problems, stats: compiled.stats || null, legend: LEGEND, ...extra });

  // What the wizard offers: the kinds of map and the battle map sizes.
  app.get('/api/map-maker/options', (_req, res) => res.json({ kinds: [{ id: 'battle', label: 'Battle map' }, { id: 'town', label: 'Town map' }, { id: 'regional', label: 'Regional map' }], sizes: SIZES, orientations: ['landscape', 'portrait'] }));

  app.post('/api/map-maker/surprise', deps.asyncRoute(async (req, res) => {
    if (!settings.anthropicAny) return res.status(503).json({ error: 'No Anthropic key is saved yet (Settings).', code: 'key', summary: 'The Map Maker needs the Anthropic key.', help: { label: 'Open Settings', url: '/settings.html' }, links: [{ label: 'Open Settings', url: '/settings.html' }] });
    try {
      const out = await surpriseMap({ client: settings.anthropicAny, model: settings.MAP_IDEA_MODEL, kind: String(req.body?.kind || 'battle'), record: (m, u) => deps.usageTracker.record(m, u, '', 'maps') });
      res.json({ description: out.description });
    } catch (err) { aiError(res, err); }
  }));

  app.post('/api/map-maker/layout', deps.asyncRoute(async (req, res) => {
    if (!settings.anthropicAny) return res.status(503).json({ error: 'No Anthropic key is saved yet (Settings).', code: 'key', summary: 'The Map Maker needs the Anthropic key.', help: { label: 'Open Settings', url: '/settings.html' }, links: [{ label: 'Open Settings', url: '/settings.html' }] });
    const description = String(req.body?.description ?? '').trim();
    if (!description) return res.status(400).json({ error: 'Describe the map first.' });
    try {
      const out = await designLayout({ client: settings.anthropicAny, model: settings.MAP_DESIGNER_MODEL, description, size: req.body?.size, orientation: req.body?.orientation, cols: Number(req.body?.cols) || DEFAULT_COLS, rows: Number(req.body?.rows) || DEFAULT_ROWS, record: (m, u) => deps.usageTracker.record(m, u, '', 'maps') });
      res.json(layoutReply(out.layout, { name: out.name, summary: out.summary, setting: out.setting, attempts: out.attempts, model: settings.MAP_DESIGNER_MODEL, cost: Math.round(costOfUsage(settings.MAP_DESIGNER_MODEL, out.usage) * 10000) / 10000 }));
    } catch (err) { aiError(res, err); }
  }));

  // A grid the person edited by hand: checked and drawn again, no AI.
  app.post('/api/map-maker/layout/check', deps.asyncRoute(async (req, res) => {
    const grid = Array.isArray(req.body?.grid) ? req.body.grid.map(String) : String(req.body?.grid ?? '');
    res.json(layoutReply(compileLayout(grid)));
  }));

  // ---- painting: the services that have a key, a price, then the picture (kept as a draft until it is saved)
  const imageKeys = () => ({ openai: settings.IMAGE_KEY || settings.OPENAI_KEY, gemini: settings.GEMINI_KEY, fal: settings.FAL_KEY });
  const KINDS = ['battle', 'town', 'regional'];
  const drafts = new Map();              // id -> { bytes, ext, width, height, kind } (in memory; a restart forgets them)

  app.get('/api/map-maker/paint-options', (req, res) => {
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'battle';
    res.json({ kind, ...paintOptions(imageKeys(), mapGen(kind)), layoutLocked: kind === 'battle' });
  });

  app.post('/api/map-maker/paint', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const b = req.body || {}, kind = KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: 'Choose the type of map first.' });
    const description = String(b.description ?? '').trim();
    if (!description) return res.status(400).json({ error: 'Describe the map first.' });
    const options = paintOptions(imageKeys(), null), provider = options.providers.find((p) => p.id === b.provider && p.available);
    if (!provider) return res.status(400).json({ error: 'That picture service has no key saved yet (Settings).', help: { label: 'Open Settings', url: '/settings.html' } });
    const model = provider.models.find((m) => m.id === b.model) || provider.models[0], quality = model.qualities.includes(b.quality) ? b.quality : model.qualities[0];
    let layout = null;
    if (kind === 'battle') {
      layout = compileLayout(Array.isArray(b.grid) ? b.grid.map(String) : String(b.grid ?? ''));
      if (!layout.ok) return res.status(400).json({ error: 'The layout still has problems; fix them before painting.', problems: layout.problems });
    }
    try {
      const out = await paint({ root: deps.__dirname, kind, description, setting: b.setting === 'outdoor' ? 'outdoor' : 'indoor', layout, orientation: b.orientation, provider: provider.id, model: model.id, quality, keys: imageKeys() });
      const id = randomBytes(8).toString('hex');
      drafts.set(id, { bytes: out.bytes, ext: out.ext, width: out.width, height: out.height, kind });
      while (drafts.size > 12) drafts.delete(drafts.keys().next().value);
      res.json({ draftId: id, url: '/api/map-maker/draft/' + id, width: out.width, height: out.height, cost: out.cost, drift: out.drift, note: out.note, seconds: Math.round(out.ms / 1000), provider: provider.id, model: model.id, quality });
    } catch (err) { res.status(502).json({ error: String(err?.short || err?.message || err) }); }
  }));

  app.get('/api/map-maker/draft/:id', (req, res) => {
    const d = drafts.get(String(req.params.id));
    if (!d) return res.status(404).json({ error: 'That picture is no longer kept: paint it again.' });
    res.type(d.ext === 'jpg' ? 'image/jpeg' : 'image/png').send(d.bytes);
  });

  // Saves a painted draft as a map: the picture goes to the uploads folder, the layout's walls, doors, lights, terrain and start spots are set on it, and a map set is made.
  app.post('/api/map-maker/save', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const b = req.body || {}, d = drafts.get(String(b.draftId));
    if (!d) return res.status(404).json({ error: 'That picture is no longer kept: paint it again.' });
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Give the map a name.' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map';
    let config = { name, publisher: 'Explorer', kind: d.kind };
    if (d.kind === 'battle') {
      const layout = compileLayout(Array.isArray(b.grid) ? b.grid.map(String) : String(b.grid ?? ''));
      if (!layout.ok) return res.status(400).json({ error: 'The layout still has problems.', problems: layout.problems });
      config = { ...config, ...scaleTo(layout, d.width, d.height), light: b.setting === 'outdoor' ? 'bright' : 'dim' };
    } else if (d.kind === 'regional') config = { ...config, tiles: 'hex', hexSize: Math.max(20, Math.round(d.width / (0.866 * 24))) };
    const file = `vtt-${slug}-${Date.now().toString(36)}.${d.ext}`;
    await writeFile(path.join(deps.UPLOAD_DIR, file), d.bytes);
    await deps.writeMapConfig(file, deps.normalizeMapConfig(config));
    const { index } = await deps.ensureSets(), hit = index.get(file);
    if (!hit) return res.status(500).json({ error: 'The picture was saved but no map set was made for it.' });
    drafts.delete(String(b.draftId));
    res.json({ ok: true, file, guid: hit.set.id, url: `/map-test.html?set=${hit.set.id}` });
  }));

  app.get('/api/map-maker', deps.asyncRoute(async (_req, res) => {
    const scen = (await readdir(path.join(deps.PUBLIC_DIR, 'scenarios'))).filter((f) => f.endsWith('.dd2vtt')).map((f) => f.slice(0, -7));
    const pictures = await deps.pictureFiles();
    const maps = [];
    for (const stem of scen) {
      const picture = pictures.find((f) => new RegExp(`^${stem.replace(/[^a-z0-9-]/gi, '')}(-[a-z0-9]{6,10})?\\.png$`, 'i').test(f));
      if (!picture) { maps.push({ stem, picture: '', imported: false }); continue; }
      let c = {};
      c = (await deps.readMapConfig(picture)) || {};
      maps.push({
        stem, picture, imported: true, squares: Number(c.squares) || 0,
        walls: (c.walls || []).filter((w) => w.type !== 'door').length, doors: (c.walls || []).filter((w) => w.type === 'door').length,
        lights: (c.lights || []).length, pins: (c.starts || []).length, difficult: (c.difficult || []).length, light: c.light || 'bright'
      });
    }
    const read = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
    res.json({ maps, requests: await read(MAP_REQUESTS_FILE, []), feedback: await read(MAP_FEEDBACK_FILE, {}), features: FEATURES });
  }));

  app.put('/api/map-maker/requests', deps.localOnly, deps.asyncRoute(async (req, res) => {
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

  app.put('/api/map-maker/feedback', deps.localOnly, deps.asyncRoute(async (req, res) => {
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
}
