// A playtest bench: the real tabletop in headless Chrome, a throwaway copy of the app and its data, the real AI Dungeon Master (it SPENDS MONEY: about 20 to 40 cents a turn),
// and a small HTTP control port so that somebody (the assistant, a script) can play the party one message at a time and read what came back.
//   node --experimental-websocket scripts/dev/playtest-driver.mjs [--port 4545] [--max-calls 45]
// Then, from another shell:
//   curl -s localhost:4545/state                                   what the table shows now
//   curl -s -X POST localhost:4545/say -d '{"who":"Edric","text":"I draw my sword"}'     says it as that character, waits for the DM (and any turns it plays on its own), returns what is new
//   curl -s -X POST localhost:4545/stop                            ends the session, prints the timings
// The scenario is the Goblin Ambush of the Lost Mine: the four party members on the trail, full hit points, nothing else on the board, a fresh journal. The DM sets the ambush itself.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { makeSandbox, startServer, ROOT } from '../../test/helpers/sandbox.mjs';
import { launchChrome } from '../../test/helpers/chrome.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const PORT = Number(arg('--port', 4545)), MAX_CALLS = Number(arg('--max-calls', 45));
const LOST = 'lost-mine-of-phandelver';

const envText = await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
const key = process.env.ANTHROPIC_API_KEY || (/^ANTHROPIC_API_KEY=(.+)$/m.exec(envText) || [])[1]?.trim();
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.'); process.exit(1); }

const sb = await makeSandbox('vtt-playtest-');
const server = await startServer({ sandbox: sb, env: { ANTHROPIC_API_KEY: key, VTT_BOOKKEEPER: '1', ...(process.env.DM_EFFORT ? { DM_EFFORT: process.env.DM_EFFORT } : {}), ...(process.env.DM_SPEED ? { DM_SPEED: process.env.DM_SPEED } : {}) } });
await server.post('/api/campaigns/active', { id: LOST });
await server.post(`/api/campaigns/${LOST}/start-over`, {});
await server.post('/api/party/rest', { kind: 'long' });       // everyone at full hit points and spell slots, in the throwaway copy only

const game = JSON.parse(await readFile(path.join(ROOT, 'data', 'campaigns', LOST, 'game.json'), 'utf8'));
const pcs = game.board.tokens.filter((t) => t.isPC !== false && /^(tok-|pc)/i.test(t.id || '') || ['Edric', 'Raechyl', 'Shadowheart', 'Astarion'].includes(t.name));
const spots = { Edric: [6, 10], Raechyl: [7, 9], Shadowheart: [5, 9], Astarion: [7, 11] };
const board = { ...game.board, tokens: pcs.map((t) => ({ ...t, col: (spots[t.name] || [6, 10])[0], row: (spots[t.name] || [6, 10])[1], conditions: [], hidden: false, dead: false, where: '', initiative: null, movementRemaining: t.speed || 30, spent: { a: false, b: false, r: false } })), combat: { active: false, round: 0, order: [] }, activeIndex: 0, timeOfDay: 'day', dmPad: '', knownPlaces: [] };

// A pretend speech engine that notes when each line starts (Microsoft voices, so no clips to make): the wall clock of what a player would hear.
const FAKE_SYNTH = `
  window.__synth = { spoken: [] };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], cancel() {}, speak(u) { window.__synth.spoken.push({ text: u.text, at: performance.now() }); if (u.onstart) u.onstart(); setTimeout(() => { if (u.onend) u.onend(); }, 400); }, onvoiceschanged: null } });
`;
await server.post('/api/settings', { VOICE_PROVIDER: 'browser', NPC_VOICE_PROVIDER: 'browser' });
const page = await launchChrome();
await page.addInitScript(FAKE_SYNTH);
await page.goto(`${server.base}/index.html?nosave=1`);
await page.waitFor('window.vtt && window.vtt.state.characters.length >= 4');
await page.eval(`(() => { localStorage.setItem('vtt.board.${LOST}', ${JSON.stringify(JSON.stringify(board))}); localStorage.setItem('vtt.savedAt.${LOST}', String(Date.now())); localStorage.removeItem('vtt.chat.${LOST}'); localStorage.setItem('vtt.diceMode', '"ai"'); })()`);
await page.goto(`${server.base}/index.html?nosave=1`);
await page.waitFor('window.vtt && window.vtt.state.characters.length >= 4 && window.vtt.state.tokens.length >= 4 && !document.querySelector("#chatInput").disabled');
await page.eval(`(() => { document.querySelector('#speakToggle').checked = true; window.__calls = 0; window.__doneAt = 0; let was = false; setInterval(() => { const b = vtt.state.busy; if (was && !b && !window.__doneAt) window.__doneAt = performance.now(); was = b; }, 25); const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/chat') && o && o.method === 'POST') window.__calls++; return f(u, o); }; })()`);

let seen = await page.eval('vtt.state.chat.length');
const summary = () => page.eval(`(() => {
  const s = vtt.state, T = s.tokens.filter(Boolean);
  const dist = (a, b) => Math.round(Math.hypot(a.col - b.col, a.row - b.row) * 5);
  const pcs = T.filter((t) => t.isPC), foes = T.filter((t) => !t.isPC);
  const row = (t) => ({ name: t.name, at: t.col + ',' + t.row, hp: (t.isPC ? (characterFor(t) || {}).hp : t.hp) + '/' + (t.isPC ? (characterFor(t) || {}).maxHp : t.maxHp), ac: t.isPC ? (characterFor(t) || {}).ac : t.ac, hidden: !!t.hidden, seen: vtt.seenByParty(t), dead: !!t.dead, cond: (t.conditions || []).map((c) => c.name), init: Number.isFinite(t.initiative) ? t.initiative : null, move: t.movementRemaining });
  const active = s.combat.active && s.activeIndex >= 0 ? (s.tokens[s.activeIndex] || {}).name : null;
  return { map: s.map.url, combat: s.combat.active ? { round: s.combat.round, active, order: s.combat.order.map((id) => (T.find((t) => t.id === id) || {}).name) } : null, party: pcs.map(row), enemies: foes.map(row),
    nearest: pcs.map((p) => p.name + ' to nearest enemy: ' + (foes.filter((f) => !f.dead).map((f) => dist(p, f)).sort((a, b) => a - b)[0] ?? '-') + ' ft'), calls: window.__calls, busy: s.busy };
})()`);

const newChat = async () => {
  const msgs = await page.eval(`vtt.state.chat.slice(${seen}).map((m) => ({ role: m.role, text: m.lines && m.lines.length ? m.lines.map((l) => (l.speaker && l.speaker !== 'Narrator' ? l.speaker + ': ' : '') + l.text).join(' ') : m.content }))`);
  seen = await page.eval('vtt.state.chat.length');
  return msgs;
};

async function say(who, text) {
  if (await page.eval('window.__calls') >= MAX_CALLS) return { error: `call cap of ${MAX_CALLS} reached` };
  const ok = await page.eval(`(() => { const i = vtt.state.tokens.findIndex((t) => t && t.name === ${JSON.stringify(who)}); if (i < 0) return false; vtt.state.activeIndex = i; const el = document.querySelector('#chatInput'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()`);
  if (!ok) return { error: 'no such party member: ' + who };
  const started = Date.now();
  await page.eval('window.__t0 = performance.now(); window.__doneAt = 0; window.__synth.spoken = []');
  await page.waitFor('vtt.state.busy === true', 5000).catch(() => {});
  // wait for the DM, and for the turns the table asks it to play on its own (a creature's turn), until nothing has happened for 4 seconds
  let quietSince = Date.now();
  while (Date.now() - started < 240000) {
    await new Promise((r) => setTimeout(r, 400));
    const busy = await page.eval('vtt.state.busy');
    if (busy) quietSince = Date.now(); else if (Date.now() - quietSince > 4000) break;
  }
  const messages = await newChat();
  const clock = await page.eval('({ firstSpoken: window.__synth.spoken.length ? (window.__synth.spoken[0].at - window.__t0) / 1000 : null, firstRollOrLine: null, firstReplyDone: window.__doneAt ? (window.__doneAt - window.__t0) / 1000 : null })');
  return { wallClock: { secondsUntilFirstWordSpoken: clock.firstSpoken && Math.round(clock.firstSpoken * 10) / 10, secondsUntilFirstReplyComplete: clock.firstReplyDone && Math.round(clock.firstReplyDone * 10) / 10 }, seconds: Math.round((Date.now() - started) / 100) / 10, messages, state: await summary() };
}

const http = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj, null, 1)); };
  try {
    if (req.url === '/serverlog') return send(200, { log: server.log().slice(-4000) });
    if (req.url === '/state') return send(200, { messages: await newChat(), state: await summary() });
    if (req.url === '/say' && req.method === 'POST') { const b = JSON.parse(body || '{}'); return send(200, await say(String(b.who || ''), String(b.text || ''))); }
    if (req.url === '/stop') {
      const logDir = path.join(sb.dir, 'data', 'logs', LOST); const rows = [];
      for (const f of (await readdir(logDir).catch(() => [])).sort()) for (const l of (await readFile(path.join(logDir, f), 'utf8')).split('\n')) { try { const e = JSON.parse(l); if (e.kind === 'chat') rows.push({ player: String(e.player).slice(0, 60), modelSeconds: Math.round(e.apiMs / 100) / 10, outTokens: e.usage?.output_tokens, freshIn: e.usage?.input_tokens, cached: e.usage?.cache_read_input_tokens, error: e.error }); } catch { /* skip */ } }
      send(200, { calls: rows.length, problems: page.problems, rows });
      setTimeout(async () => { await page.close(); await server.stop(); process.exit(0); }, 200);
      return;
    }
    send(404, { error: 'unknown' });
  } catch (err) { send(500, { error: String(err.message || err) }); }
});
http.listen(PORT, '127.0.0.1', () => console.log(`Playtest ready on http://127.0.0.1:${PORT} (cap ${MAX_CALLS} DM calls). The throwaway copy lives in ${sb.dir}`));
