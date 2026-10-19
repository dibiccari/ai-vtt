// Tabletop light zones, time of day, looks and light from gear, in headless Chrome (window.vtt and the page's own functions). Own server and page.
// Every test sets the map light, zones, lights and time it needs; nothing assumes what the user drew on a real map.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/sandbox.mjs';
import { launchChrome, skipReason } from '../helpers/chrome.mjs';

const skip = skipReason();
const LOST = 'lost-mine-of-phandelver';
let server, page;
const opts = { skip: skip || false };
const boot = async (query = '?nosave=1') => {
  await page.goto(`${server.base}/index.html${query}`);
  await page.waitFor('window.vtt && window.vtt.state.tokens.length >= 4 && window.vtt.state.characters.length >= 4 && !document.querySelector("#chatInput").disabled');
};
before(async () => {
  if (skip) return;
  server = await startServer();
  await server.post('/api/campaigns/active', { id: LOST });
  page = await launchChrome();
  await boot();
});
after(async () => { if (page) await page.close(); if (server) await server.stop(); });

// A known board: no walls, no lights, no zones, fog off, daytime, the table's override cleared.
const clean = `(() => {
  const s = vtt.state;
  s.combat = { active: false, round: 0, order: [] }; s.walls = []; s.wallsVersion++; s.lights = []; s.lightZones = []; s.ambient = 'bright'; s.ambientOverride = ''; s.timeOfDay = 'day'; s.fogEnabled = false; s.lightsOff = {};
  s.tokens = s.tokens.filter((t) => t && t.isPC).slice(0, 1); const h = s.tokens[0]; h.col = 10; h.row = 10; h.lightKind = ''; s.activeIndex = 0;
})()`;
const sq = (cx, cy, r) => `[{ x: ${cx - r}, y: ${cy - r} }, { x: ${cx + r}, y: ${cy - r} }, { x: ${cx + r}, y: ${cy + r} }, { x: ${cx - r}, y: ${cy + r} }]`;

test('overlapping zones: the last zone that holds a point wins, points outside every zone get the map\'s light, and the table\'s override beats every zone', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {}, at = (x, y) => ambientAt(x, y);
    s.ambient = 'bright';
    s.lightZones = [{ id: 'big', name: 'Big', level: 'dark', points: ${sq(500, 500, 300)} }, { id: 'mid', name: 'Mid', level: 'dim', points: ${sq(500, 500, 150)} }, { id: 'small', name: 'Small', level: 'bright', points: ${sq(500, 500, 50)} }];
    out.centre = at(500, 500); out.ring1 = at(500, 400); out.ring2 = at(500, 250); out.outside = at(900, 900);
    s.lightZones.reverse(); out.reversedCentre = at(500, 500); out.reversedMid = at(500, 400); s.lightZones.reverse();
    s.ambientOverride = 'bright'; out.overBright = [at(500, 250), anyDark()]; s.ambientOverride = 'dark'; out.overDark = [at(500, 500), at(900, 900), anyDark()]; s.ambientOverride = '';
    out.noZoneArg = ambientAt(); out.anyDark = anyDark();
    return out;
  })()`);
  assert.deepEqual([r.centre, r.ring1, r.ring2, r.outside], ['bright', 'dim', 'dark', 'bright']);
  assert.deepEqual([r.reversedCentre, r.reversedMid], ['dark', 'dark'], 'with the list reversed the big dark zone is last and wins everywhere');
  assert.deepEqual(r.overBright, ['bright', false], 'a bright override: no part is dark'); assert.deepEqual(r.overDark, ['dark', 'dark', true]);
  assert.equal(r.noZoneArg, 'bright', 'no point given: the map level'); assert.equal(r.anyDark, true);
});

test('zones in a dark map: a bright zone is lit without a lamp, the rest needs light, and the lit region marks exactly the lit parts', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {};
    s.ambient = 'dark'; s.lightZones = [{ id: 'hall', name: 'Hall', level: 'bright', points: ${sq(500, 500, 100)} }, { id: 'nook', name: 'Nook', level: 'dim', points: ${sq(900, 500, 50)} }];
    out.anyDark = anyDark(); out.hall = lightLevelAt(500, 500); out.nook = lightLevelAt(900, 500); out.away = lightLevelAt(1500, 1500);
    const lr = litRegion(), a = (x, y) => lr.getContext('2d').getImageData(x, y, 1, 1).data[3];
    out.lit = [a(500, 500), a(900, 500), a(1500, 1500)];
    s.ambientOverride = 'bright'; out.overrideNull = litRegion(); out.overrideLevel = lightLevelAt(1500, 1500); s.ambientOverride = '';
    s.lightZones = []; out.noZones = litRegion();
    return out;
  })()`);
  assert.equal(r.anyDark, true); assert.deepEqual([r.hall, r.nook, r.away], [2, 1, 0], 'bright, dim, dark');
  assert.ok(r.lit[0] > 200 && r.lit[1] > 200 && r.lit[2] === 0, 'lit region: ' + r.lit);
  assert.equal(r.overrideNull, null, 'no zone picture while the table overrides the light'); assert.equal(r.overrideLevel, 2); assert.equal(r.noZones, null);
});

test('zones in a bright map: a dark zone is cleared out of the lit region; a zone that follows the time of day resolves for every part of the day', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {};
    s.ambient = 'bright'; s.lightZones = [{ id: 'cellar', name: 'Cellar', level: 'dark', points: ${sq(500, 500, 100)} }, { id: 'yard', name: 'Yard', level: 'time', points: ${sq(1000, 500, 100)} }];
    for (const v of ['day', 'dawn', 'dusk', 'night']) { s.timeOfDay = v; const lr = litRegion(), a = (x, y) => lr.getContext('2d').getImageData(x, y, 1, 1).data[3]; out[v] = { time: timeLevel(), yard: ambientAt(1000, 500), cellar: ambientAt(500, 500), elsewhere: ambientAt(1500, 1500), litYard: a(1000, 500) > 200, litCellar: a(500, 500) > 200, anyDark: anyDark(), told: lightingForAi().zones.map((z) => [z.name, z.light, z.followsTimeOfDay]) }; }
    s.timeOfDay = 'day'; return out;
  })()`);
  const expect = { day: ['bright', true, false], dawn: ['dim', true, false], dusk: ['dim', true, false], night: ['dark', false, true] };
  for (const [v, [lvl, litYard]] of Object.entries(expect)) {
    assert.equal(r[v].time, lvl, v); assert.equal(r[v].yard, lvl, v + ': the time zone follows'); assert.equal(r[v].cellar, 'dark', v + ': a fixed zone does not'); assert.equal(r[v].elsewhere, 'bright', v + ': a bright map is not dark by night');
    assert.equal(r[v].litYard, litYard, v + ' lit region of the yard'); assert.equal(r[v].litCellar, false); assert.equal(r[v].anyDark, true, 'the cellar is always dark');
    assert.deepEqual(r[v].told, [['Cellar', 'dark', false], ['Yard', lvl, true]], v + ': what the DM is told');
  }
});

test('a map with no dark zone is not dark by night; a map whose only dark part is a time zone becomes dark only at night', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {};
    s.lightZones = [{ id: 'yard', name: 'Yard', level: 'time', points: ${sq(500, 500, 100)} }];
    out.day = anyDark(); s.timeOfDay = 'dusk'; out.dusk = anyDark(); s.timeOfDay = 'night'; out.night = anyDark(); s.ambientOverride = 'bright'; out.nightOverridden = anyDark(); s.ambientOverride = '';
    s.lightZones = []; out.noZonesNight = anyDark(); s.timeOfDay = 'day';
    return out;
  })()`);
  assert.deepEqual(r, { day: false, dusk: false, night: true, nightOverridden: false, noZonesNight: false });
});

test('the night wash and the lit region are redrawn when another map brings zones with the same ids and the same map size but different shapes', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {}, W = s.map.width;
    s.timeOfDay = 'night'; s.ambient = 'bright';
    const wash = (x, y) => { drawNightWash(); return washCache.canvas.getContext('2d').getImageData(x, y, 1, 1).data[3]; };
    const lit = (x, y) => litRegion().getContext('2d').getImageData(x, y, 1, 1).data[3];
    s.lightZones = [{ id: 'zone-1', name: 'A', level: 'dark', points: ${sq(300, 300, 100)} }];
    out.firstInside = [wash(300, 300), lit(300, 300)]; out.firstOutside = [wash(900, 900), lit(900, 900)];
    s.lightZones = [{ id: 'zone-1', name: 'A', level: 'dark', points: ${sq(900, 900, 100)} }];      // what loading another map does: a new list, the same id and level
    out.secondOldSpot = [wash(300, 300), lit(300, 300)]; out.secondNewSpot = [wash(900, 900), lit(900, 900)];
    s.lightZones = []; s.timeOfDay = 'day';
    return out;
  })()`);
  assert.equal(r.firstInside[0], 0, 'a fixed dark zone gets no wash'); assert.equal(r.firstInside[1], 0, 'and is not lit'); assert.ok(r.firstOutside[0] > 80 && r.firstOutside[1] > 200);
  assert.ok(r.secondOldSpot[0] > 80 && r.secondOldSpot[1] > 200, 'the old spot is no longer a zone: ' + JSON.stringify(r.secondOldSpot));
  assert.equal(r.secondNewSpot[0], 0, 'the new zone has no wash: ' + JSON.stringify(r.secondNewSpot)); assert.equal(r.secondNewSpot[1], 0);
});

test('the wash follows every part of the day: none by day, light at dawn and dusk, the darkest at night', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(() => {
    const s = vtt.state, out = {};
    for (const v of ['day', 'dawn', 'dusk', 'night']) { s.timeOfDay = v; drawNightWash(); const c = washCache.canvas; out[v] = v === 'day' ? null : c.getContext('2d').getImageData(50, 50, 1, 1).data[3]; }
    s.timeOfDay = 'night'; s.ambient = 'dark'; drawNightWash(); out.darkMap = washCache.canvas.getContext('2d').getImageData(50, 50, 1, 1).data[3];
    s.ambient = 'dim'; drawNightWash(); out.dimMap = washCache.canvas.getContext('2d').getImageData(50, 50, 1, 1).data[3]; s.ambient = 'bright'; s.timeOfDay = 'day';
    return out;
  })()`);
  assert.ok(r.dawn > 20 && r.dusk > 20 && r.night > r.dusk && r.night > r.dawn, JSON.stringify(r)); assert.equal(r.darkMap, 0, 'a dark map has no wash'); assert.ok(r.dimMap > 80, 'a dim map is washed at night');
});

test('time of day is saved with the board and comes back after a reload; a made-up saved value is read as day', opts, async () => {
  await boot('?nosave=1');
  const key = await page.eval(`(async () => { vtt.setTimeOfDay('dusk'); await new Promise((r) => setTimeout(r, 100)); vtt.setTimeOfDay('night'); return boardKey(); })()`);
  const saved = await page.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).timeOfDay`);
  assert.equal(saved, 'night', 'saveBoard writes it');
  await boot('?nosave=1');
  assert.equal(await page.eval('vtt.state.timeOfDay'), 'night', 'restored after a reload');
  await page.eval(`(() => { const b = JSON.parse(localStorage.getItem(${JSON.stringify(key)})); b.timeOfDay = 'teatime'; localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(b)); })()`);
  await boot('?nosave=1');
  assert.equal(await page.eval('vtt.state.timeOfDay'), 'day', 'a bad value becomes day');
  await page.eval(`(() => { const b = JSON.parse(localStorage.getItem(${JSON.stringify(key)})); delete b.timeOfDay; localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(b)); })()`);
  await boot('?nosave=1');
  assert.equal(await page.eval('vtt.state.timeOfDay'), 'day', 'an old board with no time is day');
});

test('time of day goes to the server save and comes back from it when the browser copy is gone', opts, async () => {
  await boot('');                                                    // no ?nosave: this page mirrors the board to the (sandboxed) server
  const key = await page.eval(`(async () => { await vtt.state.timeOfDay; vtt.setTimeOfDay('night'); return boardKey(); })()`);
  await page.waitFor(`false`, 1).catch(() => {});
  const end = Date.now() + 8000; let game;
  while (Date.now() < end) { game = (await server.get(`/api/campaigns/${LOST}/game`)).json; if (game.board && game.board.timeOfDay === 'night') break; await new Promise((r) => setTimeout(r, 300)); }
  assert.equal(game.board.timeOfDay, 'night', 'the server copy has it');
  await page.eval(`(() => { localStorage.removeItem(${JSON.stringify(key)}); localStorage.removeItem('vtt.savedAt.${LOST}'); })()`);
  await boot('');
  assert.equal(await page.eval('vtt.state.timeOfDay'), 'night', 'restored from the server save');
  await page.eval(`vtt.setTimeOfDay('day')`);
  await boot('?nosave=1');
});

test('the DM\'s timeOfDay updates: repeats say nothing, each change prints once, a bad value is ignored', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(async () => {
    const s = vtt.state, out = {}, lines = () => [...document.querySelectorAll('#chatLog *')].filter((n) => n.children.length === 0 && /Night falls|Dawn breaks|It is day|Dusk settles/.test(n.textContent)).length;
    const n0 = lines();
    await vtt.applyMapUpdates([{ type: 'timeOfDay', value: 'night' }, { type: 'timeOfDay', value: 'night' }]); out.afterTwo = lines() - n0;
    await vtt.applyMapUpdates([{ type: 'timeOfDay', value: 'bogus' }, { type: 'timeOfDay' }, { type: 'timeOfDay', value: null }]); out.afterBogus = [lines() - n0, s.timeOfDay];
    await vtt.applyMapUpdates([{ type: 'timeOfDay', value: 'dawn' }]); out.dawn = [lines() - n0, s.timeOfDay];
    s.timeOfDay = 'day'; return out;
  })()`);
  assert.equal(r.afterTwo, 1, 'night falls once'); assert.equal(r.afterBogus[1], 'day', 'a bad value is read as day (so it is a change from night)');
  assert.equal(r.dawn[1], 'dawn');
});

// ---- looks ----
const toCamp = `(async () => {
  const s = vtt.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await vtt.travelTo({ mapUrl: '/uploads/vtt-camp-day.png', mapName: 'Camp', kind: 'camp', col: 5, row: 5 });
  s.timeOfDay = 'day'; await wait(500); return { files: s.lookFiles, look: s.look, src: s.map.img.src.split('/').pop() };
})()`;

test('looks: switching to night and straight back to day before the night picture has loaded ends on the day look', opts, async () => {
  await page.eval(clean);
  const start = await page.eval(toCamp);
  assert.deepEqual(start.files, { day: 'vtt-camp-day.png', night: 'vtt-camp-night.png' }, 'the camp has two looks'); assert.equal(start.look, 'day');
  const r = await page.eval(`(async () => {
    const s = vtt.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    vtt.setTimeOfDay('night'); vtt.setTimeOfDay('day');                  // no wait in between
    await wait(1500);
    out.src = s.map.img.src.split('/').pop(); out.look = s.look; out.time = s.timeOfDay;
    vtt.setTimeOfDay('night'); vtt.setTimeOfDay('dusk'); vtt.setTimeOfDay('night'); await wait(1500); out.night = [s.map.img.src.split('/').pop(), s.look, s.timeOfDay];
    vtt.setTimeOfDay('day'); await wait(1500); out.day = [s.map.img.src.split('/').pop(), s.look, s.timeOfDay];
    return out;
  })()`);
  assert.deepEqual([r.src, r.look, r.time], ['vtt-camp-day.png', 'day', 'day'], 'the picture matches the time: ' + JSON.stringify(r));
  assert.deepEqual(r.night, ['vtt-camp-night.png', 'night', 'night']); assert.deepEqual(r.day, ['vtt-camp-day.png', 'day', 'day']);
});

test('looks: when the two pictures differ in size, or the place has only one look, the picture stays and the wash does the darkening', opts, async () => {
  await page.eval(clean);
  await page.eval(toCamp);
  const r = await page.eval(`(async () => {
    const s = vtt.state, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {};
    const size = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = url; });
    const here = [s.map.img.naturalWidth, s.map.img.naturalHeight];
    const maps = ((await (await fetch('/api/maps')).json()).maps || (await (await fetch('/api/maps')).json())).map((m) => (m.url || m.file || m).toString()).filter((u) => /\\.(png|jpe?g|webp)$/i.test(u));
    let other = null;
    for (const u of maps) { const url = u.startsWith('/') ? u : '/uploads/' + u; const sz = await size(url); if (sz && (sz[0] !== here[0] || sz[1] !== here[1])) { other = url.split('/').pop(); break; } }
    out.other = other;
    s.lookFiles = { day: 'vtt-camp-day.png', night: other }; s.look = 'day';
    vtt.setTimeOfDay('night'); await wait(1200);
    out.mismatch = [s.map.img.src.split('/').pop(), s.look, s.timeOfDay];
    s.timeOfDay = 'day'; s.lookFiles = null; s.look = 'day';
    vtt.setTimeOfDay('night'); await wait(600); out.single = [s.map.img.src.split('/').pop(), s.look, s.timeOfDay];
    s.lookFiles = { day: 'vtt-camp-day.png' }; s.timeOfDay = 'day'; vtt.setTimeOfDay('night'); await wait(600); out.noNight = [s.map.img.src.split('/').pop(), s.look];
    s.timeOfDay = 'day'; return out;
  })()`);
  assert.ok(r.other, 'some uploaded picture has another size');
  assert.deepEqual(r.mismatch, ['vtt-camp-day.png', 'day', 'night'], 'a picture of another size is not swapped in');
  assert.deepEqual(r.single, ['vtt-camp-day.png', 'day', 'night']); assert.deepEqual(r.noNight, ['vtt-camp-day.png', 'day']);
  assert.deepEqual(page.problems, [], 'no page errors');
});

// ---- light from gear ----
test('light from gear: a Sun Blade or Flame Tongue is refused for a monster token and for an item in the pack; held light needs the item wielded and the first held item wins', opts, async () => {
  await page.eval(clean);
  const r = await page.eval(`(async () => {
    const s = vtt.state, hero = s.tokens[0], c = characterFor(hero), out = {};
    const mine = () => allLights().filter((l) => l.id === 'token-' + hero.id).map((l) => [l.name, Math.round(l.bright / GRID * 5), Math.round(l.dim / GRID * 5)]);
    const inv = (name, extra = {}) => ({ id: name, name, qty: 1, equipped: true, effects: [], ...extra });
    s.pendingNotes = [];
    c.inventory = [inv('Sun Blade', { equipped: false })];
    await vtt.applyMapUpdates([{ type: 'lightToken', tokenId: hero.id, kind: 'sun-blade' }]); out.inPack = [hero.lightKind, mine()];
    c.inventory = [inv('Sun Blade')];
    await vtt.applyMapUpdates([{ type: 'lightToken', tokenId: hero.id, kind: 'sun-blade' }]); out.wielded = [hero.lightKind, mine()];
    await vtt.applyMapUpdates([{ type: 'lightToken', tokenId: hero.id, kind: 'flame-tongue' }]); out.wrongItem = [hero.lightKind, s.pendingNotes.some((n) => /Flame Tongue/.test(n))];
    hero.lightKind = ''; c.inventory = [inv('Mace of Disruption'), inv('Mace of Disruption', { id: 'm2', name: 'Mace of Disruption' })]; out.held = mine();
    c.inventory = [inv('Mace of Disruption'), inv('Sun Blade')]; out.heldAndLit = mine();      // a sun blade must be lit; the mace shines by itself
    c.inventory = [inv('Torch')]; out.torchUnlit = mine();
    const monster = { id: 'mon1', name: 'Goblin', col: 12, row: 12, isPC: false, hidden: false, kind: 'creature', conditions: [] }; s.tokens.push(monster);
    await vtt.applyMapUpdates([{ type: 'lightToken', tokenId: 'mon1', kind: 'sun-blade' }]); out.monster = monster.lightKind || '';
    await vtt.applyMapUpdates([{ type: 'lightToken', tokenId: 'mon1', kind: 'torch' }]); out.monsterTorch = monster.lightKind;
    s.tokens = s.tokens.filter((t) => t.id !== 'mon1'); hero.lightKind = ''; c.inventory = [];
    return out;
  })()`);
  assert.deepEqual(r.inPack, ['', []], 'a sword in the pack gives no light'); assert.equal(r.wielded[0], 'sun-blade'); assert.deepEqual(r.wielded[1].map((l) => l.slice(1)), [[15, 30]]);
  assert.deepEqual(r.wrongItem, ['sun-blade', true], 'asking for a Flame Tongue they do not have is refused and the DM is told; the old light stays');
  assert.deepEqual(r.held.map((l) => l.slice(1)), [[20, 40]], 'two maces shine as one light');
  assert.deepEqual(r.heldAndLit.map((l) => l.slice(1)), [[20, 40]], 'only the mace shines until somebody lights the sun blade');
  assert.deepEqual(r.torchUnlit, [], 'a torch in the pack does not light by itself'); assert.equal(r.monster, '', 'a creature has no item to light'); assert.equal(r.monsterTorch, 'torch', 'but a plain torch is fine');
});
