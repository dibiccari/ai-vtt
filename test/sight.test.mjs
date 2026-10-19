// Walls, rays and line of sight (public/js/sight.js), the code the tabletop and Map Test share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/sight.js';

const { castRay, visibilityPolygon, blockingWalls, sightWalls, flyerWalls, pointSegmentDistance } = globalThis.Sight;
const wall = (x1, y1, x2, y2, extra = {}) => ({ x1, y1, x2, y2, type: 'wall', open: false, ...extra });

test('a ray stops at the nearest wall and is Infinity when nothing is in the way', () => {
  const walls = [wall(100, -50, 100, 50), wall(200, -50, 200, 50)];
  assert.equal(castRay(0, 0, 1, 0, walls), 100);
  assert.equal(castRay(0, 0, -1, 0, walls), Infinity);
  assert.equal(castRay(0, 0, 0, 1, walls), Infinity, 'a ray running along nothing never hits');
});

test('doors, fences and windows: what stops movement and what stops sight', () => {
  const all = [wall(0, 0, 1, 0), wall(0, 1, 1, 1, { type: 'door', open: false }), wall(0, 2, 1, 2, { type: 'door', open: true }), wall(0, 3, 1, 3, { type: 'door', open: true, secret: true }),
    wall(0, 4, 1, 4, { type: 'fence' }), wall(0, 5, 1, 5, { type: 'window' }), wall(0, 6, 1, 6, { type: 'bars' })];
  const ys = (list) => list.map((w) => w.y1);
  assert.deepEqual(ys(blockingWalls(all)), [0, 1, 3, 4, 5, 6], 'an open door lets you through, but a secret door is a wall whatever its open flag says');
  assert.deepEqual(ys(sightWalls(all)), [0, 1, 3, 6], 'a fence or a window does not stop sight (bars do)');
  assert.deepEqual(ys(flyerWalls(all)), [0, 1, 3], 'a flyer also goes over bars');
});

test('the visibility polygon of a room is the room, a wall in the way cuts it, and an open door lets the view through', () => {
  const room = [wall(100, 100, 300, 100), wall(300, 100, 300, 300), wall(300, 300, 100, 300), wall(100, 300, 100, 100)];
  const poly = visibilityPolygon(200, 200, room, 1000, 1000);
  assert.ok(poly.length > 8);
  assert.ok(poly.every((p) => p.x >= 99.9 && p.x <= 300.1 && p.y >= 99.9 && p.y <= 300.1), 'the view stays inside the walls');
  const inside = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c; } return c; };
  assert.equal(inside(poly, 250, 250), true); assert.equal(inside(poly, 400, 200), false);
  const withDoor = room.map((w) => (w.x1 === 300 && w.y1 === 100 ? { ...w, type: 'door', open: false } : w));
  assert.equal(inside(visibilityPolygon(200, 200, sightWalls(withDoor), 1000, 1000), 250, 150), true);
  const opened = room.map((w) => (w.x1 === 300 && w.y1 === 100 ? { ...w, type: 'door', open: true } : w));
  assert.ok(visibilityPolygon(200, 200, sightWalls(opened), 1000, 1000).some((p) => p.x > 400), 'with the east wall an open door the view runs out through it');
  const fenced = room.map((w) => (w.x1 === 300 && w.y1 === 300 ? { ...w, type: 'fence' } : w));
  assert.equal(inside(visibilityPolygon(200, 200, sightWalls(fenced), 1000, 1000), 250, 350), true, 'the view goes through a fence');
});

test('distance from a point to a segment', () => {
  assert.equal(pointSegmentDistance(5, 3, wall(0, 0, 10, 0)), 3);
  assert.equal(pointSegmentDistance(-4, 3, wall(0, 0, 10, 0)), 5);
  assert.equal(pointSegmentDistance(1, 1, wall(2, 2, 2, 2)), Math.SQRT2);
});
