// Replays the player messages of the first live session (test/fixtures/session-1.json) against the real DM, on a throwaway copy of the app, and times each reply.
// It sends the combat part of the session (the goblin ambush) one message at a time, with the saved board from that session and the chat so far as history, and compares the time with the
// time the same message took before the fixes (the fixture). It reads the sandbox's own play log for the model wait and the token counts.
//   node scripts/replay-session.mjs            prints the plan and the cost estimate, spends nothing
//   node scripts/replay-session.mjs --live     SPENDS MONEY: one DM call per message (about 7), plus one bookkeeper call each; roughly $2
//   node scripts/replay-session.mjs --live --turns 3     only the first 3 messages
// It needs ANTHROPIC_API_KEY in .env and credit on that account. It never touches the real data folder.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { makeSandbox, startServer, ROOT } from '../test/helpers/sandbox.mjs';

const live = process.argv.includes('--live');
const turnsFlag = process.argv.indexOf('--turns');
const maxTurns = turnsFlag > 0 ? Math.max(1, Number(process.argv[turnsFlag + 1]) || 7) : 7;
const LOST = 'lost-mine-of-phandelver';

const fixture = JSON.parse(await readFile(path.join(ROOT, 'test', 'fixtures', 'session-1.json'), 'utf8'));
const game = JSON.parse(await readFile(path.join(ROOT, 'data', 'campaigns', LOST, 'game.json'), 'utf8'));

// The combat part: from the first player message after the goblins appeared (the one that complained about the missing opening round).
const chat = fixture.chat;
const start = chat.findIndex((m) => m.role === 'user' && /didn't describe how/.test(m.content));
const players = [];
for (let i = Math.max(0, start); i < chat.length; i++) {
  if (chat[i].role !== 'user') continue;
  const baseline = fixture.turns.find((t) => t.player === chat[i].content);
  players.push({ at: i, text: chat[i].content, baseline: baseline ? baseline.seconds : null });
}
const plan = players.slice(0, maxTurns);
console.log(`Replay of ${plan.length} player message(s) from the first session (goblin ambush, round 1):`);
for (const p of plan) console.log(`  - ${p.text.replace(/\s+/g, ' ').slice(0, 90)}   (before the fixes: ${p.baseline ?? '?'} s)`);
if (!live) { console.log('\nDry run: nothing was sent. Add --live to spend about $2 on the real DM (about 7 replies at 20 to 40 cents each).'); process.exit(0); }

const envText = await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '');
const key = process.env.ANTHROPIC_API_KEY || (/^ANTHROPIC_API_KEY=(.+)$/m.exec(envText) || [])[1]?.trim();       // a test can point both at a fake API
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.'); process.exit(1); }

const sb = await makeSandbox('vtt-replay-');
const server = await startServer({ sandbox: sb, env: { ANTHROPIC_API_KEY: key, VTT_BOOKKEEPER: '0', ...(process.env.ANTHROPIC_BASE_URL ? { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL } : {}) } });
try {
  await server.post('/api/campaigns/active', { id: LOST });
  const characters = (await server.get(`/api/characters?campaign=${LOST}`)).json;
  const board = game.board;
  const tokens = board.tokens.map((t) => ({ ...t, visibleToParty: !t.hidden }));
  const combat = { active: true, round: board.combat.round, currentTokenId: board.combat.order[0], order: board.combat.order.map((id) => ({ tokenId: id, initiative: (board.tokens.find((t) => t.id === id) || {}).initiative ?? null })) };
  const history = chat.slice(0, players[0].at).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-24).map(({ role, content }) => ({ role, content }));
  const rows = [];
  for (const p of plan) {
    const started = Date.now();
    const r = await server.post('/api/chat', { message: p.text, history, activeTokenId: board.combat.order[0], tokens, characters, walls: [], gridSize: 50, mapUrl: board.mapUrl, mapName: 'Goblin Ambush', combat, diceMode: 'ai', notes: [], places: [], visitedMaps: [] });
    const seconds = (Date.now() - started) / 1000;
    if (r.status !== 200) { console.error(`HTTP ${r.status}: ${r.text.slice(0, 300)}`); break; }
    history.push({ role: 'user', content: p.text }, { role: 'assistant', content: r.json.narrative });
    rows.push({ text: p.text, seconds, before: p.baseline, chars: r.json.narrative.length, lines: r.json.voiceLines.length });
    console.log(`  ${seconds.toFixed(1).padStart(5)} s   (before ${String(p.baseline ?? '?').padStart(5)} s)   ${r.json.narrative.length} characters   ${p.text.replace(/\s+/g, ' ').slice(0, 50)}`);
  }
  // what the server's play log says about each call
  const logDir = path.join(sb.dir, 'data', 'logs', LOST);
  const entries = [];
  for (const f of (await readdir(logDir).catch(() => [])).sort()) for (const l of (await readFile(path.join(logDir, f), 'utf8')).split('\n')) { try { const e = JSON.parse(l); if (e.kind === 'chat') entries.push(e); } catch { /* skip */ } }
  console.log('\nFrom the play log (model wait, tokens):');
  for (const e of entries) console.log(`  model ${(e.apiMs / 1000).toFixed(1).padStart(5)} s of ${(e.totalMs / 1000).toFixed(1)} s   in ${e.usage?.input_tokens ?? '?'} + cached ${e.usage?.cache_read_input_tokens ?? 0} + written ${e.usage?.cache_creation_input_tokens ?? 0}   out ${e.usage?.output_tokens ?? '?'}   ${e.error ? 'ERROR ' + e.error : ''}`);
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  console.log(`\nMedian reply time: ${med(rows.map((r) => r.seconds)).toFixed(1)} s now, ${med(rows.map((r) => r.before)).toFixed(1)} s before the fixes (the first call also writes the prompt cache, so it is slower).`);
} finally { await server.stop(); }
