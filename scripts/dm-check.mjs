// Scripted DM check: a short, fixed conversation with the REAL Dungeon Master (paid API calls), with invariants asserted on every reply.
//   npm run dm-check -- --dry-run       print the plan, spend nothing
//   npm run dm-check -- --live          run it (default at most 8 API calls; --max-calls N, --timeout SECONDS per call, default 180)
// It starts a throwaway server on a COPY of the data (the real data/ is never touched) with a fresh campaign copied from the tavern test,
// puts a local proxy between the server and api.anthropic.com to see the requests (dice tray) and the real token usage, and prints
// pass/fail lines only: no story text. The key comes from ANTHROPIC_API_KEY or the repo's .env (never printed, never copied into the sandbox).
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { startServer, ROOT } from '../test/helpers/sandbox.mjs';
import { loadServerPieces, validateSchema } from './dm-schema.mjs';
import { CATEGORIES, STATUSES } from '../lib/journal.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MAX_CALLS = Number(opt('--max-calls', 12));
const ONLY_STEPS = opt('--only', '').split(',').filter(Boolean);                  // run just these steps (the table starts the pretend fight itself when it is needed)
const DEBUG_STEPS = opt('--debug-steps', '').split(',').filter(Boolean);        // print the updates and the start of the narrative of these steps (the tavern scenario has no secrets)
const TIMEOUT_MS = Number(opt('--timeout', 180)) * 1000;
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-fable-5-1': [10, 50], 'claude-haiku-4-5': [1, 5] };   // $ per million tokens (input, output); cache reads cost 5% of input, cache writes 125%

// Markers: invented names put on hidden tokens. If either shows up in what the players are told, the DM leaked a secret.
const MARK_CREATURE = 'Vorpalquux';
const MARK_TRAP = 'Zibblewort';
const MARK_NOISY = 'Quibblethorp';          // a hidden group that makes noise: the party may get a hint of sound, never the name
const MARK_SILENT = 'Snorfelbat';           // a hidden creature that makes no sound: no hint at all

// Every step is one paid call. The first four reproduce what the real tabletop does around a fight: the DM starts combat, the TABLE rolls initiative and hands the turn
// back ("[Table] Initiative has been rolled..."), and only then does a player attack. (The first version skipped that hand-over and sent tokens with no initiative while the
// combat block said Thorin had 25, so the DM saw a board that contradicted itself; its attack step failed for that reason or one like it.)
const STEPS = [
  { id: 'brawl', say: '[Thorin] I shove the nearest drunk and start a brawl. Start combat.', expect: 'startCombat sent, new creatures carry hit points and AC, no initiative rolled by the DM' },
  { id: 'handoff', say: 'TABLE', expect: 'the DM gives the status and options for the active player and waits (no rolls, no turns played for the player)' },
  { id: 'attack', say: '[Thorin] I attack Drunk Bram, who is right next to me, with my longsword, and roll damage if I hit.', expect: 'attack and damage from the tray, updates name real tokens' },
  { id: 'effects', say: '[Seraphine] It is my turn. I cast Bless on Thorin and Vex with my action, concentrating on it. Just apply it.', expect: 'a known effect sent by name only (table gives the duration), caster id as source for the concentration effect, concentrating on the caster' },
  { id: 'warded', say: '[Lyra] It is my turn. I carry a Sanctuary ward cast on me earlier and I know that attacking will end it, so go ahead: I attack Drunk Bram with my dagger and roll damage if I hit.', expect: 'the DM does not remove sanctuary itself after a hit (the table does)' },
  { id: 'time', say: '[Thorin] Bram is down and the room has emptied. We tidy up and spend about five minutes talking with Orla by the fire.', expect: 'the time action advances the clock; the DM does not remove an effect that is still running because the fight ended' },
  { id: 'senses', say: '[Vex] I slip along the wall towards the back door, trying not to be seen by the guard at the bar, and I listen carefully at the door. Roll my Stealth and tell me what I hear.', expect: 'Stealth roll from the tray against the guard\'s passive Perception, a hint of noise from the noisy hidden group, nothing from the silent one' },
  { id: 'gear', say: '[Thorin] I buy a hempen rope (50 ft) and two torches from Orla, the barkeep, and pay with coins from my purse. Please update my gear and coins.', expect: 'gear updates: a rope and torches added to Thorin and coins spent, applied by the server' },
  { id: 'travel', say: '[Thorin] The fight is over. We open the cellar hatch behind the bar and go down into the old cellars to look for the missing barrels, all four of us together.', expect: 'changeMap to the cellars map, resolved to a picture and an arrival square, no problems reported' },
  { id: 'journal', say: '[Seraphine] Please write the brawl into the journal as an event, and our promise to pay Orla for the damage as a promise.', expect: 'journal entries with valid categories' }
];

if (flag('--dry-run') || !flag('--live')) {
  console.log('DM check plan (nothing is spent):');
  console.log(`  1. start a throwaway server on a copy of the data, with a new campaign "dm-check" (copy of the tavern test) and a local proxy to api.anthropic.com`);
  console.log(`  2. send ${STEPS.length} fixed player messages (at most ${MAX_CALLS} API calls in all, ${TIMEOUT_MS / 1000} s timeout each):`);
  STEPS.forEach((s, i) => console.log(`     ${i + 1}. [${s.id}] expect: ${s.expect}`));
  console.log('  3. every reply: HTTP 200, reply matches DM_SCHEMA, voices valid, dice from the tray, no hidden-token markers, token ids real, journal categories valid');
  console.log('  4. print token usage and a cost estimate (about $0.05 to $0.30 per call with the campaign text cached: the first call writes the cache)');
  if (!flag('--live')) console.log('\nAdd --live to run it (this spends money on your Anthropic key).');
  process.exit(0);
}

const envFile = opt('--env-file', path.join(ROOT, '.env'));
const key = process.env.ANTHROPIC_API_KEY || (existsSync(envFile) ? dotenv.parse(readFileSync(envFile)).ANTHROPIC_API_KEY : '');
if (!key) { console.error('No ANTHROPIC_API_KEY in the environment or in ' + envFile); process.exit(2); }
const model = process.env.ANTHROPIC_MODEL || (existsSync(envFile) ? dotenv.parse(readFileSync(envFile)).ANTHROPIC_MODEL : '') || 'claude-opus-5-5';

let failures = 0, warnings = 0;
const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { failures++; console.log('FAIL ' + m); };
const warn = (m) => { warnings++; console.log('WARN ' + m); };
const check = (cond, m, detail = '') => (cond ? pass(m) : fail(m + (detail ? ' (' + detail + ')' : '')));

// ---- proxy: forwards to Anthropic, records request bodies and usage, enforces the call cap ----
const calls = [];
const proxy = createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', async () => {
    if (calls.length >= MAX_CALLS) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'dm-check call cap reached' } })); }
    const body = Buffer.concat(chunks);
    const rec = { at: Date.now(), request: null, response: null, status: 0, ms: 0 };
    calls.push(rec);
    try { rec.request = JSON.parse(body.toString('utf8')); } catch { /* not JSON */ }
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection', 'accept-encoding'].includes(k)));
      const up = await fetch((process.env.DM_CHECK_UPSTREAM || 'https://api.anthropic.com') + req.url, { method: req.method, headers, body: req.method === 'GET' ? undefined : body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const buf = Buffer.from(await up.arrayBuffer());
      rec.status = up.status; rec.ms = Date.now() - rec.at;
      try { rec.response = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }
      res.statusCode = up.status; res.setHeader('content-type', up.headers.get('content-type') || 'application/json'); res.end(buf);
    } catch (err) { rec.status = 599; rec.ms = Date.now() - rec.at; res.statusCode = 504; res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'proxy: ' + err.message } })); }
  });
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

const { DM_SCHEMA, VOICES } = loadServerPieces();
const srv = await startServer({ env: { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: proxyUrl, ANTHROPIC_MODEL: model } });
const cleanup = async () => { await srv.stop().catch(() => {}); await new Promise((r) => proxy.close(r)); };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  console.log(`DM check against model ${model}; throwaway server on port ${srv.port}; at most ${MAX_CALLS} API calls.`);
  // fresh campaign: a copy of the tavern test with its four characters
  const made = await srv.post('/api/campaigns/new', { template: 'tavern-brawl-test', name: 'dm-check', party: ['thorin', 'lyra', 'vex', 'seraphine'], settings: {} });
  check(made.status === 200 && made.json.id === 'dm-check', 'fresh campaign created in the sandbox');
  await srv.post('/api/campaigns/active', { id: 'dm-check' });
  await srv.post('/api/campaigns/dm-check/start-over');
  const chars = (await srv.get('/api/characters?campaign=dm-check')).json;
  const flagon = (await srv.get('/api/maps/available')).json.maps.find((m) => m.id === 'rusty-flagon');
  check(chars.length === 4 && !!flagon, 'party of four and the tavern map are available');
  if (failures) throw new Error('setup failed');

  // The board the tabletop would send
  const mk = (o) => ({ where: '', readied: '', image: '', hidden: false, kind: 'creature', speed: 30, movementRemaining: 30, conditions: [], summon: null, lightKind: '', dead: false, stable: false, deathSaves: null, spent: null, initiative: null, visibleToParty: true, ...o });
  const c0 = flagon.start.col, r0 = flagon.start.row;
  let tokens = chars.map((c, i) => mk({ id: 'pc-' + c.id, name: c.name, col: c0 + i, row: r0, color: c.color, isPC: true, characterId: c.id, hp: c.hp, maxHp: c.maxHp, ac: c.ac, dexMod: Math.floor((c.abilities.dex - 10) / 2) }));
  tokens.push(
    mk({ id: 'npc-orla', name: 'Orla the barkeep', col: c0 + 2, row: r0 - 6, color: '#c9a', isPC: false, hp: 9, maxHp: 9, ac: 10, dexMod: 0 }),
    mk({ id: 'npc-bram', name: 'Drunk Bram', col: c0, row: r0 - 1, color: '#a96', isPC: false, hp: 11, maxHp: 11, ac: 10, dexMod: 0 }),
    mk({ id: 'npc-hidden', name: MARK_CREATURE + ' the Unseen', col: c0 + 5, row: r0 - 4, color: '#333', isPC: false, hidden: true, visibleToParty: false, hp: 20, maxHp: 20, ac: 13, dexMod: 2 }),
    mk({ id: 'trap-hidden', name: MARK_TRAP + ' snare', col: c0 + 3, row: r0 - 2, color: '#a00', isPC: false, hidden: true, kind: 'trap', visibleToParty: false })
  );
  const T = { active: 'pc-thorin', clock0: 0 };
  const upd = (j) => j.mapUpdates || [];
  const clockNow = async () => (await srv.get('/api/party')).json.clock.minutes;
  const byId = (id) => tokens.find((t) => t.id === id);
  const condOf = (u) => String(u.condition || '').toLowerCase().trim();
  // What the tabletop does when a fight starts: the table (not the DM) rolls initiative, so every token gets its number and the combat block lists them in order.
  const startPretendCombat = () => {
    const members = tokens.filter((t) => t.kind !== 'trap' && !t.hidden);
    const fixed = { 'pc-thorin': 25, 'pc-lyra': 15, 'pc-vex': 12, 'pc-seraphine': 8 };
    let low = 10;
    for (const t of members) t.initiative = fixed[t.id] ?? Math.max(1, low--);
    members.sort((a, b) => b.initiative - a.initiative);
    combat = { active: true, round: 1, currentTokenId: 'pc-thorin', order: members.map((t) => ({ tokenId: t.id, initiative: t.initiative })) };
  };
  const tableHandoff = () => '[Table] Initiative has been rolled by the table: ' + combat.order.map((o) => byId(o.tokenId).name + ' ' + o.initiative).join(', ') + ". It is Thorin's turn. Say who goes first, give the status and the options for Thorin, and wait; do not roll anything.";
  const setActive = (id) => { T.active = id; if (combat.active) combat.currentTokenId = id; };
  const hooks = {
    before: {
      effects: async () => setActive('pc-seraphine'),
      warded: async () => { setActive('pc-lyra'); const l = byId('pc-lyra'); if (l && !l.conditions.some((c) => c.name === 'sanctuary')) l.conditions.push({ name: 'sanctuary', rounds: 10, untilMin: undefined }); },        // Lyra was warded earlier by someone else's turn: the table state carries it
      time: async () => {                                              // a 10 minute concentration effect is running on Thorin, put on by Vex: it must survive the end of the fight
        T.clock0 = await clockNow();
        if (byId('npc-bram')) Object.assign(byId('npc-bram'), { hp: 0, dead: true });
        byId('pc-thorin').conditions.push({ name: 'shield of faith', rounds: 0, untilMin: T.clock0 + 10, minutesLeft: 10, source: 'pc-vex', concentration: true });
        byId('pc-vex').conditions.push({ name: 'concentrating', rounds: 0 });
        setActive('pc-thorin');
      },
      senses: async () => {
        combat = { active: false };
        T.active = 'pc-vex';
        const c = byId('pc-vex'), r = c.row;
        tokens.push(
          mk({ id: 'npc-guard', name: 'Guard at the bar', col: c.col - 3, row: r - 2, color: '#889', isPC: false, hp: 11, maxHp: 11, ac: 16, dexMod: 1, passivePerception: 30 }),
          mk({ id: 'npc-choir', name: MARK_NOISY + ' and friends', col: c.col + 6, row: r - 8, color: '#555', isPC: false, hidden: true, visibleToParty: false, hp: 20, maxHp: 20, ac: 11, dexMod: 0, passivePerception: 10, dmNote: 'Behind the back door, singing a loud, rowdy drinking song together.' }),
          mk({ id: 'npc-sleeper', name: MARK_SILENT, col: c.col + 5, row: r - 7, color: '#444', isPC: false, hidden: true, visibleToParty: false, hp: 5, maxHp: 5, ac: 10, dexMod: 0, passivePerception: 10, dmNote: 'Curled up asleep in a barrel behind the back door. Makes no sound at all.' })
        );
      }
    }
  };
  const knownIds = () => new Set([...tokens.map((t) => t.id), ...chars.map((c) => c.id)]);
  let combat = { active: false };
  const history = [];
  const revealed = new Set();
  const used = { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0, d100: 0 };

  for (const [n, step] of STEPS.entries()) {
    if (ONLY_STEPS.length && !ONLY_STEPS.includes(step.id)) continue;
    if (ONLY_STEPS.length && !combat.active && ['handoff', 'attack', 'effects', 'warded'].includes(step.id)) startPretendCombat();
    if (calls.length >= MAX_CALLS) { warn(`call cap reached before step ${step.id}`); break; }
    console.log(`-- step ${n + 1}/${STEPS.length}: ${step.id}`);
    const before = calls.length;
    const t0 = Date.now();
    let res;
    if (step.id === 'handoff' && !combat.active) { warn('handoff: the DM did not start combat in the brawl step; the table starts it now'); startPretendCombat(); }
    const said = step.say === 'TABLE' ? tableHandoff() : step.say;
    try {
      if (hooks.before[step.id]) await hooks.before[step.id]();
      res = await Promise.race([
        srv.post('/api/chat', { message: said, history: history.slice(-8), activeTokenId: T.active, tokens, characters: chars, walls: [], gridSize: 50, mapUrl: flagon.url, mapName: flagon.name, inputMode: 'text', combat, diceMode: 'ai', movementRule: 'circle' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS + 5000))
      ]);
    } catch (err) { fail(`${step.id}: no reply (${err.message})`); continue; }
    check(res.status === 200 && !res.json?.offline, `${step.id}: HTTP 200 in ${((Date.now() - t0) / 1000).toFixed(1)} s`, `status ${res.status} ${String(res.json?.error || '').slice(0, 120)}`);
    if (res.status !== 200) continue;
    const j = res.json;
    if (DEBUG_STEPS.includes(step.id)) console.log('DEBUG ' + step.id + ' ' + JSON.stringify({ updates: (j.mapUpdates || []).map((u) => ({ t: u.type, id: u.tokenId, c: u.condition, r: u.rounds, m: u.minutes, s: u.source })), rolls: j.rolls, narrative: String(j.narrative || '').slice(0, 600) }));
    const rec = calls.slice(before).find((c) => c.response && c.status === 200) || calls[calls.length - 1];
    const retries = calls.length - before - 1;
    if (retries > 0) warn(`${step.id}: ${retries} extra API request(s) (the SDK retried)`);

    // 1. raw reply matches the schema
    let raw = null;
    try { raw = JSON.parse(rec.response.content.find((b) => b.type === 'text').text); } catch { /* checked next */ }
    const problems = raw ? validateSchema(raw, DM_SCHEMA) : ['reply is not JSON'];
    check(problems.length === 0, `${step.id}: reply is valid JSON matching the DM schema`, problems.slice(0, 2).join('; '));
    check(rec.response?.stop_reason === 'end_turn', `${step.id}: stop reason end_turn`, String(rec.response?.stop_reason));
    check(typeof j.narrative === 'string' && j.narrative.length > 20 && Array.isArray(j.voiceLines) && j.voiceLines.every((l) => VOICES.includes(l.voice) && l.text), `${step.id}: narrative and voice lines are well formed`);

    // 2. dice come from the tray the server put in the request
    const tray = rec.request ? boardTray(rec.request) : null;
    if (tray && Array.isArray(j.rolls)) {
      const verdict = checkDice(j.rolls, tray, used);
      check(verdict.bad.length === 0, `${step.id}: reported dice match the supplied tray (${verdict.ok} verified, ${verdict.unknown} lines with no checkable natural roll)`, verdict.bad.join(' | ').slice(0, 200));
      if (step.id === 'attack') {
        check(j.rolls.length > 0, 'attack: the DM reported at least one roll', diagnose(j, raw));
      }
    }

    // 3. secrets
    const told = [j.narrative, ...(j.rolls || []), ...(j.voiceLines || []).map((l) => `${l.speaker} ${l.text}`)].join('\n').toLowerCase();
    for (const [id, mark] of [['npc-hidden', MARK_CREATURE], ['trap-hidden', MARK_TRAP], ['npc-choir', MARK_NOISY], ['npc-sleeper', MARK_SILENT]]) {
      const revealing = revealed.has(id);
      check(revealing || !told.includes(mark.toLowerCase()), `${step.id}: hidden token marker "${mark}" not mentioned`);
    }
    for (const u of raw?.mapUpdates || []) if (u.type === 'token' && u.action === 'reveal' && u.tokenId) revealed.add(u.tokenId);

    // 4. token and character references are real
    const added = new Set((j.mapUpdates || []).filter((u) => u.type === 'addToken').map((u) => u.tokenId));
    const ids = new Set([...knownIds(), ...added]);
    const dangling = (j.mapUpdates || []).filter((u) => u.tokenId && !ids.has(u.tokenId) && !['addToken'].includes(u.type)).map((u) => `${u.type}:${u.tokenId}`);
    check(dangling.length === 0, `${step.id}: every update names a real token`, dangling.join(', '));
    const badHp = (raw?.mapUpdates || []).filter((u) => u.type === 'setHp' && !chars.some((c) => c.id === u.characterId)).length;
    check(badHp === 0, `${step.id}: setHp names real characters`);
    for (const u of j.mapUpdates || []) if (u.type === 'moveToken') check(Number.isInteger(u.col) && Number.isInteger(u.row), `${step.id}: moveToken has a square`);
    if ((j.characterProblems || []).length) warn(`${step.id}: server reported ${j.characterProblems.length} problem(s) applying the reply: ${j.characterProblems.map((p) => p.slice(0, 80)).join(' | ')}`);

    // 5. step-specific
    if (step.id === 'brawl') {
      check((j.mapUpdates || []).some((u) => u.type === 'startCombat'), 'brawl: the DM started combat (startCombat)');
      const bad = (j.mapUpdates || []).filter((u) => u.type === 'addToken' && !(u.maxHp > 0 && u.ac > 0));
      check(bad.length === 0, 'brawl: every creature the DM added carries hit points and AC', bad.map((u) => u.name).join(', '));
    }
    if (step.id === 'brawl') check(!(j.rolls || []).some((r) => /initiative/i.test(r)), 'brawl: the DM did not roll initiative itself (the table does)');
    if (step.id === 'handoff') {
      check((j.rolls || []).length === 0, 'handoff: the DM rolled nothing', (j.rolls || []).join(' | ').slice(0, 160));
      check(!upd(j).some((u) => ['damageToken', 'endTurn', 'moveToken'].includes(u.type)), 'handoff: the DM played no turn for the player', upd(j).map((u) => u.type).join(','));
      check(/thorin/i.test(j.narrative), 'handoff: the DM addresses the active player');
    }
    if (step.id === 'attack') {
      check((j.rolls || []).some((r) => /d20/i.test(r)), 'attack: a d20 attack roll was reported', diagnose(j, raw));
      const hurt = upd(j).some((u) => ['damageToken', 'setHp'].includes(u.type));
      if (!hurt) warn('attack: no damage update came back (the DM may have narrated a miss)');
    }
    if (step.id === 'effects') {
      const adds = upd(j).filter((u) => u.type === 'addCondition');
      const find = (tok, name) => adds.find((u) => u.tokenId === tok && condOf(u) === name);
      check(!!find('pc-thorin', 'bless') && !!find('pc-vex', 'bless'), 'effects: bless put on Thorin and Vex', adds.map((u) => u.tokenId + ':' + condOf(u)).join(', '));
      const b = find('pc-thorin', 'bless'), sa = find('pc-lyra', 'sanctuary'), conc = find('pc-seraphine', 'concentrating');
      check(!!b && b.rounds === 0 && !b.minutes, 'effects: bless sent by name only (rounds 0, no minutes: the table gives the duration)', b ? "rounds " + b.rounds + ", minutes " + b.minutes : 'missing');
      check(!!b && b.source === 'pc-seraphine', 'effects: the concentration effect carries the caster\'s token id', b ? 'source ' + JSON.stringify(b.source) : 'missing');
      check(!!conc, 'effects: Seraphine is marked concentrating');
    }
    if (step.id === 'warded') {
      const hit = upd(j).some((u) => u.type === 'damageToken'), removed = upd(j).some((u) => u.type === 'removeCondition' && /sanctuary/.test(condOf(u)));
      check((j.rolls || []).some((r) => /d20/i.test(r)), 'warded: the attack was rolled', diagnose(j, raw));
      check(!(hit && removed), 'warded: after a hit that deals damage the DM leaves ending sanctuary to the table');
      if (!hit && !removed) warn('warded: no damage and sanctuary not removed (a miss also ends sanctuary: the DM should have removed it)');
      if (hit) { const l = byId('pc-lyra'); l.conditions = l.conditions.filter((c) => c.name !== 'sanctuary'); }   // the table ends it
    }
    if (step.id === 'time') {
      // The server applies the time action itself (it is not in mapUpdates), so the clock tells what the DM sent.
      const after = await clockNow(), mins = after - T.clock0;
      check(mins >= 3 && mins <= 20, `time: the DM advanced the clock with the time action (${mins} min for about five minutes of story)`);
      const wrong = upd(j).filter((u) => u.type === 'removeCondition' && ['pc-thorin', 'pc-vex'].includes(u.tokenId) && /shield of faith|concentrating/.test(condOf(u)));
      check(wrong.length === 0, 'time: the DM did not remove the 10 minute effect that is still running (a finished fight ends nothing)', wrong.map((u) => u.tokenId + ':' + condOf(u)).join(', '));
    }
    if (step.id === 'senses') {
      const stealth = (j.rolls || []).find((r) => /stealth/i.test(r));
      check(!!stealth, 'senses: the DM rolled Vex\'s Stealth', (j.rolls || []).join(' | ').slice(0, 160));
      check(/\b(sing|song|voices?|chant|noise|sound|hear|heard|music|bellow|rowdy|chorus|muffled)\b/i.test(j.narrative + ' ' + (j.voiceLines || []).map((l) => l.text).join(' ')), 'senses: a hint of the noise behind the door came through');
      if (/\b(asleep|snor|sleeping|barrel)/i.test(told)) warn('senses: something about the silent creature was hinted (no sound, so no hint should come)');
      if (!/\b(notice|spot|saw|sees|see you|eye|glance|turn|catch|caught|look|watch)/i.test(j.narrative)) warn('senses: the narrative does not say the guard noticed Vex (his passive Perception is 30, above any possible roll)');
    }
    if (step.id === 'gear') {
      const gears = (raw?.mapUpdates || []).filter((u) => u.type === 'gear');
      check(gears.length >= 1, 'gear: the DM sent gear updates', gears.length + ' updates');
      const rope = gears.find((u) => u.action === 'add' && /rope/i.test(u.name)), torch = gears.find((u) => u.action === 'add' && /torch/i.test(u.name));
      const spent = gears.find((u) => u.action === 'coins' && (u.gp < 0 || u.sp < 0 || u.cp < 0 || u.ep < 0));
      check(!!rope && /thorin/i.test(rope.target), 'gear: a rope added to Thorin', rope ? 'target ' + rope.target : 'missing');
      check(!!torch && /thorin/i.test(torch.target) && torch.qty >= 2, 'gear: two torches added to Thorin', torch ? 'target ' + torch.target + ', qty ' + torch.qty : 'missing');
      check(!!spent && /thorin/i.test(spent.target), 'gear: coins spent from Thorin', spent ? 'target ' + spent.target : 'missing');
      const th = (await srv.get('/api/characters?campaign=dm-check')).json.find((c) => c.id === 'thorin');
      check((th.inventory || []).some((i) => /rope/i.test(i.name)) && (th.inventory || []).some((i) => /torch/i.test(i.name)), 'gear: the rope and torches are in Thorin\'s saved inventory');
      check((j.partyChanged || []).includes('thorin'), 'gear: the table was told the party changed');
    }
    if (step.id === 'travel') {
      const asked = (raw?.mapUpdates || []).find((u) => u.type === 'changeMap');
      check(!!asked && /cellar/i.test(asked.mapId), 'travel: the DM moved the table to the cellars map', asked ? 'mapId ' + asked.mapId : 'no changeMap');
      const moved = upd(j).find((u) => u.type === 'changeMap');
      check(!!moved && /dungeon-cellars/.test(moved.mapUrl) && Number.isInteger(moved.col) && Number.isInteger(moved.row), 'travel: the server resolved it to the picture and an arrival square', moved ? moved.mapUrl : 'not resolved');
      check((j.characterProblems || []).length === 0, 'travel: no problems were reported', (j.characterProblems || []).join('; ').slice(0, 160));
    }
    if (step.id === 'journal') {
      check((j.journalAdded || []).length >= 1, `journal: ${j.journalAdded?.length || 0} entries added`);
      check((j.journalAdded || []).every((e) => CATEGORIES.includes(e.category)), 'journal: categories are valid');
      const saved = (await srv.get('/api/campaigns/dm-check/journal')).json.entries;
      check(saved.length >= 1 && saved.every((e) => CATEGORIES.includes(e.category) && STATUSES.includes(e.status) && e.title && e.text), 'journal: saved entries are well formed');
    }

    // advance the pretend table
    for (const u of j.mapUpdates || []) {
      if (u.type === 'addToken') tokens.push(mk({ id: u.tokenId, name: u.name, col: u.col, row: u.row, color: u.color || '#999', isPC: false, hidden: !!u.hidden, kind: u.kind || 'creature', hp: u.maxHp, maxHp: u.maxHp, ac: u.ac, dexMod: u.dexMod || 0, visibleToParty: !u.hidden }));
      else if (u.type === 'removeToken') tokens = tokens.filter((t) => t.id !== u.tokenId);
      else if (u.type === 'moveToken') { const t = tokens.find((x) => x.id === u.tokenId); if (t) { t.col = u.col; t.row = u.row; } }
      else if (u.type === 'revealToken') { const t = tokens.find((x) => x.id === u.tokenId); if (t) { t.hidden = false; t.visibleToParty = true; } }
      else if (u.type === 'damageToken') { const t = tokens.find((x) => x.id === u.tokenId); if (t && t.hp !== undefined) t.hp = Math.max(0, t.hp - (u.value || 0)); }
      else if (u.type === 'addCondition') { const t = byId(u.tokenId); if (t && condOf(u)) t.conditions.push({ name: condOf(u), rounds: u.rounds || 0, ...(u.source ? { source: u.source } : {}) }); }
      else if (u.type === 'removeCondition') { const t = byId(u.tokenId); if (t) t.conditions = t.conditions.filter((c) => c.name !== condOf(u)); }
      else if (u.type === 'startCombat') startPretendCombat();
      else if (u.type === 'endCombat') combat = { active: false };
    }
    history.push({ role: 'user', content: said }, { role: 'assistant', content: j.narrative });
  }

  // ---- usage and cost ----
  const [pin, pout] = PRICES[model] || PRICES['claude-opus-5-5'];
  let inp = 0, out = 0, cr = 0, cw = 0, cost = 0;
  for (const c of calls) {
    const u = c.response?.usage; if (!u) continue;
    inp += u.input_tokens || 0; out += u.output_tokens || 0; cr += u.cache_read_input_tokens || 0; cw += u.cache_creation_input_tokens || 0;
  }
  cost = (inp * pin + out * pout + cr * pin * 0.05 + cw * pin * 1.25) / 1e6;
  console.log(`USAGE ${calls.length} API request(s): input ${inp}, cache write ${cw}, cache read ${cr}, output ${out} tokens; estimated cost $${cost.toFixed(3)} at ${PRICES[model] ? model : 'claude-opus-5-5 (model price unknown)'} list prices`);
  console.log(`LATENCY ${calls.map((c) => (c.ms / 1000).toFixed(1) + 's').join(', ')}`);
} catch (err) {
  fail('check aborted: ' + err.message);
} finally {
  await cleanup();
}
console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);

// The dice tray the server sent with the request (inside the BOARD STATE of the last user message).
function boardTray(request) {
  try {
    const last = request.messages[request.messages.length - 1];
    const text = Array.isArray(last.content) ? last.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : last.content;
    return JSON.parse(/BOARD STATE \(JSON\):\n(.*)\n\nPLAYER ACTION/.exec(text)[1]).diceTray;
  } catch { return null; }
}

// Every roll line that states its natural die ("d20 (14)", "d8 [5]", "rolled 14") must show a number from the tray, taken in order for that die.
// Lines that only give a total cannot be checked and are counted, not failed.
function checkDice(lines, tray, usedCount) {
  const verdict = { ok: 0, unknown: 0, bad: [] };
  for (const line of lines) {
    const explicit = [...String(line).matchAll(/\bd(4|6|8|10|12|20|100)\b\s*[\(\[:=]?\s*(\d{1,3})(?:\s*[,+]\s*(\d{1,3}))?/gi)];
    if (!explicit.length) { verdict.unknown++; continue; }
    for (const m of explicit) {
      const die = 'd' + m[1], naturals = [Number(m[2]), m[3] ? Number(m[3]) : null].filter((x) => x !== null && x >= 1 && x <= Number(m[1]));
      if (!naturals.length) { verdict.unknown++; continue; }
      const list = tray[die] || [];
      const next = list[usedCount[die]];
      // advantage shows two naturals: both must be the next two tray values
      const want = naturals.length === 2 ? [list[usedCount[die]], list[usedCount[die] + 1]] : [next];
      if (naturals.every((v, i) => v === want[i])) { usedCount[die] += naturals.length; verdict.ok++; }
      else if (naturals.every((v) => list.includes(v))) { verdict.ok++; verdict.unknown += 0; warn(`dice: ${die} ${naturals.join(',')} is in the tray but not the next unused value`); usedCount[die] = Math.max(usedCount[die], list.indexOf(naturals[0]) + 1); }
      else verdict.bad.push(`${die} ${naturals.join(',')} not in tray`);
    }
  }
  return verdict;
}

// Why a reply had no roll, without printing any story text: which updates it sent, whether the narrative contains dice notation or
// turn-order words, and what the board said about whose turn it was.
function diagnose(j, raw) {
  const text = String(j.narrative || '').toLowerCase();
  const kinds = (raw?.mapUpdates || []).map((u) => u.type === 'token' ? 'token:' + u.action : u.type).join(',') || 'none';
  return `updates [${kinds}]; narrative has digits-with-d20/damage notation: ${/\bd\d+|\d+\s*(damage|to hit)/.test(text)}; mentions turn/initiative: ${/turn|initiative/.test(text)}; mentions range/move/reach: ${/\b(move|reach|range|too far|distance|closer|step)\b/.test(text)}; ${j.narrative?.length || 0} narrative chars`;
}
