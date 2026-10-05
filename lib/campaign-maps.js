// The places a campaign can move the table to. The AI picks one by id (updateMap "changeMap"); the tabletop also offers them in a picker.
// Each entry says which uploaded map file it is, what it is for (this text goes to the AI), and where the party arrives.
// Coordinates are tabletop squares (50 px) on that map as the tabletop shows it. Only maps that are actually installed are offered.

const e = (id, file, name, kind, description, start, spots = {}) => ({ id, file, name, kind, description, start, spots });

// The regional map is offered in every campaign that travels (it is always in the Map picker, first).
const SWORD_COAST = e('sword-coast', /^northswordcoast-playerversion\.[a-z]+$/, 'The Sword Coast (regional map)', 'regional',
      'Regional map around Neverwinter. Use it for travel between places: the High Road, the Triboar Trail, Neverwinter, Phandalin, Thundertree, Conyberry, Old Owl Well and Leilon. This is only a regional map: the party tokens are not shown on it and there is no fog or movement limit.',
      [31, 49]);

export const CAMPAIGN_MAPS = {
  'lost-mine-of-phandelver': [
    SWORD_COAST,
    e('triboar-ambush', [/^lmop-goblin-ambush\.[a-z]+$/, /^hillside\.[a-z]+$/], 'Roadside trail in the hills (battle map)', 'battle',
      'A winding dirt trail through scrubby hills with boulders and fallen logs. Use it for roadside encounters, such as the goblin ambush on the Triboar Trail.',
      [15, 27]),
    e('phandalin', [/^lmop-phandalin-player-version\.[a-z]+$/, /^phandalin-playerversion\.[a-z]+$/], 'Phandalin (town map)', 'town',
      'The frontier town of Phandalin: the Stonehill Inn, Barthen\'s Provisions, Lionshield Coster, the Shrine of Luck, the Sleeping Giant tap house, the Townmaster\'s Hall, the Miner\'s Exchange, farms, and the ruins of Tresendar Manor on the eastern hillside. Use it for any scene inside the town. This is a town map: the party tokens are not shown on it and there is no fog or movement limit.',
      [42, 6]),
    e('cragmaw-hideout', [/^lmop-cragmaw-hideout\.[a-z]+$/, /^cragmawhideout-playerversion\.[a-z]+$/], 'Cragmaw Hideout (goblin cave)', 'battle',
      'The goblin cave beside a stream: briar-screened cave mouth, kennel, steep passage, bridge, the goblin den, twin pools and Klarg\'s cave.',
      [15, 17]),
    e('redbrand-hideout', [/^lmop-redbrand-hideout\.[a-z]+$/, /^redbrand-hide-out\.[a-z]+$/], 'Redbrand Hideout (cellars under Tresendar Manor)', 'battle',
      'The Redbrand ruffians\' tunnels and cellars beneath the ruined Tresendar Manor: guard rooms, crypt, a chasm with bridges, a pool and the lair of Glasstaff.',
      [15, 27]),
    e('thundertree', [/^lmop-thundertree\.[a-z]+$/, /^ruinsofthundertree-playerversion\.[a-z]+$/], 'Ruins of Thundertree', 'battle',
      'The ruined village of Thundertree, overgrown with twig blights and haunted by zombies, with a ruined tower and a statue in the square. Use it for anything in the village.',
      [30, 37]),
    e('cragmaw-castle', [/^lmop-cragmaw-castle-day\.[a-z]+$/, /^cragmawcastle-playerversion\.[a-z]+$/], 'Cragmaw Castle (day)', 'battle',
      'The ruined castle that serves as King Grol\'s stronghold: towers, halls, rubble, and a path leading up to it.',
      [25, 37]),
    e('cragmaw-castle-night', /^lmop-cragmaw-castle-night\.[a-z]+$/, 'Cragmaw Castle (night)', 'battle',
      'The same ruined castle at night, dark except for torchlight. Use it instead of the day map when the party arrives or fights after dark.',
      [25, 37]),
    e('camp-day', /^camp-day\.[a-z]+$/, 'Campsite (day)', 'camp',
      'A forest clearing campsite by day: a stone-ringed campfire with log benches, three tents, bedrolls and supplies, with trails leading out to the south and west. Use it when the party makes camp, rests or spends a quiet day in the wild. It is a camp map: tokens are shown, there is no fog of war.',
      [20, 19]),
    e('camp-night', /^camp-night\.[a-z]+$/, 'Campsite (night)', 'camp',
      'The same campsite at night, lit by the campfire and lanterns in the tents, dark under the trees. Use it instead of the day map when the party makes camp at dusk or night, or rests overnight. There is no fog of war.',
      [20, 19]),
    e('dungeon-cellars', /^dungeon-cellars\.[a-z]+$/, 'The Old Cellars (stone dungeon)', 'battle',
      'A torch-lit stone dungeon of five rooms: an entry hall with stairs up, a pillared chamber with a central brazier, a flagstone crypt with four sarcophagi and a pool, and a plank-floored storeroom of crates and barrels, joined by short corridors with double doors. Use it for any cellar, crypt or small dungeon scene.',
      [7, 6]),
    e('wave-echo-cave', [/^lmop-wave-echo-cave\.[a-z]+$/, /^waveechocavern-playerversion\.[a-z]+$/], 'Wave Echo Cave (the lost mine)', 'battle',
      'The great cavern complex of the Phandelver Pact: the Forge of Spells, tunnels, an underground lake, and the shrine. Use it for everything inside the mine.',
      [35, 85]),
    e('agathas-lair', /^lmop-agathas-lair\.[a-z]+$/, 'Agatha\'s Lair', 'battle',
      'The hidden lair of Agatha, the banshee who haunts the wilderness near Conyberry. Use it for the approach to her lair and the scene inside.',
      [15, 27]),
    e('old-owl-well', /^lmop-old-owl-well\.[a-z]+$/, 'Old Owl Well', 'battle',
      'The ruined watchtower and old well in the wastes east of the Triboar Trail, where undead lurk and a Red Wizard of Thay is digging. Use it for everything at Old Owl Well.',
      [15, 27]),
    e('wyvern-tor', /^lmop-wyvern-tor\.[a-z]+$/, 'Wyvern Tor', 'battle',
      'A rocky hilltop in the highlands, home to an orc war camp. Use it for the climb and anything fought on the tor.',
      [22, 42])
  ],
  'tavern-brawl-test': [
    SWORD_COAST,
    e('terrain-test', /^terrain-test\.[a-z]+$/, 'Terrain Test Grounds (battle map)', 'battle',
      'An open meadow test map, 40 by 30 squares: a winding creek you can wade across (shallow water, difficult terrain), scattered trees whose trunks block sight and movement, two boulders, a field of rubble with a ruined wall corner (difficult terrain; the wall blocks sight), a thicket of undergrowth (difficult terrain), a small timber house in the north east with a front door (south wall) and a back door (east wall) that block sight while closed, and a flickering campfire with two log seats west of the creek. The party arrives at the west edge, north of the creek; the far bank is across the water to the south east. Use it for outdoor fights and to try out line of sight, fog of war and movement.',
      [3, 7], { 'far-bank': [36, 21] }),
    e('dungeon-cellars', /^dungeon-cellars\.[a-z]+$/, 'The Old Cellars (stone dungeon)', 'battle',
      'A torch-lit stone dungeon of five rooms: an entry hall with stairs up, a pillared chamber with a central brazier, a flagstone crypt with four sarcophagi and a pool, and a plank-floored storeroom of crates and barrels, joined by short corridors with double doors. Use it for any cellar, crypt or small dungeon scene.',
      [7, 6]),
    e('camp-day', /^camp-day\.[a-z]+$/, 'Campsite (day)', 'camp',
      'A forest clearing campsite by day: a stone-ringed campfire with log benches, three tents, bedrolls and supplies, with trails leading out to the south and west. Use it when the party makes camp, rests or spends a quiet day in the wild. It is a camp map: tokens are shown, there is no fog of war.',
      [20, 19]),
    e('camp-night', /^camp-night\.[a-z]+$/, 'Campsite (night)', 'camp',
      'The same campsite at night, lit by the campfire and lanterns in the tents, dark under the trees. Use it instead of the day map when the party makes camp at dusk or night, or rests overnight. There is no fog of war.',
      [20, 19]),
    e('rusty-flagon', /^rusty-flagon-[^/]+\.png$/, 'The Rusty Flagon (tavern)', 'battle',
      'A crowded tavern with a bar, round tables, a fireplace, a kitchen and a back booth room. The double front door leads out to the main street of Phandalin; the barred back door in the kitchen leads to the alley behind. Use this map for everything inside the tavern.',
      [14, 16], { 'front-door': [14, 16], 'kitchen': [25, 5], 'back-booth': [26, 14], 'back-door': [26, 3] }),
    e('phandalin', [/^lmop-phandalin-player-version\.[a-z]+$/, /^phandalin-playerversion\.[a-z]+$/], 'Phandalin (town map, outside the tavern)', 'town',
      'The frontier town of Phandalin in the evening. In this scenario the Rusty Flagon tavern stands on the town green beside the main street. Leaving the tavern by the front door puts the party at outside-the-flagon, on the street; the back door leads to behind-the-flagon, in the alley. Use this map for anything that happens outside the tavern: the street, the green, a chase, the Watch arriving. This is a town map: the party tokens are not shown on it and there is no fog or movement limit.',
      [28, 23], { 'outside-the-flagon': [28, 23], 'behind-the-flagon': [26, 26], 'town-square': [28, 22], 'triboar-trail-road': [42, 6] })
  ]
};

// The maps of a campaign that are installed (their file is in the uploads folder), each with its url.
export function mapsFor(campaignId, uploadFiles) {
  const list = [];
  for (const m of CAMPAIGN_MAPS[campaignId] || []) {
    // m.file is one pattern, or a list in order of preference (the purchased dd2vtt maps first, older images as a fallback).
    let file;
    for (const re of [].concat(m.file)) { file = uploadFiles.find((f) => re.test(f)); if (file) break; }
    if (file) list.push({ ...m, url: `/uploads/${file}` });
  }
  return list;
}

// What the AI is told about the places it can use.
export function mapsForPrompt(maps) {
  return maps.map((m) => ({ id: m.id, name: m.name, kind: m.kind, description: m.description, arrivalSpots: [...new Set([...Object.keys(m.spots), ...Object.keys(m.spotsPx || {})])] }));
}

// Turn the AI's changeMap request into what the tabletop needs, or explain why it cannot.
export function resolveChangeMap(maps, request) {
  const m = maps.find((x) => x.id === String(request?.mapId ?? '').trim().toLowerCase());
  if (!m) return { error: `The DM tried to go to a map that is not available ("${request?.mapId ?? ''}").` };
  const spot = String(request?.arrive ?? '').trim().toLowerCase();
  // Spots saved on the Map Test page are in image pixels (the tabletop turns them into squares); they win over the built-in guesses.
  const px = m.spotsPx?.[spot] || (!m.spots[spot] && m.startPx) || null;
  const at = m.spots[spot] || m.start;
  // explicit: the AI named a real arrival spot, so the party goes exactly there; otherwise they return to where they last stood.
  return { update: { type: 'changeMap', mapUrl: m.url, mapName: m.name, kind: m.kind, col: at[0], row: at[1], px, explicit: Boolean(m.spotsPx?.[spot] || m.spots[spot]), reason: String(request?.reason ?? '').slice(0, 200) } };
}

/* ---------------- maps chosen on the Campaigns page (data/campaigns/<id>/maps.json) ---------------- */

export const MAP_KINDS = ['battle', 'camp', 'town', 'regional'];

// The editable form of a campaign's maps: one plain row per map (what the Campaigns page shows and saves).
export function entriesToList(maps) {
  return maps.map((m) => ({ id: m.id, file: m.url.split('/').pop(), name: m.name, kind: m.kind, description: m.description }));
}

// Check a list from the page: ids are made safe and unique, every file must be an uploaded picture, kinds must be known.
export function cleanMapList(raw, uploadFiles) {
  const out = [];
  const problems = [];
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw.slice(0, 80) : []) {
    const file = String(r?.file ?? '');
    let id = String(r?.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!uploadFiles.includes(file)) { problems.push(`"${file}" is not an uploaded map.`); continue; }
    if (!id) id = file.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map';
    for (let n = 2; seen.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    seen.add(id);
    out.push({
      id, file,
      name: String(r?.name ?? '').trim().slice(0, 80) || id,
      kind: MAP_KINDS.includes(r?.kind) ? r.kind : 'battle',
      description: String(r?.description ?? '').trim().slice(0, 600)
    });
  }
  return { list: out, problems };
}

// The same shape the registry entries have, built from a saved list. The arrival spot is the map's own "start" pin.
export function mapsFromList(list, uploadFiles) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && uploadFiles.includes(m.file))
    .map((m) => ({ id: m.id, file: m.file, name: m.name, kind: MAP_KINDS.includes(m.kind) ? m.kind : 'battle', description: m.description || '', start: [2, 2], spots: {}, url: `/uploads/${m.file}` }));
}
