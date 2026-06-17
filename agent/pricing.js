// agent/pricing.js
// Best-effort per-request cost estimation from the API usage object, so each
// generation can report what it cost. Prices are USD per 1M tokens (input /
// output), matching the current Claude model list. Cache reads bill ~0.1x
// input; cache writes ~1.25x input. Web search bills per request.

export const PRICING = Object.freeze({
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
});

const WEB_SEARCH_PER_REQUEST = 0.01; // ~$10 / 1,000 searches

/** Estimate USD cost for one API response's usage on a given model. */
export function costForUsage(model, usage) {
  if (!usage) return 0;
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6'];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (
    (inTok / 1e6) * p.input +
    (outTok / 1e6) * p.output +
    (cacheRead / 1e6) * p.input * 0.1 +
    (cacheWrite / 1e6) * p.input * 1.25 +
    searches * WEB_SEARCH_PER_REQUEST
  );
}

/** Sum cost across phases: [{ model, usage }, ...]. Returns { usd, tokens }. */
export function estimateCost(parts = []) {
  let usd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  for (const { model, usage } of parts) {
    usd += costForUsage(model, usage);
    inputTokens += (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
    outputTokens += usage?.output_tokens ?? 0;
    searches += usage?.server_tool_use?.web_search_requests ?? 0;
  }
  return { usd: Number(usd.toFixed(4)), inputTokens, outputTokens, searches };
}
