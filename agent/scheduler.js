// agent/scheduler.js
// Fires the generation agent automatically on the TSD editorial calendar. It
// wakes on an interval, asks the calendar what today calls for, and generates
// each item once its lead time has arrived — early-morning for news, ~30 min
// before the publish window for blogs. Generated items land in pending_review;
// a human still approves everything.
//
// Idempotency: each planned item has a deterministic, date-stamped sourceId, so
// re-ticking (or a process restart) never regenerates an item already drafted —
// it checks the repository before spending an API call.

import { fileURLToPath } from 'node:url';
import { planForDate, sourceIdFor } from './editorial-calendar.js';
import { generateAndQueue } from './generate-cli.js';
import { getRepo } from '../bridge/repo/index.js';
import { config } from '../bridge/config.js';

/**
 * One scheduler tick. Generates any planned item whose generateBy time has
 * passed and that hasn't been drafted yet. Returns the sourceIds it started.
 *
 * @param {Date} now
 * @param {{ run?: Function, repo?: object }} [deps]
 */
export async function tickScheduler(now = new Date(), deps = {}) {
  const run = deps.run ?? ((spec) => generateAndQueue(spec));
  const repo = deps.repo ?? (await getRepo());
  const { items } = planForDate(now);
  const started = [];

  for (const item of items) {
    if (item.generateBy && new Date(item.generateBy) > now) continue; // not due yet
    const sourceId = sourceIdFor(now, item);
    const existing = await repo.getCanonicalBySourceId(sourceId);
    if (existing) continue; // already drafted today — don't spend another call

    try {
      await run({ ...item, sourceId });
      started.push(sourceId);
      console.log(`[scheduler] drafted ${item.stream} · ${item.category} (${sourceId})`);
    } catch (err) {
      console.error(`[scheduler] failed ${sourceId}: ${err.message}`);
    }
  }
  return started;
}

let timer = null;

/** Start the scheduler loop. Returns a stop() function. */
export function startScheduler() {
  if (timer) return stopScheduler;
  if (!config.anthropic.enabled) {
    console.warn('[scheduler] ANTHROPIC_API_KEY not set — generation is disabled; scheduler will idle.');
  }
  const loop = async () => {
    try {
      await tickScheduler(new Date());
    } catch (err) {
      console.error('[scheduler] tick error:', err.message ?? err);
    }
  };
  timer = setInterval(loop, config.schedulerIntervalMs);
  loop(); // run once immediately
  console.log(`[scheduler] running; checking every ${Math.round(config.schedulerIntervalMs / 60000)} min.`);
  return stopScheduler;
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startScheduler();
}
