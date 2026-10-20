// saved game: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { liveHandler, revisionOf } from '../lib/live.js';
import { replaceEntries } from '../lib/journal.js';
import { writeStash } from '../lib/party.js';

export function registerSavedGame(app, deps) {
  // The tabletop keeps its board and chat in the browser for speed and mirrors them here, so the game survives clearing the browser
  // and can be continued from another computer. data/campaigns/<id>/game.json {savedAt, board, chat}; fog.json {<map url>: png data URL}.

  const gamePaths = (id) => ({ game: path.join(deps.CAMPAIGNS_DIR, id, 'game.json'), fog: path.join(deps.CAMPAIGNS_DIR, id, 'fog.json') });
  async function readJsonOr(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
  async function writeJsonAtomic(file, value) {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;       // one name per write, so overlapping saves cannot trample each other's temporary file
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
  }
  async function gameCampaign(req, res) {
    const id = deps.safeCampaignId(req.params.id);
    if (!id || !(await deps.campaignIds()).includes(id)) { res.status(404).json({ error: 'No such campaign' }); return null; }
    return id;
  }

  app.get('/api/campaigns/:id/live', liveHandler(gameCampaign));          // server-sent events: see lib/live.js and docs/multiplayer-plan.md
  app.get('/api/campaigns/:id/game', deps.asyncRoute(async (req, res) => {
    const id = await gameCampaign(req, res); if (!id) return;
    const p = gamePaths(id);
    const game = await readJsonOr(p.game, null);
    res.json({ rev: revisionOf(id), savedAt: game?.savedAt || 0, board: game?.board || null, chat: game?.chat || [], fog: await readJsonOr(p.fog, {}) });
  }));

  app.put('/api/campaigns/:id/game', deps.asyncRoute(async (req, res) => {
    const id = await gameCampaign(req, res); if (!id) return;
    const board = req.body?.board && typeof req.body.board === 'object' && !Array.isArray(req.body.board) ? req.body.board : null;
    if (!board) return res.status(400).json({ error: 'No board to save' });
    const chat = (Array.isArray(req.body?.chat) ? req.body.chat : []).slice(-200);
    const savedAt = Number.isFinite(Number(req.body?.savedAt)) ? Number(req.body.savedAt) : Date.now();
    await writeJsonAtomic(gamePaths(id).game, { savedAt, board, chat });
    res.json({ ok: true, savedAt });
  }));

  app.put('/api/campaigns/:id/game/fog', deps.asyncRoute(async (req, res) => {
    const id = await gameCampaign(req, res); if (!id) return;
    const mapUrl = String(req.body?.mapUrl ?? '');
    const data = String(req.body?.data ?? '');
    if (!/^(\/uploads\/[A-Za-z0-9._-]{1,120}|set-[0-9a-f-]{36})$/i.test(mapUrl) || !data.startsWith('data:image/png;base64,') || data.length > 8_000_000) return res.status(400).json({ error: 'Not a fog image' });
    const p = gamePaths(id);
    const fog = await readJsonOr(p.fog, {});
    fog[mapUrl] = data;
    await writeJsonAtomic(p.fog, fog);
    res.json({ ok: true });
  }));

  // Start a campaign over: forget everything the story has built up. The saved game (board, chat, fog), the journal the DM reads every turn and
  // the party's shared stash all go; documents, settings, maps, party and the characters themselves stay.
  app.post('/api/campaigns/:id/start-over', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = await gameCampaign(req, res); if (!id) return;
    const dir = path.join(deps.CAMPAIGNS_DIR, id);
    await replaceEntries(dir, []);
    await writeStash(dir, {});
    for (const f of Object.values(gamePaths(id))) { try { await unlink(f); } catch { /* nothing saved */ } }
    try { await unlink(path.join(dir, 'merchants.json')); } catch { /* no shopkeeper remembered */ }       // shopkeepers forget the party too
    deps.rewardGuard.reset(id);                                                                          // and so does the memory of which rewards were just made
    res.json({ ok: true });
  }));

  // Forget the saved game of a campaign.
  app.delete('/api/campaigns/:id/game', deps.asyncRoute(async (req, res) => {
    const id = await gameCampaign(req, res); if (!id) return;
    const p = gamePaths(id);
    for (const f of [p.game, p.fog]) { try { await unlink(f); } catch { /* nothing saved */ } }
    res.json({ ok: true });
  }));

  return { writeJsonAtomic };
}
