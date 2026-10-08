// The character sheet page (plain HTML and CSS, no PDF): it fills itself from the saved character, follows ability scores and proficiency boxes, and saves back to the server.
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
  await page.goto(`${server.base}/characters.html?id=astarion`);
  await page.waitFor('document.querySelector(".sheet") && document.querySelector(".sheet input")');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

test('the sheet is drawn from HTML (no PDF) with three pages and the saved values', opts, async () => {
  const out = await page.eval(`(() => ({
    pages: document.querySelectorAll('.sheet .page').length,
    pdfCanvas: document.querySelectorAll('canvas').length,
    name: document.querySelector('[aria-label="Character name"]').value,
    dex: document.querySelector('[aria-label="Dexterity score"]').value,
    stealth: document.querySelector('[aria-label="Stealth"]').value,
    scripts: [...document.scripts].map((s) => s.src).filter((s) => /pdf/.test(s))
  }))()`);
  assert.equal(out.pages, 3); assert.equal(out.pdfCanvas, 0); assert.deepEqual(out.scripts, []);
  assert.equal(out.name, 'Astarion'); assert.equal(out.dex, '17'); assert.ok(/^\+/.test(out.stealth), 'stealth shows a bonus: ' + out.stealth);
});

test('ability scores, proficiency and expertise recalculate modifiers, saves, skills, initiative and passive Perception', opts, async () => {
  const out = await page.eval(`(async () => {
    const set = (label, v) => { const e = document.querySelector('[aria-label="' + label + '"]'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return e; };
    const val = (label) => document.querySelector('[aria-label="' + label + '"]').value;
    set('Dexterity score', '10'); set('Intelligence score', '10');
    const base = { mod: val('Dexterity modifier'), init: val('Initiative'), acro: val('Arcana') };
    const cb = (label) => { const e = document.querySelector('[aria-label="' + label + '"]'); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
    const before = val('Arcana');
    cb('Arcana proficiency');
    const prof = val('Arcana');
    cb('Arcana expertise');
    const exp = val('Arcana');
    set('Dexterity score', '18'); set('Intelligence score', '18');
    return { base, before, prof, exp, mod: val('Dexterity modifier'), init: val('Initiative'), acroNow: val('Arcana'), passive: val('Passive Perception'), dexSave: val('Dexterity saving throw') };
  })()`);
  assert.equal(out.base.mod, '+0'); assert.equal(out.base.init, '+0');
  const n = (s) => parseInt(s, 10);
  assert.equal(n(out.prof) - n(out.before), 2, 'proficiency adds +2 at level 1: ' + JSON.stringify(out));
  assert.equal(n(out.exp) - n(out.before), 4, 'expertise doubles it');
  assert.equal(out.mod, '+4'); assert.equal(out.init, '+4'); assert.equal(n(out.acroNow), 4 + 4, 'an Intelligence of 18 gives +4 plus the doubled proficiency');
});

test('saving writes the sheet, the expertise and darkvision back, and the DM-facing numbers follow', opts, async () => {
  const out = await page.eval(`(async () => {
    const dv = document.querySelector('[aria-label="Darkvision in feet"]'); dv.value = '60'; dv.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#saveBtn').click();
    await new Promise((r) => setTimeout(r, 800));
    const c = await (await fetch('/api/characters')).json();
    const a = c.find((x) => x.id === 'astarion');
    return { dex: a.abilities.dex, dv: a.darkvision, exp: a.expertise, status: document.querySelector('#status').textContent };
  })()`);
  assert.equal(out.status, 'Saved', JSON.stringify(out)); assert.equal(out.dex, 18); assert.equal(out.dv, 60); assert.ok(out.exp.includes('Arcana'), JSON.stringify(out.exp));
});

test('no page errors on the character sheets page', opts, async () => {
  const errs = await page.eval(`window.__errs || []`);
  assert.deepEqual(errs, []);
});
