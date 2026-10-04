// Map-making toolkit: draw a battle map in code and write it as a Universal VTT (.dd2vtt) file with its walls, doors and lights.
// No image library: a Painter holds an RGBA buffer and draws antialiased shapes; Level collects what blocks sight as the objects
// are drawn, so the picture and its walls always agree. Used by scripts/make-camp-map.mjs, make-dungeon-map.mjs and friends.
//
//   const level = new Level({ cols: 40, rows: 30, seed: 1 });
//   const p = level.painter;                      // draw with p.disc(...), p.poly(...), ...  (all in pixels)
//   level.solid(corners);                         // a closed shape (tent, boulder, pillar) that blocks sight, pixels
//   level.wall([a, b, c]);                        // an open run of wall, pixels
//   level.door(x1, y1, x2, y2);                   // a door across a gap, pixels
//   level.light({ x, y, range, color, name });    // squares
//   await level.write('public/scenarios/x.dd2vtt', { night: false });

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/* ---------------- numbers ---------------- */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const shade = (col, k) => [clamp(col[0] * k, 0, 255), clamp(col[1] * k, 0, 255), clamp(col[2] * k, 0, 255)];
export const tint = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export const fbm = (x, y, s) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

/* ---------------- drawing ---------------- */
export class Painter {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.img = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < this.img.length; i += 4) this.img[i] = 255;
  }

  put(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4, d = this.img;
    d[i] = d[i] * (1 - a) + r * a;
    d[i + 1] = d[i + 1] * (1 - a) + g * a;
    d[i + 2] = d[i + 2] * (1 - a) + b * a;
    d[i + 3] = 255;
  }

  // Fill the whole picture, one pixel at a time: fn(x, y) returns [r, g, b].
  fillWith(fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = fn(x, y), i = (y * this.w + x) * 4;
      this.img[i] = c[0]; this.img[i + 1] = c[1]; this.img[i + 2] = c[2]; this.img[i + 3] = 255;
    }
  }

  rect(x, y, w, h, col, alpha = 1) {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.h, Math.ceil(y + h)); yy++) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.w, Math.ceil(x + w)); xx++) this.put(xx, yy, col[0], col[1], col[2], alpha);
  }

  disc(cx, cy, r, col, alpha = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const cov = clamp(r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5, 0, 1);
      if (cov > 0) this.put(x, y, col[0], col[1], col[2], cov * alpha);
    }
  }

  ring(cx, cy, r, width, col, alpha = 1) {
    for (let y = Math.floor(cy - r - width - 1); y <= cy + r + width + 1; y++) for (let x = Math.floor(cx - r - width - 1); x <= cx + r + width + 1; x++) {
      const cov = clamp(width / 2 - Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) + 0.5, 0, 1);
      if (cov > 0) this.put(x, y, col[0], col[1], col[2], cov * alpha);
    }
  }

  ellipse(cx, cy, rx, ry, rot, col, alpha = 1) {
    const c = Math.cos(rot), s = Math.sin(rot), R = Math.max(rx, ry) + 2;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      const cov = clamp((1 - Math.hypot(u, v)) * Math.min(rx, ry) + 0.5, 0, 1);
      if (cov > 0) this.put(x, y, col[0], col[1], col[2], cov * alpha);
    }
  }

  capsule(x1, y1, x2, y2, r, col, alpha = 1) {
    const minX = Math.floor(Math.min(x1, x2) - r - 1), maxX = Math.ceil(Math.max(x1, x2) + r + 1);
    const minY = Math.floor(Math.min(y1, y2) - r - 1), maxY = Math.ceil(Math.max(y1, y2) + r + 1);
    const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy || 1;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = clamp(((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / len2, 0, 1);
      const cov = clamp(r - Math.hypot(x + 0.5 - (x1 + vx * t), y + 0.5 - (y1 + vy * t)) + 0.5, 0, 1);
      if (cov > 0) this.put(x, y, col[0], col[1], col[2], cov * alpha);
    }
  }

  // A filled polygon (points {x,y}), antialiased with 4 samples per pixel.
  poly(pts, col, alpha = 1) {
    const minX = Math.floor(Math.min(...pts.map((p) => p.x))), maxX = Math.ceil(Math.max(...pts.map((p) => p.x)));
    const minY = Math.floor(Math.min(...pts.map((p) => p.y))), maxY = Math.ceil(Math.max(...pts.map((p) => p.y)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let hits = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (pointInPoly(x + ox, y + oy, pts)) hits++;
      if (hits) this.put(x, y, col[0], col[1], col[2], (hits / 4) * alpha);
    }
  }

  // Additive light: brightens the picture around (x, y), fading to nothing at r.
  glow(x, y, r, col, strength, power = 1.8) {
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(this.h - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(this.w - 1, Math.ceil(x + r)); xx++) {
      const f = Math.pow(clamp(1 - Math.hypot(xx - x, yy - y) / r, 0, 1), power) * strength;
      if (f <= 0) continue;
      const i = (yy * this.w + xx) * 4, d = this.img;
      d[i] = d[i] + col[0] * f; d[i + 1] = d[i + 1] + col[1] * f; d[i + 2] = d[i + 2] + col[2] * f;
    }
  }

  copy() { const p = new Painter(this.w, this.h); p.img.set(this.img); return p; }
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// A rectangle given by centre, size and rotation (pixels): its four corners.
export function rectPts(cx, cy, w, h, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}
// A regular n-sided shape (an octagon makes a good boulder or pillar), pixels.
export function ngon(cx, cy, rx, ry, n = 8, rot = 0) {
  return Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2 + rot) * rx, y: cy + Math.sin((i / n) * Math.PI * 2 + rot) * ry }));
}

/* ---------------- PNG ---------------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 1;                                     // PNG "Sub" filter: smaller files for smooth pictures
    for (let x = 0; x < w * 4; x++) {
      const i = y * w * 4 + x;
      raw[y * (w * 4 + 1) + 1 + x] = (rgba[i] - (x >= 4 ? rgba[i - 4] : 0)) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- the level: picture + what blocks sight + lights ---------------- */
export class Level {
  constructor({ cols, rows, ppg = 50, seed = 1 }) {
    this.cols = cols; this.rows = rows; this.ppg = ppg;
    this.W = cols * ppg; this.H = rows * ppg;
    this.painter = new Painter(this.W, this.H);
    this.rand = rng(seed);
    this.walls = [];      // polylines in grid units
    this.portals = [];    // doors
    this.lights = [];     // grid units
  }

  sq(n) { return n * this.ppg; }

  // A closed shape that blocks sight (tent, boulder, pillar, crate), corners in pixels.
  solid(pts) { this.walls.push([...pts, pts[0]].map((p) => ({ x: p.x / this.ppg, y: p.y / this.ppg }))); }
  // An open run of wall, points in pixels.
  wall(pts) { this.walls.push(pts.map((p) => ({ x: p.x / this.ppg, y: p.y / this.ppg }))); }
  // A door across a gap from (x1, y1) to (x2, y2), pixels. It starts closed.
  door(x1, y1, x2, y2, closed = true) {
    const g = (v) => v / this.ppg;
    this.portals.push({ position: { x: g((x1 + x2) / 2), y: g((y1 + y2) / 2) }, bounds: [{ x: g(x1), y: g(y1) }, { x: g(x2), y: g(y2) }], rotation: Math.atan2(y2 - y1, x2 - x1), closed, freestanding: false });
  }
  // A light: position in squares, range in squares (the dim radius). flicker animates it on the table.
  light({ x, y, range, intensity = 1, color = 'ffffffff', name, flicker = false }) {
    this.lights.push({ x, y, range, intensity, color, ...(name ? { name } : {}), ...(flicker ? { flicker: true } : {}) });
  }

  // The dd2vtt document. `lights` defaults to all of them; pass a filter result for a version with fewer (a day version).
  uvtt({ ambient = 'ffffffff', pixels = this.painter.img, lights = this.lights } = {}) {
    return {
      format: 0.3,
      resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: this.cols, y: this.rows }, pixels_per_grid: this.ppg },
      line_of_sight: this.walls,
      objects_line_of_sight: [],
      portals: this.portals,
      environment: { baked_lighting: true, ambient_light: ambient },
      lights: lights.map((l) => ({ position: { x: l.x, y: l.y }, range: l.range, intensity: l.intensity, color: l.color, shadows: true, ...(l.name ? { name: l.name } : {}), ...(l.flicker ? { flicker: true } : {}) })),
      image: encodePng(pixels, this.W, this.H).toString('base64')
    };
  }

  async write(file, options) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(this.uvtt(options)));
    return file;
  }

  // Save just the picture (for looking at while working).
  async writePng(file, pixels = this.painter.img) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, encodePng(pixels, this.W, this.H));
    return file;
  }
}

/* ---------------- day to night ---------------- */
// A night picture from a day one: cold and dark, lit warm around the given lights (grid units) and shaded at the edges.
export function nightFrom(day, level, lightsList, { moon = [0.26, 0.34, 0.58], glowRadius = 10.5, vignette = 0.25 } = {}) {
  const { W, H, ppg, cols, rows } = level;
  const out = new Uint8ClampedArray(day.length);
  const lamps = lightsList.filter((l) => l.intensity < 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, gx = x / ppg, gy = y / ppg;
    let glow = 0;
    for (const l of lightsList.filter((q) => q.intensity >= 1)) glow = Math.max(glow, Math.pow(clamp(1 - Math.hypot(gx - l.x, gy - l.y) / glowRadius, 0, 1), 1.8) * (0.92 + 0.08 * vnoise(gx * 6, gy * 6, 21)));
    for (const l of lamps) glow = Math.max(glow, Math.pow(clamp(1 - Math.hypot(gx - l.x, gy - l.y) / 3.2, 0, 1), 2) * 0.45);
    const m = 0.9 + 0.3 * vnoise(gx * 0.7, gy * 0.7, 31);
    const vig = 1 - vignette * Math.pow(Math.hypot((gx - cols / 2) / (cols / 2), (gy - rows / 2) / (rows / 2)), 2.2);
    const r = day[i], g = day[i + 1], b = day[i + 2];
    const cold = [r * moon[0] * m, g * moon[1] * m, b * moon[2] * m + 10];
    const warm = [r * 1.28 + 14, g * 0.98 + 6, b * 0.62];
    out[i] = mix(cold[0], warm[0], glow) * vig;
    out[i + 1] = mix(cold[1], warm[1], glow) * vig;
    out[i + 2] = mix(cold[2], warm[2], glow) * vig;
    out[i + 3] = 255;
  }
  return out;
}
