// The services the Dungeon Master calls as tools while it works out a reply (the orchestrator pattern): each one is a small function with a clear input and a plain result
// that the DM reads before it narrates ("bought; 13 gp left", "cannot afford it"). Deterministic code does the work (lib/*), the DM only decides what to call.
// buildServices(deps) -> service definitions; toolsFor(services, mode) -> Anthropic tool definitions; runService(services, name, input) -> { ok, text }.
import { CATEGORIES, STATUSES } from './journal.js';

// Which services the DM has (VTT_DM_SERVICES, a comma list; default: none). A service costs an extra round trip to the model each time it is called, and in the live checks (Nov 2026) the DM sometimes
// called a tool for no reason (a "noop" purchase) and, with a tool present, skipped a map change it made without one. So they are off until that is understood; the journal is kept by the bookkeeper
// (lib/bookkeeper.js) and purchases and XP stay in the reply form. The registry, the tool loop and the tests stay, ready to be switched on per service.
export const DEFAULT_SERVICES = [];
export const enabledServices = (env) => (env === undefined || env === '' ? DEFAULT_SERVICES : String(env).split(',').map((x) => x.trim()).filter(Boolean));
// What moved out of the DM's reply form into services (schemaForMode removes these).
const MOVES = { record_journal: { variants: ['journal'] }, award_xp: { tokenActions: ['xp'] }, buy_item: { gearActions: ['buy'] } };
export function movedFor(names) {
  const out = { variants: [], tokenActions: [], gearActions: [] };
  for (const n of names) { const m = MOVES[n]; if (m) for (const k of Object.keys(out)) out[k].push(...(m[k] || [])); }
  return out;
}
export const MOVED_TO_SERVICES = movedFor(DEFAULT_SERVICES);

export function buildServices(deps) {
  return [
    {
      name: 'record_journal', modes: ['scene', 'combat'],
      description: 'Write to the party\'s shared journal (the campaign memory the DM reads every turn). Use it after something worth remembering: a person met (npc), a quest given or finished (quest, with status open or done), a place learned (place), loot (loot), a promise made (promise) or a notable event (event). One entry per call. An npc, place, quest, loot or promise with the same title is updated, not duplicated.',
      input_schema: { type: 'object', properties: { category: { type: 'string', enum: CATEGORIES }, title: { type: 'string', description: 'Short name of the person, place, quest or event' }, text: { type: 'string', description: 'What the party should remember, one or two sentences' }, status: { type: 'string', enum: STATUSES, description: 'open or done for quests; none otherwise' }, when: { type: 'string', description: 'Optional in-game time, for example "Day 2, evening"' } }, required: ['category', 'title', 'text'] },
      run: (input) => deps.journal(input)
    },
    {
      name: 'buy_item', modes: ['scene'],
      description: 'The party buys something from a merchant. The table prices it from the SRD, pays from the buyer\'s coins with change, adds the item to the pack and, for armor and weapons, updates Armor Class and the attack lines. If the buyer cannot afford it nothing happens and you are told. Pass price_cp (the whole price in copper) only when the price is not the SRD price (haggled, marked up, a special item). Never take coins yourself for a purchase. For goods given or found for free use the gear update in your reply instead.',
      input_schema: { type: 'object', properties: { buyer: { type: 'string', description: 'The player character who pays: their name ("Thorin") or characterId' }, item: { type: 'string', description: 'SRD item name, for example "Chain Mail" or "Rope, hempen (50 feet)"' }, qty: { type: 'integer', minimum: 1 }, price_cp: { type: 'integer', minimum: 0, description: 'Whole price in copper when it is not the SRD price' } }, required: ['buyer', 'item'] },
      run: (input) => deps.buy(input)
    },
    {
      name: 'award_xp', modes: ['scene', 'combat'],
      description: 'Award experience points: to the whole party (target "party", the amount is shared equally unless each is true) or to one character (target = characterId). Use it at the end of an encounter or at a milestone, with monster XP by challenge rating. The table adds it to the sheets and tells you when someone is ready to level up.',
      input_schema: { type: 'object', properties: { target: { type: 'string', description: '"party" or a characterId' }, amount: { type: 'integer', minimum: 1 }, each: { type: 'boolean', description: 'true: every party member gets the full amount' } }, required: ['target', 'amount'] },
      run: (input) => deps.xp(input)
    }
  ];
}

export const toolsFor = (services, mode) => services.filter((s) => s.modes.includes(mode)).map((s) => ({ name: s.name, description: s.description, input_schema: s.input_schema }));

export async function runService(services, name, input) {
  const svc = services.find((s) => s.name === name);
  if (!svc) return { ok: false, text: `There is no service called "${name}".` };
  try {
    const out = await svc.run(input && typeof input === 'object' ? input : {});
    return { ok: out.ok !== false, text: String(out.text || (out.ok === false ? 'It did not work.' : 'Done.')).slice(0, 1200) };
  } catch (err) {
    return { ok: false, text: `The service "${name}" failed: ${err.message}` };
  }
}

// The paragraph the DM reads about its services.
export const servicesNote = (names) => {
  const doc = { record_journal: 'record_journal (the journal; it replaces the journal update)', buy_item: 'buy_item (the party buys goods; it replaces the gear action buy)', award_xp: 'award_xp (experience; it replaces the token action xp)' };
  return `SERVICES: you can call tools while you work out a reply: ${names.map((n) => doc[n] || n).join(', ')}. Call one ONLY when the story needs it (a real purchase for buy_item): never call a service to test it, to check that it works, or when nothing needs doing, and most turns need no call at all. Read the result and narrate what really happened (if buy_item says the buyer cannot afford it, the sale did not happen). Your final reply is still the JSON form, which no longer accepts what the services replace.`;
};
