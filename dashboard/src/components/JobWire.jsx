// dashboard/src/components/JobWire.jsx
// Live feed of bridge job status for the selected item, polled by App.jsx so
// adapter progress/errors appear without a manual refresh.
import React from 'react';

export function JobWire({ jobs }) {
  if (!jobs.length) return null;
  return (
    <section className="job-wire">
      <h3>Job wire</h3>
      <ul>
        {jobs.map((j) => (
          <li key={j.jobId} className={`job ${j.status}`}>
            <span className="target">{j.target}</span>
            <span className="op">{j.operation}</span>
            <span className="status">{j.status}</span>
            {j.lastError && <span className="error">{j.lastError}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
