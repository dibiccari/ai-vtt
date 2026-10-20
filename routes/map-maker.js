// Map Maker: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { designLayout, surpriseMap, DEFAULT_COLS, DEFAULT_ROWS } from '../lib/map-designer.js';
import { compileLayout, layoutSvg, LEGEND, SIZES } from '../lib/map-layout.js';
import { settings } from '../lib/runtime-settings.js';
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
      res.json(layoutReply(out.layout, { name: out.name, summary: out.summary, attempts: out.attempts, model: settings.MAP_DESIGNER_MODEL, cost: Math.round(costOfUsage(settings.MAP_DESIGNER_MODEL, out.usage) * 10000) / 10000 }));
    } catch (err) { aiError(res, err); }
  }));

  // A grid the person edited by hand: checked and drawn again, no AI.
  app.post('/api/map-maker/layout/check', deps.asyncRoute(async (req, res) => {
    const grid = Array.isArray(req.body?.grid) ? req.body.grid.map(String) : String(req.body?.grid ?? '');
    res.json(layoutReply(compileLayout(grid)));
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
