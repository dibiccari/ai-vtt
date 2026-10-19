// table settings: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { writeTavernParty } from '../lib/tavern-party.js';
import { rollExpr } from '../lib/dice.js';
import { readSettings, writeSettings } from '../lib/settings.js';
import path from 'node:path';

export function registerTableSettings(app, deps) {
  // The Test Lab starts the tavern scenario with its four characters back at their starting kit and full hit points.
  app.post('/api/test-lab/reset-party', deps.localOnly, deps.asyncRoute(async (_req, res) => {
    const party = await writeTavernParty(deps.CHAR_DIR, { keepHp: false, resolve: deps.canonId });
    res.json({ ok: true, party: party.map((c) => ({ id: c.id, name: c.name, hp: c.hp, maxHp: c.maxHp })) });
  }));

  // Real dice, for the tabletop's Roll for me button (free: no AI call).
  app.post('/api/roll', (req, res) => {
    try {
      const mode = ['advantage', 'disadvantage'].includes(req.body?.mode) ? req.body.mode : 'normal';
      res.json(rollExpr(req.body?.expr ?? 'd20', mode));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.get('/api/campaigns/:id/settings', deps.asyncRoute(async (req, res) => {
    res.json(await readSettings(path.join(deps.CAMPAIGNS_DIR, deps.safeCampaignId(req.params.id))));
  }));

  app.put('/api/campaigns/:id/settings', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.params.id);
    if (!id || !(await deps.campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
    res.json(await writeSettings(path.join(deps.CAMPAIGNS_DIR, id), req.body));
  }));
}
