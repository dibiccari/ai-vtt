// per-map config: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { mkdir, stat, rename, copyFile, unlink, writeFile, open, readdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { imageSize, buildSets, originOf } from '../lib/mapsets.js';
import { blueprintSvg } from '../lib/blueprint.js';
import { checkSetDoc, indexSets, docFromBuilt, configFromSet, applyConfigToSet, summarizeSet, isGuid, newGuid } from '../lib/mapsetstore.js';
import { existsSync } from 'node:fs';
import { CAMPAIGNS_DIR } from '../lib/campaigns.js';
import { MOODS } from '../lib/market.js';
import { localOnly } from '../lib/local-only.js';

export async function registerMapConfig(app, deps) {
  // Stored in data/maps/<image file name>.json so it survives browser changes. Wall coordinates are in image pixels.

  const MAP_CONFIG_DIR = path.join(deps.__dirname, 'data', 'maps');
  await mkdir(MAP_CONFIG_DIR, { recursive: true });

  function mapConfigFile(name) {
    const base = deps.currentMapName(name);
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(base) || !deps.IMAGE_EXT.has(path.extname(base).toLowerCase())) {
      throw Object.assign(new Error('map must be the file name of an uploaded image'), { status: 400 });
    }
    return path.join(MAP_CONFIG_DIR, `${base}.json`);
  }

  // ---- Map set files: data/mapsets/<guid>.json hold everything about a place (lib/mapsetstore.js). The per-picture set-up of old (data/maps/<picture>.json) is read when a picture is not in a set yet.
  const SETS_DIR = path.join(deps.__dirname, 'data', 'mapsets');
  await mkdir(SETS_DIR, { recursive: true });
  // A map set is a PACKET: the folder data/mapsets/<guid>/ holds set.json and every picture of the place, so copying, sharing or deleting a map is one folder. Pictures are still addressed as /uploads/<file>:
  // the server looks the file name up in the packets (PACKET_FILES) and serves it from there; public/uploads only holds a picture until a set adopts it (a new upload, a Market install).
  let SETS = null, setsBusy = Promise.resolve();
  const setsLoaded = () => Boolean(SETS);                         // for the code outside this section, which must not hold on to SETS itself
  const packetFileNames = () => [...PACKET_FILES.keys()];       // every picture file that lives in a packet
  const packetPath = (file) => PACKET_FILES.get(file);          // where a picture lives inside its packet, or undefined
  let PACKET_FILES = new Map();                                    // picture file name -> absolute path inside its packet
  const packetDir = (id) => path.join(SETS_DIR, id);
  const picturePath = (file) => PACKET_FILES.get(file) || path.join(deps.UPLOAD_DIR, file);
  const setPictureFiles = (doc) => [...new Set(doc.levels.flatMap((lv) => lv.looks.flatMap((l) => [l.player, l.dm && !String(l.dm).startsWith('data/dm-maps:') ? l.dm : null].filter(Boolean))))];
  // Move the pictures of a set that are still loose in public/uploads into its packet.
  async function adoptPictures(doc) {
    for (const f of setPictureFiles(doc)) {
      const from = path.join(deps.UPLOAD_DIR, f), to = path.join(packetDir(doc.id), f);
      try { await stat(from); } catch { continue; }
      try { await rename(from, to); } catch { await copyFile(from, to); await unlink(from).catch(() => {}); }
    }
  }
  async function saveSet(doc) {
    await mkdir(packetDir(doc.id), { recursive: true });
    const setFile = path.join(packetDir(doc.id), 'set.json'), tmp = `${setFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2));
    await rename(tmp, setFile);                                      // never a half-written set.json: a read during a save sees the old file or the new one
    await adoptPictures(doc);
    await writeBlueprint(doc);
  }
  // The vector layer of the set as blueprint.svg in its packet, in the pixel size of its first picture (redrawn on every save).
  async function writeBlueprint(doc) {
    try {
      const file = doc.levels[0].looks[0].player;
      const fh = await open(picturePath(file));
      const b = Buffer.alloc(65536); const { bytesRead } = await fh.read(b, 0, 65536, 0); await fh.close();
      const sz = imageSize(b.subarray(0, bytesRead)) || {};
      await writeFile(path.join(packetDir(doc.id), 'blueprint.svg'), blueprintSvg(doc, { width: sz.w, height: sz.h }));
    } catch { /* the picture is unreadable: the set still saved */ }
  }
  async function loadSets() {
    // old flat files (data/mapsets/<guid>.json) become packets the first time they are seen
    for (const ent of await readdir(SETS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      try { const d = JSON.parse(await readFile(path.join(SETS_DIR, ent.name), 'utf8')); if (!checkSetDoc(d).length) { await saveSet(d); await unlink(path.join(SETS_DIR, ent.name)); } } catch { /* unreadable set file */ }
    }
    const docs = [], files = new Map();
    for (const ent of await readdir(SETS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!ent.isDirectory()) continue;
      try {
        const d = JSON.parse(await readFile(path.join(SETS_DIR, ent.name, 'set.json'), 'utf8'));
        if (checkSetDoc(d).length) continue;
        docs.push(d);
        for (const f of await readdir(path.join(SETS_DIR, ent.name))) if (deps.IMAGE_EXT.has(path.extname(f).toLowerCase())) files.set(f, path.join(SETS_DIR, ent.name, f));
      } catch {
        const prev = SETS && SETS.docs.get(ent.name);              // a set that cannot be read right now keeps its last good copy instead of vanishing
        if (prev) { docs.push(prev); for (const f of await readdir(path.join(SETS_DIR, ent.name)).catch(() => [])) if (deps.IMAGE_EXT.has(path.extname(f).toLowerCase())) files.set(f, path.join(SETS_DIR, ent.name, f)); }
      }
    }
    PACKET_FILES = files;
    SETS = { docs: new Map(docs.map((d) => [d.id, d])), index: indexSets(docs) };
    for (const d of docs) { if (!existsSync(path.join(packetDir(d.id), 'blueprint.svg'))) await writeBlueprint(d); }       // sets saved before blueprints existed get theirs
  }
  // Every picture is in a set: pictures that are not yet (new uploads, a Market install) get one built from their old set-up. Runs one at a time.
  function ensureSets() {
    const run = setsBusy.then(async () => {
      if (!SETS) await loadSets();
      const missing = (await deps.pictureFiles()).filter((f) => !SETS.index.has(f));
      if (!missing.length) return SETS;
      const configs = {};
      for (const f of missing) { try { configs[f] = JSON.parse(await readFile(mapConfigFile(f), 'utf8')); } catch { configs[f] = null; } }
      const listed = {};
      for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
        if (!dirent.isDirectory()) continue;
        try { for (const m of await deps.mapsForCampaign(dirent.name)) { const f = m.url.split('/').pop(); listed[f] = { kind: listed[f]?.kind || m.kind, campaigns: [] }; } } catch { /* unreadable campaign */ }
      }
      const dmPictures = new Set((await readdir(deps.DM_MAP_DIR).catch(() => [])).map((f) => f.replace(/\.[^.]+$/, '')));
      for (const built of buildSets({ pictures: missing, configs, dmPictures, listed })) await saveSet(docFromBuilt(built, configs));
      await loadSets();
      return SETS;
    });
    setsBusy = run.catch(() => {});
    return run;
  }
  // The set-up of one picture in the shape the pages use (walls, pins, terrain, lights...), from its set; null when the picture is unknown.
  async function readMapConfig(name) {
    mapConfigFile(name);                                           // checks the name
    const { index } = await ensureSets();
    const hit = index.get(deps.currentMapName(name));
    return hit ? configFromSet(hit.set, deps.currentMapName(name)) : null;
  }
  async function writeMapConfig(name, config) {
    mapConfigFile(name);
    const { index } = await ensureSets();
    const file = deps.currentMapName(name), hit = index.get(file);
    if (!hit) {                                                    // a set-up for a picture that is not uploaded (yet): a set of its own is made for it
      const stem = file.replace(/\.[^.]+$/, '');
      const doc = docFromBuilt({ id: stem, name: stem, kind: ['battle', 'camp', 'town', 'regional'].includes(config.kind) ? config.kind : config.tiles === 'hex' ? 'regional' : 'battle', levels: [{ looks: [{ player: file, time: 'main', dm: null }] }] }, { [file]: config });
      await saveSet(doc); await loadSets();
      return;
    }
    applyConfigToSet(hit.set, file, config);
    await saveSet(hit.set);
  }

  function normalizeMapConfig(body) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    const walls = [];
    for (const w of Array.isArray(body?.walls) ? body.walls.slice(0, 20000) : []) {
      const [x1, y1, x2, y2] = [num(w?.x1), num(w?.y1), num(w?.x2), num(w?.y2)];
      if ([x1, y1, x2, y2].includes(null)) continue;
      const isDoor = w.type === 'door', dc = Math.round(Number(w?.dc));
      // A door may be locked (the table will not open it until the DM unlocks it) or secret (it is a plain wall to everyone until the DM reveals it); dc is the check to pick the lock or spot the door.
      walls.push({ x1, y1, x2, y2, type: isDoor ? 'door' : w.type === 'window' ? 'window' : w.type === 'fence' ? 'fence' : 'wall', open: Boolean(w.open) && !(isDoor && w.secret), ...(isDoor && w.locked ? { locked: true } : {}), ...(isDoor && w.secret ? { secret: true } : {}), ...(isDoor && dc >= 5 && dc <= 30 ? { dc } : {}) });
    }
    const starts = [];
    for (const s of Array.isArray(body?.starts) ? body.starts.slice(0, 200) : []) {
      const name = String(s?.name ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
      const [x, y] = [num(s?.x), num(s?.y)];
      const desc = String(s?.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const label = String(s?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);        // how the name is written on the DM picture (capitals, apostrophes): the pin name itself is a lower-case slug
      const radius = Math.max(0, Math.min(12, Math.round((Number(s?.radius) || 0) * 2) / 2));          // squares: the arrival area around the pin
      if (name && x !== null && y !== null && !(name === 'start' && starts.some((o) => o.name === 'start'))) starts.push({ name, x, y, ...(radius ? { radius } : {}), ...(desc ? { desc } : {}), ...(label ? { label } : {}), ...(s?.dmOnly === true ? { dmOnly: true } : {}), ...(s?.known === true ? { known: true } : {}) });
    }
    // Light sources from a .dd2vtt file (image pixels; range in squares). Kept for the lighting work.
    const lights = [];
    for (const l of Array.isArray(body?.lights) ? body.lights.slice(0, 500) : []) {
      const [x, y, range, intensity] = [num(l?.x), num(l?.y), num(l?.range), num(l?.intensity)];
      if ([x, y, range].includes(null)) continue;
      lights.push({ x, y, range, intensity: intensity ?? 1, color: /^[0-9a-f]{6,8}$/i.test(String(l?.color ?? '')) ? String(l.color).toLowerCase() : 'ffffff', ...(l?.flicker === true ? { flicker: true } : {}), ...(l?.on === false ? { on: false } : {}), ...(['brazier', 'torch', 'campfire', 'lantern', 'crystal', 'candle', 'lava'].includes(l?.kind) ? { kind: l.kind } : {}), ...(String(l?.name ?? '').trim() ? { name: String(l.name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) } : {}) });
    }
    // Difficult terrain: rectangles in image pixels. Moving into a square whose centre is inside one costs double.
    const difficult = [];
    for (const d of Array.isArray(body?.difficult) ? body.difficult.slice(0, 600) : []) {
      const [x, y, w, h] = [num(d?.x), num(d?.y), num(d?.w), num(d?.h)];
      if ([x, y, w, h].includes(null) || w <= 0 || h <= 0) continue;
      difficult.push({ x, y, w, h });
    }
    // Rooms (rectangles in image pixels) that the object-top rule must not reveal, and secret doors kept for the DM (both written by scripts/maps/build-walls-from-layout.mjs).
    const rooms = [];
    for (const r of Array.isArray(body?.rooms) ? body.rooms.slice(0, 300) : []) { const v = Array.isArray(r) ? r.map(num) : []; if (v.length === 4 && !v.includes(null)) rooms.push(v); }
    const secrets = [];
    for (const sc of Array.isArray(body?.secrets) ? body.secrets.slice(0, 100) : []) { const [x1, y1, x2, y2] = [num(sc?.x1), num(sc?.y1), num(sc?.x2), num(sc?.y2)]; if (![x1, y1, x2, y2].includes(null)) secrets.push({ name: String(sc?.name ?? '').slice(0, 80), x1, y1, x2, y2, type: 'wall', open: false }); }
    const config = { squares: deps.int(body?.squares, 50, 5, 400), walls, starts };
    if (typeof body?.name === 'string') config.name = body.name.trim().slice(0, 80);
    if (typeof body?.publisher === 'string') config.publisher = body.publisher.trim().slice(0, 40);
    if (rooms.length) config.rooms = rooms;
    if (secrets.length) config.secrets = secrets;
    if (difficult.length) config.difficult = difficult;
    if (lights.length) config.lights = lights;
    // Animated regions drawn over the picture (public/js/effects.js): a river or stream (a polygon, with the centre line it flows along), lava, standing water. Coordinates are image pixels.
    const effects = [];
    for (const e of Array.isArray(body?.effects) ? body.effects.slice(0, 60) : []) {
      const type = ['river', 'lava', 'water'].includes(e?.type) ? e.type : null;
      const pts = (list, max) => (Array.isArray(list) ? list.slice(0, max) : []).map((p) => ({ x: num(p?.x), y: num(p?.y) })).filter((p) => p.x !== null && p.y !== null);
      const points = pts(e?.points, 600), path = pts(e?.path, 300);
      if (!type || points.length < 3) continue;
      effects.push({ id: String(e?.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `${type}-${effects.length + 1}`, type, points, ...(path.length >= 2 ? { path } : {}), speed: Math.max(0.1, Math.min(4, num(e?.speed) ?? 1)), ...(/^[0-9a-f]{6}$/i.test(String(e?.color ?? '')) ? { color: String(e.color).toLowerCase() } : {}), ...(e?.hazard === true ? { hazard: true } : {}) });
    }
    if (effects.length) config.effects = effects;
    // Light zones: areas of one map with their own light, as polygons in image pixels. level: bright, dim, dark, or time (follows the time of day: bright by day, dim at dawn and dusk, dark at night). Later zones win where they overlap.
    const zones = [];
    for (const z of Array.isArray(body?.lightZones) ? body.lightZones.slice(0, 40) : []) {
      const points = (Array.isArray(z?.points) ? z.points.slice(0, 400) : []).map((p) => ({ x: num(p?.x), y: num(p?.y) })).filter((p) => p.x !== null && p.y !== null);
      const level = ['bright', 'dim', 'dark', 'time'].includes(z?.level) ? z.level : null;
      if (!level || points.length < 3) continue;
      let id = String(z?.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `zone-${zones.length + 1}`;
      for (let n = 2, base = id.slice(0, 36); zones.some((o) => o.id === id); n++) id = `${base}-${n}`;       // ids are unique, so a zone can be told from another with the same name
      zones.push({ id, name: String(z?.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || id, level, points });
    }
    if (zones.length) config.lightZones = zones;
    // Text labels drawn by code over a regional map (public/js/map-labels.js): region names, place names and trail names written along a path. Coordinates are image pixels; `size` is the letter height in picture pixels, `rot` degrees for a straight label.
    const labels = [];
    for (const l of Array.isArray(body?.labels) ? body.labels.slice(0, 60) : []) {
      const kind = ['region', 'place', 'trail'].includes(l?.kind) ? l.kind : null;
      const text = String(l?.text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
      const path = (Array.isArray(l?.path) ? l.path.slice(0, 200) : []).map((p) => ({ x: num(p?.x), y: num(p?.y) })).filter((p) => p.x !== null && p.y !== null);
      if (!kind || !text || (kind === 'trail' && path.length < 2)) continue;
      let x = num(l?.x), y = num(l?.y);
      if ((x === null || y === null) && path.length >= 2) { const m = path[Math.floor(path.length / 2)]; x = m.x; y = m.y; }
      if (x === null || y === null) continue;
      const size = num(l?.size), rot = num(l?.rot);
      let id = String(l?.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `label-${labels.length + 1}`;
    for (let n = 2; labels.some((o) => o.id === id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`.slice(0, 40);
      labels.push({ id, text, kind, x, y, ...(size !== null && size > 0 ? { size: Math.min(2000, size) } : {}), ...(rot !== null && kind !== 'trail' ? { rot: Math.max(-180, Math.min(180, rot)) } : {}), ...(path.length >= 2 ? { path } : {}) });
    }
    if (labels.length) config.labels = labels;
    // How bright the place is before any light source: daylight (bright), a lit room or dusk (dim), or darkness.
    if (['bright', 'dim', 'dark'].includes(body?.light)) config.light = body.light;
    if (['none', 'forest', 'night', 'wind', 'cave', 'dungeon', 'tavern', 'town', 'rain', 'fire'].includes(body?.ambience)) config.ambience = body.ambience;
    if (/^[0-9a-f]{6,8}$/i.test(String(body?.ambient ?? ''))) config.ambient = String(body.ambient).toLowerCase();
    if (MOODS.some((m) => m.id && m.id === body?.mood)) config.mood = body.mood;            // a mood theme chosen in the map editor (lib/market.js MOODS)
    if (body?.fog === false) config.fog = false;                                     // false: players see this map whole, with no fog of war (the default for a battle map is fog on)
    if (body?.objectTops === false) config.objectTops = false;                      // false: the inside of a small closed wall ring (a boulder, a tent) stays hidden; the default shows the top of one that is seen
    if (['battle', 'camp', 'town', 'regional'].includes(body?.kind)) config.kind = body.kind;                      // the type of map chosen in the map tools
    if (body?.tiles === 'hex') { config.tiles = 'hex'; config.hexSize = Math.max(20, Math.min(260, Math.round(Number(body?.hexSize) || 95))); }       // regional maps: hexagons, one hex is 5 miles (squares are the default and need no entry)
    if (body?.source === 'dd2vtt') config.source = 'dd2vtt';
    // Versions of one place (a day and a night map, a summer and a winter map) share a group and have a variant name each.
    const slug = (v, max) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
    if (slug(body?.group, 40)) {
      config.group = slug(body.group, 40);
      config.variant = slug(body?.variant, 20) || 'main';
    }
    return config;
  }

  app.get('/api/map-config', deps.asyncRoute(async (req, res) => {
    try {
      const config = await readMapConfig(req.query.map);
      const { index } = await ensureSets();
      const hit = index.get(deps.currentMapName(req.query.map));
      res.json({ config, setVersion: hit ? hit.set.version || 1 : 0 });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      res.json({ config: null });
    }
  }));

  // Which maps have saved config, and where it came from (source is 'dd2vtt' for maps set up from a Universal VTT file).
  app.get('/api/map-configs', deps.asyncRoute(async (_req, res) => {
    const out = [];
    // Battle and camp maps (in any campaign's list) need a start pin; town and regional maps do not.
    const needsPin = new Set();
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      try { for (const m of await deps.mapsForCampaign(dirent.name)) if (m.kind === 'battle' || m.kind === 'camp') needsPin.add(m.url.split('/').pop()); } catch { /* unreadable campaign */ }
    }
    const { index } = await ensureSets();
    for (const [file] of [...index].sort((x, y) => x[0].localeCompare(y[0]))) {
      const c = configFromSet(index.get(file).set, file);
      if (!c) continue;
      const start = (c.starts || []).find((s) => s && s.name === 'start');
      out.push({ map: file, source: c.source || null, walls: (c.walls || []).length, group: c.group || null, variant: c.variant || null, squares: Number(c.squares) || 0, light: c.light || 'bright', ambience: c.ambience || '', startPin: start ? { x: start.x, y: start.y } : null,
        needsStart: needsPin.has(file), missingStart: needsPin.has(file) && !start, pins: (c.starts || []).length });
    }
    res.json({ configs: out });
  }));

  // Every map picture with what is known about it, for the Maps page in the map tools: kind (from the campaigns that use it, else guessed from the set-up), tiles, counts, whether a DM version exists, and the campaigns using it.
  app.get('/api/map-library', deps.asyncRoute(async (_req, res) => {
    const files = (await deps.pictureFiles()).sort();
    const kinds = new Map(), used = new Map();
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      try { for (const m of await deps.mapsForCampaign(dirent.name)) { const f = m.url.split('/').pop(); if (!kinds.has(f)) kinds.set(f, m.kind); used.set(f, [...(used.get(f) || []), dirent.name]); } } catch { /* unreadable campaign */ }
    }
    const dmFiles = new Set((await readdir(deps.DM_MAP_DIR).catch(() => [])).map((f) => f.replace(/\.[^.]+$/, '')));
    const out = [];
    for (const f of files) {
      const c = await readMapConfig(f);
      const stem = f.replace(/\.[^.]+$/, '');
      const origin = c?.publisher || originOf(f);
      const kind = kinds.get(f) || (c?.tiles === 'hex' || /coast|region|world/i.test(f) ? 'regional' : /phandalin|town|village/i.test(f) ? 'town' : 'battle');       // pictures no campaign lists are guessed from their set-up and name
      out.push({ file: f, url: '/uploads/' + f, kind, origin, tiles: c?.tiles === 'hex' ? 'hex' : 'square', setUp: Boolean(c), walls: (c?.walls || []).filter((w) => w.type !== 'door').length, doors: (c?.walls || []).filter((w) => w.type === 'door').length, lights: (c?.lights || []).length, pins: (c?.starts || []).length, hasStart: Boolean((c?.starts || []).find((s) => s.name === 'start')), difficult: (c?.difficult || []).length, mood: c?.mood || '', group: c?.group || '', variant: c?.variant || '', dmVersion: dmFiles.has(stem), campaigns: used.get(f) || [] });
    }
    res.json({ maps: out });
  }));

  // Map sets: one entry per place, from the set files (data/mapsets/<guid>.json). GET /api/mapsets lists summaries, GET /api/mapsets/:guid returns the whole file, GET /api/mapsets/by-picture?file= finds the set of a picture.
  async function setSummaries() {
    const { docs } = await ensureSets();
    const listed = {};
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      try { for (const m of await deps.mapsForCampaign(dirent.name)) { const f = m.url.split('/').pop(); listed[f] = { kind: listed[f]?.kind || m.kind, campaigns: [...(listed[f]?.campaigns || []), dirent.name] }; } } catch { /* unreadable campaign */ }
    }
    const dmPictures = new Set((await readdir(deps.DM_MAP_DIR).catch(() => [])).map((f) => f.replace(/\.[^.]+$/, '')));
    const sizes = {};
    for (const doc of docs.values()) for (const lv of doc.levels) for (const l of lv.looks) { try { const fh = await open(picturePath(l.player)); const b = Buffer.alloc(65536); const { bytesRead } = await fh.read(b, 0, 65536, 0); await fh.close(); const sz = imageSize(b.subarray(0, bytesRead)); if (sz) sizes[l.player] = sz; } catch { /* unreadable picture */ } }
    return [...docs.values()].map((d) => summarizeSet(d, { sizes, listed, dmPictures })).sort((a, b) => a.name.localeCompare(b.name));
  }
  app.get('/api/mapsets', deps.asyncRoute(async (req, res) => { const all = await setSummaries(); res.json({ sets: req.query.archived === '1' ? all : all.filter((s) => !s.archived), archivedCount: all.filter((s) => s.archived).length }); }));
  // Archive hides a place from the lists (Map Test, Maps) without deleting anything; Delete removes the set file and its pictures for good, and is refused while a campaign still lists the place.
  app.post('/api/mapsets/:guid/archive', localOnly, deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const doc = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!doc) return res.status(404).json({ error: 'No such map set' });
    if (req.body?.archived === false) delete doc.archived; else doc.archived = true;
    doc.version = (doc.version || 1) + 1;
    await saveSet(doc); await loadSets();
    res.json({ ok: true, archived: Boolean(doc.archived) });
  }));
  // Clone: a full, independent copy of a place: new id, its pictures copied to new file names (vtt-pack- for a copy of a purchased map, vtt- otherwise), walls, doors, pins, lights and terrain copied.
  // Deleting either one never touches the other's files. A copy of a purchased or Wizards of the Coast map keeps `derivedFrom` and its picture names start with vtt-pack-, so the Market still refuses it.
  app.get('/api/mapsets/:guid/blueprint.svg', deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const doc = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!doc) return res.status(404).json({ error: 'No such map set' });
    await writeBlueprint(doc);
    res.type('image/svg+xml').sendFile(path.join(packetDir(doc.id), 'blueprint.svg'));
  }));
  // Add a look (a time of day: night, dusk, rain...) to a place: its picture must already be uploaded (public/uploads) or in the packet; the walls, doors, pins and terrain stay shared, the look gets its own light level, lights and sound.
  app.post('/api/mapsets/:guid/looks', localOnly, deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const doc = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!doc) return res.status(404).json({ error: 'No such map set' });
    const time = String(req.body?.time ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
    const picture = path.basename(String(req.body?.picture ?? ''));
    if (!time || time === 'main') return res.status(400).json({ error: 'Give the look a time, such as night, dusk or rain.' });
    const inPacket = existsSync(path.join(packetDir(doc.id), picture));
    if (!inPacket && !(await deps.pictureFiles()).includes(picture)) return res.status(404).json({ error: 'That picture is not uploaded.' });
    const level = doc.levels[0];
    if (level.looks.some((l) => l.time === time)) return res.status(409).json({ error: 'This place already has a ' + time + ' look.' });       // checked before any file is touched
    // A picture that a place of its own was already made for (a new upload is adopted by the next set built) is moved into this packet, and that stray place goes.
    const elsewhere = PACKET_FILES.get(picture);
    if (elsewhere && path.dirname(elsewhere) !== packetDir(doc.id)) {
      const owner = SETS.index.get(picture)?.set;
      const stray = owner && owner.id !== doc.id && owner.levels.every((lv) => lv.looks.every((l) => l.player === picture)) ? owner : null;
      if (stray) { await rename(elsewhere, path.join(packetDir(doc.id), picture)); await rm(packetDir(stray.id), { recursive: true, force: true }); }       // a place built only for this picture hands it over
      else await copyFile(elsewhere, path.join(packetDir(doc.id), picture));                                                                               // a real place keeps its own picture: this one gets a copy
    }
    const first = level.looks[0];
    if (first.time === 'main') { first.time = 'day'; first.id = 'day'; }
    level.looks.push({ id: time, time, player: picture, dm: null, light: ['bright', 'dim', 'dark'].includes(req.body?.light) ? req.body.light : first.light, lights: Array.isArray(req.body?.lights) ? normalizeMapConfig({ lights: req.body.lights }).lights || [] : JSON.parse(JSON.stringify(first.lights || [])), ambient: /^[0-9a-f]{6,8}$/i.test(String(req.body?.ambient ?? '')) ? String(req.body.ambient).toLowerCase() : '', ambience: ['none', 'forest', 'night', 'wind', 'cave', 'dungeon', 'tavern', 'town', 'rain', 'fire'].includes(req.body?.ambience) ? req.body.ambience : first.ambience || '', mood: first.mood || '' });
    doc.version = (doc.version || 1) + 1;
    await saveSet(doc);
    for (const other of [...docs.values()]) {        // a place that was built on its own for this very picture (an upload is adopted by the next set built) has nothing left
      if (other.id !== doc.id && other.levels.every((lv) => lv.looks.every((l) => l.player === picture))) await rm(packetDir(other.id), { recursive: true, force: true });
    }
    await loadSets();
    res.json({ ok: true, looks: level.looks.map((l) => ({ time: l.time, player: l.player })) });
  }));
  app.post('/api/mapsets/:guid/clone', localOnly, deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const src = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!src) return res.status(404).json({ error: 'No such map set' });
    const doc = JSON.parse(JSON.stringify(src));
    doc.id = newGuid();
    await mkdir(packetDir(doc.id), { recursive: true });
    const sourceOrigin = src.publisher || originOf(src.levels[0].looks[0].player);
    const fromPack = sourceOrigin === 'Map Adventurer' || sourceOrigin === 'Wizards of the Coast' || Boolean(src.derivedFrom);
    const taken = new Set(await deps.pictureFiles());
    const rename = new Map();
    const copyPicture = async (file) => {
      if (rename.has(file)) return rename.get(file);
      const ext = path.extname(file), stem = path.basename(file, ext).replace(/^(lmop|dnd|vtt|vtt-pack)-/, '');
      let n = 1, name;
      do { name = (fromPack ? 'vtt-pack-' : 'vtt-') + stem + (n > 1 ? '-' + n : '-copy') + ext; n++; } while (taken.has(name));
      taken.add(name);
      await copyFile(picturePath(file), path.join(packetDir(doc.id), name));
      rename.set(file, name);
      return name;
    };
    for (const lv of doc.levels) for (const l of lv.looks) {
      l.player = await copyPicture(l.player);
      if (l.dm && !String(l.dm).startsWith('data/dm-maps:')) l.dm = await copyPicture(l.dm);
      else if (l.dm) {                       // a DM picture kept in data/dm-maps follows the new picture name
        const stem = String(l.dm).slice('data/dm-maps:'.length);
        for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) { try { await copyFile(path.join(deps.DM_MAP_DIR, stem + ext), path.join(deps.DM_MAP_DIR, path.basename(l.player, path.extname(l.player)) + ext)); l.dm = 'data/dm-maps:' + path.basename(l.player, path.extname(l.player)); break; } catch { /* not this extension */ } }
      }
    }
    doc.slug = path.basename(doc.levels[0].looks[0].player, path.extname(doc.levels[0].looks[0].player)); doc.version = 1; doc.createdAt = new Date().toISOString(); delete doc.archived;
    const wanted = String(req.body?.publisher ?? '').trim().slice(0, 40);
    if (fromPack) doc.derivedFrom = src.derivedFrom || sourceOrigin;
    if (wanted) doc.publisher = wanted; else if (src.publisher) doc.publisher = src.publisher; else delete doc.publisher;
    if (typeof req.body?.name === 'string' && req.body.name.trim()) doc.name = req.body.name.trim().slice(0, 80);
    await saveSet(doc); await loadSets();
    res.json({ ok: true, guid: doc.id, pictures: [...rename.values()] });
  }));
  app.delete('/api/mapsets/:guid', localOnly, deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const doc = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!doc) return res.status(404).json({ error: 'No such map set' });
    const files = [...new Set(doc.levels.flatMap((lv) => lv.looks.flatMap((l) => [l.player, l.dm && !String(l.dm).startsWith('data/dm-maps:') ? l.dm : null].filter(Boolean))))];
    const users = [];
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      try { for (const m of await deps.mapsForCampaign(dirent.name)) if (files.includes(m.url.split('/').pop())) users.push(dirent.name); } catch { /* unreadable campaign */ }
    }
    if (users.length) return res.status(409).json({ error: 'A campaign still lists this map (' + [...new Set(users)].join(', ') + '). Remove it from the campaign first, or archive it instead.' });
    await rm(packetDir(doc.id), { recursive: true, force: true });           // the whole packet: the set file and every picture
    for (const f of files) { await rm(path.join(deps.UPLOAD_DIR, f), { force: true }); await rm(mapConfigFile(f), { force: true }).catch(() => {}); }
    await loadSets();
    res.json({ ok: true, removed: files });
  }));
  app.get('/api/mapsets/by-picture', deps.asyncRoute(async (req, res) => {
    const { index } = await ensureSets();
    const hit = index.get(path.basename(String(req.query.file ?? '')));
    if (!hit) return res.status(404).json({ error: 'No map set holds that picture' });
    res.json({ guid: hit.set.id, time: hit.look.time, level: hit.level.n });
  }));
  app.get('/api/mapsets/:guid', deps.asyncRoute(async (req, res) => {
    const { docs } = await ensureSets();
    const doc = isGuid(req.params.guid) ? docs.get(req.params.guid.toLowerCase()) : null;
    if (!doc) return res.status(404).json({ error: 'No such map set' });
    res.json({ set: doc });
  }));

  // The numbered areas of the adventure module on a map (data/campaigns/<campaign>/areas.json: picture file -> [{n, name}]); Map Test turns them into pins.
  app.get('/api/map-areas', deps.asyncRoute(async (req, res) => {
    const file = path.basename(String(req.query.map ?? ''));
    const areas = [];
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      const doc = await deps.readJson(path.join(CAMPAIGNS_DIR, dirent.name, 'areas.json'), {});
      const list = doc[file];
      // what the adventure text says about each area: the section under its '## N. NAME' heading, tidied and capped (the pin card shows it)
      let guide = '';
      const source = doc._sources?.[file];
      if (source) guide = await readFile(path.join(CAMPAIGNS_DIR, dirent.name, path.basename(source)), 'utf8').catch(() => '');
      const sectionOf = (n) => {
        const m = new RegExp('^## ' + n + '\\. .*', 'm').exec(guide);
        if (!m) return '';
        const rest = guide.slice(m.index + m[0].length), next = /^## /m.exec(rest);
        return rest.slice(0, next ? next.index : rest.length).replace(/\s+/g, ' ').trim().slice(0, 3200);
      };
      if (Array.isArray(list)) { for (const a of list) if (Number.isFinite(a?.n) && typeof a?.name === 'string' && !areas.some((o) => o.n === a.n)) areas.push({ n: a.n, name: a.name.slice(0, 60), text: sectionOf(a.n) }); }
    }
    // maps with no numbered areas: areas.json `_pinGuides` {picture: {file, heading, pins[]}} gives the named pins the section of the adventure under that heading
    const pinGuides = {};
    for (const dirent of await readdir(CAMPAIGNS_DIR, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory()) continue;
      const g = (await deps.readJson(path.join(CAMPAIGNS_DIR, dirent.name, 'areas.json'), {}))._pinGuides?.[file];
      if (!g || !Array.isArray(g.pins)) continue;
      const text = await readFile(path.join(CAMPAIGNS_DIR, dirent.name, path.basename(String(g.file))), 'utf8').catch(() => '');
      const at = text.toUpperCase().indexOf('## ' + String(g.heading).toUpperCase());
      if (at < 0) continue;
      const rest = text.slice(at).replace(/^## .*\n/, ''), next = /^## /m.exec(rest);
      const guide = rest.slice(0, next ? next.index : rest.length).replace(/\s+/g, ' ').trim().slice(0, 3200);
      for (const pin of g.pins) pinGuides[String(pin)] = guide;
    }
    res.json({ areas: areas.sort((a, b) => a.n - b.n), pinGuides });
  }));

  app.put('/api/map-config', localOnly, deps.asyncRoute(async (req, res) => {
    const config = normalizeMapConfig(req.body);
    const file = req.query.map;
    // A page that was open before the map changed elsewhere (another tab, a script) must not write its old copy over the newer one.
    if (Number.isFinite(req.body?.baseVersion)) {
      const { index } = await ensureSets();
      const hit = index.get(deps.currentMapName(file));
      if (hit && (hit.set.version || 1) !== req.body.baseVersion) return res.status(409).json({ error: 'This map was changed somewhere else since this page loaded it. Reload the page, then make your change again.', version: hit.set.version || 1 });
    }
    // Map Test sends `lightsEdited` when the lights were changed there (added, deleted, all removed): then its list is the truth, even an empty one. Otherwise keep the ones already saved.
    if (req.body?.lightsEdited === true && !config.lights) config.lights = [];
    if (!config.lights) {
      try {
        const old = await readMapConfig(file); if (!old) throw new Error('none');
        if (Array.isArray(old.lights) && old.lights.length) config.lights = old.lights;
        if (old.ambient && !config.ambient) config.ambient = old.ambient;
        if (old.light && !config.light) config.light = old.light;
        if (old.ambience && !config.ambience) config.ambience = old.ambience;
        if (old.mood && !config.mood && req.body?.mood === undefined) config.mood = old.mood;
        if (old.tiles === 'hex' && req.body?.tiles === undefined) { config.tiles = 'hex'; config.hexSize = old.hexSize; }
        if (old.kind && req.body?.kind === undefined) config.kind = old.kind;
        if (old.publisher && req.body?.publisher === undefined) config.publisher = old.publisher;
        if (req.body?.difficult === undefined && Array.isArray(old.difficult) && old.difficult.length) config.difficult = old.difficult;
      } catch { /* no earlier config */ }
    }
    if (req.body?.lightZones === undefined) {        // a caller that does not send the light zones keeps what the set has
      try { const old = await readMapConfig(file); if (old && Array.isArray(old.lightZones) && old.lightZones.length) config.lightZones = old.lightZones; } catch { /* no earlier config */ }
    }
    if (req.body?.labels === undefined) {          // Map Test does not send the labels: keep what the set has ([] removes them)
      try { const old = await readMapConfig(file); if (old && Array.isArray(old.labels) && old.labels.length) config.labels = old.labels; } catch { /* no earlier config */ }
    }
    if (req.body?.effects === undefined) {         // Map Test does not send the animated regions: keep what the set has
      try { const old = await readMapConfig(file); if (old && Array.isArray(old.effects) && old.effects.length) config.effects = old.effects; } catch { /* no earlier config */ }
    }
    if (!config.rooms || !config.secrets) {       // Map Test does not send these: keep what the wall builder saved
      try {
        const old = await readMapConfig(file); if (!old) throw new Error('none');
        if (Array.isArray(old.rooms) && !config.rooms) config.rooms = old.rooms;
        if (Array.isArray(old.secrets) && !config.secrets) config.secrets = old.secrets;
      } catch { /* no earlier config */ }
    }
    // A body that does not mention a field keeps what the set has (a call that only sets the publisher or the name must not empty the map).
    { const old = await readMapConfig(file).catch(() => null);
      if (old) for (const k of ['squares', 'walls', 'starts', 'difficult', 'light', 'ambience', 'ambient', 'mood', 'kind', 'tiles', 'hexSize', 'group', 'variant', 'publisher', 'name', 'source']) if (req.body?.[k] === undefined && old[k] !== undefined) config[k] = old[k]; }
    await writeMapConfig(file, config);
    const { index: after } = await ensureSets();
    const now = after.get(deps.currentMapName(file));
    res.json({ ok: true, walls: config.walls.length, version: now ? now.set.version || 1 : 0 });
  }));

  return { ensureSets, loadSets, normalizeMapConfig, picturePath, readMapConfig, setsLoaded, packetPath, packetFileNames, writeMapConfig };
}
