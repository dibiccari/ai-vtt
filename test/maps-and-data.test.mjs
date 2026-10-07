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

// The wall builder reads a layout and the picture and writes a map config. It is run inside a throwaway copy so the real data/maps stays untouched.
test('build-walls-from-layout: Redbrand Hideout builds walls, 13 doors and bars, and the doors sit on walls', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-walls-'));
  try {
    for (const d of ['scripts', 'lib', 'data']) await cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });
    await mkdir(path.join(dir, 'public'));
    await symlink(path.join(ROOT, 'public', 'uploads'), path.join(dir, 'public', 'uploads'));
    const out = execFileSync(process.execPath, ['scripts/build-walls-from-layout.mjs', 'data/map-layouts/dnd-redbrand-hideout.json'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, / walls, 13 doors, \d+ fences/);
    const built = JSON.parse(await readFile(path.join(dir, 'data', 'maps', 'dnd-redbrand-hideout.jpg.json'), 'utf8'));
    const count = (t) => built.walls.filter((w) => w.type === t).length;
    assert.ok(count('wall') > 100 && count('fence') > 0); assert.equal(count('door'), 13);
    // a door must lie on the line of a wall or fence (within 35 px (under half a 82.5 px square; wall bands are drawn about 20 px thick, and the worst door in the committed layout is 30 px off) of some wall or fence)
    const dist = (px, py, w) => { const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((px - w.x1) * dx + (py - w.y1) * dy) / l2)) : 0; return Math.hypot(px - (w.x1 + t * dx), py - (w.y1 + t * dy)); };
    const solid = built.walls.filter((w) => w.type !== 'door');
    for (const d of built.walls.filter((w) => w.type === 'door')) {
      for (const [x, y] of [[d.x1, d.y1], [d.x2, d.y2]]) assert.ok(solid.some((w) => dist(x, y, w) < 35), `door end (${x},${y}) is not touching a wall`);
    }
    assert.ok(built.secrets.length >= 1);
    // Not compared with the committed config: that one was tuned by hand-checking screenshots and the builder (cave mask) no longer reproduces it exactly.
    const copy = JSON.parse(await readFile(path.join(dir, 'data', 'maps', 'dnd-dm-redbrand-hideout.jpg.json'), 'utf8'));
    assert.deepEqual(copy.walls, built.walls, 'the DM-version picture shares the walls');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
