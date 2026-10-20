// The Settings page voice cards: the Dungeon Master voice has a provider, a voice list for that provider and a model; NPC voices have a provider and their own model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
let server, page;
before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/settings', { DM_PROVIDER: 'claude', VOICE_PROVIDER: 'openai', NPC_VOICE_PROVIDER: 'same', TTS_MODEL: 'gpt-4o-mini-tts' });
  page = await launchChrome();
  await page.goto(`${server.base}/settings.html`);
  await page.waitFor('document.querySelector("#dmVoice") && document.querySelector("#dmVoice").options.length > 1');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

test('Dungeon Master voice: provider, the voices of that provider and a model; NPC voices: a provider and their own model', opts, async () => {
  const r = await page.eval(`(() => {
    const opts = (id) => [...document.querySelector(id).options].map((o) => o.value);
    return { dm: opts('#dmVoice'), dmValue: document.querySelector('#dmVoice').value, model: opts('#oaModel'), modelOff: document.querySelector('#oaModel').disabled, npc: opts('#npcProvider'), npcSelects: document.querySelectorAll('#npcCard select').length, npcModels: opts('#npcModel'), npcModelValue: document.querySelector('#npcModel').value, headings: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()) };
  })()`);
  assert.ok(r.dm.includes('onyx') && r.dm.includes('shimmer') && !r.dm.includes('') && r.dmValue === 'fable', 'ChatGPT voices, none called Automatic, Fable selected: ' + r.dm + ' / ' + r.dmValue);
  assert.ok(r.model.includes('gpt-4o-mini-tts') && !r.modelOff);
  assert.equal(r.npcSelects, 2, 'NPC voices have a provider and a model');
  assert.deepEqual(r.npc, ['none', 'openai', 'browser'], 'no Claude (it cannot speak) and no "same as the Dungeon Master" choice');
  assert.ok(r.npcModels.includes('gpt-4o-mini-tts-2025-03-20') && r.npcModels.includes('tts-1-hd') && r.npcModelValue === 'gpt-4o-mini-tts-2025-03-20', 'the NPC model starts at the 2025-03-20 release: ' + r.npcModels);
  assert.ok(r.headings.indexOf('Dungeon Master voice') < r.headings.indexOf('NPC voices') && r.headings.indexOf('NPC voices') < r.headings.indexOf('Map generators'), r.headings.join(' | '));
  // another provider, another list: Microsoft voices are the browser's own, and a person as DM turns the voice cards off
  await page.eval(`(() => { const p = document.querySelector('#voiceProvider'); p.value = 'browser'; p.dispatchEvent(new Event('change')); })()`);
  const b = await page.eval(`({ first: document.querySelector('#dmVoice').options[0].textContent, model: document.querySelector('#oaModel').disabled, note: !document.querySelector('#browserNote').hidden })`);
  assert.doesNotMatch(b.first, /Automatic/); assert.equal(b.model, true); assert.equal(b.note, true);
  await page.eval(`(() => { const p = document.querySelector('#dmProvider'); p.value = 'none'; p.dispatchEvent(new Event('change')); })()`);
  const off = await page.eval(`({ provider: document.querySelector('#voiceProvider').disabled, npc: document.querySelector('#npcProvider').disabled, save: document.querySelector('#voiceSave').disabled })`);
  assert.deepEqual(off, { provider: true, npc: true, save: true });
});

test('Dungeon Master: the model decides what the speed and effort choices offer, and the wanted speed is not lost on the way', opts, async () => {
  const r = await page.eval(`(() => {
    const $ = (s) => document.querySelector(s), fire = (el) => el.dispatchEvent(new Event('change'));
    const p = $('#dmProvider'); p.value = 'claude'; fire(p);
    const pick = (m) => { $('#dmModel').value = m; fire($('#dmModel')); };
    const view = () => ({ speedHidden: $('#dmSpeed').closest('label').offsetParent === null, speed: $('#dmSpeed').value, effort: $('#dmEffortLabel').textContent, note: $('#dmCaps').textContent });
    const out = {};
    pick('claude-opus-5-5'); $('#dmSpeed').value = 'fast'; fire($('#dmSpeed'));       // the person wants fast
    out.opus = view();
    pick('claude-sonnet-5-5'); out.sonnet55 = view();
    pick('claude-sonnet-5'); out.sonnet5 = view();
    pick('claude-opus-5-5'); out.back = view();
    return out;
  })()`);
  assert.deepEqual([r.opus.speedHidden, r.opus.speed, r.opus.effort], [false, 'fast', 'Thinking effort'], 'Opus: the Speed choice is shown, with Fast');
  assert.match(r.opus.note, /always thinks/); assert.doesNotMatch(r.opus.note, /no fast mode/);
  assert.deepEqual([r.sonnet55.speedHidden, r.sonnet55.speed, r.sonnet55.effort], [true, 'standard', 'Thinking effort'], 'Sonnet 5.5: no fast mode, so no Speed choice at all; it still thinks first');
  assert.match(r.sonnet55.note, /no fast mode/);
  assert.deepEqual([r.sonnet5.speedHidden, r.sonnet5.speed, r.sonnet5.effort], [true, 'standard', 'Reply effort'], 'Sonnet 5: no Speed choice, and no thinking step so the effort is about the reply');
  assert.match(r.sonnet5.note, /straight away/);
  assert.deepEqual([r.back.speedHidden, r.back.speed], [false, 'fast'], 'back on Opus, the Speed choice returns with the speed that was wanted');
  // saving on a model with no fast mode must not overwrite the speed the person chose
  await server.post('/api/settings', { ANTHROPIC_MODEL: 'claude-opus-5-5', DM_SPEED: 'fast' });
  await page.eval(`(() => { const $ = (s) => document.querySelector(s), fire = (el) => el.dispatchEvent(new Event('change')); $('#dmModel').value = 'claude-sonnet-5'; fire($('#dmModel')); $('#dmSave').click(); })()`);
  await page.waitFor(`document.querySelector('#dmMsg').textContent.length > 0`);
  const saved = (await server.get('/api/settings')).json.dm;
  assert.equal(saved.model, 'claude-sonnet-5'); assert.equal(saved.speed, 'fast', 'the saved speed stays Fast, ready for when an Opus model is chosen again');
  assert.equal(saved.caps.fast, false); assert.ok(saved.models.some((m) => m.id === 'claude-opus-5-5' && m.fast === true));
  await server.post('/api/settings', { ANTHROPIC_MODEL: 'claude-opus-5-5' });
});
