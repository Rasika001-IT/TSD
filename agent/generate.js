// agent/generate.js
// The content-generation agent. Uses Claude to research a real, current story
// via web search (grounding — the factual-safety lever) and then write it up in
// TSD house style, returning a canonical content object that defaults to
// pending_review. Editorial policy ("what to publish"), so it lives in /agent;
// it imports /shared and the TSD guidelines, never anything CMS-specific.
//
// Two phases, deliberately separated:
//   1. RESEARCH  — web_search + web_fetch ON, gathers verified facts + sources,
//                  judges prominence. No structured output (web search emits
//                  citations, which are incompatible with structured outputs).
//   2. WRITE     — no tools, strict JSON schema output, grounded ONLY on the
//                  phase-1 brief. Converts to a canonical object.
//
// The Anthropic client is injected so this module is unit-testable with a mock
// and never requires a live key (or burns credits) under test.

import {
  createCanonicalContent,
  slugify,
  ContentType,
  ContentFormat,
  AuthorshipType,
  PublishTarget,
  RobotsDirective,
  OpenGraphType,
  TwitterCardType,
} from '../shared/index.js';
import { buildStyleGuide } from './tsd-guidelines.js';
import { config } from '../bridge/config.js';
import { resolveProfile } from './cost-profiles.js';
import { estimateCost } from './pricing.js';

const MODELS = Object.freeze({
  standard: 'claude-sonnet-4-6', // default, per project decision
  major: 'claude-opus-4-8',      // escalation for big/widely-covered stories
});

// Adaptive thinking and the effort parameter are supported on the Sonnet 4.6 /
// Opus 4.x families but not Haiku — only attach them where valid so a model
// choice can't 400.
const supportsTuning = (model) => /sonnet-4-6|opus-4-/.test(model);
const thinkingFor = (model, on) => (on && supportsTuning(model) ? { thinking: { type: 'adaptive' } } : {});
// effort lives INSIDE output_config (not top-level); null when unsupported/unset.
const effortValue = (model, effort) => (effort && supportsTuning(model) ? effort : null);
const normalizeOverride = (m) => (m && m !== 'auto' ? m : null);

// Build the web tool set for the research phase, bounded by the cost profile.
// Searches return cheap snippets; full-page fetches are the input-token sink, so
// they get their own (usually tighter) cap and are dropped entirely at 0.
function webTools({ maxSearches, maxFetches }) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }];
  if (maxFetches > 0) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxFetches });
  return tools;
}

// ContentType the canonical model expects, by stream.
const STREAM_TO_TYPE = { news: ContentType.NEWS, blog: ContentType.BLOG };

/** Lazily construct the default Anthropic client (only when no client injected). */
async function defaultClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic(); // reads ANTHROPIC_API_KEY from env
}

// --- Phase 1: research ------------------------------------------------------

function researchPrompt({ stream, category, topicHint }) {
  const what = stream === 'blog'
    ? `one evergreen ${category} angle that is genuinely useful to senior US/UK business leaders`
    : `one real, significant ${category} story from roughly the last 48 hours`;
  return [
    `Find ${what} and assemble a verification brief. Be efficient: run only as`,
    'many web searches as you need (aim for 2–3), and open a source in full only',
    'when a snippet is not enough. Prefer primary sources (filings, official',
    'releases) and major business outlets.',
    topicHint ? `Topic direction: ${topicHint}.` : '',
    '',
    'Then output a TIGHT brief (aim for under ~250 words) with:',
    '- ANGLE: one sentence on the story and why it matters to an executive reader.',
    '- FACTS: only the verified, load-bearing facts — exact figures, dates, names,',
    '  titles — each with the source it came from. Mark anything you could not',
    '  confirm as "unverified" rather than asserting it.',
    '- QUOTES: any genuinely useful direct quote, verbatim, with exact attribution',
    '  and source URL (omit if none — never invent one).',
    '- ENTITIES: the companies, people, and places involved.',
    '- SOURCES: the URLs you actually used.',
    '',
    'Do not write the article. Assemble verified material only.',
    'End with a final line exactly of the form:',
    'PROMINENCE: major   (a big story widely covered by major outlets)',
    'PROMINENCE: standard   (otherwise)',
  ].filter(Boolean).join('\n');
}

/** Run the research phase. Handles the server-side-tool pause_turn loop. */
async function research(client, { stream, category, topicHint, profile }, maxContinuations = 6) {
  const r = profile.research;
  const model = r.model;
  const messages = [{ role: 'user', content: researchPrompt({ stream, category, topicHint }) }];
  const eff = effortValue(model, r.effort);
  const usages = [];
  let response;
  for (let i = 0; i <= maxContinuations; i++) {
    response = await client.messages.create({
      model,
      max_tokens: 16000,
      ...thinkingFor(model, r.thinking),
      ...(eff ? { output_config: { effort: eff } } : {}),
      tools: webTools({ maxSearches: r.maxSearches, maxFetches: r.maxFetches }),
      messages,
    });
    if (response.usage) usages.push({ model, usage: response.usage });
    if (response.stop_reason !== 'pause_turn') break;
    // Server-side tool loop hit its iteration cap — resume by re-sending.
    messages.push({ role: 'assistant', content: response.content });
  }
  const text = (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const prominence = /PROMINENCE:\s*major/i.test(text) ? 'major' : 'standard';
  return { brief: text, prominence, usages };
}

// --- Phase 2: write + structure --------------------------------------------

// Non-recursive JSON schema (structured outputs disallow recursion). Body is a
// flat block list we convert to ProseMirror in code.
function outputSchema(stream) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      seoTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      slug: { type: 'string' },
      dek: { type: 'string' },
      primaryKeyword: { type: 'string' },
      secondaryKeywords: { type: 'array', items: { type: 'string' } },
      category: { type: 'string' },
      industryTag: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      entities: { type: 'array', items: { type: 'string' } },
      namesIndividual: { type: 'boolean' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['heading', 'paragraph', 'bullet_list', 'ordered_list', 'quote', 'key_takeaways'] },
            text: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } },
          },
          required: ['type'],
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { title: { type: 'string' }, url: { type: 'string' } },
          required: ['url'],
        },
      },
    },
    required: ['title', 'seoTitle', 'metaDescription', 'slug', 'dek', 'primaryKeyword', 'category', 'tags', 'blocks', 'namesIndividual'],
  };
}

function writePrompt({ stream, brief }) {
  // Stream-specific spec targets — stated explicitly so the draft lands within
  // TSD standards on the first pass (less reviewer rework, fewer regenerations).
  const spec = stream === 'blog'
    ? [
        'TARGETS (TSD blog): headline compelling + keyword-led; seoTitle <=60 chars,',
        'keyword first; metaDescription 150–160 chars (promise + keyword + benefit);',
        'slug 3–6 words, lowercase-hyphenated, no stop words; dek 1–2 sentences;',
        'body 1,500–2,500 words, an H2/H3 roughly every 200–300 words, skim-friendly,',
        'bullet lists where they help; 2–3 sourced pull quotes only if available;',
        'a key_takeaways block (~5 items); 5–8 tags; exactly one category.',
      ]
    : [
        'TARGETS (TSD news): headline 8–12 words with the primary keyword in the',
        'first 4; seoTitle <=60 chars; metaDescription 150–160 chars with a CTA verb;',
        'slug 3–5 words, lowercase-hyphenated, no stop words; lede 30–40 words that',
        'answers who/what/when with the keyword in the first 30; body 300–600 words,',
        'inverted pyramid (most important first); an H2 roughly every 150–200 words;',
        'one sourced pull quote only if a real quote exists; 3–5 tags; one category.',
      ];
  return [
    `Write a TSD ${stream} piece from the verified brief below and return JSON`,
    'matching the required schema. Use ONLY facts supported by the brief — never',
    'introduce a figure, quote, name, or date that is not in it. If the brief is',
    'thin, write a shorter piece rather than padding with unverified claims.',
    'Be concise and editorial — no filler, no meta-commentary.',
    '',
    ...spec,
    '',
    'Body → `blocks`: heading = an H2; paragraph = body copy; bullet_list/',
    'ordered_list use `items`; quote = a sourced pull quote;',
    stream === 'blog' ? 'key_takeaways = the end box (~5 items in `items`).' : '(no key_takeaways for news).',
    'Set namesIndividual to true if the piece names a specific living individual.',
    '',
    '--- VERIFIED BRIEF ---',
    brief,
  ].join('\n');
}

/** Convert the flat block list into a ProseMirror/TipTap doc. */
export function blocksToProseMirror(blocks = []) {
  const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
  const listItems = (items = []) => items.map((t) => ({ type: 'listItem', content: [para(t)] }));
  const content = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: b.text ?? '' }] });
        break;
      case 'quote':
        content.push({ type: 'blockquote', content: [para(b.text ?? '')] });
        break;
      case 'bullet_list':
        content.push({ type: 'bulletList', content: listItems(b.items) });
        break;
      case 'ordered_list':
        content.push({ type: 'orderedList', content: listItems(b.items) });
        break;
      case 'key_takeaways':
        content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Key Takeaways' }] });
        content.push({ type: 'bulletList', content: listItems(b.items) });
        break;
      case 'paragraph':
      default:
        content.push(para(b.text ?? ''));
    }
  }
  return { type: 'doc', content };
}

/** Run the write phase with structured output. Model from override > profile > prominence. */
async function write(client, { stream, brief, prominence, modelOverride, profile }) {
  const w = profile.write;
  const profileModel = w.model === 'byProminence'
    ? (prominence === 'major' ? MODELS.major : MODELS.standard)
    : w.model;
  const model = normalizeOverride(modelOverride) || profileModel;
  const eff = effortValue(model, stream === 'blog' ? w.effortBlog : w.effortNews);
  const guide = buildStyleGuide(stream);
  const system = profile.promptCache
    ? [{ type: 'text', text: guide, cache_control: { type: 'ephemeral' } }] // cache the frozen style guide
    : guide;
  const output_config = { format: { type: 'json_schema', schema: outputSchema(stream) } };
  if (eff) output_config.effort = eff;
  const response = await client.messages.create({
    model,
    max_tokens: stream === 'blog' ? 16000 : 8000,
    ...thinkingFor(model, w.thinking),
    system,
    output_config,
    messages: [{ role: 'user', content: writePrompt({ stream, brief }) }],
  });
  const block = (response.content ?? []).find((b) => b.type === 'text');
  if (!block) throw new Error('generate: write phase returned no text');
  return { draft: JSON.parse(block.text), model, usage: response.usage };
}

// --- Public API -------------------------------------------------------------

/** Map a generation draft + research into a canonical content object. */
export function draftToCanonical(draft, { stream, model, sourceId, scheduledFor = null, targets }) {
  const taxonomies = [
    { type: 'category', name: draft.category, slug: slugify(draft.category) },
    ...(draft.industryTag ? [{ type: 'industry', name: draft.industryTag, slug: slugify(draft.industryTag) }] : []),
    ...(draft.tags ?? []).map((t) => ({ type: 'tag', name: t, slug: slugify(t) })),
  ];
  return createCanonicalContent({
    sourceId,
    type: STREAM_TO_TYPE[stream] ?? ContentType.NEWS,
    format: ContentFormat.PROSEMIRROR_JSON,
    title: draft.title,
    slug: draft.slug ? slugify(draft.slug) : slugify(draft.title),
    dek: draft.dek,
    body: blocksToProseMirror(draft.blocks),
    authors: [{ name: 'TSD Editorial Desk', slug: 'tsd-desk' }],
    taxonomies,
    scheduledFor,
    targets: targets ?? [PublishTarget.WORDPRESS],
    seo: {
      title: draft.seoTitle ?? null,
      description: draft.metaDescription ?? null,
      focusKeyword: draft.primaryKeyword ?? null,
      robots: RobotsDirective.INDEX_FOLLOW,
      ogType: OpenGraphType.ARTICLE,
      twitterCard: TwitterCardType.SUMMARY_LARGE_IMAGE,
    },
    editorial: {
      namesIndividual: draft.namesIndividual === true,
      // Internal-only: keep the sources where the reviewer can see them.
      editorialNotes: (draft.sources ?? []).length
        ? 'Sources:\n' + draft.sources.map((s) => `- ${s.title ?? s.url}: ${s.url}`).join('\n')
        : null,
    },
    provenance: {
      authorship: AuthorshipType.AI_GENERATED,
      generatedBy: model,
      promptRef: `tsd-generate/${stream}`,
    },
  });
}

/**
 * Generate one canonical content item, grounded on real current sources.
 * Returns { content, prominence, brief } — content defaults to pending_review.
 *
 * @param {{ stream:'news'|'blog', category:string, topicHint?:string,
 *           sourceId:string, scheduledFor?:string|null, targets?:string[] }} spec
 * @param {{ client?: object }} [deps] inject an Anthropic-shaped client for tests
 */
export async function generate(spec, deps = {}) {
  if (!config.anthropic?.enabled && !deps.client) {
    throw new Error('generate: ANTHROPIC_API_KEY is not set (and no client injected).');
  }
  const client = deps.client ?? (await defaultClient());
  const onProgress = deps.onProgress ?? (() => {}); // stage callback for live UI
  const { modelOverride } = spec;
  const profile = resolveProfile(spec.costProfile);

  onProgress({ stage: 'researching' });
  const { brief, prominence, usages } = await research(client, { ...spec, profile });
  onProgress({ stage: 'writing' });
  const { draft, model, usage: writeUsage } = await write(client, { stream: spec.stream, brief, prominence, modelOverride, profile });
  const content = draftToCanonical(draft, {
    stream: spec.stream,
    model,
    sourceId: spec.sourceId,
    scheduledFor: spec.scheduledFor ?? null,
    targets: spec.targets,
  });

  const cost = estimateCost([...(usages ?? []), { model, usage: writeUsage }]);
  return { content, prominence, brief, cost, model };
}
