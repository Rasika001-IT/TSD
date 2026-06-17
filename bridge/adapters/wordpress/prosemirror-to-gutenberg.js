// bridge/adapters/wordpress/prosemirror-to-gutenberg.js
// Converts a ProseMirror/TipTap JSON doc (the canonical body format) into
// WordPress Gutenberg block markup. This is the one real format conversion
// the WordPress adapter owns; nothing else in the system needs to know
// Gutenberg exists.

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(nodes = []) {
  return nodes.map(renderInlineNode).join('');
}

function renderInlineNode(node) {
  if (node.type === 'hardBreak') return '<br />';
  if (node.type !== 'text') return '';
  let html = escapeHtml(node.text ?? '');
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
      case 'em':
        html = `<em>${html}</em>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'link':
        html = `<a href="${escapeHtml(mark.attrs?.href ?? '#')}">${html}</a>`;
        break;
      default:
        break;
    }
  }
  return html;
}

function block(name, attrs, innerHtml) {
  const attrJson = attrs && Object.keys(attrs).length ? ` ${JSON.stringify(attrs)}` : '';
  return `<!-- wp:${name}${attrJson} -->\n${innerHtml}\n<!-- /wp:${name} -->`;
}

// Inner-HTML-only rendering for nodes nested inside another block (e.g. a
// paragraph inside a list item) — no wp: comments, just the tag.
function renderBlockInner(node) {
  if (node.type === 'text') return renderInlineNode(node);
  return renderInline(node.content);
}

function renderListItems(items) {
  return items.map((li) => `<li>${(li.content ?? []).map(renderBlockInner).join('')}</li>`).join('');
}

function renderNode(node) {
  switch (node.type) {
    case 'paragraph':
      return block('paragraph', null, `<p>${renderInline(node.content)}</p>`);
    case 'heading': {
      const level = node.attrs?.level ?? 2;
      const html = `<h${level}>${renderInline(node.content)}</h${level}>`;
      return block('heading', level !== 2 ? { level } : null, html);
    }
    case 'blockquote': {
      const inner = (node.content ?? []).map(renderBlockInner).join('\n');
      return block('quote', null, `<blockquote class="wp-block-quote">${inner}</blockquote>`);
    }
    case 'codeBlock': {
      const text = escapeHtml((node.content ?? []).map((n) => n.text ?? '').join(''));
      return block('code', null, `<pre class="wp-block-code"><code>${text}</code></pre>`);
    }
    case 'bulletList':
      return block('list', null, `<ul>${renderListItems(node.content ?? [])}</ul>`);
    case 'orderedList':
      return block('list', { ordered: true }, `<ol>${renderListItems(node.content ?? [])}</ol>`);
    case 'horizontalRule':
      return block('separator', null, '<hr class="wp-block-separator" />');
    case 'image': {
      const src = escapeHtml(node.attrs?.src ?? '');
      const alt = escapeHtml(node.attrs?.alt ?? '');
      return block('image', null, `<figure class="wp-block-image"><img src="${src}" alt="${alt}" /></figure>`);
    }
    default:
      // Unknown node types degrade to a paragraph of their inline content
      // rather than dropping content silently.
      return block('paragraph', null, `<p>${renderInline(node.content)}</p>`);
  }
}

/**
 * Convert a ProseMirror doc node into Gutenberg block markup.
 * @param {{ type: 'doc', content: object[] }} doc
 * @returns {string}
 */
export function prosemirrorToGutenberg(doc) {
  if (!doc || doc.type !== 'doc') {
    throw new Error('prosemirrorToGutenberg: expected a ProseMirror doc node');
  }
  return (doc.content ?? []).map(renderNode).join('\n\n');
}
