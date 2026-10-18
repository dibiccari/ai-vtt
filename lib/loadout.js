// What a character's gear does to the sheet, by the 2014 rules and the SRD equipment table: armor class from the armor and shield worn,
// the attack lines of the weapons carried, the price of things in coins, and the checks that go with them (Strength for heavy armor,
// stealth disadvantage, armor proficiency). Pure functions: lib/party.js and server.js decide when to save.
import { readFileSync } from 'node:fs';
import { modOf, profBonus } from './sheet-edit.js';
import { classesOf } from './rules-track.js';

const EQUIPMENT = JSON.parse(readFileSync(new URL('../data/srd/equipment.json', import.meta.url), 'utf8'));
const CLASSES = JSON.parse(readFileSync(new URL('../data/srd/classes.json', import.meta.url), 'utf8'));
const byIndex = new Map(EQUIPMENT.map((e) => [e.index, e]));
const norm = (s) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\bx\d+\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/(es|s)$/, '');
const byName = new Map(EQUIPMENT.map((e) => [norm(e.name), e]));
for (const e of EQUIPMENT) if (/ armor$/i.test(e.name) && !byName.has(norm(e.name.replace(/ armor$/i, '')))) byName.set(norm(e.name.replace(/ armor$/i, '')), e);       // "Plate" for "Plate Armor"

// The SRD entry an inventory item stands for: its `srd` index, else its name ("Chain mail" matches "Chain Mail"; "Handaxe (2)" matches "Handaxe").
// A magic bonus written in the name ("Chain Mail +1", "+2 shield"): 1 to 3, else 0.
export const magicBonus = (item) => { const m = /(?:^|[\s,(])\+([1-3])(?!\d)/.exec(String(item && item.name || '')); return m ? Number(m[1]) : 0; };
const withoutBonus = (name) => String(name ?? '').replace(/(^|[\s,(])\+[1-3](?!\d)\)?/g, ' ').replace(/\s+/g, ' ').trim();
export const srdFor = (item) => (item && item.srd && byIndex.get(item.srd)) || byName.get(norm(item && item.name)) || byName.get(norm(withoutBonus(item && item.name))) || null;

/* ---------------- coins ---------------- */

export const CP_VALUE = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const ORDER_SMALL_FIRST = ['cp', 'sp', 'ep', 'gp', 'pp'];
export const totalCp = (coins) => Object.entries(CP_VALUE).reduce((n, [k, v]) => n + (Number(coins?.[k]) || 0) * v, 0);
export const costInCp = (cost) => (cost ? Math.round((Number(cost.quantity) || 0) * (CP_VALUE[cost.unit] || 0)) : 0);
export const coinText = (cp) => { const gp = Math.floor(cp / 100), sp = Math.floor((cp % 100) / 10), c = cp % 10; return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ') || '0 gp'; };

// Pay `cost` copper from a purse: the smallest coins go first, and any overpayment comes back as change in the largest coins that fit.
export function payCoins(coins, cost) {
  const have = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...coins };
  if (!(cost >= 0)) return { ok: false, error: 'The price must be zero or more.', coins: have };
  if (totalCp(have) < cost) return { ok: false, error: `Not enough coin: it costs ${coinText(cost)} and you have ${coinText(totalCp(have))}.`, coins: have };
  let left = cost;
  const out = { ...have };
  for (const k of ORDER_SMALL_FIRST) {
    while (left > 0 && out[k] > 0) { out[k] -= 1; left -= CP_VALUE[k]; }
  }
  let change = -left;                                           // overpaid: hand it back
  for (const k of ['pp', 'gp', 'sp', 'cp']) { const n = Math.floor(change / CP_VALUE[k]); out[k] += n; change -= n * CP_VALUE[k]; }
  return { ok: true, coins: out, paid: cost };
}
// Make change the other way: fewer, bigger coins (10 sp become 1 gp). Electrum is left alone.
export function tidyCoins(coins) {
  const out = { cp: 0, sp: 0, ep: Number(coins?.ep) || 0, gp: 0, pp: 0 };
  let cp = totalCp({ ...coins, ep: 0 });
  for (const k of ['pp', 'gp', 'sp', 'cp']) { out[k] = Math.floor(cp / CP_VALUE[k]); cp -= out[k] * CP_VALUE[k]; }
  return out;
}

/* ---------------- armor class ---------------- */

const classIndex = (character) => classesOf(character)[0]?.name.split(/\s+/)[0] || '';
const dexMod = (c) => modOf(c.abilities.dex);
const unarmoredAc = (c) => {
  const cls = classIndex(c);
  if (cls === 'barbarian') return { ac: 10 + dexMod(c) + modOf(c.abilities.con), note: 'Unarmored Defense: 10 + Dexterity + Constitution' };
  if (cls === 'monk') return { ac: 10 + dexMod(c) + modOf(c.abilities.wis), note: 'Unarmored Defense: 10 + Dexterity + Wisdom (no shield)' };
  return { ac: 10 + dexMod(c), note: 'No armor: 10 + Dexterity' };
};
const equipped = (c) => (Array.isArray(c.inventory) ? c.inventory : []).filter((it) => it.equipped !== false);
const proficiencies = (c) => {
  const cls = CLASSES.find((x) => x.index === classIndex(c));
  const idx = new Set((cls?.proficiencies || []).map((p) => p.index));
  const text = String(c.sheet?.ProficienciesLang || '').toLowerCase();
  const armor = (m) => idx.has('all-armor') || idx.has(m + '-armor') || new RegExp(m + ' armor|all armor').test(text);
  return { text, idx, armor, shields: idx.has('shields') || /shield/.test(text), weaponsCategory: (cat) => idx.has(cat + '-weapons') || new RegExp(cat + '( and (simple|martial))? weapons|(simple|martial) and ' + cat).test(text) || (cat === 'simple' && /simple/.test(text)) || (cat === 'martial' && /martial/.test(text)) };
};

// 2014 rules: heavy armor that needs more Strength than the wearer has costs 10 ft of speed. `strength` lets the caller pass the effective Strength (a belt or gauntlets may raise it).
export function wornArmorSpeedPenalty(character, strength) {
  const body = equipped(character).map((it) => ({ it, e: srdFor(it) })).find((x) => x.e && x.e.equipment_category.index === 'armor' && x.e.armor_category !== 'Shield');
  const str = Number.isFinite(strength) ? strength : Number(character.abilities?.str) || 10;
  return body && body.e.str_minimum && str < body.e.str_minimum ? { feet: 10, armor: body.e.name, needs: body.e.str_minimum } : null;
}

// The armor class the worn armor and shield give, with the working shown and any warnings.
export function armorClass(character) {
  const gear = equipped(character).map((it) => ({ it, e: srdFor(it) })).filter((x) => x.e && x.e.equipment_category.index === 'armor');
  const body = gear.find((x) => x.e.armor_category !== 'Shield');
  const shield = gear.find((x) => x.e.armor_category === 'Shield');
  const prof = proficiencies(character);
  const parts = [], warnings = [];
  let ac;
  if (body) {
    const a = body.e.armor_class;
    const dex = a.dex_bonus === false ? 0 : body.e.armor_category === 'Medium' ? Math.min(2, dexMod(character)) : dexMod(character);
    const plus = magicBonus(body.it);
    ac = a.base + dex + plus;
    parts.push(`${body.e.name} ${a.base}${a.dex_bonus === false ? '' : ` + Dexterity ${dex >= 0 ? '+' : ''}${dex}${body.e.armor_category === 'Medium' ? ' (at most +2)' : ''}`}${plus ? ` + ${plus} magic` : ''}`);
    if (body.e.str_minimum && character.abilities.str < body.e.str_minimum) warnings.push(`${body.e.name} needs Strength ${body.e.str_minimum}: speed drops by 10 ft.`);
    if (body.e.stealth_disadvantage) warnings.push(`${body.e.name} gives disadvantage on Stealth checks.`);
    if (!prof.armor(body.e.armor_category.toLowerCase())) warnings.push(`Not proficient with ${body.e.armor_category.toLowerCase()} armor: disadvantage on Strength and Dexterity checks, attacks and saves, and no spellcasting.`);
  } else {
    const u = unarmoredAc(character); ac = u.ac; parts.push(u.note);
  }
  if (shield) {
    if (classIndex(character) === 'monk' && !body) { warnings.push('A monk loses Unarmored Defense while carrying a shield.'); ac = 10 + dexMod(character); }
    const plus = magicBonus(shield.it);
    ac += shield.e.armor_class.base + plus; parts.push(`Shield +${shield.e.armor_class.base}${plus ? ` + ${plus} magic` : ''}`);
    if (!prof.shields) warnings.push('Not proficient with shields: disadvantage on Strength and Dexterity checks, attacks and saves, and no spellcasting.');
  }
  return { ac, parts, warnings, body: body ? body.e.name : '', shield: Boolean(shield) };
}

/* ---------------- weapons ---------------- */

const signed = (n) => (n >= 0 ? '+' : '') + n;
export function weaponLine(character, e, plus = 0) {        // plus: a magic bonus (Longsword +1) adds to the attack and the damage
  const str = modOf(character.abilities.str), dex = dexMod(character);
  const props = new Set((e.properties || []).map((p) => p.index));
  const ranged = e.weapon_range === 'Ranged';
  const mod = ranged ? dex : props.has('finesse') ? Math.max(str, dex) : str;
  const pb = profBonus(character.level);
  const prof = proficiencies(character);
  const named = norm(e.name);
  const proficient = prof.weaponsCategory(e.weapon_category.toLowerCase()) || [...prof.idx].some((i) => norm(i.replace(/-/g, ' ')) === named) || new RegExp('\\b' + named + 's?\\b').test(prof.text);
  const dmg = e.damage ? `${e.damage.damage_dice}${mod + plus ? signed(mod + plus) : ''} ${e.damage.damage_type.name.toLowerCase()}` : '';
  const notes = [props.has('versatile') && e.two_handed_damage ? `two-handed ${e.two_handed_damage.damage_dice}` : '', props.has('thrown') ? `thrown ${e.range.normal}/${e.range.long} ft` : '', ranged && !props.has('thrown') ? `range ${e.range.normal}/${e.range.long} ft` : '', props.has('heavy') ? 'heavy' : '', props.has('two-handed') ? 'two-handed' : '', props.has('reach') ? 'reach' : '', props.has('loading') ? 'loading' : '', props.has('light') ? 'light' : ''].filter(Boolean);
  return { name: e.name, bonus: signed(mod + plus + (proficient ? pb : 0)), damage: dmg, proficient, notes };
}
export const carriedWeapons = (character) => equipped(character).map((it) => ({ it, e: srdFor(it) })).filter((x) => x.e && x.e.equipment_category.index === 'weapon');

const WPN_SLOTS = [['Wpn Name', 'Wpn1 AtkBonus', 'Wpn1 Damage'], ['Wpn Name 2', 'Wpn2 AtkBonus ', 'Wpn2 Damage '], ['Wpn Name 3', 'Wpn3 AtkBonus  ', 'Wpn3 Damage ']];

// The sheet edits that bring the armor class and attack lines in step with the gear changing from `before` to `after` (two characters). Attack lines already on the sheet are kept
// (they may carry a fighting style or magic bonus worked out by hand); lines for weapons that are no longer carried are cleared and new weapons take the free lines.
export function sheetEditsForGear(before, after) {
  const edits = [], notes = [], warnings = [];
  const a0 = armorClass(before), a1 = armorClass(after);
  warnings.push(...a1.warnings);
  const nowAc = Number(String(after.sheet?.AC ?? after.ac)) || after.ac;
  if (a1.ac !== a0.ac) { edits.push({ field: 'ac', value: String(nowAc + a1.ac - a0.ac) }); notes.push(`Armor Class ${nowAc} → ${nowAc + a1.ac - a0.ac} (${a1.parts.join(', ')})`); }
  const wantItems = carriedWeapons(after), want = wantItems.map((x) => x.e), plusOf = new Map(wantItems.map((x) => [x.e.index, magicBonus(x.it)]));
  const sheet = after.sheet || {};
  const kept = [];
  for (const [n, b, d] of WPN_SLOTS) {
    const cur = String(sheet[n] || '').trim();
    if (!cur) { kept.push(null); continue; }
    const still = want.some((e) => norm(e.name) === norm(cur));
    if (still) kept.push(cur); else { kept.push(null); edits.push({ field: n, value: '' }, { field: b, value: '' }, { field: d, value: '' }); notes.push(`${cur} is no longer on the attack lines`); }
  }
  const have = new Set(kept.filter(Boolean).map(norm));
  for (const e of want) {
    if (have.has(norm(e.name))) continue;
    const slot = WPN_SLOTS.find((_s, i) => !kept[i]);
    if (!slot) { warnings.push(`There is no free attack line for the ${e.name}.`); continue; }
    const line = weaponLine(after, e, plusOf.get(e.index) || 0);
    kept[WPN_SLOTS.indexOf(slot)] = e.name; have.add(norm(e.name));
    edits.push({ field: slot[0], value: line.name }, { field: slot[1], value: line.bonus }, { field: slot[2], value: line.damage });
    notes.push(`${line.name}: ${line.bonus} to hit, ${line.damage}${line.proficient ? '' : ' (not proficient)'}`);
    if (!line.proficient) warnings.push(`Not proficient with the ${e.name}: no proficiency bonus on its attacks.`);
  }
  return { edits, notes, warnings, armor: a1 };
}

/* ---------------- the shop ---------------- */

export function shopCatalog(magicItems = []) {
  const items = EQUIPMENT.map((e) => ({
    kind: 'equipment', index: e.index, name: e.name, group: e.equipment_category.name === 'Adventuring Gear' ? (e.gear_category?.name || 'Adventuring Gear') : e.equipment_category.name,
    cp: costInCp(e.cost), weight: e.weight ?? 0, cost: e.cost ? `${e.cost.quantity} ${e.cost.unit}` : '',
    detail: e.weapon_category ? `${e.category_range}, ${e.damage ? e.damage.damage_dice + ' ' + e.damage.damage_type.name.toLowerCase() : ''}` : e.armor_category ? `${e.armor_category}${e.armor_class ? ', AC ' + e.armor_class.base : ''}${e.str_minimum ? ', Str ' + e.str_minimum : ''}` : ''
  }));
  for (const m of magicItems) items.push({ kind: 'magic-items', index: m.index, name: m.name, group: 'Magic items', cp: 0, weight: 0, cost: '', detail: [m.rarity?.name, m.equipment_category?.name].filter(Boolean).join(', ') });
  return items;
}
