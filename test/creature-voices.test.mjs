// Voices for creatures (lib/creature-voices.js): defaults by type and size, hand-written ones, the user's edits, name matching, and the API the Bestiary uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultVoice, voiceFor, findCreature, createStore, HAND, TYPE_VOICES, OPENAI_VOICES } from '../lib/creature-voices.js';
import { startServer } from './helpers/sandbox.mjs';

const monsters = JSON.parse(readFileSync(new URL('../data/srd/monsters.json', import.meta.url), 'utf8'));
const by = (i) => monsters.find((m) => m.index === i);

test('every creature has a valid default voice; the hand-written ones are for real creatures and real voices', () => {
  for (const m of monsters) { const d = defaultVoice(m); assert.ok(OPENAI_VOICES.includes(d.voice) && d.acting.length > 20, m.index); }
  for (const [k, v] of Object.entries(HAND)) { assert.ok(by(k) || ['redbrand-ruffian', 'evil-mage', 'mormesk-the-wraith', 'flameskull', 'nothic', 'spectator', 'twig-blight'].includes(k), k); assert.ok(OPENAI_VOICES.includes(v.voice), k); }
  for (const v of Object.values(TYPE_VOICES)) assert.ok(OPENAI_VOICES.includes(v.voice));
  assert.equal(defaultVoice(by('goblin')).source, 'chosen'); assert.match(defaultVoice(by('goblin')).acting, /wiry goblin/);
  assert.equal(defaultVoice(by('zombie')).voice, 'ballad');
});

test('a beast with no entry of its own sounds by its size, a creature type by its type', () => {
  const rat = defaultVoice({ index: 'x-rat', type: 'beast', size: 'Tiny' }), bear = defaultVoice({ index: 'x-bear', type: 'beast', size: 'Large' }), dragon = defaultVoice({ index: 'x-wyrm', type: 'dragon', size: 'Huge' });
  assert.equal(rat.voice, 'shimmer'); assert.equal(bear.voice, 'onyx'); assert.match(dragon.acting, /ancient dragon/);
  assert.match(defaultVoice({ index: 'swarm-of-bats', type: 'swarm of Tiny beasts', size: 'Medium' }).acting, /swarm/);
});

test('edits win over the default, a bad voice name is ignored, and a speaker name finds its creature', () => {
  const g = by('goblin');
  const e = voiceFor(g, { goblin: { voice: 'fable', acting: 'Squeaky and gleeful.' } });
  assert.deepEqual([e.voice, e.acting, e.source], ['fable', 'Squeaky and gleeful.', 'edited']);
  assert.equal(voiceFor(g, { goblin: { voice: 'not-a-voice', acting: '' } }).voice, defaultVoice(g).voice);
  const lists = [monsters, [{ index: 'redbrand-ruffian', name: 'Redbrand Ruffian' }]];
  for (const name of ['Goblin 2', 'goblin', 'The Goblin', 'Goblin #3', 'Goblin (archer) 1']) assert.equal(findCreature(name, lists)?.index, 'goblin', name);
  assert.equal(findCreature('Redbrand Ruffian 4', lists)?.index, 'redbrand-ruffian');
  assert.equal(findCreature('Goblin Chief', lists), null); assert.equal(findCreature('Toblen Stonehill', lists), null); assert.equal(findCreature('', lists), null);
});

test('the store keeps only edits, rejects odd names and resets', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cv-'));
  try {
    const st = createStore(dir);
    assert.deepEqual(await st.read(), {});
    await st.set('goblin', 'fable', 'Gleeful.'); assert.deepEqual((await st.read()).goblin, { voice: 'fable', acting: 'Gleeful.' });
    await assert.rejects(st.set('../x', 'fable', 'x'));
    await st.set('goblin', '', ''); assert.deepEqual(await st.read(), {}, 'nothing left to keep means no entry');
    await st.set('wolf', 'onyx', 'Low.'); await st.reset('wolf'); assert.deepEqual(await st.read(), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

let s;
before(async () => { s = await startServer(); await s.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' }); });
after(async () => { await s.stop(); });

test('the API: every creature with its voice, edits and resets, and the voice a speaker gets', async () => {
  const all = (await s.get('/api/creature-voices')).json;
  assert.ok(all.srd.length === 334 && all.voices.includes('fable') && all.adventure.some((m) => m.index === 'redbrand-ruffian'));
  assert.equal(all.srd.find((m) => m.index === 'goblin').voice, 'ash');
  const who = async (speaker) => (await s.post('/api/tts/voices', { items: [{ speaker, voice: 'monstrous' }] })).json.voices[0].voice;
  assert.equal(await who('Goblin 2'), 'ash', 'a numbered goblin is a goblin');
  assert.equal(await who('Klarg'), 'onyx', 'a named character keeps the campaign voice');
  const put = await s.put('/api/creature-voices/goblin', { voice: 'shimmer', acting: 'Tiny and shrill.' });
  assert.equal(put.status, 200); assert.deepEqual([put.json.voice, put.json.source], ['shimmer', 'edited']);
  assert.equal(await who('Goblin 2'), 'shimmer', 'the edit is used at once');
  assert.equal((await s.get('/api/creature-voices')).json.srd.find((m) => m.index === 'goblin').acting, 'Tiny and shrill.');
  const del = await s.del('/api/creature-voices/goblin'); assert.equal(del.json.source, 'chosen'); assert.equal(await who('Goblin 2'), 'ash');
  assert.equal((await s.put('/api/creature-voices/not-a-creature', { voice: 'fable' })).status, 404);
  assert.equal((await s.put('/api/creature-voices/redbrand-ruffian', { voice: 'echo', acting: 'Mean.' })).json.voice, 'echo', 'the campaign\'s own creatures can be edited too');
});
