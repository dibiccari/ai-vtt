// A crop of a map picture drawn into an RGBA buffer, with cell-unit helpers (toX, toY) and line drawing. Used by scripts/grid-overlay.mjs and scripts/grid-evidence.mjs.
export function makeCrop(pic, grid, range, S) {
  const C = grid.cell, [ox, oy] = grid.origin;
  const [c0, r0, c1, r1] = range;
  const X0 = ox + c0 * C, Y0 = oy + r0 * C;
  const W = Math.max(1, Math.round((c1 - c0) * C * S)), H = Math.max(1, Math.round((r1 - r0) * C * S));
  if (W * H > 40e6) throw new Error('crop too large');
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.round(X0 + x / S), sy = Math.round(Y0 + y / S), o = (y * W + x) * 4;
    if (sx < 0 || sy < 0 || sx >= pic.w || sy >= pic.h) { out[o] = 40; out[o + 1] = 40; out[o + 2] = 40; out[o + 3] = 255; continue; }
    const i = sy * pic.w + sx;
    out[o] = pic.rgb[i * 3]; out[o + 1] = pic.rgb[i * 3 + 1]; out[o + 2] = pic.rgb[i * 3 + 2]; out[o + 3] = 255;
  }
  const toX = (c) => (ox + c * C - X0) * S, toY = (r) => (oy + r * C - Y0) * S;
  const blend = (x, y, col, a) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; for (let k = 0; k < 3; k++) out[o + k] = Math.round(out[o + k] * (1 - a) + col[k] * a); };
  const line = (xa, ya, xb, yb, col, a = 1, thick = 1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya)));
    for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n, y = ya + (yb - ya) * i / n; for (let dy = 0; dy < thick; dy++) for (let dx = 0; dx < thick; dx++) blend(Math.round(x) + dx, Math.round(y) + dy, col, a); }
  };
  const fillRect = (xa, ya, xb, yb, col, a) => { for (let y = Math.max(0, Math.floor(ya)); y < Math.min(H, Math.ceil(yb)); y++) for (let x = Math.max(0, Math.floor(xa)); x < Math.min(W, Math.ceil(xb)); x++) blend(x, y, col, a); };
  return { out, W, H, C, S, X0, Y0, toX, toY, blend, line, fillRect };
}
