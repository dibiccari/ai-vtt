// Hold to talk (the Space bar) with a fake microphone and a fake speech recognizer: it listens while the key is held, and when the key is lifted the recognizer is stopped, the
// words it delivered last are kept, the microphone stream is let go, and nothing starts listening again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const LOST = 'lost-mine-of-phandelver';
let server, page;

const FAKES = `
  window.__mic = { opened: 0, stopped: 0 };
  navigator.mediaDevices.getUserMedia = async () => { window.__mic.opened++; const track = { enabled: true, stop() { window.__mic.stopped++; } }; return { active: true, getTracks: () => [track], getAudioTracks: () => [track], clone() { return this; } }; };
  window.__rec = { starts: 0, stops: 0, running: false, last: null };
  window.webkitSpeechRecognition = window.SpeechRecognition = class {
    constructor() { window.__rec.last = this; }
    start() { window.__rec.starts++; window.__rec.running = true; }
    // a real recognizer delivers its last words a moment after stop(), then ends
    stop() { window.__rec.stops++; setTimeout(() => { if (this.onresult) this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: window.__rec.say || 'I open the door' }], { isFinal: true })] }); window.__rec.running = false; if (this.onend) this.onend(); }, 120); }
  };
`;

before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/campaigns/active', { id: LOST });
  page = await launchChrome();
  await page.addInitScript(FAKES);
  await page.goto(`${server.base}/index.html?nosave=1`);
  await page.waitFor('window.vtt && window.vtt.state.characters.length >= 4 && !document.querySelector("#chatInput").disabled');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });
const opts = { skip: skip || false };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (type) => page.eval(`window.dispatchEvent(new KeyboardEvent('${type}', { code: 'Space', key: ' ', bubbles: true, cancelable: true }))`);

test('hold Space: it listens while held; on release the recognizer stops, its last words are kept and the microphone stream is let go', opts, async () => {
  await page.eval(`(() => { document.querySelector('#autoSendToggle').checked = false; document.querySelector('#chatInput').value = ''; document.activeElement && document.activeElement.blur(); window.__rec.say = 'I open the door'; })()`);
  await key('keydown'); await wait(300);
  const held = await page.eval(`({ label: document.querySelector('#micBtn').textContent, running: window.__rec.running, opened: window.__mic.opened })`);
  assert.match(held.label, /Listening/); assert.equal(held.running, true); assert.equal(held.opened >= 1, true, 'the level meter opened the microphone');
  await key('keyup');
  await wait(1200);
  const after = await page.eval(`({ label: document.querySelector('#micBtn').textContent, running: window.__rec.running, starts: window.__rec.starts, stops: window.__rec.stops, stopped: window.__mic.stopped, opened: window.__mic.opened, text: document.querySelector('#chatInput').value })`);
  assert.equal(after.running, false, 'the recognizer is not running any more'); assert.equal(after.stops, 1);
  assert.equal(after.starts, 1, 'and it did not start again by itself');
  assert.match(after.label, /Hold to Talk/); assert.equal(after.text, 'I open the door', 'the words it delivered after stop() were kept');
  assert.equal(after.stopped >= after.opened, true, 'the microphone stream was let go (no recording indicator left)');
  await wait(1500);
  const later = await page.eval(`({ running: window.__rec.running, starts: window.__rec.starts, text: document.querySelector('#chatInput').value })`);
  assert.equal(later.running, false); assert.equal(later.starts, 1, 'still not listening a moment later');
});

test('a quick tap, released before the recognizer started, leaves nothing listening', opts, async () => {
  await page.eval(`(() => { document.querySelector('#chatInput').value = ''; window.__rec.say = ''; })()`);
  const before = await page.eval(`window.__rec.starts`);
  await key('keydown'); await key('keyup'); await wait(1800);
  const r = await page.eval(`({ running: window.__rec.running, label: document.querySelector('#micBtn').textContent })`);
  assert.equal(r.running, false); assert.match(r.label, /Hold to Talk/);
  assert.ok((await page.eval(`window.__rec.starts`)) - before <= 1);
});

test('no page errors', opts, () => { assert.deepEqual(page.problems, []); });
