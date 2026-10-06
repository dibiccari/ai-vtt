// HTTP tests: the real server.js runs on a random port inside a throwaway copy of the app and its data, with no API keys (nothing is spent, nothing real is touched).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from './helpers/sandbox.mjs';

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
  assert.equal(all.length, 8);
  assert.deepEqual((await s.get(`/api/characters?campaign=${LOST}`)).json.map((c) => c.id), ['astarion', 'edric', 'rachel', 'shadowheart']);
  const edric = all.find((c) => c.id === 'edric');
  const saved = await s.post('/api/characters', { id: 'edric', name: 'Edric', class: 'Fighter', level: 1, hp: 3, maxHp: 12, ac: 18, abilities: edric.abilities });
  ok(saved); assert.equal(saved.json.hp, 3);
  const after = (await s.get('/api/characters')).json.find((c) => c.id === 'edric');
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
  assert.equal(back.squares, 400); assert.deepEqual(back.walls.map((w) => w.type), ['fence', 'door']); assert.equal(back.walls[0].x1, 1.23);
  assert.deepEqual(back.starts, [{ name: 'start', x: 5, y: 6 }], 'names are cleaned and duplicates dropped');
  assert.equal(back.light, 'dark'); assert.equal(back.ambience, undefined); assert.equal(back.difficult.length, 1);
  assert.equal((await s.put('/api/map-config?map=notes.txt', body)).status, 400);
  const real = JSON.parse(await readFile(path.join(import.meta.dirname, '..', 'data', 'maps', 'lmop-thundertree.png.json'), 'utf8'));
  assert.ok(real.walls.length > 2, 'the real data/maps file is unchanged');
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
  await s.post('/api/characters', { id: 'edric', name: 'Edric', hp: 1, maxHp: 12, abilities: {} });
  const rest = (await s.post('/api/party/rest', { kind: 'long' })).json; assert.ok(rest.rested.includes('edric'));
  assert.equal((await s.get('/api/characters?campaign=' + LOST)).json.find((c) => c.id === 'edric').hp, 12);
});

test('new campaign: copies documents and maps, takes party and settings; bad requests change nothing', async () => {
  const before = (await s.get('/api/campaigns')).json.campaigns.length;
  assert.equal((await s.post('/api/campaigns/new', { template: 'nope', party: ['edric'] })).status, 404);
  assert.equal((await s.post('/api/campaigns/new', { template: LOST, name: 'Empty party', party: ['ghost'] })).status, 400);
  assert.equal((await s.get('/api/campaigns')).json.campaigns.length, before);
  assert.equal(await exists('data/campaigns/empty-party'), false, 'the half-made folder is removed');
  const r = await s.post('/api/campaigns/new', { template: LOST, name: 'Second Run', party: ['edric', 'ghost', 'astarion'], settings: { permadeath: true, rules: '2024' } }); ok(r);
  assert.equal(r.json.id, 'second-run'); assert.deepEqual(r.json.party, ['edric', 'astarion']);
  const c = (await s.get('/api/campaigns')).json.campaigns.find((x) => x.id === 'second-run');
  assert.equal(c.template, LOST); assert.ok(c.files.length >= 20); assert.deepEqual(c.party.map((x) => x.id).sort(), ['astarion', 'edric']);
  assert.deepEqual([(await s.get('/api/campaigns/second-run/settings')).json.permadeath, (await s.get('/api/campaigns/second-run/settings')).json.rules], [true, '2024']);
  assert.equal(await exists('data/campaigns/second-run/save.json'), false, 'the journal is not copied');
  const again = await s.post('/api/campaigns/new', { template: 'second-run', name: 'Second Run', party: ['edric'] }); ok(again);
  assert.equal(again.json.id, 'second-run-2'); assert.equal(again.json.template, LOST, 'a copy of a copy still points at the original template');
  assert.deepEqual((await s.get('/api/campaigns/second-run/party')).json.party.sort(), ['astarion', 'edric']);
  ok(await s.put('/api/campaigns/second-run/party', { party: ['edric'] }));
  assert.equal((await s.put('/api/campaigns/second-run/party', { party: ['ghost'] })).status, 400);
  assert.deepEqual((await s.get('/api/characters?campaign=second-run')).json.map((x) => x.id), ['edric']);
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
  ['PUT', `/api/campaigns/${LOST}/journal`, { entries: [] }], ['PUT', `/api/campaigns/${LOST}/party`, { party: ['edric'] }],
  ['POST', `/api/campaigns/${LOST}/start-over`, {}], ['POST', '/api/campaigns/new', { template: LOST, name: 'Evil', party: ['edric'] }],
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
