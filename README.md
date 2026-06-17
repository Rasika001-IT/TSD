# TSD CMS-Neutral Publishing System

An editorial AI agent publishes news and blog content to a CMS **without knowing
which CMS it is**. A bridge service and swappable per-CMS adapters sit between
the agent and the CMS. WordPress is the current target; a Supabase-backed CMS is
the near-future target. Swapping WordPress out later touches only an adapter —
never the agent.

**Guiding split:** the **agent** decides _what_ to publish (policy); the
**bridge** decides _how_ to talk to a CMS (mechanism). The bridge makes zero
editorial decisions — it only honors the status the agent set.

```
source pack ─▶ Agent ─▶ (canonical object + status) ─▶ Bridge API ─▶ outbox
                                                                        │
   Dashboard (human gate) ──approve──▶ status flip + enqueue ───────────┘
                                                                        │
                                              Poller ──▶ Adapter ──▶ CMS
                                                          (wordpress | supabase_cms)
```

## Layout

```
/shared      canonical model + enums + runtime validation (NO CMS-specific code)
/agent       editorial policy: build canonical, decide status (gating), hand to bridge
/bridge      mechanism: outbox poller, retries, scheduling, adapter registry
  /adapters
    /wordpress      ProseMirror→Gutenberg, Application-Password auth, taxonomy/SEO
    /supabase-cms   working stub that stores the canonical near-verbatim
  /repo      repository interface with two drivers: memory (default) + postgres
/dashboard   React (plain JSX) review desk + a small Express backend
/db          SQL migration for the three tables
/test        acceptance tests (Node built-in runner)
```

## Quick start

The system boots in **memory mode** with no database and no `.env` at all —
ideal for development and for running the acceptance tests.

```bash
npm install
npm test                 # runs the acceptance suite against the memory driver

# Run the pieces (memory mode):
npm run dashboard:api    # review backend on :4000
npm run dashboard        # React dev server on :5173 (proxies /api to :4000)
npm run bridge           # start the outbox poller
```

For a real deployment, copy `.env.example` to `.env`, set `DB_DRIVER=postgres`
with a Supabase `DATABASE_URL`, apply `db/001_init.sql`, and fill in the
WordPress Application-Password credentials. The human initializes Git and `.env`.

## The canonical content object

The contract between agent and bridge. Body is **ProseMirror/TipTap JSON**.
Taxonomies are referenced by **name/slug only** — resolving a slug to a remote
term ID is the adapter's job. All controlled vocabularies live in
`shared/enums.js`; `shared/validate.js` validates a canonical object (via Zod)
before it can reach an adapter.

## Data model (three tables)

- **`publish_jobs`** — the outbox. One row per (canonical item, target,
  operation). The poller drains it.
- **`content_mapping`** — composite key **(`canonicalId`, `target`)**. The same
  canonical item maps to a WordPress post **and** a Supabase-CMS post at once;
  this is what enables dual-running both CMSes during cutover.
- **`canonical_content`** — persisted canonical objects, `sourceId` uniquely
  indexed for idempotency.

## Behavioral guarantees (and where they live)

- **Idempotency** — `bridge/api.js` keys on `sourceId`; the poller also updates
  rather than recreates when a mapping already exists.
- **The human gate** — enforced twice: the agent only enqueues jobs for
  publishable statuses (`agent/gating.js` + `bridge/api.js`), and the poller
  refuses to push any item still in `pending_review`/`draft`
  (`bridge/poller.js`), marking such jobs `skipped`.
- **Retries** — exponential backoff with full jitter up to `maxAttempts`, then
  `failed` and surfaced on the dashboard job wire (`bridge/poller.js`).
- **Scheduling** — the poller honors `scheduledFor`; the agent staggers batch
  releases (`agent/stagger.js`).
- **Dual-run** — one canonical item, multiple `targets`, one mapping row each.
- **Media rights** — assets whose license is not owned / licensed /
  royalty_free / creative_commons / public_domain are rejected before upload.
- **Provenance** — authorship/model/review recorded on every item for the
  internal audit trail; never exposed to readers.

## How to add a new CMS adapter

Adding or swapping a CMS touches **only `/bridge/adapters/*` plus one new
`PublishTarget` value** — never `/agent` and never `/shared` logic.

1. **Add a target token.** In `shared/enums.js`, add a value to `PublishTarget`,
   e.g. `GHOST: 'ghost'`. (This is the one allowed edit outside `/bridge` — it is
   a plain string token, not CMS code.)

2. **Create the adapter folder.** Add `bridge/adapters/ghost/index.js` exporting
   a factory that returns an object implementing the five-method contract from
   `bridge/adapters/interface.js`:

   ```js
   create(content)           // -> { remoteId, remoteUrl, remoteStatus }
   update(remoteId, content) // -> { remoteId, remoteUrl, remoteStatus }
   unpublish(remoteId)       // -> { remoteId, remoteStatus }
   getStatus(remoteId)       // -> { remoteStatus, remoteUrl? }
   uploadMedia(asset)        // -> { remoteId, url }
   ```

   The adapter owns everything CMS-specific: auth, taxonomy slug→remote-ID
   resolution (fetch + cache), media upload, body conversion, and status mapping.
   Adapters **throw** on failure; the poller turns thrown errors into retries.

3. **Register it.** In `bridge/adapters/index.js`, add one line:

   ```js
   registerAdapter(PublishTarget.GHOST, createGhostAdapter(config.ghost));
   ```

That is the entire surface area. The bridge core resolves adapters through
`getAdapter(target)` and never imports a concrete adapter, so nothing else
changes. The acceptance suite proves this: a brand-new target registered through
`registerAdapter` is published end-to-end by the unchanged bridge core.

## Design notes (two deliberate calls)

- **"New `PublishTarget` value" vs "no changes to `/shared`."** The spec asks for
  both. The resolution: a `PublishTarget` entry is a data token, not CMS logic.
  `/shared` stays free of any CMS *code*; adapters self-register in
  `/bridge/adapters/index.js`, so the bridge core never changes when a CMS is
  added. Adding a token to the enum is the only `/shared` edit, and it carries no
  behavior.
- **"Names an individual" detection.** Reliable person-detection in free text is
  out of scope for a publishing layer. The contract signal is the explicit
  `editorial.namesIndividual` flag set upstream; `agent/gating.js` adds a
  conservative heuristic only as a safety net that errs toward *more* review
  (false positives cost a review; false negatives cost credibility). Treat the
  heuristic as a backstop, not the primary control.

## Out of scope (by design)

Exactly two targets (WordPress now, Supabase CMS soon) — not a generic
"any CMS" framework. No SSO (the dashboard auth is a placeholder header). No
analytics, comments, or locales beyond `en_US` / `en_GB`.
