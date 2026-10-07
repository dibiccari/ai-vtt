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

test('no page errors in Map Test', opts, () => { assert.deepEqual(page.problems, []); });
