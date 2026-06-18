// dashboard/server.js
// Minimal review-dashboard backend. Serves the editorial queue, applies review
// decisions, and exposes live job status. Approving an item flips its status and
// enqueues bridge jobs — handing control to the bridge. Auth is a placeholder.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ContentStatus,
  EditorialStage,
  ReviewDecision,
} from '../shared/index.js';
import { PublishTarget, JobOperation } from '../shared/index.js';
import { getRepo } from '../bridge/repo/index.js';
import { enqueueForTargets } from '../bridge/api.js';
import { tick } from '../bridge/poller.js';
import { getAdapter } from '../bridge/adapters/index.js';
import { config } from '../bridge/config.js';
import { generateAndQueue } from '../agent/generate-cli.js';
import { generateAltText } from '../agent/alt-text.js';
import { SCHEDULER_FLAG } from '../agent/scheduler.js';
import { DEFAULT_PUBLISH_WINDOWS, DEFAULT_EDITORIAL_SCHEDULE } from '../agent/editorial-calendar.js';
import { PROFILE_OPTIONS, DEFAULT_COST_PROFILE } from '../agent/cost-profiles.js';

const MODEL_OPTIONS = ['auto', 'claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'];

const STREAM_FOR_TYPE = { blog: 'blog' }; // everything else is a 'news' stream

const app = express();
app.use(express.json({ limit: '5mb' }));

// --- Placeholder auth: a single shared header. Replace with real auth later. ---
// In dev (DASH_TOKEN unset/'dev-token') the API is open for convenience. As soon
// as a real DASH_TOKEN is configured (production), the header is REQUIRED and must
// match — so a deployed dashboard isn't wide open. NOTE: this is still
// placeholder-grade (the token ships in the client bundle); put real auth or an
// IP/private-network restriction in front before exposing publicly.
const DASH_TOKEN = process.env.DASH_TOKEN ?? 'dev-token';
const DEV_OPEN = DASH_TOKEN === 'dev-token';
app.use('/api', (req, res, next) => {
  const token = req.header('x-dash-token') ?? (DEV_OPEN ? DASH_TOKEN : null);
  if (token !== DASH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  req.reviewerId = req.header('x-reviewer-id') ?? 'editor:unknown';
  next();
});

// --- Review queue ----------------------------------------------------------
app.get('/api/items', async (req, res) => {
  const repo = await getRepo();
  const status = req.query.status ?? ContentStatus.PENDING_REVIEW;
  const items = await repo.listCanonicalByStatus(status);
  res.json({ items });
});

app.get('/api/items/:id', async (req, res) => {
  const repo = await getRepo();
  const content = await repo.getCanonicalById(req.params.id);
  if (!content) return res.status(404).json({ error: 'not found' });
  const mappings = await repo.listMappings(content.id);
  const jobs = await repo.listJobs({ canonicalId: content.id });
  res.json({ content, mappings, jobs });
});

// --- Apply a review decision ----------------------------------------------
app.post('/api/items/:id/review', async (req, res) => {
  const repo = await getRepo();
  const content = await repo.getCanonicalById(req.params.id);
  if (!content) return res.status(404).json({ error: 'not found' });

  const { decision, notes = null, publishNow = false } = req.body ?? {};
  const now = new Date().toISOString();
  const reviewerId = req.reviewerId;

  if (decision === ReviewDecision.APPROVED) {
    // Future scheduledFor -> scheduled; otherwise publish now (or if forced).
    const future = content.scheduledFor && content.scheduledFor > now;
    const nextStatus =
      future && !publishNow ? ContentStatus.SCHEDULED : ContentStatus.PUBLISHED;

    const approved = {
      ...content,
      status: nextStatus,
      publishedAt: nextStatus === ContentStatus.PUBLISHED ? now : content.publishedAt,
      editorial: {
        ...content.editorial,
        reviewDecision: ReviewDecision.APPROVED,
        reviewerId,
        editorialNotes: notes ?? content.editorial?.editorialNotes ?? null,
        stage: EditorialStage.READY_TO_PUBLISH,
      },
      provenance: { ...content.provenance, reviewedBy: reviewerId, reviewedAt: now },
      updatedAt: now,
    };
    await repo.saveCanonical(approved);
    const jobs = await enqueueForTargets(approved, repo);
    // Publish live immediately rather than waiting for the next poll cycle.
    // (Scheduled items keep their future scheduledFor; the poller honors it.)
    let mappings = [];
    if (nextStatus === ContentStatus.PUBLISHED) {
      try {
        await tick(repo);
        mappings = await repo.listMappings(approved.id);
      } catch (err) {
        console.error('[review] immediate publish tick failed:', err.message);
      }
    }
    return res.json({ content: approved, jobs, mappings });
  }

  if (decision === ReviewDecision.CHANGES_REQUESTED) {
    const updated = {
      ...content,
      status: ContentStatus.PENDING_REVIEW,
      editorial: {
        ...content.editorial,
        reviewDecision: ReviewDecision.CHANGES_REQUESTED,
        reviewerId,
        editorialNotes: notes,
        stage: EditorialStage.REVISIONS_REQUESTED,
      },
      updatedAt: now,
    };
    await repo.saveCanonical(updated);
    return res.json({ content: updated, jobs: [] });
  }

  if (decision === ReviewDecision.REJECTED) {
    const updated = {
      ...content,
      status: ContentStatus.TRASH,
      editorial: {
        ...content.editorial,
        reviewDecision: ReviewDecision.REJECTED,
        reviewerId,
        editorialNotes: notes,
      },
      updatedAt: now,
    };
    await repo.saveCanonical(updated);
    return res.json({ content: updated, jobs: [] });
  }

  return res.status(400).json({ error: `unknown decision "${decision}"` });
});

// --- Live job status -------------------------------------------------------
app.get('/api/jobs', async (req, res) => {
  const repo = await getRepo();
  const jobs = await repo.listJobs({ status: req.query.status ?? null });
  res.json({ jobs });
});

// --- Content generation (Claude) -------------------------------------------
// Generation can take minutes (web research), so these endpoints kick the work
// off in the background and return immediately. The new/updated item appears in
// the pending_review queue when it finishes — the dashboard already polls.

// In-memory progress tracker. Generation is fire-and-forget background work, so
// without this the dashboard can't tell whether a draft is researching, writing,
// done, or FAILED (failures otherwise only reach the server log). The UI polls
// GET /api/generation-jobs to render a live status with stage + percentage.
const generationJobs = new Map(); // id -> job
let genSeq = 0;

// Stage → percentage. Research dominates wall-clock (~60%), so the bar weights it.
const GEN_STAGES = {
  queued: { pct: 5, label: 'Queued' },
  researching: { pct: 30, label: 'Researching sources' },
  writing: { pct: 70, label: 'Writing draft' },
  saving: { pct: 92, label: 'Saving to review queue' },
  done: { pct: 100, label: 'Ready for review' },
  failed: { pct: 100, label: 'Failed' },
};

const FINISHED_TTL_MS = 5 * 60 * 1000; // keep finished jobs visible this long

function pruneGenJobs() {
  const now = Date.now();
  for (const [id, j] of generationJobs) {
    if (j.finishedAt && now - new Date(j.finishedAt).getTime() > FINISHED_TTL_MS) generationJobs.delete(id);
  }
}

function setGenStage(job, stage, extra = {}) {
  const meta = GEN_STAGES[stage] ?? {};
  job.stage = stage;
  job.stageLabel = meta.label ?? stage;
  job.pct = meta.pct ?? job.pct;
  Object.assign(job, extra);
  if (stage === 'done' || stage === 'failed') {
    job.status = stage;
    job.finishedAt = new Date().toISOString();
  }
}

function startGeneration(spec, label) {
  const id = `gen-${Date.now()}-${++genSeq}`;
  const job = {
    id, stream: spec.stream, category: spec.category, label,
    stage: 'queued', stageLabel: GEN_STAGES.queued.label, pct: GEN_STAGES.queued.pct,
    status: 'running', title: null, itemId: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  generationJobs.set(id, job);
  pruneGenJobs();

  const onProgress = ({ stage }) => setGenStage(job, stage);
  generateAndQueue(spec, { onProgress })
    .then((r) => {
      setGenStage(job, 'done', { title: r.content.title, itemId: r.content.id });
      console.log(`[generate] queued "${r.content.title}" (${label})`);
    })
    .catch((err) => {
      setGenStage(job, 'failed', { error: err.message });
      console.error(`[generate] failed (${label}): ${err.message}`);
    });
  return job;
}

// On-demand generation: { stream, category, topic? }
app.post('/api/generate', (req, res) => {
  if (!config.anthropic.enabled) {
    return res.status(503).json({ error: 'Generation disabled: set ANTHROPIC_API_KEY on the API server.' });
  }
  const { stream = 'news', category, topic = null } = req.body ?? {};
  if (!category) return res.status(400).json({ error: 'category is required' });
  const sourceId = `tsd-${stream}-manual-${Date.now()}`;
  const job = startGeneration({ stream: stream === 'blog' ? 'blog' : 'news', type: stream, category, topicHint: topic, sourceId }, 'manual');
  res.status(202).json({ accepted: true, sourceId, jobId: job.id });
});

// Live status of generation jobs (running + recently finished). The dashboard
// polls this to render the progress UI and to surface background failures.
app.get('/api/generation-jobs', (req, res) => {
  pruneGenJobs();
  const jobs = [...generationJobs.values()].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  res.json({ jobs });
});

// Regenerate an existing item in place ("redo" — reuses sourceId so the record
// is updated, not duplicated). Useful when an editor dislikes the draft.
app.post('/api/items/:id/regenerate', async (req, res) => {
  if (!config.anthropic.enabled) {
    return res.status(503).json({ error: 'Generation disabled: set ANTHROPIC_API_KEY on the API server.' });
  }
  const repo = await getRepo();
  const content = await repo.getCanonicalById(req.params.id);
  if (!content) return res.status(404).json({ error: 'not found' });
  const stream = STREAM_FOR_TYPE[content.type] ?? 'news';
  const category = (content.taxonomies ?? []).find((t) => t.type === 'category')?.name;
  const job = startGeneration(
    { stream, type: stream, category, topicHint: req.body?.topic ?? null, sourceId: content.sourceId, scheduledFor: content.scheduledFor },
    `regenerate ${content.id}`
  );
  res.status(202).json({ accepted: true, jobId: job.id });
});

// --- Scheduler on/off toggle -----------------------------------------------

// The editorial schedule is editorial canon (day/stream/labels) — only the
// per-slot `enabled` flag is editor-controlled. We persist just {id, enabled}
// and merge onto the canonical defaults so labels and `live` stay authoritative.
async function getEditorialSchedule(repo) {
  const stored = await repo.getSetting('editorial_schedule', null);
  const enabledById = new Map((Array.isArray(stored) ? stored : []).map((s) => [s.id, !!s.enabled]));
  return DEFAULT_EDITORIAL_SCHEDULE.map((s) => ({
    ...s,
    enabled: enabledById.has(s.id) ? enabledById.get(s.id) : s.enabled,
  }));
}

app.get('/api/settings', async (req, res) => {
  const repo = await getRepo();
  const schedulerEnabled = await repo.getSetting(SCHEDULER_FLAG, false);
  const publishWindows = await repo.getSetting('publish_windows', DEFAULT_PUBLISH_WINDOWS);
  const editorialSchedule = await getEditorialSchedule(repo);
  const modelOverride = await repo.getSetting('model_override', 'auto');
  const costProfile = await repo.getSetting('cost_profile', DEFAULT_COST_PROFILE);
  res.json({
    schedulerEnabled: !!schedulerEnabled,
    generationAvailable: config.anthropic.enabled,
    publishWindows,
    editorialSchedule,
    modelOverride: modelOverride ?? 'auto',
    modelOptions: MODEL_OPTIONS,
    costProfile,
    profileOptions: PROFILE_OPTIONS,
  });
});

// Cost profile (Balanced / Max savings / Quality-first) — bundles the spend knobs.
app.post('/api/settings/profile', async (req, res) => {
  const repo = await getRepo();
  const profile = req.body?.profile;
  if (!PROFILE_OPTIONS.includes(profile)) {
    return res.status(400).json({ error: `profile must be one of: ${PROFILE_OPTIONS.join(', ')}` });
  }
  await repo.setSetting('cost_profile', profile);
  res.json({ costProfile: profile });
});

app.post('/api/settings/scheduler', async (req, res) => {
  const repo = await getRepo();
  const enabled = !!(req.body?.enabled);
  await repo.setSetting(SCHEDULER_FLAG, enabled);
  res.json({ schedulerEnabled: enabled });
});

// Editor-managed publish windows (the calendar toggles).
app.post('/api/settings/windows', async (req, res) => {
  const repo = await getRepo();
  const windows = Array.isArray(req.body?.windows) ? req.body.windows : null;
  if (!windows) return res.status(400).json({ error: 'windows array required' });
  // Keep only the fields we own; coerce enabled to boolean.
  const clean = windows.map((w) => ({ id: String(w.id), label: String(w.label), time: String(w.time), enabled: !!w.enabled }));
  await repo.setSetting('publish_windows', clean);
  res.json({ publishWindows: clean });
});

// Editor-managed editorial schedule (the weekly content-stream slots). Only the
// `enabled` flag is editor-controlled; everything else is editorial canon.
app.post('/api/settings/editorial-schedule', async (req, res) => {
  const repo = await getRepo();
  const incoming = Array.isArray(req.body?.schedule) ? req.body.schedule : null;
  if (!incoming) return res.status(400).json({ error: 'schedule array required' });
  const enabledById = new Map(incoming.map((s) => [String(s.id), !!s.enabled]));
  const merged = DEFAULT_EDITORIAL_SCHEDULE.map((s) => ({
    ...s,
    enabled: enabledById.has(s.id) ? enabledById.get(s.id) : s.enabled,
  }));
  await repo.setSetting('editorial_schedule', merged.map((s) => ({ id: s.id, enabled: s.enabled })));
  res.json({ editorialSchedule: merged });
});

// Claude model override ('auto' = the built-in Sonnet/Opus-by-prominence logic).
app.post('/api/settings/model', async (req, res) => {
  const repo = await getRepo();
  const model = req.body?.model;
  if (!MODEL_OPTIONS.includes(model)) {
    return res.status(400).json({ error: `model must be one of: ${MODEL_OPTIONS.join(', ')}` });
  }
  await repo.setSetting('model_override', model === 'auto' ? null : model);
  res.json({ modelOverride: model });
});

// --- Published posts (post-publication review) -----------------------------
// Lists everything that has gone live, with the live URL from content_mapping.
app.get('/api/published', async (req, res) => {
  const repo = await getRepo();
  const items = await repo.listCanonicalByStatus(ContentStatus.PUBLISHED);
  const out = [];
  for (const c of items) {
    const mappings = await repo.listMappings(c.id);
    out.push({
      id: c.id,
      title: c.title,
      type: c.type,
      publishedAt: c.publishedAt,
      targets: mappings.map((m) => ({ target: m.target, remoteUrl: m.remoteUrl, remoteStatus: m.remoteStatus })),
    });
  }
  out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  res.json({ items: out });
});

// --- Featured image: editor drops an image, we upload it + auto alt text ----
app.post('/api/items/:id/image', async (req, res) => {
  if (!config.wordpress.baseUrl) {
    return res.status(503).json({ error: 'WordPress not configured on the API server.' });
  }
  const repo = await getRepo();
  const content = await repo.getCanonicalById(req.params.id);
  if (!content) return res.status(404).json({ error: 'not found' });

  const { base64, mimeType = 'image/jpeg', filename = 'featured.jpg', caption = null } = req.body ?? {};
  if (!base64) return res.status(400).json({ error: 'base64 image data is required' });

  try {
    const keyword = content.seo?.focusKeyword ?? null;
    const alt = await generateAltText({ base64, mimeType, title: content.title, keyword });

    const wp = getAdapter(PublishTarget.WORDPRESS);
    const asset = {
      id: `featured-${content.id}`,
      bytes: base64,
      filename,
      mimeType,
      type: 'image',
      role: 'featured',
      license: 'owned', // an editor adding an image vouches for the rights
      alt,
      caption,
    };
    const { remoteId, url } = await wp.uploadMedia(asset);

    const featuredImage = { ...asset, url, remoteId };
    delete featuredImage.bytes; // don't persist the raw image in the canonical store
    const updated = { ...content, featuredImage, updatedAt: new Date().toISOString() };
    await repo.saveCanonical(updated);

    // If the post is already live, attach the featured image now (update job + tick).
    const mapping = await repo.getMapping(content.id, PublishTarget.WORDPRESS);
    if (mapping?.remoteId) {
      await repo.enqueueJob({
        canonicalId: content.id,
        target: PublishTarget.WORDPRESS,
        operation: JobOperation.UPDATE,
        maxAttempts: config.defaultMaxAttempts,
      });
      await tick(repo).catch((e) => console.error('[image] attach tick failed:', e.message));
    }
    res.json({ featuredImage });
  } catch (err) {
    console.error('[image] upload failed:', err.message);
    res.status(502).json({ error: `Image upload failed: ${err.message}` });
  }
});

// --- Serve the built React dashboard (production: one web service for both) --
// In dev the Vite server hosts the UI and proxies /api here; in production the
// built dist is served from this same origin, so the frontend's relative /api
// calls just work.
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log('[dashboard] serving built UI from dist/');
}

const PORT = process.env.PORT ?? process.env.DASH_PORT ?? 4000;
export function startDashboardServer() {
  return app.listen(PORT, () => console.log(`[dashboard] listening on http://localhost:${PORT}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDashboardServer();
}

export { app };
