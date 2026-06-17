// agent/content-spec.js
// Machine-checkable version of the TSD structure requirements. After the agent
// generates a piece, we check it against these specs and attach any violations
// to the item as editorial notes for the human reviewer — we never auto-reject,
// because the human is the gate. Editorial policy, so it lives in /agent.

export const SPECS = Object.freeze({
  news: {
    headlineWords: [8, 12],
    seoTitleMaxChars: 60,
    metaDescriptionChars: [150, 160],
    slugWords: [3, 5],
    bodyWords: [300, 600],
    tags: [3, 5],
  },
  blog: {
    seoTitleMaxChars: 60,
    metaDescriptionChars: [150, 160],
    slugWords: [3, 6],
    bodyWords: [1500, 2500],
    tags: [5, 8],
  },
});

const wordCount = (s) => (String(s ?? '').trim().match(/\S+/g) || []).length;
const slugWordCount = (s) => String(s ?? '').split('-').filter(Boolean).length;

/** Count words across a ProseMirror doc's text nodes. */
export function bodyWordCount(doc) {
  let text = '';
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'text' && node.text) text += ' ' + node.text;
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return wordCount(text);
}

const inRange = (n, [lo, hi]) => n >= lo && n <= hi;

/**
 * Check a canonical item against its stream's spec. Returns an array of
 * human-readable warnings (empty means it conforms). Non-throwing by design —
 * these are advisory notes for the reviewer, not hard failures.
 *
 * @param {object} content canonical content object
 * @param {'news'|'blog'} stream
 */
export function checkAgainstSpec(content, stream) {
  const spec = SPECS[stream] ?? SPECS.news;
  const warnings = [];

  if (stream === 'news') {
    const hw = wordCount(content.title);
    if (!inRange(hw, spec.headlineWords)) {
      warnings.push(`Headline is ${hw} words (target ${spec.headlineWords[0]}–${spec.headlineWords[1]}).`);
    }
  }

  const seoTitle = content.seo?.title ?? '';
  if (seoTitle && seoTitle.length > spec.seoTitleMaxChars) {
    warnings.push(`SEO title is ${seoTitle.length} chars (max ${spec.seoTitleMaxChars}).`);
  }

  const meta = content.seo?.description ?? '';
  if (meta && !inRange(meta.length, spec.metaDescriptionChars)) {
    warnings.push(`Meta description is ${meta.length} chars (target ${spec.metaDescriptionChars[0]}–${spec.metaDescriptionChars[1]}).`);
  }

  const sw = slugWordCount(content.slug);
  if (!inRange(sw, spec.slugWords)) {
    warnings.push(`Slug is ${sw} words (target ${spec.slugWords[0]}–${spec.slugWords[1]}).`);
  }

  const bw = bodyWordCount(content.body);
  if (!inRange(bw, spec.bodyWords)) {
    warnings.push(`Body is ${bw} words (target ${spec.bodyWords[0]}–${spec.bodyWords[1]}).`);
  }

  const tagCount = (content.taxonomies ?? []).filter((t) => t.type === 'tag').length;
  if (!inRange(tagCount, spec.tags)) {
    warnings.push(`Has ${tagCount} tags (target ${spec.tags[0]}–${spec.tags[1]}).`);
  }

  if (!(content.taxonomies ?? []).some((t) => t.type === 'category')) {
    warnings.push('Missing a primary category.');
  }

  return warnings;
}
