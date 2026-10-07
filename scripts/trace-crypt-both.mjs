// The "both" half of the crypt comparison: ChatGPT painted the picture (public/scenarios/compare/crypt-chatgpt.png); Claude read it with a pixel ruler (scripts/pixel-grid.mjs) and wrote down
// where the floor ends and the stone begins, the doors, the pillars and furniture and the lights, in image pixels. This script turns those readings into the map set-up
// (walls, doors, solid objects, lights, a start pin) for data/maps/vtt-crypt-both.png.json.
//   node scripts/trace-crypt-both.mjs
import { writeFile } from 'node:fs/promises';
import { ngon } from '../lib/mapkit.js';

const walls = [];
const seg = (x1, y1, x2, y2, type = 'wall') => walls.push({ x1, y1, x2, y2, type, open: false });
const poly = (pts) => pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; seg(a[0], a[1], b[0], b[1]); });
const rect = (x1, y1, x2, y2) => poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]]);
const oct = (cx, cy, r) => ngon(cx, cy, r, r, 8).forEach((a, i, arr) => { const b = arr[(i + 1) % arr.length]; seg(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)); });

// Entry hall (north-west) and its corridor to the chamber: the inner edge of the stone around the floor.
seg(155, 140, 445, 140); seg(445, 140, 445, 290); seg(445, 290, 594, 290); seg(594, 290, 594, 336); seg(594, 336, 631, 336);
seg(594, 410, 631, 410); seg(594, 410, 594, 428); seg(594, 428, 445, 428); seg(445, 428, 445, 520); seg(445, 520, 155, 520); seg(155, 520, 155, 140);
poly([[155, 306], [269, 306], [269, 222], [302, 222], [302, 347], [155, 347]]);              // the stone partition and the corner where the stairs go down
seg(612, 336, 612, 410, 'door');                                                              // the door between the hall and the chamber
// Pillared chamber (north)
seg(631, 104, 1374, 104); seg(1374, 104, 1374, 590); seg(631, 104, 631, 336); seg(631, 410, 631, 590);
seg(631, 590, 966, 590); seg(1050, 590, 1374, 590); seg(966, 590, 966, 634); seg(1050, 590, 1050, 634); seg(966, 612, 1050, 612, 'door');
for (const [x1, y1, x2, y2] of [[825, 172, 881, 311], [1139, 172, 1195, 314], [825, 375, 881, 533], [1139, 375, 1195, 533]]) rect(x1, y1, x2, y2);       // the four pillars
// Sarcophagus crypt (south-west)
seg(156, 632, 768, 632); seg(156, 632, 156, 920); seg(156, 920, 768, 920); seg(768, 632, 768, 726); seg(768, 802, 768, 920);
for (const [x1, y1, x2, y2] of [[222, 676, 385, 770], [461, 676, 622, 770], [222, 802, 385, 897], [460, 802, 622, 897]]) rect(x1, y1, x2, y2);          // the tombs
// Storeroom (south-east)
seg(805, 634, 966, 634); seg(1050, 634, 1378, 634); seg(1378, 634, 1378, 917); seg(805, 917, 966, 917); seg(1050, 917, 1378, 917);
seg(805, 634, 805, 726); seg(805, 802, 805, 917); seg(768, 726, 805, 726); seg(768, 802, 805, 802); seg(786, 726, 786, 802, 'door');
seg(966, 917, 966, 955); seg(1050, 917, 1050, 955); seg(966, 955, 1050, 955); seg(966, 936, 1050, 936, 'door');                                           // the way out, down steps
for (const [x1, y1, x2, y2] of [[1243, 655, 1315, 736], [1327, 670, 1374, 732], [1278, 758, 1351, 835], [1166, 833, 1262, 908]]) rect(x1, y1, x2, y2);   // crates and the chest
oct(1193, 720, 30); oct(1225, 758, 24); oct(1331, 879, 30);                                                                                              // barrels

const config = {
  squares: 30, light: 'dark', ambience: 'dungeon', mood: 'dungeon', source: 'dd2vtt',
  walls, starts: [{ name: 'start', x: 330, y: 450, radius: 2 }],
  lights: [{ x: 429, y: 190, range: 6, intensity: 1, color: 'ffffa24d', name: 'torch-1', flicker: true }, { x: 281, y: 413, range: 6, intensity: 1, color: 'ffffa24d', name: 'torch-2', flicker: true }, { x: 1008, y: 415, range: 8, intensity: 1, color: 'ffffa24d', name: 'brazier', flicker: true }],
  ambient: 'ff2a2630'
};
await writeFile('data/maps/vtt-crypt-both.png.json', JSON.stringify(config, null, 2));
console.log(`vtt-crypt-both.png.json: ${walls.filter((w) => w.type !== 'door').length} wall segments, ${walls.filter((w) => w.type === 'door').length} doors, ${config.lights.length} lights`);
