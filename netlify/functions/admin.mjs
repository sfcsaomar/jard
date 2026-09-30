import crypto from 'node:crypto';
import {
  err, json, readBody, store, getJSON, setJSON, hashPassword,
  userKey, licKey, normUser, usageKey, monthStr
} from '../lib/common.mjs';

function isAdmin(req) {
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  const given = (req.headers.get('x-admin-key') || '').trim(); // tolerate spaces from copy-paste
  if (expected.length < 10) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Brute-force protection: 5 wrong admin passwords from one address lock it for 30 minutes.
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_MIN = 30;
function clientKey(req, context) {
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  return 'adminlocks-v2/' + crypto.createHash('sha256').update(String(ip).split(',')[0].trim()).digest('hex').slice(0, 32);
}

async function listPrefix(prefix) {
  const { blobs } = await store().list({ prefix });
  const out = [];
  for (const b of blobs) { const v = await getJSON(b.key); if (v) out.push(v); }
  return out;
}

const publicUser = (u) => ({
  username: u.username, displayName: u.displayName || '', licenseId: u.licenseId,
  active: u.active, devices: (u.devices || []).length, lastLogin: u.lastLogin || null, createdAt: u.createdAt
});

const actions = {
  async overview() {
    const licenses = await listPrefix('licenses/');
    const users = await listPrefix('users/');
    const m = monthStr();
    for (const l of licenses) {
      l.usage = (await getJSON(usageKey(l.id, m))) || { count: 0 };
      l.userCount = users.filter((u) => u.licenseId === l.id).length;
    }
    licenses.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { ok: true, month: m, licenses, users: users.map(publicUser) });
  },

  async saveLicense({ license }) {
    if (!license?.customer) return err(400, 'missing', 'اسم العميل مطلوب');
    const id = license.id || crypto.randomUUID().slice(0, 8);
    const old = (await getJSON(licKey(id))) || { createdAt: new Date().toISOString() };
    const rec = {
      ...old,
      id,
      customer: String(license.customer).trim(),
      expiresAt: license.expiresAt || null,
      maxUsers: Math.max(1, Number(license.maxUsers || 1)),
      maxDevicesPerUser: Math.max(1, Number(license.maxDevicesPerUser || 1)),
      aiEnabled: license.aiEnabled !== false,
      aiMonthlyCap: Math.max(0, Number(license.aiMonthlyCap || 0)),
      active: license.active !== false,
      notes: String(license.notes || '')
    };
    await setJSON(licKey(id), rec);
    return json(200, { ok: true, license: rec });
  },

  async deleteLicense({ id }) {
    const users = (await listPrefix('users/')).filter((u) => u.licenseId === id);
    if (users.length) return err(400, 'has_users', 'احذف مستخدمي هذه الرخصة أولًا');
    await store().delete(licKey(id));
    return json(200, { ok: true });
  },

  async saveUser({ user }) {
    const username = normUser(user?.username);
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      return err(400, 'bad_username', 'اسم المستخدم: 3-40 حرفًا إنجليزيًا أو أرقامًا أو . _ -');
    }
    const license = await getJSON(licKey(user.licenseId));
    if (!license) return err(400, 'no_license', 'اختر رخصة صحيحة');
    const existing = await getJSON(userKey(username));

    if (!existing || existing.licenseId !== user.licenseId) {
      const count = (await listPrefix('users/')).filter((u) => u.licenseId === license.id).length;
      if (count >= license.maxUsers) return err(400, 'user_limit', `وصلت الرخصة للحد الأعلى من المستخدمين (${license.maxUsers})`);
    }
    if (!existing && !user.password) return err(400, 'no_password', 'كلمة المرور مطلوبة للمستخدم الجديد');
    if (user.password && String(user.password).length < 8) return err(400, 'weak_password', 'كلمة المرور 8 أحرف على الأقل');

    const rec = existing || { username, devices: [], createdAt: new Date().toISOString() };
    rec.displayName = String(user.displayName || '').trim();
    rec.licenseId = license.id;
    rec.active = user.active !== false;
    if (user.password) Object.assign(rec, hashPassword(user.password));
    await setJSON(userKey(username), rec);
    return json(200, { ok: true, user: publicUser(rec) });
  },

  async resetDevices({ username }) {
    const u = await getJSON(userKey(username));
    if (!u) return err(404, 'not_found', 'المستخدم غير موجود');
    u.devices = [];
    await setJSON(userKey(username), u);
    return json(200, { ok: true });
  },

  async deleteUser({ username }) {
    await store().delete(userKey(username));
    return json(200, { ok: true });
  }
};

export default async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const lockKey = clientKey(req, context);
  const lock = (await getJSON(lockKey)) || { count: 0 };
  if (lock.until && lock.until > Date.now()) {
    const min = Math.ceil((lock.until - Date.now()) / 60000);
    return err(429, 'admin_locked', `محاولات خاطئة كثيرة. حاول بعد ${min} دقيقة`);
  }
  if (!isAdmin(req)) {
    lock.count = (lock.count || 0) + 1;
    if (lock.count >= ADMIN_MAX_FAILS) { lock.until = Date.now() + ADMIN_LOCK_MIN * 60000; lock.count = 0; }
    await setJSON(lockKey, lock);
    await new Promise((r) => setTimeout(r, 400));
    return err(401, 'not_admin', 'كلمة مرور الإدارة غير صحيحة');
  }
  if (lock.count) await store().delete(lockKey);
  const body = await readBody(req);
  const fn = actions[body.action];
  if (!fn) return err(400, 'bad_action', 'Unknown action');
  return fn(body);
};

export const config = { path: '/api/admin' };
