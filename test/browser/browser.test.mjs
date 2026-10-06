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
  s.tokens = s.tokens.filter(t => t.isPC).slice(0, 1);
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

test('no page errors were logged during the whole run', opts, () => {
  assert.deepEqual(page.problems, []);
});
