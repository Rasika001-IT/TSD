// bridge/poller.js
// Drains the publish_jobs outbox. For each runnable job it resolves the target
// adapter, performs the operation, and records the result in content_mapping.
// Failures retry with exponential backoff up to maxAttempts, then land in
// `failed` and surface in the dashboard. A thrown adapter error never crashes
// the poller — every job is processed inside its own try/catch.

import {
  ContentStatus,
  JobOperation,
  JobStatus,
} from '../shared/index.js';
import { getRepo } from './repo/index.js';
import { getAdapter } from './adapters/index.js';
import { assertMediaRights } from './api.js';
import { config } from './config.js';

// Statuses that must never be pushed live by the bridge. Even if a job exists,
// the poller refuses — this is the last enforcement of the human-in-the-loop gate.
const NON_PUBLISHABLE = new Set([ContentStatus.PENDING_REVIEW, ContentStatus.DRAFT]);

function backoffMs(attempt) {
  const raw = config.backoffBaseMs * 2 ** attempt;
  const capped = Math.min(raw, config.backoffMaxMs);
  // Full jitter to avoid thundering herds on shared failures.
  return Math.floor(Math.random() * capped);
}

// Upload any media that needs a remote id, and attach the ids onto a *copy* of
// the content so the adapter body can reference them. Featured image first.
async function attachMedia(content, adapter) {
  const next = structuredClone(content);
  if (next.featuredImage && !next.featuredImage.remoteId) {
    const { remoteId } = await adapter.uploadMedia(next.featuredImage);
    next.featuredImage.remoteId = remoteId;
  }
  for (const asset of next.media ?? []) {
    if (asset.type === 'image' && !asset.remoteId) {
      const { remoteId } = await adapter.uploadMedia(asset);
      asset.remoteId = remoteId;
    }
  }
  return next;
}

/**
 * Process a single claimed job. Returns the updated job row. Never throws.
 */
export async function processJob(job, repo = null) {
  repo = repo ?? (await getRepo());
  try {
    const content = await repo.getCanonicalById(job.canonicalId);
    if (!content) throw new Error(`Canonical item ${job.canonicalId} not found`);

    const isPublishOp =
      job.operation === JobOperation.CREATE || job.operation === JobOperation.UPDATE;

    // Enforce the gate at the mechanism layer too.
    if (isPublishOp && NON_PUBLISHABLE.has(content.status)) {
      return repo.updateJob(job.jobId, {
        status: JobStatus.SKIPPED,
        lastError: `Refused: canonical status "${content.status}" is not publishable`,
      });
    }

    const adapter = getAdapter(job.target);
    const mapping = await repo.getMapping(content.canonicalId ?? content.id, job.target);

    let result;
    switch (job.operation) {
      case JobOperation.CREATE:
      case JobOperation.UPDATE: {
        assertMediaRights(content);
        const withMedia = await attachMedia(content, adapter);
        // Idempotency belt-and-suspenders: if a remote already exists, update it.
        if (mapping && mapping.remoteId) {
          result = await adapter.update(mapping.remoteId, withMedia);
        } else {
          result = await adapter.create(withMedia);
        }
        await repo.upsertMapping({
          canonicalId: content.id,
          target: job.target,
          remoteId: result.remoteId,
          remoteUrl: result.remoteUrl,
          remoteStatus: result.remoteStatus,
        });
        break;
      }
      case JobOperation.UNPUBLISH:
      case JobOperation.DELETE: {
        if (!mapping?.remoteId) {
          return repo.updateJob(job.jobId, {
            status: JobStatus.SKIPPED,
            lastError: 'No remote mapping to unpublish',
          });
        }
        result = await adapter.unpublish(mapping.remoteId);
        await repo.upsertMapping({
          canonicalId: content.id,
          target: job.target,
          remoteId: mapping.remoteId,
          remoteUrl: mapping.remoteUrl,
          remoteStatus: result.remoteStatus,
        });
        break;
      }
      default:
        throw new Error(`Unknown job operation "${job.operation}"`);
    }

    return repo.updateJob(job.jobId, {
      status: JobStatus.SUCCEEDED,
      lastError: null,
    });
  } catch (err) {
    const attempts = job.attempts + 1;
    if (attempts < job.maxAttempts) {
      const nextAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
      return repo.updateJob(job.jobId, {
        status: JobStatus.RETRYING,
        attempts,
        scheduledFor: nextAt,
        lastError: String(err.message ?? err),
      });
    }
    return repo.updateJob(job.jobId, {
      status: JobStatus.FAILED,
      attempts,
      lastError: String(err.message ?? err),
    });
  }
}

/**
 * Run one poll tick: claim runnable jobs and process them. Returns the jobs
 * processed this tick. Safe to call repeatedly.
 */
export async function tick(repo = null) {
  repo = repo ?? (await getRepo());
  const now = new Date().toISOString();
  const claimed = await repo.claimRunnableJobs(now, config.batchSize);
  const results = [];
  for (const job of claimed) {
    results.push(await processJob(job, repo));
  }
  return results;
}

let timer = null;

/** Start the poller loop. Returns a stop() function. */
export function startPoller() {
  if (timer) return () => stopPoller();
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      // A repo-level failure shouldn't kill the loop; log and keep going.
      console.error('[poller] tick error:', err.message ?? err);
    }
  };
  timer = setInterval(loop, config.pollIntervalMs);
  // Kick once immediately so the first cycle isn't delayed a full interval.
  loop();
  return stopPoller;
}

export function stopPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
