// agent/generate-cli.js
// Command-line entry for the generation agent. Two modes:
//
//   node agent/generate-cli.js --today
//       Generate every item in today's editorial plan and send each to the
//       pending_review queue. (Wire this to cron / a scheduler in production —
//       it figures out what the day calls for from agent/editorial-calendar.js.)
//
//   node agent/generate-cli.js --stream news --category "Deals & M&A"
//       Generate a single item on demand.
//
// Every generated item is persisted via the bridge (publish), which defaults it
// to pending_review — nothing reaches a CMS without a human approving it.

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.js';
import { checkAgainstSpec } from './content-spec.js';
import { planForDate } from './editorial-calendar.js';
import { publish } from '../bridge/index.js';
import { getRepo } from '../bridge/repo/index.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--today') args.today = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

/** Generate one spec, attach spec warnings, persist to the review queue. */
export async function generateAndQueue(spec, deps = {}) {
  // Honor dashboard-set settings (an explicit spec value wins if provided).
  const repo = await getRepo();
  const modelOverride = spec.modelOverride ?? (await repo.getSetting('model_override', null));
  const costProfile = spec.costProfile ?? (await repo.getSetting('cost_profile', 'balanced'));

  const { content, prominence, brief, cost, model } = await generate({ ...spec, modelOverride, costProfile }, deps);

  const warnings = checkAgainstSpec(content, spec.stream);
  const notes = [];
  if (warnings.length) notes.push('Spec check:\n' + warnings.map((w) => `- ${w}`).join('\n'));
  if (cost) {
    notes.push(`Est. generation cost: $${cost.usd.toFixed(4)} (${model}, ${costProfile} profile; in ${cost.inputTokens} / out ${cost.outputTokens} tokens, ${cost.searches} web searches).`);
    console.log(`[generate] "${content.title}" — ~$${cost.usd.toFixed(4)} [${model}, ${costProfile}]`);
  }
  if (notes.length) {
    content.editorial.editorialNotes = [content.editorial.editorialNotes, ...notes].filter(Boolean).join('\n\n');
  }

  const result = await publish(content); // pending_review ⇒ stored, not enqueued
  return { ...result, prominence, brief, warnings, cost };
}

async function runToday(deps = {}) {
  const plan = planForDate();
  if (!plan.items.length) {
    console.log('[generate] No items scheduled today (weekend — no news/blogs).');
    return [];
  }
  const out = [];
  for (const item of plan.items) {
    const sourceId = `tsd-${item.stream}-${new Date().toISOString().slice(0, 10)}-${item.category.toLowerCase().replace(/[^a-z]+/g, '-')}-${item.slotIndex ?? 0}`;
    console.log(`[generate] ${item.stream} · ${item.category}${item.scheduledFor ? ` · publishes ${item.scheduledFor}` : ''}`);
    try {
      const r = await generateAndQueue({ ...item, sourceId }, deps);
      out.push(r);
      console.log(`  → queued for review: "${r.content.title}"${r.warnings.length ? ` (${r.warnings.length} spec notes)` : ''}`);
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
    }
  }
  return out;
}

async function runSingle(args, deps = {}) {
  const stream = args.stream === 'blog' ? 'blog' : 'news';
  if (!args.category) throw new Error('--category is required for a single generation');
  const sourceId = args.sourceId ?? `tsd-${stream}-${randomUUID().slice(0, 8)}`;
  const r = await generateAndQueue({ stream, type: stream, category: args.category, topicHint: args.topic, sourceId }, deps);
  console.log(`Queued for review: "${r.content.title}" [${r.prominence}]`);
  if (r.warnings.length) console.log('Spec notes:\n' + r.warnings.map((w) => `- ${w}`).join('\n'));
  return r;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  (args.today ? runToday() : runSingle(args))
    .then(() => process.exit(0))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
