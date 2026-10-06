import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/combat-order.js';
const { nextActor, resumeInitiative, placeAfter } = globalThis.CombatOrder;

const mk = (id, initiative, extra = {}) => ({ id, initiative, ...extra });

test('nextActor walks the order and wraps into a new round', () => {
  const o = [mk('a', 20), mk('b', 15), mk('c', 5)];
  assert.deepEqual(nextActor(o, 'a'), { id: 'b', wrapped: false });
  assert.deepEqual(nextActor(o, 'c'), { id: 'a', wrapped: true });
});

test('nextActor skips dead, unseen and delayed combatants', () => {
  const o = [mk('a', 20), mk('b', 15, { dead: true }), mk('c', 10, { unseen: true }), mk('d', 8, { delayed: true }), mk('e', 3)];
  assert.deepEqual(nextActor(o, 'a'), { id: 'e', wrapped: false });
  assert.deepEqual(nextActor(o, 'e'), { id: 'a', wrapped: true });
});

test('nextActor with everyone skipped returns null', () => {
  assert.equal(nextActor([mk('a', 1, { delayed: true })], 'a'), null);
  assert.equal(nextActor([], 'a'), null);
});

test('resumeInitiative lands between the active combatant and the next', () => {
  const o = [mk('a', 20), mk('b', 15), mk('c', 10, { delayed: true })];
  assert.equal(resumeInitiative(o, 'a', 'c'), 17.5);
});

test('resumeInitiative ignores other delayed combatants and the resumer itself', () => {
  const o = [mk('a', 20), mk('b', 18, { delayed: true }), mk('c', 10), mk('d', 5, { delayed: true })];
  assert.equal(resumeInitiative(o, 'a', 'd'), 15);
});

test('resumeInitiative after the last combatant goes just below them', () => {
  const o = [mk('a', 20), mk('b', 4), mk('c', 15, { delayed: true })];
  assert.equal(resumeInitiative(o, "b", "c"), 3.5);
});

test('resumed value sorts right after the active combatant', () => {
  const o = [mk('a', 20), mk('b', 15), mk('c', 10, { delayed: true })];
  const c = o[2];
  c.initiative = resumeInitiative(o, 'a', 'c');
  c.delayed = false;
  const sorted = [...o].sort((x, y) => y.initiative - x.initiative).map((t) => t.id);
  assert.deepEqual(sorted, ['a', 'c', 'b']);
});

test('resumeInitiative needs a number on the active combatant', () => {
  assert.equal(resumeInitiative([mk('a', null), mk('b', 5)], 'a', 'b'), null);
});

test('a tie with the next combatant keeps the active number and placeAfter settles the order', () => {
  const o = [mk('a', 12), mk('b', 12), mk('c', 3, { delayed: true })];
  assert.equal(resumeInitiative(o, 'a', 'c'), 12);
  assert.deepEqual(placeAfter(['a', 'b', 'c'], 'c', 'a'), ['a', 'c', 'b']);
});

test('placeAfter leaves the list alone for unknown ids and moves backwards too', () => {
  assert.deepEqual(placeAfter(['a', 'b'], 'x', 'a'), ['a', 'b']);
  assert.deepEqual(placeAfter(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(placeAfter(['a', 'b'], 'a', 'a'), ['a', 'b']);
});
