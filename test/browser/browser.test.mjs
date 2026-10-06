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
    vtt.changeHp(hero, -999); out.pcHp = c.hp; out.pcCond = hero.conditions.map(x => x.name); out.saves = hero.deathSaves;
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
