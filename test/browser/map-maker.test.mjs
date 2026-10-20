// The Map Maker wizard page, start to finish: pick a battle map and a size, Surprise me, design the layout (pretend Anthropic), spoil the grid by hand and see it refused, mend it,
// paint (pretend OpenAI images), look at the layout over the picture, name it, Save, and land in Map Test with the new place open.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer, fakeAnthropic } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';
import { compileLayout, layoutPng } from '../../lib/map-layout.js';

const skip = skipReason();
const GOOD = ['##########', '#P.......#', '#........#', '######D###', '#........#', '#..L...E.#', '#..O.....#', '##########'];
// what the pretend designer returns for a Medium (36 x 24) map
const BIG = Array.from({ length: 24 }, (_, r) => (r === 0 || r === 23 ? '#'.repeat(36) : '#' + (r === 1 ? 'P' : r === 5 ? '..L' : r === 20 ? '.....E' : '.').padEnd(34, '.') + '#'));
let fake, images, server, page;
before(async () => {
  if (skip) return;
  fake = await fakeAnthropic([{ name: 'Test hall', summary: 'A hall.', setting: 'indoor', rows: BIG }]);
  const png = layoutPng(compileLayout(GOOD), { width: 1536, height: 1024 }).toString('base64');
  images = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: png }] })); }); });
  await new Promise((r) => images.listen(0, '127.0.0.1', r));
  server = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake', ANTHROPIC_BASE_URL: fake.url, OPENAI_API_KEY: 'sk-fake', VTT_OPENAI_IMAGES_BASE: `http://127.0.0.1:${images.address().port}` } });
  page = await launchChrome();
  await page.goto(`${server.base}/map-maker.html`);
  await page.waitFor('document.querySelectorAll("#kindCards .kind").length === 3 && document.querySelector("#szSize").options.length === 5');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); if (fake) await fake.close(); if (images) await new Promise((r) => images.close(r)); });
const opts = { skip: skip || false };
const visible = (page) => page.eval(`[...document.querySelectorAll('#make .wz')].filter((p) => !p.hidden).map((p) => p.dataset.step)`);
const click = (page, sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);

test('the wizard walks a battle map from the idea to Map Test', opts, async () => {
  assert.deepEqual(await visible(page), ['type']);
  assert.equal(await page.eval(`document.querySelector('#typeNext').disabled`), true, 'a type must be chosen first');
  await click(page, '#kindCards [data-kind="battle"]');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#wzSteps li')].map((l) => l.textContent)`), ['1. Type', '2. Describe', '3. Layout', '4. Paint', '5. Save']);
  assert.equal(await page.eval(`document.querySelector('#szBox').hidden`), false, 'battle maps ask for a size');
  assert.deepEqual(await page.eval(`[...document.querySelector('#szSize').options].map((o) => o.value)`), ['small', 'medium', 'large', 'huge', 'enormous']);
  await page.eval(`(() => { const s = document.querySelector('#szSize'); s.value = 'medium'; s.dispatchEvent(new Event('change')); })()`);
  await click(page, '#typeNext');
  assert.deepEqual(await visible(page), ['describe']);

  assert.equal(await page.eval(`document.querySelector('#descNext').disabled`), true, 'nothing to design from yet');
  // the Cragmaw Hideout button: fills in the description and sets the size to Small (30 x 20), whatever was chosen before
  await page.waitFor(`document.querySelectorAll('#wzExamples button').length === 1`);
  await click(page, '#wzExamples button');
  assert.match(await page.eval(`document.querySelector('#wzText').value`), /Cragmaw Hideout/);
  assert.equal(await page.eval(`document.querySelector('#szSize').value`), 'small');
  assert.match(await page.eval(`document.querySelector('#wzExampleNote').textContent`), /30 x 20 squares/);
  assert.equal(await page.eval(`document.querySelector('#descNext').disabled`), false);
  await page.eval(`(() => { const t = document.querySelector('#wzText'); t.value = ''; t.dispatchEvent(new Event('input')); const s = document.querySelector('#szSize'); s.value = 'medium'; s.dispatchEvent(new Event('change')); })()`);
  fake.__set({ name: 'idea', summary: '', setting: 'indoor', rows: GOOD });       // Surprise me answers with plain text; the pretend API only knows JSON, which is fine as an "idea"
  await click(page, '#wzSurprise');
  await page.waitFor(`document.querySelector('#wzText').value.length > 0`);
  assert.equal(await page.eval(`document.querySelector('#descNext').disabled`), false);
  assert.equal(await page.eval(`document.querySelector('#descNext').textContent`), 'Design the layout');
  await page.eval(`(() => { const t = document.querySelector('#wzText'); t.value = 'a small keep with a guard room and a storeroom'; t.dispatchEvent(new Event('input')); })()`);
  fake.requests.length = 0; fake.__set({ name: 'Test hall', summary: 'A hall.', setting: 'indoor', rows: BIG });
  // while the AI works there is a spinner with the words and a running clock (looked at in the same breath as the click, before any answer can arrive); it goes away when the answer is in
  const waiting = await page.eval(`(() => { document.querySelector('#descNext').click(); const bar = document.querySelector('#wzBusy'); return { shown: !bar.hidden, spins: getComputedStyle(bar.querySelector('.spinner')).animationName, words: document.querySelector('#wzBusyText').textContent, clock: document.querySelector('#wzBusyTime').textContent }; })()`);
  assert.equal(waiting.shown, true); assert.equal(waiting.spins, 'spin'); assert.match(waiting.words, /layout/); assert.match(waiting.clock, /^\d+ s$/);
  await page.waitFor(`document.querySelector('[data-step="layout"]') && !document.querySelector('[data-step="layout"]').hidden && document.querySelector('#lySvg svg')`);
  assert.match(JSON.stringify(fake.requests[0].system), /exactly 36 characters wide and 24 rows tall/, 'the chosen size reached the designer');
  assert.equal(await page.eval(`document.querySelector('#wzBusy').hidden`), true, 'the spinner is gone once the layout is shown');
  assert.equal(await page.eval(`document.querySelector('#lyOk').textContent`), 'Playable');
  assert.equal(await page.eval(`document.querySelector('#layoutNext').disabled`), false);
  assert.match(await page.eval(`document.querySelector('#lyCost').textContent`), /about \$/);

  // a change in words: the grid on the page becomes what the AI sends back, and Undo goes back
  const CHANGED = BIG.map((r, i) => (i === 2 ? '#...O' + '.'.repeat(30) + '#' : r));
  fake.__set({ name: 'Test hall', summary: 'Added a pillar.', setting: 'indoor', rows: CHANGED }); fake.requests.length = 0;
  assert.equal(await page.eval(`document.querySelector('#lyUndo').disabled`), true, 'nothing to undo yet');
  await page.eval(`document.querySelector('#lyWords').value = 'put a pillar in the upper room'`);
  await click(page, '#lyChange');
  await page.waitFor(`document.querySelector('#lyGrid').value.includes('#...O.')`);
  assert.match(JSON.stringify(fake.requests[0].messages), /put a pillar in the upper room/);
  assert.equal(await page.eval(`document.querySelector('#lyWords').value`), '', 'the box is cleared');
  assert.equal(await page.eval(`document.querySelector('#lyUndo').disabled`), false);
  await click(page, '#lyUndo');
  await page.waitFor(`!document.querySelector('#lyGrid').value.includes('#...O.') && document.querySelector('#lyUndo').disabled`);
  assert.equal(await page.eval(`document.querySelector('#lyOk').textContent`), 'Playable');

  // a hand edit that cuts the lower room off is refused, and mending it brings the Next button back
  await page.eval(`(() => { document.querySelector('#lyGrid').value = ${JSON.stringify(['##########', '#P.......#', '#........#', '##########', '#........#', '#..L...E.#', '#..O.....#', '##########'].join('\n'))}; })()`);
  await click(page, '#lyCheck');
  await page.waitFor(`document.querySelector('#lyOk').textContent.startsWith('Not playable')`);
  assert.equal(await page.eval(`document.querySelector('#layoutNext').disabled`), true);
  assert.match(await page.eval(`document.querySelector('#lyProblems').textContent`), /cannot be reached/);
  await page.eval(`document.querySelector('#lyGrid').value = ${JSON.stringify(GOOD.join('\n'))}`);
  await click(page, '#lyCheck');
  await page.waitFor(`document.querySelector('#lyOk').textContent === 'Playable'`);
  // back to the description and on again keeps the layout (no new paid call); changing the description would ask for a new one
  const askedBefore = fake.requests.length;
  await click(page, '#layoutBack'); await click(page, '#descNext');
  assert.deepEqual(await visible(page), ['layout']); assert.equal(fake.requests.length, askedBefore, 'no second call to the AI');
  assert.equal(await page.eval(`document.querySelector('#layoutNext').disabled`), false);
  await click(page, '#layoutNext');

  assert.deepEqual(await visible(page), ['paint']);
  await page.waitFor(`document.querySelector('#pvProvider') && document.querySelector('#pvProvider').options.length > 0 && !document.querySelector('#paintForm').hidden`);
  assert.deepEqual(await page.eval(`[...document.querySelector('#pvProvider').options].map((o) => o.value)`), ['openai'], 'only the service with a key');
  assert.match(await page.eval(`document.querySelector('#pvPaint').textContent`), /Paint it \(about \$0\.0/);
  assert.equal(await page.eval(`document.querySelector('#paintNext').disabled`), true, 'no way on to Save before there is a picture');
  await click(page, '#pvPaint');
  await page.waitFor(`!document.querySelector('#paintResult').hidden && document.querySelector('#pvImg').naturalWidth === 1536`);
  assert.match(await page.eval(`document.querySelector('#pvFacts').textContent`), /1536 x 1024/);
  assert.equal(await page.eval(`document.querySelector('#pvOverlayRow').hidden`), false, 'a battle map can be compared with its layout');
  assert.ok(await page.eval(`document.querySelector('#pvSvg svg') !== null`));
  // the painting belongs to what it was made from: changing the description drops it, and Save is shut again
  await page.eval(`(() => { const t = document.querySelector('#wzText'); t.value += ' with a well'; t.dispatchEvent(new Event('input')); })()`);
  assert.equal(await page.eval(`document.querySelector('#paintNext').disabled`), true, 'a painting of the old description is not kept');
  await page.eval(`(() => { const t = document.querySelector('#wzText'); t.value = t.value.replace(' with a well', ''); t.dispatchEvent(new Event('input')); })()`);
  await click(page, '#pvPaint');
  await page.waitFor(`!document.querySelector('#paintResult').hidden && document.querySelector('#pvImg').naturalWidth === 1536 && !document.querySelector('#paintNext').disabled`);
  await click(page, '#paintNext');

  assert.deepEqual(await visible(page), ['save']);
  await page.waitFor(`document.querySelector('#sImg').naturalWidth === 1536`);
  assert.equal(await page.eval(`!document.querySelector('#sPreview').hidden && !document.querySelector('#sSave').disabled`), true, 'the picture to be saved is shown, and Save is allowed');
  assert.equal(await page.eval(`document.querySelector('#sName').value`), 'Test hall', 'named by the designer');
  await page.eval(`document.querySelector('#sName').value = 'The Wizard Keep'`);
  await click(page, '#sSave');
  await page.waitFor(`location.pathname === '/map-test.html' && /set=[0-9a-f-]{36}/.test(location.search)`, 20000);
  const sets = (await server.get('/api/mapsets')).json.sets;
  assert.ok(sets.some((x) => x.name === 'The Wizard Keep' && x.kind === 'battle'), 'the new place exists');
});

test('town and regional maps skip the layout step', opts, async () => {
  await page.goto(`${server.base}/map-maker.html`);
  await page.waitFor('document.querySelectorAll("#kindCards .kind").length === 3');
  await click(page, '#kindCards [data-kind="town"]');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#wzSteps li')].map((l) => l.textContent)`), ['1. Type', '2. Describe', '3. Paint', '4. Save']);
  assert.equal(await page.eval(`document.querySelector('#szBox').hidden`), true);
  await click(page, '#typeNext');
  await page.eval(`(() => { const t = document.querySelector('#wzText'); t.value = 'a river port with a stone bridge'; t.dispatchEvent(new Event('input')); })()`);
  assert.equal(await page.eval(`document.querySelector('#descNext').textContent`), 'Next: choose a painter');
  await click(page, '#descNext');
  assert.deepEqual(await visible(page), ['paint']);
});

test('the notes tab still holds the old requests and feedback', opts, async () => {
  await click(page, '#tabNotes');
  assert.equal(await page.eval(`document.querySelector('#notes').hidden`), false);
  assert.equal(await page.eval(`document.querySelector('#make').hidden`), true);
  assert.ok(await page.eval(`document.querySelector('#rAdd') !== null && document.querySelector('#requests') !== null`));
});
