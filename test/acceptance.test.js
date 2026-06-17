// test/acceptance.test.js
// Proves the acceptance criteria from the build spec against the in-memory
// driver (no live DB, no live WordPress needed). Run: `node --test test/`.
//
// Strategy: each test injects a fresh memory repo via _setRepo, drives the
// system through its real public surfaces (agent.ingest, bridge.publish/tick,
// the dashboard Express app), and asserts observable behavior. Where a test
// must isolate the bridge mechanism from a live CMS, it registers a local stub
// adapter over a target and restores the real adapters afterward.

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
  createCanonicalContent,
  ContentStatus,
  ContentType,
  FactCheckStatus,
  JobStatus,
  JobOperation,
  PublishTarget,
  AuthorshipType,
} from '../shared/index.js';

import { publish } from '../bridge/api.js';
import { tick as bridgeTick } from '../bridge/poller.js';
import {
  registerAdapter,
  getAdapter,
  hasAdapter,
} from '../bridge/adapters/index.js';
import { createSupabaseCmsAdapter } from '../bridge/adapters/supabase-cms/index.js';
import { createWordPressAdapter } from '../bridge/adapters/wordpress/index.js';
import { config } from '../bridge/config.js';
import { getRepo, _setRepo } from '../bridge/repo/index.js';
import { createMemoryRepo } from '../bridge/repo/memory.js';
import { ingest } from '../agent/index.js';
import { prosemirrorToGutenberg } from '../bridge/adapters/wordpress/prosemirror-to-gutenberg.js';

// poller re-exports tick; api.js does not export tick — import from poller.
const runTick = bridgeTick;

// --- helpers ----------------------------------------------------------------

const body = (text = 'First paragraph of copy.') => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function makeCanonical(overrides = {}) {
  return createCanonicalContent({
    sourceId: 'src-default',
    type: ContentType.NEWS,
    title: 'Sample wire item',
    slug: 'sample-wire-item',
    dek: 'Standfirst.',
    body: body(),
    targets: [PublishTarget.SUPABASE_CMS],
    status: ContentStatus.PUBLISHED, // publishable so the bridge will act
    provenance: { authorship: AuthorshipType.AI_GENERATED, generatedBy: 'test' },
    ...overrides,
  });
}

/** A trivial in-memory adapter that always succeeds. */
function stubAdapter(label) {
  let n = 0;
  const store = new Map();
  return {
    name: label,
    async uploadMedia(a) { return { remoteId: `${label}_media_${a.id}`, url: a.url }; },
    async create(content) {
      const remoteId = `${label}_${++n}`;
      store.set(remoteId, content);
      return { remoteId, remoteUrl: `${label}://${remoteId}`, remoteStatus: content.status };
    },
    async update(remoteId, content) {
      store.set(remoteId, content);
      return { remoteId, remoteUrl: `${label}://${remoteId}`, remoteStatus: content.status };
    },
    async unpublish(remoteId) { return { remoteId, remoteStatus: 'draft' }; },
    async getStatus(remoteId) { return { remoteStatus: store.has(remoteId) ? 'published' : 'unknown' }; },
    _store: store,
  };
}

/** An adapter whose create() always throws — to exercise retry/backoff. */
function flakyAdapter() {
  return {
    name: 'flaky',
    async uploadMedia() { return { remoteId: 'x', url: 'x' }; },
    async create() { throw new Error('simulated adapter failure'); },
    async update() { throw new Error('simulated adapter failure'); },
    async unpublish() { throw new Error('simulated adapter failure'); },
    async getStatus() { throw new Error('simulated adapter failure'); },
  };
}

function restoreDefaultAdapters() {
  registerAdapter(PublishTarget.WORDPRESS, createWordPressAdapter(config.wordpress));
  registerAdapter(PublishTarget.SUPABASE_CMS, createSupabaseCmsAdapter());
}

beforeEach(() => {
  _setRepo(createMemoryRepo());
});

after(() => {
  restoreDefaultAdapters();
});

// --- 1. Idempotency ---------------------------------------------------------

test('ingesting the same sourceId twice yields one remote post', async () => {
  const sb = stubAdapter('sb');
  registerAdapter(PublishTarget.SUPABASE_CMS, sb);
  try {
    const c1 = makeCanonical({ sourceId: 'tariffs-001', title: 'Tariffs v1' });
    const r1 = await publish(c1);
    assert.equal(r1.idempotent, false);
    assert.equal(r1.jobs.length, 1);
    await runTick();

    // Re-ingest same sourceId with new content.
    const c2 = makeCanonical({ sourceId: 'tariffs-001', title: 'Tariffs v2' });
    const r2 = await publish(c2);
    assert.equal(r2.idempotent, true, 'second ingest recognized as idempotent');
    assert.equal(r2.content.id, r1.content.id, 'canonical id is stable across re-ingest');
    assert.equal(r2.jobs[0].operation, JobOperation.UPDATE, 'second job is an update, not create');
    await runTick();

    const repo = await getRepo();
    const mappings = await repo.listMappings(r1.content.id);
    assert.equal(mappings.length, 1, 'exactly one mapping row for the target');
    assert.equal(sb._store.size, 1, 'exactly one remote record exists');
  } finally {
    restoreDefaultAdapters();
  }
});

// --- 2. The gate: pending_review never publishes ----------------------------

test('a pending_review item is never enqueued or pushed live', async () => {
  // Agent path: a plain news item with auto-schedule OFF stays pending_review
  // and enqueues nothing.
  const res = await ingest(
    {
      sourceId: 'gate-001',
      type: ContentType.NEWS,
      title: 'Routine market note',
      body: body(),
      targets: [PublishTarget.SUPABASE_CMS],
    },
    { allowAutoSchedule: false }
  );
  assert.equal(res.content.status, ContentStatus.PENDING_REVIEW);
  assert.equal(res.jobs.length, 0, 'pending_review enqueues no jobs');

  // Mechanism path: even if a job is forced onto the outbox for a pending_review
  // item, the poller refuses and marks it skipped — the gate is enforced twice.
  const repo = await getRepo();
  const pending = makeCanonical({
    sourceId: 'gate-002',
    status: ContentStatus.PENDING_REVIEW,
  });
  await repo.saveCanonical(pending);
  await repo.enqueueJob({
    canonicalId: pending.id,
    target: PublishTarget.SUPABASE_CMS,
    operation: JobOperation.CREATE,
    maxAttempts: 3,
  });
  await runTick();

  const jobs = await repo.listJobs({ canonicalId: pending.id });
  assert.equal(jobs[0].status, JobStatus.SKIPPED, 'poller refuses pending_review');
  const mappings = await repo.listMappings(pending.id);
  assert.equal(mappings.length, 0, 'nothing was pushed to any CMS');
});

// --- 3. Dashboard approval flips status and publishes within one cycle ------

test('approving in the dashboard flips status and the bridge publishes', async () => {
  process.env.DASH_PORT = process.env.DASH_PORT ?? '4733';
  const { startDashboardServer } = await import('../dashboard/server.js');
  const server = startDashboardServer();
  await once(server, 'listening');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // Agent ingests a reviewable item (stays pending_review, no jobs).
    const ing = await ingest(
      {
        sourceId: 'approve-001',
        type: ContentType.NEWS,
        title: 'Quarterly outlook',
        body: body(),
        targets: [PublishTarget.SUPABASE_CMS],
      },
      { allowAutoSchedule: false }
    );
    const id = ing.content.id;
    assert.equal(ing.content.status, ContentStatus.PENDING_REVIEW);

    // It shows up in the review queue.
    const queue = await (await fetch(`${base}/api/items?status=pending_review`)).json();
    assert.ok(queue.items.some((i) => i.id === id), 'item appears in pending_review queue');

    // Editor approves.
    const approveRes = await fetch(`${base}/api/items/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });
    const approved = await approveRes.json();
    assert.equal(approved.content.status, ContentStatus.PUBLISHED, 'status flips to published');
    assert.equal(approved.jobs.length, 1, 'approval enqueues a publish job');

    // One poll cycle pushes it live.
    await runTick();
    const repo = await getRepo();
    const mappings = await repo.listMappings(id);
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].remoteStatus, ContentStatus.PUBLISHED);
    const jobs = await repo.listJobs({ canonicalId: id });
    assert.equal(jobs[0].status, JobStatus.SUCCEEDED, 'job succeeded within one cycle');
  } finally {
    server.close();
    await once(server, 'close');
  }
});

// --- 4. Dual-run: one item, two targets, two mapping rows -------------------

test('publishing one item to both targets yields two mapping rows', async () => {
  registerAdapter(PublishTarget.WORDPRESS, stubAdapter('wp'));
  registerAdapter(PublishTarget.SUPABASE_CMS, stubAdapter('sb'));
  try {
    const c = makeCanonical({
      sourceId: 'dual-001',
      targets: [PublishTarget.WORDPRESS, PublishTarget.SUPABASE_CMS],
    });
    const r = await publish(c);
    assert.equal(r.jobs.length, 2, 'one job per target');
    await runTick();

    const repo = await getRepo();
    const mappings = await repo.listMappings(r.content.id);
    assert.equal(mappings.length, 2, 'two mapping rows, one per target');
    const targets = mappings.map((m) => m.target).sort();
    assert.deepEqual(targets, [PublishTarget.SUPABASE_CMS, PublishTarget.WORDPRESS].sort());
    const remoteIds = new Set(mappings.map((m) => m.remoteId));
    assert.equal(remoteIds.size, 2, 'distinct remote ids per target');
  } finally {
    restoreDefaultAdapters();
  }
});

// --- 5. Retry with backoff, then surface — without crashing the poller ------

test('a failing adapter retries with backoff and ends failed, poller survives', async () => {
  registerAdapter(PublishTarget.SUPABASE_CMS, flakyAdapter());
  try {
    const repo = await getRepo();

    // (a) maxAttempts=3: first failure -> retrying, with a future scheduledFor.
    const retryItem = makeCanonical({ sourceId: 'retry-001' });
    await repo.saveCanonical(retryItem);
    await repo.enqueueJob({
      canonicalId: retryItem.id,
      target: PublishTarget.SUPABASE_CMS,
      operation: JobOperation.CREATE,
      maxAttempts: 3,
    });
    const before = new Date().toISOString();
    await assert.doesNotReject(runTick(), 'poller does not throw on adapter failure');
    const [retryJob] = await repo.listJobs({ canonicalId: retryItem.id });
    assert.equal(retryJob.status, JobStatus.RETRYING);
    assert.equal(retryJob.attempts, 1);
    assert.ok(retryJob.lastError.includes('simulated adapter failure'));
    assert.ok(retryJob.scheduledFor && retryJob.scheduledFor >= before, 'backoff defers next attempt');

    // (b) maxAttempts=1: failure exhausts attempts -> failed, surfaced for dashboard.
    const failItem = makeCanonical({ sourceId: 'fail-001' });
    await repo.saveCanonical(failItem);
    await repo.enqueueJob({
      canonicalId: failItem.id,
      target: PublishTarget.SUPABASE_CMS,
      operation: JobOperation.CREATE,
      maxAttempts: 1,
    });
    await assert.doesNotReject(runTick());
    const [failJob] = await repo.listJobs({ canonicalId: failItem.id });
    assert.equal(failJob.status, JobStatus.FAILED);
    assert.ok(failJob.lastError.includes('simulated adapter failure'));

    // Failed jobs are queryable (this is what the dashboard /api/jobs surfaces).
    const failed = await repo.listJobs({ status: JobStatus.FAILED });
    assert.ok(failed.some((j) => j.canonicalId === failItem.id));

    // The poller is still healthy after failures.
    await assert.doesNotReject(runTick());
  } finally {
    restoreDefaultAdapters();
  }
});

// --- 6. Adapter swap touches only the registry + a new target token ---------

test('a new CMS adapter is pluggable through the registry alone', async () => {
  const NEW_TARGET = 'demo_cms'; // in a real swap this is a new PublishTarget value
  assert.equal(hasAdapter(NEW_TARGET), false, 'unknown target has no adapter yet');

  // Register a brand-new adapter — no change to /agent or /shared logic.
  registerAdapter(NEW_TARGET, stubAdapter('demo'));
  assert.equal(hasAdapter(NEW_TARGET), true);
  assert.equal(typeof getAdapter(NEW_TARGET).create, 'function');

  // The bridge core drives it with no special-casing.
  const repo = await getRepo();
  const c = makeCanonical({ sourceId: 'swap-001', targets: [] });
  await repo.saveCanonical(c);
  await repo.enqueueJob({
    canonicalId: c.id,
    target: NEW_TARGET,
    operation: JobOperation.CREATE,
    maxAttempts: 3,
  });
  await runTick();

  const [job] = await repo.listJobs({ canonicalId: c.id });
  assert.equal(job.status, JobStatus.SUCCEEDED, 'bridge published to the new target');
  const mappings = await repo.listMappings(c.id);
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].target, NEW_TARGET);
});

// --- 7. WordPress body conversion is real -----------------------------------

test('ProseMirror converts to Gutenberg block markup', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Lede' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body copy.' }] },
    ],
  };
  const out = prosemirrorToGutenberg(doc);
  assert.ok(out.includes('<!-- wp:heading'), 'emits a heading block comment');
  assert.ok(out.includes('<!-- wp:paragraph -->'), 'emits a paragraph block comment');
  assert.ok(out.includes('Body copy.'), 'preserves text content');
});

// --- 8. README documents how to add an adapter ------------------------------

test('README has the required "How to add a new CMS adapter" section', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../README.md', import.meta.url));
  const readme = await readFile(path, 'utf8');
  assert.ok(
    /how to add a new cms adapter/i.test(readme),
    'README contains the required section heading'
  );
});
