// shared/enums.js
// Single source of truth for all controlled vocabularies in the canonical model.
// CMS-NEUTRAL: nothing here knows about WordPress, Supabase, or any specific CMS.
// PublishTarget is the one enum that names targets — adding a CMS adds a value here
// (a plain string token), but no CMS *logic* ever lives in /shared.

/** @param {Record<string,string>} obj */
const freeze = (obj) => Object.freeze(obj);

export const ContentStatus = freeze({
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  PRIVATE: 'private',
  ARCHIVED: 'archived',
  TRASH: 'trash',
});

// Kept deliberately SEPARATE from ContentStatus. Stage tracks the newsroom
// workflow; status tracks the publishing lifecycle. They move independently.
export const EditorialStage = freeze({
  IDEA: 'idea',
  ASSIGNED: 'assigned',
  DRAFTING: 'drafting',
  AWAITING_REVIEW: 'awaiting_review',
  IN_FACT_CHECK: 'in_fact_check',
  REVISIONS_REQUESTED: 'revisions_requested',
  APPROVED: 'approved',
  READY_TO_PUBLISH: 'ready_to_publish',
});

export const ReviewDecision = freeze({
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REJECTED: 'rejected',
});

export const FactCheckStatus = freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  PASSED: 'passed',
  FLAGGED: 'flagged',
  FAILED: 'failed',
});

export const ContentType = freeze({
  NEWS: 'news',
  BLOG: 'blog',
  FEATURE: 'feature',
  INTERVIEW: 'interview',
  RANKING_LIST: 'ranking_list',
  REPORT: 'report',
  PAGE: 'page',
});

export const ContentFormat = freeze({
  PROSEMIRROR_JSON: 'prosemirror_json', // canonical body format
  HTML: 'html',
  MARKDOWN: 'markdown',
  GUTENBERG_BLOCKS: 'gutenberg_blocks', // WP adapter output only — never canonical input
});

export const Locale = freeze({
  EN_US: 'en_US',
  EN_GB: 'en_GB',
});

export const Visibility = freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
  PASSWORD_PROTECTED: 'password_protected',
});

export const AccessLevel = freeze({
  FREE: 'free',
  REGISTERED: 'registered',
  SUBSCRIBER: 'subscriber',
  PREMIUM: 'premium',
});

export const ContentSponsorship = freeze({
  EDITORIAL: 'editorial',
  PAID_FEATURE: 'paid_feature',
  SPONSORED: 'sponsored',
  ADVERTORIAL: 'advertorial',
});

export const MediaType = freeze({
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
  EMBED: 'embed',
});

export const MediaRole = freeze({
  FEATURED: 'featured',
  INLINE: 'inline',
  GALLERY: 'gallery',
  THUMBNAIL: 'thumbnail',
  OG_IMAGE: 'og_image',
});

export const MediaLicense = freeze({
  OWNED: 'owned',
  LICENSED: 'licensed',
  ROYALTY_FREE: 'royalty_free',
  CREATIVE_COMMONS: 'creative_commons',
  PUBLIC_DOMAIN: 'public_domain',
  AI_GENERATED: 'ai_generated',
});

// Licenses we are willing to publish. Anything outside this set is rejected
// by the bridge before it reaches an adapter (no scraped / unknown-origin media).
// Note: ai_generated is intentionally NOT clearable for publication by default —
// it must be reviewed, matching the human-in-the-loop posture.
export const PUBLISHABLE_LICENSES = Object.freeze([
  MediaLicense.OWNED,
  MediaLicense.LICENSED,
  MediaLicense.ROYALTY_FREE,
  MediaLicense.CREATIVE_COMMONS,
  MediaLicense.PUBLIC_DOMAIN,
]);

export const TaxonomyType = freeze({
  CATEGORY: 'category',
  TAG: 'tag',
  INDUSTRY: 'industry',
  REGION: 'region',
  TOPIC: 'topic',
});

export const RobotsDirective = freeze({
  INDEX_FOLLOW: 'index,follow',
  NOINDEX_FOLLOW: 'noindex,follow',
  INDEX_NOFOLLOW: 'index,nofollow',
  NOINDEX_NOFOLLOW: 'noindex,nofollow',
});

export const OpenGraphType = freeze({
  ARTICLE: 'article',
  WEBSITE: 'website',
  PROFILE: 'profile',
});

export const TwitterCardType = freeze({
  SUMMARY: 'summary',
  SUMMARY_LARGE_IMAGE: 'summary_large_image',
});

export const AuthorshipType = freeze({
  HUMAN: 'human',
  AI_GENERATED: 'ai_generated',
  AI_ASSISTED: 'ai_assisted',
});

export const UserRole = freeze({
  ADMINISTRATOR: 'administrator',
  EDITOR: 'editor',
  AUTHOR: 'author',
  CONTRIBUTOR: 'contributor',
  SUBSCRIBER: 'subscriber',
});

// The ONLY enum that names CMSes. Adding a CMS = add a token here + an adapter
// under /bridge/adapters/<name>. No other /shared change is permitted or needed.
export const PublishTarget = freeze({
  WORDPRESS: 'wordpress',
  SUPABASE_CMS: 'supabase_cms',
});

export const JobOperation = freeze({
  CREATE: 'create',
  UPDATE: 'update',
  UNPUBLISH: 'unpublish',
  DELETE: 'delete',
});

export const JobStatus = freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  RETRYING: 'retrying',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
});

/** Convenience: array of allowed values for an enum object. */
export const valuesOf = (enumObj) => Object.values(enumObj);

/** True if `value` is one of the enum's allowed values. */
export const isValid = (enumObj, value) => Object.values(enumObj).includes(value);
