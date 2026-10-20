// Exactly once per request. The table gives every message it sends the DM an ID; the server remembers the IDs it has finished and the one it is working on.
// The same ID arriving again (a double press, a connection that was retried, a second tab) gets the first answer back and changes nothing a second time; while the first is still being worked on it is refused.
// A request that failed is forgotten, so sending it again runs it. In memory only: a restart forgets the IDs, and a request that was running then was never finished anyway.
const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

export const validRequestId = (id) => (typeof id === 'string' && ID_RE.test(id) ? id : '');

export function createRequestLedger({ ttlMs = 15 * 60 * 1000, max = 300 } = {}) {
  const entries = new Map();          // id -> { state: 'running' | 'done', reply, at }
  const sweep = (now) => {
    for (const [id, e] of entries) if (now - e.at > ttlMs) entries.delete(id);
    while (entries.size > max) entries.delete(entries.keys().next().value);       // the oldest first (a Map keeps insertion order)
  };
  return {
    // { fresh: true } when this request should run now; otherwise { fresh: false, state: 'done', reply } or { fresh: false, state: 'running' }.
    begin(id, now = Date.now()) {
      const key = validRequestId(id);
      if (!key) return { fresh: true };          // no ID, no protection (an older page)
      sweep(now);
      const e = entries.get(key);
      if (!e) { entries.set(key, { state: 'running', at: now }); sweep(now); return { fresh: true }; }       // trimmed again after adding, so the bound is never passed
      return e.state === 'done' ? { fresh: false, state: 'done', reply: e.reply } : { fresh: false, state: 'running' };
    },
    done(id, reply, now = Date.now()) { const key = validRequestId(id); if (key && entries.get(key)?.state === 'running') entries.set(key, { state: 'done', reply, at: now }); },
    fail(id) { const key = validRequestId(id); if (key && entries.get(key)?.state === 'running') entries.delete(key); },
    size: () => entries.size
  };
}
