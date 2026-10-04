// Applying edits made by the AI Dungeon Master to a character sheet (the official 5E sheet's fields).
// Pure functions plus one small store-driven helper, so they can be tested without the server.
// The player-facing page that mirrors some of this logic is public/characters.html.
import { readFileSync } from 'node:fs';

const FIELDS = JSON.parse(readFileSync(new URL('./sheet-fields.json', import.meta.url), 'utf8'));
const TEXT = new Set(FIELDS.textFields);
const CHECK = new Set(FIELDS.checkFields);

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SCORE_FIELD = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
// Some official field names carry a trailing space.
const MOD_FIELD = { str: 'STRmod', dex: 'DEXmod ', con: 'CONmod', int: 'INTmod', wis: 'WISmod', cha: 'CHamod' };

// Skill -> governing ability, the modifier text field, and the proficiency checkbox (matched to the sheet by position).
export const SKILLS = {
  'Acrobatics': { ability: 'dex', field: 'Acrobatics', box: 'Check Box 23' },
  'Animal Handling': { ability: 'wis', field: 'Animal', box: 'Check Box 24' },
  'Arcana': { ability: 'int', field: 'Arcana', box: 'Check Box 25' },
  'Athletics': { ability: 'str', field: 'Athletics', box: 'Check Box 26' },
  'Deception': { ability: 'cha', field: 'Deception ', box: 'Check Box 27' },
  'History': { ability: 'int', field: 'History ', box: 'Check Box 28' },
  'Insight': { ability: 'wis', field: 'Insight', box: 'Check Box 29' },
  'Intimidation': { ability: 'cha', field: 'Intimidation', box: 'Check Box 30' },
  'Investigation': { ability: 'int', field: 'Investigation ', box: 'Check Box 31' },
  'Medicine': { ability: 'wis', field: 'Medicine', box: 'Check Box 32' },
  'Nature': { ability: 'int', field: 'Nature', box: 'Check Box 33' },
  'Perception': { ability: 'wis', field: 'Perception ', box: 'Check Box 34' },
  'Performance': { ability: 'cha', field: 'Performance', box: 'Check Box 35' },
  'Persuasion': { ability: 'cha', field: 'Persuasion', box: 'Check Box 36' },
  'Religion': { ability: 'int', field: 'Religion', box: 'Check Box 37' },
  'Sleight of Hand': { ability: 'dex', field: 'SleightofHand', box: 'Check Box 38' },
  'Stealth': { ability: 'dex', field: 'Stealth ', box: 'Check Box 39' },
  'Survival': { ability: 'wis', field: 'Survival', box: 'Check Box 40' }
};
export const SAVES = {
  str: { field: 'ST Strength', box: 'Check Box 11' }, dex: { field: 'ST Dexterity', box: 'Check Box 18' },
  con: { field: 'ST Constitution', box: 'Check Box 19' }, int: { field: 'ST Intelligence', box: 'Check Box 20' },
  wis: { field: 'ST Wisdom', box: 'Check Box 21' }, cha: { field: 'ST Charisma', box: 'Check Box 22' }
};
// Identity fields the AI may not change.
const LOCKED = new Set(['CharacterName', 'CharacterName 2', 'PlayerName']);
export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

// A mistake in the table above should stop the server at startup, not corrupt a sheet later.
for (const s of Object.values(SKILLS)) if (!TEXT.has(s.field) || !CHECK.has(s.box)) throw new Error(`sheet map: unknown field for skill ${JSON.stringify(s)}`);
for (const s of Object.values(SAVES)) if (!TEXT.has(s.field) || !CHECK.has(s.box)) throw new Error(`sheet map: unknown field for save ${JSON.stringify(s)}`);
for (const k of ABILITIES) if (!TEXT.has(SCORE_FIELD[k]) || !TEXT.has(MOD_FIELD[k])) throw new Error(`sheet map: unknown field for ${k}`);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const firstInt = (v, def, min, max) => {
  const m = String(v == null ? '' : v).match(/-?\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) ? clamp(n, min, max) : def;
};
const signed = (n) => (n >= 0 ? '+' : '') + n;
export const modOf = (score) => Math.floor((clamp(Number(score) || 10, 1, 30) - 10) / 2);
export const profBonus = (level) => 2 + Math.floor((clamp(level, 1, 20) - 1) / 4);
export const levelForXp = (xp) => { let lvl = 1; XP_THRESHOLDS.forEach((t, i) => { if (xp >= t) lvl = i + 1; }); return lvl; };
export function levelFromClassLevel(text) {
  const nums = [...String(text ?? '').matchAll(/\d+/g)].map((m) => Number(m[0]));
  return nums.length ? clamp(nums.reduce((a, b) => a + b, 0), 1, 20) : null;
}
const classFromClassLevel = (text) => String(text ?? '').replace(/\d+/g, '').replace(/[\s/,+]+$/, '').replace(/^[\s/,+]+/, '').replace(/\s{2,}/g, ' ').trim();
const pretty = (field) => field.trim().replace(/([a-z])([A-Z])/g, '$1 $2');
const asText = (v) => (typeof v === 'boolean' ? String(v) : v == null ? '' : String(v));

// The full set of sheet values for a character: what is stored, with the tabletop's own numbers winning for the fields it tracks.
export function sheetForCharacter(c) {
  const sheet = { ...(c.sheet || {}) };
  const cls = c.class && c.class !== 'Adventurer' ? c.class : '';
  const stored = sheet.ClassLevel;
  // Keep a hand-written "Fighter 2 / Rogue 1" when it still agrees with the stored class and level.
  const keep = stored && levelFromClassLevel(stored) === c.level && classFromClassLevel(stored) === cls;
  sheet.CharacterName = c.name;
  sheet['CharacterName 2'] = c.name;
  sheet.ClassLevel = keep ? stored : `${cls} ${c.level}`.trim();
  sheet.HPMax = String(c.maxHp);
  sheet.HPCurrent = String(c.hp);
  sheet.AC = String(c.ac);
  sheet.Speed = String(c.speed);
  for (const k of ABILITIES) {
    sheet[SCORE_FIELD[k]] = String(c.abilities[k]);
    sheet[MOD_FIELD[k]] = signed(modOf(c.abilities[k]));
  }
  if (!sheet.ProfBonus) sheet.ProfBonus = '+' + profBonus(c.level);
  return sheet;
}

// Back from the sheet to the numbers the tabletop uses.
function deriveBase(character, sheet) {
  const c = JSON.parse(JSON.stringify(character));
  const level = levelFromClassLevel(sheet.ClassLevel);
  if (level) c.level = level;
  const cls = classFromClassLevel(sheet.ClassLevel);
  if (cls) c.class = cls.slice(0, 40);
  c.maxHp = firstInt(sheet.HPMax, c.maxHp, 1, 999);
  c.hp = firstInt(sheet.HPCurrent, c.hp, 0, c.maxHp);
  sheet.HPCurrent = String(c.hp);
  c.ac = firstInt(sheet.AC, c.ac, 1, 40);
  c.speed = firstInt(sheet.Speed, c.speed, 0, 120);
  for (const k of ABILITIES) c.abilities[k] = firstInt(sheet[SCORE_FIELD[k]], c.abilities[k], 1, 30);
  c.sheet = sheet;
  return c;
}

const skillKey = (name) => Object.keys(SKILLS).find((k) => k.toLowerCase() === String(name ?? '').trim().toLowerCase()) || null;
const abilityKey = (name) => {
  const s = String(name ?? '').trim().toLowerCase();
  return ABILITIES.find((k) => k === s || SCORE_FIELD[k].toLowerCase() === s || ({ str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' })[k] === s) || null;
};

// Apply one updateCharacter to a character. Returns { character, notes, rejected, readyLevel, changes }.
export function applyUpdate(character, u) {
  const sheet = sheetForCharacter(character);
  const before = { ...sheet };
  const expertise = new Set((character.expertise || []).filter((s) => SKILLS[s]));
  const notes = [];
  const rejected = [];
  const touched = { skills: new Set(), saves: new Set(), abilities: new Set(), level: false };
  let xpNote = null;
  let xpAfter = null;

  const setClassLevel = (text) => {
    const cl = String(text ?? '').trim().slice(0, 60);
    if (!levelFromClassLevel(cl)) { rejected.push('Class and level needs a level number, for example "Fighter 4".'); return; }
    sheet.ClassLevel = cl;
    touched.level = true;
  };
  const setScore = (k, value) => {
    if (!Number.isFinite(Number(value))) { rejected.push(`${SCORE_FIELD[k]} needs a number.`); return; }
    sheet[SCORE_FIELD[k]] = String(clamp(Math.round(Number(value)), 1, 30));
    touched.abilities.add(k);
  };

  // Plain names the AI is told about: classLevel, xpGain, maxHp, hp, tempHp, ac, speed, str ... cha. They normally arrive
  // inside `edits`; the same names are also accepted as top-level fields. Each one is applied exactly once.
  const NUMERIC = ['xpgain', 'maxhp', 'hp', 'temphp', 'ac', 'speed'];
  const plainNames = new Set(['classlevel', ...NUMERIC, ...ABILITIES]);
  const plainInputs = [];
  for (const key of ['classLevel', 'xpGain', 'maxHp', 'hp', 'tempHp', 'ac', 'speed']) if (u[key] !== undefined) plainInputs.push([key.toLowerCase(), u[key]]);
  if (u.abilities && typeof u.abilities === 'object') for (const k of ABILITIES) if (u.abilities[k] != null) plainInputs.push([k, u.abilities[k]]);
  const otherEdits = [];
  for (const item of Array.isArray(u.edits) ? u.edits : []) {
    const field = String(item && item.field !== undefined ? item.field : '');
    if (plainNames.has(field.toLowerCase())) plainInputs.push([field.toLowerCase(), item.value]); else otherEdits.push(item);
  }
  const numeric = {};
  for (const [name, value] of plainInputs) {
    if (name === 'classlevel') { setClassLevel(value); continue; }
    if (!Number.isFinite(Number(value))) { rejected.push(`${name} needs a number.`); continue; }
    if (ABILITIES.includes(name)) setScore(name, value); else numeric[name] = Number(value);
  }
  if (Number.isFinite(numeric.xpgain) && numeric.xpgain !== 0) {
    const was = firstInt(sheet.XP, 0, 0, 1e9);
    const gain = Math.round(numeric.xpgain);
    xpAfter = clamp(was + gain, 0, 1e9);
    sheet.XP = String(xpAfter);
    xpNote = `XP ${was} → ${xpAfter} (${gain > 0 ? '+' : ''}${gain})`;
  }
  if (Number.isFinite(numeric.maxhp)) sheet.HPMax = String(clamp(Math.round(numeric.maxhp), 1, 999));
  if (Number.isFinite(numeric.hp)) sheet.HPCurrent = String(clamp(Math.round(numeric.hp), 0, firstInt(sheet.HPMax, 999, 1, 999)));
  if (Number.isFinite(numeric.temphp)) sheet.HPTemp = String(clamp(Math.round(numeric.temphp), 0, 999));
  if (Number.isFinite(numeric.ac)) sheet.AC = String(clamp(Math.round(numeric.ac), 1, 40));
  if (Number.isFinite(numeric.speed)) sheet.Speed = String(clamp(Math.round(numeric.speed), 0, 120));

  for (const item of Array.isArray(u.skills) ? u.skills : []) {
    const name = skillKey(item && item.name);
    const prof = String(item && item.proficiency || '').toLowerCase();
    if (!name || !['none', 'proficient', 'expertise'].includes(prof)) { rejected.push(`Skill "${item && item.name}" or its level was not understood.`); continue; }
    sheet[SKILLS[name].box] = prof !== 'none';
    if (prof === 'expertise') expertise.add(name); else expertise.delete(name);
    touched.skills.add(name);
  }
  for (const item of Array.isArray(u.saves) ? u.saves : []) {
    const k = abilityKey(item && item.ability);
    if (!k || typeof item.proficient !== 'boolean') { rejected.push(`Saving throw "${item && item.ability}" was not understood.`); continue; }
    sheet[SAVES[k].box] = item.proficient;
    touched.saves.add(k);
  }

  for (const item of otherEdits) {
    const field = String(item && item.field !== undefined ? item.field : '');
    if (LOCKED.has(field)) { rejected.push(`${pretty(field)} cannot be changed by the DM.`); continue; }
    if (field === 'ClassLevel') { setClassLevel(item.value); continue; }
    const scoreOf = ABILITIES.find((k) => SCORE_FIELD[k] === field);
    if (scoreOf) { setScore(scoreOf, item.value); continue; }
    if (CHECK.has(field)) {
      const v = String(item.value).toLowerCase();
      if (v !== 'true' && v !== 'false') { rejected.push(`${pretty(field)} is a checkbox: use true or false.`); continue; }
      sheet[field] = v === 'true';
    } else if (TEXT.has(field)) {
      sheet[field] = String(item.value ?? '').slice(0, 3000);
    } else {
      rejected.push(`There is no sheet field called "${field}".`);
    }
  }

  const spellNotes = [];
  for (const item of Array.isArray(u.spells) ? u.spells : []) {
    const level = Number(item && item.level);
    const lines = FIELDS.spellLines[level];
    const name = String(item && item.name || '').trim().slice(0, 80);
    if (!lines || !name) { rejected.push('A spell needs a level from 0 to 9 and a name.'); continue; }
    const same = lines.find((l) => String(sheet[l] || '').trim().toLowerCase() === name.toLowerCase());
    if (item.remove) {
      if (same) { sheet[same] = ''; spellNotes.push(`${name} removed (level ${level})`); }
      continue;
    }
    if (same) continue;
    const free = lines.find((l) => !String(sheet[l] || '').trim());
    if (!free) { rejected.push(`There is no free line for another level ${level} spell (${name}).`); continue; }
    sheet[free] = name;
    spellNotes.push(`${name} added (${level === 0 ? 'cantrip' : 'level ' + level})`);
  }
  const slotNotes = [];
  for (const item of Array.isArray(u.slots) ? u.slots : []) {
    const level = Number(item && item.level);
    const slot = FIELDS.slots[level];
    if (!slot || !Number.isFinite(item.total)) { rejected.push('Spell slots need a level from 1 to 9 and a total.'); continue; }
    const oldTotal = firstInt(sheet[slot.total], null, 0, 99);
    const oldLeft = firstInt(sheet[slot.remaining], null, 0, 99);
    const total = clamp(Math.round(item.total), 0, 99);
    const left = oldTotal === null || oldLeft === null ? total : clamp(oldLeft + (total - oldTotal), 0, total);
    sheet[slot.total] = String(total);
    sheet[slot.remaining] = String(left);
    slotNotes.push(`Level ${level} spell slots ${oldTotal === null ? 'none' : oldTotal} → ${total}`);
  }

  // ---- keep the numbers on the sheet consistent ----
  const level = levelFromClassLevel(sheet.ClassLevel) || character.level || 1;
  const pb = profBonus(level);
  const oldPb = firstInt(before.ProfBonus, pb, 0, 9);
  if (touched.level) sheet.ProfBonus = '+' + pb;
  const pbChanged = touched.level && pb !== oldPb;
  for (const k of touched.abilities) sheet[MOD_FIELD[k]] = signed(modOf(sheet[SCORE_FIELD[k]]));
  const skillsToDo = new Set(touched.skills);
  const savesToDo = new Set(touched.saves);
  if (pbChanged) {
    for (const [name, s] of Object.entries(SKILLS)) if (sheet[s.box] === true) skillsToDo.add(name);
    for (const k of ABILITIES) if (sheet[SAVES[k].box] === true) savesToDo.add(k);
  }
  for (const k of touched.abilities) {
    for (const [name, s] of Object.entries(SKILLS)) if (s.ability === k) skillsToDo.add(name);
    savesToDo.add(k);
  }
  const score = (k) => firstInt(sheet[SCORE_FIELD[k]], 10, 1, 30);
  for (const name of skillsToDo) {
    const s = SKILLS[name];
    const bonus = sheet[s.box] === true ? pb * (expertise.has(name) ? 2 : 1) : 0;
    sheet[s.field] = signed(modOf(score(s.ability)) + bonus);
  }
  for (const k of savesToDo) sheet[SAVES[k].field] = signed(modOf(score(k)) + (sheet[SAVES[k].box] === true ? pb : 0));
  if (skillsToDo.has('Perception')) sheet.Passive = String(10 + firstInt(sheet[SKILLS.Perception.field], 0, -10, 20));
  if (touched.abilities.has('dex')) sheet.Initiative = signed(modOf(score('dex')));

  // ---- what changed ----
  const changes = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(sheet)])) {
    const a = asText(before[key]);
    const b = asText(sheet[key]);
    if (a !== b) changes.push({ field: key, from: a.slice(0, 200), to: b.slice(0, 200) });
  }

  const base = deriveBase(character, sheet);
  base.expertise = [...expertise];
  const changed = (k) => asText(before[k]) !== asText(sheet[k]);
  if (changed('ClassLevel')) notes.push(`Class and level: ${before.ClassLevel || '(blank)'} → ${sheet.ClassLevel}`);
  if (xpNote) notes.push(xpNote);
  if (changed('HPMax')) notes.push(`Max HP ${before.HPMax} → ${sheet.HPMax}`);
  if (changed('HPCurrent')) notes.push(`HP ${before.HPCurrent} → ${sheet.HPCurrent}`);
  if (changed('HPTemp')) notes.push(`Temporary HP ${before.HPTemp || 0} → ${sheet.HPTemp}`);
  if (changed('AC')) notes.push(`Armor Class ${before.AC} → ${sheet.AC}`);
  if (changed('Speed')) notes.push(`Speed ${before.Speed} → ${sheet.Speed}`);
  for (const k of ABILITIES) if (changed(SCORE_FIELD[k])) notes.push(`${SCORE_FIELD[k]} ${before[SCORE_FIELD[k]]} → ${sheet[SCORE_FIELD[k]]}`);
  for (const name of touched.skills) {
    const was = before[SKILLS[name].box] === true;
    const now = sheet[SKILLS[name].box] === true;
    const label = !now ? 'not proficient' : expertise.has(name) ? 'expertise' : 'proficient';
    const wasExpert = (character.expertise || []).includes(name);
    if (was !== now || wasExpert !== expertise.has(name)) notes.push(`${name}: ${label}`);
  }
  for (const k of touched.saves) if ((before[SAVES[k].box] === true) !== (sheet[SAVES[k].box] === true)) notes.push(`${SCORE_FIELD[k]} saving throw: ${sheet[SAVES[k].box] === true ? 'proficient' : 'not proficient'}`);
  notes.push(...spellNotes, ...slotNotes);
  const spellLineSet = new Set(Object.values(FIELDS.spellLines).flat());
  const skip = new Set(['ClassLevel', 'XP', 'HPMax', 'HPCurrent', 'HPTemp', 'AC', 'Speed', 'ProfBonus', 'Passive', 'Initiative', ...ABILITIES.flatMap((k) => [SCORE_FIELD[k], MOD_FIELD[k]]), ...Object.values(SKILLS).flatMap((s) => [s.field, s.box]), ...Object.values(SAVES).flatMap((s) => [s.field, s.box]), ...Object.values(FIELDS.slots).flatMap((s) => [s.total, s.remaining])]);
  for (const c of changes) if (!skip.has(c.field) && !spellLineSet.has(c.field) && !LOCKED.has(c.field)) notes.push(`${pretty(c.field)} updated`);

  const logged = changes.length > 0;
  if (logged) {
    base.sheetLog = [...(Array.isArray(character.sheetLog) ? character.sheetLog : []), { at: new Date().toISOString(), by: 'ai', reason: String(u.reason || '').slice(0, 200), changes: changes.slice(0, 80) }].slice(-40);
  }
  const readyLevel = xpAfter !== null && levelForXp(xpAfter) > base.level ? levelForXp(xpAfter) : null;
  return { character: base, notes, rejected, readyLevel, changes };
}

// Find the character an update is about, by id or (failing that) by name.
function findCharacter(list, ref) {
  const key = String(ref ?? '').trim().toLowerCase();
  return list.find((c) => c.id.toLowerCase() === key) || list.find((c) => c.name.toLowerCase() === key) || null;
}

// Apply every updateCharacter in a list. store = { list(): Promise<character[]>, save(character): Promise<character> }.
export async function processCharacterUpdates(updates, store) {
  const results = [];
  const problems = [];
  if (!updates.length) return { results, problems };
  const list = await store.list();
  for (const u of updates) {
    const found = findCharacter(list, u.characterId ?? u.name);
    if (!found) { problems.push(`The DM tried to update a character that does not exist ("${u.characterId ?? u.name ?? ''}").`); continue; }
    const out = applyUpdate(found, u);
    if (!out.changes.length) { if (out.rejected.length) problems.push(...out.rejected.map((r) => `${found.name}: ${r}`)); continue; }
    const saved = await store.save(out.character);
    list[list.indexOf(found)] = saved;
    results.push({ id: saved.id, name: saved.name, character: saved, notes: out.notes, rejected: out.rejected, readyLevel: out.readyLevel });
  }
  return { results, problems };
}
