// journal / save file API: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { readSave, replaceEntries, journalForPrompt } from '../lib/journal.js';
import Anthropic from '@anthropic-ai/sdk';

export function registerJournal(app, deps) {
  const campaignDir = (id) => {
    const cid = deps.safeCampaignId(id);
    if (!cid) throw Object.assign(new Error('Invalid campaign'), { status: 400 });
    return path.join(deps.CAMPAIGNS_DIR, cid);
  };

  app.get('/api/campaigns/:id/journal', deps.asyncRoute(async (req, res) => {
    res.json(await readSave(campaignDir(req.params.id)));
  }));

  // Replace the journal: deleting one entry, importing a save, or starting over (an empty list).
  app.put('/api/campaigns/:id/journal', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const entries = await replaceEntries(campaignDir(req.params.id), req.body?.entries);
    res.json({ ok: true, count: entries.length });
  }));

const RECAP_SYSTEM = `You are the Dungeon Master of a Dungeons & Dragons game, opening a new session. Write a "Previously on..." recap for the players from the journal you are given: 2 to 4 short paragraphs, spoken aloud, vivid but brief, in order, covering what the party did, who they met, what is unresolved, and the promises they made. End with where they stand now and a line that invites them to continue. Use only what the journal says; do not invent events or reveal secrets. Plain text only, no lists or headings.`;

  app.post('/api/recap', deps.asyncRoute(async (_req, res) => {
    const id = await deps.getActiveCampaignId();
    const text = journalForPrompt((await readSave(campaignDir(id))).entries);
    if (!text) {
      const narrative = 'There is nothing to recap yet: the journal is empty. Play a little and the Dungeon Master will start writing it.';
      return res.json({ narrative, voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }], empty: true });
    }
    if (!deps.settings.anthropic) return res.status(503).json({ error: 'The AI Dungeon Master is offline: no ANTHROPIC_API_KEY is configured.' });
    try {
      const response = await deps.settings.anthropic.messages.create({ model: deps.settings.MODEL, max_tokens: 1500, system: RECAP_SYSTEM, messages: [{ role: 'user', content: `JOURNAL:\n${text}` }] });
      deps.usageTracker.record(response.model || deps.settings.MODEL, response.usage, await deps.getActiveCampaignId().catch(() => ''), 'recap');
      const block = response.content.find((b) => b.type === 'text');
      const narrative = String(block?.text ?? '').trim();
      if (!narrative) throw new Error('The recap came back empty.');
      res.json({ narrative, voiceLines: [{ speaker: 'Narrator', voice: 'narrator', text: narrative }] });
    } catch (err) {
      if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `AI DM error: ${err.message}` });
      throw err;
    }
  }));
}
