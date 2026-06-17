// worker.js
// Long-running background worker for production: runs the outbox poller (drains
// publish_jobs → CMS adapters, with retries + scheduled publishing) AND the
// generation scheduler (drafts the day's posts when the dashboard toggle is on).
// Deploy this as a separate, always-on service (no public port). The dashboard
// API is the web service; this is the worker service.

import { startPoller } from './bridge/poller.js';
import { startScheduler } from './agent/scheduler.js';
import { config } from './bridge/config.js';

console.log('[worker] starting…');
console.log(`[worker] DB driver: ${config.dbDriver} | generation: ${config.anthropic.enabled ? 'available' : 'disabled (no ANTHROPIC_API_KEY)'}`);

startPoller();    // publish_jobs outbox → adapters; retries + scheduledFor
startScheduler(); // editorial-calendar generation (gated by the dashboard toggle)

console.log('[worker] poller + scheduler running. Ctrl-C to stop.');

// Keep the process alive and shut down cleanly.
const shutdown = (sig) => { console.log(`[worker] ${sig} — shutting down.`); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
