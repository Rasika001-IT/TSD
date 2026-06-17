// bridge/adapters/index.js
// The adapter registry. This is the ONE file (plus the adapter folders themselves)
// that changes when you add or swap a CMS. The bridge core resolves adapters
// through getAdapter(target) and never imports a concrete adapter directly.

import { assertAdapterShape } from './interface.js';
import { createWordPressAdapter } from './wordpress/index.js';
import { createSupabaseCmsAdapter } from './supabase-cms/index.js';
import { PublishTarget } from '../../shared/index.js';
import { config } from '../config.js';

/** @type {Map<string, object>} target -> adapter instance */
const registry = new Map();

/**
 * Register an adapter for a PublishTarget. Idempotent; later calls overwrite.
 * Exposed so tests (or future targets) can register without editing the core.
 */
export function registerAdapter(target, adapter) {
  registry.set(target, assertAdapterShape(adapter, target));
}

/**
 * Resolve the adapter for a target. Throws a clear error for unknown targets.
 */
export function getAdapter(target) {
  const adapter = registry.get(target);
  if (!adapter) {
    throw new Error(
      `No adapter registered for target "${target}". ` +
        `Register one in bridge/adapters/index.js.`
    );
  }
  return adapter;
}

export function hasAdapter(target) {
  return registry.has(target);
}

// --- Self-registration of the built-in adapters -----------------------------
// To add a CMS: build an adapter under ./<name>/, add a PublishTarget value in
// /shared/enums.js, and register it here. Nothing else changes.
registerAdapter(PublishTarget.WORDPRESS, createWordPressAdapter(config.wordpress));
registerAdapter(PublishTarget.SUPABASE_CMS, createSupabaseCmsAdapter());
