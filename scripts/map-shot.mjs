// Opens Map Test on a map in headless Chrome (DevTools protocol), sets walls / fog / sight outline, can place one test token, and saves a screenshot.
// Usage: node --experimental-websocket scripts/map-shot.mjs --map <picture file or /uploads/path> --out shot.png [options]
//   --layout data/map-layouts/x.json   take the picture name, grid (cell, origin) and size from the layout, so --token and --clip can be given in cell units
//   --server http://127.0.0.1:3101     a running server (start one with PORT=3101 node server.js); never use the owner's server on 3000 for tests
//   --walls            show walls (red) and doors     --grid  show the grid     --poly  show the sight outline
//   --fog              fog of war on (with --token a token is placed; the party sees only what its line of sight reaches), --dm  DM view (see through fog), default off when --fog
//   --token c,r        put the single test token on the middle of cell (c,r) (column,row in layout cell units), or --token-px x,y in picture pixels
//   --clip c0,r0,c1,r1 zoom to this cell range (layout cell units) instead of the whole map
//   --size 1600x1000   browser window (default 1600x1000), --dsf 1 device scale factor, --chrome <path>
// Writes are blocked: the page's autosave (PUT /api/map-config) is cancelled, so a shot never changes data/maps. Needs macOS Chrome and node 20 (flag --experimental-websocket).
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (typeof WebSocket === 'undefined') { console.error('run with: node --experimental-websocket scripts/map-shot.mjs ...'); process.exit(1); }
const out = opt('out');
if (!out) { console.error('usage: node --experimental-websocket scripts/map-shot.mjs --map <file> --out shot.png [--layout l.json] [--walls] [--fog] [--dm] [--grid] [--poly] [--token c,r] [--clip c0,r0,c1,r1]'); process.exit(1); }
const layout = opt('layout') ? JSON.parse(await readFile(path.resolve(opt('layout')), 'utf8')) : null;
let mapArg = opt('map') || (layout && layout.picture);
if (!mapArg) { console.error('--map or --layout needed'); process.exit(1); }
const mapUrl = mapArg.startsWith('/uploads/') ? mapArg : '/uploads/' + path.basename(mapArg);
const server = opt('server', 'http://127.0.0.1:3101');
const [winW, winH] = opt('size', '1600x1000').split('x').map(Number);
const dsf = Number(opt('dsf', 1));
const chrome = opt('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = await mkdtemp(path.join(os.tmpdir(), 'mapshot-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', `--window-size=${winW},${winH}`, 'about:blank'], { stdio: 'ignore' });
let exitCode = 0;
try {
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = list.find((t) => t.type === 'page'); if (page) ws = page.webSocketDebuggerUrl; } catch { /* not up yet */ }
  }
  if (!ws) throw new Error('Chrome did not start');
  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(new Error('websocket failed')); });
  let id = 0; const waiting = new Map();
  sock.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Fetch.requestPaused') send(msg.params.request.method === 'GET' ? 'Fetch.continueRequest' : 'Fetch.failRequest', msg.params.request.method === 'GET' ? { requestId: msg.params.requestId } : { requestId: msg.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });   // paused requests: GETs continue, writes are failed
  await send('Emulation.setDeviceMetricsOverride', { width: winW, height: winH, deviceScaleFactor: dsf, mobile: false });
  await send('Page.navigate', { url: `${server}/map-test.html?map=${encodeURIComponent(mapUrl)}` });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { await sleep(250); ready = await evaluate(`(document.querySelector('#stats')||{}).textContent && /walls/.test(document.querySelector('#stats').textContent) && !/Loading/.test(document.querySelector('#banner').textContent)`).catch(() => false); }
  if (!ready) throw new Error('Map Test did not load ' + mapUrl + ' (is the server running at ' + server + '?)');
  const setCheck = (idName, v) => evaluate(`(() => { const e = document.querySelector('#${idName}'); e.checked = ${v}; e.dispatchEvent(new Event('change')); })()`);
  await setCheck('showWalls', flag('walls')); await setCheck('showGrid', flag('grid')); await setCheck('showPoly', flag('poly'));
  await setCheck('fog', flag('fog')); await setCheck('dm', flag('dm'));
  const stage = await evaluate(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const size = await evaluate(`new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.src = ${JSON.stringify(mapUrl)}; })`);
  const [W, H] = size;
  const fit = Math.min(stage.w / W, stage.h / H) * 0.96;
  let view = { scale: fit, ox: (stage.w - W * fit) / 2, oy: (stage.h - H * fit) / 2 };
  const toScreen = (px, py) => [stage.x + view.ox + px * view.scale, stage.y + view.oy + py * view.scale];
  const mouse = async (type, x, y, button = 'left', extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, ...extra });
  const click = async (x, y, button = 'left') => { const buttons = button === 'right' ? 2 : 1; await mouse('mouseMoved', x, y, 'none'); await mouse('mousePressed', x, y, button, { buttons }); await mouse('mouseReleased', x, y, button, { buttons: 0 }); };
  const cellToPx = (c, r) => [layout.origin[0] + c * layout.cell, layout.origin[1] + r * layout.cell];
  // the single test token
  let tokenAt = null;
  if (opt('token') || opt('token-px')) {
    if (opt('token')) { if (!layout) throw new Error('--token needs --layout (cell units); use --token-px for picture pixels'); const [c, r] = opt('token').split(',').map(Number); tokenAt = cellToPx(c + 0.5, r + 0.5); }
    else tokenAt = opt('token-px').split(',').map(Number);
    // remove the token parked on the start pin (if any), then place ours
    const cfg = await (await fetch(`${server}/api/map-config?map=${encodeURIComponent(path.basename(mapUrl))}`)).json().catch(() => ({}));
    const start = ((cfg.config || cfg).starts || []).find((p) => p.name === 'start');
    await evaluate(`document.querySelector('button.tool[data-tool=token]').click()`);
    if (start) { const [sx, sy] = toScreen(start.x, start.y); await click(sx, sy, 'right'); }
    const [tx, ty] = toScreen(tokenAt[0], tokenAt[1]);
    await click(tx, ty);
    await evaluate(`document.querySelector('#resetFogBtn').click()`);      // the token parked on the start pin explored its surroundings first: forget that
    const tokens = await evaluate(`(document.querySelector('#stats').textContent.match(/(\\d+) party tokens/) || [])[1]`);
    if (tokens !== '1') console.error('map-shot: warning, ' + tokens + ' test tokens on the map (expected 1): the fog shows what all of them see');
  } else {
    await evaluate(`document.querySelector('button.tool[data-tool=pan]').click()`);
  }
  // zoom to a cell range: wheel-zoom around the range centre, then pan the centre to the middle of the stage
  const clip = opt('clip');
  if (clip) {
    if (!layout) throw new Error('--clip needs --layout');
    const [c0, r0, c1, r1] = clip.split(',').map(Number);
    const [ax, ay] = cellToPx(c0, r0), [bx, by] = cellToPx(c1, r1);
    const want = Math.min(stage.w / (bx - ax), stage.h / (by - ay)) * 0.98;
    const mid = [(ax + bx) / 2, (ay + by) / 2];
    const [mx, my] = toScreen(mid[0], mid[1]);
    await mouse('mouseMoved', mx, my, 'none');
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mx, y: my, deltaX: 0, deltaY: -Math.log(want / view.scale) / 0.0015 });
    view = { scale: want, ox: mx - stage.x - (mid[0] * want), oy: my - stage.y - (mid[1] * want) };   // the point under the cursor stayed put
    await sleep(200);
    await evaluate(`document.querySelector('button.tool[data-tool=pan]').click()`);
    const [cx, cy] = [stage.x + stage.w / 2, stage.y + stage.h / 2];
    await mouse('mouseMoved', mx, my, 'none'); await mouse('mousePressed', mx, my); await mouse('mouseMoved', (mx + cx) / 2, (my + cy) / 2, 'left', { buttons: 1 }); await mouse('mouseMoved', cx, cy, 'left', { buttons: 1 }); await mouse('mouseReleased', cx, cy);
  }
  await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: stage.x, y: stage.y, width: stage.w, height: stage.h, scale: 1 } });
  await writeFile(path.resolve(out), Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out} (${Math.round(stage.w * dsf)}x${Math.round(stage.h * dsf)}) ${mapUrl}${tokenAt ? ' token at ' + tokenAt.map((v) => Math.round(v)).join(',') + ' px' : ''}`);
  sock.close();
} catch (err) {
  console.error('map-shot: ' + err.message); exitCode = 1;
} finally {
  proc.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
