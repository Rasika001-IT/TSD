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
const effortFor = (model, effort) => (effort && supportsTuning(model) ? { effort } : {});
const normalizeOverride = (m) => (m && m !== 'auto' ? m : null);

// Build the web tool set for the research phase, bounded by the cost profile.
function webTools({ maxSearches, webFetch }) {
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }];
  if (webFetch) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxSearches });
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
    ? `an evergreen ${category} blog topic that is genuinely useful to senior business leaders`
    : `a real, current ${category} news story from the last 24–48 hours`;
  return [
    `Research ${what}.`,
    topicHint ? `Topic direction: ${topicHint}.` : '',
    '',
    'Use web search and web fetch to find and verify the facts. Prefer reputable',
    'primary and major business-news sources. Then produce a tight brief:',
    '- The angle (one sentence).',
    '- The verified facts that matter, each with the source you got it from.',
    '- Any direct quotes worth using, with exact attribution and source URL.',
    '- The companies, people, and places involved.',
    '',
    'Do not write the article yet. Only assemble verified material.',
    'End your reply with a final line exactly of the form:',
    'PROMINENCE: major   (if this is a big story covered widely by major outlets)',
    'PROMINENCE: standard   (otherwise)',
  ].filter(Boolean).join('\n');
}

/** Run the research phase. Handles the server-side-tool pause_turn loop. */
async function research(client, { stream, category, topicHint, profile }, maxContinuations = 6) {
  const r = profile.research;
  const model = r.model;
  const messages = [{ role: 'user', content: researchPrompt({ stream, category, topicHint }) }];
  const usages = [];
  let response;
  for (let i = 0; i <= maxContinuations; i++) {
    response = await client.messages.create({
      model,
      max_tokens: 16000,
      ...thinkingFor(model, r.thinking),
      ...effortFor(model, r.effort),
      tools: webTools({ maxSearches: r.maxSearches, webFetch: r.webFetch }),
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
  return [
    `Using ONLY the verified brief below, write a TSD ${stream} piece and return`,
    'it as JSON matching the required schema. Do not introduce any fact that is',
    'not supported by the brief. If the brief is thin, keep the piece shorter',
    'rather than padding it with unverified claims.',
    '',
    'Map the body into the `blocks` array (heading = an H2; paragraph = body copy;',
    'bullet_list/ordered_list use `items`; quote = a sourced pull quote;',
    stream === 'blog' ? 'key_takeaways = the end-of-post takeaways box, ~5 items in `items`).' : 'no key_takeaways block for news).',
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
  const effort = stream === 'blog' ? w.effortBlog : w.effortNews;
  const guide = buildStyleGuide(stream);
  const system = profile.promptCache
    ? [{ type: 'text', text: guide, cache_control: { type: 'ephemeral' } }] // cache the frozen style guide
    : guide;
  const response = await client.messages.create({
    model,
    max_tokens: stream === 'blog' ? 16000 : 8000,
    ...thinkingFor(model, w.thinking),
    ...effortFor(model, effort),
    system,
    output_config: { format: { type: 'json_schema', schema: outputSchema(stream) } },
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
  const { modelOverride } = spec;
  const profile = resolveProfile(spec.costProfile);

  const { brief, prominence, usages } = await research(client, { ...spec, profile });
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
