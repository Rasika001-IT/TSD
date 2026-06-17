// bridge/adapters/wordpress/status-map.js
// Maps between the canonical ContentStatus vocabulary and WordPress's native
// post statuses. WP-specific knowledge stays entirely inside this adapter.

import { ContentStatus } from '../../../shared/index.js';

const TO_WP = new Map([
  [ContentStatus.PUBLISHED, 'publish'],
  [ContentStatus.SCHEDULED, 'future'],
  [ContentStatus.DRAFT, 'draft'],
  [ContentStatus.PENDING_REVIEW, 'pending'],
  [ContentStatus.PRIVATE, 'private'],
  [ContentStatus.ARCHIVED, 'draft'], // WP has no archived equivalent
  [ContentStatus.TRASH, 'trash'],
]);

const FROM_WP = new Map([
  ['publish', ContentStatus.PUBLISHED],
  ['future', ContentStatus.SCHEDULED],
  ['draft', ContentStatus.DRAFT],
  ['pending', ContentStatus.PENDING_REVIEW],
  ['private', ContentStatus.PRIVATE],
  ['trash', ContentStatus.TRASH],
  ['auto-draft', ContentStatus.DRAFT],
]);

export function toWpStatus(status) {
  return TO_WP.get(status) ?? 'draft';
}

export function fromWpStatus(wpStatus) {
  return FROM_WP.get(wpStatus) ?? ContentStatus.DRAFT;
}
