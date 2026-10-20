// The Map Maker's painting step: which picture services can be used (those with a saved key), what a picture costs, the prompts, and the call itself.
// Battle maps are painted FROM the checked layout drawing (the walls are then known to fit); town and regional maps come from a text description alone.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editFromLayout, generateFromText, generateGeminiFromText, generateOpenAIFromText } from './image-providers.js';
import { layoutPng } from './map-layout.js';
import { wallDrift } from './wall-drift.js';
import { imageSize } from './mapsets.js';

export const PROVIDERS = [
  { id: 'openai', label: 'OpenAI (ChatGPT images)', models: [
    { id: 'gpt-image-1', label: 'gpt-image-1', qualities: ['low', 'medium', 'high'] },
    { id: 'gpt-image-1-mini', label: 'gpt-image-1-mini (cheaper)', qualities: ['low', 'medium', 'high'] }] },
  { id: 'gemini', label: 'Google Gemini', models: [
    { id: 'gemini-nano-banana-2.1', label: 'gemini-nano-banana-2.1 (cheapest)', qualities: ['1K', '2K'] },
    { id: 'gemini-3.1-flash-image', label: 'gemini-3.1-flash-image', qualities: ['1K', '2K'] },
    { id: 'gemini-3-pro-image', label: 'gemini-3-pro-image (best)', qualities: ['1K', '2K', '4K'] }] },
  { id: 'fal', label: 'FLUX on fal.ai', models: [
    { id: 'fal-ai/flux-control-lora-canny', label: 'FLUX Control LoRA (follows the drawing closely, barely repaints)', qualities: ['standard'] },
    { id: 'fal-ai/flux-pro/kontext', label: 'FLUX Kontext (edits the drawing, may redraw rooms)', qualities: ['standard'] }] }
];

// A rough price of one picture in dollars, from the providers' list prices as noted in Nov 2026. It is shown before the person confirms; the provider's own bill is the truth.
const PRICES = {
  'gpt-image-1': { low: 0.03, medium: 0.07, high: 0.25 }, 'gpt-image-1-mini': { low: 0.01, medium: 0.03, high: 0.08 },
  'gemini-nano-banana-2.1': { '1K': 0.03, '2K': 0.05 }, 'gemini-3.1-flash-image': { '1K': 0.07, '2K': 0.1 }, 'gemini-3-pro-image': { '1K': 0.13, '2K': 0.13, '4K': 0.24 },
  'fal-ai/flux-control-lora-canny': { standard: 0.05 }, 'fal-ai/flux-pro/kontext': { standard: 0.05 }
};
export const paintCost = (model, quality) => PRICES[model]?.[quality] ?? 0.1;

// The services the person can pick from for this kind of map: only those with a key. `keys` is { openai, gemini, fal }; `chosen` is the Settings > Map generators choice for the kind.
export function paintOptions(keys, chosen) {
  const providers = PROVIDERS.map((p) => ({ ...p, available: Boolean(keys[p.id]), models: p.models.map((m) => ({ ...m, costs: Object.fromEntries(m.qualities.map((q) => [q, paintCost(m.id, q)])) })) }));
  const usable = providers.filter((p) => p.available);
  const pick = usable.find((p) => p.id === chosen?.provider) || usable[0] || null;
  const model = pick && (pick.models.find((m) => m.id === chosen?.model) || pick.models[0]);
  const quality = model && (model.qualities.includes(chosen?.quality) ? chosen.quality : model.qualities[Math.floor(model.qualities.length / 2)] || model.qualities[0]);
  return { providers, selected: pick ? { provider: pick.id, model: model.id, quality } : null };
}

const readStyle = async (root, name, fallback) => { try { return (await readFile(path.join(root, 'public', 'scenarios', 'compare', 'style', name), 'utf8')).trim(); } catch { return fallback; } };

// setting: 'indoor' (dungeon, building, cave: the sepia inked module style) or 'outdoor' (the painted outdoor style).
export async function battlePrompt(root, { setting, description, cols, rows, layout }) {
  const style = setting === 'outdoor'
    ? await readStyle(root, 'outdoor-battle-style.txt', 'Art style: hand-painted fantasy battle map with dark ink outlines, natural earthy colours, no grid, no text.')
    : await readStyle(root, 'battle-style-chosen.txt', 'Art style: classic hand-drawn fantasy module cartography, sepia and parchment, fine ink linework. No grid, no text.');
  return [
    `Repaint this flat-colour layout drawing as a STRICTLY OVERHEAD, bird's-eye battle map for a tabletop roleplaying game: everything is drawn exactly as seen from directly above, orthographic, looking straight down. No perspective, no side views, no isometric angle, no 3D elevation.`,
    `What the colours in the drawing mean: black is solid rock or empty space outside the place and stays black; tan is walkable floor; blue is shallow water; grey-brown is rubble or rough ground; dark bands are walls; thick brown bands are wooden doors; grey circles are round objects (pillars, boulders, trees, barrels or crates as fits the place).`,
    ...((layout.smooth || []).length ? ['Cave walls, cliffs, mountain sides and other natural edges are CURVED in the drawing: keep those smooth, rounded, organic outlines exactly as drawn and paint them as natural rock, cliff or tree line; do not straighten them into squares.'] : []),
    ...(layout.lights.length ? [`Each bright orange dot with a dark rim marks a LIGHT SOURCE (${layout.lights.length} in all). Paint a real, clearly visible ${setting === 'outdoor' ? 'campfire, lantern or torch' : 'wall torch, standing brazier or hearth fire'} at every one, with flames and a soft warm glow falling on the floor and walls around it, and do not leave any flat orange dot in the picture. Paint no other light sources.`] : []),
    `The place: ${String(description || '').trim().slice(0, 2500)}`,
    `KEEP THE LAYOUT EXACTLY: every wall, wall corner, doorway, door, round object, patch of water and rubble must stay in precisely the same position, size and shape as in the input picture (it is a ${cols} by ${rows} square map). Do not move, add, remove, resize or redraw any of them differently; do not change the outlines of the rooms or the open ground.`,
    style,
    'No grid lines, no text, no letters, no people, no animals, no tokens.'
  ].join('\n\n');
}

export async function textPrompt(root, { kind, description }) {
  if (kind === 'regional') {
    const style = await readStyle(root, 'regional-style2.txt', 'Art style: painted-and-inked fantasy atlas map. No text, no labels, no grid.');
    return `A hand-illustrated fantasy REGIONAL MAP seen from directly above like an atlas page. ${String(description || '').trim().slice(0, 2500)}\n\n${style}`;
  }
  return `A STRICTLY OVERHEAD, bird's-eye painted fantasy TOWN MAP seen from directly above (orthographic, straight down, rooftops drawn as flat roofs, no perspective, no side views). ${String(description || '').trim().slice(0, 2500)}\n\nArt style: hand-painted fantasy town map with confident dark ink outlines and soft painted shading, warm earthy colours, streets, squares, walls and water clearly readable, crisp at tabletop scale. No grid, no text, no letters, no labels, no title, no legend, no people, no border.`;
}

const extOf = (bytes) => (bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : 'png');

// Two flat segments that lie on one line and touch are one wall for the drift check; the layout is in grid units, the check wants picture pixels and axis-aligned lines.
function driftLayout(layout, width, height) {
  const kx = width / layout.cols, ky = height / layout.rows;
  return { size: [width, height], wall: Math.max(4, Math.round(Math.min(kx, ky) * 0.18)), walls: layout.walls.filter((w) => w.type === 'wall' && (w.x1 === w.x2 || w.y1 === w.y2)).map((w) => ({ x1: w.x1 * kx, y1: w.y1 * ky, x2: w.x2 * kx, y2: w.y2 * ky })) };
}
async function measureDrift(layout, bytes, width, height) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-drift-'));
  try {
    const file = path.join(dir, 'picture.' + extOf(bytes));
    await writeFile(file, bytes);
    const d = await wallDrift(file, driftLayout(layout, width, height));
    return d && Number.isFinite(d.medianPx) ? d : null;
  } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}

// kind: battle | town | regional. For battle, `layout` is the compiled layout (it is drawn and given to the painter). Returns { bytes, ext, width, height, note, cost, drift, ms }.
export async function paint({ root, kind, description, setting, layout, orientation, provider, model, quality, keys }) {
  const key = keys[provider];
  if (!key) { const e = new Error(`No ${provider} key is saved (Settings).`); e.short = e.message; throw e; }
  const portrait = orientation === 'portrait';
  const openaiSize = portrait ? '1024x1536' : '1536x1024', [w0, h0] = openaiSize.split('x').map(Number);
  const t0 = Date.now();
  let out;
  if (kind === 'battle') {
    const prompt = await battlePrompt(root, { setting, description, cols: layout.cols, rows: layout.rows, layout });
    out = await editFromLayout({ provider, model, quality, key, prompt, imagePng: layoutPng(layout, { width: w0, height: h0 }), width: w0, height: h0 });
  } else {
    const prompt = await textPrompt(root, { kind, description });
    const aspect = portrait ? '2:3' : '3:2';
    if (provider === 'openai') out = await generateOpenAIFromText({ model, quality, key, prompt, size: openaiSize });
    else if (provider === 'gemini') out = await generateGeminiFromText({ model, key, prompt, aspect, size: quality });
    else out = await generateFromText({ provider: 'fal', model: 'fal-ai/flux-pro/kontext/text-to-image', key, prompt, aspect });
  }
  const bytes = out.png, size = imageSize(bytes) || { w: w0, h: h0 };
  const drift = kind === 'battle' ? await measureDrift(layout, bytes, size.w, size.h) : null;
  return { bytes, ext: extOf(bytes), width: size.w, height: size.h, note: out.note || '', cost: paintCost(model, quality), drift, ms: Date.now() - t0 };
}
