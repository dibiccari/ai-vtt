// What to tell the person when the AI Dungeon Master cannot answer, and where to fix it. Pure: the error goes in, a short plain message and (when there is one) a link come out.
// The raw text of the error stays in the reply too (the table prints it in the transcript); this adds what the page needs for a banner that stays until it is closed.
const BILLING_URL = 'https://console.anthropic.com/settings/billing';

// The provider's own sentence ("Your credit balance is too low...") out of the SDK error, and the request id it quotes: what to read and what to tell support.
export function providerMessage(err) {
  const body = err?.error?.error?.message;
  if (typeof body === 'string' && body.trim()) return body.trim();
  const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(err?.message ?? ''));
  if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"').trim(); } catch { return m[1]; }
}
export function requestIdOf(err) {
  const m = /"request_id"\s*:\s*"([^"]+)"/.exec(String(err?.message ?? ''));
  return String(err?.requestID || err?.request_id || (m && m[1]) || '');
}

// err: an error from the Anthropic SDK (status, message). Returns { code, summary, help: { label, url } } or null for an error that needs no special help.
export function describeAiError(err) {
  const status = Number(err?.status) || 0, text = String(err?.message ?? '');
  if (status === 400 && /credit balance (is )?too low|insufficient[_ ]credit/i.test(text)) {
    return { code: 'credit', summary: 'The AI Dungeon Master cannot answer: the Anthropic account is out of credit. Add credit, then send your message again.', help: { label: 'Add credit (Anthropic Console)', url: BILLING_URL }, links: [{ label: 'Add credit (Anthropic Console)', url: BILLING_URL }, { label: 'Open Settings', url: '/settings.html' }], providerMessage: providerMessage(err), requestId: requestIdOf(err) };
  }
  if (status === 401 || /invalid x-api-key|authentication_error/i.test(text)) {
    return { code: 'key', summary: 'The AI Dungeon Master cannot answer: the Anthropic API key was refused. Check the key in Settings.', help: { label: 'Open Settings', url: '/settings.html' }, links: [{ label: 'Open Settings', url: '/settings.html' }, { label: 'Anthropic API keys', url: 'https://console.anthropic.com/settings/keys' }], providerMessage: providerMessage(err), requestId: requestIdOf(err) };
  }
  return null;
}
