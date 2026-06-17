// bridge/adapters/wordpress/taxonomy.js
// Resolves canonical taxonomy references (type/name/slug) to WordPress remote
// term IDs, fetching-or-creating terms as needed and caching the result so a
// batch of posts doesn't refetch the same term repeatedly.

import { TaxonomyType } from '../../../shared/index.js';

// Default WP REST bases for each TaxonomyType. category/tag are WP core; the
// others are assumed registered as custom taxonomies with these REST bases.
// Override per-deployment via wpConfig.taxonomyRestBase.
const DEFAULT_REST_BASE = {
  [TaxonomyType.CATEGORY]: 'categories',
  [TaxonomyType.TAG]: 'tags',
  [TaxonomyType.INDUSTRY]: 'industry',
  [TaxonomyType.REGION]: 'region',
  [TaxonomyType.TOPIC]: 'topic',
};

export function createTaxonomyResolver({ request, taxonomyRestBase = {} }) {
  const restBaseFor = (type) => taxonomyRestBase[type] ?? DEFAULT_REST_BASE[type];

  /** @type {Map<string, Map<string, number>>} restBase -> (slug -> remote id) */
  const cache = new Map();

  async function resolveOne(restBase, taxon) {
    let bySlug = cache.get(restBase);
    if (!bySlug) {
      bySlug = new Map();
      cache.set(restBase, bySlug);
    }
    if (bySlug.has(taxon.slug)) return bySlug.get(taxon.slug);

    const found = await request(`/wp/v2/${restBase}?slug=${encodeURIComponent(taxon.slug)}`);
    let id;
    if (Array.isArray(found) && found.length) {
      id = found[0].id;
    } else {
      let parent;
      if (taxon.parentSlug) {
        parent = await resolveOne(restBase, { name: taxon.parentSlug, slug: taxon.parentSlug });
      }
      const created = await request(`/wp/v2/${restBase}`, {
        method: 'POST',
        body: { name: taxon.name, slug: taxon.slug, ...(parent ? { parent } : {}) },
      });
      id = created.id;
    }
    bySlug.set(taxon.slug, id);
    return id;
  }

  /**
   * Resolve every canonical taxonomy reference into WP post-body fields, e.g.
   * { categories: [12], tags: [34, 56], industry: [78] }.
   * @param {object[]} taxonomies
   */
  async function resolveAll(taxonomies = []) {
    const byRestBase = new Map();
    const skipped = [];
    for (const taxon of taxonomies) {
      const restBase = restBaseFor(taxon.type);
      if (!restBase) continue; // unknown type: skip rather than fail the whole post
      try {
        const id = await resolveOne(restBase, taxon);
        const list = byRestBase.get(restBase) ?? [];
        list.push(id);
        byRestBase.set(restBase, list);
      } catch (err) {
        // A custom taxonomy that isn't registered on this site returns 404 — a
        // missing optional taxonomy must not block the whole post. Skip the term
        // (core categories/tags still apply) and record it for visibility.
        if (err.status === 404) {
          skipped.push(`${taxon.type}:${taxon.slug} (taxonomy "${restBase}" not registered)`);
          continue;
        }
        throw err; // genuine errors (auth, 5xx) still surface as retryable
      }
    }
    if (skipped.length) {
      console.warn(`[wordpress] skipped unregistered taxonomies: ${skipped.join(', ')}`);
    }
    return Object.fromEntries(byRestBase);
  }

  return { resolveAll };
}
