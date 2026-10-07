// Public health check: reports whether the database connection works and the old data was imported.
// Reveals no account data.
import { json } from '../lib/common.mjs';
import { syncEnabled, rpc } from '../lib/supa.mjs';
import { ensureReady } from '../lib/db.mjs';

export default async () => {
  const out = { ok: true, keySet: syncEnabled(), db: false, accounts: false };
  if (out.keySet) {
    try { await rpc('company_counts', { p_company: '__health__' }); out.db = true; }
    catch (e) { out.dbError = String(e.status || e.message || 'error'); }
    try { await ensureReady(); out.accounts = !!(await rpc('meta_get', { p_key: 'legacy_import' })); }
    catch (e) { out.accountsError = String(e.status || e.detail || e.message || 'error'); }
  }
  return json(200, out);
};

export const config = { path: '/api/health' };
