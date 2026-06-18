// dashboard/src/api.js
// Thin fetch wrapper for the dashboard's review backend (dashboard/server.js).
// The dashboard token is taken from the browser (localStorage) first — entered
// once via the login gate — so it's never baked into the bundle and changing it
// needs no rebuild. Falls back to a build-time var, then 'dev-token' for local dev.

const TOKEN_KEY = 'tsd_dash_token';

export function getToken() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) return t;
  } catch { /* localStorage unavailable */ }
  return import.meta.env?.VITE_DASH_TOKEN ?? 'dev-token';
}

export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-dash-token': getToken(),
      ...(opts.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error ?? `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  listItems: (status = 'pending_review') => request(`/items?status=${encodeURIComponent(status)}`),
  getItem: (id) => request(`/items/${id}`),
  review: (id, decision, notes = null, publishNow = false) =>
    request(`/items/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, notes, publishNow }),
    }),
  listJobs: (status = null) => request(`/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  generate: (stream, category, topic = null) =>
    request('/generate', { method: 'POST', body: JSON.stringify({ stream, category, topic }) }),
  regenerate: (id, topic = null) =>
    request(`/items/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ topic }) }),
  getSettings: () => request('/settings'),
  setScheduler: (enabled) =>
    request('/settings/scheduler', { method: 'POST', body: JSON.stringify({ enabled }) }),
  setWindows: (windows) =>
    request('/settings/windows', { method: 'POST', body: JSON.stringify({ windows }) }),
  setModel: (model) =>
    request('/settings/model', { method: 'POST', body: JSON.stringify({ model }) }),
  setProfile: (profile) =>
    request('/settings/profile', { method: 'POST', body: JSON.stringify({ profile }) }),
  listPublished: () => request('/published'),
  uploadImage: (id, base64, mimeType, filename) =>
    request(`/items/${id}/image`, { method: 'POST', body: JSON.stringify({ base64, mimeType, filename }) }),
};
