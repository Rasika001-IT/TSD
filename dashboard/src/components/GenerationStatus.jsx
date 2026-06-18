// dashboard/src/components/GenerationStatus.jsx
// Live progress for in-flight (and just-finished) AI drafts. Generation runs in
// the background on the server and takes ~30–90s; this panel shows each job's
// stage and percentage in real time so the desk doesn't look hung — and surfaces
// failures that would otherwise only hit the server log.
import React from 'react';

const STATE = {
  running: { cls: 'running', icon: '◐' },
  done: { cls: 'done', icon: '✓' },
  failed: { cls: 'failed', icon: '✕' },
};

export function GenerationStatus({ jobs, onDismiss }) {
  if (!jobs?.length) return null;
  return (
    <div className="gen-status">
      <h2>Generation status</h2>
      <ul>
        {jobs.map((j) => {
          const s = STATE[j.status] ?? STATE.running;
          const pct = Math.max(0, Math.min(100, j.pct ?? 0));
          return (
            <li key={j.id} className={`gen-job ${s.cls}`}>
              <div className="gen-head">
                <span className="gen-icon">{s.icon}</span>
                <span className="gen-what">{j.stream} · {j.category}</span>
                <span className="gen-pct">{pct}%</span>
                {j.status !== 'running' && (
                  <button className="gen-dismiss" onClick={() => onDismiss(j.id)} title="Dismiss">×</button>
                )}
              </div>
              <div className="gen-bar">
                <div className={`gen-fill ${s.cls}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="gen-stage">
                {j.status === 'failed'
                  ? <span className="gen-error">Failed: {j.error}</span>
                  : j.status === 'done'
                    ? <span>Ready for review{j.title ? `: “${j.title}”` : ''}</span>
                    : <span>{j.stageLabel ?? 'Working…'}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
