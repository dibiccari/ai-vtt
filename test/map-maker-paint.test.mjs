// The Map Maker's painting and saving steps: the services with a key, the price, the picture made from the checked layout (battle) or from the text alone (town, regional),
// and a saved map that Map Test can open with its walls, doors, lights and start spots in the right places. Against a pretend OpenAI images server: free and offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer } from './helpers/sandbox.mjs';
import { compileLayout, layoutPng } from '../lib/map-layout.js';

const GOOD = ['##########', '#P.......#', '#........#', '######D###', '#........#', '#..L...E.#', '#..O.....#', '##########'];
const LOST = ['##########', '#P.......#', '#........#', '##########', '#........#', '#........#', '#........#', '##########'];
const pictureFor = (w, h) => layoutPng(compileLayout(GOOD), { width: w, height: h });

let images, calls, withKey, noKey;
before(async () => {
  calls = [];
  images = createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      calls.push({ url: req.url, type: req.headers['content-type'] || '', body });
      const size = /name="size"\r\n\r\n(\d+)x(\d+)/.exec(body) || /"size":"(\d+)x(\d+)"/.exec(body) || [0, 1536, 1024];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: pictureFor(Number(size[1]), Number(size[2])).toString('base64') }] }));
    });
  });
  await new Promise((r) => images.listen(0, '127.0.0.1', r));
  withKey = await startServer({ env: { OPENAI_API_KEY: 'sk-fake-for-tests', VTT_OPENAI_IMAGES_BASE: `http://127.0.0.1:${images.address().port}` } });
  noKey = await startServer();
});
after(async () => { await withKey.stop(); await noKey.stop(); await new Promise((r) => images.close(r)); });

test('only the services with a saved key can be picked, each with a price', async () => {
  const none = (await noKey.get('/api/map-maker/paint-options?kind=battle')).json;
  assert.equal(none.selected, null); assert.ok(none.providers.every((p) => !p.available));
  const some = (await withKey.get('/api/map-maker/paint-options?kind=battle')).json;
  assert.deepEqual(some.providers.filter((p) => p.available).map((p) => p.id), ['openai']);
  assert.equal(some.selected.provider, 'openai'); assert.ok(some.layoutLocked);
  const model = some.providers[0].models.find((m) => m.id === 'gpt-image-1');
  assert.deepEqual(model.qualities, ['low', 'medium', 'high']); assert.ok(model.costs.high > model.costs.low);
  assert.equal((await withKey.get('/api/map-maker/paint-options?kind=town')).json.layoutLocked, false);
});

test('painting is refused without a description, a key, a type, or a layout that still has problems', async () => {
  const ok = { kind: 'battle', description: 'a keep', grid: GOOD, provider: 'openai', model: 'gpt-image-1', quality: 'low' };
  assert.equal((await withKey.post('/api/map-maker/paint', { ...ok, kind: 'dungeon' })).status, 400);
  assert.equal((await withKey.post('/api/map-maker/paint', { ...ok, description: ' ' })).status, 400);
  const keyless = await noKey.post('/api/map-maker/paint', ok);
  assert.equal(keyless.status, 400); assert.match(keyless.json.error, /no key/i);
  const lost = await withKey.post('/api/map-maker/paint', { ...ok, grid: LOST });
  assert.equal(lost.status, 400); assert.ok(lost.json.problems.some((p) => /cannot be reached/.test(p.text)));
  assert.equal(calls.length, 0, 'nothing was sent to the picture service');
});

test('a battle map is painted from the layout drawing, kept as a draft, and saved with its walls in the right place', async () => {
  calls.length = 0;
  const r = await withKey.post('/api/map-maker/paint', { kind: 'battle', description: 'a small keep with two rooms and a door', setting: 'indoor', grid: GOOD, provider: 'openai', model: 'gpt-image-1', quality: 'low' });
  assert.equal(r.status, 200, r.text);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /images\/edits/); assert.match(calls[0].type, /multipart/);
  assert.match(calls[0].body, /KEEP THE LAYOUT EXACTLY/); assert.match(calls[0].body, /it is a 10 by 8 square map/); assert.match(calls[0].body, /hand-drawn fantasy role-playing module cartography/, 'the indoor style');
  assert.match(calls[0].body, /name="size"\r\n\r\n1536x1024/);
  assert.match(calls[0].body, /LIGHT SOURCE \(1 in all\)[^]*wall torch/, 'the one torch of the layout is described to the painter');
  assert.equal(r.json.width, 1536); assert.equal(r.json.height, 1024); assert.equal(typeof r.json.cost, 'number');
  if (r.json.drift) assert.ok(r.json.drift.medianPx <= 8, 'the picture is the layout itself, so the walls cannot have drifted: ' + JSON.stringify(r.json.drift));
  const pic = await fetch(withKey.base + r.json.url); assert.equal(pic.status, 200); assert.equal(pic.headers.get('content-type'), 'image/png');

  assert.equal((await withKey.post('/api/map-maker/save', { draftId: r.json.draftId, name: '  ', grid: GOOD })).status, 400, 'a map needs a name');
  const saved = await withKey.post('/api/map-maker/save', { draftId: r.json.draftId, name: 'Test Keep', grid: GOOD, setting: 'indoor' });
  assert.equal(saved.status, 200, saved.text); assert.match(saved.json.url, /^\/map-test\.html\?set=[0-9a-f-]{36}$/);
  assert.match(saved.json.file, /^vtt-test-keep-[a-z0-9]+\.png$/);
  assert.equal((await withKey.post('/api/map-maker/save', { draftId: r.json.draftId, name: 'Again', grid: GOOD })).status, 404, 'a draft is saved once');

  const cfg = (await withKey.get('/api/map-config?map=/uploads/' + saved.json.file)).json.config;
  assert.equal(cfg.squares, 10); assert.equal(cfg.light, 'dim'); assert.equal(cfg.publisher, 'Explorer');
  const kx = 1536 / 10;
  assert.ok(cfg.walls.some((w) => w.type === 'door' && Math.abs(w.y1 - 3.5 * (1024 / 8)) < 1 && Math.abs(w.x1 - 6 * kx) < 1), 'the door is on its square, in picture pixels');
  assert.ok(Math.max(...cfg.walls.map((w) => Math.max(w.x1, w.x2))) > 1380, 'the east wall is at square 9 of 10, in the 1536 pixel picture');
  assert.ok(cfg.starts.some((s) => s.name === 'start') && cfg.starts.some((s) => s.name === 'enemy-start'));
  assert.equal(cfg.lights.length, 1);
  assert.equal((await fetch(withKey.base + '/uploads/' + saved.json.file)).status, 200);
  const sets = (await withKey.get('/api/mapsets')).json.sets;
  const place = sets.find((x) => x.guid === saved.json.guid);
  assert.ok(place, 'the new place is listed'); assert.equal(place.kind, 'battle'); assert.equal(place.name, 'Test Keep');
});

test('a battle map is painted on the canvas that fits its own shape (tall, square or wide); town and regional maps come from the text alone', async () => {
  calls.length = 0;
  const TALL = ['########', '#P.....#', '#......#', '#......#', '#..L...#', '#......#', '#......#', '#.....E#', '#......#', '#......#', '#......#', '########'];
  const tall = await withKey.post('/api/map-maker/paint', { kind: 'battle', description: 'a keep', grid: TALL, provider: 'openai', model: 'gpt-image-1-mini', quality: 'low' });
  assert.equal(tall.status, 200, tall.text); assert.match(calls[0].body, /name="size"\r\n\r\n1024x1536/); assert.equal(tall.json.height, 1536);

  calls.length = 0;
  const town = await withKey.post('/api/map-maker/paint', { kind: 'town', description: 'a river port with a stone bridge and a market square', provider: 'openai', model: 'gpt-image-1', quality: 'low' });
  assert.equal(town.status, 200, town.text); assert.match(calls[0].url, /images\/generations/);
  assert.match(calls[0].body, /river port with a stone bridge/); assert.match(calls[0].body, /TOWN MAP/); assert.equal(town.json.drift, null);
  const savedTown = await withKey.post('/api/map-maker/save', { draftId: town.json.draftId, name: 'River Port' });
  assert.equal(savedTown.status, 200, savedTown.text);
  const tcfg = (await withKey.get('/api/map-config?map=/uploads/' + savedTown.json.file)).json.config;
  assert.equal(tcfg.kind, 'town'); assert.equal(tcfg.walls.length, 0);

  const region = await withKey.post('/api/map-maker/paint', { kind: 'regional', description: 'a coast of cliffs and islands', provider: 'openai', model: 'gpt-image-1', quality: 'low' });
  const savedRegion = await withKey.post('/api/map-maker/save', { draftId: region.json.draftId, name: 'Cliff Coast' });
  const rcfg = (await withKey.get('/api/map-config?map=/uploads/' + savedRegion.json.file)).json.config;
  assert.equal(rcfg.kind, 'regional'); assert.equal(rcfg.tiles, 'hex'); assert.ok(rcfg.hexSize >= 20);
});

test('the picture service refusing is reported, not hidden', async () => {
  const bad = await startServer({ env: { OPENAI_API_KEY: 'sk-fake', VTT_OPENAI_IMAGES_BASE: 'http://127.0.0.1:1' } });
  try {
    const r = await bad.post('/api/map-maker/paint', { kind: 'town', description: 'a town', provider: 'openai', model: 'gpt-image-1', quality: 'low' });
    assert.equal(r.status, 502); assert.ok(r.json.error);
  } finally { await bad.stop(); }
});

test('the drawing the painter gets shows each light as an orange dot, and the prompt only talks about lights when there are some', async () => {
  const { battlePrompt } = await import('../lib/map-painter.js');
  const lit = compileLayout(GOOD), dark = compileLayout(GOOD.map((r) => r.replace('L', '.')));
  assert.equal(lit.lights.length, 1); assert.equal(dark.lights.length, 0);
  assert.notDeepEqual(layoutPng(lit, { width: 600, height: 400 }), layoutPng(dark, { width: 600, height: 400 }), 'the torch is drawn');
  assert.doesNotMatch(await battlePrompt(process.cwd(), { setting: 'indoor', description: 'x', cols: 10, rows: 8, layout: dark }), /LIGHT SOURCE/);
  assert.match(await battlePrompt(process.cwd(), { setting: 'outdoor', description: 'x', cols: 10, rows: 8, layout: lit }), /campfire, lantern or torch/);
});

test('a square layout is painted on a square canvas, so its squares stay square', async () => {
  const SQUARE = ['##########', '#P.......#', '#........#', '#...L....#', '#........#', '#........#', '#.......E#', '#........#', '#........#', '##########'];
  calls.length = 0;
  const r = await withKey.post('/api/map-maker/paint', { kind: 'battle', description: 'a yard', grid: SQUARE, orientation: 'landscape', provider: 'openai', model: 'gpt-image-1', quality: 'low' });
  assert.equal(r.status, 200, r.text); assert.match(calls[0].body, /name="size"\r\n\r\n1024x1024/); assert.equal(r.json.width, 1024); assert.equal(r.json.height, 1024);
});

test('Gemini is asked for the nearest aspect ratio it offers, and the cheaper quality is the default', async () => {
  const { aspectFor } = await import('../lib/image-providers.js'), { paintOptions } = await import('../lib/map-painter.js');
  assert.equal(aspectFor(1536, 1024), '3:2'); assert.equal(aspectFor(1024, 1536), '2:3'); assert.equal(aspectFor(1024, 1024), '1:1'); assert.equal(aspectFor(1450, 1000), '3:2'); assert.equal(aspectFor(1000, 1450), '2:3'); assert.equal(aspectFor(1200, 900), '4:3');
  const o = paintOptions({ gemini: 'k', openai: 'k' }, { provider: 'gemini', model: 'gemini-nano-banana-2.1' });
  assert.equal(o.selected.quality, '1K', 'Gemini starts at the cheaper 1K, not 2K');
  assert.equal(paintOptions({ openai: 'k' }, null).selected.quality, 'medium');
});
