// bridge/repo/memory.js
// In-memory repository driver — the default. The whole system, and the
// acceptance suite, run against this with no database at all. Implements the
// same interface as repo/postgres.js; selection happens in repo/index.js.

import { randomUUID } from 'node:crypto';
import { JobStatus } from '../../shared/index.js';

export function createMemoryRepo() {
  const canonicalById = new Map();
  const jobs = new Map(); // jobId -> job
  const mappings = new Map(); // `${canonicalId}::${target}` -> mapping
  const settings = new Map(); // key -> value (runtime toggles)

  const mappingKey = (canonicalId, target) => `${canonicalId}::${target}`;

  return {
    // --- canonical_content -------------------------------------------------
    async saveCanonical(content) {
      canonicalById.set(content.id, { ...content });
      return { ...content };
    },

    async getCanonicalById(id) {
      const found = canonicalById.get(id);
      return found ? { ...found } : null;
    },

    async getCanonicalBySourceId(sourceId) {
      if (!sourceId) return null;
      for (const c of canonicalById.values()) {
        if (c.sourceId === sourceId) return { ...c };
      }
      return null;
    },

    async listCanonicalByStatus(status) {
      return [...canonicalById.values()]
        .filter((c) => c.status === status)
        .map((c) => ({ ...c }));
    },

    // --- publish_jobs (the outbox) ------------------------------------------
    async enqueueJob({ canonicalId, target, operation, scheduledFor = null, maxAttempts = 5 }) {
      const now = new Date().toISOString();
      const job = {
        jobId: randomUUID(),
        canonicalId,
        target,
        operation,
        status: JobStatus.QUEUED,
        attempts: 0,
        maxAttempts,
        scheduledFor,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(job.jobId, job);
      return { ...job };
    },

    async claimRunnableJobs(now, batchSize) {
      const runnable = [...jobs.values()]
        .filter(
          (j) =>
            (j.status === JobStatus.QUEUED || j.status === JobStatus.RETRYING) &&
            (!j.scheduledFor || j.scheduledFor <= now)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, batchSize);

      // Mark claimed so a concurrent tick doesn't double-process the same job.
      for (const j of runnable) {
        j.status = JobStatus.PROCESSING;
        j.updatedAt = new Date().toISOString();
      }
      return runnable.map((j) => ({ ...j }));
    },

    async updateJob(jobId, patch) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`updateJob: no job with id ${jobId}`);
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      return { ...job };
    },

    async listJobs({ status = null, canonicalId = null } = {}) {
      return [...jobs.values()]
        .filter((j) => (status ? j.status === status : true))
        .filter((j) => (canonicalId ? j.canonicalId === canonicalId : true))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((j) => ({ ...j }));
    },

    // --- content_mapping (composite key: canonicalId + target) -------------
    async getMapping(canonicalId, target) {
      const m = mappings.get(mappingKey(canonicalId, target));
      return m ? { ...m } : null;
    },

    async upsertMapping({ canonicalId, target, remoteId, remoteUrl, remoteStatus }) {
      const mapping = {
        canonicalId,
        target,
        remoteId,
        remoteUrl,
        remoteStatus,
        lastSyncedAt: new Date().toISOString(),
      };
      mappings.set(mappingKey(canonicalId, target), mapping);
      return { ...mapping };
    },

    async listMappings(canonicalId) {
      return [...mappings.values()]
        .filter((m) => m.canonicalId === canonicalId)
        .map((m) => ({ ...m }));
    },

    // --- app_settings (runtime toggles) ------------------------------------
    async getSetting(key, fallback = null) {
      return settings.has(key) ? settings.get(key) : fallback;
    },

    async setSetting(key, value) {
      settings.set(key, value);
      return value;
    },
  };
}
