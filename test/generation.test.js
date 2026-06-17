// test/generation.test.js
// Tests for the content-generation agent. The deterministic pieces (calendar,
// content spec, block conversion, draft→canonical mapping) are tested directly.
// The Claude integration is tested through generate() with an INJECTED mock
// client — no API key, no network, no credits.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setRepo } from '../bridge/repo/index.js';
import { createMemoryRepo } from '../bridge/repo/memory.js';
import { planForDate, etWallClockToUtc } from '../agent/editorial-calendar.js';
import { checkAgainstSpec, bodyWordCount } from '../agent/content-spec.js';
import { blocksToProseMirror, draftToCanonical, generate } from '../agent/generate.js';
import { generateAndQueue } from '../agent/generate-cli.js';
import { ContentStatus, ContentType } from '../shared/index.js';

beforeEach(() => { _setRepo(createMemoryRepo()); });

// --- Editorial calendar -----------------------------------------------------

test('weekday plan has the daily news mix plus a blog on Mon/Wed/Fri', () => {
  const monday = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15 is a Monday
  const plan = planForDate(monday);
  assert.equal(plan.isWeekday, true);
  const news = plan.items.filter((i) => i.stream === 'news');
  const blogs = plan.items.filter((i) => i.stream === 'blog');
  assert.equal(news.length, 6, 'Monday has 6 news slots');
  assert.equal(blogs.length, 1, 'Monday has a blog');
  assert.ok(blogs[0].scheduledFor, 'blog carries a scheduledFor');
  assert.equal(news[0].scheduledFor, null, 'news publishes ASAP (no schedule)');
});

test('weekends produce no items (no weekend news)', () => {
  const saturday = new Date(Date.UTC(2026, 5, 20)); // Saturday
  const plan = planForDate(saturday);
  assert.equal(plan.isWeekday, false);
  assert.equal(plan.items.length, 0);
});

test('etWallClockToUtc resolves 9am ET to a real UTC instant', () => {
  const day = new Date(Date.UTC(2026, 5, 15));
  const utc = etWallClockToUtc(day, 9, 0);
  // June ⇒ EDT (UTC-4) ⇒ 9:00 ET = 13:00 UTC.
  assert.equal(utc.getUTCHours(), 13);
  assert.equal(utc.getUTCMinutes(), 0);
});

// --- Block conversion + spec check -----------------------------------------

test('blocksToProseMirror builds a valid doc the spec word counter can read', () => {
  const doc = blocksToProseMirror([
    { type: 'heading', text: 'Lede' },
    { type: 'paragraph', text: 'one two three four five' },
    { type: 'bullet_list', items: ['alpha beta', 'gamma'] },
  ]);
  assert.equal(doc.type, 'doc');
  assert.equal(doc.content[0].type, 'heading');
  assert.ok(bodyWordCount(doc) >= 8);
});

test('checkAgainstSpec flags an out-of-range headline and missing tags', () => {
  const draft = makeDraft({ title: 'Short headline', tags: [] });
  const content = draftToCanonical(draft, { stream: 'news', model: 'test', sourceId: 's1' });
  const warnings = checkAgainstSpec(content, 'news');
  assert.ok(warnings.some((w) => /Headline is/.test(w)));
  assert.ok(warnings.some((w) => /tags/.test(w)));
});

// --- draft → canonical ------------------------------------------------------

test('draftToCanonical produces a pending_review canonical with provenance', () => {
  const content = draftToCanonical(makeDraft(), { stream: 'news', model: 'claude-sonnet-4-6', sourceId: 's2' });
  assert.equal(content.status, ContentStatus.PENDING_REVIEW, 'defaults to the gate');
  assert.equal(content.type, ContentType.NEWS);
  assert.equal(content.provenance.authorship, 'ai_generated');
  assert.equal(content.provenance.generatedBy, 'claude-sonnet-4-6');
  assert.ok(content.taxonomies.some((t) => t.type === 'category'));
});

// --- generate() with a mock client ------------------------------------------

function mockClient() {
  let call = 0;
  return {
    messages: {
      async create() {
        call += 1;
        if (call === 1) {
          // Research phase reply (free text + prominence line).
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Angle: a deal closed.\nFact: $1B, per Reuters.\nPROMINENCE: standard' }] };
        }
        // Write phase reply (structured JSON as text).
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(makeDraft()) }] };
      },
    },
  };
}

test('generate() runs both phases via an injected client and grounds on the brief', async () => {
  const spec = { stream: 'news', type: 'news', category: 'Deals & M&A', sourceId: 'gen-1' };
  const { content, prominence, brief } = await generate(spec, { client: mockClient() });
  assert.equal(prominence, 'standard');
  assert.match(brief, /Reuters/);
  assert.equal(content.status, ContentStatus.PENDING_REVIEW);
  assert.equal(content.title, 'Major US foodservice deal reshapes the distribution market');
});

test('generateAndQueue persists to pending_review and enqueues no jobs', async () => {
  const r = await generateAndQueue(
    { stream: 'news', type: 'news', category: 'Deals & M&A', sourceId: 'gen-2' },
    { client: mockClient() }
  );
  assert.equal(r.content.status, ContentStatus.PENDING_REVIEW);
  assert.equal(r.jobs.length, 0, 'pending_review enqueues nothing — the gate holds');
});

// --- helper -----------------------------------------------------------------

function makeDraft(overrides = {}) {
  return {
    title: 'Major US foodservice deal reshapes the distribution market',
    seoTitle: 'US Foodservice Deal Reshapes Distribution',
    metaDescription: 'A landmark US foodservice acquisition reshapes B2B distribution. Read what it means for the market and the executives driving the consolidation wave now.',
    slug: 'foodservice-deal-distribution',
    dek: 'A landmark acquisition reshapes B2B foodservice distribution.',
    primaryKeyword: 'foodservice acquisition',
    secondaryKeywords: ['distribution merger', 'B2B foodservice'],
    category: 'Deals & M&A',
    industryTag: 'Retail & Consumer',
    tags: ['M&A', 'Foodservice', 'Distribution'],
    entities: ['Sysco'],
    namesIndividual: false,
    blocks: [
      { type: 'paragraph', text: 'A major US foodservice distributor agreed to acquire a rival in a deal that reshapes the sector and signals a new wave of consolidation across B2B distribution this quarter.' },
      { type: 'heading', text: 'What the deal means' },
      { type: 'paragraph', text: 'The transaction consolidates two of the largest players and is expected to draw regulatory scrutiny over pricing and market concentration in the months ahead.' },
    ],
    sources: [{ title: 'Reuters', url: 'https://example.com/reuters' }],
    ...overrides,
  };
}
