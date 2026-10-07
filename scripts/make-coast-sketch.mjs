// Draws our own rough layout sketch of the Sword Coast region (the geography of the published map, positions only: sea on the west, the High Road, the Neverwinter Wood, the Sword Mountains and so on)
// at 1024 x 1536, with simple colour-coded shapes, for the image editor to paint over in a chosen art style (scripts/openai-repaint.mjs). The sketch is original; no pixel of the published picture is used.
// Also writes the place list (names and positions as fractions of the picture) to public/scenarios/compare/coast/coast-places.json.
//   node scripts/make-coast-sketch.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Painter, rng, fbm, vnoise, hash, clamp, tint, shade, encodePng, pointInPoly } from '../lib/mapkit.js';

const W = 1024, H = 1536, R = rng(20261112);
const p = new Painter(W, H);
// The geography was read from the published map at 1059 x 1450 and is placed here with the same proportions.
const X = (x) => (x / 1059) * W, Y = (y) => (y / 1450) * H;
const P = (pts) => pts.map(([x, y]) => ({ x: X(x), y: Y(y) }));
const spline = (pts, per = 12) => {
  const q = pts.map(([x, y]) => [X(x), Y(y)]), res = [];
  for (let i = 0; i < q.length - 1; i++) {
    const a = q[Math.max(0, i - 1)], b = q[i], c = q[i + 1], d = q[Math.min(q.length - 1, i + 2)];
    for (let k = 0; k < per; k++) { const t = k / per, t2 = t * t, t3 = t2 * t; res.push([0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3), 0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3)]); }
  }
  res.push(q[q.length - 1]); return res;
};
const line = (pts, r, col, a = 1) => { for (let i = 0; i < pts.length - 1; i++) p.capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r, col, a); };
const dotted = (pts, r, col) => { let n = 0; for (let i = 0; i < pts.length - 1; i++) { if ((n++ % 3) !== 2) p.capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r, col); } };

// land and sea
const coast = spline([[0, 0], [22, 380], [60, 640], [150, 685], [205, 705], [214, 900], [226, 1100], [252, 1250], [305, 1335], [350, 1400], [425, 1450]]);
const coastX = (y) => { for (let i = 0; i < coast.length - 1; i++) if (coast[i][1] <= y && coast[i + 1][1] >= y) { const t = (y - coast[i][1]) / ((coast[i + 1][1] - coast[i][1]) || 1); return coast[i][0] + (coast[i + 1][0] - coast[i][0]) * t; } return 0; };
p.fillWith((x, y) => (x < coastX(y) ? [120, 170, 205] : tint([226, 214, 160], [200, 206, 140], clamp(fbm(x / 120, y / 120, 5), 0, 1))));
for (let y = 0; y < H; y += 18) p.capsule(coastX(y) - 4, y, coastX(y + 18) - 4, y + 18, 2.5, [236, 244, 244], 0.9);                    // surf along the shore
for (let i = 0; i < 120; i++) { const y = R() * H, x = R() * Math.max(10, coastX(y) - 40); if (x < coastX(y) - 30) p.capsule(x, y, x + 24 + R() * 20, y + 2, 1.4, [190, 220, 238], 0.8); }   // waves
// forests (dark green masses)
const forestPolys = [];
const forest = (pts) => { forestPolys.push(P(pts)); p.poly(P(pts), [46, 110, 62]); };
forest([[190, 60], [430, 50], [440, 300], [380, 640], [190, 640]]);
forest([[400, 420], [480, 330], [560, 270], [700, 280], [820, 380], [900, 480], [900, 560], [830, 620], [700, 620], [560, 560], [440, 520]]);
forest([[450, 640], [560, 600], [700, 620], [850, 640], [900, 690], [880, 760], [780, 790], [690, 830], [660, 920], [620, 950], [560, 950], [500, 900], [470, 800], [450, 700]]);
forest([[770, 1160], [900, 1140], [1000, 1180], [1020, 1330], [1000, 1440], [840, 1440], [780, 1330], [760, 1230]]);
// every forest is packed with round tree crowns (a shadow, a few lobes, a lit side), drawn from the top down so lower ones overlap higher ones
{
  const crowns = [];
  for (const poly of forestPolys) { const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y); for (let y = Math.min(...ys); y < Math.max(...ys); y += 13) for (let x = Math.min(...xs); x < Math.max(...xs); x += 13) { const cx = x + (R() - 0.5) * 10, cy = y + (R() - 0.5) * 10; if (pointInPoly(cx, cy, poly)) crowns.push([cx, cy, 11 + R() * 7]); } }
  crowns.sort((a, b) => a[1] - b[1]);
  for (const [cx, cy, r] of crowns) {
    p.disc(cx + r * 0.3, cy + r * 0.45, r, [18, 50, 30], 0.4);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28 + hash(Math.round(cx), Math.round(cy), 1) * 3, g = 70 + hash(Math.round(cy), i, 2) * 50; p.disc(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4, r * 0.62, [g * 0.5, g * 1.05, g * 0.5], 0.95); }
    p.disc(cx - r * 0.25, cy - r * 0.3, r * 0.45, [130, 190, 100], 0.4); p.ring(cx, cy, r * 0.95, 1, [20, 60, 30], 0.4);
  }
}
// hills and mountains
const hills = (pts, n) => { const poly = P(pts); const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y); for (let i = 0; i < n; i++) { const x = Math.min(...xs) + R() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + R() * (Math.max(...ys) - Math.min(...ys)); p.ellipse(x, y, 20 + R() * 16, 12 + R() * 8, 0, [190, 170, 110], 0.9); p.ellipse(x - 4, y - 4, 12, 6, 0, [226, 210, 150], 0.8); } };
hills([[470, 60], [650, 60], [660, 260], [480, 260]], 38);               // the crags
hills([[880, 400], [1040, 400], [1040, 720], [900, 720]], 40);             // the hills on the east edge
hills([[880, 800], [1040, 800], [1040, 930], [880, 930]], 14);
hills([[300, 440], [380, 440], [380, 540], [290, 540]], 10);
const mountains = (pts, n) => { const poly = P(pts); const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y); for (let i = 0; i < n; i++) { const x = Math.min(...xs) + R() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + R() * (Math.max(...ys) - Math.min(...ys)), w = 26 + R() * 18, h = 40 + R() * 24; p.poly([{ x, y: y - h }, { x: x - w, y }, { x: x + w * 0.1, y: y + 8 }], [180, 176, 170]); p.poly([{ x, y: y - h }, { x: x + w * 0.1, y: y + 8 }, { x: x + w, y }], [120, 116, 112]); } };
mountains([[640, 1040], [780, 980], [1040, 920], [1040, 1250], [900, 1190], [780, 1160], [700, 1110]], 46);        // the Sword Mountains
mountains([[480, 1250], [700, 1250], [720, 1330], [560, 1335]], 14);
mountains([[320, 330], [430, 310], [430, 470], [330, 520]], 12);                                                  // around the lone volcano peak
// marsh in the south
p.poly(P([[440, 1380], [560, 1350], [640, 1400], [630, 1450], [450, 1450]]), [120, 160, 130]);
for (let i = 0; i < 80; i++) { const x = X(450 + R() * 190), y = Y(1370 + R() * 80); p.capsule(x, y, x + 10, y - 8, 1.3, [70, 110, 80], 0.8); }
// rivers
line(spline([[232, 700], [300, 690], [340, 705], [380, 680], [440, 668]]), 4, [90, 150, 205]);
line(spline([[410, 470], [470, 445], [540, 425], [600, 480], [660, 520], [740, 545], [830, 575], [900, 610]]), 3.6, [90, 150, 205]);
line(spline([[560, 300], [590, 350], [540, 395], [520, 430]]), 3, [90, 150, 205]);
// the High Road and the Triboar Trail
const road = spline([[52, 42], [130, 300], [190, 560], [232, 700], [262, 780], [330, 900], [390, 1050], [420, 1180], [441, 1268], [520, 1320], [580, 1380], [640, 1430]]);
line(road, 3.4, [190, 40, 40]);
dotted(spline([[420, 1075], [560, 1030], [650, 970], [760, 880], [850, 800], [888, 770], [1000, 790]], 10), 3, [190, 40, 40]);
dotted(spline([[565, 1040], [585, 1090], [606, 1128]], 8), 3, [190, 40, 40]);
dotted(spline([[842, 760], [870, 770], [888, 770]], 6), 2.6, [190, 40, 40]);

// places: [name, display x, display y, kind]  (positions on the published map's 1059 x 1450 layout)
const PLACES = [
  ['Neverwinter', 232, 700, 'city'], ['Phandalin', 606, 1128, 'town'], ['Thundertree', 435, 675, 'ruins'], ['Cragmaw Castle', 589, 880, 'ruins'], ['Conyberry', 888, 768, 'ruins'],
  ['Old Owl Well', 982, 886, 'ruins'], ['Leilon', 441, 1268, 'ruins'], ['Cragmaw Hideout', 455, 1036, 'point'], ['Wave Echo Cave', 720, 1120, 'point'], ['Wyvern Tor', 985, 988, 'point'],
  ["Agatha's Lair", 842, 760, 'point'], ['Mount Hotenow', 361, 410, 'peak'], ['Icespire Peak', 838, 1062, 'peak']
];
for (const [name, x, y, kind] of PLACES) {
  const px = X(x), py = Y(y);
  if (kind === 'city') { p.ellipse(px + 4, py + 6, 38, 34, 0, [30, 30, 30], 0.35); p.ellipse(px, py, 36, 32, 0, [96, 80, 66]); p.ellipse(px, py, 30, 26, 0, [196, 176, 140]); for (let a = 0; a < 6.28; a += 0.5) p.disc(px + Math.cos(a) * 36, py + Math.sin(a) * 32, 5, [110, 100, 92]); for (let i = 0; i < 12; i++) { const a = hash(i, 4, 1) * 6.28, d = 4 + hash(i, 5, 2) * 20; p.rect(px + Math.cos(a) * d - 5, py + Math.sin(a) * d - 4, 10, 8, i % 3 ? [176, 90, 62] : [150, 124, 92]); } }
  else if (kind === 'town') { for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28, d = 8 + (i % 2) * 8; const hx = px + Math.cos(a) * d, hy = py + Math.sin(a) * d; p.rect(hx - 6, hy - 5, 12, 10, [60, 50, 40], 0.3); p.rect(hx - 6, hy - 5, 12, 10, [186, 100, 70]); p.rect(hx - 6, hy - 5, 12, 4, [220, 140, 100]); } }
  else if (kind === 'ruins') { p.rect(px - 11, py - 11, 22, 22, [40, 40, 40], 0.35); p.rect(px - 12, py - 12, 22, 22, [168, 160, 146]); p.rect(px - 7, py - 7, 12, 12, [96, 90, 80]); p.rect(px - 14, py + 4, 6, 6, [150, 142, 128]); p.rect(px + 6, py - 14, 6, 6, [150, 142, 128]); for (let i = 0; i < 4; i++) p.disc(px + 12 + R() * 8, py + R() * 12, 2 + R() * 2, [140, 134, 120]); }
  else if (kind === 'point') { p.ellipse(px, py, 14, 10, 0, [40, 40, 40]); p.ellipse(px, py + 1, 9, 6, 0, [10, 10, 10]); p.poly([{ x: px - 16, y: py + 6 }, { x: px, y: py - 16 }, { x: px + 16, y: py + 6 }], [150, 130, 100]); p.ellipse(px, py + 2, 7, 5, 0, [20, 16, 14]); }
  else if (kind === 'peak') { p.poly([{ x: px, y: py - 34 }, { x: px - 30, y: py + 16 }, { x: px + 4, y: py + 8 }], [226, 230, 236]); p.poly([{ x: px, y: py - 34 }, { x: px + 4, y: py + 8 }, { x: px + 30, y: py + 16 }], [120, 124, 134]); p.capsule(px, py - 34, px - 30, py + 16, 1.6, [40, 40, 40]); p.capsule(px, py - 34, px + 30, py + 16, 1.6, [40, 40, 40]); }
}
await mkdir('public/scenarios/compare/coast', { recursive: true });
await writeFile('public/scenarios/compare/coast/coast-sketch.png', encodePng(p.img, W, H));
await writeFile('public/scenarios/compare/coast/coast-places.json', JSON.stringify(PLACES.map(([name, x, y, kind]) => ({ name, kind, fx: Math.round((x / 1059) * 10000) / 10000, fy: Math.round((y / 1450) * 10000) / 10000 })), null, 2));
console.log(`coast-sketch.png ${W}x${H}, ${PLACES.length} places`);
void hash; void vnoise; void shade;
