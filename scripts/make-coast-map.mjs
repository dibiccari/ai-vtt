// Draws OUR OWN Sword Coast regional map in code, in a bold-ink atlas style, with the same geography as the published map in public/uploads/dnd-northswordcoast-playerversion.jpg.
// Where things are comes from two places and nothing else: (1) data/map-layouts/coast-regions.json, a coarse grid of which blocks of the published picture are forest (scripts/read-coast-regions.mjs reads
// colour and texture only), and (2) the coastline, roads, rivers, hills, mountains and places written down below in the published picture's pixel coordinates (2648 x 3625), read by eye off ruler crops.
// No pixel of the published art is copied and nothing is sent anywhere. The picture has no text and no grid: names and the 5-mile hex overlay are drawn on top by public/coast.html.
//   node scripts/make-coast-map.mjs [out.png] [scale 0.5]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Painter, rng, fbm, vnoise, hash, clamp, mix, tint, shade, encodePng, pointInPoly } from '../lib/mapkit.js';

const out = process.argv[2] || 'public/scenarios/compare/coast/coast-ours.png';
const SC = Number(process.argv[3]) || 0.5;
const OW = 2648, OH = 3625, W = Math.round(OW * SC), H = Math.round(OH * SC);
const R = rng(20261113);
const p = new Painter(W, H);
const S = (v) => v * SC;
const pts = (list) => list.map(([x, y]) => ({ x: S(x), y: S(y) }));
const INK = [38, 34, 30];
const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
function spline(list, per = 10) {
  const q = list.map(([x, y]) => [S(x), S(y)]), res = [];
  for (let i = 0; i < q.length - 1; i++) {
    const a = q[Math.max(0, i - 1)], b = q[i], c = q[i + 1], d = q[Math.min(q.length - 1, i + 2)];
    for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t; res.push([0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3), 0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3)]); }
  }
  res.push(q[q.length - 1]); return res;
}
const stroke = (line, r, col, a = 1) => { for (let i = 0; i < line.length - 1; i++) p.capsule(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], r, col, a); };

/* ---------------- what is where (published picture's pixels) ---------------- */
const COAST = [[75, 470], [150, 520], [190, 640], [255, 860], [300, 1150], [330, 1300], [400, 1420], [470, 1520], [520, 1640], [560, 1730], [555, 1800], [600, 1900], [670, 2000], [700, 2200], [715, 2400], [780, 2520], [785, 2700], [843, 2800], [885, 3000], [830, 3100], [835, 3200], [870, 3300], [900, 3400], [925, 3570]];
const coast = spline(COAST, 8);
const coastX = (y) => { for (let i = 0; i < coast.length - 1; i++) if (coast[i][1] <= y && coast[i + 1][1] >= y) { const t = (y - coast[i][1]) / ((coast[i + 1][1] - coast[i][1]) || 1); return coast[i][0] + (coast[i + 1][0] - coast[i][0]) * t; } return y < coast[0][1] ? -1 : S(925); };
const roads = {
  high: spline([[130, 100], [160, 200], [230, 330], [290, 500], [310, 700], [325, 900], [350, 1100], [400, 1200], [470, 1415], [557, 1570], [571, 1693], [577, 1750], [628, 1885], [743, 2015], [886, 2185], [985, 2330], [1030, 2430], [1014, 2543], [1036, 2757], [1054, 2970], [1100, 3140], [1186, 3257], [1293, 3314], [1435, 3400], [1607, 3543]], 10)
};
const trails = [
  spline([[2222, 1924], [2050, 2043], [1907, 2143], [1793, 2257], [1664, 2357], [1579, 2457], [1464, 2557], [1393, 2586], [1250, 2657], [1057, 2686]], 10),
  spline([[1400, 2579], [1450, 2680], [1514, 2814]], 8),
  spline([[2222, 1924], [2300, 1910], [2400, 1925], [2500, 1980], [2564, 2010]], 8)
];
const rivers = [
  spline([[577, 1750], [686, 1743], [800, 1771], [857, 1714], [914, 1743], [971, 1700], [1086, 1629], [1214, 1614], [1400, 1585]], 10),
  spline([[880, 1000], [1050, 1030], [1200, 1080], [1360, 1140], [1520, 1200], [1760, 1330], [1960, 1480], [2120, 1520], [2340, 1500]], 10),
  spline([[1200, 1240], [1380, 1290], [1560, 1360], [1700, 1440], [1720, 1520]], 10),
  spline([[1440, 800], [1380, 920], [1300, 1020], [1220, 1090]], 10),
  spline([[1600, 1640], [1700, 1680], [1740, 1760]], 8)
];
const HILLS = [
  [[1150, 130], [1700, 110], [1750, 500], [1560, 720], [1250, 700], [1180, 450]],
  [[2250, 1000], [2550, 950], [2580, 1300], [2530, 1800], [2500, 2050], [2300, 2050], [2260, 1700], [2230, 1300]],
  [[1850, 2150], [2300, 2000], [2580, 2000], [2580, 2480], [1800, 2480]],
  [[1500, 2750], [1800, 2700], [1900, 3000], [1900, 3500], [1500, 3560], [1650, 3300], [1500, 3150]],
  [[2200, 3000], [2580, 3050], [2580, 3560], [2000, 3560], [2100, 3300]]
];
const MOUNTAINS = [
  [[820, 1180], [870, 900], [900, 800], [1050, 720], [1250, 700], [1400, 780], [1330, 880], [1180, 950], [1000, 1100], [960, 1200]],
  [[1807, 2643], [2250, 2600], [2593, 2614], [2400, 2750], [2200, 2900], [2000, 3000], [1850, 3150], [1600, 3200], [1393, 3300], [1250, 3330], [1250, 3200], [1450, 3130], [1700, 2980], [1850, 2780]]
];
const MARSH = [[880, 3340], [1200, 3300], [1500, 3430], [1520, 3570], [925, 3570]];
const PLACES = [
  { name: 'Neverwinter', kind: 'city', x: 577, y: 1750 }, { name: 'Phandalin', kind: 'town', x: 1514, y: 2820 },
  { name: 'Thundertree', kind: 'ruins', x: 1085, y: 1690 }, { name: 'Cragmaw Castle', kind: 'ruins', x: 1480, y: 2210 }, { name: 'Conyberry', kind: 'ruins', x: 2222, y: 1926 },
  { name: 'Old Owl Well', kind: 'ruins', x: 2330, y: 2200 }, { name: 'Leilon', kind: 'ruins', x: 1100, y: 3140 },
  { name: 'Cragmaw Hideout', kind: 'point', x: 1138, y: 2590 }, { name: 'Wave Echo Cave', kind: 'point', x: 1800, y: 2800 }, { name: 'Wyvern Tor', kind: 'point', x: 2462, y: 2470 }, { name: "Agatha's Lair", kind: 'point', x: 2108, y: 1895 },
  { name: 'Mount Hotenow', kind: 'peak', x: 900, y: 1035 }, { name: 'Icespire Peak', kind: 'peak', x: 2093, y: 2664 }
];
const LABELS = [
  { text: 'The Crags', x: 1450, y: 330, rot: -62, size: 120, kind: 'region', color: 'brown' }, { text: 'Neverwinter Wood', x: 1740, y: 1330, rot: 18, size: 150, kind: 'region', color: 'green' },
  { text: 'Starmetal Hills', x: 2440, y: 1180, rot: 56, size: 100, kind: 'region', color: 'brown' }, { text: 'Sword Mountains', x: 2060, y: 2840, rot: -22, size: 115, kind: 'region', color: 'brown' },
  { text: 'Kryptgarden Forest', x: 2240, y: 3260, rot: -52, size: 105, kind: 'region', color: 'green' }, { text: 'Mere of Dead Men', x: 1180, y: 3480, rot: 10, size: 105, kind: 'region', color: 'teal' },
  { text: 'The High Road', x: 1040, y: 2400, rot: 66, size: 50, kind: 'road', color: 'red' }, { text: 'Triboar Trail', x: 1590, y: 2400, rot: -52, size: 50, kind: 'road', color: 'red' }
];

/* ---------------- ground ---------------- */
const forest = JSON.parse(await readFile('data/map-layouts/coast-regions.json', 'utf8'));
const cell = (bx, by) => bx >= 0 && by >= 0 && bx < forest.w && by < forest.h && forest.rows[by][bx] === '2';
// a spot is forest when it is forest and most of its neighbours are too (a lone block is noise in the colour reading, not a tree)
const isForest = (ox, oy) => { const bx = Math.floor(ox / forest.block), by = Math.floor(oy / forest.block); if (!cell(bx, by)) return false; let n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (cell(bx + dx, by + dy)) n++; return n >= 11; };
const polyIn = (list) => { const q = pts(list); return (x, y) => pointInPoly(x, y, q); };
const inHills = HILLS.map(polyIn), inMtn = MOUNTAINS.map(polyIn), inMarsh = polyIn(MARSH);
const seaAt = (x, y) => y > S(470) - 30 && x < coastX(y) && x > S(75) - 6;
p.fillWith((x, y) => {
  const n = fbm(x / 70, y / 70, 5), n2 = vnoise(x / 4, y / 4, 9);
  if (x < S(75) || y < S(70) || x > S(2575) || y > S(3560)) return [90, 74, 52];
  if (seaAt(x, y)) { const d = coastX(y) - x, deep = smoothstep(0, S(400), d); return tint([112, 188, 190], [52, 140, 168], deep).map((c) => c * (0.97 + 0.06 * n2)); }
  let col = tint([222, 214, 140], [190, 204, 128], smoothstep(0.35, 0.7, n));
  col = tint(col, [236, 226, 160], 0.2 * (1 - smoothstep(0, S(200), coastX(y) > 0 ? x - coastX(y) : 0)));
  return col.map((c) => c * (0.96 + 0.08 * n2));
});
// parchment stain toward the frame
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const e = Math.min(x - S(75), y - S(70), S(2575) - x, S(3560) - y); if (e < 0) continue; const k = (1 - smoothstep(0, S(140), e)) * 0.4 * (0.6 + 0.8 * fbm(x / 60, y / 60, 71)); const i = (y * W + x) * 4; p.img[i] = mix(p.img[i], 120, k); p.img[i + 1] = mix(p.img[i + 1], 92, k); p.img[i + 2] = mix(p.img[i + 2], 52, k); }

/* ---------------- sea: wave lines that follow the coast, a dark outline on the shore ---------------- */
for (let k = 1; k <= 9; k++) {
  const off = S(32) * k;
  const line = coast.map(([x, y]) => [x - off + 6 * Math.sin(y / 38 + k), y]).filter(([x, y]) => x > S(95) && y > S(500));
  for (let i = 0; i < line.length - 1; i += 1) if ((i + k) % 5 !== 0) p.capsule(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1], 1.15, [28, 96, 128], 0.55 - k * 0.04);
}
stroke(coast, 2.4, INK, 0.85);
for (let i = 0; i < coast.length - 1; i += 3) p.capsule(coast[i][0] - 5, coast[i][1], coast[i + 1][0] - 5, coast[i + 1][1], 2.2, [240, 250, 248], 0.9);          // surf

/* ---------------- hills and mountains ---------------- */
function hill(cx, cy, r) {
  p.ellipse(cx + 2, cy + 3, r, r * 0.78, 0, [120, 96, 60], 0.35);
  p.ellipse(cx, cy, r, r * 0.78, 0, [232, 214, 150]); p.ellipse(cx - r * 0.2, cy - r * 0.2, r * 0.55, r * 0.4, 0, [248, 238, 190], 0.9);
  for (let a = 0.3; a < 6.2; a += 0.52) p.capsule(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.6, cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 0.8, 1.4, INK, 0.85);       // the hachures round a hill
  p.ring(cx, cy, r * 0.8, 1, [90, 70, 40], 0.4);
}
function mountain(cx, cy, w, h) {
  const top = { x: cx, y: cy - h }, l = { x: cx - w / 2, y: cy + h * 0.15 }, r = { x: cx + w / 2, y: cy + h * 0.15 }, m = { x: cx + w * 0.06, y: cy + h * 0.32 };
  p.poly([{ x: l.x + 4, y: l.y + 6 }, { x: r.x + 6, y: r.y + 6 }, { x: m.x + 4, y: m.y + 8 }], [60, 50, 40], 0.3);
  p.poly([top, l, m], [196, 188, 172]); p.poly([top, m, r], [118, 108, 98]);
  for (let k = 1; k <= 6; k++) { const t = k / 7; p.capsule(top.x + (m.x - top.x) * t * 0.9 + 2, top.y + (m.y - top.y) * t + 2, top.x + (r.x - top.x) * t, top.y + (r.y - top.y) * t, 0.9, INK, 0.55); }    // ink hatching on the shadow side
  p.capsule(top.x, top.y, l.x, l.y, 1.5, INK, 0.9); p.capsule(top.x, top.y, r.x, r.y, 1.5, INK, 0.9); p.capsule(top.x, top.y, m.x, m.y, 1.1, INK, 0.6);
  p.poly([top, { x: top.x - w * 0.12, y: top.y + h * 0.22 }, { x: top.x + w * 0.05, y: top.y + h * 0.2 }], [246, 248, 250], 0.85);
}
const scatter = (polys, inside, gap, draw) => {
  const all = [];
  for (const q of polys) { const poly = pts(q), xs = poly.map((a) => a.x), ys = poly.map((a) => a.y); for (let y = Math.min(...ys); y < Math.max(...ys); y += gap) for (let x = Math.min(...xs); x < Math.max(...xs); x += gap) { const cx = x + (hash(Math.round(x), Math.round(y), 1) - 0.5) * gap * 0.8, cy = y + (hash(Math.round(y), Math.round(x), 2) - 0.5) * gap * 0.8; if (pointInPoly(cx, cy, poly) && !seaAt(cx, cy) && !isForest(cx / SC, cy / SC)) all.push([cx, cy]); } }
  all.sort((a, b) => a[1] - b[1]); for (const [x, y] of all) draw(x, y); void inside;
};
scatter(HILLS, inHills, S(70), (x, y) => hill(x, y, S(26 + hash(Math.round(x), Math.round(y), 3) * 14)));
scatter(MOUNTAINS, inMtn, S(78), (x, y) => mountain(x, y, S(120 + hash(Math.round(x), Math.round(y), 4) * 60), S(62 + hash(Math.round(y), Math.round(x), 5) * 46)));
// the lone peaks get one big mountain each
for (const pl of PLACES.filter((q) => q.kind === 'peak')) mountain(S(pl.x), S(pl.y) + S(30), S(210), S(130));

/* ---------------- marsh ---------------- */
{ const q = pts(MARSH); p.poly(q, [150, 190, 156], 0.9);
  const xs = q.map((a) => a.x), ys = q.map((a) => a.y);
  for (let i = 0; i < 260; i++) { const x = Math.min(...xs) + R() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + R() * (Math.max(...ys) - Math.min(...ys)); if (pointInPoly(x, y, q) && !seaAt(x, y)) { p.capsule(x, y, x + 8, y - 12, 1.1, [60, 100, 70], 0.9); p.capsule(x + 4, y, x + 12, y - 9, 1.1, [60, 100, 70], 0.9); p.capsule(x - 10, y + 4, x + 6, y + 4, 1, [90, 150, 170], 0.8); } } }


/* ---------------- forests: a crown on every packed spot of the forest mask ---------------- */
{
  const crowns = [], gap = S(40);
  for (let y = S(80); y < S(3560); y += gap * 0.85) for (let x = S(80); x < S(2575); x += gap * 0.85) {
    const cx = x + (hash(Math.round(x), Math.round(y), 11) - 0.5) * gap, cy = y + (hash(Math.round(y), Math.round(x), 12) - 0.5) * gap;
    if (isForest(cx / SC, cy / SC) && !seaAt(cx, cy) && !rivers.some((rv) => rv.some(([rx, ry], i) => i % 2 === 0 && Math.hypot(rx - cx, ry - cy) < S(26)))) crowns.push([cx, cy, S(26) + hash(Math.round(cx), Math.round(cy), 13) * S(14)]);
  }
  crowns.sort((a, b) => a[1] - b[1]);
  for (const [cx, cy, r] of crowns) {
    p.disc(cx + r * 0.25, cy + r * 0.4, r, [10, 40, 36], 0.4);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + hash(Math.round(cx), Math.round(cy), 1) * 3, g = 78 + hash(Math.round(cy), i, 2) * 50; p.disc(cx + Math.cos(a) * r * 0.42, cy + Math.sin(a) * r * 0.42, r * 0.62, [g * 0.3, g * 0.85, g * 0.62], 0.97); }
    p.disc(cx - r * 0.25, cy - r * 0.3, r * 0.42, [100, 178, 126], 0.45); p.ring(cx, cy, r * 0.95, 1.1, [8, 36, 30], 0.6);
  }
}

/* ---------------- rivers (over the trees, as they run between them) ---------------- */
for (const r of rivers) { stroke(r, 4.6, INK, 0.9); stroke(r, 2.8, [96, 168, 204]); }

/* ---------------- trails and the High Road ---------------- */
stroke(roads.high, 4.2, [248, 236, 190]); stroke(roads.high, 2.6, [176, 38, 38]);
for (const t of trails) for (let i = 0; i < t.length - 1; i += 2) { p.capsule(t[i][0], t[i][1], t[i + 1][0], t[i + 1][1], 2.4, [176, 38, 38]); }

/* ---------------- places ---------------- */
for (const pl of PLACES) {
  const x = S(pl.x), y = S(pl.y);
  if (pl.kind === 'city') { p.ellipse(x + 4, y + 7, 40, 34, 0, [30, 30, 30], 0.35); p.ellipse(x, y, 38, 32, 0, [98, 84, 70]); p.ellipse(x, y, 31, 26, 0, [208, 186, 150]); for (let a = 0; a < 6.28; a += 0.45) p.disc(x + Math.cos(a) * 38, y + Math.sin(a) * 32, 5.5, [124, 112, 100]); for (let i = 0; i < 14; i++) { const a = hash(i, 4, 1) * 6.28, d = 3 + hash(i, 5, 2) * 21; p.rect(x + Math.cos(a) * d - 5, y + Math.sin(a) * d * 0.85 - 4, 10, 8, i % 3 ? [184, 92, 62] : [150, 124, 92]); } p.ring(x, y, 31, 1.4, INK, 0.8); }
  else if (pl.kind === 'town') { for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28, d = 8 + (i % 2) * 9, hx = x + Math.cos(a) * d, hy = y + Math.sin(a) * d; p.rect(hx - 5, hy - 4, 12, 10, [60, 50, 40], 0.3); p.rect(hx - 6, hy - 5, 12, 10, [186, 100, 70]); p.rect(hx - 6, hy - 5, 12, 4, [228, 150, 108]); } }
  else if (pl.kind === 'ruins') { p.rect(x - 9, y - 9, 24, 24, [40, 40, 40], 0.35); p.rect(x - 12, y - 12, 24, 24, [176, 168, 154]); p.rect(x - 7, y - 7, 14, 14, [98, 92, 82]); p.rect(x - 16, y + 5, 7, 7, [152, 144, 130]); p.rect(x + 7, y - 16, 7, 7, [152, 144, 130]); p.ring(x, y, 17, 1, INK, 0.5); }
  else if (pl.kind === 'point') { p.ellipse(x, y + 3, 17, 11, 0, [40, 40, 40], 0.4); p.poly([{ x: x - 17, y: y + 6 }, { x, y: y - 17 }, { x: x + 17, y: y + 6 }], [168, 142, 108]); p.ellipse(x, y + 2, 8, 6, 0, [22, 16, 14]); p.capsule(x - 17, y + 6, x, y - 17, 1.3, INK, 0.9); p.capsule(x + 17, y + 6, x, y - 17, 1.3, INK, 0.9); }
}
await writeFile(path.resolve(out), encodePng(p.img, W, H));
await writeFile('public/scenarios/compare/coast/coast-names.json', JSON.stringify({ width: OW, height: OH, picture: path.basename(out), places: PLACES.map(({ name, kind, x, y }) => ({ name, kind, x, y })), labels: LABELS }, null, 2));
console.log(`${out}: ${W} x ${H}`);
