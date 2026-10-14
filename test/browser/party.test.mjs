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
  await page.eval(`document.querySelector('#collapseAll').click()`);
  const closed = await page.eval(`[...document.querySelectorAll('details.acc')].every((d) => !d.open)`);
  assert.equal(closed, true);
  await page.eval(`location.reload()`);
  await page.waitFor('document.querySelector("details.card")');
  const kept = await page.eval(`[...document.querySelectorAll('details.acc')].every((d) => !d.open)`);
  assert.equal(kept, true, 'closed state survives a reload');
  await page.eval(`document.querySelector('#expandAll').click()`);
  assert.equal(await page.eval(`[...document.querySelectorAll('details.acc')].every((d) => d.open)`), true);
});
