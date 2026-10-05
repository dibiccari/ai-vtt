// Ready-made starting boards for built-in scenario campaigns (the map, the party's places and the NPCs).
// Used by the tabletop (the first time a scenario campaign is opened) and by the Test Lab (to start one over).
// Needs public/uvtt.js for importing the scenario's .dd2vtt map.
(function (root) {
  'use strict';

  var TAVERN = 'tavern-brawl-test';
  var LOST_MINE = 'lost-mine-of-phandelver';

  // Player characters start just inside the front door, in this order.
  var PARTY_SPOTS = [[14, 16], [15, 17], [13, 15], [15, 15], [16, 16], [12, 16]];

  // Matches the scenario text (public/scenarios/rusty-flagon-campaign.md).
  var CAST = [
    { id: 'npc-marta', name: 'Marta Ironbrew', role: 'Barkeep and owner', stat: 'Commoner (club)', col: 9, row: 2, color: '#d98f4e', speed: 25, words: ['innkeeper', 'barmaid', 'tavern', 'halfling', 'matron'] },
    { id: 'npc-bruno', name: 'Bruno', role: 'Bouncer', stat: 'Thug', col: 13, row: 17, color: '#7d8da6', speed: 30, words: ['bouncer', 'brawler', 'thug', 'guard'] },
    { id: 'npc-gruk', name: 'Gruk Tannerson', role: 'Loud mercenary', stat: 'Thug (mace)', col: 13, row: 10, color: '#c0504d', speed: 30, words: ['mercenary', 'sellsword', 'brute', 'thug'] },
    { id: 'npc-dan', name: 'Dagger Dan', role: "Gruk's crew", stat: 'Bandit (scimitar, crossbow)', col: 10, row: 9, color: '#b35f2a', speed: 30, words: ['bandit', 'rogue', 'cutpurse'] },
    { id: 'npc-jo', name: 'Skinny Jo', role: "Gruk's crew", stat: 'Bandit (scimitar)', col: 11, row: 11, color: '#a8742a', speed: 30, words: ['bandit', 'thief', 'rogue'] },
    { id: 'npc-odo', name: 'Odo Pennywhistle', role: 'Regular', stat: 'Commoner', col: 5, row: 9, color: '#8fae6b', speed: 30, words: ['drunk', 'peasant', 'commoner', 'farmer', 'villager'] },
    { id: 'npc-pell', name: 'Pell Brightwater', role: 'Regular', stat: 'Commoner', col: 7, row: 10, color: '#6ba58e', speed: 30, words: ['drunk', 'peasant', 'commoner', 'villager'] },
    { id: 'npc-nim', name: 'Nim', role: 'Nervous stranger in the back booth', stat: 'Spy', col: 26, row: 12, color: '#7a6ea8', speed: 30, words: ['spy', 'cloaked', 'hooded', 'assassin', 'informant'] },
    { id: 'trap-tripwire', name: 'Tripwire alarm', role: 'Hidden trap in the kitchen doorway (a secret: only visible in DM view)', stat: 'Perception DC 13 to notice', col: 22, row: 5, color: '#c9a64a', speed: 0, words: [], hidden: true, kind: 'trap' }
  ];

  async function getJson(url) {
    var res = await fetch(url);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
  }

  // Look through the token library for art that fits each NPC (optional; falls back to a colour).
  async function pickArt() {
    var images = {};
    try {
      var res = await fetch('/tokens/manifest.json');
      if (!res.ok) return images;
      var tokens = (await res.json()).tokens || [];
      CAST.forEach(function (n) {
        var hits = tokens.filter(function (t) { return n.words.some(function (w) { return String(t.name).toLowerCase().indexOf(w) >= 0; }); });
        if (hits.length) {
          var hash = 0;
          for (var i = 0; i < n.name.length; i++) hash += n.name.charCodeAt(i);
          images[n.id] = '/tokens/' + hits[hash % hits.length].file;
        }
      });
    } catch (e) { /* no art is fine */ }
    return images;
  }

  // The tavern map: reuse it if it is already imported, otherwise import the .dd2vtt that ships with the app.
  async function ensureTavernMap() {
    var maps = (await getJson('/api/maps')).maps || [];
    var existing = maps.filter(function (u) { return /\/rusty-flagon-[^/]+$/.test(u); })[0];
    var text = await (await fetch('/scenarios/rusty-flagon.dd2vtt')).text();
    var u = Uvtt.parse(text);
    if (existing) {
      var name = existing.split('/').pop();
      var cfg = (await getJson('/api/map-config?map=' + encodeURIComponent(name))).config;
      if (!cfg || !Array.isArray(cfg.walls) || !cfg.walls.length) {
        await fetch('/api/map-config?map=' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ squares: 30, walls: Uvtt.toWalls(u, 1), source: 'dd2vtt' }) });
      }
      return existing;
    }
    return (await Uvtt.importAsMap(u, 'rusty-flagon')).url;
  }

  var has = function (id) { return id === TAVERN || id === LOST_MINE; };

  // Lost Mine of Phandelver starts on the road: the Sword Coast map, with the party on the Triboar Trail
  // a half-day's march from Phandalin (where the Goblin Arrows chapter begins). Returns null if the map is not installed.
  async function createLostMine(opts) {
    var maps = (await getJson('/api/maps')).maps || [];
    var url = maps.filter(function (u) { return /\/northswordcoast-playerversion\.[a-z]+$/.test(u); })[0] || maps.filter(function (u) { return /northswordcoast/.test(u); })[0] || null;
    if (!url) return null;
    var chars = await getJson('/api/characters');
    var spots = [[31, 49], [32, 49], [31, 50], [32, 50], [33, 49], [33, 50]];
    var tokens = chars.slice(0, spots.length).map(function (c, i) {
      return { id: 'tok-' + c.id, name: c.name, col: spots[i][0], row: spots[i][1], color: c.color, isPC: true, characterId: c.id, speed: c.speed, movementRemaining: c.speed, image: c.image || '' };
    });
    // The Sword Coast map is a regional map, not a battle grid: no grid lines, no fog, no tokens on it, and it is shown whole.
    return { mapUrl: url, tokens: tokens, activeIndex: 0, fogEnabled: false, gridOpacity: 0, zoomToParty: false, mapKind: 'regional' };
  }

  // A fresh board for a scenario campaign: { mapUrl, tokens, activeIndex, fogEnabled, gridOpacity }.
  async function create(id, options) {
    if (!has(id)) throw new Error('No ready-made scene for ' + id);
    var opts = options || {};
    if (id === LOST_MINE) return createLostMine(opts);
    var mapUrl = await ensureTavernMap();
    var chars = await getJson('/api/characters');
    if (!chars.length) throw new Error('There are no characters yet. Make some on the Character Sheets page first.');
    var art = await pickArt();
    var tokens = [];
    chars.slice(0, PARTY_SPOTS.length).forEach(function (c, i) {
      tokens.push({ id: 'tok-' + c.id, name: c.name, col: PARTY_SPOTS[i][0], row: PARTY_SPOTS[i][1], color: c.color, isPC: true, characterId: c.id, speed: c.speed, movementRemaining: c.speed, image: c.image || '' });
    });
    CAST.forEach(function (n) {
      tokens.push({ id: n.id, name: n.name, col: n.col, row: n.row, color: n.color, isPC: false, characterId: null, speed: n.speed, movementRemaining: n.speed, image: art[n.id] || '', hidden: Boolean(n.hidden), kind: n.kind || 'creature' });
    });
    // The tavern has walls, doors and hidden things, so fog of war starts on.
    return { mapUrl: mapUrl, tokens: tokens, activeIndex: 0, fogEnabled: opts.fog === undefined ? true : Boolean(opts.fog), gridOpacity: 0.35 };
  }

  root.Scenes = { has: has, create: create, cast: function () { return CAST; }, partySpots: function () { return PARTY_SPOTS; }, pickArt: pickArt };
})(window);
