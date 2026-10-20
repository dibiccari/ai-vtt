// A battle map layout as a text grid, and what the game needs from it: walls, doors, terrain, lights, start spots, a check that every part can be reached, and two drawings of it
// (an SVG for the person to look at and edit, a flat-colour PNG for the picture painter to draw around). Pure: no files, no network.
//
// The grid is one character per square (5 ft):
//   #  rock, a solid wall, a cliff, a tree line, deep water: nothing can enter, nothing can be seen through
//   .  floor
//   D  a doorway with a door in it (a floor square between two walls)
//   ~  shallow water (difficult terrain)      ,  rubble, mud or thick brush (difficult terrain)
//   O  a pillar, boulder or tree trunk standing on the floor (solid: blocks movement and sight)
//   L  a floor square with a torch, brazier or campfire (a light)
//   P  floor where the party starts           E  floor where the enemies start
// The edge of the grid is a wall. Everything is in grid units here (a square is 1 by 1); scaleTo() turns a layout into picture pixels.
import { Painter, encodePng } from './mapkit.js';

export const LEGEND = [
  ['#', 'rock or solid wall'], ['.', 'floor'], ['D', 'a door'], ['~', 'shallow water (difficult)'], [',', 'rubble or mud (difficult)'],
  ['O', 'a pillar, boulder or tree trunk'], ['L', 'a light (torch, brazier, campfire)'], ['P', 'where the party starts'], ['E', 'where the enemies start']
];
const KNOWN = new Set(LEGEND.map(([g]) => g));
export const LIMITS = { minCols: 8, minRows: 8, maxCols: 100, maxRows: 100 };

// The sizes a person picks from, all 3:2 (what the picture painters handle best), each compared with a map the game already has. Orientation 'portrait' turns them on their side.
export const SIZES = [
  { id: 'small', label: 'Small', cols: 30, rows: 20, like: 'a tavern (the Rusty Flagon)' },
  { id: 'medium', label: 'Medium', cols: 36, rows: 24, like: 'a cellar complex (the Dungeon Cellars)' },
  { id: 'large', label: 'Large', cols: 48, rows: 32, like: 'a small castle (Cragmaw Castle)' },
  { id: 'huge', label: 'Huge', cols: 60, rows: 40, like: 'a ruined town (Thundertree)' },
  { id: 'enormous', label: 'Enormous', cols: 96, rows: 64, like: 'a whole cave system (Wave Echo Cave)' }
];
export function sizeFor(id, orientation = 'landscape') {
  const s = SIZES.find((x) => x.id === id) || SIZES[0];
  return orientation === 'portrait' ? { ...s, cols: s.rows, rows: s.cols } : { ...s };
}

const SOLID = new Set(['#', 'O']);
const isWalkable = (g) => g !== undefined && !SOLID.has(g);

// Turns whatever came in (an array of strings, or one string with line breaks) into a clean rectangle of known characters, with a note for everything that had to be fixed.
export function parseGrid(input) {
  const problems = [];
  let lines = Array.isArray(input) ? input.map((l) => String(l ?? '')) : String(input ?? '').split(/\r?\n/);
  lines = lines.map((l) => l.replace(/\s+$/g, '')).filter((l, i, a) => l.length || (i > 0 && i < a.length - 1));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { cells: [], cols: 0, rows: 0, problems: [{ level: 'error', text: 'The layout is empty.' }] };
  const cols = Math.max(...lines.map((l) => l.length));
  if (lines.some((l) => l.length !== cols)) problems.push({ level: 'warn', text: `The rows were not all the same length; short ones were filled out with rock to ${cols} squares.` });
  const unknown = new Set();
  const cells = lines.map((l) => {
    let out = '';
    for (let i = 0; i < cols; i++) { const g = l[i] === undefined ? '#' : l[i]; if (KNOWN.has(g)) out += g; else { unknown.add(g); out += '.'; } }
    return out;
  });
  if (unknown.size) problems.push({ level: 'warn', text: `Unknown characters turned into floor: ${[...unknown].map((g) => JSON.stringify(g)).join(' ')}.` });
  if (cols < LIMITS.minCols || cells.length < LIMITS.minRows) problems.push({ level: 'error', text: `The map is ${cols} x ${cells.length} squares; the smallest is ${LIMITS.minCols} x ${LIMITS.minRows}.` });
  if (cols > LIMITS.maxCols || cells.length > LIMITS.maxRows) problems.push({ level: 'error', text: `The map is ${cols} x ${cells.length} squares; the largest is ${LIMITS.maxCols} x ${LIMITS.maxRows}.` });
  return { cells, cols, rows: cells.length, problems };
}

// Groups the walkable squares that cannot be reached from `from` ([col,row]) walking up, down, left and right. A door counts as walkable.
function unreachable(cells, cols, rows, from) {
  const seen = new Uint8Array(cols * rows), at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? undefined : cells[r][c]);
  const flood = (c0, r0) => {
    const out = [], stack = [[c0, r0]];
    seen[r0 * cols + c0] = 1;
    while (stack.length) {
      const [c, r] = stack.pop(); out.push([c, r]);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (isWalkable(at(nc, nr)) && !seen[nr * cols + nc]) { seen[nr * cols + nc] = 1; stack.push([nc, nr]); }
      }
    }
    return out;
  };
  flood(from[0], from[1]);
  const groups = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isWalkable(cells[r][c]) && !seen[r * cols + c]) groups.push(flood(c, r));
  return groups;
}

// Merges runs of unit edges that lie on one line into long segments. edges: [[line, from]] (one unit edge starts at `from` on that line).
function mergeEdges(edges, horizontal) {
  const byLine = new Map();
  for (const [line, from] of edges) { if (!byLine.has(line)) byLine.set(line, []); byLine.get(line).push(from); }
  const out = [];
  for (const [line, list] of byLine) {
    list.sort((a, b) => a - b);
    let start = list[0], prev = list[0];
    for (let i = 1; i <= list.length; i++) {
      if (i < list.length && list[i] === prev + 1) { prev = list[i]; continue; }
      out.push(horizontal ? { x1: start, y1: line, x2: prev + 1, y2: line } : { x1: line, y1: start, x2: line, y2: prev + 1 });
      if (i < list.length) { start = list[i]; prev = list[i]; }
    }
  }
  return out;
}

// Squares of one kind as the fewest rectangles: runs along each row, then runs with the same columns on consecutive rows joined into one taller rectangle.
function rectsOf(cells, cols, rows, glyph) {
  const done = [], open = new Map();
  for (let r = 0; r < rows; r++) {
    const runs = [];
    for (let c = 0; c < cols; c++) {
      if (cells[r][c] !== glyph) continue;
      let e = c; while (e + 1 < cols && cells[r][e + 1] === glyph) e++;
      runs.push([c, e]); c = e;
    }
    const next = new Map();
    for (const [a, b] of runs) {
      const key = a + ':' + b, up = open.get(key);
      if (up) { up.h += 1; next.set(key, up); open.delete(key); } else next.set(key, { x: a, y: r, w: b - a + 1, h: 1 });
    }
    for (const rect of open.values()) done.push(rect);
    open.clear(); for (const [k, v] of next) open.set(k, v);
  }
  for (const rect of open.values()) done.push(rect);
  return done;
}

// Works out everything the game needs from a grid. options.fix: small cut-off pockets (under 8 squares) are filled in with rock instead of being reported as errors.
export function compileLayout(input, { fix = true } = {}) {
  const parsed = parseGrid(input);
  const problems = [...parsed.problems];
  if (problems.some((p) => p.level === 'error')) return { ok: false, cols: parsed.cols, rows: parsed.rows, cells: parsed.cells, walls: [], lights: [], difficult: [], water: [], pins: [], problems };
  const { cols, rows } = parsed;
  let cells = parsed.cells.map((r) => r.split(''));
  const at = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? '#' : cells[r][c]);

  // Where the party starts, and a check that everything walkable can be reached from there.
  const find = (g) => { const out = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (cells[r][c] === g) out.push([c, r]); return out; };
  let party = find('P');
  const anyWalkable = () => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isWalkable(cells[r][c])) return [c, r]; return null; };
  const first = party[0] || anyWalkable();
  if (!first) { problems.push({ level: 'error', text: 'There is no floor at all.' }); return { ok: false, cols, rows, cells: cells.map((r) => r.join('')), walls: [], lights: [], difficult: [], water: [], pins: [], problems }; }
  if (!party.length) problems.push({ level: 'warn', text: 'No P (party start) was marked: the first floor square is used.' });
  for (const group of unreachable(cells.map((r) => r.join('')), cols, rows, first)) {
    const box = group.reduce((b, [c, r]) => ({ c0: Math.min(b.c0, c), c1: Math.max(b.c1, c), r0: Math.min(b.r0, r), r1: Math.max(b.r1, r) }), { c0: 99, c1: 0, r0: 99, r1: 0 });
    if (fix && group.length < 8) { for (const [c, r] of group) cells[r][c] = '#'; problems.push({ level: 'warn', text: `${group.length} cut-off squares near column ${box.c0 + 1}, row ${box.r0 + 1} were filled in with rock.` }); }
    else problems.push({ level: 'error', text: `${group.length} squares (columns ${box.c0 + 1} to ${box.c1 + 1}, rows ${box.r0 + 1} to ${box.r1 + 1}) cannot be reached from the party start: add a door or a passage.` });
  }
  party = find('P');

  // Walls: the edge between a walkable square and a solid one (the edge of the grid counts as solid), merged into long segments.
  const horiz = [], vert = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!isWalkable(cells[r][c])) continue;
    if (!isWalkable(at(c, r - 1))) horiz.push([r, c]);
    if (!isWalkable(at(c, r + 1))) horiz.push([r + 1, c]);
    if (!isWalkable(at(c - 1, r))) vert.push([c, r]);
    if (!isWalkable(at(c + 1, r))) vert.push([c + 1, r]);
  }
  const unique = (list) => [...new Map(list.map((e) => [e.join(','), e])).values()];
  const walls = [...mergeEdges(unique(horiz), true), ...mergeEdges(unique(vert), false)].map((w) => ({ ...w, type: 'wall', open: false }));

  // Doors: a segment across the middle of the doorway square, across the way through it.
  const doors = [];
  for (const [c, r] of find('D')) {
    const sideways = !isWalkable(at(c - 1, r)) && !isWalkable(at(c + 1, r)), lengthways = !isWalkable(at(c, r - 1)) && !isWalkable(at(c, r + 1));
    if (!sideways && !lengthways) problems.push({ level: 'warn', text: `The door at column ${c + 1}, row ${r + 1} is not between two walls.` });
    else if (sideways && (!isWalkable(at(c, r - 1)) || !isWalkable(at(c, r + 1)))) problems.push({ level: 'warn', text: `The door at column ${c + 1}, row ${r + 1} leads nowhere on one side.` });
    else if (lengthways && !sideways && (!isWalkable(at(c - 1, r)) || !isWalkable(at(c + 1, r)))) problems.push({ level: 'warn', text: `The door at column ${c + 1}, row ${r + 1} leads nowhere on one side.` });
    // The door lies across the passage: a passage that runs up and down (walls on its left and right) is crossed by a horizontal door.
    doors.push(sideways || !lengthways ? { x1: c, y1: r + 0.5, x2: c + 1, y2: r + 0.5, type: 'door', open: false } : { x1: c + 0.5, y1: r, x2: c + 0.5, y2: r + 1, type: 'door', open: false });
  }

  const lights = find('L').map(([c, r]) => ({ x: c + 0.5, y: r + 0.5, kind: 'torch', range: 6 }));
  const difficult = [...rectsOf(cells.map((r) => r.join('')), cols, rows, '~'), ...rectsOf(cells.map((r) => r.join('')), cols, rows, ',')];
  const water = rectsOf(cells.map((r) => r.join('')), cols, rows, '~');
  const centre = (list) => (list.length ? { x: list.reduce((s, [c]) => s + c + 0.5, 0) / list.length, y: list.reduce((s, [, r]) => s + r + 0.5, 0) / list.length } : null);
  const pins = [];
  const p = centre(party.length ? party : [first]); pins.push({ name: 'start', x: p.x, y: p.y });
  const e = centre(find('E')); if (e) pins.push({ name: 'enemy-start', x: e.x, y: e.y });

  const total = cols * rows, walkable = cells.flat().filter(isWalkable).length;
  if (walkable / total < 0.15) problems.push({ level: 'warn', text: `Only ${Math.round((walkable / total) * 100)} percent of the map is floor: it may be too cramped to fight in.` });
  if (!walls.length) problems.push({ level: 'warn', text: 'The layout has no walls at all.' });
  return { ok: !problems.some((q) => q.level === 'error'), cols, rows, cells: cells.map((r) => r.join('')), walls: [...walls, ...doors], lights, difficult, water, pins, problems, stats: { walkable, total, doors: doors.length, lights: lights.length } };
}

// The layout in picture pixels, in the shape the map configuration uses (walls and doors in one list, lights with their range in squares, difficult terrain as rectangles).
export function scaleTo(layout, width, height) {
  const kx = width / layout.cols, ky = height / layout.rows, r1 = (v) => Math.round(v * 100) / 100;
  return {
    squares: layout.cols,
    walls: layout.walls.map((w) => ({ ...w, x1: r1(w.x1 * kx), y1: r1(w.y1 * ky), x2: r1(w.x2 * kx), y2: r1(w.y2 * ky) })),
    lights: layout.lights.map((l) => ({ ...l, x: r1(l.x * kx), y: r1(l.y * ky) })),
    difficult: layout.difficult.map((d) => ({ x: r1(d.x * kx), y: r1(d.y * ky), w: r1(d.w * kx), h: r1(d.h * ky) })),
    starts: layout.pins.map((p) => ({ name: p.name, x: r1(p.x * kx), y: r1(p.y * ky) }))
  };
}

const COLOURS = { rock: '#1c1c20', floor: '#d6be96', water: '#4a6e96', rubble: '#a08c6e', wall: '#2b2724', pillar: '#6e6e73', door: '#7a5028', light: '#ffb347' };

// The layout as an SVG for the person to read: floor, water and rubble, thick walls, doors, pillars, lights and the two start spots, in groups with fixed ids so a tool can pick them apart.
export function layoutSvg(layout, { cell = 24 } = {}) {
  const W = layout.cols * cell, H = layout.rows * cell, f = (n) => Math.round(n * 100) / 100;
  const sq = (c, r, fill, extra = '') => `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${fill}"${extra}/>`;
  const layer = (id, body) => `<g id="${id}">${body}</g>`;
  let floor = '', water = '', rubble = '', pillars = '', starts = '';
  layout.cells.forEach((row, r) => [...row].forEach((g, c) => {
    if (isWalkable(g)) floor += sq(c, r, COLOURS.floor);
    if (g === '~') water += sq(c, r, COLOURS.water);
    if (g === ',') rubble += sq(c, r, COLOURS.rubble);
    if (g === 'O') pillars += `<circle cx="${f((c + 0.5) * cell)}" cy="${f((r + 0.5) * cell)}" r="${f(cell * 0.4)}" fill="${COLOURS.pillar}"/>`;
    if (g === 'P') starts += `<circle cx="${f((c + 0.5) * cell)}" cy="${f((r + 0.5) * cell)}" r="${f(cell * 0.3)}" fill="#3fa660" fill-opacity="0.8"/>`;
    if (g === 'E') starts += `<circle cx="${f((c + 0.5) * cell)}" cy="${f((r + 0.5) * cell)}" r="${f(cell * 0.3)}" fill="#c54b4b" fill-opacity="0.8"/>`;
  }));
  const line = (w, stroke, width, extra = '') => `<line x1="${f(w.x1 * cell)}" y1="${f(w.y1 * cell)}" x2="${f(w.x2 * cell)}" y2="${f(w.y2 * cell)}" stroke="${stroke}" stroke-width="${f(width)}" stroke-linecap="round"${extra}/>`;
  const walls = layout.walls.filter((w) => w.type === 'wall').map((w) => line(w, COLOURS.wall, cell * 0.16)).join('');
  const doors = layout.walls.filter((w) => w.type === 'door').map((w) => line(w, COLOURS.door, cell * 0.3, ' data-open="false"')).join('');
  const lights = layout.lights.map((l) => `<circle cx="${f(l.x * cell)}" cy="${f(l.y * cell)}" r="${f(cell * 0.22)}" fill="${COLOURS.light}" stroke="#7a4a00" stroke-width="1"/>`).join('');
  const grid = Array.from({ length: layout.cols - 1 }, (_, i) => `<line x1="${(i + 1) * cell}" y1="0" x2="${(i + 1) * cell}" y2="${H}"/>`).join('') + Array.from({ length: layout.rows - 1 }, (_, i) => `<line x1="0" y1="${(i + 1) * cell}" x2="${W}" y2="${(i + 1) * cell}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-cols="${layout.cols}" data-rows="${layout.rows}">`
    + `<rect width="${W}" height="${H}" fill="${COLOURS.rock}"/>` + layer('floor', floor) + layer('water', water) + layer('rubble', rubble) + layer('grid', `<g stroke="#000" stroke-opacity="0.12" stroke-width="1">${grid}</g>`)
    + layer('walls', walls) + layer('pillars', pillars) + layer('doors', doors) + layer('lights', lights) + layer('starts', starts) + '</svg>';
}

// The layout as a flat-colour PNG at the size the picture will have: the drawing a painter is asked to keep (rock black, floor tan, water blue, doors brown, pillars grey, walls as dark bands).
export function layoutPng(layout, { width, height }) {
  const p = new Painter(width, height), kx = width / layout.cols, ky = height / layout.rows, rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  p.rect(0, 0, width, height, rgb(COLOURS.rock));
  layout.cells.forEach((row, r) => [...row].forEach((g, c) => {
    const x = Math.floor(c * kx), y = Math.floor(r * ky), w = Math.ceil(kx) + 1, h = Math.ceil(ky) + 1;
    if (isWalkable(g)) p.rect(x, y, w, h, rgb(g === '~' ? COLOURS.water : g === ',' ? COLOURS.rubble : COLOURS.floor));
  }));
  const band = Math.max(2, Math.min(kx, ky) * 0.09);
  for (const w of layout.walls) p.capsule(w.x1 * kx, w.y1 * ky, w.x2 * kx, w.y2 * ky, w.type === 'door' ? band * 1.5 : band, rgb(w.type === 'door' ? COLOURS.door : COLOURS.wall));
  layout.cells.forEach((row, r) => [...row].forEach((g, c) => { if (g === 'O') p.disc((c + 0.5) * kx, (r + 0.5) * ky, Math.min(kx, ky) * 0.4, rgb(COLOURS.pillar)); }));
  return encodePng(p.img, width, height);
}
