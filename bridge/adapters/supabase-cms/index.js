// bridge/adapters/supabase-cms/index.js
// Supabase-CMS adapter — a working STUB of the near-future custom CMS.
// It implements the full five-method contract and stores the canonical object
// near-verbatim (body stays ProseMirror JSON — no conversion). Its purpose is
// to make the seam real and provably swappable before the real CMS exists.
//
// When the real Supabase CMS is built, replace the in-memory store here with
// inserts into its tables. Nothing outside this folder changes.

import { randomUUID } from 'node:crypto';

export function createSupabaseCmsAdapter() {
  /** @type {Map<string, object>} remoteId -> stored record */
  const store = new Map();

  const recordFor = (remoteId) => store.get(remoteId) ?? null;

  return {
    name: 'supabase_cms',

    async uploadMedia(asset) {
      // Stub: the destination CMS would store media itself. We "host" it by
      // echoing the canonical asset back with a synthetic id.
      const remoteId = `media_${asset.id}`;
      return { remoteId, url: asset.url };
    },

    async create(content) {
      const remoteId = `sb_${randomUUID()}`;
      const record = {
        remoteId,
        // Near-verbatim: body kept as ProseMirror JSON, no transformation.
        canonical: content,
        remoteStatus: content.status,
        remoteUrl: `supabase-cms://post/${remoteId}`,
        createdAt: new Date().toISOString(),
      };
      store.set(remoteId, record);
      return { remoteId, remoteUrl: record.remoteUrl, remoteStatus: record.remoteStatus };
    },

    async update(remoteId, content) {
      const record = recordFor(remoteId);
      if (!record) throw new Error(`supabase_cms: no record for remoteId ${remoteId}`);
      record.canonical = content;
      record.remoteStatus = content.status;
      record.updatedAt = new Date().toISOString();
      return { remoteId, remoteUrl: record.remoteUrl, remoteStatus: record.remoteStatus };
    },

    async unpublish(remoteId) {
      const record = recordFor(remoteId);
      if (!record) throw new Error(`supabase_cms: no record for remoteId ${remoteId}`);
      record.remoteStatus = 'draft';
      return { remoteId, remoteStatus: record.remoteStatus };
    },

    async getStatus(remoteId) {
      const record = recordFor(remoteId);
      if (!record) throw new Error(`supabase_cms: no record for remoteId ${remoteId}`);
      return { remoteStatus: record.remoteStatus, remoteUrl: record.remoteUrl };
    },

    // Test/inspection helper — not part of the adapter contract.
    _store: store,
  };
}
