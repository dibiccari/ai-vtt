// The inventory wizard on the Party pop-out: buy in the shop, take off armor and see the armor class follow, review and confirm.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';
import { ID } from '../helpers/ids.mjs';

const skip = skipReason();
let server, page;
before(async () => {
  if (skip) return;
  server = await startServer();
  page = await launchChrome();
  await page.goto(`${server.base}/party.html?embed=1&character=${ID.edric}`);
  await page.waitFor('document.querySelector(".card.solo")');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };
const tab = (name) => page.eval(`[...document.querySelectorAll('dialog.wiz .tabs button')].find((b) => b.textContent.startsWith(${JSON.stringify(name)})).click()`);
const live = () => page.eval(`document.querySelector('dialog.wiz .live').textContent`);

test('buy a dagger, take off the chain mail, review and confirm: the sheet follows', opts, async () => {
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Manage gear…').click()`);
  await page.waitFor('document.querySelector("dialog.wiz[open] .shoplist table")');
  await page.waitFor('/Armor Class/.test(document.querySelector("dialog.wiz .live").textContent)');
  assert.match(await live(), /Armor Class 18/);
  const gp0 = await page.eval(`fetch('/api/party').then((r) => r.json()).then((d) => d.characters.find((c) => c.id === '${ID.edric}').coins.gp)`);
  await page.eval(`(() => { const q = document.querySelector('dialog.wiz .filters input'); q.value = 'Dagger'; q.dispatchEvent(new Event('input')); })()`);
  await page.eval(`[...document.querySelectorAll('dialog.wiz .shoplist tr')].find((r) => /^Dagger/.test(r.textContent)).querySelector('button').click()`);
  await page.waitFor(`/Bought 1 × Dagger/.test(document.querySelector('dialog.wiz footer span').textContent)`);
  await tab('Carried');
  assert.ok(await page.eval(`[...document.querySelectorAll('dialog.wiz td')].some((t) => /^Dagger/.test(t.textContent))`), 'the dagger is carried');
  await page.eval(`(() => { const row = [...document.querySelectorAll('dialog.wiz tr')].find((r) => /^Chain mail/.test(r.textContent)); const cb = row.querySelector('input[type=checkbox]'); cb.checked = false; cb.dispatchEvent(new Event('change')); })()`);
  await page.waitFor(`/Armor Class 14/.test(document.querySelector('dialog.wiz .live').textContent)`);
  assert.match(await live(), /\(was 18\)/);
  await page.eval(`[...document.querySelectorAll('dialog.wiz footer button')].find((b) => b.textContent === 'Review changes').click()`);
  const review = await page.eval(`document.querySelector('dialog.wiz .body').textContent`);
  assert.match(review, /New: 1 × Dagger/); assert.match(review, /Chain mail is put away/); assert.match(review, /Armor Class 18 → 14/);
  await page.eval(`[...document.querySelectorAll('dialog.wiz footer button')].find((b) => b.textContent === 'Confirm').click()`);
  await page.waitFor('!document.querySelector("dialog.wiz")');
  const after1 = await page.eval(`fetch('/api/characters').then((r) => r.json()).then((l) => l.find((c) => c.id === '${ID.edric}'))`);
  assert.equal(after1.sheet.AC, '14'); assert.match(after1.sheet.Equipment, /Dagger/); assert.equal(Number(after1.sheet.GP), gp0 - 2);
  assert.ok(after1.sheetLog.at(-1).changes.some((c) => c.field === 'AC'), 'the change is in the sheet log');
});
