// Provider (super-admin) API. Provider admins sign in with a username and password stored in the
// database. ADMIN_PASSWORD in Netlify stays as an emergency key: signing in with an empty username
// and that password opens the panel so a provider account can be created or recovered.
import crypto from 'node:crypto';
import {
  err, json, readBody, bearer, db, signToken, verifyToken, verifyPassword, hashPassword,
  addMonthsMinusDay, normTerm, monthStr, normUser, handler, NOT_ACTIVATED
} from '../lib/common.mjs';
import {
  companySnapshot, saveAccount, removeDevice, deleteAccount, saveProject, setCategories, getProject,
  deleteProject, loadCompany, publicUser, applyCredentials, saveWithMail, sendInvite, cleanupPhotos
} from '../lib/accounts.mjs';
import { mailEnabled } from '../lib/mail.mjs';

// Photo storage included in the current Supabase plan (GB); the panel warns from 80%.
const STORAGE_LIMIT_GB = Number(process.env.STORAGE_LIMIT_GB || 1);

const SESSION_HOURS = 12;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function emergencyMatches(given) {
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (expected.length < 10) return false;
  const a = crypto.createHash('sha256').update(String(given || '').trim()).digest(); // tolerate pasted spaces
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Brute-force protection: 5 failed sign-ins from one address lock it for 30 minutes.
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_MIN = 30;
function ipKey(req, context) {
  const ip = context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  return 'ip:' + crypto.createHash('sha256').update(String(ip).split(',')[0].trim()).digest('hex').slice(0, 32);
}

const today = () => new Date().toISOString().slice(0, 10);
const num = (v, min, def) => Math.max(min, Math.floor(Number(v ?? def) || def));
const ok = (body = {}) => json(200, { ok: true, ...body });

const publicSuper = (u) => ({
  username: u.username, displayName: u.displayName || '', active: u.active !== false,
  email: u.email || '', emailVerified: !!u.emailVerifiedAt, pending: !!u.needsPassword,
  lastLogin: u.lastLogin || null, createdAt: u.createdAt || null
});
const inviterOf = (ctx) => (ctx.emergency ? 'مزوّد خدمة أمان' : (ctx.user.displayName || ctx.user.username));
const meOf = (ctx) => (ctx.emergency
  ? { username: '', displayName: 'دخول الطوارئ', emergency: true }
  : { ...publicSuper(ctx.user), emergency: false });


async function withCompany(id, fn) {
  const c = await loadCompany(id);
  if (!c) return err(404, 'not_found', 'الشركة غير موجودة');
  return fn(c);
}

async function login(req, context, { username, password }) {
  const key = ipKey(req, context);
  const locked = Number(await db.lockCheck(key)) || 0;
  if (locked) return err(429, 'admin_locked', `محاولات خاطئة كثيرة. حاول بعد ${locked} دقيقة`);
  const name = normUser(username);
  let payload = null;
  if (!name) {
    if (emergencyMatches(password)) payload = { u: '', role: 'super', emg: 1 };
  } else {
    const u = await db.getAccount(name);
    if (u?.role === 'super' && u.needsPassword) return err(403, 'not_activated', NOT_ACTIVATED);
    if (u && u.role === 'super' && u.active !== false && verifyPassword(password || '', u.salt, u.hash)) {
      payload = { u: u.username, role: 'super' };
      await db.seen(u.username, null, true);
    }
  }
  if (!payload) {
    await db.lockFail(key, ADMIN_MAX_FAILS, ADMIN_LOCK_MIN);
    await new Promise((r) => setTimeout(r, 400));
    return err(401, 'not_admin', name ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'كلمة مرور الطوارئ غير صحيحة');
  }
  await db.lockClear(key);
  const now = Date.now();
  return ok({ token: signToken({ ...payload, iat: now, exp: now + SESSION_HOURS * 3600000 }) });
}

// Resolves the signed-in provider admin; a removed or disabled account loses its session at once.
async function session(req) {
  const p = verifyToken(bearer(req));
  if (!p || p.role !== 'super') return null;
  if (p.emg) return { emergency: true };
  const user = await db.getAccount(p.u);
  if (!user || user.role !== 'super' || user.active === false) return null;
  return { emergency: false, user };
}

const actions = {
  // Companies with their admins, projects and users, plus the provider admins.
  async overview(ctx) {
    const companies = await db.listCompanies();
    const list = [];
    for (const c of companies) list.push(await companySnapshot(c, { withNotes: true }));
    const supers = (await db.listSuperAdmins()).map(publicSuper);
    let storage = null;
    try {
      const u = await db.storageUsage();
      const limit = STORAGE_LIMIT_GB * 1024 ** 3;
      storage = { ...u, limitBytes: limit, pct: Math.round((Number(u.bytes) / limit) * 1000) / 10 };
    } catch { /* storage stats are informational */ }
    return ok({ month: monthStr(), companies: list, me: meOf(ctx), superAdmins: supers, storage, mail: mailEnabled() });
  },

  // Create or edit a company and its license. The license runs for a number of months from its start date.
  async saveCompany(ctx, { company }) {
    const name = String(company?.customer || '').trim();
    if (!name) return err(400, 'missing', 'اسم الشركة مطلوب');
    const id = company.id || crypto.randomUUID().slice(0, 8);
    const old = (company.id && await db.getCompany(id)) || {};
    const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(company.startsAt || '') ? company.startsAt : today();
    const months = Math.min(120, num(company.months, 1, 12));
    const saved = await db.saveCompany({
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
    });
    return ok({ company: await companySnapshot(saved, { withNotes: true }) });
  },

  // Renew by N months: continues from the current end date, or restarts today if already expired.
  async renewCompany(ctx, { id, months }) {
    return withCompany(id, async (c) => {
      const add = Math.min(120, num(months, 1, 12));
      const term = normTerm(c);
      const expired = c.expiresAt && c.expiresAt < today();
      if (expired) { c.startsAt = today(); c.months = add; }
      else { c.startsAt = term.startsAt; c.months = term.months + add; }
      c.expiresAt = addMonthsMinusDay(c.startsAt, c.months);
      c.active = true;
      c.renewals = [...(c.renewals || []), { at: new Date().toISOString(), months: add, until: c.expiresAt }].slice(-50);
      await db.saveCompany(c);
      return ok({ expiresAt: c.expiresAt });
    });
  },

  async deleteCompany(ctx, { id }) {
    return withCompany(id, async (c) => {
      if ((await db.deleteCompany(c.id)) === 'has_users') {
        return err(400, 'has_users', 'احذف حسابات هذه الشركة (الأدمن والمستخدمين) أولًا');
      }
      let photos = 0;
      try { photos = await cleanupPhotos(c.id); } catch { /* left for the cleanup button */ }
      return ok({ photosDeleted: photos });
    });
  },

  // Company admin accounts (the customer's own administrator).
  async saveCompanyAdmin(ctx, { admin }) {
    return withCompany(admin?.companyId, async (c) => {
      const r = await saveAccount(c, admin, 'admin', inviterOf(ctx));
      return r.error || ok({ user: publicUser(r.user), invite: r.invite, verifySent: r.verifySent });
    });
  },

  // The provider can also manage everything inside a company.
  async saveUser(ctx, { user }) {
    return withCompany(user?.companyId, async (c) => {
      const r = await saveAccount(c, user, 'user', inviterOf(ctx));
      return r.error || ok({ user: publicUser(r.user), invite: r.invite, verifySent: r.verifySent });
    });
  },
  async resetDevices(ctx, { companyId, username, deviceId }) {
    return withCompany(companyId, async (c) => (await removeDevice(c, username, deviceId)) || ok());
  },
  async deleteUser(ctx, { companyId, username }) {
    return withCompany(companyId, async (c) => (await deleteAccount(c, username)) || ok());
  },
  async saveProject(ctx, { companyId, project }) {
    return withCompany(companyId, async (c) => { const r = await saveProject(c, project); return r.error || ok(); });
  },
  async getProject(ctx, { companyId, projectId }) {
    return withCompany(companyId, async (c) => {
      const p = await getProject(c, projectId);
      return p ? ok({ project: p }) : err(404, 'not_found', 'المشروع غير موجود');
    });
  },
  async setCategories(ctx, { companyId, projectId, categories }) {
    return withCompany(companyId, async (c) => { const r = await setCategories(c, projectId, categories); return r.error || ok(); });
  },
  async deleteProject(ctx, { companyId, projectId }) {
    return withCompany(companyId, async (c) => (await deleteProject(c, projectId)) || ok());
  },

  // Sends the invitation again to any account that has not set its password yet.
  async resendInvite(ctx, { username }) {
    const u = await db.getAccount(username);
    if (!u) return err(404, 'not_found', 'الحساب غير موجود');
    if (!u.needsPassword || !u.email) return err(400, 'not_pending', 'هذا الحساب مفعّل، أو ليس له بريد');
    return ok({ invite: await sendInvite(u, inviterOf(ctx)) });
  },

  // Removes photos left behind by deleted companies.
  async cleanupPhotos() {
    try { return ok({ deleted: await cleanupPhotos(null) }); }
    catch { return err(502, 'storage_failed', 'تعذّر الاتصال بخادم التخزين، حاول لاحقًا'); }
  },

  // ---------- provider admins ----------
  async saveSuperAdmin(ctx, { admin }) {
    const username = normUser(admin?.username);
    if (!USERNAME_RE.test(username)) return err(400, 'bad_username', 'اسم المستخدم: 3-40 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو . _ -');
    const existing = await db.getAccount(username);
    if (existing && existing.role !== 'super') return err(409, 'username_taken', 'اسم المستخدم مستخدم لحساب آخر. اختر اسمًا مختلفًا');
    const active = admin.active !== false;
    if (existing && !active && !ctx.emergency && ctx.user.username === username) {
      return err(400, 'self', 'لا يمكنك إيقاف حسابك وأنت داخل به');
    }
    if (existing && !active) {
      const others = (await db.listSuperAdmins()).filter((a) => a.username !== username && a.active !== false);
      if (!others.length) return err(400, 'last_admin', 'يجب أن يبقى حساب مزوّد فعّال واحد على الأقل');
    }
    const rec = existing ? { ...existing } : { username, role: 'super', devices: [], deviceInfo: {}, createdAt: new Date().toISOString() };
    const flags = applyCredentials(rec, existing, admin, { requireEmail: true, minLength: 10 });
    if (flags.error) return flags.error;
    rec.role = 'super';
    rec.licenseId = null;
    rec.projectId = null;
    rec.displayName = String(admin.displayName || '').trim().slice(0, 80);
    rec.active = active;
    const r = await saveWithMail(rec, flags, { inviterName: inviterOf(ctx) });
    return r.error || ok({ admin: publicSuper(r.user), invite: r.invite, verifySent: r.verifySent });
  },

  async deleteSuperAdmin(ctx, { username }) {
    const u = await db.getAccount(username);
    if (!u || u.role !== 'super') return err(404, 'not_found', 'الحساب غير موجود');
    if (!ctx.emergency && ctx.user.username === u.username) return err(400, 'self', 'لا يمكنك حذف حسابك وأنت داخل به');
    const others = (await db.listSuperAdmins()).filter((a) => a.username !== u.username && a.active !== false);
    if (!others.length) return err(400, 'last_admin', 'يجب أن يبقى حساب مزوّد فعّال واحد على الأقل');
    await db.deleteAccount(u.username);
    return ok();
  },

  async updateMe(ctx, { displayName, email, currentPassword, newPassword }) {
    if (ctx.emergency) return err(400, 'emergency', 'أنت داخل بكلمة الطوارئ. أنشئ حسابًا لنفسك من قائمة حسابات المزوّد');
    const user = { ...ctx.user };
    if (typeof displayName === 'string') user.displayName = displayName.trim().slice(0, 80);
    if (newPassword && !verifyPassword(currentPassword || '', user.salt, user.hash)) {
      return err(400, 'bad_password', 'كلمة المرور الحالية غير صحيحة');
    }
    const flags = applyCredentials(user, ctx.user, { email: email ?? ctx.user.email, password: newPassword }, { requireEmail: true, minLength: 10 });
    if (flags.error) return flags.error;
    const r = await saveWithMail(user, flags, {});
    return r.error || ok({ me: { ...publicSuper(r.user), emergency: false }, verifySent: r.verifySent });
  }
};

export default handler(async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const body = await readBody(req);
  if (body.action === 'login') return login(req, context, body);
  const ctx = await session(req);
  if (!ctx) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const fn = actions[body.action];
  if (!fn) return err(400, 'bad_action', 'Unknown action');
  return fn(ctx, body);
});

export const config = { path: '/api/admin' };
