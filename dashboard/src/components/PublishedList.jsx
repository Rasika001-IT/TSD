// dashboard/src/components/PublishedList.jsx
// Post-publication review: every item that has gone live, with links to the
// live post on each CMS target so an editor can check it after publishing.
import React from 'react';

export function PublishedList({ items }) {
  return (
    <div className="published-list">
      <h2>Published ({items.length})</h2>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <div className="title">{it.title}</div>
            <div className="meta">
              <span className="type">{it.type}</span>
              {it.publishedAt && <span className="date">{new Date(it.publishedAt).toLocaleString()}</span>}
            </div>
            <div className="links">
              {it.targets.filter((t) => t.remoteUrl).map((t) => (
                <a key={t.target} href={t.remoteUrl} target="_blank" rel="noreferrer">
                  {t.target} ↗
                </a>
              ))}
              {it.targets.every((t) => !t.remoteUrl) && <span className="pending">(no live URL yet)</span>}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="empty">Nothing published yet.</li>}
      </ul>
    </div>
  );
}
