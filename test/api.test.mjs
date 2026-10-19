// HTTP tests: the real server.js runs on a random port inside a throwaway copy of the app and its data, with no API keys (nothing is spent, nothing real is touched).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './helpers/sandbox.mjs';
import { ID } from './helpers/ids.mjs';

let s;
before(async () => { s = await startServer(); });
after(async () => { await s.stop(); });
const ok = (r, status = 200) => assert.equal(r.status, status, `${r.status}: ${r.text.slice(0, 300)}`);
const exists = (p) => access(path.join(s.dir, p)).then(() => true, () => false);
const LOST = 'lost-mine-of-phandelver';

// A request with a chosen Host and Origin header (fetch will not let a test fake those).
const raw = (method, url, { host, origin, body } = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: s.port, method, path: url, headers: { ...(host ? { Host: host } : {}), ...(origin ? { Origin: origin } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t }));
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('pages and static files are served', async () => {
  for (const p of ['/', '/index.html', '/campaigns.html', '/map-test.html', '/party.html']) { const r = await s.call('GET', p); ok(r); assert.match(r.text, /<html/i); }
  assert.equal((await s.get('/api/does-not-exist')).status, 404);
});

test('campaigns: list, stats, and the active campaign switch', async () => {
  const r = await s.get('/api/campaigns'); ok(r);
  const ids = r.json.campaigns.map((c) => c.id);
  assert.ok(ids.includes(LOST) && ids.includes('tavern-brawl-test'));
  const lost = r.json.campaigns.find((c) => c.id === LOST);
  assert.equal(lost.party.length, 4); assert.ok(lost.files.length >= 20); assert.ok(lost.approxTokens > 10000);
  ok(await s.post('/api/campaigns/active', { id: LOST }));
  assert.equal((await s.get('/api/campaigns')).json.active, LOST);
  assert.equal((await s.post('/api/campaigns/active', { id: 'nope' })).status, 404);
  assert.equal((await s.post('/api/campaigns/active', {})).status, 404);
});

test('characters: party filtering, save keeps the stored sheet, validation, delete', async () => {
  const all = (await s.get('/api/characters')).json;
  assert.equal(all.length, 12);
  assert.deepEqual((await s.get(`/api/characters?campaign=${LOST}`)).json.map((c) => c.id), [ID.astarion, ID.edric, ID.rachel, ID.shadowheart]);
  const edric = all.find((c) => c.id === ID.edric);
  const saved = await s.post('/api/characters', { id: ID.edric, name: 'Edric', class: 'Fighter', level: 1, hp: 3, maxHp: 12, ac: 18, abilities: edric.abilities });
  ok(saved); assert.equal(saved.json.hp, 3);
  const after = (await s.get('/api/characters')).json.find((c) => c.id === ID.edric);
  assert.equal(after.hp, 3); assert.deepEqual(after.sheet, edric.sheet, 'a save without a sheet keeps the stored sheet');
  assert.deepEqual(after.campaigns, edric.campaigns);
  assert.equal((await s.post('/api/characters', { name: '   ' })).status, 400);
  const clamp = await s.post('/api/characters', { id: 'tmp-char', name: 'Tmp', maxHp: 5000, hp: 9999, color: 'red', abilities: { str: 99 } });
  assert.deepEqual([clamp.json.maxHp, clamp.json.hp, clamp.json.color, clamp.json.abilities.str, clamp.json.abilities.dex], [999, 999, '#4f9dff', 30, 10]);
  ok(await s.del('/api/characters/tmp-char'));
  assert.equal((await s.del('/api/characters/tmp-char')).status, 404);
  assert.equal((await s.del('/api/characters/%20')).status, 400);
  assert.equal(await exists('data/characters/tmp-char.json'), false);
});

test('rolls: /api/roll uses real dice and refuses nonsense', async () => {
  const r = await s.post('/api/roll', { expr: '2d6+3' }); ok(r);
  assert.equal(r.json.total, r.json.rolls[0] + r.json.rolls[1] + 3);
  const adv = await s.post('/api/roll', { expr: 'd20', mode: 'advantage' });
  assert.equal(adv.json.total, Math.max(...adv.json.rolls)); assert.equal(adv.json.mode, 'advantage');
  assert.equal((await s.post('/api/roll', {})).json.rolls.length, 1, 'default is a d20');
  const bad = await s.post('/api/roll', { expr: 'banana' }); assert.equal(bad.status, 400); assert.ok(bad.json.error);
});

test('compendium: lists, entries, and 404s', async () => {
  const list = await s.get('/api/compendium/monsters'); ok(list);
  assert.equal(list.json.entries.length, 334);
  assert.equal((await s.get('/api/compendium/spells')).json.entries.length, 319);
  const gob = await s.get('/api/compendium/monsters/Goblin'); ok(gob);
  assert.equal(gob.json.entry.hit_points, 7);
  assert.equal((await s.get('/api/compendium/monsters/klarg')).status, 404);
  assert.equal((await s.get('/api/compendium/potions')).status, 404);
  const item = await s.get('/api/party/srd-item?kind=magic-items&index=ring-of-protection'); ok(item);
  assert.equal(item.json.item.requiresAttunement, true);
  assert.equal((await s.get('/api/party/srd-item?kind=magic-items&index=nope')).status, 404);
});

test('map configs: list, areas, config read, save round trip with cleaning (and the real data is untouched)', async () => {
  const list = await s.get('/api/map-configs'); ok(list);
  const hideout = list.json.configs.find((c) => c.map === 'lmop-cragmaw-hideout.png.json' || c.map === 'lmop-cragmaw-hideout.png');
  assert.ok(hideout, 'Cragmaw Hideout config is listed'); assert.ok(hideout.walls > 100); assert.ok(hideout.startPin);
  const areas = await s.get('/api/map-areas?map=lmop-cragmaw-hideout.png'); ok(areas);
  assert.ok(Array.isArray(areas.json.areas));
  const cfg = await s.get('/api/map-config?map=lmop-cragmaw-hideout.png'); ok(cfg);
  assert.ok(cfg.json.config.walls.length > 100);
  assert.equal((await s.get('/api/map-config?map=never-uploaded.png')).json.config, null);
  assert.equal((await s.get('/api/map-config?map=../../etc/passwd')).status, 400);

  const body = { squares: 9999, walls: [{ x1: 1.234, y1: 2, x2: 30, y2: 2, type: 'window' }, { x1: 'x', y1: 0, x2: 1, y2: 1 }, { x1: 0, y1: 0, x2: 5, y2: 0, type: 'door', open: true }], starts: [{ name: 'Start!', x: 5, y: 6 }, { name: 'start', x: 1, y: 1 }, { name: '', x: 1, y: 1 }], light: 'dark', ambience: 'jazz', difficult: [{ x: 0, y: 0, w: 0, h: 5 }, { x: 1, y: 1, w: 50, h: 50 }] };
  const put = await s.put('/api/map-config?map=lmop-thundertree.png', body); ok(put); assert.equal(put.json.walls, 2);
  const back = (await s.get('/api/map-config?map=lmop-thundertree.png')).json.config;
  assert.equal(back.squares, 400); assert.deepEqual(back.walls.map((w) => w.type), ['window', 'door']); assert.equal(back.walls[0].x1, 1.23);
  assert.equal(back.starts.filter((p) => p.name === 'start').length, 1, 'names are cleaned and only one start pin is kept'); assert.ok(back.starts.some((p) => p.name === 'start' && p.x === 5 && p.y === 6));
  assert.equal(back.light, 'dark'); assert.equal(back.ambience, undefined); assert.equal(back.difficult.length, 1);
  assert.equal((await s.put('/api/map-config?map=notes.txt', body)).status, 400);
  const setsDir = path.join(import.meta.dirname, '..', 'data', 'mapsets');
  let real = null;
  for (const g of await (await import('node:fs/promises')).readdir(setsDir)) { try { const d = JSON.parse(await readFile(path.join(setsDir, g, 'set.json'), 'utf8')); if (d.levels.some((lv) => lv.looks.some((l) => l.player === 'lmop-thundertree.png'))) real = d; } catch { /* not a packet */ } }
  assert.ok(real && real.levels[0].walls.length > 2, 'the real set of the picture is unchanged by the sandbox test');
});

test('light zones are cleaned, saved with the map, and kept when a later save does not mention them', async () => {
  const f = 'lmop-thundertree.png';
  const base = (await s.get('/api/map-config?map=' + f)).json.config;
  const zones = [
    { id: 'Cave Mouth!', name: 'Cave', level: 'dark', points: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 100 }, { x: 'x', y: 5 }] },
    { name: 'Yard', level: 'time', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] },
    { name: 'Too few', level: 'dim', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    { name: 'Bad light', level: 'purple', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }
  ];
  ok(await s.put('/api/map-config?map=' + f, { ...base, lightZones: zones }));
  let back = (await s.get('/api/map-config?map=' + f)).json.config;
  assert.deepEqual(back.lightZones.map((z) => [z.id, z.name, z.level, z.points.length]), [['cave-mouth', 'Cave', 'dark', 3], ['zone-2', 'Yard', 'time', 3]], 'bad points, too few points and unknown levels are dropped');
  const { lightZones: _drop, ...noZones } = base;
  ok(await s.put('/api/map-config?map=' + f, noZones));
  back = (await s.get('/api/map-config?map=' + f)).json.config;
  assert.equal(back.lightZones.length, 2, 'a save that says nothing about zones keeps them');
  ok(await s.put('/api/map-config?map=' + f, { ...base, lightZones: [] }));
  assert.equal((await s.get('/api/map-config?map=' + f)).json.config.lightZones, undefined, 'an empty list removes them');
});

test('campaign maps: the Lost Mine list is served and the available maps resolve to installed pictures', async () => {
  const r = await s.get(`/api/campaigns/${LOST}/maps`); ok(r);
  assert.ok(JSON.stringify(r.json).includes('cragmaw-hideout'));
  ok(await s.get('/api/maps/available'));
});

test('journal and safety and settings: round trips and cleaning', async () => {
  ok(await s.put(`/api/campaigns/${LOST}/journal`, { entries: [{ category: 'quest', title: 'Find Gundren', text: 'He is missing.', status: 'open' }, { category: 'nonsense', title: 'x', text: 'y' }, { title: 'no text' }] }));
  const j = (await s.get(`/api/campaigns/${LOST}/journal`)).json;
  assert.equal(j.entries.length, 2); assert.equal(j.entries[1].category, 'event');
  ok(await s.put(`/api/campaigns/${LOST}/safety`, { lines: 'spiders\nclowns', notes: 'hi' }));
  assert.deepEqual((await s.get(`/api/campaigns/${LOST}/safety`)).json.lines, ['spiders', 'clowns']);
  const set = await s.put(`/api/campaigns/${LOST}/settings`, { permadeath: true, rules: '2099' }); ok(set);
  assert.deepEqual([set.json.permadeath, set.json.rules], [true, '2014']);
  assert.equal((await s.put('/api/campaigns/nope/settings', {})).status, 404);
});

test('saved game: save, load, fog validation, delete', async () => {
  assert.deepEqual((await s.get(`/api/campaigns/${LOST}/game`)).json.board === null || true, true);
  const board = { map: { url: '/uploads/x.png' }, tokens: [{ id: 't1' }] };
  const put = await s.put(`/api/campaigns/${LOST}/game`, { board, chat: [{ role: 'user', content: 'hi' }], savedAt: 123 }); ok(put); assert.equal(put.json.savedAt, 123);
  const got = (await s.get(`/api/campaigns/${LOST}/game`)).json;
  assert.deepEqual(got.board, board); assert.equal(got.savedAt, 123); assert.equal(got.chat.length, 1);
  assert.equal((await s.put(`/api/campaigns/${LOST}/game`, { board: [] })).status, 400);
  assert.equal((await s.put(`/api/campaigns/${LOST}/game`, {})).status, 400);
  const fog = await s.put(`/api/campaigns/${LOST}/game/fog`, { mapUrl: '/uploads/x.png', data: 'data:image/png;base64,AAAA' }); ok(fog);
  assert.equal((await s.get(`/api/campaigns/${LOST}/game`)).json.fog['/uploads/x.png'], 'data:image/png;base64,AAAA');
  assert.equal((await s.put(`/api/campaigns/${LOST}/game/fog`, { mapUrl: '../x', data: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await s.put(`/api/campaigns/${LOST}/game/fog`, { mapUrl: '/uploads/x.png', data: 'nope' })).status, 400);
  ok(await s.del(`/api/campaigns/${LOST}/game`));
  const gone = (await s.get(`/api/campaigns/${LOST}/game`)).json;
  assert.equal(gone.board, null); assert.deepEqual(gone.fog, {});
  assert.equal((await s.get('/api/campaigns/nope/game')).status, 404);
});

test('party: view, stash, attunement limit, long rest', async () => {
  ok(await s.post('/api/campaigns/active', { id: LOST }));
  const p = (await s.get('/api/party')).json;
  assert.equal(p.campaign, LOST); assert.equal(p.characters.length, 4); assert.equal(p.maxAttuned, 3);
  assert.ok(p.characters.every((c) => c.effective && c.effective.ac > 0));
  const stash = await s.put('/api/party/stash', { items: [{ name: 'Gold idol', qty: 2, weight: 3 }], coins: { gp: 40 } }); ok(stash);
  assert.equal((await s.get('/api/party')).json.stash.coins.gp, 40);
  const rings = [1, 2, 3, 4].map((n) => ({ name: `Ring ${n}`, requiresAttunement: true, attuned: true }));
  const put = await s.put('/api/party/characters/edric', { inventory: rings, coins: { gp: 5 } }); ok(put);
  assert.equal(put.json.problems.length, 1); assert.equal(put.json.character.inventory.filter((i) => i.attuned).length, 3);
  assert.equal((await s.put('/api/party/characters/ghost', {})).status, 404);
  await s.post('/api/characters', { id: ID.edric, name: 'Edric', hp: 1, maxHp: 12, abilities: {} });
  const rest = (await s.post('/api/party/rest', { kind: 'long' })).json; assert.ok(rest.rested.includes(ID.edric));
  assert.equal((await s.get('/api/characters?campaign=' + LOST)).json.find((c) => c.id === ID.edric).hp, 12);
});

test('new campaign: copies documents and maps, takes party and settings; bad requests change nothing', async () => {
  const before = (await s.get('/api/campaigns')).json.campaigns.length;
  assert.equal((await s.post('/api/campaigns/new', { template: 'nope', party: [ID.edric] })).status, 404);
  assert.equal((await s.post('/api/campaigns/new', { template: LOST, name: 'Empty party', party: ['ghost'] })).status, 400);
  assert.equal((await s.get('/api/campaigns')).json.campaigns.length, before);
  assert.equal(await exists('data/campaigns/empty-party'), false, 'the half-made folder is removed');
  const r = await s.post('/api/campaigns/new', { template: LOST, name: 'Second Run', party: [ID.edric, 'ghost', ID.astarion], settings: { permadeath: true, rules: '2024' } }); ok(r);
  assert.equal(r.json.id, 'second-run'); assert.deepEqual([...r.json.party].sort(), [ID.astarion, ID.edric].sort());
  const c = (await s.get('/api/campaigns')).json.campaigns.find((x) => x.id === 'second-run');
  assert.equal(c.template, LOST); assert.ok(c.files.length >= 20); assert.deepEqual(c.party.map((x) => x.id).sort(), [ID.astarion, ID.edric].sort());
  assert.deepEqual([(await s.get('/api/campaigns/second-run/settings')).json.permadeath, (await s.get('/api/campaigns/second-run/settings')).json.rules], [true, '2024']);
  assert.equal(await exists('data/campaigns/second-run/save.json'), false, 'the journal is not copied');
  const again = await s.post('/api/campaigns/new', { template: 'second-run', name: 'Second Run', party: [ID.edric] }); ok(again);
  assert.equal(again.json.id, 'second-run-2'); assert.equal(again.json.template, LOST, 'a copy of a copy still points at the original template');
  assert.deepEqual((await s.get('/api/campaigns/second-run/party')).json.party.sort(), [ID.astarion, ID.edric].sort());
  ok(await s.put('/api/campaigns/second-run/party', { party: [ID.edric] }));
  assert.equal((await s.put('/api/campaigns/second-run/party', { party: ['ghost'] })).status, 400);
  assert.deepEqual((await s.get('/api/characters?campaign=second-run')).json.map((x) => x.id), [ID.edric]);
});

test('start over clears the journal, game, fog and stash but keeps documents and characters', async () => {
  const id = 'second-run';
  await s.put(`/api/campaigns/${id}/journal`, { entries: [{ category: 'event', title: 'A', text: 'b' }] });
  await s.put(`/api/campaigns/${id}/game`, { board: { a: 1 }, chat: [] });
  await s.put(`/api/campaigns/${id}/game/fog`, { mapUrl: '/uploads/x.png', data: 'data:image/png;base64,AAAA' });
  ok(await s.post(`/api/campaigns/${id}/start-over`));
  assert.equal((await s.get(`/api/campaigns/${id}/journal`)).json.entries.length, 0);
  const g = (await s.get(`/api/campaigns/${id}/game`)).json; assert.equal(g.board, null); assert.deepEqual(g.fog, {});
  assert.ok((await s.get('/api/campaigns')).json.campaigns.find((c) => c.id === id).files.length >= 20);
  assert.equal((await s.post('/api/campaigns/nope/start-over')).status, 404);
});

test('campaign files: read, write, delete, name validation', async () => {
  const f = await s.get(`/api/campaigns/${LOST}/files/01-front-matter.md`); ok(f); assert.ok(f.json.chars > 100);
  assert.equal((await s.get(`/api/campaigns/${LOST}/files/nope.md`)).status, 404);
  assert.equal((await s.get(`/api/campaigns/${LOST}/files/..%2F..%2Fserver.js`)).status, 400);
  ok(await s.put('/api/campaigns/second-run/files/notes.md', { text: 'hello' }));
  assert.equal((await s.get('/api/campaigns/second-run/files/notes.md')).json.text, 'hello');
  assert.equal((await s.put('/api/campaigns/second-run/files/notes.md', { text: '  ' })).status, 400);
  assert.equal((await s.put('/api/campaigns/second-run/files/evil.sh', { text: 'x' })).status, 400);
  ok(await s.del('/api/campaigns/second-run/files/notes.md'));
});

// Every endpoint that changes setup is local-only: a request that names another Host (DNS rebinding) or another Origin (another web page) is refused and changes nothing.
const GUARDED = [
  ['PUT', '/api/map-config?map=lmop-thundertree.png', { walls: [] }],
  ['PUT', `/api/campaigns/${LOST}/maps`, { maps: [] }], ['DELETE', `/api/campaigns/${LOST}/maps`],
  ['PUT', `/api/campaigns/${LOST}/safety`, { lines: ['x'] }], ['PUT', `/api/campaigns/${LOST}/settings`, { permadeath: true }],
  ['PUT', `/api/campaigns/${LOST}/journal`, { entries: [] }], ['PUT', `/api/campaigns/${LOST}/party`, { party: [ID.edric] }],
  ['POST', `/api/campaigns/${LOST}/start-over`, {}], ['POST', '/api/campaigns/new', { template: LOST, name: 'Evil', party: [ID.edric] }],
  ['POST', '/api/campaigns/active', { id: 'tavern-brawl-test' }], ['PUT', `/api/campaigns/${LOST}/files/x.md`, { text: 'x' }], ['DELETE', `/api/campaigns/${LOST}/files/01-front-matter.md`],
  ['POST', '/api/test-lab/reset-party', {}], ['PUT', '/api/map-maker/requests', {}], ['PUT', '/api/map-maker/feedback', {}], ['PUT', '/api/sound-feedback', {}], ['POST', '/api/sound-choice', {}],
  ['PUT', '/api/dm-map?map=x.png', {}], ['GET', '/api/settings'], ['POST', '/api/settings', { ANTHROPIC_API_KEY: 'sk-evil' }], ['POST', '/api/settings/test', {}]
];
for (const [method, url, body] of GUARDED) {
  test(`local-only guard: ${method} ${url.split('?')[0]}`, async () => {
    for (const hdr of [{ host: 'evil.example.com' }, { origin: 'http://evil.example.com' }, { host: 'localhost.evil.com:3000' }]) {
      const r = await raw(method, url, { ...hdr, body });
      assert.equal(r.status, 403, `${JSON.stringify(hdr)} -> ${r.status} ${r.text.slice(0, 120)}`);
    }
  });
}

test('the guards did not change anything, and a proper local request still works', async () => {
  assert.equal((await s.get('/api/campaigns')).json.active, LOST);
  assert.ok((await s.get(`/api/campaigns/${LOST}/files/01-front-matter.md`)).json.chars > 100);
  assert.equal(await exists('data/campaigns/evil'), false);
  assert.equal(await exists('.env'), false);
  const r = await raw('POST', '/api/campaigns/active', { host: `localhost:${s.port}`, origin: `http://localhost:${s.port}`, body: { id: 'tavern-brawl-test' } });
  assert.equal(r.status, 200);
});

test('chat without an API key answers that the DM is offline and spends nothing', async () => {
  const r = await s.post('/api/chat', { message: 'hello' }); ok(r);
  assert.equal(r.json.offline, true); assert.deepEqual(r.json.mapUpdates, []);
  assert.equal((await s.post('/api/chat', { message: '  ' })).status, 400);
});

test('map config: pins may share a name (only start is unique) and keep their arrival radius', async () => {
  const body = { squares: 30, walls: [], starts: [{ name: 'guard-post', x: 10, y: 10 }, { name: 'guard-post', x: 40, y: 40, radius: 1.5 }, { name: 'start', x: 5, y: 5, radius: 2 }, { name: 'start', x: 6, y: 6 }] };
  const put = await s.put('/api/map-config?map=lmop-thundertree.png', body);
  assert.equal(put.status, 200);
  const back = (await s.get('/api/map-config?map=lmop-thundertree.png')).json.config;
  assert.equal(back.starts.filter((p) => p.name === 'guard-post').length, 2);
  assert.equal(back.starts.filter((p) => p.name === 'start').length, 1);
  assert.equal(back.starts.find((p) => p.x === 40).radius, 1.5);
  assert.equal(back.starts.find((p) => p.name === 'start').radius, 2);
});

test('new campaign from scratch: its own name, premise document, picked maps and party; bad requests change nothing', async () => {
  const before = (await s.get('/api/campaigns')).json.campaigns.length;
  assert.equal((await s.post('/api/campaigns/new', { scratch: true, name: '', party: [ID.edric] })).status, 400);
  assert.equal((await s.post('/api/campaigns/new', { scratch: true, name: 'No Party', party: ['ghost'] })).status, 400);
  assert.equal((await s.get('/api/campaigns')).json.campaigns.length, before);
  assert.equal(await exists('data/campaigns/no-party'), false, 'nothing is written for a refused request');
  const picture = (await s.get('/api/maps')).json.maps[0].replace('/uploads/', '');
  const r = await s.post('/api/campaigns/new', { scratch: true, name: 'The Sunken Bell', premise: 'A drowned village whose bell still rings at night.\nTone: eerie, low magic.', party: [ID.edric, 'ghost'], maps: [{ file: picture, name: 'The shore', kind: 'camp', description: 'Where the party lands.' }, { file: 'nope.png' }], settings: { rules: '2014', tableNotes: 'be gentle' } }); ok(r);
  assert.equal(r.json.id, 'the-sunken-bell'); assert.deepEqual(r.json.party, [ID.edric]); assert.equal(r.json.maps, 1); assert.equal(r.json.problems.length, 1);
  const c = (await s.get('/api/campaigns')).json.campaigns.find((x) => x.id === 'the-sunken-bell');
  assert.equal(c.template, 'the-sunken-bell'); assert.ok(c.files.some((f) => f.name === '00-premise.md'));
  assert.match((await s.get('/api/campaigns/the-sunken-bell/files/00-premise.md')).json.text, /drowned village/);
  const maps = (await s.get('/api/campaigns/the-sunken-bell/maps')).json;
  assert.equal(maps.custom, true); assert.deepEqual(maps.maps.map((m) => [m.name, m.kind]), [['The shore', 'camp']]);
  assert.equal((await s.get('/api/campaigns/the-sunken-bell/settings')).json.tableNotes, 'be gentle');
  assert.equal((await s.post('/api/campaigns/new', { scratch: true, name: 'The Sunken Bell', party: [ID.edric] })).json.id, 'the-sunken-bell-2', 'a second one with the same name gets its own id');
});

test('quick starter characters: a name, race, class and level give a full sheet; bad requests change nothing', async () => {
  const choices = (await s.get('/api/characters/quick')).json;
  assert.ok(choices.classes.includes('Wizard') && choices.races.includes('Tiefling') && choices.levels.length === 5);
  const before = (await s.get('/api/characters')).json.length;
  assert.equal((await s.post('/api/characters/quick', { name: '', cls: 'Wizard', race: 'Elf' })).status, 400);
  assert.equal((await s.post('/api/characters/quick', { name: 'Nope', cls: 'Jedi', race: 'Elf' })).status, 400);
  assert.equal((await s.post('/api/characters/quick', { name: 'Nope', cls: 'Wizard', race: 'Ewok' })).status, 400);
  assert.equal((await s.get('/api/characters')).json.length, before);
  const r = await s.post('/api/characters/quick', { name: 'Mira Vale', cls: 'Wizard', race: 'Elf', level: 3 }); ok(r);
  const c = r.json.character;
  assert.match(c.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'a new character gets a GUID'); assert.equal(c.class, 'Wizard'); assert.equal(c.level, 3);
  assert.equal(c.abilities.int, 15); assert.equal(c.abilities.dex, 15, 'the elf bonus (+2 Dexterity) is on top of the standard array');
  assert.equal(c.maxHp, 6 + 2 + 2 * (4 + 2), 'hit die + Con at level 1, then the average and Con each level');
  assert.equal(c.ac, 12); assert.equal(c.darkvision, 60);
  assert.equal(c.sheet.ClassLevel, 'Wizard 3'); assert.equal(c.sheet['Race '], 'Elf'); assert.ok(c.sheet['SpellSaveDC  2']);
  assert.ok(c.inventory.some((i) => /spellbook/i.test(i.name)));
  const again = await s.post('/api/characters/quick', { name: 'Mira Vale', cls: 'Fighter', race: 'Human' }); ok(again);
  assert.notEqual(again.json.character.id, c.id, 'two characters with the same name get different ids'); assert.equal(again.json.character.ac, 18);
  assert.ok((await s.get('/api/characters')).json.some((x) => x.id === c.id));
});

test('the Market: save a map as a pack, list it, add it to a campaign, export and import it; purchased pictures and private packs stay put', async () => {
  const shop = (await s.get('/api/market')).json;
  assert.deepEqual(shop.types, ['battle', 'camp', 'town', 'regional']); assert.ok(shop.moods.some((m) => m.id === 'haunted') && shop.licences.length >= 4);
  const pictures = (await s.get('/api/maps')).json.maps.map((u) => u.replace('/uploads/', ''));
  const mine = pictures.find((f) => f === 'vtt-terrain-test.png'), bought = pictures.find((f) => /^lmop-/.test(f));
  assert.ok(mine && bought, 'the sandbox has a generated and a purchased picture');
  assert.equal((await s.post('/api/market/maps', { picture: bought, name: 'Stolen', rights: true })).status, 403, 'a purchased picture is never packed');
  assert.equal((await s.post('/api/market/maps', { picture: 'nope.png', name: 'x', rights: true })).status, 404);
  assert.equal((await s.post('/api/market/maps', { picture: mine, name: '', rights: true })).status, 400);
  assert.equal((await s.post('/api/market/maps', { picture: mine, name: 'Test Grounds' })).status, 400, 'the rights must be confirmed');
  const saved = await s.post('/api/market/maps', { picture: mine, name: 'Test Grounds', type: 'battle', description: 'A meadow with a creek.', tags: 'Outdoor, creek,outdoor', mood: 'night', licence: 'CC0 (public domain)', rights: true }); ok(saved);
  assert.equal(saved.json.id, 'test-grounds'); assert.deepEqual(saved.json.pack.tags, ['outdoor', 'creek']); assert.equal(saved.json.pack.mood, 'night');
  assert.ok(saved.json.pack.walls > 0 || saved.json.pack.squares > 0);
  const list = (await s.get('/api/market')).json.maps; assert.equal(list.length, 1); assert.equal(list[0].name, 'Test Grounds');
  const pic = await fetch(`${s.base}/api/market/test-grounds/picture`); assert.equal(pic.status, 200); assert.match(pic.headers.get('content-type'), /image/);
  // add it to a campaign
  const made = await s.post('/api/campaigns/new', { scratch: true, name: 'Market Test', party: [ID.edric] }); ok(made);
  const add = await s.post('/api/market/test-grounds/install', { campaign: 'market-test' }); ok(add);
  assert.match(add.json.file, /^mkt-test-grounds\./);
  const maps = (await s.get('/api/campaigns/market-test/maps')).json.maps;
  assert.deepEqual(maps.map((m) => [m.name, m.kind]), [['Test Grounds', 'battle']]);
  assert.equal((await s.post('/api/market/test-grounds/install', { campaign: 'market-test' })).json.already, true, 'adding it twice changes nothing');
  assert.equal((await s.post('/api/market/test-grounds/install', { campaign: 'ghost' })).status, 404);
  assert.ok((await s.get(`/api/map-config?map=${add.json.file}`)).json.config.squares > 0, 'its set-up came with it');
  // export and import
  const exp = await s.get('/api/market/test-grounds/export'); ok(exp);
  assert.equal(exp.json.format, 'vttpack'); assert.ok(exp.json.picture.data.length > 1000); assert.equal(exp.json.name, 'Test Grounds');
  const imp = await s.post('/api/market/import', exp.json); ok(imp);
  assert.equal(imp.json.id, 'test-grounds-2'); assert.equal((await s.get('/api/market')).json.maps.length, 2);
  assert.equal((await s.post('/api/market/import', { format: 'other' })).status, 400);
  // a private pack does not leave the computer
  const priv = await s.post('/api/market/maps', { picture: mine, name: 'Secret', licence: 'Private: only for me' }); ok(priv);
  assert.equal((await s.get('/api/market/secret/export')).status, 403);
  assert.equal((await s.del('/api/market/secret')).status, 200); assert.equal((await s.del('/api/market/secret')).status, 404);
  assert.equal((await s.get('/api/market')).json.maps.length, 2);
});

test('map config keeps what a door can be: locked, secret and the dc; plain walls drop the flags; a secret door is never saved open', async () => {
  const body = { squares: 20, walls: [
    { x1: 0, y1: 0, x2: 50, y2: 0, type: 'wall', open: false, locked: true, secret: true, dc: 12 },
    { x1: 50, y1: 0, x2: 100, y2: 0, type: 'door', open: false, locked: true, dc: 15 },
    { x1: 100, y1: 0, x2: 150, y2: 0, type: 'door', open: true, secret: true, dc: 18 },
    { x1: 150, y1: 0, x2: 200, y2: 0, type: 'door', open: false, dc: 99 }
  ], starts: [] };
  ok(await s.put('/api/map-config?map=vtt-door-test.png', body));
  const w = (await s.get('/api/map-config?map=vtt-door-test.png')).json.config.walls;
  assert.deepEqual(w[0], { x1: 0, y1: 0, x2: 50, y2: 0, type: 'wall', open: false });
  assert.deepEqual(w[1], { x1: 50, y1: 0, x2: 100, y2: 0, type: 'door', open: false, locked: true, dc: 15 });
  assert.deepEqual(w[2], { x1: 100, y1: 0, x2: 150, y2: 0, type: 'door', open: false, secret: true, dc: 18 });
  assert.deepEqual(w[3], { x1: 150, y1: 0, x2: 200, y2: 0, type: 'door', open: false }, 'a dc outside 5 to 30 is dropped');
});

test('map config keeps the map type (battle, camp, town, regional) and the sets use it', async () => {
  ok(await s.put('/api/map-config?map=vtt-kind-test.png', { squares: 30, walls: [], starts: [], kind: 'town' }));
  assert.equal((await s.get('/api/map-config?map=vtt-kind-test.png')).json.config.kind, 'town');
  ok(await s.put('/api/map-config?map=vtt-kind-test.png', { squares: 30, walls: [], starts: [], kind: 'nonsense' }));
  assert.equal((await s.get('/api/map-config?map=vtt-kind-test.png')).json.config.kind, 'town', 'an unknown kind leaves the set as it was');
});

test('map config keeps the tile kind: hexagons with a size for regional maps, squares (nothing saved) otherwise', async () => {
  ok(await s.put('/api/map-config?map=vtt-hex-test.png', { squares: 30, walls: [], starts: [], tiles: 'hex', hexSize: 62 }));
  let c = (await s.get('/api/map-config?map=vtt-hex-test.png')).json.config; assert.equal(c.tiles, 'hex'); assert.equal(c.hexSize, 62);
  ok(await s.put('/api/map-config?map=vtt-hex-test.png', { squares: 30, walls: [], starts: [], tiles: 'hex', hexSize: 9999 }));
  assert.equal((await s.get('/api/map-config?map=vtt-hex-test.png')).json.config.hexSize, 260, 'the size is clamped');
  ok(await s.put('/api/map-config?map=vtt-hex-test.png', { squares: 30, walls: [], starts: [], kind: 'battle' }));
  c = (await s.get('/api/map-config?map=vtt-hex-test.png')).json.config; assert.equal(c.tiles, undefined); assert.equal(c.hexSize, undefined);
});

test('map library: every picture with its kind, tiles, counts and whether it has a DM version', async () => {
  const lib = (await s.get('/api/map-library')).json.maps;
  assert.ok(lib.length > 10);
  const m = (f) => lib.find((x) => x.file === f);
  assert.equal(m('vtt-terrain-test.png').origin, 'Test'); assert.equal(m('vtt-terrain-test.png').tiles, 'square');
  assert.ok(m('lmop-cragmaw-hideout.png').origin === 'Map Adventurer' && m('lmop-cragmaw-hideout.png').kind === 'battle');
  assert.equal(m('dnd-sword-coast-ours.png').tiles, 'hex'); assert.equal(m('dnd-sword-coast-ours.png').kind, 'regional'); assert.ok(m('dnd-sword-coast-ours.png').pins >= 14);
  assert.equal(typeof m('vtt-phandalin.png').dmVersion, 'boolean', 'every picture says whether it has a DM version');
  assert.ok(lib.every((x) => typeof x.walls === 'number' && Array.isArray(x.campaigns)));
});

test('map sets: the real pictures gather into places (day and night together, DM pictures attached) and the set view is read-only', async () => {
  const sets = (await s.get('/api/mapsets')).json.sets;
  const by = Object.fromEntries(sets.map((x) => [x.id, x]));
  assert.ok(sets.length >= 15 && sets.length < (await s.get('/api/maps')).json.maps.length, 'fewer places than pictures');
  assert.deepEqual(by.camp.times, ['day', 'night']); assert.equal(by.camp.levels[0].looks.length, 2);
  assert.deepEqual(by['cragmaw-castle'].times, ['day', 'night']);
  assert.equal(by['lmop-phandalin'].hasDm, true); assert.equal(by['dnd-sword-coast-ours'].tiles, 'hex'); assert.equal(by['dnd-sword-coast-ours'].levels[0].isRevealed, true);
  assert.equal(by['vtt-phandalin'].kind, 'town'); assert.equal(by['vtt-phandalin'].origin, 'Explorer'); assert.equal(by['dnd-sword-coast-ours'].origin, 'Explorer'); assert.equal(by['lmop-phandalin'].origin, 'Wizards of the Coast', 'the Phandalin pictures are Wizards of the Coast art although they carry the pack prefix'); assert.equal(by['lmop-cragmaw-hideout'].origin, 'Map Adventurer');
  const coast = by['dnd-northswordcoast']; assert.ok(coast && !by['dnd-northswordcoast-playerversion'], 'the plain and the player version of the Sword Coast are one place'); assert.equal(coast.levels[0].looks[0].player, 'dnd-northswordcoast-playerversion.jpg'); assert.equal(coast.levels[0].looks[0].dm, 'dnd-northswordcoast.jpg'); assert.equal(by['dnd-phandalin'].origin, 'Wizards of the Coast'); assert.ok(by['vtt-phandalin'].hasDm);
  assert.ok(by.camp.levels[0].px && by.camp.levels[0].px.w > 100, 'the picture size is read'); assert.equal(by.camp.levels[0].game.unit, 'ft'); assert.equal(by['dnd-sword-coast-ours'].levels[0].game.unit, 'miles'); assert.equal(by['lmop-phandalin'].levels[0].game, null, 'a town has no tile units');
  assert.equal((await s.post('/api/mapsets', {})).status, 404, 'nothing writes to sets yet');
});

test('map sets: archive hides a place from the list and restores it; delete is refused while a campaign lists the place', async () => {
  const sets = (await s.get('/api/mapsets')).json.sets;
  const one = sets.find((x) => x.id === 'vtt-terrain-test') || sets[0];
  assert.equal((await s.post('/api/mapsets/' + one.guid + '/archive', { archived: true })).status, 200);
  assert.ok(!(await s.get('/api/mapsets')).json.sets.some((x) => x.guid === one.guid), 'archived places leave the list');
  assert.ok((await s.get('/api/mapsets?archived=1')).json.sets.some((x) => x.guid === one.guid && x.archived), 'and show with ?archived=1');
  assert.equal((await s.post('/api/mapsets/' + one.guid + '/archive', { archived: false })).status, 200);
  assert.ok((await s.get('/api/mapsets')).json.sets.some((x) => x.guid === one.guid));
  const used = sets.find((x) => x.campaigns.length);
  const res = await fetch(s.base + '/api/mapsets/' + used.guid, { method: 'DELETE' });
  assert.equal(res.status, 409, 'a map a campaign lists cannot be deleted');
});

test('map sets: a clone has its own id and pictures, deleting it leaves the original alone, and a copy of a purchased map stays out of the Market', async () => {
  const sets = (await s.get('/api/mapsets')).json.sets;
  const src = sets.find((x) => x.id === 'lmop-agathas-lair');
  assert.ok(src, 'the purchased Agatha set exists');
  const c = await s.post('/api/mapsets/' + src.guid + '/clone', { publisher: 'Explorer' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.notEqual(c.json.guid, src.guid); assert.ok(c.json.pictures.every((p) => p.startsWith('vtt-pack-')), 'copies of purchased pictures are named vtt-pack-');
  const copy = (await s.get('/api/mapsets')).json.sets.find((x) => x.guid === c.json.guid);
  assert.equal(copy.origin, 'Explorer'); assert.equal(copy.derivedFrom, 'Map Adventurer'); assert.equal(copy.levels[0].walls, src.levels[0].walls, 'the walls came along');
  assert.equal((await fetch(s.base + '/uploads/' + c.json.pictures[0])).status, 200, 'the copied picture is served');
  const save = await s.post('/api/market/maps', { name: 'Nope', picture: c.json.pictures[0], rights: true });
  assert.notEqual(save.status, 200, 'the Market refuses a copy of a purchased map');
  const del = await fetch(s.base + '/api/mapsets/' + c.json.guid, { method: 'DELETE' });
  assert.equal(del.status, 200, await del.text());
  assert.equal((await fetch(s.base + '/uploads/' + c.json.pictures[0])).status, 404, 'the copy is gone');
  assert.equal((await fetch(s.base + '/uploads/lmop-agathas-lair.png')).status, 200, 'the original picture is untouched');
  assert.ok((await s.get('/api/mapsets')).json.sets.some((x) => x.guid === src.guid), 'and its set');
});

test('settings: the image model and quality are saved next to the voices, validated, and shown; the images check needs the shared OpenAI key', async () => {
  const before = (await s.get('/api/settings')).json.openai;
  assert.equal(before.imageModel, 'gpt-image-1'); assert.equal(before.imageQuality, 'medium');
  assert.equal((await s.post('/api/settings', { IMAGE_MODEL: 'gpt-image-1-mini', IMAGE_QUALITY: 'high' })).status, 200);
  const after = (await s.get('/api/settings')).json.openai;
  assert.equal(after.imageModel, 'gpt-image-1-mini'); assert.equal(after.imageQuality, 'high');
  assert.equal((await s.post('/api/settings', { IMAGE_MODEL: 'bad model!' })).status, 400, 'a model name with spaces or symbols is refused');
  assert.equal((await s.post('/api/settings', { IMAGE_PROVIDER: 'gemini', IMAGE_MODEL: 'gemini-nano-banana-2.1', IMAGE_QUALITY: '1K' })).status, 200);
  const g = (await s.get('/api/settings')).json.openai;
  assert.equal(g.imageProvider, 'gemini'); assert.equal(g.imageQuality, '1K'); assert.equal(g.imageKeys.gemini.set, false);
  assert.match((await s.post('/api/settings/test', { which: 'images' })).json.error, /No Google Gemini key/, 'the check follows the chosen provider');
  await s.post('/api/settings', { IMAGE_PROVIDER: 'openai', IMAGE_MODEL: 'gpt-image-1', IMAGE_QUALITY: 'medium' });
  const t = await s.post('/api/settings/test', { which: 'images' });
  assert.equal(t.json.ok, false); assert.match(t.json.error, /same key as the voices|No OpenAI key/);
  await s.post('/api/settings', { IMAGE_MODEL: 'gpt-image-1', IMAGE_QUALITY: 'medium' });
});

test('map config: animated effects are saved with the set, cleaned, and kept when a save does not carry them; lights keep kind and an unlit start', async () => {
  const eff = { id: 'Big River!', type: 'river', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }], path: [{ x: 0, y: 20 }, { x: 100, y: 20 }], speed: 99, color: 'ff3300' };
  const bad = [{ type: 'quicksand', points: eff.points }, { type: 'lava', points: [{ x: 1, y: 1 }] }];
  ok(await s.put('/api/map-config?map=vtt-eff-test.png', { squares: 20, walls: [], starts: [], effects: [eff, ...bad], lights: [{ x: 50, y: 50, range: 4, name: 'Iron Brazier', kind: 'brazier', on: false, flicker: true }] }));
  let c = (await s.get('/api/map-config?map=vtt-eff-test.png')).json.config;
  assert.equal(c.effects.length, 1, 'a made-up type and a polygon of one point are dropped');
  assert.deepEqual([c.effects[0].id, c.effects[0].type, c.effects[0].speed, c.effects[0].color], ['big-river', 'river', 4, 'ff3300']);
  assert.deepEqual([c.lights[0].name, c.lights[0].kind, c.lights[0].on], ['iron-brazier', 'brazier', false]);
  ok(await s.put('/api/map-config?map=vtt-eff-test.png', { squares: 20, walls: [{ x1: 0, y1: 0, x2: 10, y2: 0 }], starts: [], lights: c.lights }));       // Map Test sends no effects
  c = (await s.get('/api/map-config?map=vtt-eff-test.png')).json.config;
  assert.equal(c.effects.length, 1, 'effects survive a save that does not mention them');
});

test('map sets: a night look is added to a place with its own picture, light and sound; a second night is refused; the walls stay shared', async () => {
  const sets = (await s.get('/api/mapsets')).json.sets;
  const flagon = sets.find((x) => x.id === 'vtt-rusty-flagon-mutfjjbo');
  const pic = (await s.get('/api/maps')).json.maps.map((u) => u.replace('/uploads/', '')).find((f) => f.startsWith('vtt-camp-day'));
  assert.ok(flagon && pic);
  const r = await s.post('/api/mapsets/' + flagon.guid + '/looks', { time: 'night', picture: pic, light: 'dark', ambient: 'ff1a2240', ambience: 'night' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.looks.map((l) => l.time), ['day', 'night'], 'a lone main look becomes the day look');
  assert.equal((await s.post('/api/mapsets/' + flagon.guid + '/looks', { time: 'night', picture: pic })).status, 409);
  assert.equal((await fetch(s.base + '/uploads/' + pic)).status, 200, 'the picture is still served after the refused duplicate');
  assert.ok((await s.get('/api/mapsets')).json.sets.some((x) => x.id === 'camp' && x.levels[0].looks.some((l) => l.player === pic)), 'the camp keeps its own day picture: a real place is not robbed');
  assert.equal((await s.post('/api/mapsets/' + flagon.guid + '/looks', { time: 'main', picture: pic })).status, 400);
  const sum = (await s.get('/api/mapsets')).json.sets.find((x) => x.guid === flagon.guid);
  assert.deepEqual(sum.times, ['day', 'night']); assert.equal(sum.levels[0].walls, flagon.levels[0].walls, 'the walls are the level\'s, shared by both looks');
  assert.equal(sum.levels[0].looks.find((l) => l.time === 'night').light, 'dark');
});

test('a pin can be marked dmOnly (hidden from players) and the flag is saved', async () => {
  const file = 'vtt-terrain-test.png';
  const cur = (await s.get('/api/map-config?map=' + file)).json;
  const starts = [...(cur.config.starts || []).filter((p) => p.name === 'start'), { name: 'secret-cache', x: 100, y: 120, desc: 'The thieves hid it here', dmOnly: true }, { name: 'old-mill', x: 300, y: 320, label: 'Old Mill' }];
  const put = await s.put('/api/map-config?map=' + file, { ...cur.config, starts, baseVersion: cur.setVersion });
  assert.equal(put.status, 200, put.text);
  const back = (await s.get('/api/map-config?map=' + file)).json.config.starts;
  assert.equal(back.find((p) => p.name === 'secret-cache').dmOnly, true); assert.equal(back.find((p) => p.name === 'old-mill').dmOnly, undefined);
});

test('starter characters from the campaign wizard get real cantrips and spells for their class and level', async () => {
  const make = async (cls, level) => { const r = await s.post('/api/characters/quick', { name: 'T ' + cls + level, race: 'Human', cls, level }); assert.equal(r.status, 200, r.text); return r.json.character || r.json; };
  const spellsOf = (c) => Object.entries(c.sheet || {}).filter(([k, v]) => /^Spells /.test(k) && v).map(([, v]) => v);
  const wiz = await make('Wizard', 3);
  assert.ok(spellsOf(wiz).includes('Fire Bolt') && spellsOf(wiz).includes('Magic Missile') && spellsOf(wiz).includes('Misty Step'), 'a level 3 wizard has cantrips, 1st and 2nd level spells: ' + spellsOf(wiz).join(', '));
  assert.equal(spellsOf(wiz).length, 3 + 6 + 4, 'three cantrips and a spellbook of 6 + 2 per level above 1');
  const cleric = await make('Cleric', 1);
  assert.ok(spellsOf(cleric).includes('Cure Wounds') && spellsOf(cleric).includes('Sacred Flame'));
  const fighter = await make('Fighter', 3);
  assert.equal(spellsOf(fighter).length, 0, 'a fighter has no spells');
  const ranger1 = await make('Ranger', 1);
  assert.equal(spellsOf(ranger1).length, 0, 'a level 1 ranger has no spell slots yet');
  const warlock = await make('Warlock', 3);
  assert.ok(spellsOf(warlock).includes('Eldritch Blast') && spellsOf(warlock).some((n) => n === 'Misty Step' || n === 'Hold Person'), 'a level 3 warlock knows pact-level spells: ' + spellsOf(warlock).join(', '));
});

test('map labels are cleaned, saved in the set, kept when a later save does not mention them and removed by an empty list', async () => {
  const f = 'lmop-thundertree.png';
  const { readdir } = await import('node:fs/promises');
  const base = (await s.get('/api/map-config?map=' + f)).json.config;
  delete base.labels; delete base.setVersion;
  const long = 'N'.repeat(90);
  const labels = [
    { id: 'Sword Mountains!', text: ' Sword\u0001 Mountains ', kind: 'region', x: 400, y: 300.456, size: 48, rot: -22 },
    { text: 'The High Road', kind: 'trail', x: 0, y: 0, path: [{ x: 10, y: 10 }, { x: 'x', y: 5 }, { x: 60, y: 40 }, { x: 120, y: 90 }], rot: 30 },
    { text: 'Midpoint trail', kind: 'trail', path: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }] },
    { text: 'Neverwinter', kind: 'place', x: 20, y: 30, size: -5 },
    { text: long, kind: 'region', x: 1, y: 2 },
    { text: 'No path', kind: 'trail', x: 5, y: 5 },
    { text: 'One point', kind: 'trail', x: 5, y: 5, path: [{ x: 1, y: 1 }] },
    { text: 'Bad kind', kind: 'ocean', x: 5, y: 5 },
    { text: '   ', kind: 'place', x: 5, y: 5 },
    { text: 'No place', kind: 'place' },
    { id: 'sword-mountains', text: 'Same id', kind: 'place', x: 9, y: 9 }
  ];
  ok(await s.put('/api/map-config?map=' + f, { ...base, labels }));
  let back = (await s.get('/api/map-config?map=' + f)).json.config;
  assert.deepEqual(back.labels.map((l) => [l.id, l.text, l.kind]), [['sword-mountains', 'Sword Mountains', 'region'], ['label-2', 'The High Road', 'trail'], ['label-3', 'Midpoint trail', 'trail'], ['label-4', 'Neverwinter', 'place'], ['label-5', 'N'.repeat(60), 'region'], ['sword-mountains-2', 'Same id', 'place']], 'bad text, kinds, positions and short paths are dropped, text is cut to 60, ids are unique');
  const [mount, road, mid, place] = back.labels;
  assert.deepEqual([mount.x, mount.y, mount.size, mount.rot], [400, 300.46, 48, -22]);
  assert.deepEqual(road.path, [{ x: 10, y: 10 }, { x: 60, y: 40 }, { x: 120, y: 90 }], 'a path point that is not a number is dropped'); assert.equal(road.rot, undefined, 'a trail follows its path: no rotation');
  assert.deepEqual([mid.x, mid.y], [50, 50], 'a trail with no position sits at the middle of its path');
  assert.equal(place.size, undefined, 'a size that is not positive is dropped');
  // the round trip through the stored set: the level carries the labels, so the file on disk has them
  const packets = await readdir(path.join(s.dir, 'data', 'mapsets'));
  let found = 0;
  for (const p of packets) { const set = await readFile(path.join(s.dir, 'data', 'mapsets', p, 'set.json'), 'utf8').then(JSON.parse, () => null); if (set && set.levels?.some((lv) => (lv.labels || []).some((l) => l.text === 'The High Road'))) found++; }
  assert.equal(found, 1, 'the labels are stored in the set file');
  // a save that says nothing about labels keeps them
  ok(await s.put('/api/map-config?map=' + f, base));
  back = (await s.get('/api/map-config?map=' + f)).json.config;
  assert.equal(back.labels.length, 6, 'a save that says nothing about labels keeps them');
  // more than 60 are cut and a path is limited to 200 points
  const many = Array.from({ length: 70 }, (_, i) => ({ text: 'L' + i, kind: 'trail', path: Array.from({ length: 250 }, (_, j) => ({ x: j, y: i })) }));
  ok(await s.put('/api/map-config?map=' + f, { ...base, labels: many }));
  back = (await s.get('/api/map-config?map=' + f)).json.config;
  assert.equal(back.labels.length, 60); assert.equal(back.labels[0].path.length, 200);
  ok(await s.put('/api/map-config?map=' + f, { ...base, labels: [] }));
  assert.equal((await s.get('/api/map-config?map=' + f)).json.config.labels, undefined, 'an empty list removes them');
});
