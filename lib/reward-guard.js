// Repeated rewards. A reward is a change (+10 gp, 100 XP, an item added), and the model can send the same one again on a later reply because the scene still mentions it
// (seen in a playtest: the 10 gp for a delivery was paid on three replies in a row). The server cannot know the story, but it can see an identical reward for the same character
// arrive again within the next few replies and refuse it, telling the DM and the table. Spending, purchases and exact amounts (setcoins) are never held back: spending the same price twice is normal,
// and an exact amount is safe to repeat. If a story really gives the same reward twice in a row, the DM can give a different amount or use the exact-purse action; the Party page can always adjust by hand.
const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];

// { key, label } for an update that adds value, otherwise null. `nameOf` turns a target id into a name for the message.
export function rewardOf(u, nameOf = (t) => t) {
  if (!u || typeof u !== 'object') return null;
  if (u.type === 'gear' && u.action === 'coins') {
    const d = COINS.map((k) => Math.round(Number(u[k]) || 0));
    if (d.some((n) => n < 0) || !d.some((n) => n > 0)) return null;
    return { key: `coins|${u.target}|${d.join(',')}`, label: `${COINS.map((k, i) => (d[i] ? `+${d[i]} ${k}` : '')).filter(Boolean).join(', ')} for ${nameOf(u.target)}` };
  }
  if (u.type === 'gear' && u.action === 'add') {
    const name = String(u.name ?? '').trim();
    if (!name) return null;
    const qty = Math.max(1, Math.round(Number(u.qty) || 1));
    return { key: `item|${u.target}|${name.toLowerCase()}|${qty}`, label: `${qty > 1 ? qty + ' x ' : ''}${name} for ${nameOf(u.target)}` };
  }
  if (u.type === 'track' && u.op === 'xp') {
    const amount = Math.round(Number(u.amount));
    if (!(amount > 0)) return null;
    return { key: `xp|${u.target}|${amount}|${u.split !== false}`, label: `${amount} XP for ${u.target === 'party' ? 'the party' : nameOf(u.target)}` };
  }
  return null;
}

// One guard for the whole server, with a short memory per campaign: the rewards of the last `window` replies.
export function createRewardGuard({ window = 2 } = {}) {
  const books = new Map();        // campaign id -> [Set of keys, one per reply, newest last]
  return {
    // Takes the updates of one reply, returns the ones to apply and a message for each reward that repeats one of the last replies.
    filter(campaign, updates, nameOf) {
      const recent = books.get(campaign) || [];
      const seen = new Set(recent.flatMap((s) => [...s]));
      const mine = new Set(), kept = [], skipped = [];
      for (const u of updates) {
        const r = rewardOf(u, nameOf);
        if (!r) { kept.push(u); continue; }
        if (seen.has(r.key)) { skipped.push(r.label); mine.add(r.key); continue; }       // a skipped repeat still counts as seen, so a model that keeps repeating keeps being refused
        mine.add(r.key); kept.push(u);
      }
      recent.push(mine);
      while (recent.length > window) recent.shift();
      books.set(campaign, recent);
      return { updates: kept, skipped };
    },
    reset(campaign) { books.delete(campaign); }
  };
}
