// agent/gating.js
// EDITORIAL POLICY (the "what"). This is the agent's job, not the bridge's.
// It decides the status an item should carry. Safe-by-default: unless an item
// clearly qualifies for auto-scheduling AND that is explicitly enabled, it
// routes to pending_review.

import {
  ContentStatus,
  ContentType,
  EditorialStage,
  FactCheckStatus,
} from '../shared/index.js';

// Types that ALWAYS require human review — never auto-published.
const ALWAYS_REVIEW_TYPES = new Set([ContentType.FEATURE, ContentType.INTERVIEW]);

// Best-effort heuristic for "names an individual". This is a SAFETY NET, not the
// contract. The reliable signal is content.editorial.namesIndividual, which the
// upstream generation step should set. Detecting people in free text reliably is
// out of scope here; this heuristic only ever errors toward MORE review.
//
// Senior-question flag: a heuristic like this will over-trigger on capitalized
// product names and place names. That is acceptable for a safety gate (false
// positives cost a review, false negatives cost credibility) but it is NOT a
// substitute for an explicit upstream signal.
const NAME_HINT = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/; // two capitalized words in a row

export function mentionsIndividualHeuristic(content) {
  if (content.editorial?.namesIndividual === true) return true;
  const haystack = [content.title, content.dek].filter(Boolean).join(' ');
  return NAME_HINT.test(haystack);
}

/**
 * Decide the publishing status for a freshly generated item.
 *
 * Rules:
 *  - Default everything to pending_review.
 *  - feature / interview, or anything naming an individual: ALWAYS pending_review.
 *  - news / blog may auto-schedule ONLY when allowAutoSchedule is true AND
 *    fact-check has passed. Otherwise pending_review.
 *
 * @param {object} content canonical object (pre-status)
 * @param {{ allowAutoSchedule?: boolean, scheduledFor?: string|null }} opts
 * @returns {{ status: string, stage: string, reason: string }}
 */
export function decideStatus(content, opts = {}) {
  const { allowAutoSchedule = false } = opts;

  if (ALWAYS_REVIEW_TYPES.has(content.type)) {
    return {
      status: ContentStatus.PENDING_REVIEW,
      stage: EditorialStage.AWAITING_REVIEW,
      reason: `type "${content.type}" always routes to review`,
    };
  }

  if (mentionsIndividualHeuristic(content)) {
    return {
      status: ContentStatus.PENDING_REVIEW,
      stage: EditorialStage.AWAITING_REVIEW,
      reason: 'item appears to name an individual; routing to review',
    };
  }

  const canAuto =
    allowAutoSchedule &&
    (content.type === ContentType.NEWS || content.type === ContentType.BLOG) &&
    content.editorial?.factCheck === FactCheckStatus.PASSED;

  if (canAuto) {
    return {
      status: ContentStatus.SCHEDULED,
      stage: EditorialStage.READY_TO_PUBLISH,
      reason: 'eligible news/blog with passed fact-check and auto-schedule enabled',
    };
  }

  return {
    status: ContentStatus.PENDING_REVIEW,
    stage: EditorialStage.AWAITING_REVIEW,
    reason: 'default safe gate',
  };
}
