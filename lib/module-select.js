// Which of a campaign's documents the DM reads for the place the party is in. A human DM has the chapter open, not the whole book: sending every chapter of a module on every turn
// made each call read about 100,000 tokens of text that was not needed (the Wave Echo Cave chapter during a goblin ambush).
// A campaign may carry relevance.json: { "always": [file names], "byMap": { "<map id>": [file names] } }. Without it, or on a map it does not list, every document is sent.
export function selectDocuments(files, relevance, mapId) {
  if (!relevance || typeof relevance !== 'object' || !Array.isArray(relevance.always) || !relevance.byMap || typeof relevance.byMap !== 'object') return { files, filtered: false };
  if (!mapId || !Object.hasOwn(relevance.byMap, mapId) || !Array.isArray(relevance.byMap[mapId])) return { files, filtered: false };
  const wanted = new Set([...relevance.always, ...relevance.byMap[mapId]].map(String));
  const kept = files.filter((f) => wanted.has(f.name));
  return kept.length ? { files: kept, filtered: true, left: files.filter((f) => !wanted.has(f.name)).map((f) => f.name) } : { files, filtered: false };
}

// What the DM is told when part of the module is left out.
export function filteredNote(left) {
  return `Only the chapters for the place the party is in are shown below, to keep your reading short. The module also has: ${left.join(', ')}. When the party goes somewhere else, the chapters for that place are shown with your next message (the list of maps tells you where places are); until then, if you need something that is not shown, say little rather than inventing module details, and keep what you have already told the players consistent with the journal.`;
}
