// agent/index.js
// The editorial agent. Takes a source object (a news-pack or feature handed in),
// produces a canonical content object, sets its status per the gating rules, and
// hands it to the bridge. It imports ONLY /shared and the bridge's public API —
// nothing CMS-specific. It never talks to a CMS.

import {
  createCanonicalContent,
  slugify,
  ContentType,
  ContentFormat,
  AuthorshipType,
  PublishTarget,
} from '../shared/index.js';
import { publish } from '../bridge/index.js';
import { decideStatus } from './gating.js';
import { staggerTimes } from './stagger.js';

/**
 * Build a canonical object from a loosely-shaped source pack. The source is
 * assumed to already carry a ProseMirror body (the upstream generator's output).
 *
 * @param {object} pack
 * @returns {object} canonical content (status not yet decided)
 */
export function buildCanonical(pack) {
  return createCanonicalContent({
    sourceId: pack.sourceId,
    type: pack.type ?? ContentType.NEWS,
    format: ContentFormat.PROSEMIRROR_JSON,
    locale: pack.locale,
    title: pack.title,
    slug: pack.slug ?? slugify(pack.title ?? ''),
    dek: pack.dek,
    body: pack.body,
    authors: pack.authors ?? [{ name: 'TSD Desk', slug: 'tsd-desk' }],
    taxonomies: pack.taxonomies ?? [],
    featuredImage: pack.featuredImage ?? null,
    media: pack.media ?? [],
    seo: pack.seo ?? {},
    targets: pack.targets ?? [PublishTarget.WORDPRESS],
    editorial: {
      namesIndividual: pack.namesIndividual ?? false,
      // Only override the factory default when the pack actually carries one;
      // passing factCheck: undefined would clobber the NOT_STARTED default.
      ...(pack.factCheck ? { factCheck: pack.factCheck } : {}),
    },
    provenance: {
      authorship: pack.authorship ?? AuthorshipType.AI_GENERATED,
      generatedBy: pack.generatedBy ?? null,
      promptRef: pack.promptRef ?? null,
    },
  });
}

/**
 * Ingest one source pack: build -> gate -> publish (persist + maybe enqueue).
 *
 * @param {object} pack
 * @param {{ allowAutoSchedule?: boolean, scheduledFor?: string|null }} opts
 * @returns {Promise<{ content: object, jobs: object[], idempotent: boolean, decision: object }>}
 */
export async function ingest(pack, opts = {}) {
  const base = buildCanonical(pack);
  const decision = decideStatus(base, opts);

  const content = {
    ...base,
    status: decision.status,
    scheduledFor: opts.scheduledFor ?? base.scheduledFor ?? null,
    editorial: { ...base.editorial, stage: decision.stage },
  };

  const result = await publish(content);
  return { ...result, decision };
}

/**
 * Ingest a batch, staggering scheduled releases across the day so nothing
 * dumps all at once.
 *
 * @param {object[]} packs
 * @param {{ allowAutoSchedule?: boolean, window?: { start?: Date, end?: Date } }} opts
 */
export async function ingestBatch(packs, opts = {}) {
  const times = staggerTimes(packs.length, opts.window);
  const results = [];
  for (let i = 0; i < packs.length; i++) {
    results.push(
      await ingest(packs[i], { allowAutoSchedule: opts.allowAutoSchedule, scheduledFor: times[i] })
    );
  }
  return results;
}
