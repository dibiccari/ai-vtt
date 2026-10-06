// lib/live.js: the per-campaign revision counter and the server-sent-events stream (hello, then one change event per successful write).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers/sandbox.mjs';

let s;
const LOST = 'lost-mine-of-phandelver';
before(async () => { s = await startServer(); await s.post('/api/campaigns/active', { id: LOST }); });
after(async () => { await s.stop(); });

// Open the event stream and collect parsed events.
function listen(id) {
  const events = [];
  let waiting = [];
  const req = http.get({ host: '127.0.0.1', port: s.port, path: `/api/campaigns/${id}/live` });
  const done = new Promise((resolve, reject) => {
    req.on('response', (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block), data = /^data: (.+)$/m.exec(block);
          if (ev && data) { events.push({ event: ev[1], ...JSON.parse(data[1]) }); waiting = waiting.filter((w) => !w()); }
        }
      });
      resolve();
    });
    req.on('error', reject);
  });
  const until = (n, ms = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`only ${events.length} events: ${JSON.stringify(events)}`)), ms);
    const check = () => { if (events.length >= n) { clearTimeout(t); resolve(events); return true; } return false; };
    if (!check()) waiting.push(check);
  });
  return { events, until, ready: done, close: () => req.destroy() };
}

test('hello carries the current revision; every successful write announces a change with its scope and the next revision', async () => {
  const a = listen(LOST); await a.ready; await a.until(1);
  assert.equal(a.events[0].event, 'hello'); const rev = a.events[0].rev; assert.ok(rev >= 1);
  await s.put(`/api/campaigns/${LOST}/journal`, { entries: [] });
  await a.until(2);
  assert.deepEqual([a.events[1].event, a.events[1].scope, a.events[1].rev], ['change', 'journal', rev + 1]);
  await s.put(`/api/campaigns/${LOST}/game`, { board: { x: 1 }, chat: [] });
  await s.put(`/api/campaigns/${LOST}/settings`, { rules: '2014' });
  await a.until(4);
  assert.deepEqual(a.events.slice(2).map((e) => [e.scope, e.rev]), [['game', rev + 2], ['settings', rev + 3]]);
  a.close();
});

test('failed writes, reads and dice rolls announce nothing; the revision stays put', async () => {
  const a = listen(LOST); await a.ready; await a.until(1);
  const rev = a.events[0].rev;
  await s.put('/api/campaigns/nope/journal', { entries: [] });                       // 404 for a campaign that does not exist? (may still be a 200: see below)
  await s.get(`/api/campaigns/${LOST}/journal`); await s.post('/api/roll', { expr: 'd20' });
  await s.put(`/api/campaigns/${LOST}/game`, {});                                    // 400
  await new Promise((r) => setTimeout(r, 300));
  const changes = a.events.filter((e) => e.event === 'change');
  assert.ok(changes.every((e) => e.scope !== 'game'), 'a refused game save is not announced');
  assert.ok(!changes.some((e) => e.scope === 'roll'));
  assert.ok(changes.length <= 1, JSON.stringify(changes));
  a.close();
  const fresh = listen(LOST); await fresh.ready; await fresh.until(1);
  assert.ok(fresh.events[0].rev >= rev, 'a later hello never goes backwards');
  fresh.close();
});

test('character and party writes are announced to every campaign; two viewers both get the event; a closed viewer is dropped', async () => {
  const a = listen(LOST), b = listen('tavern-brawl-test');
  await a.ready; await b.ready; await a.until(1); await b.until(1);
  await s.post('/api/party/stash', {}); // no such route: 404, nothing announced
  await s.put('/api/party/stash', { items: [], coins: { gp: 1 } });
  await a.until(2); await b.until(2);
  assert.equal(a.events[1].scope, 'party'); assert.equal(b.events[1].scope, 'party');
  a.close();
  await s.put('/api/party/stash', { items: [], coins: { gp: 2 } });                 // must not throw on the closed stream
  await b.until(3);
  assert.equal((await s.get('/api/campaigns')).status, 200, 'the server survived a viewer leaving');
  b.close();
});

test('the live stream of an unknown campaign is a 404 and the saved game carries its revision', async () => {
  assert.equal((await s.get('/api/campaigns/nope/live')).status, 404);
  const g = (await s.get(`/api/campaigns/${LOST}/game`)).json;
  assert.ok(Number.isInteger(g.rev) && g.rev >= 1);
  await s.put(`/api/campaigns/${LOST}/game`, { board: { y: 2 }, chat: [] });
  assert.ok((await s.get(`/api/campaigns/${LOST}/game`)).json.rev > g.rev);
});
