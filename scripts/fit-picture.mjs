// Helpers for sending a map picture through the image editor, which only returns 1536x1024, 1024x1536 or 1024x1024: `pad` puts a 4:3 picture on a 3:2 canvas (the side strips are mirrored from
// the picture's own edges, so the painter sees more forest, not blank bars); `crop` takes the editor's 1536x1024 result back to the original picture's area and size.
//   node scripts/fit-picture.mjs pad  <picture.png> <out.png>
//   node scripts/fit-picture.mjs crop <result.png> <original width> <original height> <out.png>
//   node scripts/fit-picture.mjs padv <portrait.png> <out.png>      (to 1024x1536)    and    cropv <result.png> <original width> <original height> <out.png>
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPicture } from '../lib/bmpread.js';
import { encodePng } from '../lib/mapkit.js';

const [cmd, ...a] = process.argv.slice(2);
const px = (img, x, y) => { const i = (Math.min(img.h - 1, Math.max(0, y)) * img.w + Math.min(img.w - 1, Math.max(0, x))) * 3; return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]]; };
if (cmd === 'pad') {
  const [pic, out] = a, img = await readPicture(path.resolve(pic));
  const W = Math.round(img.h * 1.5), H = img.h, off = Math.floor((W - img.w) / 2), rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sx = x - off; if (sx < 0) sx = -sx - 1; if (sx >= img.w) sx = 2 * img.w - sx - 1;       // mirror at the edges
    const c = px(img, sx, y), o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  await writeFile(path.resolve(out), encodePng(rgba, W, H)); console.log(`${out}: ${W}x${H} (the picture sits ${off} px from the left)`);
} else if (cmd === 'padv') {
  // a portrait picture onto the editor's 2:3 canvas: scaled to 1024 wide, the missing rows above and below mirrored from the picture
  const [pic, out] = a, img = await readPicture(path.resolve(pic));
  const W = 1024, H = 1536, sh = Math.round(img.h * (W / img.w)), off = Math.floor((H - sh) / 2), rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sy = y - off; if (sy < 0) sy = -sy - 1; if (sy >= sh) sy = 2 * sh - sy - 1;
    const c = px(img, Math.min(img.w - 1, Math.round((x + 0.5) * (img.w / W) - 0.5)), Math.min(img.h - 1, Math.round((sy + 0.5) * (img.h / sh) - 0.5))), o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  await writeFile(path.resolve(out), encodePng(rgba, W, H)); console.log(`${out}: ${W}x${H} (the picture is ${sh} rows tall, ${off} rows from the top)`);
} else if (cmd === 'cropv') {
  const [res, ow, oh, out] = a, W0 = Number(ow), H0 = Number(oh), img = await readPicture(path.resolve(res));
  const sh = Math.round(H0 * (img.w / W0)), off = Math.floor((img.h - sh) / 2), rgba = new Uint8Array(W0 * H0 * 4);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
    const fx = (x + 0.5) * (img.w / W0) - 0.5, fy = off + (y + 0.5) * (sh / H0) - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, o = (y * W0 + x) * 4;
    const p00 = px(img, ix, iy), p10 = px(img, ix + 1, iy), p01 = px(img, ix, iy + 1), p11 = px(img, ix + 1, iy + 1);
    for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(p00[k] * (1 - tx) * (1 - ty) + p10[k] * tx * (1 - ty) + p01[k] * (1 - tx) * ty + p11[k] * tx * ty);
    rgba[o + 3] = 255;
  }
  await writeFile(path.resolve(out), encodePng(rgba, W0, H0)); console.log(`${out}: ${W0}x${H0}`);
} else if (cmd === 'crop') {
  const [res, ow, oh, out] = a, W0 = Number(ow), H0 = Number(oh), img = await readPicture(path.resolve(res));
  const full = Math.round(H0 * 1.5), scale = img.h / H0, x0 = ((full - W0) / 2) * scale, cw = W0 * scale;       // the original's area inside the result
  const rgba = new Uint8Array(W0 * H0 * 4);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {                                                     // bilinear scale back up to the original size
    const fx = x0 + (x + 0.5) * (cw / W0) - 0.5, fy = (y + 0.5) * scale - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, o = (y * W0 + x) * 4;
    const p00 = px(img, ix, iy), p10 = px(img, ix + 1, iy), p01 = px(img, ix, iy + 1), p11 = px(img, ix + 1, iy + 1);
    for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(p00[k] * (1 - tx) * (1 - ty) + p10[k] * tx * (1 - ty) + p01[k] * (1 - tx) * ty + p11[k] * tx * ty);
    rgba[o + 3] = 255;
  }
  await writeFile(path.resolve(out), encodePng(rgba, W0, H0)); console.log(`${out}: ${W0}x${H0} from ${img.w}x${img.h} (area x ${x0.toFixed(0)} to ${(x0 + cw).toFixed(0)})`);
} else { console.error('usage: node scripts/fit-picture.mjs pad <pic> <out> | crop <result> <w> <h> <out>'); process.exit(1); }
