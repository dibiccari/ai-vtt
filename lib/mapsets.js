// Map sets, step 1 (docs/map-set-format.md): a read-only view that BUILDS sets from the files that exist today, without moving anything. A set is one place: levels, and for each level
// its looks (a player picture, an optional DM picture, optional times such as day and night). Today every set has one level; links are an empty list until the editor can make them.
// Pure function: the server hands it what it read (pictures, set-ups, DM picture names, which campaigns list which picture) and gets the sets back.

const KINDS = ['battle', 'camp', 'town', 'regional'];
const stemOf = (file) => String(file).replace(/\.[^.]+$/, '');
const WORDS = { copy: '(copy)', agathas: "Agatha's", barthens: "Barthen's", wester: 'Wester', northswordcoast: 'Sword Coast', mutfjjbo: '' };
const pretty = (s) => String(s).replace(/^(vtt|dnd|lmop|mkt)-/, '').replace(/(-ours|-v2)$/, '').split(/[-_]+/).filter(Boolean).map((w) => (w in WORDS ? WORDS[w] : w.charAt(0).toUpperCase() + w.slice(1))).filter(Boolean).join(' ');
// The publisher: Map Adventurer (the purchased pack, lmop-), Wizards of the Coast (dnd-), Explorer (ours: made here, vtt-, and the dnd- pictures marked -ours), Market, or Other for an upload.
const originOf = (f) => (/-ours\./.test(f) ? 'Explorer' : /^lmop-phandalin-/.test(f) ? 'Wizards of the Coast' : /^lmop-/.test(f) ? 'Map Adventurer' : /^dnd-/.test(f) ? 'Wizards of the Coast' : /^mkt-/.test(f) ? 'Market' : /^vtt-/.test(f) ? 'Explorer' : 'Other');
export { originOf };

// Pixel size of a PNG or JPEG from its header bytes (no image library): { w, h } or null.
export function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const t = buf[i + 1]; if (t >= 0xc0 && t <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(t)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); }
    }
  } catch { /* unreadable header */ }
  return null;
}
// The size of a map in its game units: squares of 5 ft for battle and camp maps, hexagons of 5 miles for regional maps, nothing for a town (no tiles).
export function gameSize(kind, px, squares, hexSize) {
  if (!px) return null;
  // flat-top hexagons: hexSize is flat edge to flat edge (vertical) and the columns are 0.866 of it apart
  if (kind === 'regional' && hexSize > 0) { const across = px.w / (hexSize * 0.866), down = px.h / hexSize; return { unit: 'miles', width: Math.round(across * 5), height: Math.round(down * 5), tilesAcross: Math.round(across * 10) / 10, tilesDown: Math.round(down * 10) / 10 }; }
  if ((kind === 'battle' || kind === 'camp') && squares > 0) { const sq = px.w / squares, down = px.h / sq; return { unit: 'ft', width: squares * 5, height: Math.round(down) * 5, tilesAcross: squares, tilesDown: Math.round(down) }; }
  return null;
}

// A picture's place in a set: which set it belongs to and whether it is the player or the DM face.
//   dnd-dm-phandalin.jpg -> set dnd-phandalin, DM      dnd-phandalin-playerversion.jpg -> set dnd-phandalin, player
//   lmop-phandalin-dm-version.jpg -> set lmop-phandalin, DM      lmop-phandalin-player-version.jpg -> set lmop-phandalin, player
export function facePlace(file) {
  let stem = stemOf(file), role = 'player', explicit = false;
  if (/^(dnd|lmop)-dm-/.test(stem)) { stem = stem.replace(/^(dnd|lmop)-dm-/, '$1-'); role = 'dm'; explicit = true; }
  if (/-(dm-?version|dmversion)$/.test(stem)) { stem = stem.replace(/-(dm-?version|dmversion)$/, ''); role = 'dm'; explicit = true; }
  if (/-(player-?version|playerversion)$/.test(stem)) { stem = stem.replace(/-(player-?version|playerversion)$/, ''); role = 'player'; explicit = true; }
  return { key: stem, role, explicit };
}

export function guessKind(file, config, listedKind) {
  if (KINDS.includes(config?.kind)) return config.kind;              // the type chosen in the map tools wins
  if (KINDS.includes(listedKind)) return listedKind;
  if (config?.tiles === 'hex' || /coast|region|world/i.test(file)) return 'regional';
  if (/phandalin|town|village/i.test(file)) return 'town';
  return 'battle';
}

// pictures: file names; configs: { file -> saved set-up or null }; dmPictures: Set of stems that have a DM picture in data/dm-maps; listed: { file -> { kind, campaigns[] } } from the campaigns.
export function buildSets({ pictures, configs = {}, dmPictures = new Set(), listed = {}, sizes = {} }) {
  const files = [...pictures].sort();
  // 1. pictures that are only a face of another picture (DM or player version) are folded into it
  const byKey = new Map();
  for (const f of files) { const p = facePlace(f); if (!byKey.has(p.key)) byKey.set(p.key, []); byKey.get(p.key).push({ file: f, ...p }); }
  const looks = [];            // { setKey, time, player, dm, config }
  const faces = new Map();     // file -> true when it was folded into another entry
  for (const [key, list] of byKey) {
    const dms = list.filter((x) => x.role === 'dm'), players = list.filter((x) => x.role === 'player');
    const explicitPlayer = players.filter((x) => x.explicit);
    const main = explicitPlayer.length ? explicitPlayer : players;
    if (dms.length && main.length) {                                    // the DM picture goes with the player picture of the same place
      const player = main[0];
      for (const d of dms) faces.set(d.file, true);
      looks.push({ setKey: key, player: player.file, dm: dms[0].file });
      faces.set(player.file, true);
      for (const x of players) if (x.file !== player.file) { looks.push({ setKey: stemOf(x.file) === key ? key + '-copy' : stemOf(x.file), player: x.file, dm: null }); faces.set(x.file, true); }       // another plain picture of the place stays its own entry
      continue;
    }
    if (!dms.length && explicitPlayer.length && players.length > explicitPlayer.length) {         // a "player version" next to the plain picture of the same place: the plain one is the DM's face (the labelled one)
      const player = explicitPlayer[0], plain = players.find((x) => !x.explicit);
      looks.push({ setKey: key, player: player.file, dm: plain.file });
      faces.set(player.file, true); faces.set(plain.file, true);
      for (const x of players) if (!faces.has(x.file)) looks.push({ setKey: stemOf(x.file) === key ? key + '-copy' : stemOf(x.file), player: x.file, dm: null });
      continue;
    }
    for (const x of list) if (!faces.has(x.file)) looks.push({ setKey: list.length === 1 ? key : stemOf(x.file), player: x.file, dm: null });       // a lone picture is its own place; several plain ones of one place stay apart
  }
  // 2. group looks that are times of one level (the config's group and variant: camp day and night)
  const sets = new Map();
  for (const lk of looks) {
    const cfg = configs[lk.player] || null;
    const group = cfg?.group || '';
    const id = group ? group : lk.setKey;
    if (!sets.has(id)) sets.set(id, { id, looks: [] });
    sets.get(id).looks.push({ ...lk, config: cfg, time: group ? (cfg.variant || 'main') : 'main' });
  }
  // 3. shape each set
  const out = [];
  for (const { id, looks: ls } of sets.values()) {
    ls.sort((a, b) => (['day', 'night'].indexOf(a.time) + 1 || 99) - (['day', 'night'].indexOf(b.time) + 1 || 99) || a.time.localeCompare(b.time));
    const first = ls[0], cfg = first.config || {};
    const listing = ls.map((l) => listed[l.player]).find(Boolean) || null;
    const kind = guessKind(first.player, cfg, listing?.kind);
    const campaigns = [...new Set(ls.flatMap((l) => listed[l.player]?.campaigns || []))];
    const level = {
      n: 1, name: 'Main level', squares: Number(cfg.squares) || 0, walls: (cfg.walls || []).filter((w) => w.type !== 'door').length, doors: (cfg.walls || []).filter((w) => w.type === 'door').length,
      pins: (cfg.starts || []).length, hasStart: Boolean((cfg.starts || []).find((s) => s.name === 'start')), difficult: (cfg.difficult || []).length,
      px: sizes[first.player] || null, game: gameSize(kind, sizes[first.player] || null, Number(cfg.squares) || 0, Number(cfg.hexSize) || 0),
      isRevealed: typeof cfg.isRevealed === 'boolean' ? cfg.isRevealed : kind === 'regional',
      looks: ls.map((l) => ({ time: l.time, player: l.player, dm: l.dm || (dmPictures.has(stemOf(l.player)) ? 'data/dm-maps:' + stemOf(l.player) : null), light: l.config?.light || 'bright', lights: (l.config?.lights || []).length, ambience: l.config?.ambience || '', mood: l.config?.mood || '', setUp: Boolean(l.config) }))
    };
    out.push({
      id, name: pretty(id), kind, tiles: kind === 'regional' ? 'hex' : kind === 'town' ? 'none' : 'square', origin: originOf(first.player), campaigns,
      levels: [level], links: [], times: ls.map((l) => l.time), hasDm: level.looks.some((l) => l.dm), hasStart: level.hasStart,
      needsStart: (kind === 'battle' || kind === 'camp') && !level.hasStart,
      picture: first.player
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
