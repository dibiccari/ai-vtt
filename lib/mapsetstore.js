// Map set files (docs/map-set-format.md, step 2): each place is ONE json file, data/mapsets/<guid>.json, holding everything about it: its name, type, tiles, mood and theme, its levels, and for each level its
// walls, doors, pins, terrain and grid (shared by every look) and its looks (the player picture, the DM picture, a day and a night look) with what belongs to one look: light level, lights, sound and mood.
// Game state is NOT in this file: fog of war, token positions and which doors are open live with the saved game, keyed by the set's guid and level, so one fog layer serves every look of a level.
// The old per-picture set-up (data/maps/<picture>.json) is still understood: `configFromSet` and `applyConfigToSet` translate between the two shapes so existing pages keep working.
import { randomUUID } from 'node:crypto';

export const newGuid = () => randomUUID();
export const isGuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? ''));
const KINDS = ['battle', 'camp', 'town', 'regional'];
const tilesOfKind = (kind) => (kind === 'regional' ? 'hex' : kind === 'town' ? 'none' : 'square');

// A set document from a set that lib/mapsets.js buildSets found (one level, its looks) and the old per-picture set-ups { picture -> config or null }.
export function docFromBuilt(built, configs, now = new Date().toISOString()) {
  const first = built.levels[0].looks[0];
  const cfg = configs[first.player] || {};
  const kind = KINDS.includes(built.kind) ? built.kind : 'battle';
  const looks = built.levels[0].looks.map((l, i) => {
    const c = configs[l.player] || {};
    return {
      id: l.time === 'main' ? 'main' : l.time, time: l.time, player: l.player, dm: l.dm || null,
      light: ['bright', 'dim', 'dark'].includes(c.light) ? c.light : 'bright', lights: Array.isArray(c.lights) ? c.lights : [], ambient: c.ambient || '', ambience: c.ambience || '', mood: c.mood || ''
    };
  });
  const level = {
    n: 1, id: 'l1', name: 'Main level', squares: Number(cfg.squares) || 0,
    walls: Array.isArray(cfg.walls) ? cfg.walls : [], starts: Array.isArray(cfg.starts) ? cfg.starts : [], difficult: Array.isArray(cfg.difficult) ? cfg.difficult : [],
    ...(Array.isArray(cfg.rooms) ? { rooms: cfg.rooms } : {}), ...(Array.isArray(cfg.secrets) ? { secrets: cfg.secrets } : {}), ...(cfg.source ? { source: cfg.source } : {}),
    isRevealed: typeof cfg.isRevealed === 'boolean' ? cfg.isRevealed : kind === 'regional' || kind === 'town', looks
  };
  return {
    format: 'vttmapset', version: 1, id: randomUUID(), slug: built.id, name: built.name, kind, tiles: tilesOfKind(kind), hexSize: Number(cfg.hexSize) || 0,
    description: '', theme: '', mood: looks[0].mood || '', createdAt: now, levels: [level], links: []
  };
}

// The old per-picture set-up for one look of a set (or null when the picture is not in the set).
export function configFromSet(set, file) {
  const level = (set.levels || []).find((lv) => (lv.looks || []).some((l) => l.player === file));
  if (!level) return null;
  const look = level.looks.find((l) => l.player === file);
  const several = level.looks.length > 1;
  const c = { squares: level.squares || 50, walls: level.walls || [], starts: level.starts || [] };
  if ((level.difficult || []).length) c.difficult = level.difficult;
  if (level.rooms) c.rooms = level.rooms;
  if (level.wallDepth > 0) c.wallDepth = level.wallDepth;
  if (level.secrets) c.secrets = level.secrets;
  if (level.source) c.source = level.source;
  if (typeof level.isRevealed === 'boolean') c.isRevealed = level.isRevealed;
  c.light = look.light || 'bright';
  if ((look.lights || []).length) c.lights = look.lights;
  if (look.ambient) c.ambient = look.ambient;
  if (look.ambience) c.ambience = look.ambience;
  if (look.mood) c.mood = look.mood;
  c.kind = set.kind;
  if (set.tiles === 'hex') { c.tiles = 'hex'; c.hexSize = set.hexSize || 95; }
  if (several) { c.group = set.slug; c.variant = look.time; }              // the old way of saying "day and night of one place"
  return c;
}

// Write a per-picture set-up (the shape Map Test and the importers use) into the set: the shared parts into the level, the look's own parts into its look.
export function applyConfigToSet(set, file, config) {
  const level = (set.levels || []).find((lv) => (lv.looks || []).some((l) => l.player === file));
  if (!level) return false;
  const look = level.looks.find((l) => l.player === file);
  level.squares = config.squares || level.squares; level.walls = config.walls || []; level.starts = config.starts || []; level.difficult = config.difficult || [];
  if (config.rooms) level.rooms = config.rooms; else delete level.rooms;
  if (config.wallDepth > 0) level.wallDepth = config.wallDepth; else delete level.wallDepth;
  if (config.secrets) level.secrets = config.secrets; else delete level.secrets;
  if (config.source) level.source = config.source; else delete level.source;
  if (typeof config.isRevealed === 'boolean') level.isRevealed = config.isRevealed;
  look.light = ['bright', 'dim', 'dark'].includes(config.light) ? config.light : look.light || 'bright';
  look.lights = config.lights || []; look.ambient = config.ambient || ''; look.ambience = config.ambience || ''; look.mood = config.mood || '';
  if (KINDS.includes(config.kind)) { set.kind = config.kind; set.tiles = tilesOfKind(config.kind); }
  else if (config.tiles === 'hex') { set.kind = 'regional'; set.tiles = 'hex'; }
  if (set.tiles === 'hex' && config.hexSize) set.hexSize = config.hexSize;
  if (look === level.looks[0] || !set.mood) set.mood = look.mood || set.mood || '';
  set.version = (set.version || 1) + 1;
  return true;
}

// picture file -> { set, level, look } for a list of set documents.
export function indexSets(sets) {
  const index = new Map();
  for (const set of sets) for (const level of set.levels || []) for (const look of level.looks || []) {
    index.set(look.player, { set, level, look });
    if (look.dm && !String(look.dm).startsWith('data/dm-maps:')) index.set(look.dm, { set, level, look, dmPicture: true });       // a DM picture that is an uploaded file belongs to its place too
  }
  return index;
}

// The pictures of a set document that has changed shape (a look removed, a picture renamed) are found by file name; this checks a document is well formed.
export function checkSetDoc(doc) {
  const problems = [];
  if (!doc || doc.format !== 'vttmapset') problems.push('not a map set file');
  else {
    if (!isGuid(doc.id)) problems.push('the id is not a guid');
    if (!KINDS.includes(doc.kind)) problems.push('unknown kind ' + doc.kind);
    if (!Array.isArray(doc.levels) || !doc.levels.length) problems.push('no levels');
    for (const lv of doc.levels || []) if (!Array.isArray(lv.looks) || !lv.looks.length) problems.push('level ' + lv.n + ' has no looks');
  }
  return problems;
}

// The summary the Maps page and Map Test list use for one set document (the same shape lib/mapsets.js buildSets gives, plus the guid).
import { originOf, gameSize } from './mapsets.js';
const stemOf = (file) => String(file).replace(/\.[^.]+$/, '');
export function summarizeSet(doc, { sizes = {}, listed = {}, dmPictures = new Set() } = {}) {
  const lv = doc.levels[0], first = lv.looks[0];
  const kind = doc.kind;
  const campaigns = [...new Set(lv.looks.flatMap((l) => listed[l.player]?.campaigns || []))];
  const looks = lv.looks.map((l) => ({ time: l.time, player: l.player, dm: l.dm || (dmPictures.has(stemOf(l.player)) ? 'data/dm-maps:' + stemOf(l.player) : null), light: l.light || 'bright', lights: (l.lights || []).length, ambience: l.ambience || '', mood: l.mood || '', setUp: true }));
  const px = sizes[first.player] || null;
  const level = {
    n: 1, name: lv.name, squares: lv.squares || 0, walls: (lv.walls || []).filter((w) => w.type !== 'door').length, doors: (lv.walls || []).filter((w) => w.type === 'door').length,
    pins: (lv.starts || []).length, hasStart: (lv.starts || []).some((s) => s.name === 'start'), difficult: (lv.difficult || []).length, px,
    game: gameSize(kind, px, lv.squares || 0, doc.hexSize || 0), isRevealed: Boolean(lv.isRevealed), looks
  };
  return {
    guid: doc.id, id: doc.slug, name: doc.name, kind, tiles: doc.tiles, origin: originOf(first.player), campaigns, levels: [level], links: doc.links || [], times: looks.map((l) => l.time),
    hasDm: looks.some((l) => l.dm), hasStart: level.hasStart, needsStart: (kind === 'battle' || kind === 'camp') && !level.hasStart, picture: first.player, version: doc.version || 1, mood: doc.mood || '', theme: doc.theme || ''
  };
}
