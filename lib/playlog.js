// The play log: one JSON line per event in data/logs/<campaign>/<date>.jsonl (git-ignored), so a session can be reviewed afterwards: what the player said, what the DM answered
// and did, how long it took and what it cost in tokens, and what the browser did with the voices. Writing never throws and never delays a reply.
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const clean = (v, depth = 0) => {
  if (typeof v === 'string') return v.length > 4000 ? v.slice(0, 4000) + '…' : v;
  if (Array.isArray(v)) return depth > 4 ? [] : v.slice(0, 60).map((x) => clean(x, depth + 1));
  if (v && typeof v === 'object') return depth > 4 ? {} : Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, clean(x, depth + 1)]));
  return v;
};

export function createPlayLog(dataDir) {
  const dirOf = (campaign) => path.join(dataDir, 'logs', String(campaign || 'default').replace(/[^\w.-]/g, '_').slice(0, 80));
  const fileOf = (campaign, day) => path.join(dirOf(campaign), `${day}.jsonl`);
  return {
    // Fire and forget.
    log(campaign, event) {
      const at = new Date();
      const line = JSON.stringify({ at: at.toISOString(), ...clean(event) }) + '\n';
      mkdir(dirOf(campaign), { recursive: true }).then(() => appendFile(fileOf(campaign, at.toISOString().slice(0, 10)), line)).catch((err) => console.warn('Play log failed:', err.message));
    },
    async days(campaign) {
      try { return (await readdir(dirOf(campaign))).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).sort(); } catch { return []; }
    },
    async read(campaign, day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
      try { return await readFile(fileOf(campaign, day), 'utf8'); } catch { return ''; }
    }
  };
}

// The log as readable text: the table talk in order, with the numbers that matter for review.
export function logAsText(jsonl) {
  const out = [];
  for (const raw of String(jsonl).split('\n')) {
    if (!raw.trim()) continue;
    let e; try { e = JSON.parse(raw); } catch { continue; }
    const time = String(e.at || '').slice(11, 19);
    if (e.kind === 'chat') {
      out.push(`[${time}] PLAYER: ${e.player}`);
      if (e.tableNotes?.length) out.push(`    table notes: ${e.tableNotes.join(' | ')}`);
      if (e.corrections?.length) out.push(`    refused or shortened moves: ${e.corrections.join(' | ')}`);
      if (e.combat) out.push(`    combat: round ${e.combat.round}, active ${e.combat.current}`);
      for (const r of e.rolls || []) out.push(`    roll: ${r}`);
      for (const l of e.lines || []) out.push(`    ${l.speaker} (${l.voice}): ${l.text}`);
      if (e.mapUpdates?.length) out.push(`    updates: ${JSON.stringify(e.mapUpdates)}`);
      if (e.problems?.length) out.push(`    problems: ${e.problems.join(' | ')}`);
      if (e.error) out.push(`    ERROR ${e.status || ''}: ${e.error}`);
      if (e.aborted) out.push('    (the page went away before the reply was finished; nothing was applied)');
      if (e.blocks) out.push(`    reply blocks (characters): ${e.blocks}${e.effort ? ', effort ' + e.effort : ''}`);
      out.push(`    (${e.totalMs} ms in all, ${e.apiMs} ms waiting for the model${e.usage ? `, ${e.usage.input_tokens} input + ${e.usage.cache_read_input_tokens || 0} cached tokens in, ${e.usage.output_tokens} out` : ''})`);
    } else if (e.kind === 'table') {
      out.push(`[${time}]   table (${e.what}): ${e.detail}`);
    } else if (e.kind === 'speech') {
      out.push(`[${time}] voice: ${e.what}${e.detail ? ' - ' + e.detail : ''}`);
    } else {
      out.push(`[${time}] ${e.kind}: ${JSON.stringify(e)}`);
    }
  }
  return out.join('\n');
}
