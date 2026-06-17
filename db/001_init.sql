-- db/001_init.sql
-- Schema for the CMS-neutral publishing bridge. Target: PostgreSQL (Supabase).
-- Three tables: canonical_content (the store), publish_jobs (the outbox),
-- content_mapping (canonical <-> remote, one row PER target).

-- ---------------------------------------------------------------------------
-- canonical_content: the persisted canonical objects.
-- The object itself lives in `data` (JSONB); hot fields are promoted to columns
-- for indexing and dashboard queries. `source_id` is UNIQUE for idempotency.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canonical_content (
  id          UUID PRIMARY KEY,
  source_id   TEXT UNIQUE,                 -- idempotency key from origin (nullable)
  version     INTEGER NOT NULL DEFAULT 1,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL,
  data        JSONB NOT NULL,              -- full canonical object
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_status ON canonical_content (status);
CREATE INDEX IF NOT EXISTS idx_canonical_type   ON canonical_content (type);

-- ---------------------------------------------------------------------------
-- publish_jobs: the outbox the bridge poller drains.
-- A job is one (canonical item, target, operation). Retries mutate the row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publish_jobs (
  job_id        UUID PRIMARY KEY,
  canonical_id  UUID NOT NULL REFERENCES canonical_content (id) ON DELETE CASCADE,
  target        TEXT NOT NULL,             -- PublishTarget value
  operation     TEXT NOT NULL,             -- JobOperation value
  status        TEXT NOT NULL DEFAULT 'queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  scheduled_for TIMESTAMPTZ,               -- honor for scheduling + backoff
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The poller selects runnable jobs by (status, scheduled_for); index for it.
CREATE INDEX IF NOT EXISTS idx_jobs_runnable
  ON publish_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_jobs_canonical
  ON publish_jobs (canonical_id);

-- ---------------------------------------------------------------------------
-- content_mapping: canonical <-> remote per target.
-- COMPOSITE PRIMARY KEY (canonical_id, target) is the whole point: the same
-- canonical item maps to a WordPress post AND a Supabase-CMS post at once,
-- which is what lets both CMSes dual-run during cutover.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_mapping (
  canonical_id   UUID NOT NULL REFERENCES canonical_content (id) ON DELETE CASCADE,
  target         TEXT NOT NULL,            -- PublishTarget value
  remote_id      TEXT,                     -- id of the post in the remote CMS
  remote_url     TEXT,
  remote_status  TEXT,
  last_synced_at TIMESTAMPTZ,
  PRIMARY KEY (canonical_id, target)
);

CREATE INDEX IF NOT EXISTS idx_mapping_remote
  ON content_mapping (target, remote_id);

-- ---------------------------------------------------------------------------
-- app_settings: small key/value store for runtime toggles (e.g. whether the
-- generation scheduler is enabled). JSONB value so it can hold flags/objects.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
