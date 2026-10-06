/* Spectator mode of the tabletop: open /?watch=1. Read-only live view (multiplayer prep, phase 0; see docs/multiplayer-plan.md).
   - every request that is not a GET is refused here, so a watcher can never save a board or ask the paid AI DM anything;
   - the editing controls are hidden and the board ignores the mouse;
   - the page subscribes to /api/campaigns/<id>/live and reloads itself when the saved game changes (index.html's serverSave.pull
     takes the server copy in watch mode). */
(() => {
  if (!/[?&]watch=1/.test(location.search)) return;
  window.WATCH = true;

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(new Response(JSON.stringify({ error: 'Watching only' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    return realFetch(input, init);
  };

  const css = document.createElement('style');
  css.textContent = '#board{pointer-events:none!important}#chatInput,.begin-box,.dice-box,#pauseBtn,#recapBtn,#clearChatBtn,#sendBtn,#micBtn,#micToggleBtn,.mic-meter,#autoSendToggle,#chatInput+.hint{display:none!important}'
    + '#watchBanner{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;background:#2b3a55;color:#fff;font:600 12px system-ui,sans-serif;padding:4px 14px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px #0006}';
  document.head.appendChild(css);

  const banner = document.createElement('div');
  banner.id = 'watchBanner';
  banner.textContent = 'Watching (read-only), connecting...';
  const mount = () => document.body.appendChild(banner);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  let lastSaved = null, lastRev = 0, timer = null;
  async function check() {
    try {
      const list = (await (await realFetch('/api/campaigns')).json()).campaigns || [];
      const id = (list.find((c) => c.active) || {}).id;
      if (!id) return;
      const g = await (await realFetch(`/api/campaigns/${encodeURIComponent(id)}/game`)).json();
      const stamp = `${g.savedAt}|${JSON.stringify(g.fog || {}).length}|${(g.chat || []).length}`;
      if (lastSaved === null) { lastSaved = stamp; return; }
      if (stamp !== lastSaved) location.reload();
    } catch { /* try again on the next event */ }
  }
  async function connect() {
    let id = null;
    try { id = ((await (await realFetch('/api/campaigns')).json()).campaigns || []).find((c) => c.active)?.id; } catch { /* offline */ }
    if (!id) { banner.textContent = 'Watching (read-only): no campaign selected'; return; }
    await check();
    const es = new EventSource(`/api/campaigns/${encodeURIComponent(id)}/live`);
    es.addEventListener('hello', (e) => { lastRev = JSON.parse(e.data).rev; banner.textContent = 'Watching (read-only), live'; });
    es.addEventListener('change', (e) => {
      lastRev = JSON.parse(e.data).rev;
      clearTimeout(timer);
      timer = setTimeout(check, 400);
    });
    es.onerror = () => { banner.textContent = 'Watching (read-only), reconnecting...'; };
  }
  connect();
})();
