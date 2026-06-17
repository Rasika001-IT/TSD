// agent/cost-profiles.js
// User-selectable cost profiles. Each bundles the knobs that drive generation
// spend: which model writes, how much effort/thinking, and how much web
// research. Stored in app_settings under "cost_profile" and chosen from the
// dashboard. The explicit model dropdown still overrides the write model.
//
// Research stays on Sonnet across profiles (reliable web search / grounding);
// the write model is the main per-profile lever. 'byProminence' = the built-in
// Sonnet-default / Opus-for-major-stories logic.

export const DEFAULT_COST_PROFILE = 'balanced';

export const COST_PROFILES = Object.freeze({
  // maxFetches caps full-page web_fetch (the big input-token sink); maxSearches
  // caps web_search (cheap snippets). Fetching whole pages is what costs.
  balanced: {
    label: 'Balanced',
    research: { model: 'claude-sonnet-4-6', effort: 'low', thinking: true, maxSearches: 4, maxFetches: 1 },
    write: { model: 'claude-sonnet-4-6', effortNews: 'low', effortBlog: 'medium', thinking: false },
    promptCache: true,
  },
  'max-savings': {
    label: 'Max savings',
    research: { model: 'claude-sonnet-4-6', effort: 'low', thinking: false, maxSearches: 3, maxFetches: 0 },
    write: { model: 'claude-haiku-4-5', effortNews: 'low', effortBlog: 'low', thinking: false },
    promptCache: true,
  },
  'quality-first': {
    label: 'Quality-first',
    research: { model: 'claude-sonnet-4-6', effort: 'medium', thinking: true, maxSearches: 6, maxFetches: 4 },
    write: { model: 'byProminence', effortNews: 'medium', effortBlog: 'high', thinking: false },
    promptCache: true,
  },
});

export const PROFILE_OPTIONS = Object.keys(COST_PROFILES);

export function resolveProfile(key) {
  return COST_PROFILES[key] ?? COST_PROFILES[DEFAULT_COST_PROFILE];
}
