// dashboard/src/components/Reader.jsx
// Center pane: a read-only preview of the selected canonical item. Renders
// ProseMirror JSON to plain reading markup — a full editor preview is out of
// scope for the review desk.
import React from 'react';

function renderInline(nodes = []) {
  return nodes.map((n) => n.text ?? '').join('');
}

function renderNode(node, i) {
  switch (node.type) {
    case 'heading': {
      const Tag = `h${node.attrs?.level ?? 2}`;
      return <Tag key={i}>{renderInline(node.content)}</Tag>;
    }
    case 'bulletList':
    case 'orderedList':
      return (
        <ul key={i}>
          {(node.content ?? []).map((li, j) => (
            <li key={j}>{renderInline(li.content?.[0]?.content)}</li>
          ))}
        </ul>
      );
    case 'paragraph':
    default:
      return <p key={i}>{renderInline(node.content)}</p>;
  }
}

export function Reader({ content }) {
  if (!content) return <main className="reader empty">Select an item to preview.</main>;
  return (
    <main className="reader">
      <span className="kicker">{content.type} · {content.locale}</span>
      <h1>{content.title}</h1>
      {content.dek && <p className="dek">{content.dek}</p>}
      <div className="body">{(content.body?.content ?? []).map(renderNode)}</div>
    </main>
  );
}
