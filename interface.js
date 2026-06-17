// bridge/adapters/interface.js
// The adapter contract. Every CMS adapter implements exactly these five methods.
// This is the seam: the bridge only ever speaks this interface, so swapping the
// CMS underneath never touches the agent, /shared, or the bridge core.
//
// An adapter owns, internally: auth, taxonomy slug -> remote-ID resolution
// (fetch + cache), media upload, body conversion, and status mapping.
//
// Method contracts (all async):
//
//   create(content)            -> { remoteId, remoteUrl, remoteStatus }
//   update(remoteId, content)  -> { remoteId, remoteUrl, remoteStatus }
//   unpublish(remoteId)        -> { remoteId, remoteStatus }
//   getStatus(remoteId)        -> { remoteStatus, remoteUrl? }
//   uploadMedia(asset)         -> { remoteId, url }
//
// `content` is a validated canonical object. `asset` is a canonical media object.
// Adapters THROW on failure; the poller turns thrown errors into retries.

const REQUIRED_METHODS = ['create', 'update', 'unpublish', 'getStatus', 'uploadMedia'];

/**
 * Validate that an object satisfies the adapter contract. Throws if not.
 * @param {object} adapter
 * @param {string} name
 */
export function assertAdapterShape(adapter, name) {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error(`Adapter "${name}" is not an object`);
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== 'function') {
      throw new Error(`Adapter "${name}" is missing required method "${m}()"`);
    }
  }
  return adapter;
}

export { REQUIRED_METHODS };
