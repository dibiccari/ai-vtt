// campaign selector API: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import { readFile, writeFile, mkdir, readdir, copyFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { cleanMapList } from '../lib/campaign-maps.js';
import { writeSettings } from '../lib/settings.js';

export function registerCampaignSelector(app, deps) {
  app.get('/api/campaigns', deps.asyncRoute(async (_req, res) => {
    const active = await deps.chosenCampaignId();
    const campaigns = [];
    for (const id of await deps.campaignIds()) {
      const meta = await deps.readCampaignMeta(id);
      const files = await deps.campaignFiles(id);
      const totalChars = files.reduce((n, f) => n + f.chars, 0);
      let voiceCount = 0;
      try { voiceCount = Object.keys(await deps.loadCharacterVoices(id)).length; } catch { /* none */ }
      campaigns.push({
        party: (await deps.listCharacters(id)).map((ch) => ({ id: ch.id, name: ch.name, class: ch.class, level: ch.level, color: ch.color, image: ch.image || '' })),
        id, template: meta.template || id, name: meta.name, system: meta.system, levels: meta.levels, description: meta.description, test: Boolean(meta.test), custom: Boolean(meta.custom),
        active: id === active,
        files: files.map((f) => ({ name: f.name, chars: f.chars })),
        totalChars, approxTokens: Math.round(totalChars / 4), voiceCount
      });
    }
    let returnTo = '';
    try { returnTo = deps.safeCampaignId(JSON.parse(await readFile(deps.ACTIVE_CAMPAIGN_FILE, 'utf8')).returnTo); } catch { /* none */ }
    res.json({ active, returnTo: returnTo && returnTo !== active ? returnTo : '', campaigns });
  }));

  // The party of a campaign (character ids), read and changed from the Campaigns page.
  app.get('/api/campaigns/:id/party', deps.asyncRoute(async (req, res) => {
    res.json({ party: (await deps.listCharacters(deps.safeCampaignId(req.params.id))).map((c) => c.id) });
  }));

  app.put('/api/campaigns/:id/party', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.params.id);
    if (!id || !(await deps.campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
    const known = new Set((await deps.listCharacters()).map((c) => c.id));
    const party = (Array.isArray(req.body?.party) ? req.body.party : []).map((x) => deps.canonId(x)).filter((x) => known.has(x));
    if (!party.length) return res.status(400).json({ error: 'A campaign needs at least one character.' });
    let saved = {};
    try { saved = JSON.parse(await readFile(path.join(deps.CAMPAIGNS_DIR, id, 'campaign.json'), 'utf8')); } catch { /* built-in campaigns have no campaign.json yet */ }
    await writeFile(path.join(deps.CAMPAIGNS_DIR, id, 'campaign.json'), JSON.stringify({ ...saved, party }, null, 2));
    res.json({ ok: true, party });
  }));

  // Start another playthrough of a campaign: copies its documents, voices and maps list (so the maps and their starting positions are already chosen) and takes the party and table settings from the request; its journal, party stash and chat start empty.
  // A campaign built from nothing (the wizard's "Build my own"): its own name, a premise written for the DM, the maps picked from the uploaded pictures, a party and the table settings.
  async function createScratchCampaign(req, res) {
    const ids = await deps.campaignIds();
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Give the campaign a name.' });
    let id = deps.safeCampaignId(name.replace(/\s+/g, '-')) || 'campaign';
    for (let n = 2; ids.includes(id); n++) id = deps.safeCampaignId(`${id.replace(/-\d+$/, '')}-${n}`);
    const known = new Set((await deps.listCharacters()).map((c) => c.id));
    const party = (Array.isArray(req.body?.party) ? req.body.party : []).map((x) => deps.canonId(x)).filter((x) => known.has(x));
    if (!party.length) return res.status(400).json({ error: 'Pick at least one character for the party (make new ones on the Character Sheets page first).' });
    const premise = String(req.body?.premise ?? '').trim().slice(0, 20000);
    const { list, problems } = cleanMapList(req.body?.maps, await deps.pictureFiles());
    const dest = path.join(deps.CAMPAIGNS_DIR, id);
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, 'campaign.json'), JSON.stringify({ name, template: id, system: 'D&D 5th Edition', levels: String(req.body?.levels ?? '').slice(0, 40), description: premise.split(/\n/)[0].slice(0, 200), party, custom: true }, null, 2));
    if (premise) await writeFile(path.join(dest, '00-premise.md'), `# ${name}\n\n${premise}\n`);
    await writeFile(path.join(dest, 'maps.json'), JSON.stringify({ maps: list }, null, 2));
    await writeSettings(dest, req.body?.settings);
    res.json({ ok: true, id, name, template: id, party, maps: list.length, problems });
  }

  app.post('/api/campaigns/new', deps.localOnly, deps.asyncRoute(async (req, res) => {
    if (req.body?.scratch === true) return createScratchCampaign(req, res);
    const from = deps.safeCampaignId(req.body?.template);
    const ids = await deps.campaignIds();
    if (!from || !ids.includes(from)) return res.status(404).json({ error: 'No such campaign to copy' });
    const root = await deps.templateOfCampaign(from);
    const base = await deps.readCampaignMeta(root);
    const name = String(req.body?.name ?? '').trim().slice(0, 80) || `${base.name} (new)`;
  let id = deps.safeCampaignId(name.replace(/\s+/g, '-')) || deps.safeCampaignId(root + '-new');
    for (let n = 2; ids.includes(id); n++) id = deps.safeCampaignId(`${id.replace(/-\d+$/, '')}-${n}`);
    const src = path.join(deps.CAMPAIGNS_DIR, root), dest = path.join(deps.CAMPAIGNS_DIR, id);
    await mkdir(dest, { recursive: true });
    for (const f of await readdir(src)) {
      if (/\.(md|txt)$/i.test(f) || ['voices.json', 'maps.json', 'pronunciations.json', 'relevance.json'].includes(f)) await copyFile(path.join(src, f), path.join(dest, f));
    }
    const known = new Set((await deps.listCharacters()).map((c) => c.id));
    const party = (Array.isArray(req.body?.party) ? req.body.party : []).map((x) => deps.canonId(x)).filter((x) => known.has(x));
    if (!party.length) { await rm(dest, { recursive: true, force: true }); return res.status(400).json({ error: 'Pick at least one character for the party (make new ones on the Character Sheets page first).' }); }
    await writeFile(path.join(dest, 'campaign.json'), JSON.stringify({ name, template: root, system: base.system, levels: base.levels, description: base.description, party }, null, 2));
    await writeSettings(dest, req.body?.settings);
    res.json({ ok: true, id, name, template: root, party });
  }));

  app.post('/api/campaigns/active', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const id = deps.safeCampaignId(req.body?.id);
    if (!id || !(await deps.campaignIds()).includes(id)) return res.status(404).json({ error: 'No such campaign' });
    // returnTo: the campaign to go back to after a side trip (the Test Lab remembers the one you were playing). Switching normally forgets it.
    const asked = deps.safeCampaignId(req.body?.returnTo);
    const returnTo = asked && asked !== id && (await deps.campaignIds()).includes(asked) ? asked : '';
    await writeFile(deps.ACTIVE_CAMPAIGN_FILE, JSON.stringify(returnTo ? { id, returnTo } : { id }, null, 2));
    res.json({ ok: true, active: id, returnTo });
  }));

  function campaignFilePath(id, name) {
    const cid = deps.safeCampaignId(id);
    if (!cid || !deps.CAMPAIGN_FILE_RE.test(String(name ?? ''))) throw Object.assign(new Error('Invalid campaign or file name'), { status: 400 });
    return path.join(deps.CAMPAIGNS_DIR, cid, path.basename(String(name)));
  }

  app.get('/api/campaigns/:id/files/:name', deps.asyncRoute(async (req, res) => {
    try {
      const text = await readFile(campaignFilePath(req.params.id, req.params.name), 'utf8');
      res.json({ name: req.params.name, chars: text.length, text: text.slice(0, 200000) });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      throw err;
    }
  }));

  app.put('/api/campaigns/:id/files/:name', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const text = String(req.body?.text ?? '');
    if (!text.trim()) return res.status(400).json({ error: 'text is required' });
    if (text.length > 3_000_000) return res.status(413).json({ error: 'File is too large (3 million characters at most)' });
    const file = campaignFilePath(req.params.id, req.params.name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
    res.json({ ok: true, chars: text.trim().length });
  }));

  app.delete('/api/campaigns/:id/files/:name', deps.localOnly, deps.asyncRoute(async (req, res) => {
    try {
      await unlink(campaignFilePath(req.params.id, req.params.name));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      throw err;
    }
    res.json({ ok: true });
  }));
}
