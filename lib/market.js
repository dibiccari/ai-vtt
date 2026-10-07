// The Market: maps (later characters) saved as portable packs that any campaign can add. A saved pack is a folder data/market/<id>/ with pack.json (what it is and its
// map configuration: walls, doors, lights, pins, terrain, mood) and picture.<ext>. A pack file for sending to someone is one JSON file with the picture inside (base64).
// Pictures that came from a purchase or from Wizards of the Coast (names starting lmop- or dnd-) are never packed: they are not ours to share.
export const MAP_TYPES = ['battle', 'camp', 'town', 'regional'];
export const MOODS = [
  { id: '', label: 'No mood', ambience: '', light: '' },
  { id: 'sunny-day', label: 'Sunny day', ambience: 'forest', light: 'bright' },
  { id: 'forest-road', label: 'Forest road', ambience: 'forest', light: 'bright' },
  { id: 'windswept', label: 'Windswept hills', ambience: 'wind', light: 'bright' },
  { id: 'rainy', label: 'Rain and gloom', ambience: 'rain', light: 'dim' },
  { id: 'night', label: 'Night', ambience: 'night', light: 'dark' },
  { id: 'camp-night', label: 'Campfire at night', ambience: 'fire', light: 'dark' },
  { id: 'tavern', label: 'Busy tavern', ambience: 'tavern', light: 'dim' },
  { id: 'town', label: 'Town bustle', ambience: 'town', light: 'bright' },
  { id: 'dungeon', label: 'Torch-lit dungeon', ambience: 'dungeon', light: 'dim' },
  { id: 'cave', label: 'Dripping cave', ambience: 'cave', light: 'dark' },
  { id: 'haunted', label: 'Haunted and eerie', ambience: 'night', light: 'dark' }
];
export const LICENCES = ['Mine: free to share', 'CC0 (public domain)', 'CC BY 4.0', 'CC BY-NC 4.0', 'Private: only for me'];
const NOT_OURS = /^(lmop|dnd)-/i;

export const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const packId = (name, taken) => {
  let id = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map';
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
  return id;
};
// Why a picture cannot be packed, or '' when it can.
export function whyNotShareable(pictureFile) {
  return NOT_OURS.test(String(pictureFile)) ? 'This picture came from a purchase or from Wizards of the Coast, so it cannot be shared or saved to the Market. Use a map you made or uploaded yourself.' : '';
}
// Metadata of a pack, from a request. Throws a short message when something is missing.
export function cleanMeta(body, picture) {
  const name = clean(body?.name, 80);
  if (!name) throw Object.assign(new Error('Give the map a name.'), { status: 400 });
  const type = MAP_TYPES.includes(body?.type) ? body.type : 'battle';
  const mood = MOODS.some((m) => m.id === body?.mood) ? body.mood : '';
  const tags = [...new Set((Array.isArray(body?.tags) ? body.tags : String(body?.tags ?? '').split(',')).map((t) => clean(t, 24).toLowerCase()).filter(Boolean))].slice(0, 12);
  const licence = LICENCES.includes(body?.licence) ? body.licence : LICENCES[0];
  return { kind: 'map', name, type, description: clean(body?.description, 600), tags, mood, licence, author: clean(body?.author, 60), picture, createdAt: new Date().toISOString() };
}
