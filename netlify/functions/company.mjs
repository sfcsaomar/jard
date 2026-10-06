// Company-admin API: the customer's own administrator manages projects, field users and devices
// within the limits of the license the super admin set for the company.
import {
  err, json, readBody, bearer, getJSON, setJSON, userKey, verifyPassword, hashPassword, signToken,
  verifyToken, checkLock, recordFail, clearFails, isAdminRole, normUser
} from '../lib/common.mjs';
import {
  companySnapshot, saveAccount, removeDevice, deleteAccount, saveProject, setCategories, getProject,
  deleteProject, loadCompany, publicUser, ownedUser
} from '../lib/accounts.mjs';

const SESSION_HOURS = 12;
const ok = (body = {}) => json(200, { ok: true, ...body });

async function login({ username, password }) {
  if (!username || !password) return err(400, 'missing', 'أدخل اسم المستخدم وكلمة المرور');
  const lockedMin = await checkLock(username);
  if (lockedMin) return err(429, 'locked', `محاولات كثيرة خاطئة. حاول بعد ${lockedMin} دقيقة`);
  const user = await getJSON(userKey(username));
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    await recordFail(username);
    await new Promise((r) => setTimeout(r, 400));
    return err(401, 'bad_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!isAdminRole(user)) return err(403, 'not_company_admin', 'هذا حساب مستخدم ميداني. ادخل من تطبيق الجرد');
  await clearFails(username);
  const ctx = await context(user);
  if (ctx.error) return ctx.error;
  user.lastLogin = new Date().toISOString();
  await setJSON(userKey(user.username), user);
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
    return ok({ ...(await companySnapshot(company)), me: publicUser(user) });
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
  async saveUser({ company }, { user }) {
    const r = await saveAccount(company, user, 'user');
    return r.error || ok({ user: publicUser(r.user) });
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
  async updateMe({ user }, { displayName, currentPassword, newPassword }) {
    if (typeof displayName === 'string') user.displayName = displayName.trim().slice(0, 80);
    if (newPassword) {
      if (!verifyPassword(currentPassword || '', user.salt, user.hash)) return err(400, 'bad_password', 'كلمة المرور الحالية غير صحيحة');
      if (String(newPassword).length < 8) return err(400, 'weak_password', 'كلمة المرور الجديدة 8 أحرف على الأقل');
      Object.assign(user, hashPassword(newPassword));
    }
    await setJSON(userKey(user.username), user);
    return ok({ me: publicUser(user) });
  }
};

export default async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const body = await readBody(req);
  if (body.action === 'login') return login(body);

  const payload = verifyToken(bearer(req));
  if (!payload || payload.role !== 'cadmin') return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const ctx = await context(await getJSON(userKey(normUser(payload.u))));
  if (ctx.error) return ctx.error;
  if (ctx.company.id !== payload.lic) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');

  const fn = actions[body.action];
  if (!fn) return err(400, 'bad_action', 'Unknown action');
  return fn(ctx, body);
};

export const config = { path: '/api/company' };
