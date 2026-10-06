// Test sandbox: runs the real server.js on a random port inside a throwaway COPY of the app (code + data), so tests never touch the real data/ folder.
// The big read-only folders (picture and token art, audio) are symlinked instead of copied. Optionally points the Anthropic SDK at a fake API.
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, symlink, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function makeSandbox(prefix = 'vtt-sandbox-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  for (const f of ['server.js', 'package.json']) await cp(path.join(ROOT, f), path.join(dir, f));
  await cp(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true });
  await cp(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  await mkdir(path.join(dir, 'public'));
  const BIG = new Set(['uploads', 'tokens', 'audio', 'scenarios', 'vendor']);
  for (const name of await readdir(path.join(ROOT, 'public'))) {
    const from = path.join(ROOT, 'public', name), to = path.join(dir, 'public', name);
    if (BIG.has(name)) await symlink(from, to); else await cp(from, to, { recursive: true });
  }
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

// Start server.js in a sandbox. opts.env adds environment variables; no API key is set unless opts.env provides one.
export async function startServer({ env = {}, sandbox } = {}) {
  const sb = sandbox || await makeSandbox();
  const port = 20000 + Math.floor(Math.random() * 20000);
  const childEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  delete childEnv.ANTHROPIC_API_KEY; delete childEnv.OPENAI_API_KEY; delete childEnv.ANTHROPIC_BASE_URL;
  Object.assign(childEnv, env);
  const child = spawn(process.execPath, ['server.js'], { cwd: sb.dir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start in 20 s\n' + log)), 20000);
    const check = setInterval(() => { if (log.includes('AI-VTT running')) { clearTimeout(t); clearInterval(check); resolve(); } }, 50);
    child.on('exit', (code) => { clearTimeout(t); clearInterval(check); reject(new Error(`server exited early (${code})\n${log}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  return {
    dir: sb.dir, port, base, log: () => log, call,
    get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b ?? {}), del: (u) => call('DELETE', u),
    async stop() { child.kill(); await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); }); await sb.remove(); }
  };
}

// A minimal fake of the Anthropic Messages API: answers every request with the next item of `replies` (a function(request) or an object that becomes the DM's JSON reply).
export async function fakeAnthropic(replies) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let parsed = {}; try { parsed = JSON.parse(body); } catch { /* ignore */ }
      requests.push(parsed);
      const next = replies.length > 1 ? replies.shift() : replies[0];
      const out = typeof next === 'function' ? next(parsed) : next;
      res.setHeader('content-type', 'application/json');
      if (out && out.__status) { res.statusCode = out.__status; return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: out.__message || 'fake error' } })); }
      const stop = out && out.__stop ? out.__stop : 'end_turn';
      res.end(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model: 'fake', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { __set: (r) => { replies.length = 0; replies.push(r); }, url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

// Pull the BOARD STATE JSON out of a chat request sent to the (fake) API.
export function boardStateOf(request) {
  const last = request.messages[request.messages.length - 1];
  const text = Array.isArray(last.content) ? last.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : last.content;
  const m = /BOARD STATE \(JSON\):\n(.*)\n\nPLAYER ACTION/.exec(text);
  return m ? JSON.parse(m[1]) : null;
}
