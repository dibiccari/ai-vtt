// Reading the DM's reply while it is still being written (lib/partial-reply.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplyStreamer } from '../lib/partial-reply.js';

const reply = { rolls: ['Goblin 1 attack: d20 (11) + 4 = 15 vs AC 14, hit', 'Damage: 1d6 (4) + 2 = 6 "slashing"'], voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: 'The blade bites her shoulder. {Brace!} It said "hee hee" \\ and fled.' }, { speaker: 'Goblin 1', voice: 'monstrous', text: 'Horny one bleeds!' }], mapUpdates: [{ type: 'token', action: 'damage', tokenId: 'pc1', value: 6 }] };
const json = JSON.stringify(reply);
const gather = (chunks) => { const s = new ReplyStreamer(), out = []; for (const c of chunks) out.push(...s.push(c)); return out; };
const expected = [
  ...reply.rolls.map((text, index) => ({ type: 'roll', index, text })),
  ...reply.voiceLines.map((line, index) => ({ type: 'line', index, line }))
];

test('every roll and voice line comes out once, in order, however the text is cut into pieces', () => {
  assert.deepEqual(gather([json]), expected);
  for (const size of [1, 2, 3, 5, 7, 13, 40]) {
    const chunks = []; for (let i = 0; i < json.length; i += size) chunks.push(json.slice(i, i + size));
    assert.deepEqual(gather(chunks), expected, 'chunks of ' + size);
  }
  for (let cut = 1; cut < json.length; cut += 3) assert.deepEqual(gather([json.slice(0, cut), json.slice(cut)]), expected, 'cut at ' + cut);
});

test('a line comes out as soon as it is complete, not before', () => {
  const s = new ReplyStreamer();
  const firstEnd = json.indexOf('{"speaker":"Narrator"') + JSON.stringify(reply.voiceLines[0]).length;
  assert.deepEqual(s.push(json.slice(0, firstEnd - 1)).filter((e) => e.type === 'line'), [], 'one character short of the closing brace');
  const got = s.push(json.slice(firstEnd - 1, firstEnd));
  assert.deepEqual(got.map((e) => e.type), ['line']); assert.equal(got[0].line.text, reply.voiceLines[0].text);
  assert.deepEqual(s.push(json.slice(firstEnd)).map((e) => e.line.speaker), ['Goblin 1']);
});

test('braces, quotes and escapes inside the story do not confuse it, and an empty or odd reply gives nothing', () => {
  assert.equal(gather([json])[2].line.text.includes('{Brace!}'), true);
  assert.deepEqual(gather(['{"rolls":[],"voiceLines":[],"mapUpdates":[]}']), []);
  assert.deepEqual(gather(['not json at all', ' still not']), []);
  assert.deepEqual(gather(['{"voiceLines":[{"speaker":"Narrator","voice":"narrator","text":"Only a story."}],"rolls":[],"mapUpdates":[]}']).map((e) => e.type), ['line']);
});
