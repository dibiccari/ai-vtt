// The character sheet page (plain HTML and CSS, no PDF): a saved sheet is read only; a new character is built with searchable lists of the real spells, weapons and armor.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a saved sheet is drawn from HTML (no PDF), has three pages, and is read only', opts, async () => {
  const out = await page.eval(`(() => ({
    pages: document.querySelectorAll('.sheet .page').length,
    canvases: document.querySelectorAll('canvas').length,
    pdfScripts: [...document.scripts].map((s) => s.src).filter((s) => /pdf/.test(s)),
    name: document.querySelector('[aria-label="Character name"]').value,
    dex: document.querySelector('[aria-label="Dexterity score"]').value,
    stealth: document.querySelector('[aria-label="Stealth"]').value,
    editable: [...document.querySelectorAll('.sheet input[type=text], .sheet textarea, .sheet input[type=number]')].filter((e) => !e.readOnly).length,
    boxesEnabled: [...document.querySelectorAll('.sheet input[type=checkbox]')].filter((e) => !e.disabled).length,
    combos: document.querySelectorAll('.combo').length,
    save: document.querySelector('#saveBtn').hidden, pick: document.querySelector('#pickBtn').hidden, print: document.querySelector('#pdfBtn').hidden
  }))()`);
  assert.equal(out.pages, 3); assert.equal(out.canvases, 0); assert.deepEqual(out.pdfScripts, []);
  assert.equal(out.name, 'Astarion'); assert.equal(out.dex, '17'); assert.ok(/^\+/.test(out.stealth));
  assert.equal(out.editable, 0, 'no box can be typed in'); assert.equal(out.boxesEnabled, 0, 'no proficiency box can be changed'); assert.equal(out.combos, 0);
  assert.equal(out.save, true); assert.equal(out.pick, true); assert.equal(out.print, false, 'printing stays');
});

test('a new character is built with lists of the real spells, weapons and armor, worked out numbers, and is read only once saved', opts, async () => {
  await page.eval(`document.querySelector('#newBtn').click()`);
  await page.waitFor('document.querySelector(".combo") && !document.querySelector("[aria-label=\\"Character name\\"]").readOnly');
  const out = await page.eval(`(async () => {
    const box = (label) => document.querySelector('[aria-label="' + label + '"]');
    const input = (label, v) => { const e = box(label); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return e; };
    const type = async (inp, text) => { inp.focus(); inp.value = text; inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(50); };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const pick = async (inp) => { const o = inp.parentElement.querySelector('.opt'); if (!o) return false; o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); inp.dispatchEvent(new Event('blur')); await wait(50); return true; };
    const res = {};
    input('Character name', 'Test Hero'); input('Class and level', 'Wizard 1');
    input('Dexterity score', '16'); input('Strength score', '10'); input('Intelligence score', '18');
    res.mod = box('Dexterity modifier').value; res.init = box('Initiative').value;
    const cb = (label) => { const e = box(label); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); };
    const before = box('Arcana').value; cb('Arcana proficiency'); res.profAdds = parseInt(box('Arcana').value, 10) - parseInt(before, 10);
    cb('Arcana expertise'); res.expAdds = parseInt(box('Arcana').value, 10) - parseInt(before, 10);
    const cantrip = box('Cantrip (pick from the list)');
    await type(cantrip, 'fire'); res.matches = [...cantrip.parentElement.querySelectorAll('.opt span')].map((e) => e.textContent);
    await pick(cantrip); res.cantrip = cantrip.value;
    const spell1 = box('Level 1 spell (pick from the list)');
    await type(spell1, 'zzzz made up'); spell1.dispatchEvent(new Event('blur')); await wait(80); res.refused = spell1.value;
    const w = box('Weapon (pick from the list)');
    await type(w, 'rapier'); await pick(w); res.weapon = w.value;
    const row = document.querySelectorAll('.wpn')[1].querySelectorAll('input'); res.atk = row[1].value; res.dmg = row[2].value;
    const armor = box('Armor (pick from the list)');
    await type(armor, 'chain'); await pick(armor); res.armor = armor.value; res.ac = box('Armor class').value;
    const sh = box('Carries a shield'); sh.checked = true; sh.dispatchEvent(new Event('change', { bubbles: true })); await wait(50); res.acShield = box('Armor class').value;
    document.querySelector('#saveBtn').click(); await wait(900);
    const saved = (await (await fetch('/api/characters')).json()).find((c) => c.name === 'Test Hero');
    res.saved = saved ? { cls: saved.class, level: saved.level, dex: saved.abilities.dex, ac: saved.ac, armor: saved.armor, shield: saved.shield, exp: saved.expertise, spell: saved.sheet['Spells 1014'], wpn: saved.sheet['Wpn Name'] } : null;
    res.lockedAfter = { name: box('Character name').readOnly, cantrip: document.querySelectorAll('.combo').length, save: document.querySelector('#saveBtn').hidden };
    return res;
  })()`);
  assert.equal(out.mod, '+3'); assert.equal(out.init, '+3');
  assert.equal(out.profAdds, 2, JSON.stringify(out)); assert.equal(out.expAdds, 4);
  assert.ok(out.matches.includes('Fire Bolt') && out.cantrip === 'Fire Bolt', JSON.stringify(out));
  assert.equal(out.refused, '', 'a made-up spell goes back to empty: ' + JSON.stringify(out));
  assert.equal(out.weapon, 'Rapier'); assert.equal(out.atk, '+5', 'Dexterity +3 and proficiency +2'); assert.equal(out.dmg, '1d8+3 piercing');
  assert.equal(out.armor, 'Chain Mail'); assert.equal(out.ac, '16'); assert.equal(out.acShield, '18');
  assert.deepEqual(out.saved, { cls: 'Wizard', level: 1, dex: 16, ac: 18, armor: 'Chain Mail', shield: true, exp: ['Arcana'], spell: 'Fire Bolt', wpn: 'Rapier' }, JSON.stringify(out.saved));
  assert.deepEqual(out.lockedAfter, { name: true, cantrip: 0, save: true }, 'saved, so read only');
});
