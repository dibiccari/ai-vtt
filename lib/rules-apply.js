// Applies the DM's (and the Party page's) rules-tracking updates: XP awards, Hit Dice, exhaustion, class resources and the game clock.
// `store` supplies: list() -> characters, save(character) -> saved, readClock(), writeClock(clock), sheetEdit(updates) -> { results, problems }
// (the sheet editor, so XP changes are logged and can be undone). Update shapes (type 'track'):
//   { op:'xp', target: characterId | 'party', amount, split? }   amount is XP each; with split, a total shared equally by the party
//   { op:'hitdice', target, count, die? }  { op:'exhaustion', target, delta }  { op:'resource', target, name, delta, max?, recharge? }
//   { op:'supplies', target, kind: 'food'|'water', days }  (days without; 0 = fed)
//   { op:'time', minutes }  { op:'setTime', day, hour, minute }
import { setSupplies, spendHitDice, changeExhaustion, changeResource, advanceClock, setClock, describeClock, trackView, levelForXp } from './rules-track.js';

export async function processTrackUpdates(updates, store, rules = '2014') {
  const notes = [];
  const problems = [];
  const changed = new Set();
  let characterUpdates = [];
  if (!updates.length) return { notes, problems, changed: [], characterUpdates };
  const all = await store.list();
  const byId = new Map(all.map((c) => [c.id, c]));
  const pick = (target) => byId.get(String(target ?? '')) || all.find((c) => c.name.toLowerCase() === String(target ?? '').trim().toLowerCase());
  const keep = async (c) => { const saved = await store.save(c); byId.set(saved.id, saved); changed.add(saved.id); };
  const sheetEdits = [];

  for (const u of updates) {
    if (!u || u.type !== 'track') continue;
    try {
      if (u.op === 'time' || u.op === 'setTime') {
        const clock = await store.readClock();
        const next = u.op === 'time' ? advanceClock(clock, u.minutes) : setClock(clock, u);
        await store.writeClock(next);
        notes.push(`Time: ${describeClock(next).text}`);
        continue;
      }
      if (u.op === 'xp') {
        const amount = Math.round(Number(u.amount));
        if (!Number.isFinite(amount) || amount === 0) { problems.push('An XP award needs a number.'); continue; }
        const party = String(u.target) === 'party';
        const members = party ? all : [pick(u.target)].filter(Boolean);
        if (!members.length) { problems.push(`No character called "${u.target}" for the XP award.`); continue; }
        const each = party && u.split !== false ? Math.floor(amount / members.length) : amount;
        for (const c of members) sheetEdits.push({ type: 'updateCharacter', characterId: c.id, reason: `XP award${party ? ' (party)' : ''}`, edits: [{ field: 'xpGain', value: String(each) }], skills: [], saves: [], spells: [], slots: [] });
        continue;
      }
      const c = pick(u.target);
      if (!c) { problems.push(`No character called "${u.target}".`); continue; }
      const current = byId.get(c.id);
      if (u.op === 'hitdice') {
        const out = spendHitDice(current, u.count, { die: u.die, rules });
        await keep(out.character);
        notes.push(out.note);
      } else if (u.op === 'exhaustion') {
        const out = changeExhaustion(current, u.delta, rules);
        await keep(out.character);
        notes.push(out.note);
      } else if (u.op === 'supplies') {
        const out = setSupplies(current, u.kind, u.days, rules);
        await keep(out.character);
        notes.push(out.note);
      } else if (u.op === 'resource') {
        const out = changeResource(current, u.name, u.delta, { max: u.max, recharge: u.recharge });
        if (out.ok) await keep(out.character); else if (/no resource/.test(out.note)) problems.push(out.note);
        notes.push(out.note);
      }
    } catch (err) {
      problems.push(`A rules update failed: ${err.message}`);
    }
  }
  if (sheetEdits.length) {
    const out = await store.sheetEdit(sheetEdits);
    characterUpdates = out.results || [];
    problems.push(...(out.problems || []));
    for (const e of sheetEdits) changed.add(e.characterId);
    for (const c of await store.list()) {
      const v = trackView(c, rules);
      if (sheetEdits.some((e) => e.characterId === c.id) && v.readyToLevelUp) notes.push(`${c.name} has ${v.xp} XP: enough for level ${levelForXp(v.xp)} (ready to level up)`);
    }
  }
  return { notes, problems, changed: [...changed], characterUpdates };
}
