// The campaign journal: what the party has done, who they met, quests, places, loot and promises.
// It lives in the campaign's save file (data/campaigns/<id>/save.json) so the AI can read it every turn and write a recap.

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const CATEGORIES = ['event', 'npc', 'quest', 'place', 'loot', 'promise'];
export const STATUSES = ['open', 'done', 'none'];
const MAX_ENTRIES = 400;

const saveFile = (dir) => path.join(dir, 'save.json');

// Writes to one save file are queued so two replies finishing together cannot overwrite each other.
const queues = new Map();
function queued(dir, job) {
  const next = (queues.get(dir) || Promise.resolve()).then(job, job);
  queues.set(dir, next.catch(() => {}));
  return next;
}

function cleanEntry(raw, now = Date.now()) {
  const category = CATEGORIES.includes(raw?.category) ? raw.category : 'event';
  const title = String(raw?.title ?? '').trim().slice(0, 80);
  const text = String(raw?.text ?? '').trim().slice(0, 600);
  if (!title || !text) return null;
  return {
    id: String(raw?.id ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || `j${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    category,
    title,
    text,
    status: STATUSES.includes(raw?.status) ? raw.status : 'none',
    when: String(raw?.when ?? '').trim().slice(0, 60),
    at: Number.isFinite(raw?.at) ? raw.at : now
  };
}

export async function readSave(dir) {
  try {
    const save = JSON.parse(await readFile(saveFile(dir), 'utf8'));
    const entries = (Array.isArray(save.entries) ? save.entries : []).map((e) => cleanEntry(e, e?.at)).filter(Boolean);
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeSave(dir, save) {
  const file = saveFile(dir);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, entries: save.entries.slice(-MAX_ENTRIES) }, null, 2));
  await rename(tmp, file);
}

// Replace the whole journal (import, delete one entry, start over).
export function replaceEntries(dir, entries) {
  return queued(dir, async () => {
    const clean = (Array.isArray(entries) ? entries : []).map((e) => cleanEntry(e, e?.at)).filter(Boolean);
    await writeSave(dir, { entries: clean });
    return clean;
  });
}

// Add the AI's journal updates. Events always add a line; npc/quest/place/loot/promise entries update the one with the same title.
export function addJournalUpdates(dir, updates) {
  return queued(dir, async () => {
    const save = await readSave(dir);
    const changed = [];
    for (const u of Array.isArray(updates) ? updates : []) {
      const entry = cleanEntry(u);
      if (!entry) continue;
      const same = entry.category === 'event' ? null : save.entries.find((e) => e.category === entry.category && e.title.toLowerCase() === entry.title.toLowerCase());
      if (same) {
        same.text = entry.text;
        if (entry.status !== 'none') same.status = entry.status;
        if (entry.when) same.when = entry.when;
        changed.push(same);
      } else {
        save.entries.push(entry);
        changed.push(entry);
      }
    }
    if (changed.length) await writeSave(dir, save);
    return changed;
  });
}

// The journal as the AI reads it: everything that is still open, every person and place, and the most recent events.
export function journalForPrompt(entries) {
  if (!entries.length) return '';
  const line = (e) => `- [${e.category}${e.status !== 'none' ? ', ' + e.status : ''}] ${e.title}${e.when ? ` (${e.when})` : ''}: ${e.text}`;
  const events = entries.filter((e) => e.category === 'event');
  const others = entries.filter((e) => e.category !== 'event');
  const text = [...others.map(line), '', 'Recent events, oldest first:', ...events.slice(-30).map(line)].join('\n');
  return text.length > 9000 ? text.slice(-9000) : text;
}
