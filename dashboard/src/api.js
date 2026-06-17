// dashboard/src/api.js
// Thin fetch wrapper for the dashboard's review backend (dashboard/server.js).
// Centralizes the base path, auth header, and error handling so components
// never touch fetch() directly.

const DASH_TOKEN = import.meta.env?.VITE_DASH_TOKEN ?? 'dev-token';

async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-dash-token': DASH_TOKEN,
      ...(opts.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed: ${res.status}`);
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
