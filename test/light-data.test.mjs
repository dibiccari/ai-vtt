// public/light-data.json (light from gear) checked against the SRD it names and against the code that reads it (lib/light-gear.js, and the tabletop's own copy of the slug rule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lightOfItem, lightItemsFor, heldLightKind, LIGHT_KINDS, slugOf } from '../lib/light-gear.js';

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const DATA = read('../public/light-data.json');
const EQUIPMENT = new Map(read('../data/srd/equipment.json').map((e) => [e.index, e]));
const MAGIC = new Map(read('../data/srd/magic-items.json').map((e) => [e.index, e]));

test('every item index in light-data.json is a real SRD equipment or magic item, and names the kind it gives', () => {
  for (const [index, entry] of Object.entries(DATA.items)) {
    assert.ok(EQUIPMENT.has(index) || MAGIC.has(index), `${index} is in the SRD`);
    assert.ok(DATA.kinds[entry.kind], `${index} gives the kind ${entry.kind}, which is defined`);
    assert.ok(['lit', 'held'].includes(entry.mode), `${index} has a known mode`);
    assert.ok(String(entry.how || '').length > 5, `${index} tells the DM how it is turned on`);
  }
});

test('every kind has numeric non-negative sizes with dim reaching at least as far as bright, and a name', () => {
  for (const [k, v] of Object.entries(DATA.kinds)) {
    assert.ok(Number.isFinite(v.bright) && Number.isFinite(v.dim) && v.bright >= 0 && v.dim >= v.bright, `${k}: ${v.bright}/${v.dim}`);
    assert.ok(v.dim > 0, `${k} lights something`);
    assert.ok(v.name, `${k} has a name`);
    assert.equal(typeof (v.needsItem ?? false), 'boolean');
  }
  assert.deepEqual(Object.keys(LIGHT_KINDS).sort(), Object.keys(DATA.kinds).sort());
});

test('a kind that needs an item is given by an item, and plain kinds (torch, lantern, candle, light) need none', () => {
  const given = new Set(Object.values(DATA.items).map((i) => i.kind));
  for (const [k, v] of Object.entries(DATA.kinds)) if (v.needsItem) assert.ok(given.has(k), `${k} needs an item and some item gives it`);
  for (const k of ['torch', 'lantern', 'candle', 'light']) assert.ok(!DATA.kinds[k].needsItem, `${k} needs no special item`);
  assert.equal(DATA.kinds.light.name, 'Light spell');
});

test('by the book: the figures of the kinds the SRD describes', () => {
  const size = (k) => [DATA.kinds[k].bright, DATA.kinds[k].dim];
  assert.deepEqual(size('torch'), [20, 40]); assert.deepEqual(size('candle'), [5, 10]); assert.deepEqual(size('lantern'), [30, 60]);
  assert.deepEqual(size('lamp'), [15, 45]); assert.deepEqual(size('lantern-bullseye'), [60, 120]); assert.deepEqual(size('candle-of-invocation'), [0, 30]);
  assert.deepEqual(size('sun-blade'), [15, 30]); assert.deepEqual(size('flame-tongue'), [40, 80]);
});

test('every item is found by its SRD index and by the slug of its SRD name (the tabletop and the server agree)', () => {
  for (const [index, entry] of Object.entries(DATA.items)) {
    const srd = EQUIPMENT.get(index) || MAGIC.get(index);
    assert.equal(lightOfItem({ name: 'Whatever', srd: index }).kind, entry.kind, `${index} by index`);
    assert.equal(slugOf(srd.name), index, `the slug of "${srd.name}" is its index, so an item named like the SRD finds its light`);
    assert.equal(lightOfItem({ name: srd.name }).kind, entry.kind, `${srd.name} by name`);
  }
});

test('names that merely look like light items, odd input and prototype names give no light', () => {
  for (const name of ['Torch Bearer Statue', 'Rope', 'constructor', 'toString', '__proto__', 'hasOwnProperty', '', '   ']) assert.equal(lightOfItem({ name }), null, `"${name}"`);
  assert.equal(lightOfItem(null), null); assert.equal(lightOfItem({}), null); assert.equal(lightOfItem({ srd: 'constructor' }), null);
  assert.deepEqual(lightItemsFor(null), []); assert.deepEqual(lightItemsFor('torch'), []);
  assert.equal(heldLightKind(undefined), '');
});

test('the DM is told equipped state, and an item with no equipped flag counts as carried and wielded', () => {
  const list = lightItemsFor([{ name: 'Mace of Disruption' }, { name: 'Torch', equipped: false }, { name: 'Lamp', equipped: true }]);
  assert.deepEqual(list.map((l) => [l.kind, l.equipped]), [['mace-of-disruption', true], ['torch', false], ['lamp', true]]);
  assert.equal(heldLightKind([{ name: 'Mace of Disruption' }]), 'mace-of-disruption');
  assert.equal(heldLightKind([{ name: 'Torch' }, { name: 'Mace of Disruption', equipped: false }]), '', 'a torch is lit by somebody, it is not held light');
});

test('the tabletop reads the same file: its lit/held and needsItem rules match this data', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /fetch\('\/light-data\.json'\)/);
  assert.match(html, /const slugOfName = \(n\) => String\(n \?\? ''\)\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)\.replace\(\/\^-\+\|-\+\$\/g, ''\)/, 'same slug rule as lib/light-gear.js');
});
