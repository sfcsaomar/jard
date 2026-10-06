import crypto from 'node:crypto';
import {
  err, json, readBody, store, getJSON, setJSON, licKey, listPrefix, addMonthsMinusDay, normTerm, monthStr
} from '../lib/common.mjs';
import {
  companySnapshot, saveAccount, removeDevice, deleteAccount, saveProject, setCategories, getProject,
  deleteProject, loadCompany, publicUser, companyUsers
} from '../lib/accounts.mjs';

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

const today = () => new Date().toISOString().slice(0, 10);
const num = (v, min, def) => Math.max(min, Math.floor(Number(v ?? def) || def));
const ok = (body = {}) => json(200, { ok: true, ...body });

async function withCompany(id, fn) {
  const c = await loadCompany(id);
  if (!c) return err(404, 'not_found', 'الشركة غير موجودة');
  return fn(c);
}

const actions = {
  // Companies with their admins, projects and users.
  async overview() {
    const companies = await listPrefix('licenses/');
    companies.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const list = [];
    for (const c of companies) list.push(await companySnapshot(c, { withNotes: true }));
    return ok({ month: monthStr(), companies: list });
  },

  // Create or edit a company and its license. The license runs for a number of months from its start date.
  async saveCompany({ company }) {
    const name = String(company?.customer || '').trim();
    if (!name) return err(400, 'missing', 'اسم الشركة مطلوب');
    const id = company.id || crypto.randomUUID().slice(0, 8);
    const old = (await getJSON(licKey(id))) || { createdAt: new Date().toISOString() };
    const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(company.startsAt || '') ? company.startsAt : today();
    const months = Math.min(120, num(company.months, 1, 12));
    const rec = {
      ...old, id, customer: name, startsAt, months,
      expiresAt: addMonthsMinusDay(startsAt, months),
      maxUsers: num(company.maxUsers, 1, 1),
      maxDevicesPerUser: num(company.maxDevicesPerUser, 1, 1),
      aiEnabled: company.aiEnabled !== false,
      aiMonthlyCap: num(company.aiMonthlyCap, 0, 0),
      active: company.active !== false,
      contactName: String(company.contactName || '').trim().slice(0, 80),
      contactPhone: String(company.contactPhone || '').trim().slice(0, 40),
      contactEmail: String(company.contactEmail || '').trim().slice(0, 120),
      notes: String(company.notes || '').slice(0, 1000)
    };
    await setJSON(licKey(id), rec);
    return ok({ company: await companySnapshot(rec, { withNotes: true }) });
  },

  // Renew by N months: continues from the current end date, or restarts today if already expired.
  async renewCompany({ id, months }) {
    return withCompany(id, async (c) => {
      const add = Math.min(120, num(months, 1, 12));
      const term = normTerm(c);
      const expired = c.expiresAt && c.expiresAt < today();
      if (expired) { c.startsAt = today(); c.months = add; }
      else { c.startsAt = term.startsAt; c.months = term.months + add; }
      c.expiresAt = addMonthsMinusDay(c.startsAt, c.months);
      c.active = true;
      c.renewals = [...(c.renewals || []), { at: new Date().toISOString(), months: add, until: c.expiresAt }].slice(-50);
      await setJSON(licKey(c.id), c);
      return ok({ expiresAt: c.expiresAt });
    });
  },

  async deleteCompany({ id }) {
    return withCompany(id, async (c) => {
      if ((await companyUsers(c.id)).length) return err(400, 'has_users', 'احذف حسابات هذه الشركة (الأدمن والمستخدمين) أولًا');
      for (const p of await listPrefix(`projects/${c.id}/`)) await store().delete(`projects/${c.id}/${p.id}`);
      await store().delete(licKey(c.id));
      return ok();
    });
  },

  // Company admin accounts (the customer's own administrator).
  async saveCompanyAdmin({ admin }) {
    return withCompany(admin?.companyId, async (c) => {
      const r = await saveAccount(c, admin, 'admin');
      return r.error || ok({ user: publicUser(r.user) });
    });
  },

  // The super admin can also manage everything inside a company.
  async saveUser({ user }) {
    return withCompany(user?.companyId, async (c) => {
      const r = await saveAccount(c, user, 'user');
      return r.error || ok({ user: publicUser(r.user) });
    });
  },
  async resetDevices({ companyId, username, deviceId }) {
    return withCompany(companyId, async (c) => (await removeDevice(c, username, deviceId)) || ok());
  },
  async deleteUser({ companyId, username }) {
    return withCompany(companyId, async (c) => (await deleteAccount(c, username)) || ok());
  },
  async saveProject({ companyId, project }) {
    return withCompany(companyId, async (c) => { const r = await saveProject(c, project); return r.error || ok(); });
  },
  async getProject({ companyId, projectId }) {
    return withCompany(companyId, async (c) => {
      const p = await getProject(c, projectId);
      return p ? ok({ project: p }) : err(404, 'not_found', 'المشروع غير موجود');
    });
  },
  async setCategories({ companyId, projectId, categories }) {
    return withCompany(companyId, async (c) => { const r = await setCategories(c, projectId, categories); return r.error || ok(); });
  },
  async deleteProject({ companyId, projectId }) {
    return withCompany(companyId, async (c) => (await deleteProject(c, projectId)) || ok());
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
