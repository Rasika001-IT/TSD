// shared/canonical.js
// Factory + helpers for the canonical content object. CMS-neutral.
// The canonical object is the contract between the agent and the bridge.
// Body is ProseMirror/TipTap JSON. Taxonomies reference name/slug only — never
// remote term IDs (resolving slug -> remote ID is each adapter's job).

import { randomUUID } from 'node:crypto';
import {
  ContentStatus,
  ContentFormat,
  Locale,
  Visibility,
  AccessLevel,
  ContentSponsorship,
  EditorialStage,
  FactCheckStatus,
  AuthorshipType,
  RobotsDirective,
  OpenGraphType,
  TwitterCardType,
} from './enums.js';

/**
 * Build a canonical content object with safe defaults.
 * Anything the agent generates defaults to `pending_review` — the gate is the
 * default, not an opt-in. Callers override fields by spreading into `input`.
 *
 * @param {object} input
 * @returns {object} canonical content object
 */
export function createCanonicalContent(input = {}) {
  const now = new Date().toISOString();

  return {
    // Identity & idempotency
    id: input.id ?? randomUUID(),
    sourceId: input.sourceId ?? null, // idempotency key from origin
    version: input.version ?? 1,

    // Classification
    type: input.type ?? null,
    format: input.format ?? ContentFormat.PROSEMIRROR_JSON,
    locale: input.locale ?? Locale.EN_US,

    // Content
    title: input.title ?? '',
    slug: input.slug ?? slugify(input.title ?? ''),
    dek: input.dek ?? '', // excerpt / standfirst
    body: input.body ?? emptyDoc(),

    // People & taxonomy
    authors: input.authors ?? [],
    taxonomies: input.taxonomies ?? [],

    // Media
    featuredImage: input.featuredImage ?? null,
    media: input.media ?? [],

    // SEO
    seo: {
      title: null,
      description: null,
      focusKeyword: null,
      canonicalUrl: null,
      robots: RobotsDirective.INDEX_FOLLOW,
      ogType: OpenGraphType.ARTICLE,
      ogImageAssetId: null,
      twitterCard: TwitterCardType.SUMMARY_LARGE_IMAGE,
      ...(input.seo ?? {}),
    },

    // Publishing controls (set by the agent)
    status: input.status ?? ContentStatus.PENDING_REVIEW, // SAFE DEFAULT
    visibility: input.visibility ?? Visibility.PUBLIC,
    accessLevel: input.accessLevel ?? AccessLevel.FREE,
    sponsorship: input.sponsorship ?? ContentSponsorship.EDITORIAL,
    scheduledFor: input.scheduledFor ?? null,
    publishedAt: input.publishedAt ?? null,

    // Editorial & audit (internal only — never exposed to readers)
    editorial: {
      stage: EditorialStage.AWAITING_REVIEW,
      factCheck: FactCheckStatus.NOT_STARTED,
      assigneeId: null,
      reviewDecision: null,
      reviewerId: null,
      editorialNotes: null,
      // Explicit, machine-set contract flag for the "names an individual" rule.
      // The agent sets this; the heuristic in agent/gating.js is only a safety net.
      namesIndividual: false,
      ...(input.editorial ?? {}),
    },

    provenance: {
      authorship: AuthorshipType.AI_GENERATED,
      generatedBy: null,
      generatedAt: now,
      promptRef: null,
      reviewedBy: null,
      reviewedAt: null,
      ...(input.provenance ?? {}),
    },

    // Routing — which CMSes to push to
    targets: input.targets ?? [],

    // Timestamps
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/** An empty ProseMirror document. */
export function emptyDoc() {
  return { type: 'doc', content: [] };
}

/** Naive, dependency-free slugifier. Good enough for slugs from titles. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/** Shallow-clone a canonical object and bump version + updatedAt. */
export function bumpVersion(content) {
  return {
    ...content,
    version: (content.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  };
}
