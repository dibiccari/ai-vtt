// The Level-up Test page: a throwaway character walks the real wizard up several levels without saving anything.
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
  await page.goto(`${server.base}/dev/levelup-test.html`);
  await page.waitFor('document.querySelectorAll("#cls option").length > 5');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };
const click = (label) => page.eval(`[...document.querySelectorAll('dialog.wiz footer button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
const body = () => page.eval(`document.querySelector('dialog.wiz .body').textContent`);

test('a fighter is levelled from 3 to 4 and takes an ability score improvement, nothing saved', opts, async () => {
  await page.eval(`document.querySelector('#cls').value = 'Fighter'; document.querySelector('#level').value = '3'; document.querySelector('#start').click()`);
  await page.waitFor('document.querySelector("#stage h2")');
  assert.match(await page.eval(`document.querySelector('#stage h2').textContent`), /Fighter 3/);
  const names = await page.eval(`fetch('/api/characters').then((r) => r.json()).then((l) => l.map((c) => c.name))`);
  await page.eval(`[...document.querySelectorAll('#stage button')].find((b) => /Level up to 4/.test(b.textContent)).click()`);
  await page.waitFor('document.querySelector("dialog.wiz[open]")');
  await click('Next'); await click('Next');
  assert.match(await body(), /Points spent: 0 of 2/);
  await click('Next');
  assert.match(await page.eval(`document.querySelector('dialog.wiz footer span').textContent`), /Spend exactly 2/);
  await page.eval(`document.querySelectorAll('dialog.wiz .abil6 .a')[0].querySelectorAll('button')[1].click()`);
  await page.eval(`document.querySelectorAll('dialog.wiz .abil6 .a')[0].querySelectorAll('button')[1].click()`);
  await click('Next'); await click('Level up');
  await page.waitFor('!document.querySelector("dialog.wiz")');
  assert.match(await page.eval(`document.querySelector('#stage').textContent`), /Fighter 4/);
  assert.match(await page.eval(`document.querySelector('#stage').textContent`), /What changed/);
  const after = await page.eval(`fetch('/api/characters').then((r) => r.json()).then((l) => l.map((c) => c.name))`);
  assert.deepEqual(after, names, 'no character was saved');
});

test('a wizard picks spells in the wizard, level after level', opts, async () => {
  await page.eval(`document.querySelector('#cls').value = 'Wizard'; document.querySelector('#level').value = '1'; document.querySelector('#start').click()`);
  await page.waitFor('document.querySelector("#stage h2") && /Wizard 1/.test(document.querySelector("#stage h2").textContent)');
  await page.eval(`[...document.querySelectorAll('#stage button')].find((b) => /Level up to 2/.test(b.textContent)).click()`);
  await page.waitFor('document.querySelector("dialog.wiz[open]")');
  const steps = await page.eval(`[...document.querySelectorAll('dialog.wiz .steps span')].map((s) => s.textContent)`);
  assert.ok(steps.some((s) => /Spellbook/.test(s)), 'a wizard adds spells to the spellbook: ' + steps.join(' | '));
});
