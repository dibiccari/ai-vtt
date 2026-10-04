// Table safety tools: lines (never appear), veils (happen off-screen or in a sentence), and free notes, per campaign.
// Saved in data/campaigns/<id>/safety.json and given to the DM every turn.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cleanList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n/)).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 30);

export function cleanSafety(raw) {
  return { lines: cleanList(raw?.lines), veils: cleanList(raw?.veils), notes: String(raw?.notes ?? '').trim().slice(0, 1500) };
}

export async function readSafety(dir) {
  try { return cleanSafety(JSON.parse(await readFile(path.join(dir, 'safety.json'), 'utf8'))); } catch { return cleanSafety({}); }
}

export async function writeSafety(dir, raw) {
  const clean = cleanSafety(raw);
  await writeFile(path.join(dir, 'safety.json'), JSON.stringify({ version: 1, ...clean }, null, 2));
  return clean;
}

// What the DM is told. Empty when nothing has been agreed.
export function safetyForPrompt(s) {
  if (!s.lines.length && !s.veils.length && !s.notes) return '';
  const parts = ['TABLE SAFETY (what the players agreed; follow it strictly and never mention it in the story):'];
  if (s.lines.length) parts.push(`Lines, never to appear in the game, not even as a hint: ${s.lines.join('; ')}.`);
  if (s.veils.length) parts.push(`Veils, which may happen but only off-screen or in a single tasteful sentence, never described: ${s.veils.join('; ')}.`);
  if (s.notes) parts.push(`Notes from the table: ${s.notes}`);
  return parts.join('\n');
}
