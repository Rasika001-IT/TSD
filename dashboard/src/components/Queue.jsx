// dashboard/src/components/Queue.jsx
// Left rail: the pending_review queue. Selecting an item loads it in the Reader.
import React from 'react';

export function Queue({ items, activeId, onSelect }) {
  return (
    <nav className="queue">
      <h2>Pending review ({items.length})</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button className={item.id === activeId ? 'active' : ''} onClick={() => onSelect(item.id)}>
              <span className="title">{item.title}</span>
              <span className="type">{item.type}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="empty">Nothing waiting on review.</li>}
      </ul>
    </nav>
  );
}
