// test/scheduler.test.js
// Tests the generation scheduler's timing + idempotency with a fake clock, a
// mock generate function, and the in-memory repo. No API key, no network.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setRepo, getRepo } from '../bridge/repo/index.js';
import { createMemoryRepo } from '../bridge/repo/memory.js';
import { tickScheduler } from '../agent/scheduler.js';
import { createCanonicalContent, ContentType, ContentStatus } from '../shared/index.js';

beforeEach(() => { _setRepo(createMemoryRepo()); });

// A mock generator that records the specs it was asked to run and persists a
// minimal canonical (so the scheduler's idempotency check sees it next tick).
function recordingRun(repo, log) {
  return async (spec) => {
    log.push(spec.sourceId);
    await repo.saveCanonical(createCanonicalContent({
      sourceId: spec.sourceId,
      type: spec.stream === 'blog' ? ContentType.BLOG : ContentType.NEWS,
      title: `Draft ${spec.category}`,
      status: ContentStatus.PENDING_REVIEW,
    }));
  };
}

test('tick generates news due in the morning but not the blog yet', async () => {
  const repo = await getRepo();
  const log = [];
  // Monday 2026-06-15, 07:00 ET = 11:00 UTC (EDT). News (06:30 ET) is due;
  // blog (generateBy 08:30 ET = 12:30 UTC) is not.
  const now = new Date(Date.UTC(2026, 5, 15, 11, 0, 0));
  const started = await tickScheduler(now, { run: recordingRun(repo, log), repo });

  assert.equal(started.length, 6, 'all 6 Monday news slots drafted');
  assert.ok(started.every((s) => s.includes('-news-')), 'only news drafted');
  assert.ok(!started.some((s) => s.includes('-blog-')), 'blog not drafted yet');
});

test('tick is idempotent — a second run at the same time generates nothing', async () => {
  const repo = await getRepo();
  const log = [];
  const now = new Date(Date.UTC(2026, 5, 15, 11, 0, 0));
  await tickScheduler(now, { run: recordingRun(repo, log), repo });
  const second = await tickScheduler(now, { run: recordingRun(repo, log), repo });
  assert.equal(second.length, 0, 'nothing regenerated on the second tick');
});

test('by the blog lead time, the blog is also drafted', async () => {
  const repo = await getRepo();
  const log = [];
  // 08:45 ET = 12:45 UTC — past the blog generateBy (08:30 ET).
  const now = new Date(Date.UTC(2026, 5, 15, 12, 45, 0));
  const started = await tickScheduler(now, { run: recordingRun(repo, log), repo });
  assert.ok(started.some((s) => s.includes('-blog-')), 'blog drafted by its lead time');
});

test('weekend ticks generate nothing', async () => {
  const repo = await getRepo();
  const log = [];
  const sat = new Date(Date.UTC(2026, 5, 20, 15, 0, 0)); // Saturday
  const started = await tickScheduler(sat, { run: recordingRun(repo, log), repo });
  assert.equal(started.length, 0);
});
