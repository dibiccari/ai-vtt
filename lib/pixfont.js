// A tiny 3x5 pixel font (digits, minus, comma, point, a few letters) to label overlays drawn on an RGBA buffer.
const GLYPHS = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  '-': '000000111000000', ',': '000000000010100', '.': '000000000000010', ' ': '000000000000000',
  r: '000110100100100', c: '000011100100011', d: '110101101101110', s: '011100010001110', h: '100100110101101', v: '000101101101010'
};
// draws text with its top-left at (x, y); scale is the size of one font pixel; a 1 px dark halo keeps it readable on any picture
export function drawText(rgba, W, H, text, x, y, scale, color = [255, 255, 255], halo = [0, 0, 0]) {
  const put = (px, py, col) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const i = (py * W + px) * 4; rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255; };
  const pass = (col, grow) => {
    let cx = x;
    for (const ch of String(text)) {
      const g = GLYPHS[ch] || GLYPHS[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (g[gy * 3 + gx] !== '1') continue;
        for (let dy = -grow; dy < scale + grow; dy++) for (let dx = -grow; dx < scale + grow; dx++) put(cx + gx * scale + dx, y + gy * scale + dy, col);
      }
      cx += 4 * scale;
    }
  };
  if (halo) pass(halo, 1);
  pass(color, 0);
}
export const textWidth = (text, scale) => String(text).length * 4 * scale;
