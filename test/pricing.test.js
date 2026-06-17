// test/pricing.test.js
// Unit tests for cost estimation and the cost-profile bundles.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { costForUsage, estimateCost } from '../agent/pricing.js';
import { COST_PROFILES, resolveProfile, DEFAULT_COST_PROFILE } from '../agent/cost-profiles.js';

test('costForUsage prices input/output per model', () => {
  // Sonnet: $3/M in, $15/M out. 1M in + 1M out = $3 + $15 = $18.
  const usd = costForUsage('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.equal(Math.round(usd), 18);
});

test('costForUsage adds web-search fees and handles missing usage', () => {
  assert.equal(costForUsage('claude-sonnet-4-6', null), 0);
  const usd = costForUsage('claude-haiku-4-5', { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 5 } });
  assert.ok(Math.abs(usd - 0.05) < 1e-9, '5 searches ≈ $0.05');
});

test('estimateCost sums phases and tallies tokens + searches', () => {
  const c = estimateCost([
    { model: 'claude-sonnet-4-6', usage: { input_tokens: 2000, output_tokens: 800, server_tool_use: { web_search_requests: 3 } } },
    { model: 'claude-opus-4-8', usage: { input_tokens: 1500, output_tokens: 600 } },
  ]);
  assert.ok(c.usd > 0);
  assert.equal(c.searches, 3);
  assert.equal(c.outputTokens, 1400);
});

test('cost profiles are well-formed; default resolves', () => {
  for (const [key, p] of Object.entries(COST_PROFILES)) {
    assert.ok(p.research?.model, `${key} has a research model`);
    assert.ok(p.write?.model, `${key} has a write model`);
  }
  assert.equal(resolveProfile('nonsense'), COST_PROFILES[DEFAULT_COST_PROFILE], 'unknown key falls back to default');
  assert.equal(resolveProfile('max-savings').write.model, 'claude-haiku-4-5');
});
