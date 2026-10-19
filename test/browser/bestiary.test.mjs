// The Bestiary's voice box: each creature shows its voice and acting notes, they can be edited and saved, and the campaign's own creatures are in the list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
let server, page;
before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/campaigns/active', { id: 'lost-mine-of-phandelver' });
  page = await launchChrome();
  await page.goto(`${server.base}/bestiary.html#goblin`);
  await page.waitFor('document.querySelector(".voicebox")');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

test('a goblin shows its voice and notes, an edit is saved and can be undone, and the campaign creatures are listed', opts, async () => {
  const r = await page.eval(`({ voice: document.querySelector('.voicebox select').value, notes: document.querySelector('.voicebox textarea').value, tag: document.querySelector('.vtag').textContent, buttons: [...document.querySelectorAll('.voicebox button')].map((b) => b.textContent) })`);
  assert.equal(r.voice, 'ash'); assert.match(r.notes, /wiry goblin/); assert.match(r.tag, /chosen/);
  assert.deepEqual(r.buttons, ['▶ Preview', 'Save', 'Back to the default']);
  await page.eval(`(() => { const s = document.querySelector('.voicebox select'); s.value = 'fable'; const t = document.querySelector('.voicebox textarea'); t.value = 'Squeaky and gleeful.'; [...document.querySelectorAll('.voicebox button')].find((b) => b.textContent === 'Save').click(); })()`);
  await page.waitFor(`document.querySelector('.vtag').textContent.includes('edited')`);
  const saved = (await server.get('/api/creature-voices')).json.srd.find((m) => m.index === 'goblin');
  assert.deepEqual([saved.voice, saved.acting, saved.source], ['fable', 'Squeaky and gleeful.', 'edited']);
  await page.eval(`[...document.querySelectorAll('.voicebox button')].find((b) => b.textContent === 'Back to the default').click()`);
  await page.waitFor(`document.querySelector('.vtag').textContent.includes('chosen')`);
  assert.equal((await server.get('/api/creature-voices')).json.srd.find((m) => m.index === 'goblin').voice, 'ash');
  // the campaign's own creature: in the list, its numbers, and its own voice box
  await page.eval(`document.querySelector('.item[data-index="redbrand-ruffian"]').click()`);
  await page.waitFor(`document.querySelector('.block h2') && document.querySelector('.block h2').textContent === 'Redbrand Ruffian'`);
  const a = await page.eval(`({ attacks: document.querySelector('.block').textContent.includes('Shortsword'), own: !!document.querySelector('.item[data-index="redbrand-ruffian"] .own'), voice: document.querySelector('.voicebox select').value })`);
  assert.equal(a.attacks, true); assert.equal(a.own, true); assert.equal(a.voice, 'ash');
});
