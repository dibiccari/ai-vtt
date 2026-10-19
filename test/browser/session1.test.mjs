// Regression tests for what went wrong in the first live session (the saved transcript is test/fixtures/session-1.json). They use the table's own code and the Microsoft voices only: no AI calls.
//   1. the DM view (ghosts of hidden creatures) switched on by the Test Lab showed the hidden goblins in the real game
//   2. while the players' initiatives were missing the table kept asking the DM to play goblin turns (four repeated replies)
//   3. a table nudge cut off the narration that was playing, so much of it was never heard
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const LOST = 'lost-mine-of-phandelver';
let server, page;

// A pretend speech engine: it remembers what was spoken and when cancel() was called, and an utterance ends when the test says so.
const FAKE_SYNTH = `
  window.__synth = { spoken: [], cancels: 0, pending: [] };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [], cancel() { window.__synth.cancels++; window.__synth.pending = []; },
    speak(u) { window.__synth.spoken.push(u.text); window.__synth.pending.push(u); if (u.onstart) u.onstart(); }, onvoiceschanged: null
  } });
`;

before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/campaigns/active', { id: LOST });
  await server.post('/api/settings', { VOICE_PROVIDER: 'browser', NPC_VOICE_PROVIDER: 'browser' });
  page = await launchChrome();
  await page.addInitScript(FAKE_SYNTH);
  await page.goto(`${server.base}/index.html?nosave=1`);
  await page.waitFor('window.vtt && window.vtt.state.characters.length >= 3 && !document.querySelector("#chatInput").disabled');
  await page.eval(`localStorage.setItem('vtt.dmView', 'true')`);       // what the Test Lab used to leave behind, for the whole browser
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };

test('the transcript fixture is the real first session: the loop, the first fight and the timings are in it', () => {
  const f = JSON.parse(readFileSync(new URL('../fixtures/session-1.json', import.meta.url), 'utf8'));
  assert.ok(f.chat.length > 80 && f.turns.length >= 15);
  const said = (re) => f.chat.filter((m) => m.role === 'assistant' && re.test(m.content)).length;
  assert.ok(said(/already (taken|spent|struck|made)/) >= 4, 'the goblins\' opening round was repeated by the DM');
  assert.ok(f.chat.some((m) => /do not have printed maps|printed Maps/i.test(m.content)));
  const secs = f.turns.map((t) => t.seconds).sort((a, b) => a - b);
  assert.ok(secs[Math.floor(secs.length / 2)] > 15, 'the baseline median is about 19 seconds before the fixes');
});

test('1. the DM view is remembered per campaign: the old browser-wide setting no longer shows hidden creatures in a real game', opts, async () => {
  const r = await page.eval(`(async () => {
    const out = {};
    const store = (k) => localStorage.getItem(k);
    out.oldKey = store('vtt.dmView');
    out.now = vtt.state.dmView;
    localStorage.setItem('vtt.dmView.${LOST}', 'true');
    out.perCampaignKey = JSON.parse(store('vtt.dmView.${LOST}'));
    return out;
  })()`);
  assert.equal(r.oldKey, 'true'); assert.equal(r.now, false, 'the old browser-wide DM view does not switch it on');
  // a fresh load: the old key alone leaves it off, the per-campaign key turns it on
  await page.goto(`${server.base}/index.html?nosave=1`); await page.waitFor('window.vtt && window.vtt.state.characters.length >= 3');
  assert.equal(await page.eval(`window.vtt.state.dmView`), true, 'a per-campaign choice is respected');
  await page.eval(`localStorage.removeItem('vtt.dmView.${LOST}')`);
  await page.goto(`${server.base}/index.html?nosave=1`); await page.waitFor('window.vtt && window.vtt.state.characters.length >= 3');
  assert.equal(await page.eval(`window.vtt.state.dmView`), false);
});

test('2. the table does not ask the DM to play a creature while a player has no initiative, and does once everyone has one', opts, async () => {
  const r = await page.eval(`(async () => {
    const s = vtt.state, posts = [];
    const realFetch = window.fetch;
    window.fetch = (url, o) => { if (String(url).includes('/api/chat') && o && o.method === 'POST') posts.push(1); return realFetch(url, o); };
    s.autoTurns = 0; s.busy = false;
    const pcs = s.tokens.filter((t) => t && t.isPC).slice(0, 2);
    pcs.forEach((t, i) => { t.col = 5 + i; t.row = 5; t.hp = t.maxHp || 10; t.dead = false; });
    const gob = { id: 'gob-1', name: 'Goblin 1', col: 9, row: 9, color: '#4a7', isPC: false, hidden: false, kind: 'creature', hp: 7, maxHp: 7, ac: 15, monster: 'goblin', dexMod: 2, conditions: [], spent: { a: false, b: false, r: false } };
    s.tokens = [...pcs, gob];
    s.combat = { active: true, round: 1, order: [gob.id, ...pcs.map((t) => t.id)], fresh: true };
    gob.initiative = 18; pcs.forEach((t) => { t.initiative = null; });       // the goblins have rolled, the players have not
    s.activeIndex = s.tokens.indexOf(gob);
    vtt.aiTakesItsTurn(); await new Promise((r) => setTimeout(r, 300));
    const whileWaiting = posts.length;
    pcs.forEach((t, i) => { t.initiative = 10 - i; });
    vtt.aiTakesItsTurn(); await new Promise((r) => setTimeout(r, 300));
    window.fetch = realFetch;
    return { whileWaiting, afterwards: posts.length, auto: s.autoTurns };
  })()`);
  assert.equal(r.whileWaiting, 0, 'nothing is sent while the players\' initiatives are missing');
  assert.ok(r.afterwards >= 1 && r.auto >= 1, 'the DM is asked once the order is settled (the pretend server answers each time, so the table keeps going until its cap of 12)');
});

test('3. a table nudge does not cut off the narration; its reply waits its turn; a player speaking does cut it off', opts, async () => {
  const r = await page.eval(`(async () => {
    const synth = window.__synth, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const line = (t) => [{ speaker: 'Narrator', voice: 'narrator', text: t }];
    await new Promise((r) => setTimeout(r, 500));       // let the voice status arrive
    document.querySelector('#speakToggle').checked = true;
    synth.spoken = []; synth.cancels = 0; synth.pending = [];
    vtt.voice.speak(line('First reply, the opening round.'), null);
    await wait(100);
    const afterFirst = { spoken: synth.spoken.slice(), cancels: synth.cancels };
    vtt.voice.speak(line('Second reply, to a table nudge.'), null, { queue: true });       // what a reply to a [Table] message does
    await wait(100);
    const afterNudge = { spoken: synth.spoken.slice(), cancels: synth.cancels };
    const u = synth.pending[0]; if (u && u.onend) u.onend();       // the first one finishes by itself
    await wait(150);
    const afterEnd = { spoken: synth.spoken.slice() };
    const before = synth.cancels;
    vtt.voice.speak(line('A reply to the player.'), null);       // not a nudge: it takes over
    await wait(100);
    return { afterFirst, afterNudge, afterEnd, tookOver: synth.cancels > before, last: synth.spoken[synth.spoken.length - 1] };
  })()`);
  assert.deepEqual(r.afterFirst.spoken, ['First reply, the opening round.']);
  assert.equal(r.afterNudge.cancels, r.afterFirst.cancels, 'the nudge\'s reply did not cancel the narration');
  assert.deepEqual(r.afterNudge.spoken, ['First reply, the opening round.'], 'and it is not spoken over it');
  assert.deepEqual(r.afterEnd.spoken, ['First reply, the opening round.', 'Second reply, to a table nudge.'], 'it is spoken when the first one is done');
  assert.equal(r.tookOver, true); assert.equal(r.last, 'A reply to the player.');
});

test('no page errors', opts, () => { assert.deepEqual(page.problems, []); });
