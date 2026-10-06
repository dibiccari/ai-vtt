import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../lib/rules-track.js';

const fighter = (extra = {}) => ({ id: 'f', name: 'Fay', class: 'Fighter', level: 5, hp: 20, maxHp: 50, abilities: { con: 14, cha: 10 }, sheet: { ClassLevel: 'Fighter 5', XP: '6500' }, ...extra });

test('xp thresholds and levels', () => {
  assert.equal(R.levelForXp(0), 1);
  assert.equal(R.levelForXp(299), 1);
  assert.equal(R.levelForXp(300), 2);
  assert.equal(R.levelForXp(355000), 20);
  assert.equal(R.xpForNextLevel(1), 300);
  assert.equal(R.xpForNextLevel(20), null);
});
test('monster xp split', () => {
  assert.deepEqual(R.splitXp(['1/4', '1/4', '1'], 4), { total: 300, each: 75 });
  assert.equal(R.splitXp([{ cr: '1/8', count: 4 }], 3).total, 100);
  assert.equal(R.xpForCr('30'), 155000);
});
test('ready to level up', () => {
  assert.equal(R.trackView(fighter({ sheet: { ClassLevel: 'Fighter 5', XP: '6500' } })).readyToLevelUp, false);
  const v = R.trackView(fighter({ sheet: { ClassLevel: 'Fighter 5', XP: '14000' } }));
  assert.equal(v.readyToLevelUp, true);
  assert.equal(v.levelForXp, 6);
});
test('multiclass hit dice', () => {
  const hd = R.hitDice({ sheet: { ClassLevel: 'Fighter 3 / Rogue 2' } });
  assert.deepEqual(hd.pools.map((p) => [p.die, p.total]), [[10, 3], [8, 2]]);
  assert.equal(hd.total, 5);
});
test('spending hit dice heals with Con and uses largest die first', () => {
  const out = R.spendHitDice(fighter(), 2, { roll: () => 6 });
  assert.equal(out.healed, 16);            // (6+2) x 2
  assert.equal(out.character.hp, 36);
  assert.equal(R.hitDice(out.character).left, 3);
  const capped = R.spendHitDice(fighter({ hp: 48 }), 1, { roll: () => 10 });
  assert.equal(capped.character.hp, 50);
  assert.equal(capped.healed, 2);
});
test('cannot spend more hit dice than remain', () => {
  const out = R.spendHitDice(fighter({ level: 1, sheet: { ClassLevel: 'Fighter 1' } }), 3, { roll: () => 1 });
  assert.equal(out.rolls.length, 1);
});
test('long rest regains half the hit dice (min 1), exhaustion -1', () => {
  const c = fighter({ track: { hdSpent: { d10: 5 }, exhaustion: 2 } });
  const t = R.restTrack(c, 'long');
  assert.equal(t.hdSpent.d10, 3);
  assert.equal(t.exhaustion, 1);
  const one = fighter({ level: 1, sheet: { ClassLevel: 'Fighter 1' }, track: { hdSpent: { d10: 1 } } });
  assert.equal(R.hitDice({ ...one, track: R.restTrack(one, 'long') }).left, 1);
});
test('exhaustion levels and death', () => {
  assert.deepEqual(R.exhaustionEffects(3), ['Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws']);
  assert.deepEqual(R.exhaustionEffects(6), R.EXHAUSTION_2014.slice(1));
  assert.equal(R.exhaustionEffects(2, '2024')[0], '-4 to every d20 Test');
  const out = R.changeExhaustion(fighter({ track: { exhaustion: 5 } }), 1);
  assert.equal(out.dead, true);
  assert.equal(out.character.hp, 0);
  assert.equal(R.changeExhaustion(fighter(), -3).character.track.exhaustion, 0);
});
test('class resources recharge by rest type', () => {
  const c = fighter();
  const names = R.resourcesOf(c).map((r) => r.name);
  assert.deepEqual(names, ['Second Wind', 'Action Surge']);
  const spent = R.changeResource(R.changeResource(c, 'second wind', 1).character, 'action surge', 1).character;
  assert.equal(R.resourcesOf(spent).every((r) => r.used === 1), true);
  assert.equal(R.changeResource(spent, 'Second Wind', 1).note, 'Fay has no Second Wind left');
  const afterShort = { ...spent, track: R.restTrack(spent, 'short') };
  assert.equal(R.resourcesOf(afterShort).every((r) => r.used === 0), true);
  const barb = { name: 'Bo', class: 'Barbarian', level: 3, abilities: {}, sheet: { ClassLevel: 'Barbarian 3' } };
  const rage = R.changeResource(barb, 'Rage', 3).character;
  assert.equal(R.resourcesOf({ ...rage, track: R.restTrack(rage, 'short') })[0].used, 3);   // rage is a long-rest resource
  assert.equal(R.resourcesOf({ ...rage, track: R.restTrack(rage, 'long') })[0].used, 0);
  assert.equal(R.resourcesOf({ name: 'Pal', class: 'Paladin', level: 2, abilities: {}, sheet: { ClassLevel: 'Paladin 2' } })[0].max, 10);
});
test('custom resource is created with a max', () => {
  const out = R.changeResource(fighter(), 'Stone Giant boon', 1, { max: 3, recharge: 'short' });
  assert.equal(out.ok, true);
  assert.equal(R.resourcesOf(out.character).find((r) => r.name === 'Stone Giant boon').used, 1);
  assert.equal(R.changeResource(fighter(), 'Nothing here', 1).ok, false);
});
test('clock, rest durations and the 24 hour limit', () => {
  let clock = R.normalizeClock({});
  assert.equal(R.describeClock(clock).text, 'Day 1, 08:00 (morning)');
  const a = R.restOnClock(clock, 'long');
  assert.equal(a.ok, true);
  assert.equal(R.describeClock(a.clock).text, 'Day 1, 16:00 (afternoon)');
  const b = R.restOnClock(a.clock, 'long');
  assert.equal(b.ok, false);                             // 8 hours after the start
  const later = R.advanceClock(a.clock, 16 * 60);        // 24 hours after the first began
  assert.equal(R.restOnClock(later, 'long').ok, true);
  const s = R.restOnClock(a.clock, 'short');
  assert.equal(s.clock.minute, a.clock.minute + 60);
  assert.equal(s.clock.lastLongRestStart, 8 * 60);
  assert.equal(R.describeClock(R.setClock(clock, { day: 3, hour: 22, minute: 5 })).text, 'Day 3, 22:05 (night)');
});

test('exhaustion changes the numbers', () => {
  assert.deepEqual(R.exhaustionNumbers(0, 30, 40), { level: 0, speed: 30, maxHp: 40, disadvantage: { checks: false, attacks: false, saves: false }, d20Penalty: 0, labels: [] });
  assert.equal(R.exhaustionNumbers(1, 30, 40).speed, 30);
  assert.equal(R.exhaustionNumbers(1, 30, 40).disadvantage.checks, true);
  assert.equal(R.exhaustionNumbers(2, 30, 40).speed, 15);
  assert.equal(R.exhaustionNumbers(3, 30, 40).disadvantage.attacks, true);
  assert.equal(R.exhaustionNumbers(4, 30, 41).maxHp, 20);
  assert.equal(R.exhaustionNumbers(5, 30, 40).speed, 0);
  assert.equal(R.exhaustionNumbers(2, 30, 40, '2024').speed, 20);
  assert.equal(R.exhaustionNumbers(2, 30, 40, '2024').maxHp, 40);
  assert.equal(R.exhaustionNumbers(2, 30, 40, '2024').d20Penalty, 4);
});
test('computeEffective applies exhaustion without touching stored values', async () => {
  const { computeEffective } = await import('../lib/party.js');
  const c = { ...fighter({ speed: 30, maxHp: 50 }), track: { exhaustion: 4 } };
  const e = computeEffective(c);
  assert.equal(e.speed, 15);
  assert.equal(e.maxHp, 25);
  assert.equal(c.maxHp, 50);
  assert.equal(e.breakdown.speed.at(-1).label, 'Exhaustion 4');
  assert.equal(computeEffective(fighter()).maxHp, 50);
});
test('reaching exhaustion 4 caps current hit points', () => {
  const out = R.changeExhaustion(fighter({ hp: 50, track: { exhaustion: 3 } }), 1);
  assert.equal(out.character.hp, 25);
});
test('food and water: starvation and long rest recovery', () => {
  const c = fighter();                                   // Con 14: 3 + 2 = 5 days
  assert.equal(R.daysWithoutFood(c), 5);
  let out = R.setSupplies(c, 'food', 5);
  assert.equal(out.character.track.exhaustion, 0);
  out = R.setSupplies(out.character, 'food', 7);
  assert.equal(out.character.track.exhaustion, 2);
  out = R.setSupplies(out.character, 'food', 7);
  assert.equal(out.character.track.exhaustion, 2);       // no double counting
  const hungry = { ...c, track: { exhaustion: 2, noFood: 1 } };
  assert.equal(R.restTrack(hungry, 'long').exhaustion, 2);
  const thirsty = { ...c, track: { exhaustion: 2, noWater: 1 } };
  assert.equal(R.restTrack(thirsty, 'long').exhaustion, 2);
  const fed = { ...c, track: { exhaustion: 2 } };
  assert.equal(R.restTrack(fed, 'long').exhaustion, 1);
});
test('hit dice cannot heal past the exhaustion-halved maximum', () => {
  const out = R.spendHitDice(fighter({ hp: 20, track: { exhaustion: 4 } }), 1, { roll: () => 10 });
  assert.equal(out.character.hp, 25);
});
