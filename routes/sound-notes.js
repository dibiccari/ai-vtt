// sound review notes: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

export function registerSoundNotes(app, deps) {
  const SOUND_FEEDBACK_FILE = path.join(deps.__dirname, 'data', 'sound-feedback.json');
  app.get('/api/sound-feedback', deps.asyncRoute(async (_req, res) => {
    try { res.json(JSON.parse(await readFile(SOUND_FEEDBACK_FILE, 'utf8'))); } catch { res.json({}); }
  }));
  app.put('/api/sound-feedback', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const clean = {};
    for (const [key, v] of Object.entries(req.body && typeof req.body === 'object' ? req.body : {}).slice(0, 80)) {
      if (!/^[a-z0-9-]{1,30}:[a-z0-9-]{1,30}$/.test(key)) continue;
      clean[key] = { rating: ['good', 'close', 'wrong'].includes(v?.rating) ? v.rating : '', note: String(v?.note ?? '').slice(0, 500) };
    }
    await writeFile(SOUND_FEEDBACK_FILE, JSON.stringify(clean, null, 2));
    res.json({ ok: true, saved: Object.keys(clean).length });
  }));
}
