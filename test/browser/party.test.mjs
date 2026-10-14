// The Party page: each character is an accordion with sections, the open state is remembered, Collapse all / Expand all work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
let server, page;
before(async () => {
  if (skip) return;
  server = await startServer();
  page = await launchChrome();
  await page.goto(`${server.base}/party.html`);
  await page.waitFor('document.querySelector("details.card")');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

test('party cards fold into accordions and remember it', opts, async () => {
  const first = await page.eval(`(() => ({ cards: document.querySelectorAll('details.card').length, sections: document.querySelectorAll('details.card details.sec').length, open: [...document.querySelectorAll('details.card')].every((d) => d.open) }))()`);
  assert.ok(first.cards >= 2); assert.ok(first.sections >= (first.cards - 1) * 4); assert.equal(first.open, true);
  await page.eval(`document.querySelector('details.card > summary').click()`);
  assert.equal(await page.eval(`document.querySelector('details.card').open`), false);
  await page.eval(`location.reload()`);
  await page.waitFor('document.querySelector("details.card")');
  assert.equal(await page.eval(`document.querySelector('details.card').open`), false, 'closed state survives a reload');
});

test('a pop-out shows one character, with no navigation bar and no stash', opts, async () => {
  await page.goto(`${server.base}/party.html?embed=1&character=astarion`);
  await page.waitFor('document.querySelector(".card.solo")');
  const out = await page.eval(`(() => ({ cards: document.querySelectorAll('.card').length, name: document.querySelector('.card h3').textContent, nav: !!document.querySelector('nav, #navBar, .topnav'), pop: !!document.querySelector('details.card .head button'), folds: document.querySelectorAll('details').length, emptyBars: [...document.querySelectorAll('#status, #clock')].filter((e) => e.offsetHeight > 0).length }))()`);
  assert.equal(out.cards, 1); assert.equal(out.name, 'Astarion'); assert.equal(out.nav, false); assert.equal(out.pop, false); assert.equal(out.folds, 0); assert.equal(out.emptyBars, 0);
});

test('the level-up wizard walks the steps and levels the character', opts, async () => {
  await page.goto(`${server.base}/party.html?embed=1&character=astarion`);
  await page.waitFor('document.querySelector(".card.solo")');
  await page.eval(`[...document.querySelectorAll('button')].find((b) => /Level up/.test(b.textContent)).click()`);
  await page.waitFor('document.querySelector("dialog.wiz[open]")');
  const steps = await page.eval(`[...document.querySelectorAll('dialog.wiz .steps span')].map((s) => s.textContent)`);
  assert.deepEqual(steps, ['1. Hit points', '2. New features', '3. Review']);
  const feature = await page.eval(`(document.querySelector('dialog.wiz') && (document.querySelector('dialog.wiz .body').textContent))`);
  assert.match(feature, /Hit die d8/);
  const click = (label) => page.eval(`[...document.querySelectorAll('dialog.wiz footer button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
  await click('Next');
  assert.match(await page.eval(`document.querySelector('dialog.wiz .body').textContent`), /Cunning Action/);
  await click('Next');
  assert.match(await page.eval(`document.querySelector('dialog.wiz .body').textContent`), /becomes a level 2 Rogue/);
  await click('Level up');
  await page.waitFor('!document.querySelector("dialog.wiz")');
  const res = await page.eval(`fetch('/api/party').then((r) => r.json()).then((d) => d.characters.find((c) => c.id === 'astarion').level)`);
  assert.equal(res, 2);
});
