// The text-grid layout of a battle map (lib/map-layout.js): walls, doors, terrain, lights, starts, reachability, and the two drawings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGrid, compileLayout, scaleTo, layoutSvg, layoutPng, LEGEND, SIZES, LIMITS, sizeFor } from '../lib/map-layout.js';

const ROOMS = [
  '##########',
  '#P.......#',
  '#........#',
  '######D###',
  '#........#',
  '#..L...E.#',
  '#..O.....#',
  '##########'
];
const errors = (l) => l.problems.filter((p) => p.level === 'error');

test('a small dungeon compiles: two rooms joined by a door, a light, a pillar and both start spots', () => {
  const l = compileLayout(ROOMS);
  assert.equal(l.ok, true, JSON.stringify(l.problems));
  assert.deepEqual([l.cols, l.rows], [10, 8]);
  const doors = l.walls.filter((w) => w.type === 'door');
  assert.deepEqual(doors, [{ x1: 6, y1: 3.5, x2: 7, y2: 3.5, type: 'door', open: false }], 'one door across the doorway, in the middle of its square');
  assert.deepEqual(l.lights, [{ x: 3.5, y: 5.5, kind: 'torch', range: 6 }]);
  assert.deepEqual(l.pins.map((p) => [p.name, p.x, p.y]), [['start', 1.5, 1.5], ['enemy-start', 7.5, 5.5]]);
  assert.ok(l.walls.filter((w) => w.type === 'wall').length >= 10, 'the rooms are walled');
  assert.equal(l.stats.doors, 1);
});

test('walls are merged into long segments, and a pillar becomes a closed ring of four', () => {
  const open = compileLayout(['........', '........', '........', '........', '........', '........', '........', '........']);
  assert.deepEqual(open.walls.map((w) => [w.x1, w.y1, w.x2, w.y2]).sort(), [[0, 0, 0, 8], [0, 0, 8, 0], [0, 8, 8, 8], [8, 0, 8, 8]], 'the edge of the grid is a wall: four long segments');
  const pillar = compileLayout(['........', '........', '........', '...O....', '........', '........', '........', '........']);
  assert.equal(pillar.walls.length, 8, 'four outer walls and four around the pillar');
  const ring = pillar.walls.filter((w) => w.x1 >= 3 && w.x2 <= 4 && w.y1 >= 3 && w.y2 <= 4);
  assert.equal(ring.length, 4);
});

test('shallow water and rubble are difficult terrain, joined into the fewest rectangles', () => {
  const l = compileLayout(['........', '.~~.....', '.~~..,,.', '........', '........', '........', '........', '........']);
  assert.deepEqual(l.difficult.find((d) => d.x === 1), { x: 1, y: 1, w: 2, h: 2 }, 'a 2 by 2 pool is one rectangle');
  assert.deepEqual(l.difficult.find((d) => d.x === 5), { x: 5, y: 2, w: 2, h: 1 });
  assert.deepEqual(l.water, [{ x: 1, y: 1, w: 2, h: 2 }]);
});

test('a room nothing connects to is an error; a tiny cut-off pocket is filled in; both are said', () => {
  const lost = compileLayout(['##########', '#P.......#', '#........#', '##########', '#........#', '#........#', '#........#', '##########']);
  assert.equal(lost.ok, false);
  assert.match(errors(lost)[0].text, /cannot be reached from the party start/);
  assert.match(errors(lost)[0].text, /rows 5 to 7/);
  const pocket = compileLayout(['##########', '#P.......#', '#.#####..#', '#.#..#...#', '#.#####..#', '#........#', '#........#', '##########']);
  assert.equal(pocket.ok, true, JSON.stringify(pocket.problems));
  assert.match(pocket.problems.map((p) => p.text).join(' '), /cut-off squares .* filled in with rock/);
  assert.equal(pocket.cells[3][3], '#');
  const kept = compileLayout(['##########', '#P.......#', '#.#####..#', '#.#..#...#', '#.#####..#', '#........#', '#........#', '##########'], { fix: false });
  assert.equal(kept.ok, false, 'with fixing off the pocket is reported, not filled');
});

test('doors: across the way through a passage, and warnings for a door between nothing', () => {
  const sideways = compileLayout(['#####.###', '#####.###', '#####D###', '#........', '#########', '#########', '#########', '#########']);
  const d = sideways.walls.find((w) => w.type === 'door');
  assert.deepEqual([d.x1, d.y1, d.x2, d.y2], [5, 2.5, 6, 2.5], 'a passage that runs up and down is closed by a horizontal door');
  const lengthways = compileLayout(['#########', '#########', '#########', '#..D....#', '#########', '#########', '#########', '#########']);
  const v = lengthways.walls.find((w) => w.type === 'door');
  assert.deepEqual([v.x1, v.y1, v.x2, v.y2], [3.5, 3, 3.5, 4], 'a passage that runs left and right is closed by a vertical door');
  const open = compileLayout(['........', '........', '...D....', '........', '........', '........', '........', '........']);
  assert.match(open.problems.map((p) => p.text).join(' '), /not between two walls/);
});

test('bad input: ragged rows are filled out, strange characters become floor, too small and too big are errors, and a string with line breaks works', () => {
  const ragged = parseGrid(['#########', '#P.....#', '#.....', '#########', '#########', '#########', '#########', '#########']);
  assert.equal(ragged.cols, 9); assert.ok(ragged.cells.every((r) => r.length === 9)); assert.match(ragged.problems[0].text, /not all the same length/);
  const odd = parseGrid(ROOMS.map((r, i) => (i === 1 ? r.replace('.', 'X') : r)));
  assert.ok(odd.problems.some((p) => /Unknown characters/.test(p.text))); assert.equal(odd.cells[1][2], '.');
  assert.match(errors(parseGrid(['####', '#P.#', '####']))[0].text, /smallest is 8 x 8/);
  assert.match(errors(parseGrid(Array(10).fill('#'.repeat(120))))[0].text, /largest is 100 x 100/);
  assert.equal(compileLayout(ROOMS.join('\n')).ok, true);
  assert.equal(compileLayout('').ok, false);
  assert.ok(LEGEND.length >= 9);
});

test('no party start is a warning (the first floor square is used); no floor at all is an error', () => {
  const l = compileLayout(ROOMS.map((r) => r.replace('P', '.')));
  assert.equal(l.ok, true); assert.match(l.problems.map((p) => p.text).join(' '), /No P/); assert.deepEqual([l.pins[0].x, l.pins[0].y], [1.5, 1.5]);
  assert.equal(compileLayout(Array(8).fill('########')).ok, false);
});

test('scaleTo puts the layout in picture pixels in the shape the map configuration uses', () => {
  const s = scaleTo(compileLayout(ROOMS), 1000, 800);
  assert.equal(s.squares, 10);
  assert.deepEqual(s.walls.find((w) => w.type === 'door'), { x1: 600, y1: 350, x2: 700, y2: 350, type: 'door', open: false });
  assert.deepEqual(s.lights[0], { x: 350, y: 550, kind: 'torch', range: 6 });
  assert.deepEqual(s.starts[0], { name: 'start', x: 150, y: 150 });
});

test('the SVG has fixed layer ids and the right size, and the PNG is a real picture of the asked size', () => {
  const l = compileLayout(ROOMS);
  const svg = layoutSvg(l, { cell: 20 });
  for (const id of ['floor', 'water', 'walls', 'pillars', 'doors', 'lights', 'starts']) assert.ok(svg.includes(`id="${id}"`), id);
  assert.match(svg, /viewBox="0 0 200 160"/); assert.match(svg, /data-cols="10"/); assert.match(svg, /data-open="false"/);
  const png = layoutPng(l, { width: 300, height: 240 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 300); assert.equal(png.readUInt32BE(20), 240);
});

test('five sizes, all 3:2, from a tavern to a cave system; portrait turns them on their side; every size is inside the limits', () => {
  assert.deepEqual(SIZES.map((s) => s.id), ['small', 'medium', 'large', 'huge', 'enormous']);
  assert.deepEqual([sizeFor('small').cols, sizeFor('small').rows], [30, 20], 'the Rusty Flagon');
  for (const s of SIZES) { assert.equal(s.cols * 2, s.rows * 3, s.id + ' is 3:2'); assert.ok(s.cols <= LIMITS.maxCols && s.rows <= LIMITS.maxRows); }
  assert.ok(sizeFor('enormous').cols * sizeFor('enormous').rows > 6000, 'about the area of Wave Echo Cave (70 x 90)');
  assert.deepEqual([sizeFor('large', 'portrait').cols, sizeFor('large', 'portrait').rows], [32, 48]);
  assert.equal(sizeFor('nonsense').id, 'small', 'an unknown size falls back to small');
  const big = compileLayout(Array.from({ length: 64 }, (_, r) => (r === 0 || r === 63 ? '#'.repeat(96) : '#' + (r === 1 ? 'P' : '.').padEnd(94, '.') + '#')));
  assert.equal(big.ok, true, JSON.stringify(big.problems)); assert.deepEqual([big.cols, big.rows], [96, 64]);
});

test('natural rock (%) gives curved walls: diagonal pieces and rounded corners; straight rock (#) stays square', () => {
  const cave = ['%%%%%%%%%%', '%%%....%%%', '%%......%%', '%%P.....%%', '%%%....%%%', '%%%%..%%%%', '%%%%%%%%%%', '%%%%%%%%%%'];
  const c = compileLayout(cave);
  assert.equal(c.ok, true, JSON.stringify(c.problems));
  const slanted = c.walls.filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2);
  assert.ok(slanted.length >= 8, 'the corners are cut into slanted pieces: ' + slanted.length);
  assert.ok(c.smooth.length > 0 && c.smooth.every((s) => s.pts.length === 4));
  assert.ok(c.smooth.some((s) => s.fill === 'rock') && c.smooth.some((s) => s.fill === 'floor'), 'corners are cut off and filled in');
  // the outline is one closed ring: every piece starts where the last ended
  const ring = c.walls; for (let i = 0; i < ring.length; i++) { const n = ring[(i + 1) % ring.length]; assert.ok(Math.hypot(ring[i].x2 - n.x1, ring[i].y2 - n.y1) < 1e-3, 'piece ' + i + ' does not meet the next'); }
  assert.match(layoutSvg(c), /id="smoothing"><polygon/);
  assert.ok(layoutPng(c, { width: 500, height: 400 }).length > 100);
  // the same room with straight walls has only straight pieces and no corner shapes
  const square = compileLayout(cave.map((r) => r.replace(/%/g, '#')));
  assert.ok(square.walls.every((w) => w.x1 === w.x2 || w.y1 === w.y2)); assert.equal(square.smooth.length, 0);
  // a curve stays within half a square of the squares it replaces, so the floor is still where the grid says it is
  for (const w of c.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { const cx = Math.round(x), cy = Math.round(y); assert.ok(Math.hypot(x - cx, y - cy) <= 0.5 + 1e-6, 'a point strays ' + x + ',' + y); }
});

test('doors, the map edge and # walls keep their square corners even beside natural rock', () => {
  const g = ['%%%%%%%%%%%%', '%..........%', '%..........%', '###D########', '#....P.....#', '#..........#', '############', '############'];
  const l = compileLayout(g);
  assert.equal(l.ok, true, JSON.stringify(l.problems));
  const door = l.walls.find((w) => w.type === 'door');
  assert.deepEqual([door.x1, door.x2, door.y1], [3, 4, 3.5]);
  const atDoor = l.walls.filter((w) => w.type === 'wall' && [w.x1, w.x2].some((x) => x === 3 || x === 4) && [w.y1, w.y2].some((y) => y === 3 || y === 4));
  assert.ok(atDoor.length >= 2 && atDoor.every((w) => w.x1 === w.x2 || w.y1 === w.y2), 'the wall pieces at the doorway are straight');
  assert.ok(l.walls.some((w) => w.type === 'wall' && w.y1 === 1 && w.y2 === 1), 'the top edge beside natural rock is a floor edge: only its corners are rounded');
});
