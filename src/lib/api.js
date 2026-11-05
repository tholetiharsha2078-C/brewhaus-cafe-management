const BASE = '/api';

export async function api(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const opts = { method, credentials: 'same-origin', signal, headers: { ...headers } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const get = (path, opts) => api(path, opts);
export const post = (path, body, opts = {}) => api(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts = {}) => api(path, { ...opts, method: 'PATCH', body });
export const put = (path, body, opts = {}) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts = {}) => api(path, { ...opts, method: 'DELETE' });

export const qs = (params) => {
  const merged = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') merged.set(k, String(v));
  });
  const s = merged.toString();
  return s ? `?${s}` : '';
};

export async function uploadImage(file, folder = 'menu') {
  const form = new FormData();
  form.append('file', file);
  form.append('folder', folder);
  return api('/admin/upload', { method: 'POST', body: form });
}
