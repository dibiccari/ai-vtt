// The Bookkeeper: a small model that keeps the campaign journal AFTER each reply, so the Dungeon Master does not spend its reply form (or a round trip) on it. It reads what the player said,
// what the DM narrated and the journal as it stands, and returns the entries worth keeping. Runs after the reply is sent; the next turn's DM sees the result.
import { CATEGORIES, STATUSES } from './journal.js';
export const BOOKKEEPER_MODEL_DEFAULT = 'claude-haiku-5-5';

export const bookkeeperSchema = () => ({
  type: 'object',
  properties: {
    entries: { type: 'array', items: { type: 'object', properties: { category: { type: 'string', enum: CATEGORIES }, title: { type: 'string' }, text: { type: 'string' }, status: { type: 'string', enum: STATUSES }, when: { type: 'string' } }, required: ['category', 'title', 'text', 'status', 'when'], additionalProperties: false } }
  },
  required: ['entries'],
  additionalProperties: false
});

export const BOOKKEEPER_SYSTEM = `You are the bookkeeper of a D&D campaign journal: the party's shared memory, read by the Dungeon Master before every turn. After each turn you are given what the player said, what the Dungeon Master narrated, and the journal so far. Return only the entries worth adding or updating, or an empty list when nothing noteworthy happened.

Categories: "event" for what happened (a short title and one or two sentences); "npc" for a person met (title is the name, text says who they are and how they feel about the party); "quest" for a goal (status "open" until finished, then the same title again with status "done"); "place" for somewhere important; "loot" for treasure or magic items found (not ordinary purchases); "promise" for something the party promised or is owed. A title that already exists in the journal updates that entry instead of adding another, so reuse the exact title when you update. Use "when" for the in-game time (for example "Day 2, evening") whenever you are given it; otherwise an empty string. status is "none" except for quests (open or done).

Write only what the party knows or witnessed, never secrets the narration did not reveal, and never an identification the characters have not made (if the narration says only that two horses lie dead, journal two dead horses, not whose they are, even when you know). The Dungeon Master reads this journal as what the characters know. Do not journal small talk, every combat round, rolls, or the same fact twice. Be brief: titles of a few words, text of one or two sentences. Never invent facts that are not in the narration or the player's words. At most four entries per turn.`;

export function bookkeeperMessage({ message, narrative, rolls, journal, when }) {
  return [
    when ? `IN-GAME TIME: ${when}` : '',
    `JOURNAL SO FAR:\n${String(journal || '(empty)').slice(0, 3500)}`,
    `PLAYER: ${String(message || '').slice(0, 800)}`,
    (rolls && rolls.length) ? `ROLLS: ${rolls.slice(0, 8).join(' | ').slice(0, 600)}` : '',
    `DUNGEON MASTER: ${String(narrative || '').slice(0, 3000)}`
  ].filter(Boolean).join('\n\n');
}

export function cleanBookkeeperReply(raw) {
  const list = Array.isArray(raw && raw.entries) ? raw.entries : [];
  return list.map((e) => ({ type: 'journal', category: String(e.category), title: String(e.title || '').trim().slice(0, 80), text: String(e.text || '').trim().slice(0, 600), status: STATUSES.includes(e.status) ? e.status : 'none', when: String(e.when || '').trim().slice(0, 60) }))
    .filter((e) => CATEGORIES.includes(e.category) && e.title && e.text).slice(0, 4);
}
