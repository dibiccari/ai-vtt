import test from 'node:test';
import assert from 'node:assert/strict';
import { lightOfItem, lightItemsFor, heldLightKind, LIGHT_KINDS } from '../lib/light-gear.js';
import { itemFromSrd } from '../lib/party.js';

test('items that give light are found by SRD index or by name', () => {
  assert.equal(lightOfItem({ name: 'Flame Tongue' }).kind, 'flame-tongue');
  assert.equal(lightOfItem({ name: 'Anything', srd: 'torch' }).kind, 'torch');
  assert.equal(lightOfItem({ name: 'Lantern, hooded' }).kind, 'lantern');
  assert.equal(lightOfItem({ name: 'Rope' }), null);
  assert.deepEqual([LIGHT_KINDS['flame-tongue'].bright, LIGHT_KINDS['flame-tongue'].dim], [40, 80], 'by the book: bright 40 ft, dim another 40');
  assert.deepEqual([LIGHT_KINDS['sun-blade'].bright, LIGHT_KINDS['sun-blade'].dim], [15, 30]);
});

test('the DM is told what a character carries that gives light; only held items shine by themselves', () => {
  const inv = [{ name: 'Torch', equipped: true }, { name: 'Flame Tongue', equipped: true }, { name: 'Mace of Disruption', equipped: false }, { name: 'Rope' }];
  const list = lightItemsFor(inv);
  assert.deepEqual(list.map((l) => [l.item, l.kind, l.mode, l.equipped]), [['Torch', 'torch', 'lit', true], ['Flame Tongue', 'flame-tongue', 'lit', true], ['Mace of Disruption', 'mace-of-disruption', 'held', false]]);
  assert.equal(heldLightKind(inv), '', 'the mace is not wielded');
  assert.equal(heldLightKind([{ name: 'Mace of Disruption', equipped: true }]), 'mace-of-disruption');
});

test('a magic item made from the SRD keeps its index, so its light is found', () => {
  const it = itemFromSrd('magic-items', { index: 'flame-tongue', name: 'Flame Tongue', desc: ['Weapon (any sword), rare (requires attunement)'], rarity: { name: 'Rare' }, equipment_category: { name: 'Weapon' } });
  assert.equal(it.srd, 'flame-tongue'); assert.equal(lightOfItem(it).kind, 'flame-tongue');
});
