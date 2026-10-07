// Thin Supabase client over fetch: database RPCs and private photo storage.
// The secret key stays on the server; phones and panels only get short-lived signed URLs.
const DEFAULT_URL = 'https://mpgqkyqtjqtesxqbbkqr.supabase.co';
export const BUCKET = 'photos';

const base = () => (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/+$/, '');
const key = () => process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || '';
export const syncEnabled = () => key().length > 20;

let _fetch = (...a) => fetch(...a);
export function _setFetchForTests(f) { _fetch = f; }

function headers(extra = {}) {
  return { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...extra };
}

async function request(path, body) {
  const r = await _fetch(base() + path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    console.error('Supabase error', r.status, path, text.slice(0, 500));
    const e = new Error(`supabase ${r.status}`);
    e.status = r.status;
    e.detail = (data && typeof data === 'object' && data.message) || '';
    throw e;
  }
  return data;
}

export const rpc = (fn, args) => request(`/rest/v1/rpc/${fn}`, args);

export const HASH_RE = /^[a-f0-9]{64}$/;
export const photoPath = (companyId, hash) => `${companyId}/${hash}.jpg`;
export const thumbPath = (companyId, hash) => `${companyId}/t/${hash}.jpg`;

// One signed upload URL per object. Objects are named by content hash, so re-uploading is harmless.
export async function signUpload(path) {
  const r = await _fetch(`${base()}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: headers({ 'x-upsert': 'true' }), body: '{}'
  });
  const text = await r.text();
  if (!r.ok) {
    console.error('Supabase sign upload', r.status, text.slice(0, 300));
    throw new Error(`sign upload ${r.status}`);
  }
  const d = JSON.parse(text);
  return `${base()}/storage/v1${d.url}`;
}

// Signed download URLs for many objects at once; missing objects come back as null.
export async function signDownloads(paths, expiresIn = 3600) {
  if (!paths.length) return {};
  const out = {};
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const list = await request(`/storage/v1/object/sign/${BUCKET}`, { expiresIn, paths: chunk });
    for (const item of list || []) {
      out[item.path] = item.signedURL ? `${base()}/storage/v1${item.signedURL}` : null;
    }
  }
  return out;
}

// Deletes stored photos by path, in batches.
export async function deletePhotos(paths) {
  let n = 0;
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const r = await _fetch(`${base()}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: headers(), body: JSON.stringify({ prefixes: chunk })
    });
    if (!r.ok) {
      console.error('Supabase delete photos', r.status, (await r.text()).slice(0, 300));
      throw new Error(`delete photos ${r.status}`);
    }
    n += chunk.length;
  }
  return n;
}
