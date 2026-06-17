// shared/validate.js
// Runtime validation of the canonical content object. This is the last line of
// defense before content reaches an adapter: a malformed canonical object should
// fail loudly here, not produce a half-broken remote post. CMS-neutral.

import { z } from 'zod';
import {
  ContentStatus,
  EditorialStage,
  ReviewDecision,
  FactCheckStatus,
  ContentType,
  ContentFormat,
  Locale,
  Visibility,
  AccessLevel,
  ContentSponsorship,
  MediaType,
  MediaRole,
  MediaLicense,
  TaxonomyType,
  RobotsDirective,
  OpenGraphType,
  TwitterCardType,
  AuthorshipType,
  PublishTarget,
  valuesOf,
} from './enums.js';

const zEnum = (enumObj) => z.enum(valuesOf(enumObj));

const authorSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  bio: z.string().nullish(),
  email: z.string().email().nullish(),
});

const taxonomySchema = z.object({
  type: zEnum(TaxonomyType),
  name: z.string().min(1),
  slug: z.string().min(1),
  parentSlug: z.string().nullish(),
});

const mediaSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  type: zEnum(MediaType),
  mimeType: z.string().nullish(),
  role: zEnum(MediaRole),
  license: zEnum(MediaLicense),
  alt: z.string().nullish(),
  caption: z.string().nullish(),
  credit: z.string().nullish(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
});

// ProseMirror body: a doc node with a content array. We validate structure
// shallowly (type: 'doc' + array of nodes); deep node validation is the
// editor's responsibility, not the publishing layer's.
const prosemirrorDoc = z.object({
  type: z.literal('doc'),
  content: z.array(z.object({ type: z.string() }).passthrough()),
});

const seoSchema = z.object({
  title: z.string().nullish(),
  description: z.string().nullish(),
  focusKeyword: z.string().nullish(),
  canonicalUrl: z.string().url().nullish(),
  robots: zEnum(RobotsDirective),
  ogType: zEnum(OpenGraphType),
  ogImageAssetId: z.string().nullish(),
  twitterCard: zEnum(TwitterCardType),
});

const editorialSchema = z.object({
  stage: zEnum(EditorialStage),
  factCheck: zEnum(FactCheckStatus),
  assigneeId: z.string().nullish(),
  reviewDecision: zEnum(ReviewDecision).nullish(),
  reviewerId: z.string().nullish(),
  editorialNotes: z.string().nullish(),
  namesIndividual: z.boolean().default(false),
});

const provenanceSchema = z.object({
  authorship: zEnum(AuthorshipType),
  generatedBy: z.string().nullish(),
  generatedAt: z.string().nullish(),
  promptRef: z.string().nullish(),
  reviewedBy: z.string().nullish(),
  reviewedAt: z.string().nullish(),
});

export const canonicalSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().min(1).nullable(),
  version: z.number().int().positive(),

  type: zEnum(ContentType),
  format: zEnum(ContentFormat),
  locale: zEnum(Locale),

  title: z.string().min(1),
  slug: z.string().min(1),
  dek: z.string().nullish(),
  body: prosemirrorDoc,

  authors: z.array(authorSchema),
  taxonomies: z.array(taxonomySchema),

  featuredImage: mediaSchema.nullable(),
  media: z.array(mediaSchema),

  seo: seoSchema,

  status: zEnum(ContentStatus),
  visibility: zEnum(Visibility),
  accessLevel: zEnum(AccessLevel),
  sponsorship: zEnum(ContentSponsorship),
  scheduledFor: z.string().nullable(),
  publishedAt: z.string().nullable(),

  editorial: editorialSchema,
  provenance: provenanceSchema,

  targets: z.array(zEnum(PublishTarget)),

  createdAt: z.string(),
  updatedAt: z.string(),
})
  // A scheduled item must carry a scheduledFor timestamp, or the poller has
  // nothing to honor.
  .refine(
    (c) => c.status !== ContentStatus.SCHEDULED || !!c.scheduledFor,
    { message: 'status=scheduled requires scheduledFor', path: ['scheduledFor'] }
  );

/**
 * Validate and return the parsed object, or throw a ValidationError with a
 * readable summary.
 * @param {object} content
 */
export function validateCanonical(content) {
  const result = canonicalSchema.safeParse(content);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    const err = new Error(`Invalid canonical content: ${issues}`);
    err.name = 'ValidationError';
    err.issues = result.error.issues;
    throw err;
  }
  return result.data;
}

/** Non-throwing variant. Returns { ok, data?, issues? }. */
export function safeValidateCanonical(content) {
  const result = canonicalSchema.safeParse(content);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, issues: result.error.issues };
}
