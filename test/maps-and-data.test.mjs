// Map registry, saved map configs (walls, doors, start pins), campaign map lists, and the wall builder script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, cp, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers/sandbox.mjs';
import { CAMPAIGN_MAPS, mapsFor, mapsForPrompt, resolveChangeMap, cleanMapList, entriesToList, mapsFromList, MAP_KINDS } from '../lib/campaign-maps.js';

const json = async (...p) => JSON.parse(await readFile(path.join(ROOT, ...p), 'utf8'));
const uploads = await readdir(path.join(ROOT, 'public', 'uploads'));
const configs = {};
for (const f of await readdir(path.join(ROOT, 'data', 'maps'))) if (f.endsWith('.json')) configs[f.slice(0, -5)] = await json('data', 'maps', f);
// Pictures that belong to a map set (data/mapsets/<guid>.json) take their walls, doors and pins from it: the old per-picture files are no longer read.
for (const f of await readdir(path.join(ROOT, 'data', 'mapsets'))) {
  const set = await json('data', 'mapsets', f);
  for (const lv of set.levels || []) for (const look of lv.looks || []) configs[look.player] = { ...(configs[look.player] || {}), ...(lv.squares ? { squares: lv.squares } : {}), walls: lv.walls || [], starts: lv.starts || [], difficult: lv.difficult || [] };
}

// The same check scripts/check.mjs makes: every installed battle or camp map has a "start" pin.
for (const campaign of Object.keys(CAMPAIGN_MAPS)) {
  test(`start pins: every battle and camp map of ${campaign} has a start pin`, () => {
    const missing = mapsFor(campaign, uploads).filter((m) => m.kind === 'battle' || m.kind === 'camp').filter((m) => !(configs[m.url.split('/').pop()]?.starts || []).some((s) => s.name === 'start')).map((m) => m.id);
    assert.deepEqual(missing, []);
  });
}

test('registry: ids are unique per campaign, kinds known, arrival squares are positive integers pairs', () => {
  for (const [campaign, list] of Object.entries(CAMPAIGN_MAPS)) {
    assert.equal(new Set(list.map((m) => m.id)).size, list.length, `${campaign}: duplicate ids`);
    for (const m of list) {
      assert.ok(MAP_KINDS.includes(m.kind), `${m.id}: kind ${m.kind}`);
      for (const at of [m.start, ...Object.values(m.spots)]) assert.ok(Array.isArray(at) && at.length === 2 && at.every((n) => Number.isInteger(n) && n >= 0), `${m.id}: bad square ${at}`);
      assert.ok(m.description.length > 20, `${m.id}: needs a description for the DM`);
    }
  }
});

test('mapsFor only offers installed pictures, and the first matching pattern wins', () => {
  const none = mapsFor('lost-mine-of-phandelver', []);
  assert.deepEqual(none, []);
  const some = mapsFor('lost-mine-of-phandelver', ['lmop-goblin-ambush.png']);
  assert.equal(some.length, 1); assert.equal(some[0].url, '/uploads/lmop-goblin-ambush.png');
  assert.deepEqual(mapsFor('no-such-campaign', uploads), []);
});

test('resolveChangeMap: named spot, unknown spot falls back to the start, unknown map is a problem', () => {
  const maps = mapsFor('tavern-brawl-test', uploads);
  const flagon = maps.find((m) => m.id === 'rusty-flagon');
  assert.ok(flagon, 'the tavern map is installed');
  const named = resolveChangeMap(maps, { mapId: 'RUSTY-FLAGON ', arrive: 'back-door', reason: 'sneaking' });
  assert.deepEqual([named.update.col, named.update.row], [26, 3]); assert.equal(named.update.explicit, true); assert.equal(named.update.mapUrl, flagon.url);
  const dflt = resolveChangeMap(maps, { mapId: 'rusty-flagon', arrive: 'nowhere' });
  assert.deepEqual([dflt.update.col, dflt.update.row], flagon.start); assert.equal(dflt.update.explicit, false);
  assert.match(resolveChangeMap(maps, { mapId: 'atlantis' }).error, /atlantis/);
  const px = resolveChangeMap([{ ...flagon, spotsPx: { door: { x: 10, y: 20 } } }], { mapId: 'rusty-flagon', arrive: 'door' });
  assert.deepEqual(px.update.px, { x: 10, y: 20 }); assert.equal(px.update.explicit, true);
});

test('mapsForPrompt lists arrival spots without leaking file paths', () => {
  const p = mapsForPrompt(mapsFor('tavern-brawl-test', uploads));
  assert.ok(p.length >= 2);
  for (const m of p) { assert.ok(m.id && m.kind && Array.isArray(m.arrivalSpots)); assert.ok(!('url' in m)); }
});

test('mapsForPrompt marks battle maps as visited or not; towns and regional maps carry no flag', () => {
  const maps = mapsFor('lost-mine-of-phandelver', uploads);
  const battle = maps.find((m) => m.kind === 'battle');
  const open = maps.find((m) => m.kind === 'town' || m.kind === 'regional');
  assert.ok(battle && open);
  const none = mapsForPrompt(maps, [], '');
  assert.equal(none.find((m) => m.id === battle.id).visitedByParty, false);
  assert.ok(!('visitedByParty' in none.find((m) => m.id === open.id)));
  assert.equal(mapsForPrompt(maps, [battle.url], '').find((m) => m.id === battle.id).visitedByParty, true);
  assert.equal(mapsForPrompt(maps, [], battle.url).find((m) => m.id === battle.id).visitedByParty, true);
  assert.ok(!('visitedByParty' in mapsForPrompt(maps)[0]), 'without the visited list nothing is claimed');
});

test('cleanMapList and mapsFromList', () => {
  const { list, problems } = cleanMapList([{ file: uploads[0], name: ' A ', kind: 'weird' }, { file: uploads[0], id: 'Same Id!' }, { file: uploads[0], id: 'same-id' }, { file: 'missing.png' }], uploads);
  assert.equal(list.length, 3); assert.equal(problems.length, 1);
  assert.equal(new Set(list.map((m) => m.id)).size, 3);
  assert.equal(list[0].kind, 'battle'); assert.equal(list[0].name, 'A');
  const built = mapsFromList(list, uploads);
  assert.equal(built.length, 3); assert.deepEqual(built[0].start, [2, 2]);
  assert.deepEqual(entriesToList(built).map((x) => x.file), list.map((x) => x.file));
});

for (const campaign of (await readdir(path.join(ROOT, 'data', 'campaigns'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)) {
  test(`campaign ${campaign}: maps.json (if any) points at installed pictures with valid kinds`, async () => {
    let saved; try { saved = await json('data', 'campaigns', campaign, 'maps.json'); } catch { return; }
    for (const m of saved.maps) { assert.ok(uploads.includes(m.file), `${m.id}: ${m.file} is not in public/uploads`); assert.ok(MAP_KINDS.includes(m.kind), `${m.id}: kind`); }
  });
}

test('every map config is well formed: walls have numeric ends and a known type, doors are not zero length', () => {
  const TYPES = new Set(['wall', 'door', 'fence', 'window']);
  for (const [name, c] of Object.entries(configs)) {
    assert.ok(uploads.includes(name), `${name}: config for a picture that is not in public/uploads`);
    for (const w of c.walls || []) {
      assert.ok([w.x1, w.y1, w.x2, w.y2].every(Number.isFinite), `${name}: wall with non-numeric end`);
      assert.ok(TYPES.has(w.type || 'wall'), `${name}: wall type ${w.type}`);
      assert.ok(w.x1 !== w.x2 || w.y1 !== w.y2, `${name}: zero-length wall`);
    }
    for (const s of c.starts || []) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y) && s.name, `${name}: bad pin`);
    if (c.squares !== undefined) assert.ok(Number(c.squares) > 0, `${name}: squares`);
  }
});

test('start pins lie inside their picture (image size from the config walls and pins is a lower bound only: pins must be positive)', () => {
  for (const [name, c] of Object.entries(configs)) for (const s of c.starts || []) assert.ok(s.x >= 0 && s.y >= 0, `${name}: pin ${s.name} is off the picture`);
});

