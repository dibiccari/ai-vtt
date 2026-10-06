// lib/journal.js, lib/safety.js, lib/settings.js: cleaning, saving and what the DM is told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CATEGORIES, STATUSES, readSave, replaceEntries, addJournalUpdates, journalForPrompt } from '../lib/journal.js';
import { cleanSafety, readSafety, writeSafety, safetyForPrompt } from '../lib/safety.js';
import { cleanSettings, readSettings, writeSettings, settingsForPrompt, DEFAULT_SETTINGS } from '../lib/settings.js';

const tmp = async (fn) => { const dir = await mkdtemp(path.join(tmpdir(), 'vtt-lib-')); try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } };

test('journal: events always add, other categories upsert by title, bad input is cleaned', () => tmp(async (dir) => {
  assert.deepEqual((await readSave(dir)).entries, []);
  await addJournalUpdates(dir, [
    { category: 'event', title: 'Ambush', text: 'Goblins on the road.' },
    { category: 'event', title: 'Ambush', text: 'Again.' },
    { category: 'npc', title: 'Sildar', text: 'Captured.', status: 'open' },
    { category: 'bogus', title: 'Odd', text: 'Unknown categories become events.', status: 'weird' },
    { category: 'quest', title: '', text: 'no title' },
    { category: 'quest', title: 'No text', text: '' }
  ]);
  let { entries } = await readSave(dir);
  assert.equal(entries.length, 4);
  assert.ok(entries.every((e) => CATEGORIES.includes(e.category) && STATUSES.includes(e.status)));
  assert.equal(entries.find((e) => e.title === 'Odd').category, 'event');
  await addJournalUpdates(dir, [{ category: 'npc', title: 'sildar', text: 'Rescued.', status: 'done', when: 'Day 2' }]);
  entries = (await readSave(dir)).entries;
  assert.equal(entries.filter((e) => e.category === 'npc').length, 1);
  const sildar = entries.find((e) => e.category === 'npc');
  assert.equal(sildar.text, 'Rescued.'); assert.equal(sildar.status, 'done'); assert.equal(sildar.when, 'Day 2');
  await replaceEntries(dir, []);
  assert.deepEqual((await readSave(dir)).entries, []);
}));

test('journal: concurrent writes are queued, not lost', () => tmp(async (dir) => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => addJournalUpdates(dir, [{ category: 'event', title: `E${i}`, text: 'x' }])));
  assert.equal((await readSave(dir)).entries.length, 20);
}));

test('journal: long text is truncated and the prompt text is bounded', () => tmp(async (dir) => {
  await addJournalUpdates(dir, [{ category: 'event', title: 'T'.repeat(200), text: 'x'.repeat(2000) }]);
  const [e] = (await readSave(dir)).entries;
  assert.equal(e.title.length, 80); assert.equal(e.text.length, 600);
  assert.equal(journalForPrompt([]), '');
  const many = Array.from({ length: 100 }, (_, i) => ({ category: 'npc', title: `N${i}`, text: 'y'.repeat(300), status: 'open', when: '' }));
  assert.ok(journalForPrompt(many).length <= 9000);
  assert.match(journalForPrompt([{ category: 'quest', title: 'Find it', text: 'Look.', status: 'open', when: '' }]), /\[quest, open\] Find it/);
}));

test('safety: lists from text or arrays, trimmed and capped; prompt is empty when nothing is agreed', () => tmp(async (dir) => {
  assert.deepEqual(cleanSafety({ lines: 'spiders\n\n  gore  ', veils: ['romance', ''], notes: ' hi ' }), { lines: ['spiders', 'gore'], veils: ['romance'], notes: 'hi' });
  assert.equal(cleanSafety({ lines: Array.from({ length: 60 }, (_, i) => 'l' + i) }).lines.length, 30);
  assert.equal(safetyForPrompt(cleanSafety({})), '');
  const s = await writeSafety(dir, { lines: ['clowns'] });
  assert.deepEqual(await readSafety(dir), s);
  assert.match(safetyForPrompt(s), /Lines, never to appear.*clowns/);
  assert.deepEqual(await readSafety(path.join(dir, 'nowhere')), { lines: [], veils: [], notes: '' });
}));

test('settings: defaults, validation, round trip and the prompt follows the switches', () => tmp(async (dir) => {
  assert.deepEqual(await readSettings(dir), DEFAULT_SETTINGS);
  assert.deepEqual(cleanSettings({ permadeath: 'yes', rules: '2019', variantEncumbrance: 1 }), DEFAULT_SETTINGS, 'only real booleans and known rules count');
  const s = await writeSettings(dir, { permadeath: true, rules: '2024', variantEncumbrance: true, tableNotes: ' no puns ' });
  assert.deepEqual(await readSettings(dir), s);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).version, 1);
  const on = settingsForPrompt(s), off = settingsForPrompt(DEFAULT_SETTINGS);
  assert.match(on, /2024/); assert.match(on, /Death: permanent/); assert.match(on, /optional variant rule is on/); assert.match(on, /no puns/);
  assert.match(off, /2014/); assert.match(off, /no permanent character death/); assert.match(off, /standard rule only/);
}));
