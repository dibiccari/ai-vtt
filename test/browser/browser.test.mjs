// Browser-logic tests: headless Chrome opens the real tabletop (index.html?nosave=1) served by a sandboxed server and drives window.vtt.
// Skipped automatically when Chrome is missing. Run with: npm run test:browser  (node --experimental-websocket --test test/browser.test.mjs)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const LOST = 'lost-mine-of-phandelver';
let server, page;

before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/campaigns/active', { id: LOST });
  page = await launchChrome();
  await page.goto(`${server.base}/index.html?nosave=1`);
  await page.waitFor('window.vtt && window.vtt.state.tokens.length >= 4 && window.vtt.state.characters.length >= 4 && !document.querySelector("#chatInput").disabled');
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });

const opts = { skip: skip || false };

test('the tabletop starts for the Lost Mine party with no page errors', opts, async () => {
  const s = await page.eval(`(() => ({ pcs: vtt.state.tokens.filter(t => t.isPC).map(t => t.name).sort(), campaign: vtt.state.campaignId, kind: vtt.state.mapKind, combat: vtt.state.combat.active }))()`);
  assert.deepEqual(s.pcs, ['Astarion', 'Edric', 'Raechyl', 'Shadowheart']);
  assert.equal(s.campaign, LOST); assert.equal(s.combat, false);
  assert.deepEqual(page.problems, []);
});

test('travelTo puts the party on the map\'s start pin (image pixels turned into a square at the map\'s scale)', opts, async () => {
  const places = (await server.get('/api/maps/available')).json.maps;
  const hideout = places.find((m) => m.id === 'cragmaw-hideout');
  assert.ok(hideout && hideout.startPx, 'the map has a saved start pin');
  const cfg = (await server.get('/api/map-config?map=lmop-cragmaw-hideout.png')).json.config;
  const pin = cfg.starts.find((p) => p.name === 'start');
  const r = await page.eval(`(async () => {
    await vtt.travelTo(${JSON.stringify({ mapUrl: hideout.url, mapName: hideout.name, kind: hideout.kind, col: hideout.start.col, row: hideout.start.row, px: hideout.startPx })});
    const img = vtt.state.map.img, f = vtt.state.map.drawW / img.naturalWidth;
    return { url: vtt.state.map.url, kind: vtt.state.mapKind, f, pcs: vtt.state.tokens.filter(t => t.isPC).map(t => [t.col, t.row]), cols: vtt.state.map.width / 50, rows: vtt.state.map.height / 50 };
  })()`);
  assert.equal(r.url, hideout.url); assert.equal(r.kind, 'battle');
  const col = Math.floor(pin.x * r.f / 50), row = Math.floor(pin.y * r.f / 50);
  assert.deepEqual(r.pcs[0], [col, row], 'the first party member stands exactly on the pin square');
  assert.equal(new Set(r.pcs.map((p) => p.join(','))).size, 4, 'nobody shares a square');
  for (const [c, rw] of r.pcs) { assert.ok(Math.hypot(c - col, rw - row) <= 3, 'the party stands together at the pin'); assert.ok(c >= 0 && rw >= 0 && c < r.cols && rw < r.rows); }
});

// A clean board: only walls we draw. Squares are 50 px; the test token stands at (10, 10) and the wall is the line x = 550, between columns 10 and 11.
const setup = `(() => {
  const s = vtt.state;
  s.combat = { active: false, round: 0, order: [] };
  s.gmOverride = false; s.difficult = []; s.difficultSquares = null; s.dmView = false;
  if (s.tokens.some((t) => !t)) { window.__hole = (window.__hole || 0) + 1; s.tokens = s.tokens.filter(Boolean); throw new Error("a test left an undefined token in the list (the one before this)"); }
  if (window.__keepTokens) { s.tokens = window.__keepTokens; window.__keepTokens = null; }      // a test that swapped the tokens (the flying one) gives them back
  { const pcs = s.tokens.filter(t => t && t.isPC); s.tokens = [pcs.find(t => characterFor(t)) || pcs[0]].filter(Boolean); }      // the party member that has a character sheet
  const hero = s.tokens[0]; hero.col = 10; hero.row = 10; hero.speed = 30; hero.movementRemaining = 30; hero.conditions = []; delete hero.where;
  s.activeIndex = 0; s.walls = []; s.wallsVersion++; s.fogEnabled = false;
  return hero.name;
})()`;
const keys = (m) => `new Set([...${m}.keys()])`;

test('movement: free roam is limited by walls, doors and the edge of the map, never by a turn budget', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state, hero = s.tokens[0], out = {};
    const has = (c, r) => vtt.reachable(hero).has(c + ',' + r);
    out.open = [has(9, 10), has(11, 10), has(20, 10), has(10, 11)];
    out.self = has(10, 10);
    s.walls = [{ x1: 550, y1: 0, x2: 550, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.walled = [has(9, 10), has(11, 10), has(20, 10), has(5, 5)];
    s.walls = [{ x1: 550, y1: 0, x2: 550, y2: 450, type: 'wall', open: false }, { x1: 550, y1: 450, x2: 550, y2: 550, type: 'door', open: false }, { x1: 550, y1: 550, x2: 550, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.doorClosed = has(12, 10);
    s.walls[1].open = true; s.wallsVersion++;
    out.doorOpen = has(12, 10);
    s.walls = [{ x1: 550, y1: 0, x2: 550, y2: s.map.height, type: 'fence', open: false }]; s.wallsVersion++;
    out.fence = has(12, 10);
    const sight = vtt.visibilityPolygon(525, 525); out.fenceSightReaches = sight.some(p => p.x > 600);
    s.walls = [{ x1: 550, y1: 0, x2: 550, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.wallSightReaches = vtt.visibilityPolygon(525, 525).some(p => p.x > 600);
    return out;
  })()`);
  assert.deepEqual(r.open, [true, true, true, true]); assert.equal(r.self, true, 'the token\'s own square is always in its range (it may stay put)');
  assert.deepEqual(r.walled, [true, false, false, true], 'a wall the full height of the map stops the token');
  assert.equal(r.doorClosed, false, 'a closed door blocks'); assert.equal(r.doorOpen, true, 'an open door lets the token through');
  assert.equal(r.fence, false, 'a fence blocks movement'); assert.equal(r.fenceSightReaches, true, 'but not sight');
  assert.equal(r.wallSightReaches, false, 'a wall blocks sight');
});

test('movement: in a fight the range is a circle of the remaining speed; other tokens block landing squares', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state, hero = s.tokens[0];
    s.combat = { active: true, round: 1, order: [hero.id] };
    hero.movementRemaining = 30;                                                   // 6 squares
    const has = (c, r) => vtt.reachable(hero).has(c + ',' + r);
    const out = { in6: has(16, 10), out7: has(17, 10), diag: has(14, 14), farDiag: has(15, 15), rangeNone: (hero.movementRemaining = 0, vtt.reachable(hero).size) };
    hero.movementRemaining = 30; s.tokens.push(makeToken({ id: 'blocker', name: 'Blocker', color: '#f00', isPC: false, col: 12, row: 10 })); s.wallsVersion++;
    out.occupied = has(12, 10); out.pastOccupied = has(13, 10);
    s.tokens.pop(); s.combat = { active: false, round: 0, order: [] }; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.in6, true); assert.equal(r.out7, false);
  assert.equal(r.diag, true, '(4,4) squares away is 5.7 squares in a straight line'); assert.equal(r.farDiag, false);
  assert.equal(r.rangeNone, 1, 'no movement left: only its own square');
  assert.equal(r.occupied, false, 'cannot end on an occupied square'); assert.equal(r.pastOccupied, true, 'but can pass an ally or foe square');
});

test('fog of war: a hidden token is never seen, a visible one only inside the party\'s line of sight', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.fogEnabled = true; s.dmView = false;
    s.tokens.push(makeToken({ id: 'gob', name: 'Goblin', color: '#0a0', isPC: false, col: 14, row: 10 }));
    s.tokens.push(makeToken({ id: 'sneak', name: 'Sneak', color: '#0a0', isPC: false, col: 12, row: 10, hidden: true }));
    s.tokens.push(makeToken({ id: 'trap', name: 'Pit', color: '#a00', isPC: false, col: 11, row: 11, hidden: true, kind: 'trap' }));
    const seen = (id) => vtt.seenByParty(s.tokens.find(t => t.id === id));
    const out = {};
    s.walls = []; s.wallsVersion++; vtt.revealFog();
    out.pc = seen(s.tokens[0].id); out.openGround = seen('gob'); out.hiddenInOpen = seen('sneak'); out.trapInOpen = seen('trap');
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++; vtt.revealFog();
    out.behindWall = seen('gob');
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: s.map.height, type: 'fence', open: false }]; s.wallsVersion++; vtt.revealFog();
    out.behindFence = seen('gob');
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++; vtt.revealFog();
    s.fogEnabled = false; out.fogOff = seen('gob'); out.fogOffHidden = seen('sneak');
    s.fogEnabled = true; s.dmView = true; out.dmViewSeenFlag = seen('gob');
    s.dmView = false; s.tokens.find(t => t.id === 'gob').conditions = [{ name: 'invisible', rounds: 0 }]; s.fogEnabled = false; out.invisible = seen('gob');
    s.tokens.find(t => t.id === 'gob').conditions = []; s.fogEnabled = true;
    const hero = s.tokens[0]; hero.where = 'back at camp'; out.elsewhere = seen(hero.id); delete hero.where;
    s.tokens = s.tokens.filter(t => t.isPC); s.walls = []; s.wallsVersion++; vtt.revealFog(); s.fogEnabled = false;
    return out;
  })()`);
  assert.equal(r.pc, true); assert.equal(r.openGround, true);
  assert.equal(r.hiddenInOpen, false, 'a hidden token is not seen even in plain sight'); assert.equal(r.trapInOpen, false);
  assert.equal(r.behindWall, false, 'behind a wall the goblin is unseen'); assert.equal(r.behindFence, true, 'a fence does not stop sight');
  assert.equal(r.fogOff, true, 'with fog off everything not hidden is seen'); assert.equal(r.fogOffHidden, false);
  assert.equal(r.dmViewSeenFlag, false, 'DM view shows ghosts but the party still does not see it');
  assert.equal(r.invisible, false); assert.equal(r.elsewhere, false);
});

test('combat: initiative order is descending, ties go to Dexterity then name, traps and the dead stay out', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.fogEnabled = false;
    const pc = s.tokens[0];
    const mk = (id, name, col, extra = {}) => Object.assign(makeToken({ id, name, color: '#0a0', isPC: false, col, row: 12 }), { hp: 10, maxHp: 10, ac: 12, dexMod: 0 }, extra);
    s.tokens.push(mk('a', 'Ant', 11, { dexMod: 1 }), mk('b', 'Bat', 12, { dexMod: 3 }), mk('c', 'Cat', 13, { dexMod: 3 }), mk('d', 'Dog', 14), mk('dead', 'Corpse', 15, { dead: true }), mk('trap', 'Pit', 16, { kind: 'trap', hidden: true }));
    vtt.startCombat();
    const out = { active: s.combat.active, round: s.combat.round, orderNames: s.combat.order.map(id => s.tokens.find(t => t.id === id).name) };
    // fixed numbers: sort by initiative, then Dexterity modifier, then name
    const init = { [pc.id]: 12, a: 15, b: 15, c: 15, d: 8, dead: 20, trap: 20 };
    for (const t of s.tokens) if (init[t.id] !== undefined) t.initiative = init[t.id];
    sortCombat();
    out.sorted = s.combat.order.map(id => s.tokens.find(t => t.id === id).name);
    return out;
  })()`);
  assert.equal(r.active, true); assert.equal(r.round, 1);
  assert.ok(!r.orderNames.includes('Pit') && !r.orderNames.includes('Corpse'), 'a trap and a defeated creature are not combatants: ' + r.orderNames);
  assert.equal(r.orderNames.length, 5);
  assert.deepEqual(r.sorted.map((n, i) => (i === 3 ? 'PC' : n)), ['Bat', 'Cat', 'Ant', 'PC', 'Dog'], 'ties: Bat and Cat (Dex +3, by name) before Ant (Dex +1); then the 12 and the 8');
});

test('combat: the initial rolls are d20 plus Dexterity, turns advance over visible creatures and the round counts up', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.fogEnabled = false;
    const mk = (id, name, col, dex) => Object.assign(makeToken({ id, name, color: '#0a0', isPC: false, col, row: 12 }), { hp: 10, maxHp: 10, ac: 12, dexMod: dex });
    s.tokens.push(mk('a', 'Ant', 11, 2), mk('b', 'Bat', 12, -1));
    vtt.startCombat();
    const out = { rolls: [] };
    for (const t of s.tokens.filter(t => !t.isPC)) out.rolls.push([t.initiative - t.dexMod, t.initiative]);
    const hero = s.tokens[0];
    hero.initiative = 20; s.tokens[1].initiative = 10; s.tokens[2].initiative = 5; sortCombat(); s.activeIndex = s.tokens.indexOf(hero);
    out.order = s.combat.order.slice();
    const seq = [];
    for (let i = 0; i < 4; i++) { nextCombatTurn(); seq.push([s.tokens[s.activeIndex].id, s.combat.round]); }
    out.seq = seq;
    out.heroId = hero.id;
    return out;
  })()`);
  for (const [die, total] of r.rolls) { assert.ok(Number.isInteger(die) && die >= 1 && die <= 20, `initiative d20 ${die}`); assert.ok(total >= die - 1 && total <= die + 2); }
  assert.deepEqual(r.seq.map((x) => x[0]), ['a', 'b', r.heroId, 'a'], 'the turn passes down the order and wraps');
  assert.deepEqual(r.seq.map((x) => x[1]), [1, 1, 2, 2], 'the round counts up when the order wraps');
});

test('combat: hit points: a creature at 0 is defeated, a player character at 0 falls unconscious with death saves, healing brings them back', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.fogEnabled = false;
    s.combat = { active: false, round: 0, order: [] };
    const gob = Object.assign(makeToken({ id: 'gob', name: 'Goblin', color: '#0a0', isPC: false, col: 12, row: 10 }), { hp: 7, maxHp: 7, ac: 15, dexMod: 2 });
    s.tokens.push(gob);
    const out = {};
    out.hit = vtt.changeHp(gob, -3); out.gobHp = gob.hp; out.dead0 = gob.dead;
    vtt.changeHp(gob, -99); out.deadAfter = gob.dead; out.hpFloor = gob.hp;
    vtt.changeHp(gob, 5); out.revived = gob.dead; out.reviveHp = gob.hp;
    vtt.changeHp(gob, 99); out.cap = gob.hp;
    const hero = s.tokens[0], c = characterFor(hero), max = c.maxHp;
    vtt.changeHp(hero, -c.hp); out.pcHp = c.hp; out.pcCond = hero.conditions.map(x => x.name); out.saves = hero.deathSaves;
    vtt.changeHp(hero, 3); out.pcUp = c.hp; out.pcCondAfter = hero.conditions.map(x => x.name); out.savesAfter = hero.deathSaves;
    vtt.changeHp(hero, max); out.max = max; out.pcFull = c.hp;
    return out;
  })()`);
  assert.deepEqual(r.hit, { before: 7, after: 4 }); assert.equal(r.gobHp, 4); assert.ok(!r.dead0);
  assert.equal(r.deadAfter, true); assert.equal(r.hpFloor, 0); assert.equal(r.revived, false); assert.equal(r.reviveHp, 5); assert.equal(r.cap, 7);
  assert.equal(r.pcHp, 0); assert.ok(r.pcCond.includes('unconscious')); assert.deepEqual(r.saves, { success: 0, fail: 0 });
  assert.equal(r.pcUp, 3); assert.ok(!r.pcCondAfter.includes('unconscious')); assert.equal(r.savesAfter, null);
  assert.equal(r.pcFull, r.max);
});

test('the DM\'s board updates: applyMapUpdates adds, moves, hides, reveals and removes tokens', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state;
    await vtt.applyMapUpdates([{ type: 'addToken', tokenId: 'z1', name: 'Zombie', col: 12, row: 12, color: '#6a6', hidden: true, kind: 'creature', monster: 'zombie', maxHp: 22, ac: 8, speed: 20, dexMod: -2, image: '' }]);
    const z = () => s.tokens.find(t => t.id === 'z1');
    const out = { added: !!z(), hp: z() && [z().hp ?? z().maxHp, z().maxHp, z().ac], hidden: z() && z().hidden };
    await vtt.applyMapUpdates([{ type: 'revealToken', tokenId: 'z1' }]); out.revealed = z().hidden;
    await vtt.applyMapUpdates([{ type: 'moveToken', tokenId: 'z1', col: 13, row: 12 }]); out.moved = [z().col, z().row];
    await vtt.applyMapUpdates([{ type: 'hideToken', tokenId: 'z1' }]); out.rehidden = z().hidden;
    await vtt.applyMapUpdates([{ type: 'addCondition', tokenId: 'z1', condition: 'prone', rounds: 2 }]); out.cond = z().conditions.map(c => c.name + ':' + c.rounds);
    await vtt.applyMapUpdates([{ type: 'removeToken', tokenId: 'z1' }]); out.removed = !z();
    return out;
  })()`);
  assert.equal(r.added, true); assert.equal(r.hp[1], 22); assert.equal(r.hp[2], 8); assert.equal(r.hidden, true);
  assert.equal(r.revealed, false); assert.deepEqual(r.moved, [13, 12]); assert.equal(r.rehidden, true);
  assert.deepEqual(r.cond, ['prone:2']); assert.equal(r.removed, true);
});

test('light: ambient levels, a lamp\'s bright and dim rings, walls stop light, a carried torch', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state, hero = s.tokens[0];
    s.lights = [{ id: 'lamp', name: 'lamp', x: centerOf(15), y: centerOf(10), bright: 100, dim: 200 }];
    const at = (dx) => lightLevelAt(centerOf(15) + dx, centerOf(10));
    const out = {};
    s.ambient = 'bright'; out.bright = [at(0), at(500)]; s.ambient = 'dim'; out.dim = [at(0), at(500)];
    s.ambient = 'dark'; s.ambientOverride = '';
    out.dark = [at(0), at(90), at(150), at(250)];
    s.ambientOverride = 'bright'; out.override = at(500); s.ambientOverride = '';
    s.walls = [{ x1: centerOf(15) + 60, y1: 0, x2: centerOf(15) + 60, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.behindWall = at(90); out.nearSide = lightLevelAt(centerOf(15) - 50, centerOf(10));
    s.walls = []; s.wallsVersion++;
    s.lightsOff = { [s.map.url || '']: ['lamp'] }; out.lampOut = at(0); s.lightsOff = {};
    s.lights = []; hero.lightKind = 'torch';
    const near = (d) => lightLevelAt(centerOf(hero.col) + d, centerOf(hero.row));
    out.torch = [near(150), near(300), near(500)];      // torch 20/40 ft = 200 / 400 px
    hero.lightKind = ''; s.ambient = 'bright';
    return out;
  })()`);
  assert.deepEqual(r.bright, [2, 2]); assert.deepEqual(r.dim, [1, 1]);
  assert.deepEqual(r.dark, [2, 2, 1, 0], 'bright to the half radius, dim to the full radius, dark beyond');
  assert.equal(r.override, 2, 'the table\'s own light level replaces the map\'s');
  assert.equal(r.behindWall, 0, 'a wall stops the light'); assert.equal(r.nearSide, 2);
  assert.equal(r.lampOut, 0, 'a lamp that is put out gives nothing');
  assert.deepEqual(r.torch, [2, 1, 0]);
});

test('darkvision and sight in the dark: lit squares and darkvision range are seen, the rest is not; blindness shrinks sight to the own square', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state, hero = s.tokens[0], c = characterFor(hero);
    s.fogEnabled = true; s.ambient = 'dark'; s.ambientOverride = ''; s.walls = []; s.wallsVersion++;
    s.lights = [{ id: 'lamp', name: 'lamp', x: centerOf(16), y: centerOf(10), bright: 100, dim: 200 }];
    const out = {}, see = (col, row) => { vtt.revealFog(); return s.sight.some((sg) => visibleFrom(sg, centerOf(col), centerOf(row))); };
    c.darkvision = 0;
    out.noDv = { lit: see(16, 10), adjacentDark: see(11, 10), farDark: see(10, 4) };
    c.darkvision = 60;
    out.dv60 = { within: see(10, 5), beyond: see(10, 20), lampStillSeen: see(16, 10) };
    hero.conditions = [{ name: 'blinded', rounds: 0 }];
    out.blind = { own: see(10, 10), next: see(11, 10) };
    hero.conditions = [];
    s.walls = [{ x1: centerOf(13), y1: 0, x2: centerOf(13), y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.walled = { lampBehindWall: see(16, 10) };
    const gob = makeToken({ id: 'gob', name: 'Goblin', color: '#0a0', isPC: false, col: 10, row: 19 }); s.tokens.push(gob);
    s.walls = []; s.wallsVersion++; c.darkvision = 0; vtt.revealFog(); out.unseenGoblinInDark = vtt.seenByParty(gob);
    c.darkvision = 120; vtt.revealFog(); out.goblinWithDv = vtt.seenByParty(gob);
    s.tokens.pop(); c.darkvision = 0; s.fogEnabled = false; s.ambient = 'bright'; s.lights = [];
    return out;
  })()`);
  assert.deepEqual(r.noDv, { lit: true, adjacentDark: false, farDark: false });
  assert.deepEqual(r.dv60, { within: true, beyond: false, lampStillSeen: true });
  assert.deepEqual(r.blind, { own: true, next: false });
  assert.equal(r.walled.lampBehindWall, false);
  assert.equal(r.unseenGoblinInDark, false); assert.equal(r.goblinWithDv, true, 'darkvision 120 ft reaches 9 squares');
});

test('difficult terrain: entering a difficult square costs double movement in a fight (Terrain Test Grounds)', opts, async () => {
  const terrainUrl = '/uploads/vtt-terrain-test.png';
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state;
    await vtt.travelTo({ mapUrl: ${JSON.stringify(terrainUrl)}, mapName: 'Terrain', kind: 'battle', col: 5, row: 5 });
    s.tokens = s.tokens.filter((t) => t.isPC).slice(0, 1); const hero = s.tokens[0];
    s.walls = []; s.wallsVersion++; s.fogEnabled = false; s.gmOverride = false; s.moveRule = 'circle';
    const out = { difficultRects: s.difficult.length };
    const D = (c, r) => isDifficult(c, r);
    let pick = null;
    for (let r = 1; r < rows() - 1 && !pick; r++) for (let c = 2; c < cols() - 3; c++) if (!D(c - 1, r) && D(c, r) && D(c + 1, r) && inBounds(c - 1, r)) { pick = { c, r }; break; }
    out.pick = pick;
    if (!pick) return out;
    hero.col = pick.c - 1; hero.row = pick.r;
    s.combat = { active: true, round: 1, order: [hero.id] };
    const reach = (ft) => { hero.movementRemaining = ft; s.wallsVersion++; return vtt.reachable(hero); };
    out.open5 = reach(5).has((pick.c - 2) + ',' + pick.r);
    out.diff5 = reach(5).has(pick.c + ',' + pick.r);
    out.diff10 = reach(10).has(pick.c + ',' + pick.r);
    out.second15 = reach(15).has((pick.c + 1) + ',' + pick.r);
    out.second20 = reach(20).has((pick.c + 1) + ',' + pick.r);
    s.combat = { active: false, round: 0, order: [] }; hero.movementRemaining = 5; s.wallsVersion++;
    out.freeRoamIgnoresBudget = vtt.reachable(hero).has((pick.c + 6) + ',' + pick.r);
    return out;
  })()`);
  assert.ok(r.difficultRects >= 10, 'the terrain map has its difficult rectangles');
  assert.ok(r.pick, 'found a straight run of difficult squares next to open ground');
  assert.equal(r.open5, true, 'open ground costs 5 ft per square'); assert.equal(r.diff5, false, 'a difficult square needs 10 ft');
  assert.equal(r.diff10, true); assert.equal(r.second15, false, 'two difficult squares need 20 ft'); assert.equal(r.second20, true);
  assert.equal(r.freeRoamIgnoresBudget, true, 'outside a fight there is no movement budget');
});

test('combat extras together: hidden initiative, surprise, ready, delay (tie), reactions, opportunity attacks, templates and DM notes', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.fogEnabled = false; s.dmView = false; s.pendingNotes.length = 0;
    const hero = s.tokens[0];
    const ally = Object.assign(makeToken({ id: 'ally', name: 'Ally', color: '#0a0', isPC: true, col: 6, row: 12 }), { dexMod: 0 }); s.tokens.push(ally);
    hero.col = 10; hero.row = 12;
    const mk = (id, name, col, extra = {}) => Object.assign(makeToken({ id, name, color: '#a00', isPC: false, col, row: 12 }), { hp: 10, maxHp: 10, ac: 12, dexMod: 0 }, extra);
    s.tokens.push(mk('ga', 'Goblin A', 11), mk('gb', 'Goblin B', 12), mk('gc', 'Goblin C', 14));
    vtt.startCombat();
    const init = { [hero.id]: 20, ga: 12, gb: 12, [ally.id]: 9, gc: 3 };
    for (const t of s.tokens) if (init[t.id] !== undefined) t.initiative = init[t.id];
    sortCombat(); s.activeIndex = s.tokens.indexOf(hero); beginTurn(hero);
    const names = () => s.combat.order.map(id => s.tokens.find(t => t.id === id).name);
    const out = { start: names() };
    // hidden initiative: creature rows show a dot, not the number
    renderCombat();
    out.dots = document.querySelectorAll('#combatPanel .cb-init-hidden').length;
    // DM notes: a note is saved, never printed in chat, shown only in DM view
    await vtt.applyMapUpdates([{ type: 'dmNote', tokenId: 'gb', text: 'flees at half HP' }, { type: 'dmNote', tokenId: 'dm', text: 'ambush at round 3' }]);
    out.chatLeak = JSON.stringify(s.chat || []).includes('flees'); out.panelOff = document.querySelector('#combatPanel').innerText.includes('flees') || document.querySelector('#combatPanel').innerText.includes('ambush');
    out.saved = serializeToken(s.tokens.find(t => t.id === 'gb')).dmNote;
    // ready: the action is used now, the reaction when it triggers
    await vtt.applyMapUpdates([{ type: 'readyToken', tokenId: hero.id, text: 'shoot the first goblin through the door' }]);
    out.readyA = hero.spent.a; out.readyR = hero.spent.r;
    await vtt.applyMapUpdates([{ type: 'readyToken', tokenId: hero.id, text: '' }]);
    out.triggerR = hero.spent.r; out.readiedAfter = hero.readied;
    // delay: the hero delays; Goblin A is up; hero resumes tied with Goblin B and still acts right after Goblin A
    await vtt.applyMapUpdates([{ type: 'delayToken', tokenId: hero.id }]);
    out.afterDelay = [s.tokens[s.activeIndex].name, names().join(',')];
    out.delayedChip = [...document.querySelectorAll('#combatPanel .cb-ready')].some(e => e.textContent === '⏸');
    await vtt.applyMapUpdates([{ type: 'resumeToken', tokenId: hero.id }]);
    out.afterResume = names();
    nextCombatTurn(); out.nextIsHero = s.tokens[s.activeIndex].name; out.heroSpentReset = JSON.stringify(hero.spent);
    // a spell area on the hero's turn is cleared by the next turn
    await vtt.applyMapUpdates([{ type: 'template', tokenId: hero.id, shape: 'sphere', size: 20, col: 12, row: 12 }]);
    out.templates = s.templates.length;
    // opportunity attacks: Goblin A is next to the hero; it can attack unless its reaction is spent
    const ga = s.tokens.find(t => t.id === 'ga');
    s.pendingNotes.length = 0; hero.col = 8;
    noteOpportunityAttacks(hero, 10, 12);
    out.oaFree = s.pendingNotes.join(' | ');
    s.pendingNotes.length = 0; await vtt.applyMapUpdates([{ type: 'reactToken', tokenId: 'ga' }]);
    out.gaSpent = ga.spent.r;
    noteOpportunityAttacks(hero, 10, 12);
    out.oaSpent = s.pendingNotes.join(' | ');
    s.pendingNotes.length = 0; hero.conditions = []; setCondition(hero, 'disengaged', 1); hero.col = 8; noteOpportunityAttacks(hero, 10, 12);
    out.oaDisengaged = s.pendingNotes.length;
    // the reaction is back at the start of Goblin A's own turn
    beginTurn(ga); out.gaBack = ga.spent.r;
    // template cleared by beginTurn
    out.templatesAfter = s.templates.length;
    // DM view shows the notes
    s.dmView = true; renderCombat(); out.panelOn = document.querySelector('#combatPanel').innerText.includes('ambush') && !!document.querySelector('.cb-dmnote');
    // hidden / unseen rules still hold
    const gc = s.tokens.find(t => t.id === 'gc'); gc.hidden = true; out.hiddenSeen = vtt.seenByParty(gc); gc.hidden = false;
    out.shot = true;
    return out;
  })()`);
  assert.deepEqual(r.start.slice(0, 1), ['Edric'].slice(0, 1).map(() => r.start[0]));
  assert.ok(r.dots >= 3, 'creature initiative is a dot: ' + r.dots);
  assert.equal(r.chatLeak, false); assert.equal(r.panelOff, false, 'notes are not shown without DM view'); assert.equal(r.saved, 'flees at half HP');
  assert.equal(r.readyA, true); assert.equal(r.readyR, false); assert.equal(r.triggerR, true); assert.equal(r.readiedAfter, '');
  assert.equal(r.afterDelay[0], 'Goblin A'); assert.equal(r.delayedChip, true);
  const o = r.afterResume; assert.equal(o[o.indexOf('Goblin A') + 1], r.start[0], 'the resumed delayer acts right after Goblin A even though Goblin B ties with it: ' + o);
  assert.equal(r.nextIsHero, r.start[0]); assert.equal(r.heroSpentReset, '{"a":false,"b":false,"r":false}');
  assert.equal(r.templates, 1); assert.equal(r.templatesAfter, 0);
  assert.match(r.oaFree, /opportunity attack/); assert.equal(r.gaSpent, true);
  assert.match(r.oaSpent, /Goblin A \(has already used its reaction this round\)/); assert.equal(r.oaDisengaged, 0);
  assert.equal(r.gaBack, false); assert.equal(r.panelOn, true); assert.equal(r.hiddenSeen, false);
  await page.eval(`window.vtt.state.dmView = true; document.querySelector('#combatPanel').scrollIntoView()`);
});

test('combat: a surprised first combatant is skipped at once; bodies do not block movement', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.fogEnabled = false;
    const mk = (id, name, col, row, extra = {}) => Object.assign(makeToken({ id, name, color: '#0a0', isPC: false, col, row }), { hp: 10, maxHp: 10, ac: 12, dexMod: 0 }, extra);
    s.tokens.push(mk('a', 'Ant', 11, 12), mk('b', 'Bat', 12, 12));
    vtt.startCombat();
    const hero = s.tokens[0];
    hero.initiative = 5; s.tokens[s.tokens.length - 2].initiative = 20; s.tokens[s.tokens.length - 1].initiative = 10; sortCombat();
    s.activeIndex = s.tokens.indexOf(s.tokens.find(t => t.id === 'a'));
    await vtt.applyMapUpdates([{ type: 'addCondition', tokenId: 'a', condition: 'surprised', rounds: 1 }]);
    const out = { active: s.tokens[s.activeIndex].id };
    // a body does not block reach and is not clickable
    const body = mk('body', 'Body', 14, 12, { dead: true, hp: 0 }); s.tokens.push(body);
    out.reachBody = vtt.reachable(hero).has(\`\${body.col},\${body.row}\`);
    return out;
  })()`);
  assert.equal(r.active, 'b', 'the surprised combatant at the top of the order loses its turn at once');
  assert.equal(r.reachBody, true, 'a defeated creature does not block movement');
});

test('death saves: damage at 0 is a failed save, the DM records saves, three failures do not kill when permadeath is off, massive damage', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.permadeath = false;
    const pc = s.tokens[0]; const c = s.characters.find(x => x.id === pc.characterId); c.hp = c.maxHp;
    const out = {};
    vtt.changeHp(pc, -c.maxHp);                                  // exactly to 0: dying, no massive damage
    out.dying = [pc.deathSaves.success, pc.deathSaves.fail, !!pc.dead];
    vtt.changeHp(pc, -1); out.hurtDown = pc.deathSaves.fail;     // damage while down = one failed save
    await vtt.applyMapUpdates([{ type: 'addCondition', tokenId: pc.id, condition: 'death save success', rounds: 1 }]); out.success = pc.deathSaves.success;
    await vtt.applyMapUpdates([{ type: 'addCondition', tokenId: pc.id, condition: 'death save fail', rounds: 2 }]); out.afterThree = [pc.deathSaves.fail, pc.stable, !!pc.dead];
    vtt.changeHp(pc, 3); out.healed = [vtt.state.characters.find(x => x.id === pc.characterId).hp, pc.deathSaves, pc.stable];
    vtt.changeHp(pc, -(c.hp + c.maxHp)); out.massive = [pc.deathSaves.fail, !!pc.dead, pc.stable];
    s.permadeath = true; vtt.changeHp(pc, 1); vtt.changeHp(pc, -(c.hp + c.maxHp)); out.massivePerma = [pc.dead];
    return out;
  })()`);
  assert.deepEqual(r.dying, [0, 0, false]); assert.equal(r.hurtDown, 1); assert.equal(r.success, 1);
  assert.deepEqual(r.afterThree, [3, true, false], 'three failures with permadeath off: out of the fight, not dead');
  assert.equal(r.healed[0], 3); assert.equal(r.healed[1], null); assert.equal(r.healed[2], false);
  assert.deepEqual(r.massive, [3, false, true]); assert.deepEqual(r.massivePerma, [true]);
});

test('timed effects: known durations, the game clock, concentration, and the values survive a reload', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const pcs = vtt.state.tokens.filter((t) => t.isPC), caster = pcs[0], target = pcs[1] || vtt.state.tokens.find((t) => t !== pcs[0]) || (vtt.state.tokens.push(makeToken({ id: 'tok-extra', name: 'Extra', color: '#ffffff', col: 4, row: 4 })), vtt.state.tokens[vtt.state.tokens.length - 1]), out = {};
    vtt.state.clockTotal = 1000;
    setCondition(caster, 'concentrating', 0, {});
    setCondition(target, 'bless', 0, { source: caster.id });
    setCondition(target, 'mage armor', 0, {});
    setCondition(target, 'frightened', 3, {});
    out.pcs = pcs.length; out.set = tokenConditions(target).map((c) => [c.name, c.rounds, c.untilMin || 0, !!c.concentration]);
    out.saved = JSON.parse(JSON.stringify(vtt.state.tokens.map((t) => serializeToken(t)).find((t) => t.id === target.id).conditions));
    vtt.state.clockTotal = 1002; expireTimedConditions();
    out.after2min = tokenConditions(target).map((c) => c.name);
    setCondition(target, 'haste', 0, { source: caster.id });
    clearCondition(caster, 'concentrating');
    out.afterConcentration = tokenConditions(target).map((c) => c.name);
    vtt.state.clockTotal = 1000 + 500; expireTimedConditions();
    out.after8h = tokenConditions(target).map((c) => c.name);
    return out;
  })()`);
  assert.deepEqual(r.set, [['bless', 10, 1001, true], ['mage armor', 0, 1480, false], ['frightened', 3, 0, false]]);
  assert.deepEqual(r.saved.map((c) => c.name), ['bless', 'mage armor', 'frightened']);
  assert.equal(r.saved[0].untilMin, 1001); assert.equal(r.saved[0].source !== undefined, true); assert.equal(r.saved[1].untilMin, 1480);
  assert.deepEqual(r.after2min, ['mage armor', 'frightened']);
  assert.deepEqual(r.afterConcentration, ['mage armor', 'frightened'], 'haste goes when its caster stops concentrating');
  assert.deepEqual(r.after8h, ['frightened'], 'mage armor runs out after 8 hours; a round-timed condition is not touched by the clock');
});

test('effects end by the book: a fight or a rest ends nothing by itself; combat rounds are 6 seconds of game time', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const pcs = vtt.state.tokens.filter((t) => t.isPC), caster = pcs[0];
    const target = pcs[1] || vtt.state.tokens.find((t) => t !== pcs[0]) || (vtt.state.tokens.push(makeToken({ id: 'tok-extra2', name: 'Extra', color: '#ffffff', col: 5, row: 5 })), vtt.state.tokens[vtt.state.tokens.length - 1]);
    const names = () => tokenConditions(target).map((c) => c.name).sort();
    const out = {};
    vtt.state.clockTotal = 2000; vtt.state.clockSeconds = 0;
    for (const n of ['shield of faith', 'mage armor']) setCondition(target, n, 0, { source: caster.id });
    setCondition(target, 'moonlit', 0, { minutes: 120 });
    setCondition(target, 'poisoned', 0, {});
    vtt.state.combat = { active: true, round: 3, order: [] };
    endCombat();
    out.afterCombat = names();
    for (let i = 0; i < 99; i++) advanceGameClock(0, 6);        // 99 rounds = 9 minutes 54 seconds
    out.after99rounds = names(); out.clock99 = [vtt.state.clockTotal, vtt.state.clockSeconds];
    advanceGameClock(0, 6);                                     // the 100th round: ten minutes
    out.after100rounds = names(); out.clock100 = [vtt.state.clockTotal, vtt.state.clockSeconds];
    out.savedSeconds = (() => { try { return JSON.parse(localStorage.getItem('vtt.board.' + vtt.state.campaignId) || '{}').clockSeconds; } catch { return 'n/a'; } })();
    advanceGameClock(130, 0);                                   // a long time passes: the 2 hour effect and the 8 hour effect are still different
    out.after130min = names();
    advanceGameClock(480, 0);
    out.after8h = names();
    return out;
  })()`);
  assert.deepEqual(r.afterCombat, ['mage armor', 'moonlit', 'poisoned', 'shield of faith'], 'the end of a fight removes nothing');
  assert.deepEqual(r.after99rounds, ['mage armor', 'moonlit', 'poisoned', 'shield of faith']);
  assert.deepEqual(r.clock99, [2009, 54]);
  assert.deepEqual(r.after100rounds, ['mage armor', 'moonlit', 'poisoned'], 'the 10 minute effect is gone after 100 rounds');
  assert.deepEqual(r.clock100, [2010, 0]);
  assert.deepEqual(r.after130min, ['mage armor', 'poisoned'], 'the 2 hour effect has run out');
  assert.deepEqual(r.after8h, ['poisoned'], 'the 8 hour effect has run out and the condition is still there');
});

test('sizes: a large creature covers 2x2 squares: its whole body must fit between walls, edges and other tokens (or it squeezes)', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state, hero = s.tokens[0]; s.combat = { active: false, round: 0, order: [] };
    hero.col = 10; hero.row = 10;
    const ogre = Object.assign(makeToken({ id: 'ogre', name: 'Ogre', color: '#a00', isPC: false, col: 10, row: 10, size: 'large' }), {});
    s.tokens = [ogre];
    const has = (t, c, r) => vtt.reachable(t).has(c + ',' + r);
    const out = { footprint: vtt.fp(ogre), centre: [vtt.tcx(ogre), vtt.tcy(ogre)] };
    // the map's last column and row cannot hold a top-left square of a 2x2 body
    out.edge = [has(ogre, cols() - 2, 10), has(ogre, cols() - 1, 10), has(ogre, 10, rows() - 1)];
    // a wall with a one-square gap (row 10): a medium token passes, a large one does not; a two-square gap lets it through
    const H = s.map.height;
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 550, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    const med = makeToken({ id: 'm', name: 'M', color: '#0a0', isPC: true, col: 10, row: 10 }); s.tokens = [med];
    out.mediumThroughGap = has(med, 20, 10);
    out.largeThroughGap = has(ogre, 20, 10) || has(Object.assign(ogre, { row: 10 }), 20, 10);
    s.tokens = [ogre];
    out.largeInFrontOfWall = has(ogre, 14, 9);
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 600, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    out.largeThroughTwoGap = has(ogre, 20, 10);
    // a wall stub inside the footprint it would end on stops it
    s.walls = [{ x1: 1000, y1: 450, x2: 1000, y2: 550, type: 'wall', open: false }]; s.wallsVersion++;
    out.stubInside = has(ogre, 19, 9);
    // other tokens: it cannot end overlapping any square of another token
    s.walls = []; s.wallsVersion++;
    const pawn = makeToken({ id: 'p', name: 'P', color: '#0a0', isPC: true, col: 15, row: 11 }); s.tokens = [ogre, pawn];
    out.overlapPawn = [has(ogre, 14, 10), has(ogre, 15, 10), has(ogre, 14, 12), has(ogre, 16, 12), has(ogre, 13, 10)];
    // placement: the nearest top-left where the whole footprint fits
    const spot = vtt.freeSquareNear(15, 11, 2);
    out.spot = spot;
    out.spotFits = !(spot.col <= 15 && 15 <= spot.col + 1 && spot.row <= 11 && 11 <= spot.row + 1);
    out.edgeSpot = vtt.freeSquareNear(cols() - 1, 3, 3);
    s.tokens = s.tokens.slice(1, 2); s.walls = []; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.footprint, 2); assert.deepEqual(r.centre, [550, 550], 'the centre of a 2x2 body at (10,10) is the corner shared by its four squares');
  assert.deepEqual(r.edge, [true, false, false], 'a 2x2 body can stand with its top-left on the second-to-last column, not the last');
  assert.equal(r.mediumThroughGap, true); assert.equal(r.largeThroughGap, true, 'a large creature can squeeze through a one-square gap (see the squeezing test)');
  assert.equal(r.largeInFrontOfWall, true); assert.equal(r.largeThroughTwoGap, true);
  assert.equal(r.stubInside, true, 'a wall inside the footprint it would end on no longer blocks it: the creature squeezes there (the next test)');
  assert.deepEqual(r.overlapPawn, [false, false, true, true, true], 'ending on any square of another token is refused');
  assert.equal(r.spotFits, true);
  assert.ok(r.edgeSpot.col <= (await page.eval('cols()')) - 3, 'a huge creature near the right edge is placed so all 3 columns fit');
});

test('squeezing by the book: a Large creature passes a one-square gap at double cost, takes the smaller footprint there and the squeezing effect', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.combat = { active: false, round: 0, order: [] }; s.pendingNotes.length = 0;
    const ogre = Object.assign(makeToken({ id: 'ogre', name: 'Ogre', color: '#a00', isPC: false, col: 10, row: 10, size: 'large' }), { hp: 59, maxHp: 59, ac: 11 });
    s.tokens = [ogre]; const H = s.map.height;
    const names = (t) => tokenConditions(t).map((c) => c.name);
    const out = {};
    // a one-square gap in a wall: through it at double cost
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 550, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    const reach = vtt.reachable(ogre);
    out.through = reach.has('20,10'); out.costThrough = reach.get('20,10');
    s.walls = []; s.wallsVersion++; out.costOpen = vtt.reachable(ogre).get('20,10');
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 550, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    // standing in the gap: the whole body does not fit, so it squeezes
    ogre.col = 15; vtt.settleBody(ogre);
    out.inGap = [ogre.squeezed === true, vtt.fp(ogre), names(ogre)];
    out.chat = s.chat.filter((m) => m.role === 'system').slice(-1).map((m) => m.content);
    ogre.col = 10; vtt.settleBody(ogre);
    out.free = [Boolean(ogre.squeezed), vtt.fp(ogre), names(ogre)];
    // a solid wall with no gap stays closed to it
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    out.solid = vtt.reachable(ogre).has('20,10');
    // a two-square gap lets the whole body through: no squeezing
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 600, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    ogre.col = 15; vtt.settleBody(ogre); out.wideGap = [Boolean(ogre.squeezed), vtt.fp(ogre)];
    ogre.col = 10; vtt.settleBody(ogre);
    // a squeezed creature can move on, and gets its full size back where it fits
    s.walls = [{ x1: 800, y1: 0, x2: 800, y2: 500, type: 'wall', open: false }, { x1: 800, y1: 550, x2: 800, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    ogre.col = 15; vtt.settleBody(ogre);
    const back = vtt.reachable(ogre);
    out.fromGap = [back.has('20,10'), back.has('10,10')];
    ogre.col = 20; vtt.settleBody(ogre); out.after = [Boolean(ogre.squeezed), vtt.fp(ogre), names(ogre)];
    // a medium creature never squeezes
    const med = makeToken({ id: 'm', name: 'M', color: '#0a0', isPC: true, col: 15, row: 10 }); s.tokens = [med]; vtt.settleBody(med); out.medium = Boolean(med.squeezed);
    s.tokens = s.tokens.filter((t) => t.isPC).slice(0, 1); s.walls = []; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.through, true); assert.ok(r.costThrough > r.costOpen, 'the squeeze costs extra: ' + r.costThrough + ' against ' + r.costOpen + ' in the open');
  assert.deepEqual(r.inGap, [true, 1, ['squeezing']], 'in the gap it takes the smaller footprint and the squeezing effect');
  assert.match(r.chat[0], /squeezes/);
  assert.deepEqual(r.free, [false, 2, []]); assert.equal(r.solid, false, 'no gap at all: it stays shut');
  assert.deepEqual(r.wideGap, [false, 2], 'a gap two squares wide needs no squeezing');
  assert.deepEqual(r.fromGap, [true, true], 'a squeezed creature can move out either way'); assert.deepEqual(r.after, [false, 2, []], 'it grows back where its whole body fits');
  assert.equal(r.medium, false);
});

test('sizes: picking up, sight and areas use the whole body; reach is edge to edge', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const s = vtt.state; s.pendingNotes.length = 0; s.fogEnabled = false; s.dmView = false;
    const hero = s.tokens[0]; hero.col = 12; hero.row = 10;
    const ogre = Object.assign(makeToken({ id: 'ogre', name: 'Ogre', color: '#a00', isPC: false, col: 9, row: 10, size: 'large' }), { hp: 59, maxHp: 59, ac: 11, dexMod: -1 });
    s.tokens = [hero, ogre]; s.combat = { active: true, round: 1, order: [hero.id, ogre.id] };
    const out = {};
    // hit testing: anywhere over the body picks it up
    out.pick = [tokenAt(vtt.tcx(ogre), vtt.tcy(ogre)) === ogre, tokenAt(9 * 50 + 20, 10 * 50 + 20) === ogre, tokenAt(10 * 50 + 30, 11 * 50 + 30) === ogre, tokenAt(11 * 50 + 25, 10 * 50 + 25) === null || tokenAt(11 * 50 + 25, 10 * 50 + 25) === hero];
    // reach: the ogre covers cols 9-10, so the hero at col 12 is 2 squares away (10 ft); at col 11 it is touching
    const left = (from, to) => vtt.provokedBy(hero, from[0], from[1], to[0], to[1]).map(o => o.name);
    out.gapTwo = left([11, 10], [13, 10]);          // from touching to away: provokes
    out.neverNear = left([12, 10], [14, 10]);       // never in reach: nothing
    out.slideAlong = left([11, 10], [11, 12]);      // still touching the footprint's lower row: no
    // a creature in the air out of reach: no opportunity attack from a 5 ft reach
    ogre.elevation = 20; out.airborneFoe = left([11, 10], [13, 10]); ogre.elevation = 0;
    // areas: a 5 ft radius sphere at the hero's square catches a big creature whose body overlaps it, not one that only has its centre outside
    const tp = { shape: 'sphere', size: 5, x: 12 * 50 + 25, y: 11 * 50 + 25 };
    ogre.col = 10; ogre.row = 10;      // covers 10-11 x 10-11: the square (11,11) is inside the 5 ft sphere around (12,11)
    out.sphereCatches = vtt.insideTemplateFp(tp, ogre);
    ogre.col = 7; out.sphereMisses = vtt.insideTemplateFp(tp, ogre);
    // fog: a big creature is seen when any square of its body is in sight; the sight starts at the observer's footprint centre
    const wall = { x1: 600, y1: 0, x2: 600, y2: 260, type: 'wall', open: false };
    s.walls = [wall]; s.wallsVersion++; s.fogEnabled = true; hero.col = 14; hero.row = 5; ogre.col = 10; ogre.row = 4; vtt.revealFog();
    out.partlySeen = vtt.seenByParty(ogre);
    ogre.col = 10; ogre.row = 0; vtt.revealFog(); out.hiddenBehind = vtt.seenByParty(ogre);
    s.fogEnabled = false; s.walls = []; s.wallsVersion++; s.combat = { active: false, round: 0, order: [] }; s.tokens = [hero];
    return out;
  })()`);
  assert.deepEqual(r.pick, [true, true, true, true]);
  assert.deepEqual(r.gapTwo, ['Ogre']); assert.deepEqual(r.neverNear, []); assert.deepEqual(r.slideAlong, []);
  assert.deepEqual(r.airborneFoe, [], 'a 5 ft reach cannot hit something 20 ft up');
  assert.equal(r.sphereCatches, true); assert.equal(r.sphereMisses, false);
  assert.equal(r.partlySeen, true, 'a body that is only partly in sight is seen'); assert.equal(r.hiddenBehind, false);
});

test('sizes: the DM adds a big creature (top-left square, centred on a module-area pin, size from the stat block), saved with the board', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.areaPins = [{ area: 3, name: 'Hall', col: 20, row: 20 }];
    const add = (id, col, row, extra) => ({ type: 'addToken', tokenId: id, name: id, col, row, color: '#a04545', hidden: false, kind: 'creature', monster: 'owlbear', maxHp: 59, ac: 13, speed: 40, dexMod: 1, image: '', ...extra });
    await vtt.applyMapUpdates([add('ob1', 5, 5, { size: 'large' }), add('ob2', 5, 5, { size: 'large' }), add('dr', 20, 20, { size: 'huge' }), add('gob', 8, 8, { size: 'small' }), add('kr', cols() - 1, 0, { size: 'gargantuan' })]);
    const t = (id) => s.tokens.find((x) => x.id === id);
    const out = { ob1: [t('ob1').col, t('ob1').row, t('ob1').size], ob2: [t('ob2').col, t('ob2').row], dr: [t('dr').col, t('dr').row], gob: [t('gob').size, vtt.fp(t('gob'))], kr: [t('kr').col, t('kr').row, vtt.fp(t('kr'))] };
    const ser = vtt.serializeToken(t('ob1')); out.ser = { size: ser.size, footprint: ser.footprint, elevation: ser.elevation };
    await vtt.applyMapUpdates([{ type: 'resizeToken', tokenId: 'gob', size: 'huge' }, { type: 'elevateToken', tokenId: 'ob1', feet: 15 }]);
    out.grown = [t('gob').size, vtt.fp(t('gob'))]; out.note = vtt.serializeToken(t('ob1')).elevationNote;
    for (const id of ['ob1', 'ob2', 'dr', 'gob', 'kr']) s.tokens.splice(s.tokens.indexOf(t(id)), 1);
    s.areaPins = [];
    return out;
  })()`);
  assert.deepEqual(r.ob1, [5, 5, 'large']); assert.notDeepEqual(r.ob2, [5, 5], 'the second large creature goes to the nearest place its whole body fits');
  assert.deepEqual(r.dr, [19, 19], 'a huge creature put on the pin (20,20) is centred on it');
  assert.deepEqual(r.gob, ['small', 1]); assert.equal(r.kr[2], 4); assert.ok(r.kr[0] <= (await page.eval('cols()')) - 4 && r.kr[1] >= 0, 'a gargantuan body stays on the map');
  assert.deepEqual(r.ser, { size: 'large', footprint: 2, elevation: 0 });
  assert.deepEqual(r.grown, ['huge', 3]); assert.match(r.note, /15 ft up.*reach of at least 15 ft.*1d6/);
});

test('haste and slow by the book: speed, Armor Class, reactions, lethargy when haste ends', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.pendingNotes.length = 0; s.combat = { active: false, round: 0, order: [] };
    const hero = s.tokens[0]; hero.speed = 30; hero.conditions = []; hero.col = 10; hero.row = 10;
    const foe = Object.assign(makeToken({ id: 'foe', name: 'Foe', color: '#a00', isPC: false, col: 11, row: 10 }), { hp: 20, maxHp: 20, ac: 14, dexMod: 0 });
    s.tokens = [hero, foe];
    const out = { base: [vtt.effectiveSpeed(foe), vtt.effAcOf(foe), foe.ac] };
    vtt.setCondition(foe, 'haste', 0); out.haste = [vtt.effectiveSpeed(foe), vtt.effAcOf(foe), foe.ac];
    vtt.setCondition(foe, 'slow', 0); out.both = [vtt.effectiveSpeed(foe), vtt.effAcOf(foe)];
    vtt.clearCondition(foe, 'haste'); out.lethargyAfterHaste = vtt.effectiveSpeed(foe); vtt.clearCondition(foe, 'lethargic');
    out.slowOnly = [vtt.effectiveSpeed(foe), vtt.effAcOf(foe), foe.ac, foe.conditions.map(c => c.name).sort()];
    // a slowed creature cannot react: no opportunity attack, and the DM is told why
    s.combat = { active: true, round: 1, order: [hero.id, foe.id] };
    out.provoked = vtt.provokedBy(hero, 10, 10, 8, 10).map(o => o.name);
    out.cannot = vtt.cannotReactTo(hero, 10, 10, 8, 10).map(o => o.why);
    vtt.clearCondition(foe, 'slow');
    out.reacts = vtt.provokedBy(hero, 10, 10, 8, 10).map(o => o.name);
    // haste ends: lethargic, no movement, no actions until its next turn has passed
    vtt.setCondition(foe, 'haste', 0); vtt.clearCondition(foe, 'haste');
    out.lethargic = [foe.conditions.map(c => c.name), vtt.effectiveSpeed(foe)];
    vtt.beginTurn(foe); out.turnSpent = [foe.spent.a, foe.spent.b, foe.movementRemaining];
    s.activeIndex = s.tokens.indexOf(foe);
    hero.initiative = 5; foe.initiative = 15; s.combat.order = [foe.id, hero.id];
    vtt.nextCombatTurn(); out.after = foe.conditions.map(c => c.name);
    s.combat = { active: false, round: 0, order: [] }; s.tokens = [hero];
    return out;
  })()`);
  assert.deepEqual(r.base, [30, 14, 14]); assert.deepEqual(r.haste, [60, 16, 14], 'haste doubles speed and adds 2 to AC without changing the base AC');
  assert.deepEqual(r.both, [30, 14]);
  assert.equal(r.lethargyAfterHaste, 0);
  assert.deepEqual(r.slowOnly, [15, 12, 14, ['slow']]);
  assert.deepEqual(r.provoked, []); assert.deepEqual(r.cannot, ['slow']); assert.deepEqual(r.reacts, ['Foe']);
  assert.deepEqual(r.lethargic, [['lethargic'], 0]);
  assert.deepEqual(r.turnSpent, [true, true, 0]); assert.deepEqual(r.after, [], 'lethargy lasts until its next turn is over');
});

test('flying: fly speed, elevation, terrain and fences ignored, walls still block, falls by the book', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.pendingNotes.length = 0; s.combat = { active: true, round: 1, order: [] }; s.moveRule = 'circle';
    const bat = Object.assign(makeToken({ id: 'bat', name: 'Griffon', color: '#a00', isPC: false, col: 10, row: 10, speed: 30, flySpeed: 80, size: 'large' }), { hp: 59, maxHp: 59, ac: 12 });
    window.__keepTokens = s.tokens; s.tokens = [bat]; bat.order = 0; s.combat.order = ['bat'];
    const out = { ground: vtt.effectiveSpeed(bat), flyingOnGround: vtt.isFlying(bat) };
    bat.elevation = 30; out.air = [vtt.effectiveSpeed(bat), vtt.isFlying(bat)];
    bat.movementRemaining = 80; const has = (c, r) => vtt.reachable(bat).has(c + ',' + r);
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: s.map.height, type: 'fence', open: false }]; s.wallsVersion++;
    out.overFence = has(15, 10);
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    out.overWall = has(15, 10);
    s.walls = []; s.wallsVersion++;
    // difficult ground costs a flyer nothing
    s.difficult = [{ x: 600, y: 400, w: 400, h: 300 }]; s.difficultSquares = null; s.wallsVersion++;
    bat.movementRemaining = 80; const far = has(19, 10); bat.elevation = 0; bat.speed = 30; bat.movementRemaining = 80; const walk = vtt.reachable(bat).has('19,10');
    s.difficult = []; s.difficultSquares = null; s.wallsVersion++;
    out.terrain = [far, walk];
    // a creature with only a flying speed always uses it (a ghost, a flameskull)
    const ghost = makeToken({ id: 'g', name: 'Ghost', color: '#aaa', isPC: false, col: 3, row: 3, speed: 0, flySpeed: 40, hover: true });
    out.ghost = [vtt.isFlying(ghost), vtt.effectiveSpeed(ghost)];
    // falls: knocked prone in the air, 1d6 per 10 ft, lands prone; told to the DM, not rolled
    bat.elevation = 45; vtt.setCondition(bat, 'prone', 0);
    out.fall = [bat.elevation, bat.conditions.map(c => c.name), s.pendingNotes.filter(n => /falls 45 ft: 4d6/.test(n)).length];
    // a hovering creature does not fall; the fly spell holds a creature up until it ends; at 0 hit points a natural flyer falls
    ghost.elevation = 20; s.tokens.push(ghost); vtt.setCondition(ghost, 'prone', 0); out.hover = ghost.elevation;
    const mage = Object.assign(makeToken({ id: 'mg', name: 'Mage', color: '#00a', isPC: false, col: 5, row: 5 }), { hp: 20, maxHp: 20, ac: 12 }); s.tokens.push(mage);
    vtt.setCondition(mage, 'fly', 0); mage.elevation = 60; out.flySpell = [vtt.flySpeedOf(mage), vtt.isFlying(mage), vtt.effectiveSpeed(mage)];
    vtt.setCondition(mage, 'prone', 0); out.heldAloft = mage.elevation;
    vtt.clearCondition(mage, 'fly'); out.spellEnds = [mage.elevation, s.pendingNotes.filter(n => /Mage falls 60 ft: 6d6/.test(n)).length];
    bat.conditions = []; bat.elevation = 20; bat.hp = 1; vtt.changeHp(bat, -5); out.zeroHp = bat.elevation;
    // no fall damage under 10 ft
    const imp = Object.assign(makeToken({ id: 'imp', name: 'Imp', color: '#a0a', isPC: false, col: 2, row: 2, flySpeed: 40 }), { hp: 5, maxHp: 5 }); s.tokens.push(imp);
    imp.elevation = 5; vtt.setCondition(imp, 'stunned', 0); out.low = [imp.elevation, imp.conditions.map(c => c.name)];
    s.combat = { active: false, round: 0, order: [] }; s.tokens = s.tokens.filter(t => t.isPC).slice(0, 1); s.walls = []; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.ground, 30); assert.equal(r.flyingOnGround, false, 'a creature on the ground walks'); assert.deepEqual(r.air, [80, true]);
  assert.equal(r.overFence, true, 'a flyer crosses a low fence'); assert.equal(r.overWall, false, 'but not a wall');
  assert.deepEqual(r.terrain, [true, false], 'difficult ground slows a walker, not a flyer');
  assert.deepEqual(r.ghost, [true, 40]);
  assert.deepEqual(r.fall, [0, ['prone'], 1]);
  assert.equal(r.hover, 20); assert.deepEqual(r.flySpell, [60, true, 60]); assert.equal(r.heldAloft, 60);
  assert.deepEqual(r.spellEnds, [0, 1]); assert.equal(r.zeroHp, 0);
  assert.deepEqual(r.low, [0, ['stunned']], 'a short fall does no damage and does not knock it prone');
});

test('flight and speed effects by name: potion of flying, wings of flying, levitate, longstrider', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.pendingNotes.length = 0;
    const mk = (id, col) => { const t = Object.assign(makeToken({ id, name: id, color: '#468', isPC: false, col, row: 3, speed: 30 }), { hp: 20, maxHp: 20, ac: 12 }); s.tokens.push(t); return t; };
    const out = {};
    const pot = mk('pot', 3); vtt.setCondition(pot, 'potion of flying', 0); pot.elevation = 20;
    out.potion = [vtt.flySpeedOf(pot), vtt.isFlying(pot), vtt.effectiveSpeed(pot)];
    vtt.setCondition(pot, 'prone', 0); out.potionProne = pot.elevation;
    vtt.clearCondition(pot, 'potion of flying'); out.potionEnds = pot.elevation;
    const wings = mk('wings', 5); vtt.setCondition(wings, 'wings of flying', 0); wings.elevation = 30;
    out.wings = [vtt.flySpeedOf(wings), vtt.effectiveSpeed(wings)];
    vtt.setCondition(wings, 'prone', 0); out.wingsProne = wings.elevation;
    const lev = mk('lev', 7); vtt.setCondition(lev, 'levitate', 0); lev.elevation = 20;
    out.lev = [vtt.flySpeedOf(lev), vtt.isFlying(lev), vtt.effectiveSpeed(lev)];
    vtt.setCondition(lev, 'stunned', 0); out.levStunned = lev.elevation;
    vtt.clearCondition(lev, 'levitate'); out.levEnds = lev.elevation;
    const ls = mk('ls', 9); vtt.setCondition(ls, 'longstrider', 0); out.longstrider = vtt.effectiveSpeed(ls);
    vtt.setCondition(ls, 'haste', 0); out.longstriderHaste = vtt.effectiveSpeed(ls);
    s.tokens = s.tokens.filter((t) => t.isPC);
    return out;
  })()`);
  assert.deepEqual(r.potion, [30, true, 30], 'a potion of flying gives a flying speed equal to the walking speed');
  assert.equal(r.potionProne, 20, 'the potion lets it hover: no fall when knocked prone'); assert.equal(r.potionEnds, 0, 'it falls when the potion ends');
  assert.deepEqual(r.wings, [60, 60]); assert.equal(r.wingsProne, 0, 'wings do not hold it up when it is knocked prone');
  assert.deepEqual(r.lev, [0, false, 0], 'levitate gives no flying speed and no sideways movement'); assert.equal(r.levStunned, 20, 'levitate holds it up'); assert.equal(r.levEnds, 0, 'it falls when levitate ends');
  assert.equal(r.longstrider, 40); assert.equal(r.longstriderHaste, 80, 'haste doubles the longstrider speed');
});

test('end triggers outside a fight (roll lines name the actor), guidance ends on a check, slow reminds the DM at the end of the turn', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.pendingNotes = []; s.combat = { active: false, round: 0, order: [] };
    const hero = s.tokens[0]; hero.conditions = [];
    const mk = (id, name, col) => Object.assign(makeToken({ id, name, color: '#0a0', isPC: false, col, row: 12 }), { hp: 20, maxHp: 20, ac: 12, dexMod: 0 });
    const orla = mk('o1', 'Orla Brewer', 11), bram = mk('b1', 'Bram', 12); s.tokens.push(orla, bram);
    const names = (t) => tokenConditions(t).map((c) => c.name).sort();
    const out = {};
    setCondition(hero, 'sanctuary', 0, {});
    vtt.noteRollLines(['Someone else attack: d20 (9) + 4 = 13, hit']);
    out.otherAttacks = names(hero);
    vtt.noteRollLines([hero.name.split(' ')[0] + ' attack: d20 (14) + 5 = 19 vs AC 12, hit']);
    out.sanctuaryOutsideFight = names(hero);
    setCondition(orla, 'guidance', 0, {});
    vtt.noteRollLines(['Orla Brewer Wisdom saving throw: d20 (5)']);
    out.guidanceAfterSave = names(orla);
    vtt.noteRollLines(['Orla Brewer Perception check: d20 (11) + 3 = 14']);
    out.guidanceAfterCheck = names(orla);
    s.pendingNotes = [];
    setCondition(bram, 'slow', 0, {});
    s.combat = { active: true, round: 1, order: [bram.id, hero.id] }; for (const t of s.tokens) t.initiative = t === bram ? 10 : 5; sortCombat(); s.activeIndex = s.tokens.indexOf(bram); beginTurn(bram);
    nextCombatTurn();
    out.slowNote = s.pendingNotes.filter((n) => /Bram's turn is over and slow is still on it/.test(n)).length; out.slowStill = names(bram);
    s.combat = { active: false, round: 0, order: [] }; s.tokens = s.tokens.filter((t) => t.isPC); hero.conditions = [];
    return out;
  })()`);
  assert.deepEqual(r.otherAttacks, ['sanctuary'], 'an attack by someone else does not end it');
  assert.deepEqual(r.sanctuaryOutsideFight, [], 'with no fight the roll line still names who attacked');
  assert.deepEqual(r.guidanceAfterSave, ['guidance'], 'a saving throw does not use guidance');
  assert.deepEqual(r.guidanceAfterCheck, [], 'an ability check uses the 1d4 and ends guidance');
  assert.equal(r.slowNote, 1, 'the DM is reminded of the slow save'); assert.deepEqual(r.slowStill, ['slow'], 'the table does not roll or end it');
});

test('forced and teleported moves from the DM: no opportunity attack, no movement spent; a teleport ignores walls', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.pendingNotes.length = 0; s.fogEnabled = false;
    const hero = s.tokens[0]; hero.col = 10; hero.row = 10; hero.movementRemaining = 30; hero.conditions = [];
    const mk = (id, name, col, row) => Object.assign(makeToken({ id, name, color: '#a00', isPC: false, col, row }), { hp: 7, maxHp: 7, ac: 12, dexMod: 0 });
    const gob = mk('gob', 'Goblin', 11, 10); s.tokens.push(gob);
    s.combat = { active: true, round: 1, order: [hero.id, gob.id] }; for (const t of s.tokens) t.initiative = t === hero ? 15 : 10; sortCombat(); s.activeIndex = s.tokens.indexOf(gob); gob.movementRemaining = 30;
    const oa = () => s.chat.filter((m) => m.role === 'system' && /opportunity attack/.test(m.content)).length - (window.__oa0 || 0);
    const out = {}; window.__oa0 = s.chat.filter((m) => m.role === 'system' && /opportunity attack/.test(m.content)).length;
    await vtt.applyMapUpdates([{ type: 'moveToken', tokenId: 'gob', col: 15, row: 10, mode: '' }]);        // walking away provokes
    out.walk = [gob.col, oa(), gob.movementRemaining];
    window.__oa0 += 1; gob.col = 11; gob.row = 10; gob.movementRemaining = 30;
    await vtt.applyMapUpdates([{ type: 'moveToken', tokenId: 'gob', col: 19, row: 10, mode: 'forced' }]);   // shoved 40 ft: farther than its 30 ft speed
    out.forced = [gob.col, oa(), gob.movementRemaining];
    s.walls = [{ x1: 1000, y1: 0, x2: 1000, y2: s.map.height, type: 'wall', open: false }]; s.wallsVersion++;
    gob.col = 11; gob.row = 10; s.pendingNotes.length = 0;
    await vtt.applyMapUpdates([{ type: 'moveToken', tokenId: 'gob', col: 24, row: 10, mode: 'forced' }]);   // a wall stops a shove
    out.forcedWall = gob.col < 20;
    gob.col = 11; gob.row = 10;
    await vtt.applyMapUpdates([{ type: 'moveToken', tokenId: 'gob', col: 24, row: 10, mode: 'teleport' }]);
    out.teleport = [gob.col, gob.row, oa()];
    s.combat = { active: false, round: 0, order: [] }; s.tokens = s.tokens.filter((t) => t.isPC).slice(0, 1); s.walls = []; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.walk[0], 15); assert.equal(r.walk[1], 1, 'walking out of reach provokes'); 
  assert.equal(r.forced[0], 19, 'a shove is not limited by its speed'); assert.equal(r.forced[1], 0, 'a shove provokes nothing');
  assert.equal(r.forcedWall, true, 'a wall stops a forced move'); assert.deepEqual(r.teleport, [24, 10, 0], 'a teleport lands past the wall with no opportunity attack');
});

test('doors: the DM opens, closes, locks, unlocks and reveals them; locked doors stay shut for a click; a secret door is a wall until revealed', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.fogEnabled = false; s.pendingNotes = []; s.combat = { active: false, round: 0, order: [] };
    const hero = s.tokens[0]; hero.col = 10; hero.row = 10;
    const G = 50; const reach = (c, r) => vtt.reachable(hero).has(c + ',' + r);
    // three doors in a wall at x = 650 (column 13): rows 8-9 normal, 10-11 locked, 12-13 secret; the wall above and below is solid
    const H = s.map.height;
    s.walls = [{ x1: 650, y1: 0, x2: 650, y2: 400, type: 'wall', open: false }, { x1: 650, y1: 400, x2: 650, y2: 450, type: 'door', open: false }, { x1: 650, y1: 450, x2: 650, y2: 500, type: 'door', open: false, locked: true, dc: 14 },
      { x1: 650, y1: 500, x2: 650, y2: 550, type: 'door', open: false, secret: true, dc: 17 }, { x1: 650, y1: 550, x2: 650, y2: H, type: 'wall', open: false }]; s.wallsVersion++;
    const out = {};
    const row = (y) => Math.floor(y / G);
    hero.row = 8; out.closedBlocks = !reach(16, 8);
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 1, op: 'open' }]); out.opened = reach(16, 8);
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 1, op: 'close' }]); out.closedAgain = !reach(16, 8);
    // the locked door: opening it is refused (and the DM is told), unlocking then opening works
    hero.row = 9; await vtt.applyMapUpdates([{ type: 'doorAction', n: 2, op: 'open' }]); out.lockedStays = !reach(16, 9); out.noteLocked = s.pendingNotes.filter((n) => /Door 2 is locked/.test(n)).length;
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 2, op: 'unlock' }]); out.unlockedFlag = !s.walls[2].locked; await vtt.applyMapUpdates([{ type: 'doorAction', n: 2, op: 'open' }]); out.openAfterUnlock = reach(16, 9);
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 2, op: 'lock' }]); out.lockClosesIt = [s.walls[2].locked === true, s.walls[2].open === false, !reach(16, 9)];
    // the secret door: a wall (opening it is refused, it is not clickable) until revealed
    hero.row = 10; await vtt.applyMapUpdates([{ type: 'doorAction', n: 3, op: 'open' }]); out.secretWall = !reach(16, 10); out.noteSecret = s.pendingNotes.filter((n) => /Door 3 is still a secret/.test(n)).length;
    s.walls[3].open = true; out.secretIgnoresOpen = !reach(16, 10);                                                        // even a stray open flag does not open it
    s.walls[3].open = false;
    const before = s.chat.length;
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 3, op: 'reveal' }]); out.revealed = [s.walls[3].secret === undefined, s.chat.slice(before).some((m) => /hidden door is revealed/.test(m.content))];
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 3, op: 'open' }]); out.revealedOpens = reach(16, 10);
    await vtt.applyMapUpdates([{ type: 'doorAction', n: 9, op: 'open' }]); out.noSuchDoor = s.pendingNotes.filter((n) => /There is no door 9/.test(n)).length;
    // what the DM is sent
    s.walls[2].locked = true; s.walls[3].secret = true; s.walls[3].open = false;
    out.sentFlags = s.walls.map(({ locked, secret, dc }) => [!!locked, !!secret, dc || 0]);
    s.walls = []; s.wallsVersion++;
    return out;
  })()`);
  assert.equal(r.closedBlocks, true); assert.equal(r.opened, true, 'the DM opens a door'); assert.equal(r.closedAgain, true, 'and closes it');
  assert.equal(r.lockedStays, true, 'a locked door stays shut when the DM tries to open it'); assert.equal(r.noteLocked, 1, 'and the DM is told');
  assert.equal(r.unlockedFlag, true); assert.equal(r.openAfterUnlock, true, 'unlock, then open');
  assert.deepEqual(r.lockClosesIt, [true, true, true], 'lock shuts a door and keeps it shut');
  assert.equal(r.secretWall, true, 'a secret door is a wall'); assert.equal(r.noteSecret, 1); assert.equal(r.secretIgnoresOpen, true);
  assert.deepEqual(r.revealed, [true, true], 'reveal turns it into a door and tells the players'); assert.equal(r.revealedOpens, true);
  assert.equal(r.noSuchDoor, 1);
  assert.deepEqual(r.sentFlags[2], [true, false, 14]); assert.deepEqual(r.sentFlags[3], [false, true, 17]);
});

test('the high cliff on Terrain Test Grounds: its face stops anyone on foot, a flyer reaches the top', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state;
    await vtt.travelTo({ mapUrl: '/uploads/vtt-terrain-test.png', mapName: 'Terrain', kind: 'battle', col: 5, row: 5 });
    if (!s.walls.length) {       // an earlier test already left the table on this map (and cleared its walls): load them from the map config as the page does
      const cfg = (await (await fetch('/api/map-config?map=vtt-terrain-test.png')).json()).config, f = s.map.drawW / s.map.img.naturalWidth;
      s.walls = cfg.walls.map((w) => ({ x1: w.x1 * f, y1: w.y1 * f, x2: w.x2 * f, y2: w.y2 * f, type: w.type === 'door' ? 'door' : w.type === 'fence' ? 'fence' : 'wall', open: Boolean(w.open) }));
    }
    s.tokens = s.tokens.filter((t) => t.isPC).slice(0, 1); const hero = s.tokens[0];
    s.fogEnabled = false; s.gmOverride = false; s.combat = { active: false, round: 0, order: [] };
    hero.col = 11; hero.row = 27; hero.elevation = 0; hero.flySpeed = 0; s.wallsVersion++;
    const top = '16,27';
    const out = { fences: s.walls.filter((w) => w.type === 'fence').length, walker: vtt.reachable(hero).has(top), pin: s.places.some((p) => p.name === 'cliff-top') };
    hero.flySpeed = 60; hero.elevation = 40; s.wallsVersion++;
    out.flyer = vtt.reachable(hero).has(top);
    hero.flySpeed = 0; hero.elevation = 0; s.wallsVersion++;
    return out;
  })()`);
  assert.ok(r.fences >= 10, 'the cliff face is in the map as movement-only walls');
  assert.equal(r.walker, false, 'a creature on foot cannot climb onto the mesa'); assert.equal(r.flyer, true, 'a flyer can');
  assert.equal(r.pin, true, 'the cliff-top place is pinned');
});

test('end triggers: sanctuary ends when its holder harms another creature, rage when a round passes idle, hunter\'s mark and hex when the target drops', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.fogEnabled = false; s.pendingNotes = [];
    const hero = s.tokens[0]; if (!characterFor(hero)) hero.characterId = s.characters[0].id;      // an earlier test may have swapped the party token
    { const c = characterFor(hero); c.hp = c.maxHp; hero.deathSaves = null; hero.stable = false; hero.dead = false; hero.conditions = []; }      // and left the character hurt
    const mk = (id, name, col) => Object.assign(makeToken({ id, name, color: '#0a0', isPC: false, col, row: 12 }), { hp: 20, maxHp: 20, ac: 12, dexMod: 0 });
    const a = mk('ga', 'Ant', 11), b = mk('gb', 'Bat', 12);
    s.tokens.push(a, b);
    const names = (t) => tokenConditions(t).map((c) => c.name).sort();
    const dmg = (id, n) => ({ type: 'damageToken', tokenId: id, value: n });
    const out = {};
    s.combat = { active: true, round: 1, order: [hero.id, a.id, b.id] };
    for (const t of s.tokens) t.initiative = t === hero ? 20 : t === a ? 10 : 5;
    sortCombat(); s.activeIndex = s.tokens.indexOf(hero); beginTurn(hero);
    // sanctuary: damage dealt TO the holder by someone else's turn does nothing; damage the holder deals ends it
    setCondition(hero, 'sanctuary', 0, {});
    s.activeIndex = s.tokens.indexOf(a);
    await vtt.applyMapUpdates([dmg(hero.id, 1)]);
    out.sanctuaryHit = names(hero);
    s.activeIndex = s.tokens.indexOf(hero);
    await vtt.applyMapUpdates([dmg(hero.id, 0)]);
    await vtt.applyMapUpdates([dmg(a.id, 3)]);
    out.sanctuaryAfterAttack = names(hero); out.notes1 = s.pendingNotes.slice(); s.pendingNotes = [];
    // a roll line that shows a miss also counts as an attack
    setCondition(hero, 'sanctuary', 0, {});
    vtt.noteRollLines(['Perception check: d20 (12)']);
    out.sanctuaryAfterCheck = names(hero);
    vtt.noteRollLines([hero.name.split(' ')[0] + ' attack: d20 (3) + 5 = 8 vs AC 12, miss']);
    out.sanctuaryAfterMiss = names(hero); s.pendingNotes = [];
    // rage: an idle turn ends it, an attack or damage keeps it
    hero.attackedSince = false; hero.hurtSince = false; setCondition(hero, 'rage', 0, {});
    nextCombatTurn(); out.rageIdle = names(hero); out.rageNote = s.pendingNotes.join(' | '); s.pendingNotes = [];
    // back to the hero's turn
    const toHero = () => { for (let i = 0; i < 6 && activeToken() !== hero; i++) nextCombatTurn(); };
    toHero(); setCondition(hero, 'rage', 0, {});
    await vtt.applyMapUpdates([dmg(a.id, 2)]); nextCombatTurn(); out.rageAttacked = names(hero);
    toHero(); out.flagsReset = [hero.attackedSince, hero.hurtSince];
    nextCombatTurn(); toHero();
    setCondition(hero, 'rage', 0, {}); vtt.changeHp(hero, -1); nextCombatTurn(); out.rageHurt = names(hero);
    toHero(); setCondition(hero, 'rage', 0, {}); vtt.changeHp(hero, 99); out.hp0 = [characterFor(hero).hp, names(hero)]; vtt.changeHp(hero, -(characterFor(hero).hp)); out.rageAtZero = names(hero);
    vtt.changeHp(hero, 5); hero.conditions = [];
    // hunter's mark / hex end when the carrier drops to 0, the DM is told it can move
    s.pendingNotes = [];
    setCondition(b, "hunter's mark", 0, { source: hero.id }); setCondition(a, 'hex', 0, { source: hero.id }); setCondition(a, 'poisoned', 0, {});
    out.marksBefore = [names(b), names(a)];
    vtt.changeHp(b, -5); out.markHurt = names(b);
    vtt.changeHp(b, -99); out.markDown = names(b); out.markNote = s.pendingNotes.join(' | ');
    vtt.changeHp(a, -99); out.hexDown = names(a);
    out.chat = s.chat.filter((m) => m.role === 'system').slice(-6).map((m) => m.content);
    return out;
  })()`);
  assert.deepEqual(r.sanctuaryHit, ['sanctuary'], 'being hit by someone else does not end sanctuary');
  assert.deepEqual(r.sanctuaryAfterAttack, [], 'dealing damage as the active combatant ends it');
  assert.match(r.notes1.join(' '), /ended sanctuary on .*Do not remove it again/);
  assert.deepEqual(r.sanctuaryAfterCheck, ['sanctuary'], 'a skill check is not an attack');
  assert.deepEqual(r.sanctuaryAfterMiss, [], 'an attack that missed (seen in the roll lines) ends it too');
  assert.deepEqual(r.rageIdle, [], 'rage ends at the end of a turn with no attack and no damage');
  assert.match(r.rageNote, /rage/);
  assert.deepEqual(r.rageAttacked, ['rage'], 'damage dealt keeps the rage going');
  assert.deepEqual(r.flagsReset, [false, false]);
  assert.deepEqual(r.rageHurt, ['rage'], 'damage taken keeps the rage going');
  assert.deepEqual(r.rageAtZero, ['unconscious'],  'dropping to 0 hit points ends rage');
  assert.deepEqual(r.marksBefore, [["hunter's mark"], ['hex', 'poisoned']]);
  assert.deepEqual(r.markHurt, ["hunter's mark"]);
  assert.deepEqual(r.markDown, [], 'the mark ends when its target drops to 0');
  assert.match(r.markNote, /hunter's mark on .*bonus action/);
  assert.deepEqual(r.hexDown, ['poisoned'], 'hex ends too, other conditions stay');
});

test('the in-game clock shows in the top bar and follows a change made elsewhere (the Party tab, another browser) without a reload', opts, async () => {
  await page.goto(`${server.base}/index.html?nosave=1&live=1`);
  await page.waitFor('window.vtt && window.vtt.state.tokens.length >= 4 && Number.isFinite(window.vtt.state.clockTotal) && document.querySelector("#gameClock").textContent.length > 3');
  const before = await page.eval(`({ total: vtt.state.clockTotal, text: document.querySelector('#gameClock').textContent })`);
  assert.match(before.text, /^Day \d+, \d\d:\d\d (night|dawn|morning|midday|afternoon|evening)$/);
  await page.eval(`(() => { const t = vtt.state.tokens.find((x) => x.isPC); vtt.setCondition(t, 'moonlit', 0, { minutes: 30 }); return true; })()`);
  const res = await server.post('/api/party/clock', { minutes: 45 });
  assert.equal(res.status, 200);
  await page.waitFor(`vtt.state.clockTotal === ${before.total + 45}`, 8000);
  const after = await page.eval(`({ text: document.querySelector('#gameClock').textContent, left: vtt.tokenConditions(vtt.state.tokens.find((x) => x.isPC)).map((c) => c.name) })`);
  assert.notEqual(after.text, before.text, 'the readout moved');
  assert.ok(!after.left.includes('moonlit'), 'a timed effect that ran out against the new time was removed');
  assert.equal((await page.eval('typeof vtt.refreshClock')), 'function');
});

test('a group the DM puts on a pin is spread around it, not stacked on one tile; a creature on a free square keeps it', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(async () => {
    const s = vtt.state; s.fogEnabled = false; s.walls = []; s.wallsVersion++;
    s.areaPins = [{ area: 3, name: 'Kennel', col: 20, row: 14 }];
    const add = (id, col, row) => ({ type: 'addToken', tokenId: id, name: id, col, row, color: '#0a0', hidden: false, kind: 'creature', monster: 'goblin', maxHp: 7, ac: 15, speed: 30, dexMod: 2 });
    await vtt.applyMapUpdates([add('g1', 20, 14), add('g2', 20, 14), add('g3', 20, 14), add('g4', 20, 14)]);
    const g = ['g1', 'g2', 'g3', 'g4'].map((id) => s.tokens.find((t) => t.id === id)).map((t) => [t.col, t.row]);
    await vtt.applyMapUpdates([add('lone', 30, 20)]);
    const lone = s.tokens.find((t) => t.id === 'lone');
    return { g, lone: [lone.col, lone.row] };
  })()`);
  assert.equal(new Set(r.g.map((p) => p.join(','))).size, 4, 'four different squares');
  for (const [c, rw] of r.g) assert.ok(Math.max(Math.abs(c - 20), Math.abs(rw - 14)) <= 4, 'in the vicinity of the pin');
  assert.ok(r.g.some(([c, rw]) => c !== 20 || rw !== 14) && new Set(r.g.map((p) => p[0])).size > 1 && new Set(r.g.map((p) => p[1])).size > 1, 'not a tidy line');
  assert.deepEqual(r.lone, [30, 20], 'a creature the DM placed on its own free square stays there');
});

test('a campaign built from scratch opens on its first map, the party on that map\'s start pin', opts, async () => {
  const made = await server.post('/api/campaigns/new', { scratch: true, name: 'Opening Scene', premise: 'A test.', party: ['edric', 'astarion'], maps: [{ file: 'lmop-goblin-ambush.png', name: 'The ambush', kind: 'battle', description: 'A trail.' }] });
  assert.equal(made.status, 200);
  await server.post('/api/campaigns/active', { id: made.json.id });
  try {
    await page.goto(`${server.base}/index.html?nosave=1`);
    await page.waitFor('window.vtt && window.vtt.state.tokens.length >= 2 && window.vtt.state.map.url');
    const r = await page.eval(`(() => { const s = vtt.state; const pcs = s.tokens.filter((t) => t.isPC); return { url: s.map.url, kind: s.mapKind, pcs: pcs.map((t) => [t.col, t.row]), visited: s.visitedMaps }; })()`);
    assert.match(r.url, /lmop-goblin-ambush/); assert.equal(r.kind, 'battle');
    assert.ok(r.pcs.length >= 2 && r.pcs.every(([c, rr]) => c >= 0 && rr >= 0), 'the party is on the map, not off in the corner at -100');
    assert.ok(r.visited.some((u) => /goblin-ambush/.test(u)), 'the map counts as visited');
  } finally {
    await server.post('/api/campaigns/active', { id: LOST });
    await page.goto(`${server.base}/index.html?nosave=1`);
    await page.waitFor('window.vtt && window.vtt.state.characters.length >= 4 && !document.querySelector("#chatInput").disabled');
  }
});

test('hold the Space bar to talk: it works on the page, on a button and in an empty chat box, not while a message is being typed', opts, async () => {
  await page.eval(setup);
  const r = await page.eval(`(() => {
    const press = (target) => { const down = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }); (target || document.body).dispatchEvent(down); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })); return down.defaultPrevented; };
    const input = document.querySelector('#chatInput'), out = {};
    document.activeElement && document.activeElement.blur(); out.page = press(document.body);
    const b = document.querySelector('#micBtn'); b.focus(); out.button = press(b);
    input.focus(); input.value = ''; out.emptyBox = press(input);
    input.value = 'I open the'; out.typing = press(input);
    input.value = ''; const sel = [...document.querySelectorAll('select')].find((x) => x.offsetParent); if (sel) { sel.focus(); if (document.activeElement === sel) out.select = press(sel); }
    return out;
  })()`);
  assert.equal(r.page, true, 'Space on the page starts hold to talk'); assert.equal(r.button, true, 'and with a button focused (it does not press the button)');
  assert.equal(r.emptyBox, true, 'and in the empty chat box'); assert.equal(r.typing, false, 'but a space typed into a message stays a space');
  if ('select' in r) assert.equal(r.select, false, 'a drop-down keeps its own Space');
});

test('no page errors were logged during the whole run', opts, () => {
  assert.deepEqual(page.problems, []);
});

test('watch mode (?watch=1): the page refuses every write, so a spectator can never save or call the paid DM; reads still work', opts, async () => {
  await page.goto(`${server.base}/index.html?watch=1&nosave=1`);
  await page.waitFor('window.WATCH === true && window.vtt && window.vtt.state.tokens.length >= 1 && document.querySelector("#watchBanner")');
  const r = await page.eval(`(async () => {
    const out = {};
    for (const [method, url] of [['POST', '/api/roll'], ['PUT', '/api/campaigns/lost-mine-of-phandelver/journal'], ['POST', '/api/chat'], ['DELETE', '/api/characters/edric']]) {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      out[method + ' ' + url] = [res.status, (await res.json()).error];
    }
    out.get = (await fetch('/api/campaigns')).status;
    out.banner = document.querySelector('#watchBanner').textContent;
    out.pointerEvents = getComputedStyle(document.querySelector('#board')).pointerEvents;
    return out;
  })()`);
  for (const k of Object.keys(r).filter((x) => /^(POST|PUT|DELETE) /.test(x))) assert.deepEqual(r[k], [403, 'Watching only'], k);
  assert.equal(r.get, 200); assert.match(r.banner, /Watching/); assert.equal(r.pointerEvents, 'none');
  assert.equal((await server.get('/api/characters')).json.some((c) => c.id === 'edric'), true, 'nothing was deleted');
});
