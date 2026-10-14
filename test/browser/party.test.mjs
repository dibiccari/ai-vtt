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
  await page.waitFor('document.querySelector("details.card")');
  const out = await page.eval(`(() => ({ cards: document.querySelectorAll('details.card').length, name: document.querySelector('details.card h3').textContent, nav: !!document.querySelector('nav, #navBar, .topnav'), pop: !!document.querySelector('details.card .head button'), open: document.querySelector('details.card').open }))()`);
  assert.equal(out.cards, 1); assert.equal(out.name, 'Astarion'); assert.equal(out.nav, false); assert.equal(out.pop, false); assert.equal(out.open, true);
});
