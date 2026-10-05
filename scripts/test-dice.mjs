// Rolls every kind of die many times and checks the results: node scripts/test-dice.mjs
import { DICE, rollDie, rollExpr, diceTray } from '../lib/dice.js';

let failed = 0;
const check = (ok, text) => { if (!ok) failed += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };

const N = 60000;
for (const sides of DICE) {
  const counts = new Array(sides + 1).fill(0);
  for (let i = 0; i < N; i++) counts[rollDie(sides)] += 1;
  const faces = counts.slice(1);
  const expected = N / sides;
  const chi = faces.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
  // Critical value for chi-square at p = 0.001: roughly df + 3.1*sqrt(2*df) + 10 is a safe upper bound for these sizes.
  const limit = (sides - 1) + 3.5 * Math.sqrt(2 * (sides - 1)) + 10;
  check(counts[0] === 0 && faces.every((c) => c > 0), `d${sides}: every face 1..${sides} appears, nothing outside the range`);
  check(chi < limit, `d${sides}: spread is even over ${N} rolls (chi-square ${chi.toFixed(1)}, limit ${limit.toFixed(1)}; mean ${(faces.reduce((s, c, i) => s + c * (i + 1), 0) / N).toFixed(2)} vs ${((sides + 1) / 2).toFixed(2)})`);
}

const r1 = rollExpr('2d6+3'); check(r1.rolls.length === 2 && r1.total === r1.rolls[0] + r1.rolls[1] + 3 && r1.expr === '2d6+3', `2d6+3 -> ${r1.rolls} + 3 = ${r1.total}`);
const r2 = rollExpr('d20'); check(r2.rolls.length === 1 && r2.total >= 1 && r2.total <= 20, `d20 -> ${r2.total}`);
const r3 = rollExpr('1d8-1'); check(r3.total === r3.rolls[0] - 1, `1d8-1 -> ${r3.rolls[0]} - 1 = ${r3.total}`);
let advOk = true, disOk = true;
for (let i = 0; i < 2000; i++) {
  const a = rollExpr('d20', 'advantage'), d = rollExpr('d20', 'disadvantage');
  if (a.rolls.length !== 2 || a.total !== Math.max(...a.rolls)) advOk = false;
  if (d.rolls.length !== 2 || d.total !== Math.min(...d.rolls)) disOk = false;
}
check(advOk, 'advantage keeps the higher of two d20s');
check(disOk, 'disadvantage keeps the lower of two d20s');
for (const bad of ['', 'banana', '0d6', '25d6', 'd1', '2d6*3']) {
  let threw = false; try { rollExpr(bad); } catch { threw = true; }
  check(threw, `"${bad}" is refused`);
}
const tray = diceTray();
check(Object.entries(tray).every(([k, list]) => list.length > 0 && list.every((v) => v >= 1 && v <= Number(k.slice(1)))), `dice tray holds ${Object.values(tray).flat().length} in-range dice`);
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('All dice checks passed');
