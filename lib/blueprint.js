// The blueprint of a map set: its vector layer drawn as an SVG, in the same pixel coordinates as the map picture. It is redrawn from the set whenever the set is saved and kept in the packet as blueprint.svg,
// so the layout can be re-rendered later (a new season, another art style, another painter) without redoing the walls. Layers have fixed ids so a tool can pick them apart:
//   walls (movement and sight), doors, fences (movement only: fences, windows, cliff edges), difficult (difficult terrain), pins (start and place pins), grid (the 5 ft squares).
// Flat colours on white, no gradients or textures, so the picture can be fed to an image model as a layout drawing.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => Math.round(v * 10) / 10;

export function blueprintSvg(doc, { width, height } = {}) {
  const level = doc.levels[0];
  const w = width || 1500, h = height || 1000;
  const cell = level.squares ? w / level.squares : 50;
  const wall = Math.max(4, Math.round(cell * 0.14 * 10) / 10);
  const line = (s, extra = '') => `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}"${extra}/>`;
  const walls = level.walls.filter((s) => s.type !== 'door' && s.type !== 'fence' && s.type !== 'window');
  const fences = level.walls.filter((s) => s.type === 'fence' || s.type === 'window');
  const doors = level.walls.filter((s) => s.type === 'door');
  const grid = [];
  if (level.squares) {
    for (let x = cell; x < w; x += cell) grid.push(`<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${h}"/>`);
    for (let y = cell; y < h; y += cell) grid.push(`<line x1="0" y1="${n(y)}" x2="${w}" y2="${n(y)}"/>`);
  }
  const pins = (level.starts || []).map((s) => `<g data-name="${esc(s.name)}"><circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(cell * 0.18)}"${s.name === 'start' ? ' class="start" fill="#2c9"' : ''}/>${s.radius ? `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(s.radius * cell)}" class="area" fill="none" stroke="#d33" stroke-width="2" stroke-dasharray="10,8"/>` : ''}</g>`);
  const rooms = (level.difficult || []).map((d) => `<rect x="${n(d.x)}" y="${n(d.y)}" width="${n(d.w)}" height="${n(d.h)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-set="${esc(doc.id)}" data-version="${doc.version || 1}" data-squares="${level.squares || 0}" data-feet-per-square="5">
<metadata>${esc(JSON.stringify({ name: doc.name, kind: doc.kind, slug: doc.slug, squares: level.squares || 0, picture: [w, h], layers: ['walls', 'doors', 'fences', 'difficult', 'pins', 'grid'] }))}</metadata>
<rect width="${w}" height="${h}" fill="#ffffff"/>
<g id="grid" stroke="#d6d6d6" stroke-width="1" fill="none">${grid.join('')}</g>
<g id="difficult" fill="#f3e3b8" stroke="none">${rooms.join('')}</g>
<g id="fences" stroke="#8a5a2b" stroke-width="${n(wall * 0.6)}" stroke-dasharray="${n(cell * 0.2)},${n(cell * 0.15)}" stroke-linecap="butt">${fences.map((s) => line(s)).join('')}</g>
<g id="walls" stroke="#111111" stroke-width="${wall}" stroke-linecap="round">${walls.map((s) => line(s)).join('')}</g>
<g id="doors" stroke="#2f8f4e" stroke-width="${n(wall * 0.8)}" stroke-linecap="butt">${doors.map((s) => line(s, ` data-open="${s.open ? 1 : 0}"${s.locked ? ' data-locked="1"' : ''}${s.secret ? ' data-secret="1"' : ''}`)).join('')}</g>
<g id="pins" fill="#d33" stroke="#ffffff" stroke-width="2">${pins.join('')}</g>
</svg>
`;
}
