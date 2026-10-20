// What each model the Dungeon Master can run on is able to do, in one place: the server reads it to build a request, and the Settings page to decide which choices to offer
// (picking a model changes what the speed and effort dropdowns offer).
// The newest models (the 5.5 family and Fable) always think before they answer and cannot be told not to; the others can, and the DM replies much sooner without it (replay, Nov 2026).
export const canSkipThinking = (model) => !/-5-5(?![0-9])|fable/i.test(String(model));
// Fast mode (Anthropic, Opus 5.5 / 5 / 4.8): the same model writing about 2.5 times faster, at twice the price. It changes the speed of the writing, not the wait before it starts.
export const canGoFast = (model) => /^claude-opus-(5-5|5|4-8)$/.test(String(model));

export const capsOf = (model) => ({ fast: canGoFast(model), skipsThinking: canSkipThinking(model) });

// The models offered on the Settings page, in the order shown.
export const DM_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (fastest reply: answers without thinking first)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (fast start, no thinking step)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best; the model the DM was tested with; thinks first, slower)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest, simplest)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' }
];

// The list as the page needs it: each model with what it can do.
export const modelChoices = () => DM_MODELS.map((m) => ({ ...m, ...capsOf(m.id) }));
