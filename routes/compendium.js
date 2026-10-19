// compendium: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { listEntries, getEntry } from '../lib/compendium.js';

export function registerCompendium(app, deps) {
  app.get('/api/compendium/:kind', deps.asyncRoute(async (req, res) => {
    const entries = await listEntries(req.params.kind);
    if (!entries) return res.status(404).json({ error: 'Unknown compendium' });
    res.json({ entries });
  }));

  app.get('/api/compendium/:kind/:index', deps.asyncRoute(async (req, res) => {
    const entry = await getEntry(req.params.kind, String(req.params.index).toLowerCase().replace(/[^a-z0-9-]/g, ''));
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ entry });
  }));
}
