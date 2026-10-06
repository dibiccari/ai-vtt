// Token usage and an ESTIMATED cost of the AI calls (the DM and the recap), kept in data/usage.json (git-ignored) and in memory for "this session" (since the server started).
// Prices are dollars per million tokens, in data/usage-prices.json (written on first use with the defaults below; edit it to match your bill). They are list-price estimates:
// the Anthropic Console is the real bill. Cached input is read at 0.1x and written at 1.25x the input price (prompt caching).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PRICES = {
  'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-fable-5-1': [10, 50], 'claude-haiku-4-5': [1, 5]
};
const EMPTY = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
const add = (acc, u, cost) => { acc.calls += 1; acc.input += u.input; acc.output += u.output; acc.cacheRead += u.cacheRead; acc.cacheWrite += u.cacheWrite; acc.cost += cost; };

export function costOf(model, u, prices = DEFAULT_PRICES) {
  const key = Object.keys(prices).find((k) => String(model || '').startsWith(k)) || 'claude-opus-5-5';
  const [pin, pout] = prices[key] || DEFAULT_PRICES['claude-opus-5-5'];
  return (u.input * pin + u.output * pout + u.cacheRead * pin * 0.1 + u.cacheWrite * pin * 1.25) / 1e6;
}
export const normalizeUsage = (raw) => ({
  input: Number(raw?.input_tokens) || 0, output: Number(raw?.output_tokens) || 0,
  cacheRead: Number(raw?.cache_read_input_tokens) || 0, cacheWrite: Number(raw?.cache_creation_input_tokens) || 0
});

export function createUsageTracker(dataDir) {
  const file = path.join(dataDir, 'usage.json'), pricesFile = path.join(dataDir, 'usage-prices.json');
  const session = { since: new Date().toISOString(), ...EMPTY() };
  let prices = null;
  const loadPrices = async () => {
    if (prices) return prices;
    try { prices = { ...DEFAULT_PRICES, ...JSON.parse(await readFile(pricesFile, 'utf8')) }; }
    catch { prices = { ...DEFAULT_PRICES }; try { await mkdir(dataDir, { recursive: true }); await writeFile(pricesFile, JSON.stringify(DEFAULT_PRICES, null, 2) + '\n'); } catch { /* read-only: defaults are used */ } }
    return prices;
  };
  const readAll = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return { since: new Date().toISOString(), total: EMPTY(), byDay: {}, byCampaign: {}, byKind: {} }; } };
  let queue = Promise.resolve();
  return {
    // Record one finished call: model, the API's usage object, which campaign and what it was for ('dm' or 'recap').
    record(model, rawUsage, campaign = '', kind = 'dm') {
      queue = queue.then(async () => {
        const p = await loadPrices(), u = normalizeUsage(rawUsage), cost = costOf(model, u, p);
        add(session, u, cost);
        const all = await readAll(), day = new Date().toISOString().slice(0, 10);
        all.byDay = all.byDay || {}; all.byCampaign = all.byCampaign || {}; all.byKind = all.byKind || {};
        add(all.total = all.total || EMPTY(), u, cost);
        add(all.byDay[day] = all.byDay[day] || EMPTY(), u, cost);
        if (campaign) add(all.byCampaign[campaign] = all.byCampaign[campaign] || EMPTY(), u, cost);
        add(all.byKind[kind] = all.byKind[kind] || EMPTY(), u, cost);
        const days = Object.keys(all.byDay).sort();
        for (const d of days.slice(0, Math.max(0, days.length - 90))) delete all.byDay[d];            // keep the last 90 days
        await writeFile(file, JSON.stringify(all, null, 2) + '\n');
      }).catch(() => {});
      return queue;
    },
    async summary() {
      await queue;
      const all = await readAll(), p = await loadPrices(), day = new Date().toISOString().slice(0, 10);
      return { session: { ...session }, today: all.byDay?.[day] || EMPTY(), total: all.total || EMPTY(), since: all.since, byCampaign: all.byCampaign || {}, byKind: all.byKind || {}, days: Object.entries(all.byDay || {}).sort().slice(-14), prices: p, estimate: true };
    },
    async reset() { await queue; await writeFile(file, JSON.stringify({ since: new Date().toISOString(), total: EMPTY(), byDay: {}, byCampaign: {}, byKind: {} }, null, 2) + '\n'); Object.assign(session, EMPTY()); }
  };
}
