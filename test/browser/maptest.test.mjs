// Map Test in headless Chrome: the Terrain brush (drag to paint, adjustable size) and the Eraser, checked through what the page saves to the map config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';
import { installTerrainLights } from '../helpers/terrain-lights.mjs';

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


test('DM | Player: the player view hides pins and secrets and the DM view shows them', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#viewSwitch") && document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    out.start = [S.viewAs, S.dm];
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200);
    out.player = [S.viewAs, S.dm, document.querySelector('#dm').checked, document.querySelector('#viewSwitch').title];
    const vis = (t) => { const e = document.querySelector('button.tool[data-tool="' + t + '"]'); return Boolean(e) && !e.hidden && e.offsetParent !== null; };
    out.toolsPlayer = ['start', 'terrain', 'eraser', 'token', 'toggle', 'pan'].map(vis);
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(200);
    out.dm = [S.viewAs, S.dm];
    out.toolsDm = ['start', 'terrain', 'eraser', 'token', 'toggle', 'pan'].map(vis);
    const firstInBar = document.querySelector('#stageBar').firstElementChild; // the switches sit in a .view-stack wrapper now
    out.firstInBar = firstInBar.id || firstInBar.firstElementChild.id;
    out.noteDm = document.querySelector('#viewSwitch').title;
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(300);
    out.notePlayer = document.querySelector('#viewSwitch').title;
    return out;
  })()`);
  assert.deepEqual(r.start, ['dm', true]); assert.deepEqual(r.player, ['player', false, false, 'What the table sees']); assert.deepEqual(r.dm, ['dm', true]);
  assert.deepEqual(r.toolsPlayer, [false, false, false, true, false, false], 'in the player view the Pins, Terrain and Eraser buttons are gone, Token stays, and there is no Open/Close or Pan button');
  assert.deepEqual(r.toolsDm, [true, true, true, true, false, false], 'the DM view has Pins, Terrain, Eraser and Token; doors are clicked directly, so there is no Open/Close or Pan button'); assert.equal(r.firstInBar, 'viewSwitch', 'the DM | Player switch is first in the line');
  assert.match(r.noteDm, /Player picture with live DM marks|DM version of the picture/); assert.equal(r.notePlayer, 'What the table sees');
});

test('tiles: a regional map shows hexagons, a battle map squares, and one Show tiles box hides or shows either', opts, async () => {
  const shot = async (url) => {
    await page.goto(`${server.base}/map-test.html?map=${url}`);
    await page.waitFor('document.querySelector("#mapKind") && document.querySelector("#banner").textContent.includes("px")');
    return page.eval(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const S = window.mapTest.state, box = document.querySelector('#showGrid');
      await wait(900);       // the picture and the first draw are done before the pixels are counted
      const out = { tiles: S.tiles, select: document.querySelector('#mapKind').value, hexRowBefore: document.querySelector('#hexRow').offsetParent !== null, order: [...document.querySelectorAll('#showTilesRow, #hexRow, #vision')].map((e) => e.id || 'vision'), showRow: document.querySelector('#showTilesRow').offsetParent !== null, squaresRow: document.querySelector('#squaresVal').closest('label').offsetParent !== null, label: document.querySelector('#showTilesText').textContent, scale: document.querySelector('#scaleNote').textContent, size: document.querySelector('#sizeNote').textContent, kindAfterSelect: !!document.querySelector('#mapSelect').nextElementSibling.querySelector('#mapKind'), showing: box.checked };
      const count = () => { const cv = document.querySelector('canvas'), x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) n += d[i] + d[i + 1] + d[i + 2]; return n; };       // the picture's total brightness: lines drawn over it change it
      box.checked = true; box.dispatchEvent(new Event('change')); await wait(300); out.on = count(); out.hexRow = document.querySelector('#hexRow').offsetParent !== null;
      box.checked = false; box.dispatchEvent(new Event('change')); await wait(300); out.off = count();
      return out; })()`);
  };
  const hex = await shot('/uploads/dnd-sword-coast-ours.png');
  assert.equal(hex.tiles, 'hex'); assert.equal(hex.select, 'regional', 'the label says it is a regional map'); assert.equal(hex.squaresRow, false, 'no squares control on a hexagon map'); assert.match(hex.label, /hexagons/); assert.match(hex.scale, /One hexagon = 5 miles/); assert.match(hex.size, /Size: \d+ x \d+ px \(height x width\)\s+\d+ x \d+ miles/); assert.equal(hex.kindAfterSelect, true, 'the type of map sits right below the Map picker'); assert.equal(hex.hexRowBefore, false, 'the hexagon width is hidden while the tiles are hidden'); assert.equal(hex.hexRow, true, 'and shows once Show hexagons is ticked'); assert.deepEqual(hex.order, ['showTilesRow', 'hexRow', 'vision'], 'Show tiles sits under Squares across the map, the width right under it');
  assert.notEqual(hex.on, hex.off, 'ticking Show tiles draws the hexagons: ' + JSON.stringify(hex));
  const sq = await shot('/uploads/vtt-terrain-test.png');
  assert.equal(sq.tiles, 'square'); assert.equal(sq.select, 'battle'); assert.equal(sq.hexRow, false, 'no hexagon slider on a battle map'); assert.equal(sq.squaresRow, true); assert.match(sq.label, /squares/); assert.match(sq.scale, /One square = 5 ft\. This map is \d+ x \d+ squares/); assert.match(sq.size, /Size: 1500 x 2000 px \(height x width\)\s+150 x 200 ft/); assert.notEqual(sq.on, sq.off, 'and the squares for a battle map');
});

test('the map list shows places, the time of day is Day | Dawn | Dusk | Night for every map, Terrain | Eraser are one pair', opts, async () => {
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
  assert.deepEqual(camp.day, [['Day', true, 'true'], ['Dawn', true, 'false'], ['Dusk', true, 'false'], ['Night', true, 'false']]); assert.deepEqual(camp.pair, ['Terrain', 'Eraser']);
  await page.eval(`document.querySelector('#timeSwitch button[data-time="night"]').click()`);
  await page.waitFor('document.querySelector("#timeSwitch button[data-time=night]").getAttribute("aria-pressed") === "true"', 8000);
  const crypt = await look('/uploads/vtt-crypt-method-b.png');
  assert.deepEqual(crypt.day, [['Day', true, 'true'], ['Dawn', true, 'false'], ['Dusk', true, 'false'], ['Night', true, 'false']], 'a map with no night look still has the four times: Night puts the wash on the Day picture');
});

test('Fit to width sits under Fit to height and makes the map as wide as the view', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#fitWidthBtn") && document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, stage = document.querySelector('#stage').getBoundingClientRect();
    const fit = document.querySelector('#fitBtn').getBoundingClientRect(), wid = document.querySelector('#fitWidthBtn').getBoundingClientRect();
    document.querySelector('#fitBtn').click(); await new Promise((r) => setTimeout(r, 100)); const h = S.view.scale;
    document.querySelector('#fitWidthBtn').click(); await new Promise((r) => setTimeout(r, 100));
    return { below: wid.top > fit.top, sameColumn: Math.abs(wid.left - fit.left) < 2, wide: S.W * S.view.scale / stage.width, heightScale: h, widthScale: S.view.scale, top: S.view.oy };
  })()`);
  assert.ok(r.below && r.sameColumn, 'the button is under the fit-to-height button');
  assert.ok(r.wide > 0.95 && r.wide <= 1.0, 'the map is as wide as the view: ' + r.wide); assert.ok(r.widthScale >= r.heightScale, 'it is at least as large as the whole-map fit'); assert.equal(r.top, 12);
});

test('clicking a door opens or closes it with any tool; locked doors stay shut, secret doors are walls, a pin under the pointer wins', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#viewSwitch") && document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, cv = document.querySelector('canvas'), b = cv.getBoundingClientRect(), out = {};
    S.walls = [{ x1: 400, y1: 400, x2: 450, y2: 400, type: 'door', open: false }, { x1: 600, y1: 400, x2: 650, y2: 400, type: 'door', open: false, locked: true, dc: 12 }, { x1: 800, y1: 400, x2: 850, y2: 400, type: 'door', open: false, secret: true }];
    S.starts = S.starts.filter((p) => p.name === 'start'); S.view = { scale: 1, ox: 0, oy: 0 };
    const click = (x, y) => { const ev = (t) => cv.dispatchEvent(new PointerEvent(t, { clientX: b.left + x, clientY: b.top + y, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 5, bubbles: true })); ev('pointerdown'); ev('pointerup'); };
    for (const tool of ['token', 'start']) {
      document.querySelector('button.tool[data-tool="' + tool + '"]').click();
      const before = S.starts.length;
      click(425, 400); await wait(150); out[tool + 'Open'] = S.walls[0].open;
      click(425, 400); await wait(150); out[tool + 'Shut'] = S.walls[0].open;
      out[tool + 'NoPin'] = S.starts.length === before;
    }
    click(625, 400); await wait(150); out.locked = S.walls[1].open;
    click(825, 400); await wait(150); out.secret = S.walls[2].open;
    document.querySelector('button.tool[data-tool="terrain"]').click();
    const area = S.difficult.length; click(425, 400); await wait(150); out.brushLeavesDoor = S.walls[0].open === false;
    // a pin on the door wins in the Pins tool: the click selects the pin
    document.querySelector('button.tool[data-tool="start"]').click(); S.starts.push({ name: 'on-door', x: 425, y: 400 }); click(425, 400); await wait(150);
    out.pinWins = [S.walls[0].open, S.selected && S.selected.name];
    return out;
  })()`);
  assert.equal(r.tokenOpen, true, 'a click on a door opens it with the Token tool'); assert.equal(r.tokenShut, false, 'and a second click shuts it');
  assert.equal(r.startOpen, true, 'and with the Pins tool'); assert.equal(r.startShut, false); assert.ok(r.tokenNoPin && r.startNoPin, 'a click on a door adds no pin');
  assert.equal(r.locked, false, 'a locked door stays shut'); assert.equal(r.secret, false, 'a secret door is a wall'); assert.equal(r.brushLeavesDoor, true, 'the terrain brush does not work doors');
  assert.deepEqual(r.pinWins, [false, 'on-door'], 'a pin on the door is selected instead of the door being clicked');
});

test('the Publisher filter narrows the map list, and switching Day to Night keeps the place selected', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#publisher") && document.querySelector("#banner").textContent.includes("px")');
  await page.eval('new Promise((r) => setTimeout(r, 800))');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms)), sel = document.querySelector('#mapSelect'), out = {};
    const label = () => sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].textContent;
    out.before = [label(), sel.options.length];
    document.querySelector('#timeSwitch button[data-time="night"]').click(); await wait(1500);
    out.night = [label(), window.mapTest.state.url.split('/').pop()];
    document.querySelector('#timeSwitch button[data-time="day"]').click(); await wait(1500);
    out.day = [label(), window.mapTest.state.url.split('/').pop()];
    const pub = document.querySelector('#publisher'); pub.value = 'Map Adventurer'; pub.dispatchEvent(new Event('change')); await wait(1500);
    out.map = [sel.options.length, [...sel.options].every((o) => /lmop-/.test(o.value))];
    pub.value = ''; pub.dispatchEvent(new Event('change')); await wait(1200);
    out.all = sel.options.length;
    return out;
  })()`);
  assert.equal(r.night[0], r.before[0], 'the entry stays selected on Night'); assert.equal(r.night[1], 'vtt-camp-night.png');
  assert.equal(r.day[0], r.before[0], 'and back on Day'); assert.equal(r.day[1], 'vtt-camp-day.png');
  assert.ok(r.map[0] > 1 && r.map[0] < r.before[1] && r.map[1], 'the Map Adventurer filter keeps only that publisher\'s maps: ' + JSON.stringify(r.map)); assert.equal(r.all, r.before[1], 'All publishers brings the list back');
});

test('no page errors in Map Test', opts, () => { assert.deepEqual(page.problems, []); });

// The Walls tool: draw, select and move an end, Find problems, undo, delete; and a stale page cannot overwrite a newer copy.
const wallDrag = (x0, y0, x1, y1, opts = '{}') => `(async () => {
  document.querySelector('button.tool[data-tool="walls"]').click();
  const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect(), o = ${opts};
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + x, clientY: b.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, bubbles: true, shiftKey: !!o.shift, altKey: !!o.alt }));
  ev('pointerdown', ${x0}, ${y0});
  for (let i = 1; i <= 8; i++) ev('pointermove', ${x0} + (${x1} - ${x0}) * i / 8, ${y0} + (${y1} - ${y0}) * i / 8);
  ev('pointerup', ${x1}, ${y1});
  await new Promise((r) => setTimeout(r, 100));
  const S = window.mapTest.state;
  return { n: S.walls.length, sel: S.wallSel ? [S.wallSel.x1, S.wallSel.y1, S.wallSel.x2, S.wallSel.y2] : null, undo: S.wallUndo.length };
})()`;

test('the Walls tool draws a wall, finds crossings, moves an end and undoes', opts, async () => {
  await page.eval(`(() => { const S = window.mapTest.state; S.walls = []; S.wallUndo = []; document.querySelector('button.tool[data-tool="walls"]').click(); })()`);
  const base = await page.eval(`window.mapTest.state.walls.length`);
  assert.equal(base, 0);
  const a = await page.eval(wallDrag(300, 300, 500, 300, '{ alt: true }'));
  assert.equal(a.n, 1, 'a drag on empty ground draws a wall'); assert.ok(a.sel, 'the new wall is selected');
  const b = await page.eval(wallDrag(400, 200, 400, 400, '{ alt: true }'));
  assert.equal(b.n, 2);
  const probs = await page.eval(`(() => { document.querySelector('#wallProblems').click(); const S = window.mapTest.state; return { n: S.problems.length, kinds: S.problems.map((p) => p.kind), info: document.querySelector('#wallInfo').textContent }; })()`);
  assert.deepEqual(probs.kinds, ['cross'], 'two walls that cross are found: ' + JSON.stringify(probs));
  const end = await page.eval(`(() => { const S = window.mapTest.state, w = S.walls[0], r = document.querySelector('canvas').getBoundingClientRect(); return { sx: S.view.ox + w.x2 * S.view.scale, sy: S.view.oy + w.y2 * S.view.scale, x2: w.x2, y2: w.y2 }; })()`);
  const moved = await page.eval(wallDrag(end.sx, end.sy, end.sx + 60, end.sy + 40));
  const after = await page.eval(`(() => { const w = window.mapTest.state.walls[0]; return [w.x2, w.y2]; })()`);
  assert.ok(after[0] > end.x2 && after[1] > end.y2, 'dragging a wall end moves it: ' + JSON.stringify({ end, after, moved }));
  const undone = await page.eval(`(() => { for (let i = 0; i < 3; i++) document.querySelector('#wallUndo').click(); return window.mapTest.state.walls.length; })()`);
  assert.equal(undone, 0, 'undo takes the drawn walls back out');
});

test('a page that loaded an older version of the map cannot save over a newer one', opts, async () => {
  const res = await page.eval(`(async () => {
    const get = await (await fetch('/api/map-config?map=${MAP}')).json();
    const put = (v) => fetch('/api/map-config?map=${MAP}', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...get.config, baseVersion: v }) }).then((r) => r.status);
    const fresh = await put(get.setVersion), stale = await put(get.setVersion);
    return { fresh, stale, version: get.setVersion };
  })()`);
  assert.equal(res.fresh, 200); assert.equal(res.stale, 409, 'the second save from the same old version is refused');
});

test('the Walls tool also draws by clicking one point and then another, and carries on from the last point', opts, async () => {
  const click = (x, y) => `(() => { const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect(); for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { clientX: b.left + ${x}, clientY: b.top + ${y}, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 9, bubbles: true })); return window.mapTest.state.walls.length; })()`;
  await page.eval(`(() => { const S = window.mapTest.state; S.walls = []; S.wallUndo = []; S.wallPen = null; document.querySelector('button.tool[data-tool="walls"]').click(); })()`);
  assert.equal(await page.eval(click(300, 300)), 0, 'the first click only marks the start');
  assert.equal(await page.eval(click(500, 300)), 1, 'the second click makes the wall');
  assert.equal(await page.eval(click(500, 450)), 2, 'the next click carries on from the last point');
  const joined = await page.eval(`(() => { const [a, b] = window.mapTest.state.walls; return a.x2 === b.x1 && a.y2 === b.y1; })()`);
  assert.ok(joined, 'the second wall starts exactly where the first ended');
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  assert.equal(await page.eval(`window.mapTest.state.wallPen`), null, 'Escape stops the run');
});

test('what the token explored stays explored when switching Day to Night', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#timeSwitch") && document.querySelector("#banner").textContent.includes("px") && document.querySelector("#timeSwitch button[data-time=night]") && !document.querySelector("#timeSwitch button[data-time=night]").hidden');          // the Night button appears once the page knows the place has a night look
  const out = await page.eval(`(async () => {
    const S = window.mapTest.state;
    S.tokens = [{ x: 300, y: 700 }]; window.mapTest.revealFog();
    S.tokens = [{ x: 900, y: 700 }]; window.mapTest.revealFog();
    S.tokens = [{ x: 1800, y: 100 }]; window.mapTest.revealFog();
    const before = window.mapTest.fogStateAt(300, 700);
    document.querySelector('#timeSwitch button[data-time="night"]').click();
    await new Promise((r) => setTimeout(r, 1500));
    return { before, after: window.mapTest.fogStateAt(300, 700), url: S.url };
  })()`);
  assert.equal(out.before, 'explored', JSON.stringify(out));
  assert.ok(out.url.includes('night'), 'the night look is showing: ' + JSON.stringify(out));
  assert.equal(out.after, 'explored', 'the explored ground is still explored at night: ' + JSON.stringify(out));
});

test('Reset explored covers the map in fog again', opts, async () => {
  const out = await page.eval(`(async () => {
    const S = window.mapTest.state;
    S.tokens = [{ x: 300, y: 700 }]; window.mapTest.revealFog();
    S.tokens = [{ x: 1800, y: 100 }]; window.mapTest.revealFog();
    const before = window.mapTest.fogStateAt(300, 700);
    document.querySelector('#resetFogBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    return { before, after: window.mapTest.fogStateAt(300, 700) };
  })()`);
  assert.equal(out.before, 'explored', JSON.stringify(out));
  assert.equal(out.after, 'unseen', 'the explored ground is forgotten: ' + JSON.stringify(out));
});

test('town and regional maps have no fog of war and no test token; battle maps keep both', opts, async () => {
  const out = await page.eval(`(async () => {
    const sel = document.querySelector('#mapKind'), res = {};
    for (const k of ['town', 'regional', 'battle']) {
      sel.value = k; sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      res[k] = { fog: document.querySelector('#fog').closest('label').hidden, token: document.querySelector('button.tool[data-tool="token"]').hidden, reset: document.querySelector('#resetFogBtn').hidden, light: document.querySelector('#lightBox').hidden, outline: document.querySelector('#showPoly').closest('label').hidden };
    }
    return res;
  })()`);
  for (const k of ['town', 'regional']) assert.deepEqual(out[k], { fog: true, token: true, reset: true, light: true, outline: true }, k + ' hides them (and the sight outline): ' + JSON.stringify(out));
  assert.deepEqual(out.battle, { fog: false, token: false, reset: false, light: false, outline: false }, 'a battle map shows them: ' + JSON.stringify(out));
});

test('a wall that lies off the map can still be picked, found by Find problems and deleted', opts, async () => {
  const out = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    S.walls = [{ x1: -150, y1: 300, x2: -150, y2: 500, type: 'wall', open: false }, { x1: 100, y1: 100, x2: 400, y2: 100, type: 'wall', open: false }];
    S.wallUndo = []; S.problems = []; S.problemIx = -1;
    document.querySelector('button.tool[data-tool="walls"]').click();
    document.querySelector('#wallProblems').click();
    const info = document.querySelector('#wallInfo').textContent;
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const x = S.view.ox + -150 * S.view.scale, y = S.view.oy + 400 * S.view.scale;
    const ev = (type, button) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + x, clientY: b.top + y, button, buttons: type === 'pointerup' ? 0 : (button === 2 ? 2 : 1), pointerId: 5, bubbles: true }));
    ev('pointerdown', 0); ev('pointerup', 0); await wait(100);
    const picked = S.wallSel && S.wallSel.x1 === -150;
    document.querySelector('#wallDelete').click(); await wait(100);
    return { info, picked, left: S.walls.length };
  })()`);
  assert.ok(/off the map/.test(out.info), 'Find problems names it: ' + JSON.stringify(out));
  assert.equal(out.picked, true, 'it can be selected: ' + JSON.stringify(out)); assert.equal(out.left, 1, 'and deleted');
});

test('the Campaign filter under Publisher lists campaigns and narrows the map list to the places a campaign uses', opts, async () => {
  await page.goto(`${server.base}/map-test.html`);
  await page.waitFor('document.querySelector("#campaignFilter") && document.querySelectorAll("#campaignFilter option").length > 3 && document.querySelector("#mapSelect").options.length > 3');
  const out = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sel = document.querySelector('#campaignFilter'), list = document.querySelector('#mapSelect');
    const all = list.options.length;
    const opts = [...sel.options].map((o) => o.value);
    sel.value = 'tavern-brawl-test'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1500);
    const tavern = [...list.options].map((o) => o.textContent);
    sel.value = '__none'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1500);
    const none = list.options.length;
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1500);
    return { all, opts, tavern, none, back: list.options.length, after: [...document.querySelectorAll('.field > span')].map((s) => s.textContent).filter((t) => /Publisher|Campaign/.test(t)) };
  })()`);
  assert.ok(out.opts.includes('tavern-brawl-test') && out.opts.includes('lost-mine-of-phandelver') && out.opts.includes('__none'), JSON.stringify(out.opts));
  assert.ok(out.tavern.length > 0 && out.tavern.length < out.all, 'the tavern campaign narrows the list: ' + JSON.stringify(out));
  assert.ok(out.none < out.all, 'maps no campaign uses are a smaller list');
  assert.equal(out.back, out.all, 'All campaigns brings the whole list back');
  assert.deepEqual(out.after, ['Publisher', 'Campaign'], 'Campaign sits under Publisher');
});

test('Terrain Test Grounds: a running stream is animated and the brazier starts unlit and can be lit from the list and by a click', opts, async () => {
  await installTerrainLights(server);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.allLights.length');
  const out = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const names = S.allLights.map((l) => l.id), offAtStart = [...S.lightsOff];
    const cv = document.querySelector('canvas'), ctx = cv.getContext('2d');
    S.fog = false; S.tokens = [];
    const b = S.allLights.find((l) => l.id === 'brazier'), e = S.effects[0];
    const sample = () => { const r = cv.getBoundingClientRect(); const px = (S.view.ox + e.path[20].x * S.view.scale) * (cv.width / r.width), py = (S.view.oy + e.path[20].y * S.view.scale) * (cv.height / r.height); return Array.from(ctx.getImageData(Math.round(px) - 60, Math.round(py) - 20, 120, 40).data); };
    await wait(250); const a1 = sample(); await wait(900); const a2 = sample();
    let diff = 0; for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) diff++;
    const cbox = document.querySelector('#mapLightsList input[data-light="brazier"]');
    const startedUnlit = cbox.checked === false;
    cbox.click(); await wait(200);
    const afterList = !S.lightsOff.has('brazier');
    // a click on the brazier itself puts it out again
    const r = cv.getBoundingClientRect(), sx = r.left + S.view.ox + b.x * S.view.scale, sy = r.top + S.view.oy + b.y * S.view.scale;
    for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { clientX: sx, clientY: sy, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 3, bubbles: true }));
    await wait(300);
    return { names, offAtStart, effects: S.effects.length, diff, startedUnlit, afterList, afterClick: S.lightsOff.has('brazier') };
  })()`);
  assert.ok(out.names.includes('brazier') && out.names.includes('campfire'), JSON.stringify(out));
  assert.deepEqual(out.offAtStart, ['brazier'], 'only the brazier starts put out');
  assert.equal(out.effects, 1);
  assert.ok(out.diff > 200, 'the stream moves between two frames: ' + out.diff);
  assert.ok(out.startedUnlit && out.afterList && out.afterClick, 'the list lights it and a click puts it out: ' + JSON.stringify(out));
});

test('Terrain Test Grounds: a running stream is animated and the brazier starts unlit and can be lit from the list and by a click', opts, async () => {
  await installTerrainLights(server);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.allLights.length');
  const out = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const names = S.allLights.map((l) => l.id), offAtStart = [...S.lightsOff];
    const cv = document.querySelector('canvas'), ctx = cv.getContext('2d');
    S.fog = false; S.tokens = [];
    const b = S.allLights.find((l) => l.id === 'brazier'), e = S.effects[0];
    const sample = () => { const r = cv.getBoundingClientRect(); const px = (S.view.ox + e.path[20].x * S.view.scale) * (cv.width / r.width), py = (S.view.oy + e.path[20].y * S.view.scale) * (cv.height / r.height); return Array.from(ctx.getImageData(Math.round(px) - 60, Math.round(py) - 20, 120, 40).data); };
    await wait(250); const a1 = sample(); await wait(900); const a2 = sample();
    let diff = 0; for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) diff++;
    const cbox = document.querySelector('#mapLightsList input[data-light="brazier"]');
    const startedUnlit = cbox.checked === false;
    cbox.click(); await wait(200);
    const afterList = !S.lightsOff.has('brazier');
    const r = cv.getBoundingClientRect(), sx = r.left + S.view.ox + b.x * S.view.scale, sy = r.top + S.view.oy + b.y * S.view.scale;
    for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { clientX: sx, clientY: sy, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 3, bubbles: true }));
    await wait(300);
    return { names, offAtStart, effects: S.effects.length, diff, startedUnlit, afterList, afterClick: S.lightsOff.has('brazier') };
  })()`);
  assert.ok(out.names.includes('brazier') && out.names.includes('campfire'), JSON.stringify(out));
  assert.deepEqual(out.offAtStart, ['brazier'], 'only the brazier starts put out');
  assert.equal(out.effects, 1);
  assert.ok(out.diff > 200, 'the stream moves between two frames: ' + out.diff);
  assert.ok(out.startedUnlit && out.afterList && out.afterClick, 'the list lights it and a click puts it out: ' + JSON.stringify(out));
});

test('Show places: in the Player view of a regional map the named places are drawn and a switch (shared with the tabletop) turns them off; the switch is on the map in both views; a pin can be hidden from players', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/dnd-sword-coast-ours.png`);
  await page.waitFor('document.querySelector("#viewSwitch") && document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.kind === "regional"');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    localStorage.removeItem('vtt.showPlaces');
    const S = window.mapTest.state, out = {};
    S.starts.forEach((p) => { if (PlacePins.isPlace(p)) p.known = true; });          // the places the players know from the start
    let drawn = 0; const real = PlacePins.draw; PlacePins.draw = (ctx, pins, px) => { drawn = pins.length; return real(ctx, pins, px); };
    const vis = () => { const e = document.querySelector('#placesRow'); return !e.hidden && e.offsetParent !== null; };
    out.kind = S.kind; out.dmSwitch = vis();
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(300);
    out.playerSwitch = vis(); out.playerOn = document.querySelector('#showPlaces').checked; out.drawn = drawn;
    const box = document.querySelector('#showPlaces'); drawn = -1;
    box.checked = false; box.dispatchEvent(new Event('change')); await wait(300);
    out.drawnOff = drawn; out.stored = localStorage.getItem('vtt.showPlaces');
    box.checked = true; box.dispatchEvent(new Event('change')); await wait(300);
    out.drawnOn = drawn;
    const pin = S.starts.find((p) => PlacePins.isPlace(p)); pin.dmOnly = true; drawn = -1; box.dispatchEvent(new Event('change')); await wait(300);
    out.afterHide = drawn; out.total = S.starts.filter((p) => p.name !== 'start' && !/^area-/.test(p.name)).length;
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(300);
    out.dmAgain = vis();
    return out;
  })()`);
  assert.equal(r.kind, 'regional'); assert.equal(r.dmSwitch, true, 'the places switch is on the map in both views, like the tabletop'); assert.equal(r.playerSwitch, true); assert.equal(r.playerOn, true);
  assert.ok(r.drawn >= 10, 'the named places are drawn'); assert.equal(r.drawnOff, -1, 'switched off: nothing is drawn'); assert.equal(r.stored, '0'); assert.equal(r.drawnOn, r.drawn);
  assert.equal(r.afterHide, r.total - 1, 'a pin marked Hide from players is not drawn'); assert.equal(r.dmAgain, true, 'back in the DM view the switch is still there');
});

test('Map lights can be added and deleted in the DM view and the list is saved with the map', opts, async () => {
  await installTerrainLights(server);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.allLights.length');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = { before: S.allLights.map((l) => l.id) };
    out.boxShown = !document.querySelector('#mapLightsBox').hidden;
    document.querySelector('#mapLightsList button.danger').click(); await wait(2200);          // the first light's X
    out.afterDelete = S.allLights.map((l) => l.id);
    document.querySelector('#newLightKind').value = 'lantern'; document.querySelector('#addLightBtn').click();
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const ev = (type) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + 300, clientY: b.top + 300, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true }));
    ev('pointerdown'); ev('pointerup'); await wait(2200);
    out.afterAdd = S.allLights.map((l) => l.id + ':' + l.kind);
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200);
    out.playerBox = !document.querySelector('#mapLightsBox').hidden;
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(200);
    return out;
  })()`);
  assert.equal(r.boxShown, true); assert.equal(r.afterDelete.length, r.before.length - 1); assert.ok(r.afterAdd.some((x) => /^lantern-1:lantern/.test(x))); assert.equal(r.playerBox, true, 'the Player view lists the lights too (read only)');
  const saved = (await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.lights;
  assert.equal(saved.length, r.before.length, 'one deleted, one added'); assert.ok(saved.some((l) => l.kind === 'lantern' && l.name === 'lantern-1' && l.flicker === true && l.on === false), 'a new light flickers and starts unlit');
  await page.eval(`(async () => { for (let i = 0; i < 20 && document.querySelector('#mapLightsList button.danger'); i++) { document.querySelector('#mapLightsList button.danger').click(); await new Promise((r) => setTimeout(r, 150)); } })()`);       // delete the rest one by one with the X
  await new Promise((x) => setTimeout(x, 2500));
  assert.equal(((await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.lights || []).length, 0, 'deleting every light with the X keeps the empty list');
});

test('Lights tool: click to add, click a light to edit its kind, reach, flame and lit-at-start, drag to move, right-click to delete; all saved', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    for (let i = 0; i < 20 && document.querySelector('#mapLightsList button.danger'); i++) { document.querySelector('#mapLightsList button.danger').click(); await wait(100); }          // start with no lights
    document.querySelector('button.tool[data-tool="lights"]').click();
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const at = (wx, wy) => ({ x: b.left + S.view.ox + wx * S.view.scale, y: b.top + S.view.oy + wy * S.view.scale });
    const ptr = (type, pt, button = 0) => cv.dispatchEvent(new PointerEvent(type, { clientX: pt.x, clientY: pt.y, button, buttons: type === 'pointerup' ? 0 : 1 << button, pointerId: 1, bubbles: true }));
    document.querySelector('#newLightKind').value = 'brazier';
    ptr('pointerdown', at(600, 500)); ptr('pointerup', at(600, 500)); await wait(200);
    out.added = S.allLights.map((l) => l.id + ':' + l.kind + ':' + l.range); out.cardShown = !document.querySelector('#lightCard').hidden;
    document.querySelector('#lcKind').value = 'campfire'; document.querySelector('#lcKind').dispatchEvent(new Event('change'));
    document.querySelector('#lcRange').value = '12'; document.querySelector('#lcRange').dispatchEvent(new Event('change'));
    document.querySelector('#lcOn').checked = false; document.querySelector('#lcOn').dispatchEvent(new Event('change'));
    out.edited = S.allLights.map((l) => [l.kind, l.range, l.flicker === true, l.on === false]);
    ptr('pointerdown', at(600, 500)); ptr('pointermove', at(900, 700)); ptr('pointerup', at(900, 700)); await wait(300);
    out.moved = [S.allLights[0].x, S.allLights[0].y];
    await wait(2200);
    ptr('pointerdown', at(900, 700), 2); ptr('pointerup', at(900, 700), 2); await wait(2200);
    out.afterDelete = S.allLights.length;
    return out;
  })()`);
  assert.deepEqual(r.added, ['brazier-1:brazier:8']); assert.equal(r.cardShown, true);
  assert.deepEqual(r.edited, [['campfire', 12, true, true]]);
  assert.ok(Math.abs(r.moved[0] - 900) < 6 && Math.abs(r.moved[1] - 700) < 6, 'the light follows the drag: ' + r.moved);
  assert.equal(r.afterDelete, 0);
  assert.equal(((await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.lights || []).length, 0);
});

test('a drag on empty ground pans the map with the Pins, Token and Lights tools (a plain click still acts); the small campfire is a kind of light', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const ptr = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + x, clientY: b.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true }));
    out.kinds = [...document.querySelectorAll('#newLightKind option')].map((o) => o.value);
    for (const tool of ['lights', 'start', 'token']) {
      document.querySelector('button.tool[data-tool="' + tool + '"]').click();
      const before = { ox: S.view.ox, oy: S.view.oy, lights: S.allLights.length, pins: S.starts.length };
      ptr('pointerdown', 700, 100); for (let i = 1; i <= 8; i++) ptr('pointermove', 700 - i * 12, 100 + i * 8); ptr('pointerup', 604, 164); await wait(200);
      out[tool] = { panned: Math.round(S.view.ox - before.ox) + ',' + Math.round(S.view.oy - before.oy), added: S.allLights.length - before.lights, pins: S.starts.length - before.pins };
    }
    document.querySelector('button.tool[data-tool="lights"]').click();
    document.querySelector('#newLightKind').value = 'small-campfire';
    const sx = S.view.ox + 1000 * S.view.scale, sy = S.view.oy + 1100 * S.view.scale;          // somewhere with no light
    ptr('pointerdown', sx, sy); ptr('pointerup', sx, sy); await wait(300);
    out.small = S.allLights.filter((l) => l.kind === 'small-campfire').map((l) => l.kind + ':' + l.range + ':' + (l.flicker === true))[0];
    return out;
  })()`);
  assert.ok(r.kinds.includes('small-campfire'));
  for (const tool of ['lights', 'start', 'token']) { assert.equal(r[tool].panned, '-96,64', tool + ' pans by the drag'); assert.equal(r[tool].added, 0); assert.equal(r[tool].pins, 0); }
  assert.equal(r.small, 'small-campfire:4:true', 'a small campfire: a short reach with a flame');
});

test('Show light radius (under Fog and sight) draws each light\'s dim and bright reach in the DM view only', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    const box = document.querySelector('#showLightRadius');
    out.exists = !!box; out.off = S.showLightRadius === false || S.showLightRadius === undefined;
    const ctx = document.querySelector('canvas').getContext('2d'); let arcs = 0; const real = ctx.arc.bind(ctx);
    ctx.arc = (...a) => { arcs++; return real(...a); };
    S.allLights.length ? 0 : S.allLights.push({ x: 500, y: 500, range: 5, id: 'test', name: 'test' });
    S.tokens.length = 0; arcs = 0; document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(250); out.arcsOff = arcs;
    box.checked = true; box.dispatchEvent(new Event('change')); arcs = 0; for (let i = 0; i < 20 && arcs < out.arcsOff + 2; i++) await wait(100); out.arcsOn = arcs;         // wait for the redraw
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(250); arcs = 0; box.dispatchEvent(new Event('change')); await wait(250); out.arcsPlayer = arcs;
    out.lights = S.allLights.length; box.checked = false; box.dispatchEvent(new Event('change'));
    document.querySelector('#viewSwitch button[data-view="dm"]').click();
    return out;
  })()`);
  assert.equal(r.exists, true); assert.ok(r.arcsOn >= r.arcsOff + 2 * r.lights, 'two circles per light appear: ' + JSON.stringify(r)); assert.ok(r.arcsPlayer < r.arcsOn, 'the player view draws none of them');
});

test('the Walls tool draws fences and doors as well as walls: a Draw select picks what the next walls are', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    document.querySelector('button.tool[data-tool="walls"]').click();
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const ptr = (type, wx, wy) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + S.view.ox + wx * S.view.scale, clientY: b.top + S.view.oy + wy * S.view.scale, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, altKey: true }));
    const draw = async (kind, x1, y1, x2, y2) => { document.querySelector('#wallKinds button[data-kind="' + kind + '"]').click(); const n = S.walls.length;
      ptr('pointerdown', x1, y1); for (let i = 1; i <= 8; i++) ptr('pointermove', x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8); ptr('pointerup', x2, y2); await wait(250); return S.walls.slice(n).map((w) => w.type); };
    out.fence = await draw('fence', 200, 1200, 600, 1200);
    out.door = await draw('door', 200, 1250, 260, 1250);
    out.wall = await draw('wall', 200, 1300, 600, 1300);
    out.window = await draw('window', 200, 1350, 600, 1350);
    const last = S.walls[S.walls.length - 1]; S.wallSel = last; window.mapTest.syncWallBox && window.mapTest.syncWallBox();
    document.querySelector('#wallKinds button[data-kind="door"]').click(); await wait(100);
    out.changed = [last.type, document.querySelector('#wallKinds button[data-kind="door"]').getAttribute('aria-pressed')];
    document.querySelector('#wallKinds button[data-kind="wall"]').click(); await wait(100);
    out.changedBack = last.type;
    return out;
  })()`);
  assert.ok(r.fence.length >= 1 && r.fence.every((t) => t === 'fence'), 'fence: ' + r.fence); assert.ok(r.door.every((t) => t === 'door'), 'door: ' + r.door); assert.ok(r.wall.every((t) => t === 'wall'), 'wall: ' + r.wall); assert.ok(r.window.length >= 1 && r.window.every((t) => t === 'window'), 'window: ' + r.window);
  assert.deepEqual(r.changed, ['door', 'true'], 'a kind button changes the selected wall'); assert.equal(r.changedBack, 'wall');
});

test('in a dark place the top of a boulder (a small closed wall ring) is revealed only within darkvision or the carried light, and only when the map shows ring tops', opts, async () => {
  const MAPSET = '?set=fe449df8-3c8b-4e23-92b8-71722160d4b7';          // Cragmaw Hideout: a dark map with small wall rings
  await page.goto(`${server.base}/map-test.html${MAPSET}`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.walls.length');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state;
    const cs = S.W / S.squares, loops = WallObjects.loops(S.walls, 9 * cs, S.rooms || []);
    if (!loops.length) return { loops: 0 };
    const L = loops[0], cx = L.reduce((a, p) => a + p.x, 0) / L.length, cy = L.reduce((a, p) => a + p.y, 0) / L.length;
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200);
    S.allLights.length = 0; S.mapLights = [];                                       // the map's own lights also light ground: leave only the token's own sight
    { const sel = document.querySelector('#lightLevel'); sel.value = 'dark'; sel.dispatchEvent(new Event('change')); }       // the test is about a dark place, whatever this map is set to
    S.tokens.length = 0; S.tokens.push({ x: cx + 6 * cs, y: cy, id: 't' });         // six squares (30 ft) from the ring, with line of sight along the open ground
    const setDv = (v) => { const sel = document.querySelector('#testDv'); sel.value = v; sel.dispatchEvent(new Event('change')); };
    const setLight = (v) => { const e = document.querySelector('#testLight'); e.value = v; e.dispatchEvent(new Event('input')); };
    const out = { light: S.light, loops: loops.length, cases: [] };
    out.light = S.light;
    for (const [dv, lt, tops] of [['0', '0', false], ['0', '0', true], ['60', '0', true], ['60', '0', false]]) {
      const cb = document.querySelector('#objectTops'); cb.checked = tops; cb.dispatchEvent(new Event('change'));        // a change starts the explored layer again
      setLight(lt); setDv(dv); window.mapTest.revealFog(); await wait(500);
      out.cases.push(window.mapTest.fogAlphaAt(cx, cy));
    }
    return out;
  })()`);
  assert.notEqual(r.loops, 0, 'the map has small wall rings'); assert.equal(r.light, 'dark');
  const [offNone, onNone, onDv, offDv] = r.cases;
  assert.ok(offNone >= 200 && onNone >= 200, 'with no darkvision and no light the ring stays under the fog: ' + JSON.stringify(r.cases));
  assert.ok(onDv < 120, 'with darkvision 60 ft and ring tops on, the ring (30 ft away, in sight) is revealed: ' + JSON.stringify(r.cases));
  assert.ok(offDv >= 200, 'with Show the tops of closed wall rings unticked the inside stays hidden: ' + JSON.stringify(r.cases));
  const saved = (await server.get('/api/map-config?map=vtt-pack-cragmaw-hideout-copy.png')).json.config;
  assert.equal(saved.objectTops, false, 'the last choice (off) is saved with the map');
});

test('Fog of war on this map: the setting under Mood theme is saved (Show Fog is only a way of looking) with the map and read back', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  await page.eval(`(async () => { const cb = document.querySelector('#mapFog'); cb.checked = false; cb.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 2200)); })()`);
  assert.equal((await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.fog, false);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  assert.equal(await page.eval(`document.querySelector('#mapFog').checked`), false, 'the box comes back unticked');
  await page.eval(`(async () => { const cb = document.querySelector('#mapFog'); cb.checked = true; cb.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 2200)); })()`);
  assert.equal((await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.fog, undefined, 'fog on is the default and is not stored');
  await page.eval(`(async () => { const cb = document.querySelector('#fog'); cb.checked = false; cb.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 2200)); })()`);
  assert.equal((await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.fog, undefined, 'Show Fog saves nothing');
});

test('Show places on a town map: with no place known from the start the Player view says so, and the All button makes them show', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-phandalin.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.kind === "town"');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state, out = {};
    S.starts.forEach((p) => { delete p.known; });
    let drawn = -1; const real = PlacePins.draw; PlacePins.draw = (ctx, pins, px) => { drawn = pins.length; return real(ctx, pins, px); };
    const places = S.starts.filter((p) => PlacePins.isPlace(p)).length; out.places = places;
    out.rowDm = !document.querySelector('#knownRow').hidden;
    document.querySelector('#knownNone').click(); await wait(200);
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(300);
    const cb = document.querySelector('#showPlaces'); cb.checked = true; cb.dispatchEvent(new Event('change')); await wait(300);
    out.hint = !document.querySelector('#placesHint').hidden; out.rowPlayer = !document.querySelector('#knownRow').hidden; out.drawnNone = drawn;
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(200);
    document.querySelector('#knownAll').click(); await wait(200);
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(300);
    out.hintAfter = !document.querySelector('#placesHint').hidden; out.drawnAll = drawn;
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); document.querySelector('#knownNone').click(); await wait(2200);
    return out;
  })()`);
  assert.ok(r.places >= 10); assert.equal(r.rowDm, true); assert.equal(r.hint, true, 'it says why nothing shows'); assert.equal(r.rowPlayer, false);
  assert.ok(r.drawnNone <= 0, 'none known: none drawn'); assert.equal(r.hintAfter, false); assert.equal(r.drawnAll, r.places, 'All: every place is drawn');
});

test('toggling a light\'s Flicker over and over does not wear the soft edge of the fog away', opts, async () => {
  await installTerrainLights(server);
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.allLights.length');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.mapTest.state;
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200);
    const t = S.tokens[0] || (S.tokens.push({ x: 500, y: 500, id: 't' }), S.tokens[0]); window.mapTest.revealFog(); await wait(500);
    const radius = (S.visionFt / 5) * (S.W / S.squares);
    const edge = [0.8, 0.9, 0.97].map((f) => window.mapTest.fogAlphaAt(t.x + radius * f, t.y));
    const cb = document.querySelector('#mapLightsList input[type=checkbox][title^="Flickers"]');
    for (let i = 0; i < 12; i++) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); await wait(60); }
    await wait(300);
    const after = [0.8, 0.9, 0.97].map((f) => window.mapTest.fogAlphaAt(t.x + radius * f, t.y));
    return { edge, after };
  })()`);
  r.edge.forEach((a, i) => assert.ok(Math.abs(a - r.after[i]) <= 6, 'the fog edge stays as it was: ' + JSON.stringify(r)));
});

test('DM view (see through fog) is unticked and inactive while Fog of war is off, and comes back with it', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const fog = document.querySelector('#fog'), dm = document.querySelector('#dm'), out = {};
    const mapFog = document.querySelector('#mapFog'); mapFog.checked = true; mapFog.dispatchEvent(new Event('change')); await wait(100);       // the map in the real data may have been saved with fog off
    out.showBoxOn = !fog.disabled;
    out.start = [fog.checked, dm.checked, dm.disabled];
    fog.checked = false; fog.dispatchEvent(new Event('change')); await wait(100);
    out.fogOff = [dm.checked, dm.disabled];
    fog.checked = true; fog.dispatchEvent(new Event('change')); await wait(100);
    out.fogOn = [dm.checked, dm.disabled];
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(100);
    out.player = [dm.checked, dm.disabled];
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(100);
    mapFog.checked = false; mapFog.dispatchEvent(new Event('change')); await wait(100);
    out.mapFogOff = [fog.disabled, fog.checked, dm.disabled, getComputedStyle(fog.closest('label')).cursor];
    mapFog.checked = true; mapFog.dispatchEvent(new Event('change')); await wait(100);
    out.mapFogBack = [fog.disabled, fog.checked];
    return out;
  })()`);
  assert.deepEqual(r.start, [true, true, false]); assert.deepEqual(r.fogOff, [false, true], 'fog off: unticked and inactive');
  assert.deepEqual(r.mapFogOff, [true, false, true, 'not-allowed'], 'no fog on the map: Show Fog is unticked and greyed out'); assert.deepEqual(r.mapFogBack, [false, true]);
  assert.deepEqual(r.fogOn, [true, false], 'fog on again: it follows the DM view again'); assert.deepEqual(r.player, [false, false]);
  await page.eval(`(async () => { const fog = document.querySelector('#fog'); fog.checked = true; fog.dispatchEvent(new Event('change')); })()`);
});

test('in the Walls tool a plain drag on empty ground pans the map (no wall is drawn); Alt + drag draws', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('button.tool[data-tool="walls"]').click();
    S.walls = []; S.wallUndo = []; S.wallPen = null;
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const drag = async (x0, y0, x1, y1, alt) => { const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX: b.left + x, clientY: b.top + y, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 3, bubbles: true, altKey: alt })); ev('pointerdown', x0, y0); for (let i = 1; i <= 8; i++) ev('pointermove', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); ev('pointerup', x1, y1); await wait(250); };
    const ox = S.view.ox;
    await drag(300, 500, 200, 500, false);
    const panned = { moved: S.view.ox !== ox, walls: S.walls.length };
    await drag(300, 500, 500, 500, true);
    return { panned, drawn: S.walls.length };
  })()`);
  assert.ok(r.panned.moved && r.panned.walls === 0, 'a plain drag pans and draws nothing: ' + JSON.stringify(r));
  assert.equal(r.drawn, 1, 'Alt + drag draws a wall');
});

test('in the Walls tool a click on a door edits it like a wall (it does not open the door), so walls and doors join end to end', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('button.tool[data-tool="walls"]').click();
    S.walls = [{ x1: 300, y1: 700, x2: 400, y2: 700, type: 'wall', open: false }, { x1: 400, y1: 700, x2: 700, y2: 700, type: 'door', open: false }, { x1: 700, y1: 700, x2: 800, y2: 700, type: 'wall', open: false }];
    S.wallUndo = []; S.wallPen = null; S.wallSel = null;
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const at = (x, y) => ({ clientX: b.left + S.view.ox + x * S.view.scale, clientY: b.top + S.view.oy + y * S.view.scale });
    const click = (x, y) => { for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { ...at(x, y), button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 5, bubbles: true })); };
    click(550, 700); await wait(250);
    const mid = { open: S.walls[1].open, selType: S.wallSel && S.wallSel.type };
    S.wallSel = null; click(700, 700); await wait(250);
    return { mid, doorOpen: S.walls[1].open };
  })()`);
  assert.equal(r.mid.open, false, 'the door stays shut: ' + JSON.stringify(r)); assert.equal(r.mid.selType, 'door', 'the door is selected for editing');
  assert.equal(r.doorOpen, false);
});

test('in the Walls tool a click on an existing end carries on drawing from that point; dragging the end still moves it', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-terrain-test.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('button.tool[data-tool="walls"]').click();
    S.walls = [{ x1: 300, y1: 700, x2: 700, y2: 700, type: 'door', open: false }];
    S.wallUndo = []; S.wallPen = null; S.wallSel = S.walls[0];
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const at = (x, y) => ({ clientX: b.left + S.view.ox + x * S.view.scale, clientY: b.top + S.view.oy + y * S.view.scale });
    const click = (x, y) => { for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { ...at(x, y), button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 6, bubbles: true })); };
    click(700, 700); await wait(250);
    const pen = S.wallPen && { x: S.wallPen.x, y: S.wallPen.y };
    click(700, 900); await wait(250);
    return { pen, walls: S.walls.map((w) => [w.type, w.x1, w.y1, w.x2, w.y2]) };
  })()`);
  assert.deepEqual(r.pen, { x: 700, y: 700 }, 'the click on the end starts a run from it: ' + JSON.stringify(r));
  assert.equal(r.walls.length, 2); assert.deepEqual(r.walls[1].slice(1), [700, 700, 700, 900], 'the new wall starts exactly at the door\'s end');
});

test('the speaker button next to Ambient sound plays and stops the selected sound, and is greyed out for None', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const sel = document.querySelector('#ambienceKind'), btn = document.querySelector('#ambPlay'), out = {};
    const calls = []; const o = { setScene: Ambience.setScene, stop: Ambience.stop }; Ambience.setScene = (k) => calls.push('scene:' + k); Ambience.stop = (k) => calls.push('stop:' + k);
    sel.value = 'none'; sel.dispatchEvent(new Event('change')); out.none = btn.disabled;
    sel.value = 'rain'; sel.dispatchEvent(new Event('change')); out.rain = btn.disabled;
    btn.click(); out.playing = btn.getAttribute('aria-pressed');
    sel.value = 'wind'; sel.dispatchEvent(new Event('change'));
    btn.click(); out.stopped = btn.getAttribute('aria-pressed');
    sel.value = 'none'; sel.dispatchEvent(new Event('change'));
    out.calls = calls; Ambience.setScene = o.setScene; Ambience.stop = o.stop; return out;
  })()`);
  assert.equal(r.none, true, 'None greys the button out'); assert.equal(r.rain, false); assert.equal(r.playing, 'true'); assert.equal(r.stopped, 'false');
  assert.deepEqual(r.calls.filter((c) => c.startsWith('scene:')), ['scene:rain', 'scene:wind'], 'it plays the chosen sound, and follows a change while playing: ' + JSON.stringify(r.calls));
  assert.ok(r.calls.includes('stop:scene'), 'the second click stops it');
});

test('each door in the Doors list has a delete button, and Undo brings the door back', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    S.walls = [{ x1: 300, y1: 700, x2: 400, y2: 700, type: 'door', open: false }, { x1: 500, y1: 700, x2: 600, y2: 700, type: 'door', open: false }, { x1: 0, y1: 0, x2: 100, y2: 0, type: 'wall', open: false }];
    S.wallUndo = []; window.mapTest.renderDoorList();
    const out = { buttons: document.querySelectorAll('#doorList button[aria-label^="Delete door"]').length };
    document.querySelector('#doorList button[aria-label="Delete door 1"]').click(); await wait(100);
    out.after = S.walls.map((w) => w.type + ':' + w.x1); out.rows = document.querySelectorAll('#doorList button[aria-label^="Delete door"]').length;
    document.querySelector('#wallUndo').click(); await wait(100);
    out.undone = S.walls.length; return out;
  })()`);
  assert.equal(r.buttons, 2); assert.deepEqual(r.after, ['door:500', 'wall:0'], 'only the first door is gone'); assert.equal(r.rows, 1); assert.equal(r.undone, 3, 'Undo brings it back');
});

test('the day and night looks of a place share pins, walls, doors and lights (nothing to copy between them)', opts, async () => {
  const get = async (m) => (await server.get('/api/map-config?map=' + m)).json.config;
  const day = await get('vtt-camp-day.png'), night = await get('vtt-camp-night.png');
  assert.deepEqual(night.starts, day.starts, 'pins'); assert.deepEqual(night.walls, day.walls, 'walls, doors and fences');
  assert.deepEqual((night.lights || []).map((l) => l.name), (day.lights || []).map((l) => l.name), 'lights');
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  assert.equal(await page.eval(`!document.querySelector('#copyPinsBtn') && !document.querySelector('#copyTarget')`), true, 'the Copy pins inputs are gone');
});

test('the Light sources table is the same in the DM and the Player view', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    const snap = () => JSON.stringify({ shown: !document.querySelector('#mapLightsBox').hidden, html: document.querySelector('#mapLightsList').innerHTML, add: document.querySelector('#addLightBtn').offsetParent !== null });
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(200); out.dm = snap();
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(200); out.player = snap();
    return out;
  })()`);
  assert.equal(r.player, r.dm, 'the table and the Add button are identical in both views'); assert.equal(JSON.parse(r.dm).shown, true);
});

test('with the Door kind picked a click on a wall makes a one-square door in it; the door card edits state, DC and open', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    document.querySelector('button.tool[data-tool="walls"]').click();
    S.walls = [{ x1: 200, y1: 700, x2: 1000, y2: 700, type: 'wall', open: false }]; S.wallUndo = []; S.wallPen = null; S.wallSel = null;
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect(), cell = S.W / S.squares;
    const at = (x, y) => ({ clientX: b.left + S.view.ox + x * S.view.scale, clientY: b.top + S.view.oy + y * S.view.scale });
    const click = (x, y) => { for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { ...at(x, y), button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 8, bubbles: true })); };
    click(600, 700); await wait(250); out.plain = S.walls.map((w) => w.type);          // the Wall kind: a click only selects
    S.wallSel = null; document.querySelector('#wallKinds button[data-kind="door"]').click(); await wait(100);
    click(600, 700); await wait(250);
    out.parts = S.walls.map((w) => [w.type, Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))]); out.cell = Math.round(cell);
    out.sel = S.wallSel && S.wallSel.type; out.card = !document.querySelector('#doorCard').hidden;
    document.querySelector('#dcState').value = 'locked'; document.querySelector('#dcState').dispatchEvent(new Event('change'));
    document.querySelector('#dcDc').value = '15'; document.querySelector('#dcDc').dispatchEvent(new Event('change')); await wait(100);
    const door = S.walls.find((w) => w.type === 'door');
    out.locked = [door.locked === true, door.dc, document.querySelector('#dcOpen').disabled];
    document.querySelector('#dcState').value = ''; document.querySelector('#dcState').dispatchEvent(new Event('change'));
    document.querySelector('#dcOpen').checked = true; document.querySelector('#dcOpen').dispatchEvent(new Event('change')); await wait(100);
    out.normal = [door.locked, door.dc, door.open];
    document.querySelector('#dcDelete').click(); await wait(100); out.after = S.walls.map((w) => w.type); out.cardGone = document.querySelector('#doorCard').hidden;
    return out;
  })()`);
  assert.deepEqual(r.plain, ['wall'], 'with the Wall kind a click does not make a door');
  assert.deepEqual(r.parts.map((p) => p[0]), ['wall', 'door', 'wall'], JSON.stringify(r)); assert.equal(r.parts[1][1], r.cell, 'the door is one square wide');
  assert.equal(r.sel, 'door'); assert.equal(r.card, true, 'the card opens for the new door');
  assert.deepEqual(r.locked, [true, 15, true], 'locked with a DC, and Starts open is unavailable');
  assert.deepEqual(r.normal, [null, null, true], 'back to normal, starts open');
  assert.deepEqual(r.after, ['wall', 'wall']); assert.equal(r.cardGone, true);
});

test('light zones: draw one with the Zones tool, set its light, save it; a dark zone in a bright map stays under the fog while the rest is seen', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    S.light = 'bright'; S.lightZones = []; S.darkvisionFt = 0; S.allLights = []; S.mapLights = []; S.fog = true; S.mapFog = true;
    document.querySelector('button.tool[data-tool="zones"]').click(); await wait(100);
    document.querySelector('#zoneNew').click();
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const at = (x, y) => ({ clientX: b.left + S.view.ox + x * S.view.scale, clientY: b.top + S.view.oy + y * S.view.scale });
    const click = (x, y) => { for (const t of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(t, { ...at(x, y), button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 9, bubbles: true })); };
    for (const [x, y] of [[1000, 300], [1800, 300], [1800, 900], [1000, 900]]) { click(x, y); await wait(60); }
    out.pen = S.zonePen && S.zonePen.points.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await wait(150);
    out.zones = S.lightZones.map((z) => [z.level, z.points.length]); out.card = !document.querySelector('#zoneCard').hidden;
    document.querySelector('#zcName').value = 'Crypt'; document.querySelector('#zcName').dispatchEvent(new Event('change'));
    document.querySelector('#zcLevel').value = 'dark'; document.querySelector('#zcLevel').dispatchEvent(new Event('change')); await wait(2300);
    out.saved = true;
    // the token stands in the bright part, next to the dark zone
    document.querySelector('button.tool[data-tool="token"]').click();
    S.tokens = [{ x: 700, y: 600 }]; window.mapTest.revealFog();
    const fa = window.mapTest.fogAlphaAt;
    out.brightSeen = fa(600, 600) < 60; out.darkZoneCovered = fa(1150, 600) > 150; out.farBrightCovered = fa(100, 100);
    // the same zone made bright shows what the token can see through it
    const fresh = () => { document.querySelector('#resetFogBtn').click(); window.mapTest.revealFog(); };
    S.lightZones[0].level = 'bright'; fresh(); out.nowSeen = fa(1150, 600) < 90;
    S.lightZones[0].level = 'time'; S.timeOfDay = 'night'; fresh(); out.timeNight = fa(1150, 600) > 150;
    S.timeOfDay = 'day'; fresh(); out.timeDay = fa(1150, 600) < 90;
    return out;
  })()`);
  assert.equal(r.pen, 4); assert.deepEqual(r.zones, [['dark', 4]], 'a finished zone starts out dark'); assert.equal(r.card, true);
  const saved = (await server.get('/api/map-config?map=vtt-camp-day.png')).json.config.lightZones;
  assert.ok(saved && saved.length === 1 && saved[0].name === 'Crypt' && saved[0].level === 'dark' && saved[0].points.length === 4, 'saved with the map: ' + JSON.stringify(saved));
  assert.equal(r.brightSeen, true, 'ground in the bright part is seen'); assert.equal(r.darkZoneCovered, true, 'the dark zone stays under the fog (no darkvision, no light)');
  assert.equal(r.nowSeen, true, 'a bright zone is seen'); assert.equal(r.timeNight, true, 'a time zone is dark at night'); assert.equal(r.timeDay, true, 'and bright in the Day look');
  await page.eval(`(async () => { const S = window.mapTest.state; document.querySelector('button.tool[data-tool="zones"]').click(); S.zoneSel = S.lightZones[0]; document.querySelector('#zcDelete').click(); await new Promise((r) => setTimeout(r, 2300)); })()`);
  assert.equal((await server.get('/api/map-config?map=vtt-camp-day.png')).json.config.lightZones, undefined, 'deleting the last zone removes them from the map');
});

test('the Doors list lines the drop downs up, defaults to Normal, and a locked or secret door starts at DC 15', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    S.walls = [{ x1: 300, y1: 700, x2: 400, y2: 700, type: 'door', open: false }, { x1: 500, y1: 700, x2: 600, y2: 700, type: 'door', open: false }];
    S.wallUndo = []; window.mapTest.renderDoorList();
    const sels = () => [...document.querySelectorAll('#doorList select')];
    const out = { defaults: sels().map((s) => s.value) };
    sels()[1].value = 'locked'; sels()[1].dispatchEvent(new Event('change')); await wait(100);
    out.dc = S.walls[1].dc; out.locked = S.walls[1].locked === true;
    out.left = sels().map((s) => Math.round(s.getBoundingClientRect().left));
    sels()[1].value = 'secret'; sels()[1].dispatchEvent(new Event('change')); await wait(100); out.secretDc = S.walls[1].dc;
    sels()[1].value = ''; sels()[1].dispatchEvent(new Event('change')); await wait(100); out.normalDc = S.walls[1].dc === undefined;
    return out;
  })()`);
  assert.deepEqual(r.defaults, ['', '']); assert.equal(r.dc, 15); assert.equal(r.locked, true); assert.equal(r.secretDc, 15); assert.equal(r.normalDc, true);
  assert.equal(r.left[0], r.left[1], 'the drop downs line up: ' + JSON.stringify(r.left));
});

test('light zones: in a dark map a bright zone has pale cloud fog and the dark rest has black fog; nothing is revealed through a wall or at the map edge', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    S.light = 'dark'; S.darkvisionFt = 30; S.fog = true; S.mapFog = true; S.dm = false; S.viewAs = 'player'; S.allLights = []; S.mapLights = []; S.lightsOff = new Set();
    S.walls = [{ x1: 1000, y1: 0, x2: 1000, y2: 1100, type: 'wall', open: false }, { x1: 300, y1: 1100, x2: 1000, y2: 1100, type: 'wall', open: false }];
    S.lightZones = [{ id: 'day', name: 'Day', level: 'bright', points: [{ x: 0, y: 600 }, { x: 1000, y: 600 }, { x: 1000, y: 1500 }, { x: 0, y: 1500 }] }];
    document.querySelector('#fog').checked = true; document.querySelector('#resetFogBtn').click();
    S.tokens = [{ x: 300, y: 900 }]; window.mapTest.revealFog(); await wait(400);
    const cv = document.querySelector('canvas'), x = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const px = (wx, wy) => { const d = x.getImageData(Math.round((S.view.ox + wx * S.view.scale) * dpr), Math.round((S.view.oy + wy * S.view.scale) * dpr), 1, 1).data; return Math.round((d[0] + d[1] + d[2]) / 3); };
    const fa = window.mapTest.fogAlphaAt;
    return { litFog: px(900, 1400), darkFog: px(1500, 300), seen: fa(300, 900), behindWall: fa(1100, 900), edgeLit: fa(5, 1400), edgeDark: fa(1995, 300), cornerFar: fa(1990, 1490) };
  })()`);
  assert.ok(r.litFog > 120, 'pale fog over the bright zone: ' + JSON.stringify(r)); assert.ok(r.darkFog < 40, 'black fog over the dark ground: ' + JSON.stringify(r));
  assert.ok(r.seen < 60, 'what the token sees is clear'); assert.ok(r.behindWall > 200, 'nothing behind the wall is revealed');
  assert.ok(r.edgeDark > 200 && r.cornerFar > 200, 'the map edge in the dark part stays fogged: ' + JSON.stringify(r));
});

test('light zones can be reshaped: drag a corner, Alt + click an edge adds a corner, right-click a corner removes it (never below three)', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-camp-day.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    S.lightZones = [{ id: 'z1', name: 'Z', level: 'dark', points: [{ x: 600, y: 300 }, { x: 1200, y: 300 }, { x: 1200, y: 800 }, { x: 600, y: 800 }] }]; S.zoneSel = null;
    document.querySelector('button.tool[data-tool="zones"]').click(); S.zoneSel = S.lightZones[0]; await wait(100);
    const cv = document.querySelector('canvas'), b = cv.getBoundingClientRect();
    const at = (x, y) => ({ clientX: b.left + S.view.ox + x * S.view.scale, clientY: b.top + S.view.oy + y * S.view.scale });
    const ev = (t, x, y, o = {}) => cv.dispatchEvent(new PointerEvent(t, { ...at(x, y), button: o.button ?? 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 11, bubbles: true, altKey: !!o.alt }));
    ev('pointerdown', 1200, 300); for (let i = 1; i <= 6; i++) ev('pointermove', 1200 + i * 20, 300 - i * 10); ev('pointerup', 1320, 240); await wait(250);
    out.moved = S.lightZones[0].points.map((q) => [q.x, q.y])[1];
    ev('pointerdown', 900, 300, { alt: true }); ev('pointerup', 900, 300); await wait(250);
    out.added = S.lightZones[0].points.length;
    cv.dispatchEvent(new PointerEvent('pointerdown', { ...at(1320, 240), button: 2, buttons: 2, pointerId: 11, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointerup', { ...at(1320, 240), button: 2, buttons: 0, pointerId: 11, bubbles: true })); await wait(250);
    out.removed = S.lightZones[0].points.length;
    S.lightZones[0].points = S.lightZones[0].points.slice(0, 3);
    cv.dispatchEvent(new PointerEvent('pointerdown', { ...at(S.lightZones[0].points[0].x, S.lightZones[0].points[0].y), button: 2, buttons: 2, pointerId: 11, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointerup', { ...at(600, 300), button: 2, buttons: 0, pointerId: 11, bubbles: true })); await wait(250);
    out.minimum = S.lightZones[0].points.length;
    return out;
  })()`);
  assert.deepEqual(r.moved, [1320, 240], 'dragging a corner moves it'); assert.equal(r.added, 5, 'Alt + click on an edge adds a corner'); assert.equal(r.removed, 4, 'right-click on a corner removes it'); assert.equal(r.minimum, 3, 'a zone keeps at least three corners');
});

test('Show labels: the Player view of a regional map writes its region and trail names over the picture and a switch (shared with the tabletop) turns them off; the switch is on the map in both views', opts, async () => {
  const file = 'dnd-sword-coast-ours.png';
  const cfg = (await server.get('/api/map-config?map=' + file)).json.config; delete cfg.setVersion;     // own labels: the test does not assume what the map has
  cfg.kind = 'regional';
  cfg.labels = [
    { id: 't-region', text: 'Test Mountains', kind: 'region', x: 600, y: 700, size: 60, rot: 10 },
    { id: 't-trail', text: 'The Test Road', kind: 'trail', x: 500, y: 900, size: 24, path: [{ x: 350, y: 950 }, { x: 500, y: 900 }, { x: 650, y: 940 }] }
  ];
  assert.equal((await server.put('/api/map-config?map=' + file, cfg)).status, 200);
  await page.goto(`${server.base}/map-test.html?map=/uploads/${file}`);
  await page.waitFor('document.querySelector("#viewSwitch") && document.querySelector("#banner").textContent.includes("px") && window.mapTest.state.kind === "regional" && window.mapTest.state.labels.length === 2');
  const r = await page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    localStorage.removeItem('vtt.showLabels');
    const S = window.mapTest.state, out = {};
    let drawn = -1; const real = MapLabels.draw; MapLabels.draw = (ctx, labels, px) => { drawn = real(ctx, labels, px); return drawn; };
    const vis = () => { const e = document.querySelector('#labelsRow'); return !e.hidden && e.offsetParent !== null; };
    const cv = document.querySelector('canvas');
    out.dmSwitch = vis(); await wait(300); out.dmDrawn = drawn;
    document.querySelector('#viewSwitch button[data-view="player"]').click(); await wait(400);
    out.playerSwitch = vis(); out.playerOn = document.querySelector('#showLabels').checked; out.drawn = drawn; const withLabels = cv.toDataURL();
    const box = document.querySelector('#showLabels'); drawn = -1;
    box.checked = false; box.dispatchEvent(new Event('change')); await wait(300);
    out.drawnOff = drawn; out.stored = localStorage.getItem('vtt.showLabels'); out.pixelsChange = cv.toDataURL() !== withLabels;
    box.checked = true; box.dispatchEvent(new Event('change')); await wait(300);
    out.drawnOn = drawn; out.storedOn = localStorage.getItem('vtt.showLabels');
    MapLabels.draw = real;
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(300);
    out.dmAgain = vis();
    return out;
  })()`);
  assert.equal(r.dmSwitch, true, 'the labels switch is on the map in both views, like the tabletop'); assert.equal(r.dmDrawn, -1, 'the DM view does not draw them');
  assert.equal(r.playerSwitch, true); assert.equal(r.playerOn, true); assert.equal(r.drawn, 2, 'both labels are drawn in the Player view');
  assert.equal(r.drawnOff, -1, 'switched off: nothing is drawn'); assert.equal(r.pixelsChange, true, 'the picture changes when the labels go'); assert.equal(r.stored, '0');
  assert.equal(r.drawnOn, 2); assert.equal(r.storedOn, '1'); assert.equal(r.dmAgain, true, 'back in the DM view the switch is still there');
});

test('the Known and Hide from players options belong to town and regional maps only: a camp pin card and the Pins table do not show them', opts, async () => {
  const probe = async (url) => {
    await page.goto(`${server.base}/map-test.html?map=${url}`);
    await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
    return page.eval(`(async () => {
      const S = window.mapTest.state; document.querySelector('button.tool[data-tool="start"]').click();
      S.starts = S.starts.filter((p) => p.name === 'start'); S.starts.push({ name: 'rest-area', x: 300, y: 300 });
      window.mapTest.selectPin(S.starts[S.starts.length - 1], false);
      const vis = (id) => { const e = document.querySelector(id); return !!e && !e.hidden; };
      const th = [...document.querySelectorAll('.pins-table th')].filter((t) => !t.hidden).map((t) => t.textContent);
      return { kind: S.kind, known: vis('#pcKnownRow'), dmOnly: vis('#pcDmOnlyRow'), columns: th };
    })()`);
  };
  const camp = await probe('/uploads/vtt-camp-day.png');
  assert.equal(camp.kind, 'camp'); assert.equal(camp.known, false, JSON.stringify(camp)); assert.equal(camp.dmOnly, false); assert.ok(!camp.columns.includes('Known') && !camp.columns.includes('DM only'), 'the Pins table has no place columns on a camp: ' + JSON.stringify(camp));
  const region = await probe('/uploads/dnd-sword-coast-ours.png');
  assert.equal(region.kind, 'regional'); assert.equal(region.known, true); assert.equal(region.dmOnly, true); assert.ok(region.columns.includes('Known') && region.columns.includes('DM only'), JSON.stringify(region));
});

test('the time of day in Map Test works like the tabletop: the night wash, zones that follow the time, and the Night look only when the place has one', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-crypt-method-b.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    S.light = 'bright'; S.lightZones = [{ id: 'yard', name: 'Yard', level: 'time', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }, { id: 'vault', name: 'Vault', level: 'dark', points: [{ x: 600, y: 600 }, { x: 900, y: 600 }, { x: 900, y: 900 }, { x: 600, y: 900 }] }];
    const wash = () => { const c = MapShared.nightWash(S.lightZones, S.light === 'dark', S.timeOfDay, S.W, S.H); return c ? { yard: c.getContext('2d').getImageData(200, 200, 1, 1).data[3], vault: c.getContext('2d').getImageData(700, 700, 1, 1).data[3], open: c.getContext('2d').getImageData(1000, 300, 1, 1).data[3] } : null; };
    out.day = wash(); out.dayLevel = S.lightZones.map((z) => MapShared.zoneLevel(z, S.timeOfDay));
    document.querySelector('#timeSwitch button[data-time="night"]').click(); await wait(600);
    out.night = wash(); out.nightLevel = S.lightZones.map((z) => MapShared.zoneLevel(z, S.timeOfDay)); out.url = S.url.split('/').pop(); out.pressed = document.querySelector('#timeSwitch button[data-time="night"]').getAttribute('aria-pressed');
    document.querySelector('#timeSwitch button[data-time="dusk"]').click(); await wait(400); out.duskLevel = MapShared.zoneLevel(S.lightZones[0], S.timeOfDay);
    document.querySelector('#timeSwitch button[data-time="day"]').click(); await wait(400); out.back = S.timeOfDay;
    return out;
  })()`);
  assert.equal(r.day, null, 'no wash by day'); assert.deepEqual(r.dayLevel, ['bright', 'dark']);
  assert.ok(r.night && r.night.yard > 80 && r.night.open > 80 && r.night.vault === 0, 'at night the picture and the time zone are washed, the fixed dark zone is left alone: ' + JSON.stringify(r)); assert.deepEqual(r.nightLevel, ['dark', 'dark']);
  assert.equal(r.url, 'vtt-crypt-method-b.png', 'a place with no Night look stays on its picture'); assert.equal(r.pressed, 'true'); assert.equal(r.duskLevel, 'dim'); assert.equal(r.back, 'day');
});

test('DM view of a town or regional map: Show Places draws the places, gold as the players see them where they know them and red where they do not yet; the sidebar and the map switch are one', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/dnd-sword-coast-ours.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    localStorage.removeItem('vtt.showPlaces');
    S.starts = [{ name: 'start', x: 100, y: 100 }, { name: 'known-town', x: 400, y: 400, known: true }, { name: 'secret-keep', x: 700, y: 400 }, { name: 'hidden-lair', x: 400, y: 900, known: true, dmOnly: true }];
    S.showPins = true; $ = (q) => document.querySelector(q);
    document.querySelector('#viewSwitch button[data-view="dm"]').click(); await wait(300);
    const cv = document.querySelector('canvas'), x = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const colour = (wx, wy) => { const d = x.getImageData(Math.round((S.view.ox + wx * S.view.scale + 3) * dpr), Math.round((S.view.oy + wy * S.view.scale) * dpr), 1, 1).data; const near = (c, t, e) => Math.abs(c - t) <= e; return near(d[0], 255, 10) && near(d[1], 90, 14) && near(d[2], 90, 14) ? 'red' : near(d[0], 240, 14) && near(d[1], 192, 14) && near(d[2], 72, 16) ? 'gold' : 'other'; };       // the exact dot colours
    const side = $('#showPlacesSide'), canvasBox = $('#showPlaces');
    out.sideVisible = !$('#showPlacesSideRow').hidden; out.sideOn = side.checked;
    side.dispatchEvent(new Event('change')); await wait(300);
    out.on = [colour(400, 400), colour(700, 400), colour(400, 900)];
    side.checked = false; side.dispatchEvent(new Event('change')); await wait(300);
    out.off = [colour(400, 400), colour(700, 400), colour(400, 900)]; out.canvasBoxFollows = canvasBox.checked;
    canvasBox.checked = true; canvasBox.dispatchEvent(new Event('change')); await wait(300);
    out.sideFollows = side.checked; out.onAgain = colour(400, 400);
    return out;
  })()`);
  assert.equal(r.sideVisible, true, 'the switch is in Fog and sight on a regional map'); assert.equal(r.sideOn, true);
  assert.deepEqual(r.on, ['gold', 'red', 'red'], 'known places look as the players see them (gold), unknown (and DM-only) places red: ' + JSON.stringify(r));
  assert.ok(r.off.every((c) => c === 'other'), 'with the switch off no place is drawn: ' + JSON.stringify(r.off)); assert.equal(r.canvasBoxFollows, false, 'the map switch follows the sidebar one');
  assert.equal(r.sideFollows, true); assert.equal(r.onAgain, 'gold');
});

test('Show pins is the master switch and each type of pin has its own: Start, Areas and Locations on a battle map, Places on a town or regional map', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/vtt-crypt-method-b.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    S.starts = [{ name: 'start', x: 300, y: 300 }, { name: 'area-1', x: 600, y: 300 }, { name: 'rest-area', x: 900, y: 300 }];
    S.selected = null; document.querySelector('button.tool[data-tool="token"]').click(); S.tokens = []; document.querySelector('#showPins').checked = true; S.showPins = true;
    window.mapTest.syncPinTypeBox();
    const cv = document.querySelector('canvas'), x = cv.getContext('2d'), dpr = cv.width / cv.getBoundingClientRect().width;
    const dot = (wx, wy) => { const d = x.getImageData(Math.round((S.view.ox + wx * S.view.scale) * dpr), Math.round((S.view.oy + wy * S.view.scale) * dpr), 1, 1).data; return d[2] > 180 && d[0] < 140 ? 'blue' : d[0] > 230 && d[1] > 230 && d[2] > 230 ? 'white' : 'other'; };
    const shown = () => ({ start: dot(300, 300), area: dot(600, 300), location: dot(900, 300) });
    const box = (t) => document.querySelector('#pinTypeBox input[data-pintype="' + t + '"]');
    const set = async (t, on) => { box(t).checked = on; box(t).dispatchEvent(new Event('change')); await wait(250); };
    await wait(300);
    out.boxes = [...document.querySelectorAll('#pinTypeBox label')].filter((l) => !l.hidden).map((l) => l.textContent.trim());
    out.all = shown();
    await set('areas', false); out.noAreas = shown(); await set('areas', true);
    await set('locations', false); out.noLocations = shown(); await set('locations', true);
    await set('start', false); out.noStart = shown(); await set('start', true);
    document.querySelector('#showPins').checked = false; document.querySelector('#showPins').dispatchEvent(new Event('change')); await wait(250); out.master = shown();
    return out;
  })()`);
  assert.deepEqual(r.boxes, ['Show Start', 'Show Areas', 'Show Locations'], JSON.stringify(r));
  assert.deepEqual(r.all, { start: 'white', area: 'blue', location: 'blue' }, JSON.stringify(r));
  assert.deepEqual(r.noAreas, { start: 'white', area: 'other', location: 'blue' }); assert.deepEqual(r.noLocations, { start: 'white', area: 'blue', location: 'other' }); assert.deepEqual(r.noStart, { start: 'other', area: 'blue', location: 'blue' });
  assert.deepEqual(r.master, { start: 'other', area: 'other', location: 'other' }, 'Show pins off hides every type');
});

test('a town or regional map has no start location: the start pin is not drawn, not listed, not offered as a type, and a new pin is not called start', opts, async () => {
  await page.goto(`${server.base}/map-test.html?map=/uploads/dnd-sword-coast-ours.png`);
  await page.waitFor('document.querySelector("#banner").textContent.includes("px")');
  const r = await page.eval(`(async () => {
    const S = window.mapTest.state, out = {};
    S.starts = [{ name: 'start', x: 300, y: 300 }, { name: 'a-place', x: 600, y: 600, known: true }];
    window.mapTest.syncPinTypeBox();
    out.kind = S.kind; out.startBox = !document.querySelector('#pinTypeStart').hidden;
    out.listed = [...document.querySelectorAll('#startList input[type=text]')].map((i) => i.value);
    return out;
  })()`);
  assert.equal(r.kind, 'regional'); assert.equal(r.startBox, false, 'no Show Start on a regional or town map');
});
