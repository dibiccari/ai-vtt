// Stat cards: the numbers the Dungeon Master needs, written out from the SRD so it reads them instead of recalling them (attack bonus, damage, save DC, range, duration).
// Two blocks go into the prompt: the spells the party has (stable between turns, so it is cached) and the creatures that are on the board right now (and the spells they cast).
// Pure functions: the SRD lists are passed in, so these can be tested without the server.
import { readFileSync } from 'node:fs';

const FIELDS = JSON.parse(readFileSync(new URL('./sheet-fields.json', import.meta.url), 'utf8'));
const SPELL_FIELDS = new Set(Object.values(FIELDS.spellLines).flat());
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const ord = (n) => (n === 0 ? 'cantrip' : n === 1 ? '1st-level' : n === 2 ? '2nd-level' : n === 3 ? '3rd-level' : `${n}th-level`);
const mod = (score) => { const m = Math.floor((Number(score) - 10) / 2); return (m >= 0 ? '+' : '') + m; };
const key = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The spell names written on a character's sheet (all the spell lines), as plain names.
export function spellNamesOf(character) {
  const out = [];
  const sheet = character && character.sheet && typeof character.sheet === 'object' ? character.sheet : {};
  for (const [field, value] of Object.entries(sheet)) {
    if (!SPELL_FIELDS.has(field)) continue;
    const name = String(value ?? '').replace(/\s*\((?:R|C|R, C|C, R)\)\s*$/i, '').trim();
    if (name) out.push(name);
  }
  return out;
}

// The spell name on a sheet line as the key the cards use (the same cleaning as spellNamesOf).
export const spellKeyOf = (value) => key(String(value ?? '').replace(/\s*\((?:R|C|R, C|C, R)\)\s*$/i, ''));

// The keys of the party's spells that get a card: every spell on the sheets that is in the SRD list, in a stable order, at most MAX_PARTY_SPELLS.
// The sheets sent to the DM drop the lines of exactly these spells (the cards say it all) and keep any other line, so no spell ends up in neither place.
export function partySpellKeys(characters, spells) {
  const byName = new Set((spells || []).map((s) => key(s.name)));
  return [...new Set((Array.isArray(characters) ? characters : []).flatMap(spellNamesOf).map(key))].filter((k) => byName.has(k)).sort().slice(0, MAX_PARTY_SPELLS);
}

export function spellCard(s) {
  const level = ord(Number(s.level) || 0);
  const parts = [`${s.name} (${level} ${s.school?.name ? s.school.name.toLowerCase() : 'spell'}${s.ritual ? ', ritual' : ''}${s.concentration ? ', concentration' : ''})`,
    `casting time ${s.casting_time}`, `range ${s.range}`, `components ${(s.components || []).join(', ')}`, `duration ${s.duration}`];
  if (s.dc?.dc_type?.name) parts.push(`save ${s.dc.dc_type.name}${s.dc.dc_success ? `, ${s.dc.dc_success} on a success` : ''}`);
  if (s.area_of_effect) parts.push(`area ${s.area_of_effect.type} ${s.area_of_effect.size} ft`);
  const dmg = (s.damage || []).map((d) => {
    const dice = d.damage_at_slot_level ? Object.entries(d.damage_at_slot_level).slice(0, 2).map(([l, v]) => `${v} at level ${l}`).join(', ') + ', more with higher slots' : d.damage_at_character_level ? Object.entries(d.damage_at_character_level).map(([l, v]) => `${v} from level ${l}`).join(', ') : '';
    return dice ? `damage ${dice}${d.damage_type?.name ? ' ' + d.damage_type.name.toLowerCase() : ''}` : '';
  }).filter(Boolean);
  if (dmg.length) parts.push(dmg.join('; '));
  return `- ${parts.join(' | ')}. ${clip((s.desc || []).join(' '), 520)}${s.higher_level?.length ? ' Higher levels: ' + clip(s.higher_level.join(' '), 200) : ''}`;
}

export function creatureCard(m) {
  const ac = (m.armor_class || []).map((a) => `${a.value}${a.type && a.type !== 'dex' ? ` (${a.type})` : ''}`).join(', ');
  const speed = Object.entries(m.speed || {}).map(([k, v]) => (k === 'walk' ? String(v) : `${k} ${v}`)).join(', ');
  const scores = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map((k, i) => `${['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'][i]} ${m[k]} (${mod(m[k])})`).join(' ');
  const profs = (m.proficiencies || []).map((p) => `${String(p.proficiency?.name || '').replace(/^(Saving Throw|Skill): /, (x) => (x.startsWith('Saving') ? 'save ' : ''))} ${p.value >= 0 ? '+' : ''}${p.value}`).join(', ');
  const lines = [`${m.name} (${m.size} ${m.type}${m.subtype ? ' ' + m.subtype : ''}, CR ${m.challenge_rating}): AC ${ac}, ${m.hit_points} HP (${m.hit_dice}), speed ${speed.replace(/\.$/, '')}. ${scores}.`];
  if (profs) lines.push(`  Proficient: ${profs}.`);
  const defences = [['vulnerable', m.damage_vulnerabilities], ['resists', m.damage_resistances], ['immune', m.damage_immunities], ['condition immune', (m.condition_immunities || []).map((c) => c.name || c)]]
    .filter(([, v]) => v && v.length).map(([k, v]) => `${k} ${v.join(', ')}`);
  if (defences.length) lines.push(`  ${defences.join('; ')}.`);
  const senses = Object.entries(m.senses || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
  if (senses) lines.push(`  Senses: ${senses}.`);
  for (const a of m.special_abilities || []) lines.push(`  ${a.name}: ${clip(a.desc, 420)}`);
  for (const a of m.actions || []) {
    const dc = a.dc ? ` [DC ${a.dc.dc_value} ${a.dc.dc_type?.name || ''}${a.dc.success_type && a.dc.success_type !== 'none' ? ', ' + a.dc.success_type + ' on a save' : ''}]` : '';
    const use = a.usage ? ` [${a.usage.type}${a.usage.dice ? ' ' + a.usage.dice + ' ' + a.usage.min_value + '+' : ''}${a.usage.times ? ' ' + a.usage.times + '/day' : ''}]` : '';
    lines.push(`  Action ${a.name}${use}${dc}: ${clip(a.desc, 460)}`);
  }
  for (const a of m.reactions || []) lines.push(`  Reaction ${a.name}: ${clip(a.desc, 300)}`);
  for (const a of m.legendary_actions || []) lines.push(`  Legendary ${a.name}: ${clip(a.desc, 260)}`);
  return lines.join('\n');
}

// The spells a creature casts (its Spellcasting or Innate Spellcasting ability lists them by name).
export function spellsOfCreature(m) {
  const out = [];
  for (const a of m.special_abilities || []) for (const sp of a.spellcasting?.spells || []) out.push(sp.name);
  return out;
}

const MAX_CREATURES = 12, MAX_PARTY_SPELLS = 150, MAX_CREATURE_SPELLS = 24;

// `monsters` and `spells` are the SRD lists. Returns { spellsText, creaturesText, ... } (empty strings when there is nothing to say).
export function statCards({ tokens, characters, monsters, spells }) {
  const byIndex = new Map((monsters || []).map((m) => [m.index, m]));
  const byName = new Map((spells || []).map((s) => [key(s.name), s]));
  // The party's spells, in a stable order, so the block only changes when somebody learns a spell.
  const partyNames = partySpellKeys(characters, spells);
  const partySpells = partyNames.map((k) => byName.get(k));
  // The creatures on the board (one card per kind), and what they cast.
  const seen = [];
  for (const t of Array.isArray(tokens) ? tokens : []) {
    if (!t || t.isPC || t.dead || typeof t.monster !== 'string' || !t.monster || !byIndex.has(t.monster) || seen.includes(t.monster)) continue;
    seen.push(t.monster);
  }
  const creatures = seen.slice(0, MAX_CREATURES).map((i) => byIndex.get(i));
  const have = new Set(partyNames);
  const creatureSpellNames = [...new Set(creatures.flatMap(spellsOfCreature).map(key))].filter((k) => !have.has(k) && byName.has(k)).slice(0, MAX_CREATURE_SPELLS);
  const creatureSpells = creatureSpellNames.map((k) => byName.get(k));
  const spellsText = partySpells.length ? `SPELL CARDS for the party's spells (SRD, 2014): when one of these is cast, use these numbers and rules exactly (range, save, damage, duration, concentration) instead of recalling them.\n${partySpells.map(spellCard).join('\n')}` : '';
  const creaturesText = creatures.length ? `STAT CARDS for the creatures on the board (SRD, 2014): use these exact attack bonuses, damage, save DCs and abilities instead of recalling them. A creature's hit points and AC on its token are the live ones.\n${creatures.map(creatureCard).join('\n')}${creatureSpells.length ? '\nSpells these creatures cast:\n' + creatureSpells.map(spellCard).join('\n') : ''}` : '';
  return { spellsText, creaturesText, creatureCount: creatures.length, spellCount: partySpells.length + creatureSpells.length };
}
