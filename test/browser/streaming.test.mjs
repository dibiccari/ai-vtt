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

test('the history the DM is shown carries what the table applied after each of its replies, so a payment is not made twice', opts, async () => {
  const r = await page.eval(`(() => {
    const s = vtt.state, keep = s.chat;
    s.chat = [
      { role: 'user', content: '[Edric] I deliver the wagon.' },
      { role: 'assistant', content: 'Elmar counts out the gold.' },
      { role: 'system', content: '🎒 Edric: +10 gp; Astarion: +10 gp' },
      { role: 'system', content: '🎲 not a change the table applied' },
      { role: 'system', content: '↳ Goblin 3 takes 6' },
      { role: 'system', content: '↳ Astarion moved to (12, 14)' },
      { role: 'system', content: '↳ Raechyl HP 3 → 8/11' },
      { role: 'user', content: '[Edric] What else?' },
      { role: 'assistant', content: 'He points to the Coster.' },
      { role: 'system', content: '📍 New place on the map: Lionshield Coster' }
    ];
    const h = dmHistory(); s.chat = keep; return h;
  })()`);
  assert.deepEqual(r.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(r[1].content, /Elmar counts out the gold\.\n\[Table applied: Edric: \+10 gp; Astarion: \+10 gp\]/);
  assert.doesNotMatch(r[1].content, /not a change/);
  assert.match(r[1].content, /\[Table applied: Goblin 3 takes 6\]/); assert.match(r[1].content, /\[Table applied: Raechyl HP 3 → 8\/11\]/);
  assert.doesNotMatch(r[1].content, /moved to/, 'movement is not a change the DM needs to be told');
  assert.match(r[3].content, /\[Table applied: New place on the map: Lionshield Coster\]/);
});

test('during a creature turn the message a player types is not labelled with the creature', opts, async () => {
  const msg = await page.eval(`(async () => {
    const s = vtt.state, keep = { tokens: s.tokens, active: s.activeIndex };
    const npc = makeToken({ id: 'npc-bruno', name: 'Bruno', color: '#888', isPC: false, col: 3, row: 3, speed: 30 });
    s.tokens = [...s.tokens, npc]; s.activeIndex = s.tokens.indexOf(npc);
    const el = document.querySelector('#chatInput'); el.value = 'whose turn is it';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const t0 = performance.now();
    while (performance.now() - t0 < 15000 && !(s.chat.some((m) => m.role === 'user' && /whose turn/.test(m.content)))) await new Promise((r) => setTimeout(r, 30));
    const sent = s.chat.filter((m) => m.role === 'user').at(-1).content;
    while (performance.now() - t0 < 20000 && s.busy) await new Promise((r) => setTimeout(r, 30));
    s.tokens = keep.tokens; s.activeIndex = keep.active;
    return sent;
  })()`);
  assert.equal(msg, 'whose turn is it', 'no [Bruno] in front of the words the player typed');
});

test('a character taken out of the party hands the turn to the next combatant who is still there, never to whatever token sits at the old position', opts, async () => {
  const r = await page.eval(`(() => {
    const s = vtt.state, keep = { tokens: s.tokens, characters: s.characters, active: s.activeIndex, combat: s.combat };
    const pcs = s.characters.slice(0, 2);
    const mk = (id, extra) => makeToken({ id, name: id, color: '#999', col: 2, row: 2, speed: 30, ...extra });
    s.tokens = [mk('tok-first', { isPC: true, characterId: pcs[0].id }), mk('trap-x', { isPC: false, kind: 'trap', hidden: true }), mk('npc-foe', { isPC: false }), mk('tok-second', { isPC: true, characterId: pcs[1].id })];
    s.activeIndex = 0;
    s.combat = { active: true, round: 1, order: ['tok-first', 'npc-foe', 'tok-second'] };
    s.characters = s.characters.filter((c) => c.id !== pcs[0].id);        // the active character leaves the party
    syncTokensWithCharacters();
    const out = { active: activeToken().id, order: s.combat.order.slice() };
    s.tokens = keep.tokens; s.characters = keep.characters; s.activeIndex = keep.active; s.combat = keep.combat;
    return out;
  })()`);
  assert.equal(r.active, 'npc-foe', 'the trap that moved into the old position is not the active combatant');
  assert.deepEqual(r.order, ['npc-foe', 'tok-second'], 'the order forgets the token that is gone');
});

test('the play log is told every time the turn passes, and when an endTurn is ignored', opts, async () => {
  const r = await page.eval(`(() => {
    const s = vtt.state, keep = { tokens: s.tokens, active: s.activeIndex, combat: s.combat }, seen = [], real = logTable;
    logTable = (what, detail) => { seen.push([what, detail]); };
    const mk = (id, name, extra) => makeToken({ id, name, color: '#999', col: 2, row: 2, speed: 30, ...extra });
    const a = mk('npc-a', 'Alpha', { isPC: false }), b = mk('npc-b', 'Bravo', { isPC: false });
    a.initiative = 10; b.initiative = 5;
    s.tokens = [a, b]; s.activeIndex = 0; s.combat = { active: true, round: 1, order: ['npc-a', 'npc-b'], fresh: false };
    try {
      vtt.applyMapUpdates([{ type: 'endTurn', tokenId: 'npc-b' }]);        // not Alpha's turn: ignored, and said so
      vtt.applyMapUpdates([{ type: 'endTurn', tokenId: 'npc-a' }]);        // Alpha's turn: Bravo is up
    } finally { logTable = real; s.tokens = keep.tokens; s.activeIndex = keep.active; s.combat = keep.combat; }
    return seen;
  })()`);
  assert.ok(r.some(([w, d]) => w === 'turn' && /endTurn for Bravo ignored: it is Alpha's turn/.test(d)), JSON.stringify(r));
  assert.ok(r.some(([w, d]) => w === 'turn' && /^Bravo is up \(round 1\), after Alpha/.test(d)), JSON.stringify(r));
});

test('no page errors', opts, () => { assert.deepEqual(page.problems, []); });
