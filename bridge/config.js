// bridge/config.js
// Central place for environment-derived configuration. Nothing here is
// CMS-neutral logic — it is just numbers/strings read from process.env with
// safe defaults so the system boots in memory mode with no .env at all.

export const config = {
  dbDriver: process.env.DB_DRIVER ?? 'memory', // 'memory' | 'postgres'
  databaseUrl: process.env.DATABASE_URL ?? null,

  wordpress: {
    baseUrl: process.env.WP_BASE_URL ?? null,
    username: process.env.WP_USERNAME ?? null,
    appPassword: process.env.WP_APP_PASSWORD ?? null,
    seoPlugin: process.env.WP_SEO_PLUGIN ?? null, // 'yoast' | 'rankmath' | null
    taxonomyRestBase: {}, // override per-deployment if custom taxonomies use other REST bases
  },

  // Content-generation agent (Claude). Used by /agent/generate.js.
  anthropic: {
    enabled: Boolean(process.env.ANTHROPIC_API_KEY),
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
  },

  pollIntervalMs: Number(process.env.BRIDGE_POLL_INTERVAL_MS ?? 15000),
  // How often the generation scheduler checks the editorial calendar.
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS ?? 300000), // 5 min
  batchSize: Number(process.env.BRIDGE_BATCH_SIZE ?? 10),
  defaultMaxAttempts: Number(process.env.BRIDGE_DEFAULT_MAX_ATTEMPTS ?? 5),
  backoffBaseMs: Number(process.env.BRIDGE_BACKOFF_BASE_MS ?? 1000),
  backoffMaxMs: Number(process.env.BRIDGE_BACKOFF_MAX_MS ?? 300000),
};
