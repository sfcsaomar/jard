// Data layer: accounts, companies, projects, usage and locks in Supabase (Postgres).
// Records keep the camelCase shape the rest of the code uses; columns are snake_case.
import { getStore } from '@netlify/blobs';
import { rpc } from './supa.mjs';

const ACC = {
  username: 'username', role: 'role', licenseId: 'company_id', projectId: 'project_id', displayName: 'display_name',
  active: 'active', salt: 'salt', hash: 'hash', devices: 'devices', deviceInfo: 'device_info', settings: 'settings',
  lastLogin: 'last_login', createdAt: 'created_at'
};
const CO = {
  id: 'id', customer: 'customer', startsAt: 'starts_at', months: 'months', expiresAt: 'expires_at', maxUsers: 'max_users',
  maxDevicesPerUser: 'max_devices_per_user', aiEnabled: 'ai_enabled', aiMonthlyCap: 'ai_monthly_cap', active: 'active',
  contactName: 'contact_name', contactPhone: 'contact_phone', contactEmail: 'contact_email', notes: 'notes',
  renewals: 'renewals', createdAt: 'created_at'
};
const PR = {
  id: 'id', companyId: 'company_id', name: 'name', active: 'active', notes: 'notes', settings: 'settings',
  categories: 'categories', categoriesUpdatedAt: 'categories_updated_at', createdAt: 'created_at'
};

function fromRow(map, row) {
  if (!row || typeof row !== 'object' || row[Object.values(map)[0]] == null) return null;
  const o = {};
  for (const [k, c] of Object.entries(map)) if (row[c] !== undefined && row[c] !== null) o[k] = row[c];
  return o;
}
function toRow(map, rec) {
  const r = {};
  for (const [k, c] of Object.entries(map)) if (rec[k] !== undefined) r[c] = rec[k];
  return r;
}
const fromAcc = (row) => {
  const a = fromRow(ACC, row);
  if (a) { a.devices = a.devices || []; a.deviceInfo = a.deviceInfo || {}; }
  return a;
};

// The database refuses a field user beyond the license limit (see enforce_user_limit).
export const isUserLimitError = (e) => String(e?.detail || '').startsWith('user_limit');

export const db = {
  getAccount: async (username) => fromAcc(await rpc('acct_get', { p_username: String(username || '') })),
  listAccounts: async (companyId) => ((await rpc('acct_list', { p_company: companyId ?? null })) || []).map(fromAcc),
  listSuperAdmins: async () => ((await rpc('acct_list', { p_company: null })) || []).map(fromAcc),
  saveAccount: async (rec) => fromAcc(await rpc('acct_save', { p: toRow(ACC, { ...rec, role: rec.role || 'user' }) })),
  deleteAccount: (username) => rpc('acct_delete', { p_username: username }),
  registerDevice: (username, deviceId, max) => rpc('acct_register_device', { p_username: username, p_device: deviceId, p_max: max }),
  removeDevice: (username, deviceId) => rpc('acct_remove_device', { p_username: username, p_device: deviceId || null }),
  seen: (username, deviceId, login) => rpc('acct_seen', { p_username: username, p_device: deviceId || null, p_login: !!login }),

  getCompany: async (id) => (id ? fromRow(CO, await rpc('co_get', { p_id: String(id) })) : null),
  listCompanies: async () => ((await rpc('co_list', {})) || []).map((r) => fromRow(CO, r)),
  saveCompany: async (rec) => fromRow(CO, await rpc('co_save', { p: toRow(CO, rec) })),
  deleteCompany: (id) => rpc('co_delete', { p_id: id }),

  getProject: async (companyId, id) => (id ? fromRow(PR, await rpc('proj_get', { p_company: companyId, p_id: String(id) })) : null),
  listProjects: async (companyId) => ((await rpc('proj_list', { p_company: companyId })) || []).map((r) => fromRow(PR, r)),
  saveProject: async (rec) => fromRow(PR, await rpc('proj_save', { p: toRow(PR, rec) })),
  deleteProject: (companyId, id) => rpc('proj_delete', { p_company: companyId, p_id: id }),

  usageGet: (companyId, month) => rpc('usage_get', { p_company: companyId, p_month: month }),
  usageAdd: (companyId, month, inTok, outTok) => rpc('usage_add', { p_company: companyId, p_month: month, p_in: inTok || 0, p_out: outTok || 0 }),

  lockCheck: (key) => rpc('lock_check', { p_key: key }),
  lockFail: (key, max, minutes) => rpc('lock_fail', { p_key: key, p_max: max, p_minutes: minutes }),
  lockClear: (key) => rpc('lock_clear', { p_key: key })
};

// ---------- one-time import of the old Netlify Blobs data ----------
// Runs on the first request after deploy. The import never overwrites existing rows, so running
// it twice (two servers starting together) is harmless. Passwords move as their existing hashes.
let _legacyStore = null;
export function _setLegacyStoreForTests(s) { _legacyStore = s; }
const legacyStore = () => _legacyStore || getStore({ name: 'licensing', consistency: 'strong' });

async function readLegacy() {
  const store = legacyStore();
  const all = async (prefix) => {
    const { blobs } = await store.list({ prefix });
    const out = [];
    for (const b of blobs) {
      const v = await store.get(b.key, { type: 'json' });
      if (v) out.push([b.key, v]);
    }
    return out;
  };
  const companies = (await all('licenses/')).map(([, c]) => toRow(CO, c));
  const projects = (await all('projects/')).map(([, p]) => toRow(PR, p));
  const accounts = (await all('users/')).map(([, u]) => toRow(ACC, { ...u, role: u.role === 'admin' ? 'admin' : 'user' }));
  const usage = (await all('usage/')).map(([key, u]) => {
    const [, companyId, month] = key.split('/');
    return { company_id: companyId, month, count: u.count || 0, input_tokens: u.inputTokens || 0, output_tokens: u.outputTokens || 0 };
  });
  return { companies, projects, accounts, usage };
}

let _ready = null;
export function _resetReadyForTests() { _ready = null; }
export function ensureReady() {
  if (!_ready) {
    _ready = (async () => {
      if (await rpc('meta_get', { p_key: 'legacy_import' })) return;
      const data = await readLegacy();
      const counts = await rpc('import_legacy', { p: data });
      await rpc('meta_set', { p_key: 'legacy_import', p_value: { at: new Date().toISOString(), counts } });
      console.log('Imported legacy accounts', JSON.stringify(counts));
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}
