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
  const crypt = await look('/uploads/vtt-crypt-method-b.png');
  assert.deepEqual(crypt.day, [['Day', true, 'true'], ['Night', false, 'false']], 'a map with no night look has no Night button');
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
  const a = await page.eval(wallDrag(300, 300, 500, 300));
  assert.equal(a.n, 1, 'a drag on empty ground draws a wall'); assert.ok(a.sel, 'the new wall is selected');
  const b = await page.eval(wallDrag(400, 200, 400, 400));
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
      res[k] = { fog: document.querySelector('#fog').closest('label').hidden, token: document.querySelector('button.tool[data-tool="token"]').hidden, reset: document.querySelector('#resetFogBtn').hidden, light: document.querySelector('#lightBox').hidden };
    }
    return res;
  })()`);
  for (const k of ['town', 'regional']) assert.deepEqual(out[k], { fog: true, token: true, reset: true, light: true }, k + ' hides them: ' + JSON.stringify(out));
  assert.deepEqual(out.battle, { fog: false, token: false, reset: false, light: false }, 'a battle map shows them: ' + JSON.stringify(out));
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

test('Show places: in the Player view of a regional map the named places are drawn and a switch (shared with the tabletop) turns them off; the DM view has no switch; a pin can be hidden from players', opts, async () => {
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
  assert.equal(r.kind, 'regional'); assert.equal(r.dmSwitch, false, 'the DM view has no places switch'); assert.equal(r.playerSwitch, true); assert.equal(r.playerOn, true);
  assert.ok(r.drawn >= 10, 'the named places are drawn'); assert.equal(r.drawnOff, -1, 'switched off: nothing is drawn'); assert.equal(r.stored, '0'); assert.equal(r.drawnOn, r.drawn);
  assert.equal(r.afterHide, r.total - 1, 'a pin marked Hide from players is not drawn'); assert.equal(r.dmAgain, false);
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
  assert.equal(r.boxShown, true); assert.equal(r.afterDelete.length, r.before.length - 1); assert.ok(r.afterAdd.some((x) => /^lantern-1:lantern/.test(x))); assert.equal(r.playerBox, false, 'the players never see the lights list');
  const saved = (await server.get('/api/map-config?map=vtt-terrain-test.png')).json.config.lights;
  assert.equal(saved.length, r.before.length, 'one deleted, one added'); assert.ok(saved.some((l) => l.kind === 'lantern' && l.name === 'lantern-1'));
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
    const ptr = (type, wx, wy) => cv.dispatchEvent(new PointerEvent(type, { clientX: b.left + S.view.ox + wx * S.view.scale, clientY: b.top + S.view.oy + wy * S.view.scale, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true }));
    const draw = async (kind, x1, y1, x2, y2) => { const sel = document.querySelector('#wallDrawType'); sel.value = kind; sel.dispatchEvent(new Event('change')); const n = S.walls.length;
      ptr('pointerdown', x1, y1); for (let i = 1; i <= 8; i++) ptr('pointermove', x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8); ptr('pointerup', x2, y2); await wait(250); return S.walls.slice(n).map((w) => w.type); };
    out.fence = await draw('fence', 200, 1200, 600, 1200);
    out.door = await draw('door', 200, 1250, 260, 1250);
    out.wall = await draw('wall', 200, 1300, 600, 1300);
    return out;
  })()`);
  assert.ok(r.fence.length >= 1 && r.fence.every((t) => t === 'fence'), 'fence: ' + r.fence); assert.ok(r.door.every((t) => t === 'door'), 'door: ' + r.door); assert.ok(r.wall.every((t) => t === 'wall'), 'wall: ' + r.wall);
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
