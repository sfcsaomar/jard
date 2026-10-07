// Public health check: reports whether the database connection works. Reveals no data.
import { json } from '../lib/common.mjs';
import { syncEnabled, rpc } from '../lib/supa.mjs';

export default async () => {
  const out = { ok: true, keySet: syncEnabled(), db: false };
  if (out.keySet) {
    try { await rpc('company_counts', { p_company: '__health__' }); out.db = true; }
    catch (e) { out.dbError = String(e.status || e.message || 'error'); }
  }
  return json(200, out);
};

export const config = { path: '/api/health' };
