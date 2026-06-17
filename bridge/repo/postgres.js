// bridge/repo/postgres.js
// PostgreSQL (Supabase) repository driver. Same interface as repo/memory.js,
// backed by the three tables in db/001_init.sql. Only loaded when
// DB_DRIVER=postgres (see repo/index.js), so `pg` need not be installed for
// memory-mode development or the acceptance suite.

import pg from 'pg';
import { JobStatus } from '../../shared/index.js';

const { Pool } = pg;

function rowToCanonical(row) {
  return row ? { ...row.data, id: row.id } : null;
}

function rowToJob(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    canonicalId: row.canonical_id,
    target: row.target,
    operation: row.operation,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToMapping(row) {
  if (!row) return null;
  return {
    canonicalId: row.canonical_id,
    target: row.target,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    remoteStatus: row.remote_status,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
  };
}

export function createPostgresRepo(databaseUrl) {
  if (!databaseUrl) throw new Error('createPostgresRepo: DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    // --- canonical_content -------------------------------------------------
    async saveCanonical(content) {
      await pool.query(
        `INSERT INTO canonical_content (id, source_id, version, type, status, title, slug, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           source_id = EXCLUDED.source_id, version = EXCLUDED.version, type = EXCLUDED.type,
           status = EXCLUDED.status, title = EXCLUDED.title, slug = EXCLUDED.slug,
           data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [
          content.id, content.sourceId, content.version, content.type, content.status,
          content.title, content.slug, content, content.createdAt, content.updatedAt,
        ]
      );
      return content;
    },

    async getCanonicalById(id) {
      const { rows } = await pool.query('SELECT * FROM canonical_content WHERE id = $1', [id]);
      return rowToCanonical(rows[0]);
    },

    async getCanonicalBySourceId(sourceId) {
      if (!sourceId) return null;
      const { rows } = await pool.query('SELECT * FROM canonical_content WHERE source_id = $1', [sourceId]);
      return rowToCanonical(rows[0]);
    },

    async listCanonicalByStatus(status) {
      const { rows } = await pool.query('SELECT * FROM canonical_content WHERE status = $1', [status]);
      return rows.map(rowToCanonical);
    },

    // --- publish_jobs (the outbox) ------------------------------------------
    async enqueueJob({ canonicalId, target, operation, scheduledFor = null, maxAttempts = 5 }) {
      const { rows } = await pool.query(
        `INSERT INTO publish_jobs (job_id, canonical_id, target, operation, status, attempts, max_attempts, scheduled_for)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, $5, $6)
         RETURNING *`,
        [canonicalId, target, operation, JobStatus.QUEUED, maxAttempts, scheduledFor]
      );
      return rowToJob(rows[0]);
    },

    async claimRunnableJobs(now, batchSize) {
      const { rows } = await pool.query(
        `UPDATE publish_jobs SET status = $1, updated_at = now()
         WHERE job_id IN (
           SELECT job_id FROM publish_jobs
           WHERE status IN ($2, $3) AND (scheduled_for IS NULL OR scheduled_for <= $4)
           ORDER BY created_at ASC
           LIMIT $5
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [JobStatus.PROCESSING, JobStatus.QUEUED, JobStatus.RETRYING, now, batchSize]
      );
      return rows.map(rowToJob);
    },

    async updateJob(jobId, patch) {
      const colMap = { status: 'status', attempts: 'attempts', scheduledFor: 'scheduled_for', lastError: 'last_error' };
      const fields = [];
      const values = [];
      let i = 1;
      for (const [key, col] of Object.entries(colMap)) {
        if (key in patch) {
          fields.push(`${col} = $${i++}`);
          values.push(patch[key]);
        }
      }
      fields.push('updated_at = now()');
      values.push(jobId);
      const { rows } = await pool.query(
        `UPDATE publish_jobs SET ${fields.join(', ')} WHERE job_id = $${i} RETURNING *`,
        values
      );
      return rowToJob(rows[0]);
    },

    async listJobs({ status = null, canonicalId = null } = {}) {
      const clauses = [];
      const values = [];
      let i = 1;
      if (status) { clauses.push(`status = $${i++}`); values.push(status); }
      if (canonicalId) { clauses.push(`canonical_id = $${i++}`); values.push(canonicalId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM publish_jobs ${where} ORDER BY created_at ASC`, values);
      return rows.map(rowToJob);
    },

    // --- content_mapping (composite key: canonical_id + target) -----------
    async getMapping(canonicalId, target) {
      const { rows } = await pool.query(
        'SELECT * FROM content_mapping WHERE canonical_id = $1 AND target = $2',
        [canonicalId, target]
      );
      return rowToMapping(rows[0]);
    },

    async upsertMapping({ canonicalId, target, remoteId, remoteUrl, remoteStatus }) {
      const { rows } = await pool.query(
        `INSERT INTO content_mapping (canonical_id, target, remote_id, remote_url, remote_status, last_synced_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (canonical_id, target) DO UPDATE SET
           remote_id = EXCLUDED.remote_id, remote_url = EXCLUDED.remote_url,
           remote_status = EXCLUDED.remote_status, last_synced_at = now()
         RETURNING *`,
        [canonicalId, target, remoteId, remoteUrl, remoteStatus]
      );
      return rowToMapping(rows[0]);
    },

    async listMappings(canonicalId) {
      const { rows } = await pool.query('SELECT * FROM content_mapping WHERE canonical_id = $1', [canonicalId]);
      return rows.map(rowToMapping);
    },
  };
}
