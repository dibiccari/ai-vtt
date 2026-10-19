'use strict';

/* ---------------- map loading ---------------- */
function loadMap(url) {
  if (!url) return Promise.resolve();
  $('#banner').textContent = 'Loading map...';
  const seq = S.loadSeq = (S.loadSeq || 0) + 1;                 // a slower, older load must not overwrite a newer one
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      if (seq !== S.loadSeq) { resolve(); return; }
      const keptFog = S.url && S.img && S.placeOf && S.placeOf.get(S.url) && S.placeOf.get(S.url) === S.placeOf.get(url) && shroud.width ? copyFog() : null;       // switching day and night keeps what was explored
      const sameSpot = S.url && S.img && S.tokens && S.tokens[0] && S.placeOf && S.placeOf.get(S.url) && S.placeOf.get(S.url) === S.placeOf.get(url) ? { fx: S.tokens[0].x / S.W, fy: S.tokens[0].y / S.H } : null;       // day to night of one place: the token stays where it stands
      S.url = url;
      S.img = img;
      S.W = img.naturalWidth;
      S.H = img.naturalHeight;
      const saved = store.get(testKey(), null);
      S.squares = saved && saved.squares > 0 ? saved.squares : Math.max(5, Math.round(S.W / 50));
      S.walls = cleanWalls(saved && saved.walls);
      S.starts = [];
      S.wallUndo = []; S.wallSel = null; S.problems = []; S.problemIx = -1;
      S.difficult = [];
      S.tokens = (saved && Array.isArray(saved.tokens) ? saved.tokens : [])
        .filter((t) => t && isFinite(t.x) && isFinite(t.y))
        .slice(0, 1)
        .map((t) => ({ x: clamp(t.x, 0, S.W), y: clamp(t.y, 0, S.H) }));
      S.visionFt = saved && saved.visionFt > 0 ? saved.visionFt : 60;
      // The server's copy of the walls and grid wins over this browser's copy.
      await flushSave();
      const remote = await fetchServerConfig(mapName());
      if (seq !== S.loadSeq) { resolve(); return; }
      S.source = remote && remote.source === 'dd2vtt' ? 'dd2vtt' : null;
      if (remote && Array.isArray(remote.walls)) {
        S.walls = cleanWalls(remote.walls);
        if (remote.squares > 0) S.squares = remote.squares;
      }
      S.light = remote && ['bright', 'dim', 'dark'].includes(remote.light) ? remote.light : '';
      S.allLights = (remote && Array.isArray(remote.lights) ? remote.lights : []).filter((l) => l && isFinite(l.x) && isFinite(l.y) && l.range > 0).map((l, i) => ({ ...l, id: l.name || 'light-' + i }));
      S.lightsEdited = false;
      S.mapFog = !(remote && remote.fog === false); $('#mapFog').checked = S.mapFog; S.fog = S.mapFog; $('#fog').checked = S.fog; syncDmBox();       // Show Fog starts as the players will have it; it is only a way of looking
      S.objectTops = !(remote && remote.objectTops === false); $('#objectTops').checked = S.objectTops;
      S.lightsOff = new Set(S.allLights.filter((l) => l.on === false).map((l) => l.id));       // lights that start put out (an unlit brazier)
      S.effects = remote && Array.isArray(remote.effects) ? remote.effects : [];
      S.lightZones = (remote && Array.isArray(remote.lightZones) ? remote.lightZones : []).filter((z) => z && Array.isArray(z.points) && z.points.length >= 3 && ['bright', 'dim', 'dark', 'time'].includes(z.level)); S.zoneSel = null; S.zonePen = null;
      S.labels = remote && Array.isArray(remote.labels) ? remote.labels.filter((l) => l && l.text && isFinite(l.x) && isFinite(l.y)) : [];       // the words on a regional map (drawn by public/js/map-labels.js, written by the label script)
      S.lights = S.allLights.filter((l) => l.flicker === true);
      S.mapLights = S.allLights;
      renderMapLightsList();
      S.ambience = remote && typeof remote.ambience === 'string' ? remote.ambience : '';
      S.mood = remote && typeof remote.mood === 'string' ? remote.mood : '';
      S.hexSize = remote && remote.hexSize >= 20 ? remote.hexSize : 95;
      S.kind = remote && ['battle', 'camp', 'town', 'regional'].includes(remote.kind) ? remote.kind : (S.placeKinds && S.placeKinds.get(S.url)) || (remote && remote.tiles === 'hex' ? 'regional' : 'battle');
      S.tiles = tilesOf(S.kind);
      S.group = remote && remote.group ? remote.group : '';
      S.variant = remote && remote.variant ? remote.variant : '';
      S.rooms = remote && Array.isArray(remote.rooms) ? remote.rooms.filter((r) => Array.isArray(r) && r.length === 4 && r.every(isFinite)) : [];
      S.difficult = remote && Array.isArray(remote.difficult) ? remote.difficult.filter((d) => d && [d.x, d.y, d.w, d.h].every(isFinite) && d.w > 0 && d.h > 0) : [];
      S.starts = (remote && Array.isArray(remote.starts) ? remote.starts.filter((s) => s && typeof s.name === 'string' && isFinite(s.x) && isFinite(s.y)) : [])
        .map((s) => ({ ...s, radius: Number.isFinite(s.radius) ? s.radius : (s.name === 'start' ? 2 : 0) }));       // the party arrives anywhere inside the start circle (2 squares unless set)
      if (sameSpot) S.tokens = [{ x: clamp(sameSpot.fx * S.W, 0, S.W), y: clamp(sameSpot.fy * S.H, 0, S.H) }]; else parkAtStart();
      refreshMapLabels();
      loadAreas();
      loadDmVersion();
      syncControls();
      resetFog(keptFog);
      fitView();
      updateStats();
      store.set('vtt.maptest.lastMap', url);
      try { const g = S.guidOf && S.guidOf.get(url); history.replaceState(null, '', g ? `?set=${g.guid}${g.time !== 'main' ? '&time=' + g.time : ''}` : `?map=${encodeURIComponent(url)}`); } catch { /* not critical */ }
      resolve();
    };
    img.onerror = () => { $('#banner').textContent = 'Could not load that map image.'; resolve(); };
    img.src = url;
  });
}

// The first test token stands on the start pin (a saved token from an earlier visit would otherwise be left wherever it was), so the checks begin where the party would.
function parkAtStart() {
  const startPin = S.starts.find((p) => p.name === 'start');
  if (!startPin) return;
  const d = (startPin.radius || 0) * cell() * 0.55;                       // inside the start circle, away from the centre dot
  const at = { x: clamp(startPin.x + d * Math.cos(0.6), 0, S.W), y: clamp(startPin.y + d * Math.sin(0.6), 0, S.H) };
  if (S.tokens.length) S.tokens[0] = at; else S.tokens.push(at);
}

// A battle or camp map with no start pin gets an exclamation mark in the list; it goes away once a pin is named "start".
function mapLabel(url) {
  const name = url.split('/').pop();
  const shown = (S.placeNames && S.placeNames.get(url)) || name;
  const has = url === S.url ? S.starts.some((p) => p.name === 'start') : !S.missingStart.has(name);
  return (S.needsStart.has(name) && !has ? '❗ ' : '') + shown;
}
function refreshMapLabels() {
  for (const opt of $('#mapSelect').options) opt.textContent = mapLabel(opt.value);
}

async function loadMapList(initial = false) {
  const select = $('#mapSelect');
  // The list shows places, not pictures: a day and night pair, or a player picture with its DM picture, is one entry (GET /api/mapsets). The entry opens its day look.
  let places = [];
  try {
    const res = await fetch('/api/mapsets');
    places = (await res.json()).sets || [];
    // A link to an archived place (?set=<id>) opens it: the archived places are not listed otherwise, so that one is fetched and added.
    const askedSet = new URLSearchParams(location.search).get('set');
    if (askedSet && !places.some((p) => p.guid === askedSet)) {
      const withArchived = (await (await fetch('/api/mapsets?archived=1')).json()).sets || [];
      const hit = withArchived.find((p) => p.guid === askedSet);
      if (hit) places = places.concat(hit);
    }
  } catch (err) {
    $('#banner').textContent = `Could not list maps: ${err.message}`;
    return;
  }
  const lookUrl = (set, time) => { const lk = set.levels[0].looks.find((l) => l.time === time) || set.levels[0].looks[0]; return '/uploads/' + lk.player; };
  const maps = places.map((p) => lookUrl(p, 'day'));
  const nameOf = new Map(); const dupes = new Set(); for (const p of places) { if (nameOf.has(p.name)) dupes.add(p.name); nameOf.set(p.name, true); }
  S.placeOf = new Map(); for (const p of places) for (const l of p.levels[0].looks) S.placeOf.set('/uploads/' + l.player, lookUrl(p, 'day'));       // any look of a place -> the entry that stands for it
  S.guidOf = new Map(); for (const p of places) for (const l of p.levels[0].looks) S.guidOf.set('/uploads/' + l.player, { guid: p.guid, time: l.time });
  S.placeOrigin = new Map(places.map((p) => [lookUrl(p, 'day'), p.origin]));
  S.placeCampaigns = new Map(places.map((p) => [lookUrl(p, 'day'), p.campaigns || []]));
  await fillCampaignFilter();
  S.placeKinds = new Map(places.map((p) => [lookUrl(p, 'day'), p.kind]));
  S.placeNames = new Map(places.map((p) => [lookUrl(p, 'day'), p.name]));                                   // the day look (or the only one) stands for the place
  const placeOf = new Map(); for (const p of places) for (const l of p.levels[0].looks) placeOf.set('/uploads/' + l.player, lookUrl(p, 'day'));
  select.innerHTML = '';
  try {
    const res = await fetch('/api/map-configs');
    const configs = (await res.json()).configs;
    S.needsStart = new Set(configs.filter((c) => c.needsStart).map((c) => c.map));            // battle and camp maps: they need a start pin
    S.missingStart = new Set(configs.filter((c) => c.missingStart).map((c) => c.map));
  } catch { S.needsStart = new Set(); S.missingStart = new Set(); }
  if (!maps.length) {
    $('#banner').textContent = 'No maps found. Upload one on the Tabletop page first.';
    return;
  }
  const q = new URLSearchParams(location.search);
  if (initial && q.get('time') === 'night') S.timeOfDay = 'night';       // a link to a night look opens it at night
  let wanted = q.get('map');
  if (q.get('set')) {
    const place = places.find((p) => p.guid === q.get('set'));
    if (place) wanted = lookUrl(place, q.get('time') || 'day');
  }
  const publisher = $('#publisher').value;
  const campaign = $('#campaignFilter').value;
  let shown = publisher ? maps.filter((u) => S.placeOrigin.get(u) === publisher) : maps;       // the Publisher filter above the list
  if (campaign) shown = shown.filter((u) => campaign === '__none' ? !(S.placeCampaigns.get(u) || []).length : (S.placeCampaigns.get(u) || []).includes(campaign));       // and the Campaign filter under it
  if (!shown.length) shown = maps;
  if (initial && wanted && placeOf.has(wanted) && !shown.includes(placeOf.get(wanted))) { $('#publisher').value = ''; store.set('vtt.maptest.publisher', ''); $('#campaignFilter').value = ''; store.set('vtt.maptest.campaign', ''); shown = maps; }       // a map asked for by address is always shown
  shown = shown.slice().sort((a, b) => (b.endsWith('/vtt-terrain-test.png') ? 1 : 0) - (a.endsWith('/vtt-terrain-test.png') ? 1 : 0));     // the Terrain Test Grounds map always comes first
  for (const url of shown) {
    const opt = document.createElement('option');
    opt.value = url;
    opt.textContent = mapLabel(url);
    select.appendChild(opt);
  }
  const last = store.get('vtt.maptest.lastMap', null);
  const inList = (u) => u && placeOf.has(u) && shown.includes(placeOf.get(u));
  const asked = inList(wanted) ? wanted : inList(last) ? last : shown[0];       // a night look asked for by name opens as itself
  select.value = placeOf.get(asked) || shown[0];
  await loadMap(asked);
  if (!S.configs.length) await refreshVariants();
  await ensureLook();                                                       // the look that goes with the time of day
  renderVariantSwitch();
}
