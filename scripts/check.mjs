// Syntax-checks server.js and the inline <script> of public/index.html and public/map-test.html.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
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

const dir = await mkdtemp(path.join(tmpdir(), 'vtt-check-'));
for (const page of ['index.html', 'map-test.html']) {
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
