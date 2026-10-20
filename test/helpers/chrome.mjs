// Headless Chrome driven over the DevTools protocol, with no dependencies (needs Node's WebSocket: `node --experimental-websocket` on Node 20, built in from 22).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const CALL_TIMEOUT_MS = Number(process.env.VTT_CALL_TIMEOUT_MS) || 120000;       // how long a call to the page may go unanswered
export const findChrome = () => CHROME_PATHS.find((p) => existsSync(p)) || null;
export const skipReason = () => (!findChrome() ? 'Chrome is not installed (set CHROME_PATH)' : typeof WebSocket === 'undefined' ? 'no WebSocket in this Node: run with node --experimental-websocket (npm run test:browser does)' : '');

export async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'vtt-chrome-'));
  const child = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio', '--window-size=1400,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Chrome did not report a debugging port in 20 s\n' + err)), 20000);
    child.stderr.on('data', (d) => { err += d; const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(err); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`Chrome exited (${c})\n${err}`)); });
  });
  const targetRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await targetRes.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
  let id = 0;
  const pending = new Map();
  const problems = [];
  const waiters = [], pausedWaiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); return; }
    if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Page.loadEventFired') while (waiters.length) waiters.shift()();
    if (msg.method === 'Debugger.paused') pausedWaiters.splice(0).forEach((w) => w(msg.params.callFrames || []));
    if (msg.method === 'Page.javascriptDialogOpening') {          // alert, confirm, prompt or beforeunload: the page stays frozen until somebody answers, so answer it and say so
      problems.push(`dialog: ${msg.params.type} "${String(msg.params.message).slice(0, 120)}"`);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  };
  // Where a page that stopped answering is stuck: pause its JavaScript through the debugger and read the stack (a busy loop shows its own lines), or say that it cannot be paused.
  const diagnose = async () => {
    const quick = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    const answers = await quick(send('Runtime.evaluate', { expression: '1' }).then(() => 'yes', () => 'no'));
    if (answers === 'yes') return 'the page still answers a simple query, so the script that was sent is waiting inside it';
    const frames = new Promise((r) => pausedWaiters.push(r));
    ws.send(JSON.stringify({ id: ++id, method: 'Debugger.pause' }));
    const stack = await quick(frames);
    ws.send(JSON.stringify({ id: ++id, method: 'Debugger.resume' }));
    return stack === 'timeout' ? 'the page does not answer and cannot be paused (its JavaScript thread is not running)' : 'the page is busy; stack: ' + stack.slice(0, 6).map((f) => `${f.functionName || '(anonymous)'} ${String(f.url).split('/').slice(-2).join('/')}:${f.location.lineNumber + 1}`).join(' < ');
  };
  // A reply that never comes (seen now and then in a long run: a script waiting inside the page whose answer is lost) fails that one call after two minutes, instead of freezing the whole suite.
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(async () => { pending.delete(n); const alive = method === 'Runtime.evaluate' && params.expression !== '1' ? await diagnose() : ''; reject(new Error(`no answer from the page to ${method} in ${Math.round(CALL_TIMEOUT_MS / 1000)} s${alive ? ' [' + alive + ']' : ''}${params.expression ? ': ' + String(params.expression).replace(/\s+/g, ' ').slice(0, 160) : ''}`)); }, CALL_TIMEOUT_MS);
    pending.set(n, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable'); await send('Debugger.enable');       // on from the start: a page that is stuck in a loop can only be paused if the debugger was already on
  // The drifting fog redraws the whole map many times a second, which starves a software-rendered headless page; tests look at the fog's shape, not its motion.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('vtt.fogMotion', 'off'); } catch (e) {}" });
  const api = {
    problems,
    // Script run in every page before its own scripts (to fake the microphone and speech recognition, for example).
    async addInitScript(source) { await send('Page.addScriptToEvaluateOnNewDocument', { source }); },
    // A load that never reports (it happens now and then in a long run) is tried again instead of hanging the whole suite.
    async goto(url) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const loaded = new Promise((r) => waiters.push(r));
        await send('Page.navigate', { url });
        const done = await Promise.race([loaded.then(() => true), new Promise((r) => setTimeout(() => r(false), 30000))]);
        if (done) return;
        console.error(`chrome: ${url} did not finish loading in 30 s (try ${attempt} of 3)`);
      }
      throw new Error('the page did not finish loading: ' + url);
    },
    // Evaluate an expression (or an async IIFE) in the page and return its JSON value. Page-level `const` and functions of the tabletop script are visible.
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    // A PNG of the page (as a Buffer), to look at with the Read tool.
    async screenshot() { const r = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(r.data, 'base64'); },
    async waitFor(expression, ms = 15000) {
      const end = Date.now() + ms;
      for (;;) { let v = false; try { v = await api.eval(expression); } catch { /* page not ready */ } if (v) return v; if (Date.now() > end) throw new Error('timed out waiting for: ' + expression); await new Promise((r) => setTimeout(r, 100)); }
    },
    async close() { try { ws.close(); } catch { /* closed */ } child.kill(); await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); }); await rm(profile, { recursive: true, force: true }); }
  };
  return api;
}
