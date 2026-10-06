// Live updates (multiplayer prep, phase 0): a revision counter per campaign and a server-sent-events stream.
// Any successful write (PUT/POST/DELETE) under /api/campaigns/:id/..., or to characters, party or the DM chat, bumps the revision
// and tells every connected viewer what kind of thing changed. Nothing here changes single-player behaviour.
const clients = new Map();            // campaign id -> Set of response objects
const revisions = new Map();          // campaign id -> number (in memory; restarts at 1, viewers just refetch)

export const revisionOf = (id) => revisions.get(id) || 1;

export function announce(id, scope) {
  const rev = revisionOf(id) + 1;
  revisions.set(id, rev);
  const msg = `event: change\ndata: ${JSON.stringify({ rev, scope, at: Date.now() })}\n\n`;
  for (const res of clients.get(id) || []) { try { res.write(msg); } catch { /* closed */ } }
}

// Express middleware: watches finished responses and announces the changes they made.
export function liveMiddleware(activeId, allIds) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.path.startsWith('/api/')) return next();
    res.on('finish', async () => {
      if (res.statusCode >= 400) return;
      try {
        const m = req.path.match(/^\/api\/campaigns\/([^/]+)\/([^/]+)/);
        if (m && m[1] !== 'active' && m[1] !== 'new') return announce(m[1], m[2]);   // game, journal, party, settings, safety, maps...
        if (/^\/api\/(characters|party|chat|roll)/.test(req.path)) {
          if (req.path.startsWith('/api/roll')) return;
          const scope = req.path.startsWith('/api/chat') ? 'chat' : 'party';
          for (const id of await allIds()) announce(id, scope);
        }
      } catch { /* announcing must never break a request */ }
    });
    next();
  };
}

// GET /api/campaigns/:id/live  (text/event-stream). Sends the current revision at once, then one event per change and a ping every 25 s.
export function liveHandler(checkId) {
  return async (req, res) => {
    const id = await checkId(req, res); if (!id) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ rev: revisionOf(id), scope: 'hello', at: Date.now() })}\n\n`);
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(ping); clients.get(id)?.delete(res); });
  };
}
