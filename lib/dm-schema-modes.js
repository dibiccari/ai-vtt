// The DM's reply form changes with the situation. The API only accepts a reply schema up to a certain size, so instead of one form for everything the DM gets the one that fits:
// in a fight (the combat tracker is running) it can do the things a fight needs; otherwise (a scene: talking, exploring, shopping, resting) the things a scene needs.
// schemaForMode(fullSchema, mode) returns a filtered copy of DM_SCHEMA (server.js); the full schema stays the single source and what tests validate against.
export const COMBAT_ONLY_ACTIONS = ['initiative', 'endCombat', 'endTurn', 'react', 'delay', 'resume', 'ready', 'template'];
export const SCENE_ONLY_ACTIONS = ['startCombat', 'rest', 'shop', 'supplies', 'hitdice', 'timeofday'];
export const SCENE_ONLY_VARIANTS = ['gear', 'journal', 'updateCharacter'];       // not available in the middle of a fight: after it ends (changeMap stays: a fight can end and the party move on in one reply)

export const modeOf = (combat) => (combat && combat.active ? 'combat' : 'scene');

export function schemaForMode(schema, mode, moved = null) {
  const out = JSON.parse(JSON.stringify(schema));
  const variants = out.properties.mapUpdates.items.anyOf;
  const dropActions = mode === 'combat' ? SCENE_ONLY_ACTIONS : COMBAT_ONLY_ACTIONS;
  const gone = (moved && moved.variants) || [], goneToken = (moved && moved.tokenActions) || [], goneGear = (moved && moved.gearActions) || [];   // handled by services instead (lib/services.js)
  out.properties.mapUpdates.items.anyOf = variants
    .filter((v) => !(mode === 'combat' && SCENE_ONLY_VARIANTS.includes(v.properties.type.enum[0])) && !gone.includes(v.properties.type.enum[0]))
    .map((v) => {
      const type = v.properties.type.enum[0];
      if (type === 'token') v.properties.action.enum = v.properties.action.enum.filter((a) => !dropActions.includes(a) && !goneToken.includes(a));
      if (type === 'gear') v.properties.action.enum = v.properties.action.enum.filter((a) => !goneGear.includes(a));
      return v;
    });
  return out;
}

// A line for the DM's system prompt so it knows which form it has and what to leave for later.
export function modeNote(mode) {
  if (mode === 'combat') return 'REPLY FORM: a fight is running, so this reply can use token updates (moves, damage, conditions, turns, templates...), setHp and addWall. It can also change the map (when the fight ends and the party moves on). It cannot change gear, the journal, character sheets, rests, shops or start a new fight. Narrate loot, rests and records and send those updates in the first reply after combat ends.';
  return 'REPLY FORM: no fight is running, so this reply can use token updates (not the turn-by-turn ones: initiative, endTurn, react, delay, resume, ready, template, endCombat), setHp, addWall, changeMap, gear, journal and updateCharacter. To start a fight send token action startCombat.';
}
