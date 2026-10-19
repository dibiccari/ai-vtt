// Which of a campaign's documents the DM reads for the place the party is in. A human DM has the chapter open, not the whole book: sending every chapter of a module on every turn
// made each call read about 100,000 tokens of text that was not needed (the Wave Echo Cave chapter during a goblin ambush).
// A campaign may carry relevance.json: { always, byMap, combat }.
//   always:  documents read on every map.            byMap: { "<map id>": [documents] } added for that map.
//   combat:  { always: [documents read in a fight], areaSource: { "<map id>": "<chapter>" }, areaRadius }.  In a fight only `combat.always` and the map's own documents are read, without the
//            story and appendix documents; where a map has numbered areas (area pins) and a chapter with '## N. NAME' sections, only the sections of the areas near the tokens.
// Without the file, or on a map it does not list, every document is sent.
export function selectDocuments(files, relevance, mapId, ctx = {}) {
  if (!relevance || typeof relevance !== 'object' || !Array.isArray(relevance.always) || !relevance.byMap || typeof relevance.byMap !== 'object') return { files, filtered: false };
  if (!mapId || !Object.hasOwn(relevance.byMap, mapId) || !Array.isArray(relevance.byMap[mapId])) return { files, filtered: false };
  const fight = Boolean(ctx.combat) && relevance.combat && Array.isArray(relevance.combat.always);
  const own = relevance.byMap[mapId].map(String);
  const dropped = fight ? new Set((relevance.combat.drop || []).map(String)) : new Set();
  const wanted = new Set(fight ? [...relevance.combat.always, ...own.filter((n) => !dropped.has(n))].map(String) : [...relevance.always, ...own].map(String));
  let kept = files.filter((f) => wanted.has(f.name));
  if (!kept.length) return { files, filtered: false };
  let areas = null;
  const source = fight && relevance.combat.areaSource ? relevance.combat.areaSource[mapId] : null;
  if (source && Array.isArray(ctx.areaNumbers) && ctx.areaNumbers.length) {
    kept = kept.map((f) => {
      if (f.name !== source) return f;
      const text = areaSections(f.text, ctx.areaNumbers);
      return text ? { ...f, text, size: text.length, partial: ctx.areaNumbers.join(', ') } : f;
    });
    areas = ctx.areaNumbers;
  }
  return { files: kept, filtered: true, fight, areas, left: files.filter((f) => !kept.some((k) => k.name === f.name)).map((f) => f.name) };
}

// The sections of a chapter under '## N. NAME' headings, for the given area numbers.
export function areaSections(chapter, numbers) {
  const out = [];
  for (const n of [...new Set(numbers)].sort((a, b) => a - b)) {
    const m = new RegExp('^## ' + Number(n) + '\\. .*$', 'm').exec(chapter);
    if (!m) continue;
    const rest = chapter.slice(m.index + m[0].length), next = /^## /m.exec(rest);
    out.push(m[0] + '\n' + (next ? rest.slice(0, next.index) : rest).trim());
  }
  return out.join('\n\n');
}

// The numbered areas that have a creature or a character near them: pins are {area, col, row}, tokens {col, row, dead?}. Within `radius` squares.
export function areasInPlay(pins, tokens, radius = 10) {
  const found = new Set();
  for (const p of Array.isArray(pins) ? pins : []) {
    if (!Number.isFinite(Number(p?.area))) continue;
    for (const t of Array.isArray(tokens) ? tokens : []) {
      if (!t || t.dead || !Number.isFinite(Number(t.col))) continue;
      if (Math.hypot(Number(p.col) - Number(t.col), Number(p.row) - Number(t.row)) <= radius) { found.add(Number(p.area)); break; }
    }
  }
  return [...found].sort((a, b) => a - b);
}

// What the DM is told when part of the module is left out.
export function filteredNote(left, fight, areas) {
  return `Only the chapters for the place the party is in are shown below, to keep your reading short${fight ? ' (a fight is on, so just what is on the map: the creatures and the spells have their own cards, and the story chapters are left out)' : ''}${areas ? `; for this fight, the sections of areas ${areas.join(', ')} of the chapter` : ''}. The module also has: ${left.join(', ')}. When the party goes somewhere else or the fight ends, the chapters for that place are shown with your next message (the list of maps tells you where places are); until then, if you need something that is not shown, say little rather than inventing module details, and keep what you have already told the players consistent with the journal.`;
}
