// How names are spoken. A campaign may carry pronunciations.json {"Raechyl": "Rachel"}: the words are swapped in the text sent to a voice (the written text stays as it is).
export function pronounce(text, map) {
  const entries = Object.entries(map || {}).filter(([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'string');
  let out = String(text ?? '');
  for (const [word, spoken] of entries) {
    const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), spoken);
  }
  return out;
}
