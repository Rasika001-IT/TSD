// dashboard/src/components/ReviewRail.jsx
// Right rail: the human gate itself. Approve / request changes / reject acts
// on the selected item; approving is the only path that hands control to the
// bridge (see dashboard/server.js).
import React, { useState } from 'react';

export function ReviewRail({ content, mappings, busy, onDecision, children }) {
  const [notes, setNotes] = useState('');

  if (!content) return <aside className="review-rail empty" />;

  const decide = (decision) => {
    onDecision(decision, notes || null);
    setNotes('');
  };

  return (
    <aside className="review-rail">
      <h2>Review</h2>
      <dl className="meta">
        <dt>Status</dt><dd>{content.status}</dd>
        <dt>Targets</dt><dd>{content.targets.join(', ') || 'none'}</dd>
        <dt>Fact-check</dt><dd>{content.editorial?.factCheck}</dd>
      </dl>

      {mappings.length > 0 && (
        <ul className="mappings">
          {mappings.map((m) => (
            <li key={m.target}>{m.target}: {m.remoteStatus ?? 'unmapped'}</li>
          ))}
        </ul>
      )}

      <textarea
        placeholder="Notes (optional for approve, recommended for changes/reject)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={busy}
      />

      <div className="actions">
        <button disabled={busy} className="approve" onClick={() => decide('approved')}>Approve</button>
        <button disabled={busy} className="changes" onClick={() => decide('changes_requested')}>Request changes</button>
        <button disabled={busy} className="reject" onClick={() => decide('rejected')}>Reject</button>
      </div>

      {children}
    </aside>
  );
}
