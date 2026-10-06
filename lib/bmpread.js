// Reads a picture as luminance + RGB by converting it to an uncompressed BMP with macOS `sips` (no image libraries are installed). Used by the wall-reading scripts.
import { readFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export async function readPicture(file) {
  const tmp = path.join(os.tmpdir(), 'bmpread-' + process.pid + '-' + Date.now() + '.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', file, '--out', tmp], { stdio: 'ignore' });
  const b = await readFile(tmp);
  await unlink(tmp).catch(() => {});
  const off = b.readUInt32LE(10), w = b.readInt32LE(18); let h = b.readInt32LE(22); const bpp = b.readUInt16LE(28);
  const top = h < 0; h = Math.abs(h);
  const bytes = bpp / 8, stride = Math.ceil(w * bytes / 4) * 4;
  const lum = new Float32Array(w * h), rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = top ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const p = off + y * stride + x * bytes;
      const i = row * w + x;
      const B = b[p], G = b[p + 1], R = b[p + 2];
      lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
      rgb[i * 3] = R; rgb[i * 3 + 1] = G; rgb[i * 3 + 2] = B;
    }
  }
  return { w, h, lum, rgb };
}
