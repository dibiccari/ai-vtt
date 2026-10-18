// Light zones (Nov 2026): cleaning in normalizeMapConfig through PUT /api/map-config, the map set round trip (lib/mapsetstore.js) and zones shared by the looks of one place.
// Every test writes its own zones first; nothing here assumes what the user has drawn on a real map.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/sandbox.mjs';
import { configFromSet, applyConfigToSet, docFromBuilt } from '../lib/mapsetstore.js';

let s;
before(async () => { s = await startServer(); });
after(async () => { if (s) await s.stop(); });

const square = (x, y, r = 50) => [{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }];
const MAP = 'lmop-thundertree.png';
const cfg = async (map = MAP) => (await s.get('/api/map-config?map=' + map)).json.config;
const save = async (zones, map = MAP, extra = {}) => { const base = await cfg(map); const body = { ...base, ...extra }; if (zones === undefined) delete body.lightZones; else body.lightZones = zones; const r = await s.put('/api/map-config?map=' + map, body); assert.equal(r.status, 200, r.text); return r; };

test('zone cleaning: ids become slugs, names are trimmed and capped, bad levels, short polygons and non-numeric points are dropped', async () => {
  await save([
    { id: 'Cave Mouth!!', name: '  The\u0007 Cave  ', level: 'dark', points: square(100, 100) },
    { name: 'x'.repeat(100), level: 'dim', points: square(300, 100) },
    { id: '', name: '', level: 'time', points: square(500, 100) },
    { id: 'upper', name: 'Upper case level', level: 'Dark', points: square(700, 100) },
    { id: 'two', level: 'bright', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    { id: 'strings', level: 'bright', points: [{ x: '1', y: '2' }, { x: '3', y: '4' }, { x: '5', y: '6' }] },
    { id: 'nan', level: 'bright', points: [{ x: NaN, y: 1 }, { x: null, y: 2 }, { x: 5, y: 5 }, { x: 6, y: 5 }] },
    null, 'text', 5, { level: 'bright' }
  ]);
  const zones = (await cfg()).lightZones;
  assert.deepEqual(zones.map((z) => [z.id, z.level, z.points.length]), [['cave-mouth', 'dark', 4], ['zone-2', 'dim', 4], ['zone-3', 'time', 4]]);
  assert.equal(zones[0].name, 'The Cave', 'control characters and edge spaces are removed');
  assert.equal(zones[1].name.length, 40, 'names are capped at 40'); assert.equal(zones[2].name, 'zone-3', 'a zone with no name is called by its id');
});

test('zone points are rounded to two decimals and limited in number; at most 40 zones are kept', async () => {
  await save([{ id: 'r', level: 'dark', points: [{ x: 1.23456, y: 2.34567 }, { x: 10, y: 2 }, { x: 10, y: 10 }] }]);
  assert.deepEqual((await cfg()).lightZones[0].points[0], { x: 1.23, y: 2.35 });
  const many = Array.from({ length: 55 }, (_, i) => ({ id: 'z' + i, level: 'dim', points: square(100 + i * 10, 100, 4) }));
  await save(many);
  const kept = (await cfg()).lightZones;
  assert.equal(kept.length, 40); assert.equal(kept[0].id, 'z0'); assert.equal(kept[39].id, 'z39');
  const big = [{ id: 'huge', level: 'dark', points: Array.from({ length: 500 }, (_, i) => ({ x: i, y: (i * i) % 97 })) }];
  await save(big);
  assert.equal((await cfg()).lightZones[0].points.length, 400, 'a polygon keeps at most 400 corners');
});

test('two zones given the same id (or the id another one was numbered) get ids of their own', async () => {
  await save([{ id: 'cave', level: 'dark', points: square(100, 100) }, { id: 'cave', level: 'dim', points: square(300, 100) }, { level: 'bright', points: square(500, 100) }, { id: 'zone-3', level: 'dark', points: square(700, 100) }]);
  const ids = (await cfg()).lightZones.map((z) => z.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique: ' + ids.join(', '));
  assert.equal(ids[0], 'cave');
});

test('order is kept (later zones win on the tabletop) and survives a save that does not mention zones', async () => {
  await save([{ id: 'a', level: 'dark', points: square(100, 100) }, { id: 'b', level: 'bright', points: square(100, 100, 20) }]);
  await save(undefined);
  assert.deepEqual((await cfg()).lightZones.map((z) => [z.id, z.level]), [['a', 'dark'], ['b', 'bright']]);
  await save(undefined, MAP, { name: 'Renamed place' });
  assert.equal((await cfg()).lightZones.length, 2, 'a rename does not drop the zones');
  await save([]);
  assert.equal((await cfg()).lightZones, undefined, 'an empty list removes them');
  await save(undefined);
  assert.equal((await cfg()).lightZones, undefined, 'and a later save that says nothing does not bring them back');
});

test('a zone is bound to the place, not to a look: the other look of a place shows the same zones, and a save through either look changes both', async () => {
  const day = 'vtt-camp-day.png', night = 'vtt-camp-night.png';
  const dc = await cfg(day), nc = await cfg(night);
  assert.ok(dc && nc, 'the camp has a Day and a Night look');
  await save([{ id: 'tent', name: 'Tent', level: 'time', points: square(400, 400) }], day);
  assert.deepEqual((await cfg(night)).lightZones.map((z) => [z.id, z.level]), [['tent', 'time']]);
  await save([{ id: 'tent', name: 'Tent', level: 'time', points: square(400, 400) }, { id: 'well', level: 'dim', points: square(900, 400) }], night);
  assert.deepEqual((await cfg(day)).lightZones.map((z) => z.id), ['tent', 'well']);
  await save([], night);
  assert.equal((await cfg(day)).lightZones, undefined);
});

test('map-set documents: zones are written into the level and read back by every look; empty or missing zones leave no key', () => {
  const look = (time, player) => ({ id: time, time, player, dm: null, light: time === 'night' ? 'dark' : 'bright', lights: [], ambient: '', ambience: '', mood: '' });
  const built = { id: 'p', name: 'P', kind: 'battle', levels: [{ looks: [{ player: 'p-day.png', time: 'day' }, { player: 'p-night.png', time: 'night' }] }] };
  const zones = [{ id: 'z', name: 'Z', level: 'time', points: square(10, 10) }];
  const doc = docFromBuilt(built, { 'p-day.png': { squares: 30, lightZones: zones }, 'p-night.png': {} });
  assert.deepEqual(doc.levels[0].lightZones, zones, 'taken from the first look\'s set-up when the set is built');
  assert.equal(docFromBuilt(built, { 'p-day.png': { lightZones: [] } }).levels[0].lightZones, undefined);
  assert.equal(docFromBuilt(built, {}).levels[0].lightZones, undefined);
  doc.levels[0].looks = [look('day', 'p-day.png'), look('night', 'p-night.png')];
  for (const f of ['p-day.png', 'p-night.png']) assert.deepEqual(configFromSet(doc, f).lightZones, zones, f + ' reads the shared zones');
  const v = doc.version || 1;
  assert.equal(applyConfigToSet(doc, 'p-night.png', { ...configFromSet(doc, 'p-night.png'), lightZones: [] }), true);
  assert.equal(doc.levels[0].lightZones, undefined, 'writing an empty list removes the key'); assert.equal(configFromSet(doc, 'p-day.png').lightZones, undefined);
  assert.equal(doc.version, v + 1, 'the set version moves on every write');
  applyConfigToSet(doc, 'p-day.png', { ...configFromSet(doc, 'p-day.png'), lightZones: zones });
  assert.deepEqual(doc.levels[0].lightZones, zones);
  assert.equal(applyConfigToSet(doc, 'nothing.png', { lightZones: zones }), false, 'a picture the set does not hold changes nothing');
});

test('the look light (bright, dim, dark) is a per-look value but the zones are not: a night look being dark does not touch the day look\'s zones', () => {
  const doc = docFromBuilt({ id: 'q', name: 'Q', kind: 'camp', levels: [{ looks: [{ player: 'q-day.png', time: 'day' }, { player: 'q-night.png', time: 'night' }] }] }, { 'q-day.png': { light: 'bright', lightZones: [{ id: 'a', name: 'A', level: 'dark', points: square(5, 5) }] }, 'q-night.png': { light: 'dark' } });
  assert.deepEqual([configFromSet(doc, 'q-day.png').light, configFromSet(doc, 'q-night.png').light], ['bright', 'dark']);
  assert.equal(configFromSet(doc, 'q-night.png').lightZones.length, 1);
});
