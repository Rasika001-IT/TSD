// bridge/repo/index.js
// Repository selection. getRepo() lazily creates a singleton driver based on
// config.dbDriver — 'memory' (default, no DB needed) or 'postgres'. Postgres
// is dynamically imported so `pg` is never required unless actually used.
// _setRepo lets tests inject a fresh repo per test without touching config.

import { config } from '../config.js';
import { createMemoryRepo } from './memory.js';

let instance = null;

/** @returns {Promise<object>} the active repo singleton */
export async function getRepo() {
  if (instance) return instance;
  if (config.dbDriver === 'postgres') {
    const { createPostgresRepo } = await import('./postgres.js');
    instance = createPostgresRepo(config.databaseUrl);
  } else {
    instance = createMemoryRepo();
  }
  return instance;
}

/** Test-only override: force the active repo instance. */
export function _setRepo(repo) {
  instance = repo;
}
