// The Merchant agent: a small, separate model call that plays one shopkeeper while the shop is open. The Dungeon Master opens the shop (token action shop) and then stays out of it;
// the merchant talks, haggles (a real Persuasion check from the dice tray) and may move the price within limits, and when the player leaves the DM gets a one-line summary.
// Pure pieces here (prompt, schema, clamping, cleaning); the API call is in server.js (POST /api/merchant).
export const MERCHANT_MODEL_DEFAULT = 'claude-haiku-5-5';
export const HAGGLE_RANGE = 30;                      // the price can move this many percentage points either side of where the DM set it
const sgn = (n) => (n >= 0 ? '+' : '') + n;

export const merchantSchema = (voices) => ({
  type: 'object',
  properties: {
    line: { type: 'string' },
    voice: { type: 'string', enum: voices },
    rolls: { type: 'array', items: { type: 'string' } },
    markup: { type: 'integer' },
    done: { type: 'boolean' },
    summary: { type: 'string' }
  },
  required: ['line', 'voice', 'rolls', 'markup', 'done', 'summary'],
  additionalProperties: false
});

// What the merchant is told. `buyer` carries the character's name and numbers, `shop` the DM's setup, `place` where the shop is.
// What a shopkeeper remembers between visits (kept per campaign in merchants.json): how often the party has come, how the last visit ended and the price they settled on.
export const merchantKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export function merchantMemoryText(mem) {
  if (!mem || !(mem.visits > 0)) return '';
  const last = mem.summary ? ` Last time: ${mem.summary}` : '';
  const price = Number.isFinite(mem.markup) && mem.markup > 0 ? ` You ended that visit charging ${mem.markup}% of the book price.` : '';
  return `\n\nYou remember this party: they have been in your shop ${mem.visits} time${mem.visits === 1 ? '' : 's'} before.${last}${price} Let that colour how you greet them and how hard you haggle, but stay within your rules.`;
}
export function remember(mem, { opening, summary, markup, buyer }) {
  const next = { ...(mem && typeof mem === 'object' ? mem : {}), visits: Math.max(0, Math.floor(Number(mem && mem.visits)) || 0) };
  if (opening) next.visits += 1;
  if (summary) next.summary = String(summary).slice(0, 240);
  if (Number.isFinite(markup) && markup > 0) next.markup = Math.round(markup);
  if (buyer) next.lastBuyer = String(buyer).slice(0, 60);
  next.updated = new Date().toISOString();
  return next;
}
export const merchantSystem = (args) => baseSystem(args) + merchantMemoryText(args.memory);
function baseSystem({ shop, buyer, place, campaign, tray }) {
  const groups = shop.groups && shop.groups.length ? shop.groups.join(', ') : 'ordinary mundane gear (no magic items)';
  return `You are ${shop.merchant}, a shopkeeper in a D&D 5e game (${campaign}${place ? `, at ${place}` : ''}). A player character, ${buyer.name}, is browsing your shop on a screen beside you. You speak only as ${shop.merchant}: one to three short sentences, in character, no narration of the player's actions, no stage directions, no rules talk.

What you sell: ${groups}. Prices are shown to the player in the shop on screen. Right now you charge ${shop.markup}% of the book price (100 is the normal price). You may not sell anything outside your stock, and you never invent items, prices in coin or magic.

Haggling, by the book: if the player tries to bargain, it is a Charisma (Persuasion) check. Pick a DC from 10 to 16 by how reasonable the ask is and how you feel about this customer, and use the NEXT unused d20 from this tray, in order: ${tray.join(', ')}. ${buyer.name}'s Persuasion bonus is ${sgn(buyer.persuasion)}. Write the roll in rolls like "${buyer.name} Persuasion: d20 (14) + 2 = 16 vs DC 13: success". On a success lower your markup by 5 to 15 points; on a failure keep it; on a natural 1 you are offended and raise it by 10; on a natural 20 you are charmed and lower it by 20. A second haggle in a row after a failure needs a higher DC (+2 each time). Do not roll when nobody is bargaining, and never roll for the same ask twice. ${buyer.name}'s Insight is ${sgn(buyer.insight)} if they ask whether you are being straight.

Reply fields: line = what you say aloud; voice = the voice tag that fits you (narrator, gruff, sly, noble, elderly, child, feminine or masculine); rolls = the roll lines (empty if none); markup = your new price in percent of the book price ONLY when it changed this turn (otherwise 0); done = true only if you end the conversation (you throw them out, you close up, they said goodbye); summary = one sentence the Dungeon Master can read later about this conversation so far (what was asked, any haggle and its result, any promise or insult). Keep the summary factual and under 200 characters. The very first message is the player walking in: greet them in character and say what you sell, in one or two sentences.`;
}

// Turn the stored history and the new message into model messages (a short window: the merchant never needs the whole story).
export function merchantMessages(history, message, opening) {
  const out = [];
  for (const h of (Array.isArray(history) ? history : []).slice(-10)) {
    const text = String(h && h.text || '').slice(0, 600);
    if (text) out.push({ role: h.role === 'merchant' ? 'assistant' : 'user', content: text });
  }
  out.push({ role: 'user', content: opening ? '(The player walks into your shop.)' : String(message || '').slice(0, 600) });
  // the API wants the first message to be the user's and roles to alternate
  const merged = [];
  for (const m of out) { if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += '\n' + m.content; else merged.push({ ...m }); }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}

// The reply, cleaned: the price stays within reach of where the DM set it, text lengths are capped.
export function cleanMerchantReply(raw, shop, voices) {
  const base = Number(shop.base ?? shop.markup) || 100;
  const m = Math.round(Number(raw && raw.markup)) || 0;
  const markup = m ? Math.min(base + HAGGLE_RANGE, Math.max(Math.max(25, base - HAGGLE_RANGE), m)) : 0;
  const line = String(raw && raw.line || '').trim().slice(0, 500);
  return {
    line, voice: voices.includes(raw && raw.voice) ? raw.voice : 'narrator',
    rolls: (Array.isArray(raw && raw.rolls) ? raw.rolls : []).map((r) => String(r).slice(0, 160)).slice(0, 3),
    markup, done: Boolean(raw && raw.done), summary: String(raw && raw.summary || '').trim().slice(0, 240)
  };
}
