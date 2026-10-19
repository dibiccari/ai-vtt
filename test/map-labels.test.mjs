// The layout of map labels (public/js/map-labels.js): pure functions that place glyphs along a polyline and decide how visible a label is at a zoom.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/map-labels.js';
const ML = globalThis.MapLabels;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('path length and the point at a distance along a polyline', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }];
  near(ML.pathLength(pts), 30);
  const a = ML.pointAt(pts, 5); near(a.x, 5); near(a.y, 0); near(a.angle, 0);
  const b = ML.pointAt(pts, 20); near(b.x, 10); near(b.y, 10); near(b.angle, Math.PI / 2);
  const end = ML.pointAt(pts, 999); near(end.x, 10); near(end.y, 20);
  const start = ML.pointAt(pts, -5); near(start.x, 0);
});

test('text reads left to right: a path that runs leftwards is walked the other way', () => {
  const left = [{ x: 100, y: 0 }, { x: 0, y: 0 }];
  assert.deepEqual(ML.readable(left), [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  const right = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.equal(ML.readable(right), right);
  const lay = ML.layoutAlong(left, [10, 10, 10], 0);
  assert.ok(lay.glyphs[0].x < lay.glyphs[2].x, 'the first letter is on the left'); near(lay.glyphs[0].angle, 0);
});

test('glyphs are centred on a straight path, spaced by width and gap, and all turned along it', () => {
  const lay = ML.layoutAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }], [10, 20, 10], 5);
  near(lay.width, 50); near(lay.length, 100);
  assert.deepEqual(lay.glyphs.map((g) => Math.round(g.x * 100) / 100), [30, 50, 70], 'text of 50 starts at 25: centres at 25+5, 25+10+5+10+... ');
  lay.glyphs.forEach((g) => { near(g.y, 0); near(g.angle, 0); });
});

test('glyphs follow a bend: the angle changes with the path', () => {
  const lay = ML.layoutAlong([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 50 }], [10, 10, 10, 10, 10, 10, 10, 10, 10, 10], 0);
  const first = lay.glyphs[0], last = lay.glyphs[9];
  assert.ok(Math.abs(first.angle) < 0.2, 'flat at the start: ' + first.angle);
  assert.ok(last.angle > 0.6 && last.angle < Math.PI / 4 + 0.01, 'climbing 45 degrees at the end: ' + last.angle);
  for (let i = 1; i < lay.glyphs.length; i++) assert.ok(lay.glyphs[i].angle >= lay.glyphs[i - 1].angle - 1e-9, 'the angle never turns back');
});

test('a text longer than its path starts at the path start and the layout says so', () => {
  const lay = ML.layoutAlong([{ x: 0, y: 0 }, { x: 20, y: 0 }], [10, 10, 10, 10], 0);
  assert.ok(lay.width > lay.length); near(lay.glyphs[0].x, 5);
  assert.deepEqual(ML.layoutAlong([{ x: 1, y: 1 }], [5], 0).glyphs, [], 'a single point is no path');
});

test('a label with no path sits on a straight line through its position at its rotation', () => {
  const p = ML.straightPath(100, 200, 90, 40);
  near(p[0].x, 100); near(p[0].y, 180); near(p[1].x, 100); near(p[1].y, 220);
  const lay = ML.layoutAlong(ML.straightPath(0, 0, 60, 80), [40, 40], 0);
  near(lay.glyphs[0].angle, Math.PI / 3);
});

test('labels fade out when zoomed far in and are never smaller than a readable size on screen', () => {
  const R = ML.STYLE.region;
  assert.equal(ML.visibility('region', R.fadeFrom), 1);
  assert.equal(ML.visibility('region', R.fadeTo), 0);
  const half = ML.visibility('region', (R.fadeFrom + R.fadeTo) / 2); assert.ok(half > 0.4 && half < 0.6);
  assert.ok(ML.visibility('region', 1) === 1, 'small on screen: fully visible');
  const zoomedOut = 1 / 0.1;                                              // one screen pixel is ten drawing pixels
  near(ML.drawSize({ kind: 'region', size: 20 }, zoomedOut), R.minScreen * zoomedOut);
  near(ML.drawSize({ kind: 'region', size: 20 }, 0.5), 20);
  near(ML.drawSize({ kind: 'trail' }, 0.01), ML.STYLE.trail.size);
});

test('the Show labels switch only applies to regional maps and is on by default', () => {
  assert.equal(ML.appliesTo('regional'), true);
  for (const k of ['battle', 'camp', 'town']) assert.equal(ML.appliesTo(k), false);
  assert.equal(ML.enabled(), true, 'with no browser storage the labels are on');
});
