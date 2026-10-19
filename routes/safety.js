// safety tools: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { readSafety, writeSafety } from '../lib/safety.js';
import path from 'node:path';

export function registerSafety(app, deps) {
  app.get('/api/campaigns/:id/safety', deps.asyncRoute(async (req, res) => {
    res.json(await readSafety(path.join(deps.CAMPAIGNS_DIR, deps.safeCampaignId(req.params.id))));
  }));

  app.put('/api/campaigns/:id/safety', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.params.id);
    if (!id || !(await deps.campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
    res.json(await writeSafety(path.join(deps.CAMPAIGNS_DIR, id), req.body));
  }));
}
