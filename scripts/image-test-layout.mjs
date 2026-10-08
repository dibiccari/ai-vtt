// Locked-layout image test: draws one simple wall layout of an inn (walls as thick stone bands, a door gap, furniture), writes its walls and doors as JSON for the page's overlay, and has the image
// editor repaint the SAME drawing at low, medium and high quality, so only the finish differs and not the composition. Costs about $0.35 with gpt-image-1.
// Usage: node scripts/image-test-layout.mjs [--draw-only]
import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Painter, encodePng } from '../lib/mapkit.js';
import { imageSettings } from '../lib/image-settings.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public', 'scenarios', 'compare', 'image-test');
const W = 1536, H = 1024, WALL = 24;          // a wall band is about half a square (a square is 51.2 px)
const P = new Painter(W, H);
const GRASS = [58, 84, 46], WATER = [52, 96, 112], FLOOR = [190, 164, 120], STONE = [92, 88, 82], WOOD = [128, 88, 52], DARK = [38, 34, 30], DOOR = [150, 98, 50];

// The walls, as centre lines: every one is drawn as a band WALL px thick, and the same lines are the overlay on the page.
const walls = [], doors = [];
const wall = (x1, y1, x2, y2) => walls.push({ x1, y1, x2, y2 });
const door = (x1, y1, x2, y2) => doors.push({ x1, y1, x2, y2 });
// the inn: x 120..1000, y 140..760; the kitchen: x 1000..1360, y 140..460
wall(120, 140, 1000, 140); wall(120, 140, 120, 760); wall(120, 760, 560, 760); wall(660, 760, 1000, 760); wall(1000, 460, 1000, 760);
door(560, 760, 660, 760);
wall(1000, 140, 1360, 140); wall(1360, 140, 1360, 460); wall(1000, 460, 1360, 460); wall(1000, 140, 1000, 300); wall(1000, 360, 1000, 460);
door(1000, 300, 1000, 360);
// the riverside: grass in the south-west, water in the south-east, a jetty
P.fillWith(() => GRASS);
P.rect(1010, 780, 526, 244, WATER);
P.rect(0, 800, 620, 224, [64, 92, 52]);
// floors
P.rect(120, 140, 880, 620, FLOOR); P.rect(1000, 140, 360, 320, [168, 148, 112]);
// planks
for (let y = 150; y < 760; y += 38) P.rect(120, y, 880, 2, [150, 126, 90], 0.6);
// walls and door gaps
const band = (s, col) => { const horiz = s.y1 === s.y2; P.rect(horiz ? Math.min(s.x1, s.x2) - WALL / 2 : s.x1 - WALL / 2, horiz ? s.y1 - WALL / 2 : Math.min(s.y1, s.y2) - WALL / 2, horiz ? Math.abs(s.x2 - s.x1) + WALL : WALL, horiz ? WALL : Math.abs(s.y2 - s.y1) + WALL, col); };
for (const w of walls) band(w, STONE);
for (const d of doors) band(d, DOOR);
// furniture: the bar along the west wall, six tables, a fireplace, a stair, the kitchen block, the jetty and a boat
P.rect(150, 220, 70, 380, [70, 48, 30]);                                  // bar counter
P.rect(380, 150, 260, 60, DARK);                                           // fireplace
for (const [x, y] of [[360, 330], [560, 300], [780, 330], [360, 560], [600, 560], [850, 520]]) P.disc(x, y, 46, WOOD);
P.rect(880, 160, 100, 200, [110, 84, 52]);                                // stair
for (let y = 170; y < 360; y += 22) P.rect(880, y, 100, 3, [70, 52, 34]);
P.rect(1080, 200, 220, 70, [100, 74, 46]);                                // kitchen worktable
P.rect(1240, 340, 90, 90, [110, 84, 52]);                                 // barrels and sacks
P.rect(560, 790, 90, 230, [118, 84, 50]);                                 // a jetty into the river
P.ellipse(1180, 900, 120, 40, 0, [140, 100, 60]);                         // a moored boat
const png = encodePng(P.img, W, H);
writeFileSync(path.join(dir, 'layout.png'), png);
writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ size: [W, H], wall: WALL, walls, doors }));
console.log('layout drawn');
if (process.argv.includes('--draw-only')) process.exit(0);

const prompt = `Repaint this flat layout drawing as a richly detailed, hand-painted STRICTLY OVERHEAD (bird's-eye, looking straight down, no perspective, no side views) fantasy battle map of the common room of a lantern-lit riverside inn at dusk. KEEP THE LAYOUT EXACTLY: every wall, door gap, table, bar, stair and shape stays precisely where it is, with the same size; do not move, add, remove or redraw any of them. The grey bands are thick stone-and-timber walls, the brown gap in the south wall is the doorway with a heavy double door, the dark block is a fieldstone fireplace with glowing embers, the long brown block on the west is a bar counter with kegs, the round brown shapes are wooden tables with stools and tankards, the striped block is a wooden staircase, the right-hand room is a kitchen with a worktable, sacks and barrels, the brown strip in the south is a wooden jetty over the river and the oval is a moored boat. The floor is worn wooden planks with scratches, rushes and straw. Warm amber lamplight and cool blue dusk. Hand-painted fantasy battle map style with confident dark ink outlines and soft painted shading, crisp and readable at tabletop scale. No grid lines, no graph paper, no text, no letters, no people.`;
writeFileSync(path.join(dir, 'layout-prompt.txt'), prompt + '\n');
const results = { model: imageSettings(root).model, size: '1536x1024', at: new Date().toISOString(), runs: [] };
for (const quality of ['low', 'medium', 'high']) {
  const out = path.join(dir, `locked-${quality}.png`);
  const t0 = Date.now();
  let log = '', ok = true;
  try { log = execFileSync('node', [path.join(root, 'scripts', 'openai-repaint.mjs'), '--in', path.join(dir, 'layout.png'), '--prompt-file', path.join(dir, 'layout-prompt.txt'), '--out', out, '--size', '1536x1024', '--quality', quality, '--fidelity', 'high'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) { ok = false; log = String(err.stderr || err.message).trim(); }
  const run = { quality, ok, seconds: Math.round((Date.now() - t0) / 1000), log: log.trim().split('\n').pop() };
  if (ok) run.bytes = statSync(out).size;
  results.runs.push(run);
  console.log(quality, ok ? 'ok' : 'FAILED', run.log);
  writeFileSync(path.join(dir, 'locked-results.json'), JSON.stringify(results, null, 2));
  if (!ok) break;
}
