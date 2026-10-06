// Rules tracking through the HTTP API (lib/rules-track.js, lib/rules-apply.js): clock, Hit Dice, exhaustion, resources, XP, rests and the 24 hour limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/sandbox.mjs';

let s;
const LOST = 'lost-mine-of-phandelver';
before(async () => { s = await startServer(); await s.post('/api/campaigns/active', { id: LOST }); });
after(async () => { await s.stop(); });
const party = async () => (await s.get('/api/party')).json;
const who = async (id) => (await party()).characters.find((c) => c.id === id);
const setChar = (id, patch) => s.post('/api/characters', { ...patch, id });

test('the party view carries the clock, rules and per-character tracking', async () => {
  const p = await party();
  assert.deepEqual([p.clock.day, p.clock.hour, p.clock.minute, p.clock.longRestReady], [1, 8, 0, true]);
  const e = p.characters.find((c) => c.id === 'edric');
  assert.equal(e.rules.level, 1); assert.equal(e.rules.nextLevelAt, 300); assert.equal(e.rules.hitDice.total, 1); assert.equal(e.rules.exhaustion, 0);
});

test('clock: advance, set, clamp and refuse nonsense', async () => {
  let r = await s.post('/api/party/clock', { minutes: 90 }); assert.equal(r.status, 200); assert.match(r.json.notes[0], /Day 1, 09:30/);
  r = await s.post('/api/party/clock', { set: { day: 3, hour: 7, minute: 30 } }); assert.match(r.json.notes[0], /Day 3, 07:30 \(dawn\)/);
  r = await s.post('/api/party/clock', { set: { day: -4, hour: 99, minute: 99 } }); assert.equal(r.status, 200);
  const c = (await party()).clock; assert.ok(c.hour >= 0 && c.hour <= 23 && c.minute >= 0 && c.minute <= 59 && c.day >= 1, JSON.stringify(c));
  await s.post('/api/party/clock', { set: { day: 1, hour: 8, minute: 0 } });
  const before = (await party()).clock.minutes;
  await s.post('/api/party/clock', { minutes: -500 });
  assert.ok((await party()).clock.minutes >= before - 0, 'time never runs backwards');
});

test('hit dice: roll plus Constitution, never above maximum hit points, none left is a note not a crash', async () => {
  await setChar('edric', { name: 'Edric', class: 'Fighter', level: 1, hp: 1, maxHp: 12, ac: 18, abilities: { str: 16, dex: 14, con: 15, int: 9, wis: 13, cha: 11 } });
  const r = await s.post('/api/party/hit-dice', { characterId: 'edric', count: 1 });
  assert.equal(r.status, 200); assert.match(r.json.notes[0], /spends 1 Hit Die \(d10: \d+\+2\)/);
  const e = await who('edric'); assert.ok(e.hp >= 1 && e.hp <= 12); assert.equal(e.rules.hitDice.left, 0);
  const again = await s.post('/api/party/hit-dice', { characterId: 'edric', count: 3 });
  assert.match(again.json.notes[0], /no Hit Dice left/);
  assert.equal((await s.post('/api/party/hit-dice', { characterId: 'nobody', count: 1 })).status, 400);
  const byName = await s.post('/api/party/hit-dice', { characterId: 'raechyl', count: 1 }); assert.equal(byName.status, 200, 'characters can be named, not just identified');
});

test('exhaustion: levels clamp between 0 and 6, level 6 is death (hit points 0), a long rest lowers it by one', async () => {
  await setChar('shadowheart', { name: 'Shadowheart', class: 'Cleric', level: 1, hp: 9, maxHp: 9, ac: 18, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } });
  let r = await s.post('/api/party/exhaustion', { characterId: 'shadowheart', delta: 2 }); assert.match(r.json.notes[0], /0 -> 2/);
  assert.equal((await who('shadowheart')).rules.exhaustionEffects.length, 2, 'effects are cumulative');
  await s.post('/api/party/exhaustion', { characterId: 'shadowheart', delta: -9 }); assert.equal((await who('shadowheart')).rules.exhaustion, 0);
  await s.post('/api/party/exhaustion', { characterId: 'shadowheart', delta: 99 });
  const dead = await who('shadowheart'); assert.equal(dead.rules.exhaustion, 6); assert.equal(dead.hp, 0);
  await setChar('shadowheart', { name: 'Shadowheart', class: 'Cleric', level: 1, hp: 9, maxHp: 9, ac: 18, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } });
  await s.post('/api/party/exhaustion', { characterId: 'shadowheart', delta: -9 });
  await s.post('/api/party/exhaustion', { characterId: 'shadowheart', delta: 3 });
});

test('exhaustion text follows the campaign rules version (2014 list, 2024 penalties)', async () => {
  const old = (await who('shadowheart')).rules.exhaustionEffects.join(' ');
  await s.put(`/api/campaigns/${LOST}/settings`, { rules: '2024' });
  const now = (await who('shadowheart')).rules.exhaustionEffects.join(' ');
  assert.notEqual(old, now); assert.match(now, /-\d/);
  await s.put(`/api/campaigns/${LOST}/settings`, { rules: '2014' });
});

test('class resources: seeded from the class, spend, refuse overspending, custom resource needs a maximum', async () => {
  const e = await who('edric');
  assert.ok(e.rules.resources.some((x) => /Second Wind/.test(x.name)), JSON.stringify(e.rules.resources));
  let r = await s.post('/api/party/resource', { characterId: 'edric', name: 'Second Wind', delta: 1 }); assert.equal(r.status, 200);
  assert.equal((await who('edric')).rules.resources.find((x) => /Second Wind/.test(x.name)).used, 1);
  r = await s.post('/api/party/resource', { characterId: 'edric', name: 'Second Wind', delta: 1 });
  assert.equal((await who('edric')).rules.resources.find((x) => /Second Wind/.test(x.name)).used, 1, 'cannot spend more than the maximum');
  r = await s.post('/api/party/resource', { characterId: 'edric', name: 'Zap', delta: 1 }); assert.equal(r.json.problems.length, 1); assert.match(r.json.problems[0], /no resource/);
  r = await s.post('/api/party/resource', { characterId: 'edric', name: 'Potion Glow', delta: 0, max: 3, recharge: 'short' });
  assert.equal(r.status, 200);
  assert.ok((await who('edric')).rules.resources.some((x) => x.name === 'Potion Glow' && x.max === 3 && x.recharge === 'short'));
});

test('xp: to one character, to the party split equally, refused when not a number, level-up flag', async () => {
  assert.equal((await s.post('/api/party/xp', { amount: 0 })).status, 400);
  assert.equal((await s.post('/api/party/xp', { amount: 'lots' })).status, 400);
  assert.equal((await s.post('/api/party/xp', { characterId: 'ghost', amount: 10 })).status, 400);
  const before = (await party()).characters.map((c) => c.rules.xp);
  await s.post('/api/party/xp', { amount: 400 });                                   // 4 characters: 100 each
  assert.deepEqual((await party()).characters.map((c) => c.rules.xp), before.map((x) => x + 100));
  await s.post('/api/party/xp', { characterId: 'astarion', amount: 250 });
  const a = await who('astarion'); assert.equal(a.rules.xp, before[0] + 350); assert.equal(a.rules.readyToLevelUp, true, '300 XP is level 2');
  assert.equal((await who('edric')).rules.readyToLevelUp, false);
  await s.post('/api/party/xp', { amount: 10, split: false });                      // 10 each, not shared
  assert.equal((await who('edric')).rules.xp, before[1] + 110);
});

test('xp-split: monsters by challenge rating, counts, party size', async () => {
  let r = await s.post('/api/party/xp-split', { monsters: ['1/4', { cr: '1', count: 2 }] }); assert.deepEqual(r.json, { total: 450, each: 112 }, 'a CR string and a counted entry add up (this lost the 50 before the fix)');
  r = await s.post('/api/party/xp-split', { monsters: ['1/4', { cr: '1', count: 2 }], partySize: 3 }); assert.equal(r.json.each, 150);
  r = await s.post('/api/party/xp-split', { monsters: [] }); assert.equal(r.json.total, 0);
  r = await s.post('/api/party/xp-split', {}); assert.equal(r.status, 200);
});

test('rests: long rest restores hit points, heals half the hit dice back, lowers exhaustion and moves the clock eight hours', async () => {
  await s.post('/api/party/clock', { set: { day: 2, hour: 20, minute: 0 } });
  await setChar('edric', { name: 'Edric', class: 'Fighter', level: 1, hp: 2, maxHp: 12, ac: 18, abilities: { str: 16, dex: 14, con: 15, int: 9, wis: 13, cha: 11 } });
  await s.post('/api/party/exhaustion', { characterId: 'edric', delta: 2 });
  const r = (await s.post('/api/party/rest', { kind: 'long' })).json;
  assert.equal(r.blocked, false); assert.ok(r.rested.includes('edric'));
  assert.equal(r.clock.day, 3); assert.equal(r.clock.hour, 4);
  const e = await who('edric'); assert.equal(e.hp, 12); assert.equal(e.rules.exhaustion, 1); assert.equal(e.rules.hitDice.left, 1);
  assert.equal(e.rules.resources.find((x) => /Second Wind/.test(x.name)).used, 0, 'features come back');
});

test('rests: a second long rest inside 24 hours is refused with no benefit, and works once 24 hours have passed from the start of the first', async () => {
  await setChar('edric', { name: 'Edric', class: 'Fighter', level: 1, hp: 3, maxHp: 12, ac: 18, abilities: { str: 16, dex: 14, con: 15, int: 9, wis: 13, cha: 11 } });
  const clock = (await party()).clock;
  const refused = (await s.post('/api/party/rest', { kind: 'long' })).json;
  assert.equal(refused.blocked, true); assert.deepEqual(refused.rested, []); assert.match(refused.notes[0], /Too soon/);
  assert.equal((await who('edric')).hp, 3, 'no healing when refused');
  assert.equal((await party()).clock.minutes, clock.minutes, 'no time passes when refused');
  const short = (await s.post('/api/party/rest', { kind: 'short' })).json;
  assert.equal(short.blocked, false); assert.equal((await who('edric')).hp, 3, 'a short rest changes no hit points by itself');
  await s.post('/api/party/clock', { minutes: 24 * 60 });
  const ok = (await s.post('/api/party/rest', { kind: 'long' })).json;
  assert.equal(ok.blocked, false); assert.equal((await who('edric')).hp, 12);
});

test('the DM\'s rules updates go through the same code (xp, time, exhaustion via token actions)', async () => {
  // covered end to end by the fake-DM tests; here only that the endpoints agree with the party view after many changes
  const p = await party(); assert.ok(p.characters.every((c) => Number.isFinite(c.rules.xp) && c.rules.exhaustion >= 0 && c.rules.exhaustion <= 6));
});
