// Company-admin API: the customer's own administrator manages projects, field users and devices
// within the limits of the license the super admin set for the company.
import {
  err, json, readBody, bearer, db, verifyPassword, hashPassword, signToken,
  verifyToken, checkLock, recordFail, clearFails, isAdminRole, normUser, handler, NOT_ACTIVATED
} from '../lib/common.mjs';
import {
  companySnapshot, saveAccount, removeDevice, deleteAccount, saveProject, setCategories, getProject,
  deleteProject, loadCompany, publicUser, ownedUser, applyCredentials, saveWithMail, sendInvite
} from '../lib/accounts.mjs';
import { mailEnabled } from '../lib/mail.mjs';
import { syncEnabled, rpc, signDownloads, photoPath, thumbPath, HASH_RE } from '../lib/supa.mjs';

const SESSION_HOURS = 12;
const ctxName = (ctx) => ctx.user.displayName || ctx.company.customer;
const ok = (body = {}) => json(200, { ok: true, ...body });

async function login({ username, password }) {
  if (!username || !password) return err(400, 'missing', 'أدخل اسم المستخدم وكلمة المرور');
  const lockedMin = await checkLock(username);
  if (lockedMin) return err(429, 'locked', `محاولات كثيرة خاطئة. حاول بعد ${lockedMin} دقيقة`);
  const user = await db.getAccount(username);
  if (user?.needsPassword) return err(403, 'not_activated', NOT_ACTIVATED);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    await recordFail(username);
    await new Promise((r) => setTimeout(r, 400));
    return err(401, 'bad_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!isAdminRole(user)) return err(403, 'not_company_admin', 'هذا حساب مستخدم ميداني. ادخل من تطبيق الجرد');
  await clearFails(username);
  const ctx = await context(user);
  if (ctx.error) return ctx.error;
  await db.seen(user.username, null, true);
  user.lastLogin = new Date().toISOString();
  const now = Date.now();
  const token = signToken({ u: user.username, lic: user.licenseId, role: 'cadmin', iat: now, exp: now + SESSION_HOURS * 3600000 });
  return ok({ token, me: publicUser(user) });
}

// Checks the admin account and its company are still active.
async function context(user) {
  if (!user || !isAdminRole(user)) return { error: err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا') };
  if (user.active === false) return { error: err(403, 'user_disabled', 'هذا الحساب موقوف. تواصل مع المزوّد') };
  const company = await loadCompany(user.licenseId);
  if (!company) return { error: err(403, 'no_company', 'لا توجد شركة مرتبطة بهذا الحساب') };
  if (company.active === false) return { error: err(403, 'company_disabled', 'حساب الشركة موقوف. تواصل مع المزوّد') };
  return { user, company };
}

const actions = {
  async overview({ company, user }) {
    return ok({ ...(await companySnapshot(company)), me: publicUser(user), mail: mailEnabled() });
  },
  // Home page numbers: assets per day, per project and per field user (needs 0004_dashboards.sql).
  async dashboard({ company }) {
    if (!syncEnabled()) return ok({ activity: null });
    try { return ok({ activity: await db.dashCompany(company.id, 30) }); }
    catch { return ok({ activity: null }); }
  },
  async saveProject({ company }, { project }) {
    const r = await saveProject(company, project);
    return r.error || ok({ id: r.project.id });
  },
  async getProject({ company }, { projectId }) {
    const p = await getProject(company, projectId);
    return p ? ok({ project: p }) : err(404, 'not_found', 'المشروع غير موجود');
  },
  async setCategories({ company }, { projectId, categories }) {
    const r = await setCategories(company, projectId, categories);
    return r.error || ok();
  },
  async deleteProject({ company }, { projectId }) {
    return (await deleteProject(company, projectId)) || ok();
  },
  async saveUser(ctx, { user }) {
    const r = await saveAccount(ctx.company, user, 'user', ctxName(ctx));
    return r.error || ok({ user: publicUser(r.user), invite: r.invite, verifySent: r.verifySent });
  },
  async resendInvite({ company, user: me }, { username }) {
    const u = await ownedUser(company, username);
    if (!u || isAdminRole(u)) return err(404, 'not_found', 'المستخدم غير موجود');
    if (!u.needsPassword || !u.email) return err(400, 'not_pending', 'هذا الحساب مفعّل، أو ليس له بريد');
    return ok({ invite: await sendInvite(u, me.displayName || company.customer) });
  },
  async removeDevice({ company }, { username, deviceId }) {
    const u = await ownedUser(company, username);
    if (!u || isAdminRole(u)) return err(404, 'not_found', 'المستخدم غير موجود');
    return (await removeDevice(company, username, deviceId)) || ok();
  },
  async deleteUser({ company }, { username }) {
    const u = await ownedUser(company, username);
    if (!u || isAdminRole(u)) return err(404, 'not_found', 'المستخدم غير موجود');
    return (await deleteAccount(company, username)) || ok();
  },
  // ---------- synced inventory ----------
  async inventoryStats({ company }, { projectId }) {
    if (!syncEnabled()) return err(503, 'sync_off', 'المزامنة غير مفعّلة على الخادم');
    if (!(await getProject(company, projectId))) return err(404, 'not_found', 'المشروع غير موجود');
    try { return ok({ stats: await rpc('project_stats', { p_company: company.id, p_project: projectId }) }); }
    catch { return err(502, 'sync_failed', 'تعذّر الاتصال بخادم البيانات'); }
  },
  async listAssets({ company }, { projectId, q, limit, offset, thumbs }) {
    if (!syncEnabled()) return err(503, 'sync_off', 'المزامنة غير مفعّلة على الخادم');
    if (!(await getProject(company, projectId))) return err(404, 'not_found', 'المشروع غير موجود');
    try {
      const r = await rpc('list_assets', {
        p_company: company.id, p_project: projectId, p_q: String(q || '').slice(0, 80),
        p_limit: Math.min(2000, Math.max(1, Number(limit) || 50)), p_offset: Math.max(0, Number(offset) || 0)
      });
      if (thumbs !== false) {
        const first = r.rows.map((a) => a.photos[0]).filter(Boolean);
        const urls = await signDownloads(first.map((h) => thumbPath(company.id, h)), 3600);
        for (const a of r.rows) a.thumbUrl = a.photos[0] ? urls[thumbPath(company.id, a.photos[0])] || null : null;
      }
      return ok(r);
    } catch { return err(502, 'sync_failed', 'تعذّر الاتصال بخادم البيانات'); }
  },
  async signPhotos({ company }, { hashes, thumbs }) {
    if (!syncEnabled()) return err(503, 'sync_off', 'المزامنة غير مفعّلة على الخادم');
    const list = [...new Set((hashes || []).filter((h) => HASH_RE.test(h)))].slice(0, 1000);
    const pathOf = (h) => (thumbs ? thumbPath(company.id, h) : photoPath(company.id, h));
    try {
      const urls = await signDownloads(list.map(pathOf), 3 * 3600);
      return ok({ urls: Object.fromEntries(list.map((h) => [h, urls[pathOf(h)] || null])) });
    } catch { return err(502, 'sync_failed', 'تعذّر الاتصال بخادم التخزين'); }
  },

  async updateMe({ user }, { displayName, email, currentPassword, newPassword }) {
    const rec = { ...user };
    if (typeof displayName === 'string') rec.displayName = displayName.trim().slice(0, 80);
    if (newPassword && !verifyPassword(currentPassword || '', user.salt, user.hash)) {
      return err(400, 'bad_password', 'كلمة المرور الحالية غير صحيحة');
    }
    const flags = applyCredentials(rec, user, { email: email ?? user.email, password: newPassword }, { requireEmail: true, minLength: 8 });
    if (flags.error) return flags.error;
    const r = await saveWithMail(rec, flags, {});
    return r.error || ok({ me: publicUser(r.user), verifySent: r.verifySent });
  }
};

export default handler(async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const body = await readBody(req);
  if (body.action === 'login') return login(body);

  const payload = verifyToken(bearer(req));
  if (!payload || payload.role !== 'cadmin') return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const ctx = await context(await db.getAccount(normUser(payload.u)));
  if (ctx.error) return ctx.error;
  if (ctx.company.id !== payload.lic) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');

  const fn = actions[body.action];
  if (!fn) return err(400, 'bad_action', 'Unknown action');
  return fn(ctx, body);
});

export const config = { path: '/api/company' };
