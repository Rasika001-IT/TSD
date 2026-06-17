// bridge/adapters/wordpress/index.js
// WordPress adapter. Talks to /wp-json/wp/v2/ with Application Password auth.
// Implements the five-method adapter contract. All WP-specific knowledge —
// auth, body conversion, taxonomy resolution, media upload, status mapping —
// is contained here.

import { Buffer } from 'node:buffer';
import { prosemirrorToGutenberg } from './prosemirror-to-gutenberg.js';
import { toWpStatus, fromWpStatus } from './status-map.js';
import { createTaxonomyResolver } from './taxonomy.js';

export function createWordPressAdapter(wpConfig = {}) {
  const { baseUrl, username, appPassword, seoPlugin, taxonomyRestBase } = wpConfig;

  const authHeader = () => {
    if (!username || !appPassword) {
      throw new Error('WordPress adapter not configured: set WP_USERNAME and WP_APP_PASSWORD');
    }
    return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  };

  // Thin REST helper. Throws on non-2xx so the poller can retry.
  async function request(path, { method = 'GET', body, raw, headers = {} } = {}) {
    if (!baseUrl) throw new Error('WordPress adapter not configured: set WP_BASE_URL');
    const url = `${baseUrl.replace(/\/$/, '')}/wp-json${path}`;
    const init = { method, headers: { Authorization: authHeader(), ...headers } };
    if (raw) {
      init.body = raw.data;
      init.headers['Content-Type'] = raw.contentType;
      if (raw.filename) {
        init.headers['Content-Disposition'] = `attachment; filename="${raw.filename}"`;
      }
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      const msg = parsed?.message || res.statusText;
      const err = new Error(`WP ${method} ${path} -> ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return parsed;
  }

  const taxonomy = createTaxonomyResolver({ request, taxonomyRestBase: taxonomyRestBase ?? {} });

  // Build SEO meta for the configured plugin. WP must expose these meta keys
  // (via Yoast/RankMath REST or register_meta) for them to persist.
  function seoMeta(seo = {}) {
    if (!seo) return {};
    if (seoPlugin === 'yoast') {
      return {
        meta: {
          _yoast_wpseo_title: seo.title ?? undefined,
          _yoast_wpseo_metadesc: seo.description ?? undefined,
          _yoast_wpseo_focuskw: seo.focusKeyword ?? undefined,
          _yoast_wpseo_canonical: seo.canonicalUrl ?? undefined,
        },
      };
    }
    if (seoPlugin === 'rankmath') {
      return {
        meta: {
          rank_math_title: seo.title ?? undefined,
          rank_math_description: seo.description ?? undefined,
          rank_math_focus_keyword: seo.focusKeyword ?? undefined,
          rank_math_canonical_url: seo.canonicalUrl ?? undefined,
        },
      };
    }
    return {};
  }

  // Map a canonical content object to a WP post body.
  async function toPostBody(content) {
    const taxFields = await taxonomy.resolveAll(content.taxonomies);
    const body = {
      title: content.title,
      slug: content.slug,
      excerpt: content.dek ?? '',
      content: prosemirrorToGutenberg(content.body),
      status: toWpStatus(content.status),
      ...taxFields, // e.g. { categories: [..], tags: [..], industry: [..] }
      ...seoMeta(content.seo),
    };
    if (content.status === 'scheduled' && content.scheduledFor) {
      body.date_gmt = new Date(content.scheduledFor).toISOString().replace(/\.\d{3}Z$/, '');
    }
    if (content.featuredImage?.remoteId) {
      body.featured_media = content.featuredImage.remoteId;
    }
    return body;
  }

  return {
    name: 'wordpress',

    // Upload media, then return the remote id + url. Adapters upload media FIRST,
    // then attach the id (the bridge attaches featuredImage.remoteId before create).
    async uploadMedia(asset) {
      const res = await fetch(asset.url);
      if (!res.ok) throw new Error(`Failed to fetch asset ${asset.url}: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = asset.url.split('/').pop()?.split('?')[0] || `${asset.id}.bin`;
      const created = await request('/wp/v2/media', {
        method: 'POST',
        raw: { data: buf, contentType: asset.mimeType || 'application/octet-stream', filename },
      });
      // Set alt text / caption in a follow-up update (WP ignores them on upload).
      if (asset.alt || asset.caption || asset.credit) {
        await request(`/wp/v2/media/${created.id}`, {
          method: 'POST',
          body: {
            alt_text: asset.alt ?? '',
            caption: asset.caption ?? '',
            ...(asset.credit ? { description: asset.credit } : {}),
          },
        });
      }
      return { remoteId: created.id, url: created.source_url };
    },

    async create(content) {
      const post = await request('/wp/v2/posts', { method: 'POST', body: await toPostBody(content) });
      return { remoteId: String(post.id), remoteUrl: post.link, remoteStatus: post.status };
    },

    async update(remoteId, content) {
      const post = await request(`/wp/v2/posts/${remoteId}`, {
        method: 'POST',
        body: await toPostBody(content),
      });
      return { remoteId: String(post.id), remoteUrl: post.link, remoteStatus: post.status };
    },

    async unpublish(remoteId) {
      // Move to draft rather than delete; unpublish is reversible.
      const post = await request(`/wp/v2/posts/${remoteId}`, {
        method: 'POST',
        body: { status: 'draft' },
      });
      return { remoteId: String(post.id), remoteStatus: post.status };
    },

    async getStatus(remoteId) {
      const post = await request(`/wp/v2/posts/${remoteId}?context=edit`, { method: 'GET' });
      return { remoteStatus: fromWpStatus(post.status), remoteUrl: post.link };
    },
  };
}
