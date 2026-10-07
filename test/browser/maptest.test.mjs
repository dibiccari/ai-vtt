// Map Test in headless Chrome: the Terrain brush (drag to paint, adjustable size) and the Eraser, checked through what the page saves to the map config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const MAP = 'lmop-goblin-ambush.png';
let server, page;

before(async () => {
  if (skip) return;
  server = await startServer();
  page = await launchChrome();
  await page.goto(`${server.base}/map-test.html?map=/uploads/${MAP}`);
  await page.waitFor('document.querySelector("#brush") && document.querySelector("canvas") && document.querySelector("#banner").textContent.includes("px")');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });

const opts = { skip: skip || false };
// A drag with the mouse on the canvas (synthetic pointer events), from (x0,y0) to (x1,y1) in canvas pixels.
const dragExpr = (tool, size, x0, y0, x1, y1, button = 0) => `(async () => {
  document.querySelector('button.tool[data-tool="${tool}"]').click();
  const slider = document.querySelector('#brush'); slider.value = '${size}'; slider.dispatchEvent(new Event('input', { bubbles: true }));
  const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + x, clientY: b.top + y, button: ${button}, buttons: type === 'pointerup' ? 0 : ${button === 2 ? 2 : 1}, pointerId: 7, bubbles: true }));
  ev('pointerdown', ${x0}, ${y0});
  for (let i = 1; i <= 10; i++) ev('pointermove', ${x0} + (${x1} - ${x0}) * i / 10, ${y0} + (${y1} - ${y0}) * i / 10);
  ev('pointerup', ${x1}, ${y1});
  await new Promise((r) => setTimeout(r, 1800));
  const cfg = (await (await fetch('/api/map-config?map=${MAP}')).json()).config || {};
  return { rects: (cfg.difficult || []).length, area: (cfg.difficult || []).reduce((n, d) => n + d.w * d.h, 0), squares: cfg.squares, list: cfg.difficult || [] };
})()`;

test('the terrain brush paints a stroke of squares, a bigger brush paints more, the squares are saved as whole-square rectangles', opts, async () => {
  const small = await page.eval(dragExpr('terrain', 1, 300, 300, 500, 300));
  assert.ok(small.rects >= 1, 'a drag paints difficult terrain: ' + JSON.stringify(small));
  const width = await page.eval(`new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.src = '/uploads/${MAP}'; })`);
  const cell = width / small.squares;
  for (const d of small.list) for (const v of [d.x, d.y, d.w, d.h]) assert.ok(Math.abs(v / cell - Math.round(v / cell)) < 1e-6, 'a rectangle sits on the grid: ' + JSON.stringify(d));
  assert.ok(small.area > 0);
  const before1 = small.area;
  const big = await page.eval(dragExpr('terrain', 6, 300, 450, 500, 450));
  assert.ok(big.area > before1 * 3, 'a bigger brush covers more: ' + before1 + ' then ' + big.area);
});

test('the eraser takes squares away along its stroke, a right-click drag erases too, and everything can be erased', opts, async () => {
  const full = await page.eval(`(async () => (await (await fetch('/api/map-config?map=${MAP}')).json()).config.difficult.reduce((n, d) => n + d.w * d.h, 0))()`);
  const less = await page.eval(dragExpr('eraser', 3, 300, 450, 500, 450));
  assert.ok(less.area < full, 'the eraser removes some: ' + full + ' then ' + less.area);
  const right = await page.eval(dragExpr('terrain', 3, 300, 300, 500, 300, 2));
  assert.ok(right.area < less.area, 'a right-button drag erases with the brush');
  let left = right;
  for (const y of [300, 450]) left = await page.eval(dragExpr('eraser', 12, 250, y, 550, y));
  assert.equal(left.area, 0, 'the eraser can clear it all: ' + JSON.stringify(left.list));
});

test('Save to Market: a purchased picture is refused, a map of your own is saved with its mood and shows in the Market, where it can be added to a campaign', opts, async () => {
  const click = (id) => `document.querySelector('#${id}').click()`;
  const fill = (id, v) => `{ const e = document.querySelector('#${id}'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }`;
  await page.eval(`(async () => { ${click('saveMarketBtn')}; ${fill('mkName', 'Goblin trail')}; document.querySelector('#mkRights').click(); ${click('mkSave')}; await new Promise((r) => setTimeout(r, 800)); })()`);
  const refused = await page.eval(`document.querySelector('#mkStatus').textContent`);
  assert.match(refused, /purchase|Wizards/, 'a purchased picture cannot be saved: ' + refused);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#moodSel") && document.querySelector("#moodSel").options.length > 3 && document.querySelector("#banner").textContent.includes("px")');
  const out = await page.eval(`(async () => {
    ${fill('moodSel', 'night')}
    await new Promise((r) => setTimeout(r, 1800));
    const level = document.querySelector('#lightLevel').value, sound = document.querySelector('#ambienceKind').value;
    ${click('saveMarketBtn')}; ${fill('mkName', 'Terrain Grounds')}; ${fill('mkType', 'battle')}; ${fill('mkDesc', 'A meadow with a creek and a mesa.')}; ${fill('mkTags', 'outdoor, creek')};
    document.querySelector('#mkRights').click(); ${click('mkSave')}; await new Promise((r) => setTimeout(r, 1200));
    return { level, sound, status: document.querySelector('#mkStatus').textContent };
  })()`);
  assert.equal(out.level, 'dark', 'the night mood sets the light level'); assert.equal(out.sound, 'night', 'and the ambient sound');
  assert.match(out.status, /Saved to the Market as "Terrain Grounds"/);
  const pack = (await server.get('/api/market')).json.maps.find((m) => m.id === 'terrain-grounds');
  assert.ok(pack && pack.mood === 'night' && pack.type === 'battle' && pack.tags.includes('creek'));
  // the Market page
  await page.goto(`${server.base}/market.html`);
  await page.waitFor('document.querySelectorAll(".card").length >= 1');
  const card = await page.eval(`(() => { const c = document.querySelector('.card'); return { text: c.innerText, img: c.querySelector('img').getAttribute('src') }; })()`);
  assert.match(card.text, /Terrain Grounds/); assert.match(card.text, /battle/i); assert.match(card.text, /Night/); assert.match(card.img, /market\/terrain-grounds\/picture/);
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Add to campaign').click()`);
  await page.waitFor(`document.querySelector('#status').textContent.includes('was added')`, 8000);
  const cid = await page.eval(`document.querySelector('#campaign').value`);
  assert.ok(cid, 'a campaign is offered');
  const maps = (await server.get('/api/campaigns/' + cid + '/maps')).json.maps;
  assert.ok(maps.some((m) => m.name === 'Terrain Grounds'), 'the map is in the chosen campaign\'s list');
});

test('DM | Player: the player view hides pins and secrets, the DM view shows them, and Make the DM version saves a picture the server serves back', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#viewSwitch") && document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    out.start = [S.viewAs, S.dm];
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200);
    out.player = [S.viewAs, S.dm, document.querySelector('#dm').checked, document.querySelector('#viewNote').textContent];
    const vis = (t) => { const e = document.querySelector('button.tool[data-tool="' + t + '"]'); return Boolean(e) && !e.hidden && e.offsetParent !== null; };
    out.toolsPlayer = ['start', 'terrain', 'eraser', 'token', 'toggle', 'pan'].map(vis);
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(200);
    out.dm = [S.viewAs, S.dm];
    out.toolsDm = ['start', 'terrain', 'eraser', 'token', 'toggle', 'pan'].map(vis);
    out.firstInBar = document.querySelector('#stageBar').firstElementChild.id;
    const before = (await fetch('/api/dm-map?map=vtt-terrain-test.png')).status;
    document.querySelector('#makeDmBtn').click(); await wait(2500);
    const after = await fetch('/api/dm-map?map=vtt-terrain-test.png');
    out.dmMap = [before, after.status, after.headers.get('content-type'), (await after.blob()).size > 5000];
    out.status = document.querySelector('#dmStatus').textContent; out.noteDm = document.querySelector('#viewNote').textContent;
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(300);
    out.notePlayer = document.querySelector('#viewNote').textContent;
    window.confirm = () => true; document.querySelector('#dropDmBtn').click(); await wait(800);
    out.dropped = (await fetch('/api/dm-map?map=vtt-terrain-test.png')).status;
    return out;
  })()`);
  assert.deepEqual(r.start, ['dm', true]); assert.deepEqual(r.player, ['player', false, false, 'What the table sees']); assert.deepEqual(r.dm, ['dm', true]);
  assert.deepEqual(r.toolsPlayer, [false, false, false, true, true, false], 'in the player view the Pins, Terrain and Eraser buttons are gone, Token and Open/Close stay, and there is no Pan');
  assert.deepEqual(r.toolsDm, [true, true, true, true, true, false], 'the DM view has them all, and still no Pan'); assert.equal(r.firstInBar, 'viewSwitch', 'the DM | Player switch is first in the line');
  assert.equal(r.dmMap[0], 404, 'no DM version before'); assert.equal(r.dmMap[1], 200); assert.match(r.dmMap[2], /image\/jpeg/); assert.equal(r.dmMap[3], true);
  assert.match(r.status, /Saved the DM version/); assert.match(r.noteDm, /DM version of the picture/); assert.equal(r.notePlayer, 'What the table sees');
  assert.equal(r.dropped, 404, 'it can be removed again');
});

test('tiles: a regional map shows hexagons, a battle map squares, and one Show tiles box hides or shows either', opts, async () => {
  const shot = async (url) => {
    await page.goto(`${server.base}/map-test.html?map=${url}`);
    await page.waitFor('document.querySelector("#tileKind") && document.querySelector("#banner").textContent.includes("px")');
    return page.eval(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const S = window.mapTest.state, box = document.querySelector('#showGrid');
      const out = { tiles: S.tiles, select: document.querySelector('#tileKind').value, hexRow: !document.querySelector('#hexRow').hidden, showing: box.checked };
      const count = () => { const cv = document.querySelector('canvas'), x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2]; return n; };       // the picture's total brightness: lines drawn over it change it
      box.checked = true; box.dispatchEvent(new Event('change')); await wait(300); out.on = count();
      box.checked = false; box.dispatchEvent(new Event('change')); await wait(300); out.off = count();
      return out; })()`);
  };
  const hex = await shot('/uploads/dnd-sword-coast-ours.png');
  assert.equal(hex.tiles, 'hex'); assert.equal(hex.select, 'hex'); assert.equal(hex.hexRow, true, 'the hexagon size slider shows for hexagons');
  assert.notEqual(hex.on, hex.off, 'ticking Show tiles draws the hexagons');
  const sq = await shot('/uploads/vtt-terrain-test.png');
  assert.equal(sq.tiles, 'square'); assert.equal(sq.hexRow, false); assert.notEqual(sq.on, sq.off, 'and the squares for a battle map');
});

test('the map list shows places, Day | Night appears only when there is a night look, Terrain | Eraser are one pair', opts, async () => {
  const look = async (url) => {
    await page.goto(`${server.base}/map-test.html?map=${url}`);
    await page.waitFor('document.querySelector("#timeSwitch") && document.querySelector("#banner").textContent.includes("px")');
    await page.eval('new Promise((r) => setTimeout(r, 800))');
    return page.eval(`(() => ({ options: [...document.querySelectorAll('#mapSelect option')].map((o) => o.textContent), day: [...document.querySelectorAll('#timeSwitch button')].map((b) => [b.textContent, !b.hidden, b.getAttribute('aria-pressed')]),
      pair: [...document.querySelectorAll('#terrainPair button')].map((b) => b.textContent) }))()`);
  };
  const camp = await look('/uploads/vtt-camp-day.png');
  assert.ok(camp.options.some((o) => o === 'Camp'), 'the list has the place "Camp": ' + camp.options.join(', '));
  assert.ok(!camp.options.some((o) => /\.(png|jpe?g)$/.test(o) && !/^❗/.test(o)), 'and no entry is a bare file name');
  assert.equal(camp.options.filter((o) => /camp/i.test(o)).length, 1, 'day and night are one entry');
  assert.deepEqual(camp.day, [['Day', true, 'true'], ['Night', true, 'false']]); assert.deepEqual(camp.pair, ['Terrain', 'Eraser']);
  await page.eval(`document.querySelector('#timeSwitch button[data-time="night"]').click()`);
  await page.waitFor('document.querySelector("#timeSwitch button[data-time=night]").getAttribute("aria-pressed") === "true"', 8000);
  const crypt = await look('/uploads/vtt-crypt-repaint-v2.png');
  assert.deepEqual(crypt.day, [['Day', true, 'true'], ['Night', false, 'false']], 'a map with no night look has no Night button');
});

test('no page errors in Map Test', opts, () => { assert.deepEqual(page.problems, []); });
