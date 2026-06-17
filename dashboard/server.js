// dashboard/server.js
// Minimal review-dashboard backend. Serves the editorial queue, applies review
// decisions, and exposes live job status. Approving an item flips its status and
// enqueues bridge jobs — handing control to the bridge. Auth is a placeholder.

import express from 'express';
import {
  ContentStatus,
  EditorialStage,
  ReviewDecision,
} from '../shared/index.js';
import { getRepo } from '../bridge/repo/index.js';
import { enqueueForTargets } from '../bridge/api.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

// --- Placeholder auth: a single shared header. Replace with real auth later. ---
const DASH_TOKEN = process.env.DASH_TOKEN ?? 'dev-token';
app.use('/api', (req, res, next) => {
  const token = req.header('x-dash-token') ?? DASH_TOKEN; // default-allow in dev
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
    return res.json({ content: approved, jobs });
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

const PORT = process.env.DASH_PORT ?? 4000;
export function startDashboardServer() {
  return app.listen(PORT, () => console.log(`[dashboard] API on http://localhost:${PORT}`));
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startDashboardServer();
}

export { app };
