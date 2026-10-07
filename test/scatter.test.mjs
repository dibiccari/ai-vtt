// Creatures asked for on one square (a pin) are spread around it: pure helper TokenSize.scatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/token-size.js';

const TS = globalThis.TokenSize;
const free = (taken, w = 40, h = 40, wall) => (c, r) => c >= 0 && r >= 0 && c < w && r < h && !taken.some((t) => t.col === c && t.row === r) && !(wall && wall(c, r));

test('a group asked for on one square is spread over distinct squares near it', () => {
  const taken = [];
  const spots = [];
  for (const id of ['gob-1', 'gob-2', 'gob-3', 'gob-4', 'gob-5']) {
    const p = TS.scatter({ col: 20, row: 20, n: 1, id, taken, fits: free(taken) });
    assert.ok(p, 'there is room');
    taken.push({ col: p.col, row: p.row, n: 1 }); spots.push(p);
  }
  assert.equal(new Set(spots.map((p) => p.col + ',' + p.row)).size, 5, 'every creature has its own square');
  for (const p of spots) assert.ok(Math.max(Math.abs(p.col - 20), Math.abs(p.row - 20)) <= 4, 'within a few squares of the pin');
  const rows = new Set(spots.map((p) => p.row)), cols = new Set(spots.map((p) => p.col));
  assert.ok(rows.size > 1 && cols.size > 1, 'not a tidy line');
});

test('the choice is repeatable for the same creature and differs between creatures', () => {
  const a1 = TS.scatter({ col: 10, row: 10, n: 1, id: 'goblin-a', taken: [], fits: free([]) });
  const a2 = TS.scatter({ col: 10, row: 10, n: 1, id: 'goblin-a', taken: [], fits: free([]) });
  assert.deepEqual(a1, a2);
  const others = ['b', 'c', 'd', 'e', 'f', 'g'].map((k) => TS.scatter({ col: 10, row: 10, n: 1, id: 'goblin-' + k, taken: [], fits: free([]) }));
  assert.ok(new Set(others.map((p) => p.col + ',' + p.row)).size > 2, 'different creatures land on different squares');
});

test('walls and the map edge are respected, and a crowd widens the area', () => {
  const wallRight = (c) => c > 20;                       // everything right of column 20 is walled off
  for (let i = 0; i < 12; i++) {
    const p = TS.scatter({ col: 20, row: 20, n: 1, id: 'w' + i, taken: [], fits: free([], 40, 40, wallRight) });
    assert.ok(p.col <= 20, 'never on the far side of the wall');
  }
  const corner = TS.scatter({ col: 0, row: 0, n: 1, id: 'edge', taken: [], fits: free([]) });
  assert.ok(corner.col >= 0 && corner.row >= 0);
  const crowd = []; for (let i = 0; i < 20; i++) crowd.push({ col: 20 + (i % 5) - 2, row: 20 + Math.floor(i / 5) - 2, n: 1 });
  const out = TS.scatter({ col: 20, row: 20, n: 1, id: 'late', taken: crowd, fits: free(crowd) });
  assert.ok(out && Math.max(Math.abs(out.col - 20), Math.abs(out.row - 20)) >= 3, 'with the middle full the next one goes further out');
});

test('big creatures need room for the whole footprint, and a full map gives null', () => {
  const fits2 = (c, r) => c >= 0 && r >= 0 && c + 1 < 40 && r + 1 < 40;
  const big = TS.scatter({ col: 5, row: 5, n: 2, id: 'ogre', taken: [], fits: fits2 });
  assert.ok(big);
  assert.equal(TS.scatter({ col: 5, row: 5, n: 1, id: 'x', taken: [], fits: () => false }), null);
});
