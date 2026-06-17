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
  balanced: {
    label: 'Balanced',
    research: { model: 'claude-sonnet-4-6', effort: 'low', thinking: true, maxSearches: 4, webFetch: true },
    write: { model: 'claude-sonnet-4-6', effortNews: 'low', effortBlog: 'medium', thinking: false },
    promptCache: true,
  },
  'max-savings': {
    label: 'Max savings',
    research: { model: 'claude-sonnet-4-6', effort: 'low', thinking: false, maxSearches: 2, webFetch: false },
    write: { model: 'claude-haiku-4-5', effortNews: 'low', effortBlog: 'low', thinking: false },
    promptCache: true,
  },
  'quality-first': {
    label: 'Quality-first',
    research: { model: 'claude-sonnet-4-6', effort: 'medium', thinking: true, maxSearches: 6, webFetch: true },
    write: { model: 'byProminence', effortNews: 'medium', effortBlog: 'high', thinking: false },
    promptCache: true,
  },
});

export const PROFILE_OPTIONS = Object.keys(COST_PROFILES);

export function resolveProfile(key) {
  return COST_PROFILES[key] ?? COST_PROFILES[DEFAULT_COST_PROFILE];
}
