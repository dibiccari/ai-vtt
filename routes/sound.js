// sound takes: several recordings per effect to choose from by ear: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import path from 'node:path';
import { readFile, readdir, unlink, copyFile, writeFile } from 'node:fs/promises';

export function registerSoundTakes(app, deps) {
  // public/audio/candidates/<effect>-<name>.mp3 with a manifest.json [{effect, file, title, url}]; choosing one copies it to public/audio/sfx-<effect>.mp3.
  const CANDIDATE_DIR = path.join(deps.PUBLIC_DIR, 'audio', 'candidates');
  const SOUND_CHOICES_FILE = path.join(deps.__dirname, 'data', 'sound-choices.json');
  const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
  app.get('/api/sound-candidates', deps.asyncRoute(async (_req, res) => {
    const manifest = await readJson(path.join(CANDIDATE_DIR, 'manifest.json'), []);
    const have = new Set((await readdir(CANDIDATE_DIR).catch(() => [])));
    const byEffect = {};
    for (const c of manifest) if (have.has(c.file)) (byEffect[c.effect] ||= []).push({ file: c.file, title: c.title, url: c.url });
    res.json({ candidates: byEffect, chosen: await readJson(SOUND_CHOICES_FILE, {}) });
  }));
  app.post('/api/sound-choice', deps.localOnly, deps.asyncRoute(async (req, res) => {
    const effect = String(req.body?.effect ?? '').replace(/[^a-z0-9-]/g, '');
    const file = path.basename(String(req.body?.file ?? ''));
    const manifest = await readJson(path.join(CANDIDATE_DIR, 'manifest.json'), []);
    if (!manifest.some((c) => c.effect === effect && c.file === file)) return res.status(400).json({ error: 'That is not a candidate for this sound.' });
    for (const f of await readdir(path.join(deps.PUBLIC_DIR, 'audio'))) if (new RegExp(`^sfx-${effect}\\.(mp3|ogg|wav|m4a|webm|flac)$`, 'i').test(f)) await unlink(path.join(deps.PUBLIC_DIR, 'audio', f));
    await copyFile(path.join(CANDIDATE_DIR, file), path.join(deps.PUBLIC_DIR, 'audio', `sfx-${effect}.mp3`));
    const chosen = await readJson(SOUND_CHOICES_FILE, {});
    chosen[effect] = file;
    await writeFile(SOUND_CHOICES_FILE, JSON.stringify(chosen, null, 2));
    res.json({ ok: true, effect, file });
  }));

  return { readJson };
}
