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
    return { dm: opts('#dmVoice'), model: opts('#oaModel'), modelOff: document.querySelector('#oaModel').disabled, npc: opts('#npcProvider'), npcSelects: document.querySelectorAll('#npcCard select').length, npcModels: opts('#npcModel'), npcModelValue: document.querySelector('#npcModel').value, headings: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()) };
  })()`);
  assert.ok(r.dm.includes('onyx') && r.dm.includes('shimmer') && r.dm[0] === '', 'ChatGPT voices plus Automatic: ' + r.dm);
  assert.ok(r.model.includes('gpt-4o-mini-tts') && !r.modelOff);
  assert.equal(r.npcSelects, 2, 'NPC voices have a provider and a model');
  assert.deepEqual(r.npc.filter((v) => v !== 'claude'), ['none', 'openai', 'browser'], 'there is no "same as the Dungeon Master" choice');
  assert.ok(r.npcModels.includes('gpt-4o-mini-tts-2025-03-20') && r.npcModels.includes('tts-1-hd') && r.npcModelValue === 'gpt-4o-mini-tts-2025-03-20', 'the NPC model starts at the 2025-03-20 release: ' + r.npcModels);
  assert.ok(r.headings.indexOf('Dungeon Master voice') < r.headings.indexOf('NPC voices') && r.headings.indexOf('NPC voices') < r.headings.indexOf('Map generators'), r.headings.join(' | '));
  // another provider, another list: Microsoft voices are the browser's own, and a person as DM turns the voice cards off
  await page.eval(`(() => { const p = document.querySelector('#voiceProvider'); p.value = 'browser'; p.dispatchEvent(new Event('change')); })()`);
  const b = await page.eval(`({ first: document.querySelector('#dmVoice').options[0].textContent, model: document.querySelector('#oaModel').disabled, note: !document.querySelector('#browserNote').hidden })`);
  assert.match(b.first, /Automatic \(the best voice this browser has\)/); assert.equal(b.model, true); assert.equal(b.note, true);
  await page.eval(`(() => { const p = document.querySelector('#dmProvider'); p.value = 'none'; p.dispatchEvent(new Event('change')); })()`);
  const off = await page.eval(`({ provider: document.querySelector('#voiceProvider').disabled, npc: document.querySelector('#npcProvider').disabled, save: document.querySelector('#voiceSave').disabled })`);
  assert.deepEqual(off, { provider: true, npc: true, save: true });
});
