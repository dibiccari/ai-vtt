// Map sets, step 1: the set view built from today's files (lib/mapsets.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSets, facePlace, gameSize, imageSize } from '../lib/mapsets.js';

test('facePlace: DM and player versions name the place and the role', () => {
  assert.deepEqual(facePlace('dnd-dm-phandalin.jpg'), { key: 'dnd-phandalin', role: 'dm', explicit: true });
  assert.deepEqual(facePlace('dnd-phandalin-playerversion.jpg'), { key: 'dnd-phandalin', role: 'player', explicit: true });
  assert.deepEqual(facePlace('lmop-phandalin-dm-version.jpg'), { key: 'lmop-phandalin', role: 'dm', explicit: true });
  assert.deepEqual(facePlace('lmop-phandalin-player-version.jpg'), { key: 'lmop-phandalin', role: 'player', explicit: true });
  assert.deepEqual(facePlace('vtt-crypt-claude.png'), { key: 'vtt-crypt-claude', role: 'player', explicit: false });
});

test('buildSets: day and night become one set, DM pictures attach to their place, kinds and tiles follow the map', () => {
  const pictures = ['vtt-camp-day.png', 'vtt-camp-night.png', 'lmop-phandalin-dm-version.jpg', 'lmop-phandalin-player-version.jpg', 'dnd-sword-coast-ours.png', 'vtt-crypt-claude.png', 'vtt-phandalin.png'];
  const configs = {
    'vtt-camp-day.png': { group: 'camp', variant: 'day', squares: 40, walls: [{ type: 'wall' }, { type: 'door' }], starts: [{ name: 'start' }, { name: 'a' }], light: 'bright' },
    'vtt-camp-night.png': { group: 'camp', variant: 'night', squares: 40, walls: [{ type: 'wall' }], starts: [{ name: 'start' }], light: 'dark', lights: [{ x: 1 }, { x: 2 }] },
    'dnd-sword-coast-ours.png': { tiles: 'hex', hexSize: 48, starts: [{ name: 'neverwinter' }] }, 'vtt-crypt-claude.png': { squares: 30, walls: [], starts: [] }, 'vtt-phandalin.png': { starts: [{ name: 'start' }] }
  };
  const listed = { 'vtt-camp-day.png': { kind: 'camp', campaigns: ['lost'] }, 'vtt-camp-night.png': { kind: 'camp', campaigns: ['lost'] }, 'lmop-phandalin-player-version.jpg': { kind: 'town', campaigns: ['lost'] } };
  const sets = buildSets({ pictures, configs, dmPictures: new Set(['vtt-phandalin']), listed });
  const by = Object.fromEntries(sets.map((s) => [s.id, s]));
  assert.equal(sets.length, 5, 'seven pictures make five places: camp (2), Phandalin (2), the coast, the crypt, our Phandalin');
  const camp = by.camp; assert.deepEqual(camp.times, ['day', 'night']); assert.equal(camp.kind, 'camp'); assert.equal(camp.tiles, 'square'); assert.equal(camp.levels[0].looks.length, 2);
  assert.equal(camp.levels[0].looks[1].lights, 2); assert.equal(camp.levels[0].looks[1].light, 'dark', 'lights and light level belong to the look');
  assert.equal(camp.levels[0].walls, 1, 'the walls come from the first look and doors are counted apart'); assert.equal(camp.levels[0].doors, 1); assert.deepEqual(camp.campaigns, ['lost']);
  const town = by['lmop-phandalin']; assert.equal(town.kind, 'town'); assert.equal(town.tiles, 'none'); assert.equal(town.levels[0].looks[0].player, 'lmop-phandalin-player-version.jpg'); assert.equal(town.levels[0].looks[0].dm, 'lmop-phandalin-dm-version.jpg'); assert.equal(town.hasDm, true);
  const coast = by['dnd-sword-coast-ours']; assert.equal(coast.kind, 'regional'); assert.equal(coast.tiles, 'hex'); assert.equal(coast.levels[0].isRevealed, true, 'regional maps are revealed by default'); assert.equal(coast.needsStart, false);
  assert.equal(by['vtt-crypt-claude'].levels[0].isRevealed, false); assert.equal(by['vtt-crypt-claude'].needsStart, true);
  assert.equal(by['vtt-phandalin'].hasDm, true, 'a DM picture in data/dm-maps counts'); assert.deepEqual(sets.map((s) => s.links), [[], [], [], [], []]);
});

test('buildSets: a player version beside the plain picture is one place, the plain one being the DM face; the Phandalin pictures count as Wizards of the Coast', () => {
  const sets = buildSets({ pictures: ['dnd-northswordcoast.jpg', 'dnd-northswordcoast-playerversion.jpg', 'lmop-phandalin-player-version.jpg', 'lmop-agathas-lair.png'] });
  assert.equal(sets.length, 3);
  const coast = sets.find((x) => x.id === 'dnd-northswordcoast'); assert.equal(coast.levels[0].looks[0].player, 'dnd-northswordcoast-playerversion.jpg'); assert.equal(coast.levels[0].looks[0].dm, 'dnd-northswordcoast.jpg');
  assert.equal(sets.find((x) => x.id === 'lmop-phandalin').origin, 'Wizards of the Coast'); assert.equal(sets.find((x) => x.id === 'lmop-agathas-lair').origin, 'Map Adventurer');
});

test('gameSize and imageSize: squares are 5 ft, hexagons 5 miles, height x width', () => {
  assert.deepEqual(gameSize('battle', { w: 2000, h: 1500 }, 40, 0), { unit: 'ft', width: 200, height: 150, tilesAcross: 40, tilesDown: 30 });
  assert.deepEqual(gameSize('camp', { w: 1500, h: 1000 }, 30, 0), { unit: 'ft', width: 150, height: 100, tilesAcross: 30, tilesDown: 20 });
  const r = gameSize('regional', { w: 1324, h: 1813 }, 0, 48); assert.equal(r.unit, 'miles'); assert.equal(r.width, 138); assert.ok(r.height > r.width, 'a tall map is taller than wide');
  assert.equal(gameSize('town', { w: 1000, h: 800 }, 30, 0), null); assert.equal(gameSize('battle', null, 30, 0), null);
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1536, 16); png.writeUInt32BE(1024, 20);
  assert.deepEqual(imageSize(png), { w: 1536, h: 1024 }); assert.equal(imageSize(Buffer.from('nope')), null);
});
