// The scripted DM check itself, run for free: scripts/dm-check.mjs is pointed (DM_CHECK_UPSTREAM) at a fake Anthropic API that answers like a good DM
// (dice from the tray, no secrets) and like a bad one (invented dice, leaked secret, dangling token), and must pass and fail accordingly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fakeAnthropic, boardStateOf, ROOT } from './helpers/sandbox.mjs';

const upd = (o) => ({ type: 'token', action: 'move', tokenId: '', name: '', col: 0, row: 0, color: '', hidden: false, kind: 'creature', condition: '', rounds: 0, monster: '', value: 0, ac: 0, ...o });
const base = { rolls: [], narrative: 'The tavern is loud and warm, and nothing looks out of place at all.', voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'The tavern is loud and warm, and nothing looks out of place at all.' }], mapUpdates: [] };

function dm({ badDice = false, leak = false, dangling = false, removesEffect = false } = {}) {
  return (req) => {
    const state = boardStateOf(req);
    const said = JSON.stringify(req.messages.at(-1)).split('PLAYER ACTION')[1] || '';
    const d20 = state.diceTray.d20;
    if (/start a brawl/.test(said)) return { ...base, narrative: leak ? 'You notice Vorpalquux lurking by the stairs, and a Zibblewort snare on the floor.' : base.narrative, mapUpdates: [upd({ action: 'add', tokenId: 'thug1', name: 'Thug', col: 3, row: 3, monster: 'thug' }), upd({ action: 'startCombat' })] };
    if (/Initiative has been rolled/.test(said)) return { ...base, narrative: 'Thorin goes first, and the room holds its breath while he decides what to do next.' };
    if (/longsword/.test(said)) return { ...base, rolls: [`Thorin attack: d20 (${badDice ? [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].find((v) => !d20.includes(v)) : d20[0]}) + 5 = ${d20[0] + 5}`, `Damage: d8 (${state.diceTray.d8[0]}) + 3`], mapUpdates: [upd({ action: 'damage', tokenId: dangling ? 'nobody-here' : 'npc-bram', value: 5 })] };
    if (/cast Bless/.test(said)) return { ...base, mapUpdates: [upd({ action: 'addCondition', tokenId: 'pc-thorin', condition: 'bless', name: 'pc-seraphine' }), upd({ action: 'addCondition', tokenId: 'pc-vex', condition: 'bless', name: 'pc-seraphine' }), upd({ action: 'addCondition', tokenId: 'pc-seraphine', condition: 'concentrating' }), upd({ action: 'addCondition', tokenId: 'pc-lyra', condition: 'sanctuary' })] };
    if (/Sanctuary ward cast on me/.test(said)) return { ...base, rolls: [`Lyra attack: d20 (${d20[0]}) + 4 = ${d20[0] + 4}`, `Damage: d4 (${state.diceTray.d4[0]}) + 2`], mapUpdates: [upd({ action: 'damage', tokenId: 'npc-bram', value: 3 }), ...(removesEffect ? [upd({ action: 'removeCondition', tokenId: 'pc-lyra', condition: 'sanctuary' })] : [])] };
    if (/five minutes/.test(said)) return { ...base, mapUpdates: [upd({ action: 'endCombat' }), upd({ action: 'time', value: 5 }), ...(removesEffect ? [upd({ action: 'removeCondition', tokenId: 'pc-thorin', condition: 'shield of faith' })] : [])] };
    if (/Roll my Stealth/.test(said)) return { ...base, rolls: [`Vex Stealth: d20 (${d20[0]}) + 5 = ${d20[0] + 5}`], narrative: 'Somewhere behind the door a rowdy song rises, and the guard at the bar turns his head and notices you at once.' };
    if (/journal/.test(said)) return { ...base, mapUpdates: [{ type: 'journal', category: 'event', title: 'Brawl', text: 'A brawl broke out.', status: 'none', when: 'Evening' }, { type: 'journal', category: 'promise', title: 'Pay Orla', text: 'Pay for the damage.', status: 'open', when: '' }] };
    return base;
  };
}

function runCheck(fakeUrl, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/dm-check.mjs', '--live', '--max-calls', '10', ...extra], { cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-fake', DM_CHECK_UPSTREAM: fakeUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
}

test('dm-check passes against a well-behaved fake DM, prints no story text and reports usage', async () => {
  const f = await fakeAnthropic([dm()]);
  try {
    const r = await runCheck(f.url);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASSED: 0 failure/);
    assert.match(r.out, /USAGE 8 API request\(s\)/);
    assert.match(r.out, /journal: 2 entries added/);
    assert.ok(!r.out.includes('tavern is loud'), 'no narrative is printed');
    assert.ok(!r.out.includes('sk-ant-fake'), 'the key is never printed');
    assert.equal(f.requests.length, 8);
  } finally { await f.close(); }
});

for (const [name, mode, pattern] of [['invented dice', { badDice: true }, /FAIL attack: reported dice/], ['an effect it should leave to the table', { removesEffect: true }, /FAIL (warded: after a hit|time: the DM did not remove)/], ['a leaked secret', { leak: true }, /FAIL brawl: hidden token marker/], ['a dangling token id', { dangling: true }, /FAIL attack: every update names a real token/]]) {
  test(`dm-check fails when the DM makes up ${name}`, async () => {
    const f = await fakeAnthropic([dm(mode)]);
    try {
      const r = await runCheck(f.url);
      assert.equal(r.code, 1, r.out); assert.match(r.out, pattern);
    } finally { await f.close(); }
  });
}

test('without --live nothing is run and nothing is spent', async () => {
  const r = await new Promise((resolve) => { const c = spawn(process.execPath, ['scripts/dm-check.mjs'], { cwd: ROOT, env: { ...process.env, ANTHROPIC_API_KEY: '' } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('exit', (code) => resolve({ code, o })); });
  assert.equal(r.code, 0); assert.match(r.o, /Add --live to run it/);
});
