// agent/stagger.js
// Spreads a batch of releases evenly across a time window instead of dumping
// them all at once. Pure scheduling math — no CMS knowledge, agent-only.

const DEFAULT_WINDOW_HOURS = 24;

/**
 * Compute `n` staggered ISO timestamps spread evenly across a window.
 * @param {number} n
 * @param {{ start?: Date, end?: Date }} [window]
 * @returns {string[]} ISO timestamps, length n (empty array if n <= 0)
 */
export function staggerTimes(n, window = {}) {
  if (n <= 0) return [];
  const start = window.start ?? new Date();
  const end = window.end ?? new Date(start.getTime() + DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
  const span = end.getTime() - start.getTime();

  if (n === 1) return [new Date(start.getTime() + span / 2).toISOString()];

  const step = span / n;
  return Array.from({ length: n }, (_, i) =>
    new Date(start.getTime() + step * i + step / 2).toISOString()
  );
}
