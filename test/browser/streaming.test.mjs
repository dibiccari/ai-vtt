// The DM's answer is printed and spoken while it is still being written: a pretend DM that writes slowly, the real tabletop in Chrome, and a pretend speech engine that notes when each line starts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeAnthropic } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const LOST = 'lost-mine-of-phandelver';
let server, fake, page;
const DM = {
  rolls: ['Goblin 1 scimitar attack on Raechyl: d20 (11) + 4 = 15 vs AC 14, hit'],
  voiceLines: [
    { speaker: 'Narrator', voice: 'narrator', text: 'The scimitar bites across her shoulder.' },
    { speaker: 'Goblin 1', voice: 'monstrous', text: 'Horny one bleeds!' },
    { speaker: 'Narrator', voice: 'narrator', text: 'Shadowheart, you are up.' }
  ],
  mapUpdates: [],
  __chunkMs: 40, __chunkSize: 10
};
const FAKE_SYNTH = `
  window.__synth = { spoken: [], cancels: 0, pending: [] };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [], cancel() { window.__synth.cancels++; window.__synth.pending = []; },
    speak(u) { window.__synth.spoken.push({ text: u.text, at: performance.now() }); window.__synth.pending.push(u); if (u.onstart) u.onstart(); setTimeout(() => { if (u.onend) u.onend(); }, 150); }, onvoiceschanged: null
  } });
`;

before(async () => {
  if (skip) return;
  fake = await fakeAnthropic([DM]);
  server = await startServer({ env: { ANTHROPIC_API_KEY: 'sk-ant-fake-for-tests', ANTHROPIC_BASE_URL: fake.url } });
  await server.post('/api/campaigns/active', { id: LOST });
  await server.post('/api/settings', { VOICE_PROVIDER: 'browser', NPC_VOICE_PROVIDER: 'browser' });
  page = await launchChrome();
  await page.addInitScript(FAKE_SYNTH);
  await page.goto(`${server.base}/index.html?nosave=1`);
  await page.waitFor('window.vtt && window.vtt.state.characters.length >= 3 && !document.querySelector("#chatInput").disabled');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); if (fake) await fake.close(); });
const opts = { skip: skip || false };

test('the rolls and the first line show and are spoken while the rest is still being written, and nothing is said twice', opts, async () => {
  const r = await page.eval(`(async () => {
    await new Promise((r) => setTimeout(r, 600));       // the voice status arrives
    document.querySelector('#speakToggle').checked = true;
    const s = vtt.state, synth = window.__synth, seen = [];
    s.combat = { active: false, round: 0, order: [] };
    const el = document.querySelector('#chatInput'); el.value = 'Edric holds the line.';
    const t0 = performance.now();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    // watch the chat while the reply comes in
    while (performance.now() - t0 < 15000) {
      const last = s.chat[s.chat.length - 1];
      const assistant = s.chat.filter((m) => m.role === 'assistant');
      seen.push({ at: Math.round(performance.now() - t0), busy: s.busy, lines: assistant.length ? (assistant[assistant.length - 1].lines || []).length : 0, rolls: s.chat.filter((m) => m.role === 'system' && /🎲/.test(m.content)).length });
      if (!s.busy && seen.length > 5 && assistant.length) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 1200));       // let the last line finish
    const assistant = s.chat.filter((m) => m.role === 'assistant');
    const firstFull = seen.find((x) => x.lines >= 1), allIn = seen.find((x) => x.lines >= 3);
    return { firstLineAt: firstFull && firstFull.at, allLinesAt: allIn && allIn.at, endAt: (seen.find((x) => !x.busy && x.lines >= 3) || {}).at, spoken: synth.spoken.map((x) => ({ text: x.text, at: Math.round(x.at - t0) })), assistants: assistant.length, finalLines: assistant.map((m) => m.lines.map((l) => l.text)), rolls: s.chat.filter((m) => m.role === 'system' && /🎲/.test(m.content)).length };
  })()`);
  assert.equal(r.assistants, 1, 'one message from the DM, built up as it was written');
  assert.deepEqual(r.finalLines[0], DM.voiceLines.map((l) => l.text));
  assert.equal(r.rolls, 1, 'the roll is printed once');
  assert.deepEqual(r.spoken.map((x) => x.text), DM.voiceLines.map((l) => l.text), 'each line is spoken once, in order');
  assert.ok(r.firstLineAt < r.allLinesAt - 300, `the first line showed at ${r.firstLineAt} ms, the last at ${r.allLinesAt} ms`);
  assert.ok(r.spoken[0].at < r.allLinesAt - 300, `the first line was spoken at ${r.spoken[0].at} ms, before the reply was finished (${r.allLinesAt} ms)`);
});

test('no page errors', opts, () => { assert.deepEqual(page.problems, []); });
