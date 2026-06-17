// bridge/api.js
// The stable, CMS-neutral API the agent (and dashboard) call. Canonical-centric
// and enqueue-oriented: it persists canonical objects and writes jobs to the
// outbox. It makes NO editorial decisions and does NO remote calls itself — the
// poller drains the outbox and invokes adapters.
//
// NOTE on method names: these five names (publish/update/unpublish/getStatus/
// uploadMedia) intentionally mirror the adapter interface, but they live at a
// different layer. Here they are canonical-centric and queue work; on the
// adapter they are remote-centric and execute it. See README.

import {
  validateCanonical,
  bumpVersion,
  ContentStatus,
  JobOperation,
  PublishTarget,
  PUBLISHABLE_LICENSES,
} from '../shared/index.js';
import { getRepo } from './repo/index.js';
import { getAdapter } from './adapters/index.js';
import { config } from './config.js';

// Statuses that mean "the agent has cleared this for the bridge to act on".
// Anything else (draft, pending_review) is stored but never enqueued.
const PUBLISHABLE_STATUSES = new Set([
  ContentStatus.SCHEDULED,
  ContentStatus.PUBLISHED,
  ContentStatus.PRIVATE,
]);

/** Reject media whose license is not publishable. Throws on the first bad asset. */
export function assertMediaRights(content) {
  const assets = [content.featuredImage, ...(content.media ?? [])].filter(Boolean);
  for (const a of assets) {
    if (!PUBLISHABLE_LICENSES.includes(a.license)) {
      throw new Error(
        `Media "${a.id}" has non-publishable license "${a.license}". ` +
          `Allowed: ${PUBLISHABLE_LICENSES.join(', ')}.`
      );
    }
  }
}

/**
 * Enqueue one job per target for a canonical item. Chooses create vs update by
 * whether a remote mapping already exists (idempotency belt-and-suspenders).
 */
async function enqueueForTargets(content, repo) {
  const jobs = [];
  const targets = content.targets?.length ? content.targets : [];
  for (const target of targets) {
    const mapping = await repo.getMapping(content.id, target);
    const operation =
      mapping && mapping.remoteId ? JobOperation.UPDATE : JobOperation.CREATE;
    const job = await repo.enqueueJob({
      canonicalId: content.id,
      target,
      operation,
      scheduledFor: content.scheduledFor ?? null,
      maxAttempts: config.defaultMaxAttempts,
    });
    jobs.push(job);
  }
  return jobs;
}

/**
 * publish(content): persist a canonical object idempotently and, IF the agent
 * has set a publishable status, enqueue jobs for its targets.
 *
 * Idempotency: a second ingest of the same sourceId updates the stored canonical
 * (bumping version) rather than creating a new record — never a duplicate.
 *
 * @returns {Promise<{ content: object, jobs: object[], idempotent: boolean }>}
 */
export async function publish(content) {
  const repo = await getRepo();
  const valid = validateCanonical(content);
  assertMediaRights(valid);

  let toStore = valid;
  let idempotent = false;

  if (valid.sourceId) {
    const existing = await repo.getCanonicalBySourceId(valid.sourceId);
    if (existing) {
      idempotent = true;
      // Re-ingest: keep the original canonical id, bump version, carry new fields.
      toStore = bumpVersion({ ...valid, id: existing.id, createdAt: existing.createdAt });
    }
  }

  await repo.saveCanonical(toStore);

  let jobs = [];
  if (PUBLISHABLE_STATUSES.has(toStore.status)) {
    jobs = await enqueueForTargets(toStore, repo);
  }
  return { content: toStore, jobs, idempotent };
}

/**
 * update(canonicalId, content): persist a new version of an existing canonical
 * item and enqueue update/create jobs for its targets.
 */
export async function update(canonicalId, content) {
  const repo = await getRepo();
  const existing = await repo.getCanonicalById(canonicalId);
  if (!existing) throw new Error(`update: no canonical item with id ${canonicalId}`);
  const merged = bumpVersion({ ...content, id: canonicalId, createdAt: existing.createdAt });
  const valid = validateCanonical(merged);
  assertMediaRights(valid);
  await repo.saveCanonical(valid);
  const jobs = PUBLISHABLE_STATUSES.has(valid.status)
    ? await enqueueForTargets(valid, repo)
    : [];
  return { content: valid, jobs };
}

/**
 * unpublish(canonicalId): enqueue unpublish jobs for every target this item is
 * currently mapped to.
 */
export async function unpublish(canonicalId) {
  const repo = await getRepo();
  const mappings = await repo.listMappings(canonicalId);
  const jobs = [];
  for (const m of mappings) {
    jobs.push(
      await repo.enqueueJob({
        canonicalId,
        target: m.target,
        operation: JobOperation.UNPUBLISH,
        maxAttempts: config.defaultMaxAttempts,
      })
    );
  }
  return { jobs };
}

/**
 * getStatus(canonicalId): return the remote status for this item across all
 * targets, refreshed from each adapter. Falls back to the stored mapping if an
 * adapter call fails.
 */
export async function getStatus(canonicalId) {
  const repo = await getRepo();
  const mappings = await repo.listMappings(canonicalId);
  const out = [];
  for (const m of mappings) {
    if (!m.remoteId) {
      out.push({ target: m.target, remoteStatus: null, remoteUrl: null });
      continue;
    }
    try {
      const adapter = getAdapter(m.target);
      const live = await adapter.getStatus(m.remoteId);
      out.push({ target: m.target, ...live, remoteId: m.remoteId });
    } catch {
      out.push({
        target: m.target,
        remoteStatus: m.remoteStatus,
        remoteUrl: m.remoteUrl,
        remoteId: m.remoteId,
        stale: true,
      });
    }
  }
  return out;
}

/**
 * uploadMedia(asset, target): upload a single asset to one target's adapter.
 * Enforces media rights first. Returns { remoteId, url }.
 */
export async function uploadMedia(asset, target) {
  if (!PUBLISHABLE_LICENSES.includes(asset.license)) {
    throw new Error(`uploadMedia: license "${asset.license}" is not publishable`);
  }
  const adapter = getAdapter(target ?? PublishTarget.WORDPRESS);
  return adapter.uploadMedia(asset);
}

export { enqueueForTargets, PUBLISHABLE_STATUSES };
