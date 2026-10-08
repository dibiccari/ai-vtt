// Syntax-checks server.js and the inline <script> of public/index.html, map-test.html, tokens.html, characters.html, campaigns.html and test-lab.html.
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

function check(label, file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`OK   ${label}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${label}\n${err.stderr?.toString() || err.message}`);
  }
}

check('server.js', path.join(root, 'server.js'));

// Every installed battle map must have a saved start spot (data/maps/<image>.json, starts[name 'start']).
const { CAMPAIGN_MAPS, mapsFor } = await import(path.join(root, 'lib', 'campaign-maps.js'));
const { listPictures, readSets } = await import(path.join(root, 'lib', 'pictures.js'));
const uploads = listPictures(root);
const sets = readSets(root, readFileSync);
for (const campaign of Object.keys(CAMPAIGN_MAPS)) {
  for (const m of mapsFor(campaign, uploads).filter((x) => x.kind === 'battle' || x.kind === 'camp')) {
    // The set-up lives in the map set file of the place (data/mapsets/<guid>.json) that holds the picture.
    const file = m.url.split('/').pop();
    const hit = sets.find((set) => (set.levels || []).some((lv) => (lv.looks || []).some((l) => l.player === file)));
    const starts = hit ? hit.levels.find((lv) => lv.looks.some((l) => l.player === file)).starts || [] : [];
    if (starts.some((s) => s.name === 'start')) console.log(`OK   start spot: ${campaign}/${m.id}`);
    else { failed = true; console.error(`FAIL ${campaign}/${m.id} has no start spot: open Map Test, choose Set start and click where the party arrives`); }
  }
}
for (const file of ['lib/sheet-edit.js', 'lib/party.js', 'lib/journal.js', 'lib/compendium.js', 'lib/safety.js', 'public/scenes.js', 'public/wallobjects.js', 'public/flicker.js', 'public/ambience.js', 'public/uvtt.js', 'public/pdf-extract.js', 'public/nav.js', 'public/voice-fx.js']) check(file, path.join(root, file));

const dir = await mkdtemp(path.join(tmpdir(), 'vtt-check-'));
for (const page of ['index.html', 'map-test.html', 'tokens.html', 'characters.html', 'campaigns.html', 'test-lab.html', 'journal.html', 'party.html', 'bestiary.html', 'spells.html', 'sound-test.html', 'maps.html', 'image-test.html', 'image-bakeoff.html', 'market.html', 'coast.html', 'map-maker.html', 'conditions-test.html', 'voice-test.html', 'settings.html']) {
  const html = await readFile(path.join(root, 'public', page), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) {
    failed = true;
    console.error(`FAIL ${page}: no inline <script> found`);
  }
  for (const [i, code] of scripts.entries()) {
    const file = path.join(dir, `${page}-${i}.js`);
    await writeFile(file, code);
    check(`${page} inline script #${i + 1} (${code.split('\n').length} lines)`, file);
  }
}
await rm(dir, { recursive: true, force: true });

process.exit(failed ? 1 : 0);
