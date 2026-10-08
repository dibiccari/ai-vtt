// The new campaign wizard on the Campaigns page, driven in headless Chrome against a sandboxed server: build your own, make a starter character, ask for a map, create.
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
  await page.goto(`${server.base}/campaigns.html`);
  await page.waitFor('document.querySelectorAll("#side button").length >= 2');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const btn = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const setValue = (sel, value) => `{ const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }`;

test('build your own: story, starter character, map request, create', opts, async () => {
  const r = await page.eval(`(async () => {
    ${wait(0)}
    [...document.querySelectorAll('#side button')].find((b) => /New/.test(b.textContent)).click(); ${wait(200)}
    const steps = () => [...document.querySelectorAll('.card span')].filter((s) => /^\\d\\. /.test(s.textContent)).map((s) => s.textContent);
    const out = { first: steps() };
    [...document.querySelectorAll('input[type=radio]')].pop().click(); ${wait(200)}
    out.scratchSteps = steps();
    ${btn('Next')}.click(); ${wait(150)}
    ${setValue('input[aria-label=Name]', 'The Sunken Bell')}
    document.querySelector('textarea[aria-label=Premise]').value = 'A drowned village.'; document.querySelector('textarea[aria-label=Premise]').dispatchEvent(new Event('input'));
    out.pdfInput = Boolean(document.querySelector('input[aria-label="Adventure PDF"]'));
    ${btn('Next')}.click(); ${wait(150)}
    ${btn('Next')}.click(); ${wait(300)}
    // party: a starter character
    const d = [...document.querySelectorAll('details')].find((x) => /starter character/.test(x.textContent)); d.open = true; ${wait(500)}
    ${setValue('input[aria-label="Character name"]', 'Mira Vale')}
    ${setValue('select[aria-label=Class]', 'Wizard')} ${setValue('select[aria-label=Race]', 'Elf')} ${setValue('select[aria-label=Level]', '2')}
    ${btn('Make character')}.click(); ${wait(900)}
    out.status = document.querySelector('#status').textContent;
    out.partyChecked = [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked).length;
    ${btn('Next')}.click(); ${wait(1200)}
    // maps: ask for a new one
    const ask = [...document.querySelectorAll('details')].find((x) => /Ask for a new map/.test(x.textContent)); ask.open = true; ${wait(200)}
    ${setValue('input[aria-label="Map name"]', 'The flooded crypt')} ${setValue('textarea[aria-label="Map description"]', 'Stone steps down into black water.')}
    ${btn('Send the request')}.click(); ${wait(2500)}
    out.requestStatus = document.querySelector('#status').textContent;
    ${btn('Next')}.click(); ${wait(200)}
    out.review = document.querySelector('.card').innerText.slice(0, 400);
    ${btn('Create campaign')}.click(); ${wait(1500)}
    out.final = document.querySelector('#status').textContent;
    return out;
  })()`);
  assert.equal(r.first.length, 5, 'copy mode has five steps'); assert.equal(r.scratchSteps.length, 6, 'building your own adds the Maps step');
  assert.equal(r.pdfInput, true, 'the Story step offers an adventure PDF');
  assert.match(r.status, /Mira Vale was made/); assert.equal(r.partyChecked >= 1, true, 'the new character is ticked in the party');
  assert.match(r.requestStatus, /Requested/);
  assert.match(r.review, /The Sunken Bell/); assert.match(r.review, /Mira Vale/);
  assert.match(r.final, /Created The Sunken Bell/);
  const camps = (await server.get('/api/campaigns')).json.campaigns;
  const made = camps.find((c) => c.id === 'the-sunken-bell');
  assert.ok(made && made.custom === true && made.party.some((p) => p.id === 'mira-vale'));
  const ch = (await server.get('/api/characters')).json.find((c) => c.id === 'mira-vale');
  assert.ok(ch && ch.class === 'Wizard' && ch.level === 2);
  const reqs = (await server.get('/api/map-maker')).json.requests;
  assert.ok(reqs.some((q) => q.title === 'The flooded crypt' && q.status === 'new'));
});

test('no page errors on the Campaigns page', opts, () => { assert.deepEqual(page.problems, []); });
