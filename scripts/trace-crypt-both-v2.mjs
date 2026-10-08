// The "both" half of the crypt comparison, second round (strictly overhead brief): ChatGPT painted public/scenarios/compare/crypt-chatgpt-v2.png; Claude read it with the pixel ruler
// (scripts/pixel-grid.mjs) and wrote down where floors end and stone begins, the doors, the objects and the lights, in image pixels; this turns them into data/maps/vtt-crypt-method-a.png.json.
//   node scripts/trace-crypt-both-v2.mjs
import { writeFile } from 'node:fs/promises';
import { ngon } from '../lib/mapkit.js';

const walls = [];
const seg = (x1, y1, x2, y2, type = 'wall') => walls.push({ x1, y1, x2, y2, type, open: false });
const poly = (pts) => pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; seg(a[0], a[1], b[0], b[1]); });
const rect = (x1, y1, x2, y2) => poly([[x1, y1], [x2, y1], [x2, y2], [x1, y2]]);
const oct = (cx, cy, r) => ngon(cx, cy, r, r, 8).forEach((a, i, arr) => { const b = arr[(i + 1) % arr.length]; seg(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)); });

// Entry hall (north-west), its door and the corridor to the chamber
seg(159, 112, 452, 112); seg(452, 112, 452, 205); seg(452, 325, 452, 484); seg(452, 484, 376, 484); seg(276, 484, 159, 484); seg(159, 484, 159, 112);
seg(452, 205, 641, 205); seg(452, 325, 641, 325); seg(471, 205, 471, 325, 'door');
seg(276, 484, 276, 520); seg(376, 484, 376, 520); seg(326, 502, 326, 502, 'wall'); walls.pop(); seg(276, 502, 376, 502, 'door');                 // the door in the hall's south wall opens into the crypt
oct(234, 184, 34); oct(300, 347, 31);                                                                                                                  // the hall's two pillars
// Pillared chamber (north)
seg(641, 108, 1333, 108); seg(1333, 108, 1333, 532); seg(641, 108, 641, 205); seg(641, 325, 641, 532); seg(641, 532, 945, 532); seg(1022, 532, 1333, 532);
rect(882, 150, 1058, 231); rect(1158, 153, 1226, 198);                                                                                                 // the altar and the half pillar
for (const [x, y] of [[759, 267], [1189, 270], [759, 439], [1189, 436]]) oct(x, y, 33);                                                                 // four pillars
// The way south from the chamber, the middle rooms
seg(945, 532, 945, 570); seg(1022, 532, 1022, 570); seg(945, 551, 1022, 551, 'door');
seg(787, 570, 945, 570); seg(1022, 570, 1090, 570); seg(787, 570, 787, 700); seg(1090, 570, 1090, 700); seg(787, 700, 937, 700); seg(1018, 700, 1090, 700);
seg(937, 700, 937, 742); seg(1018, 700, 1018, 742); seg(937, 721, 1018, 721, 'door');
seg(926, 742, 937, 742); seg(1018, 742, 1090, 742); seg(926, 742, 926, 912); seg(926, 912, 962, 912); seg(1057, 912, 1090, 912);
seg(962, 912, 962, 950); seg(1057, 912, 1057, 950); seg(962, 950, 1057, 950); seg(962, 931, 1057, 931, 'door');                                           // the exit down the steps
seg(1090, 742, 1090, 770); seg(1090, 838, 1090, 912); seg(1090, 770, 1123, 770); seg(1090, 838, 1123, 838); seg(1106, 770, 1106, 838, 'door');
// Sarcophagus crypt (south-west)
seg(229, 520, 276, 520); seg(376, 520, 749, 520); seg(229, 520, 229, 883); seg(229, 883, 749, 883); seg(749, 520, 749, 883);
for (const [x1, y1, x2, y2] of [[301, 601, 456, 672], [526, 601, 676, 672], [301, 742, 456, 812], [526, 740, 678, 814]]) rect(x1, y1, x2, y2);          // four tombs
// Storeroom (east)
seg(1123, 570, 1334, 570); seg(1334, 570, 1334, 914); seg(1123, 914, 1334, 914); seg(1123, 570, 1123, 770); seg(1123, 838, 1123, 914);
for (const [x1, y1, x2, y2] of [[1261, 595, 1316, 648], [1228, 667, 1269, 713], [1282, 717, 1320, 756], [1234, 787, 1308, 842]]) rect(x1, y1, x2, y2);       // crates and the chest
oct(1301, 683, 24); oct(1184, 871, 25); oct(1300, 880, 22);                                                                                            // barrels

const config = {
  squares: 30, light: 'dark', ambience: 'dungeon', mood: 'dungeon', source: 'dd2vtt',
  walls, starts: [{ name: 'start', x: 380, y: 420, radius: 2 }],
  lights: [{ x: 441, y: 263, range: 6, intensity: 1, color: 'ffffa24d', name: 'torch-1', flicker: true }, { x: 973, y: 336, range: 8, intensity: 1, color: 'ffffa24d', name: 'brazier', flicker: true }, { x: 1076, y: 817, range: 6, intensity: 1, color: 'ffffa24d', name: 'torch-2', flicker: true }],
  ambient: 'ff2a2630'
};
await writeFile('data/maps/vtt-crypt-method-a.png.json', JSON.stringify(config, null, 2));
console.log(`vtt-crypt-method-a.png.json: ${walls.filter((w) => w.type !== 'door').length} wall segments, ${walls.filter((w) => w.type === 'door').length} doors, ${config.lights.length} lights`);
