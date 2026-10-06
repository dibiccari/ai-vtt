// Dice: range, evenness, advantage/disadvantage, the expression parser and the tray (folded in from scripts/test-dice.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICE, rollDie, rollExpr, diceTray } from '../lib/dice.js';

const N = 60000;
for (const sides of DICE) {
  test(`d${sides}: every face appears, nothing outside the range, spread is even over ${N} rolls`, () => {
    const counts = new Array(sides + 1).fill(0);
    for (let i = 0; i < N; i++) counts[rollDie(sides)] += 1;
    const faces = counts.slice(1);
    assert.equal(counts[0], 0);
    assert.ok(faces.every((c) => c > 0));
    const expected = N / sides;
    const chi = faces.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    const limit = (sides - 1) + 3.5 * Math.sqrt(2 * (sides - 1)) + 10;     // generous upper bound (about p = 0.0005) so the test is not flaky
    assert.ok(chi < limit, `chi-square ${chi.toFixed(1)} over limit ${limit.toFixed(1)}`);
  });
}

test('rollExpr reads 2d6+3, d20 and 1d8-1', () => {
  const a = rollExpr('2d6+3');
  assert.equal(a.rolls.length, 2); assert.equal(a.total, a.rolls[0] + a.rolls[1] + 3); assert.equal(a.expr, '2d6+3');
  const b = rollExpr('d20'); assert.ok(b.total >= 1 && b.total <= 20); assert.equal(b.expr, '1d20');
  const c = rollExpr(' 1D8 - 1 '); assert.equal(c.total, c.rolls[0] - 1);
});

test('advantage keeps the higher d20, disadvantage the lower', () => {
  for (let i = 0; i < 2000; i++) {
    const a = rollExpr('d20', 'advantage'), d = rollExpr('d20', 'disadvantage');
    assert.equal(a.rolls.length, 2); assert.equal(a.total, Math.max(...a.rolls)); assert.equal(a.mode, 'advantage');
    assert.equal(d.rolls.length, 2); assert.equal(d.total, Math.min(...d.rolls));
  }
});

test('advantage is ignored for anything but a single d20', () => {
  const r = rollExpr('2d6', 'advantage');
  assert.equal(r.mode, 'normal'); assert.equal(r.rolls.length, 2);
});

test('nonsense expressions are refused', () => {
  for (const bad of ['', 'banana', '0d6', '25d6', 'd1', '2d6*3', 'd20+1000']) assert.throws(() => rollExpr(bad), undefined, `"${bad}"`);
});

test('the dice tray holds in-range dice of every kind', () => {
  const tray = diceTray();
  assert.deepEqual(Object.keys(tray), ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  for (const [k, list] of Object.entries(tray)) {
    assert.ok(list.length > 0);
    assert.ok(list.every((v) => Number.isInteger(v) && v >= 1 && v <= Number(k.slice(1))), k);
  }
  assert.notDeepEqual(diceTray().d20, diceTray().d20.map((x) => x), 'two trays should differ (astronomically unlikely to match)');
});
