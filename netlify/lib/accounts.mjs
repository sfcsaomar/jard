// Account management shared by the super-admin panel and the company-admin panel.
import {
  err, db, hashPassword, normUser, monthStr, normSettings, normCategories, isAdminRole, newId, ensureProjects, normTerm
} from './common.mjs';
import { isUserLimitError } from './db.mjs';
import { syncEnabled, rpc } from './supa.mjs';

// Asset counts per project from the synced inventory; empty when sync is off or unreachable.
export async function assetCounts(companyId) {
  if (!syncEnabled()) return null;
  try { return (await rpc('company_counts', { p_company: companyId })) || {}; } catch { return null; }
}

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export function publicDevice(user) {
  const info = user.deviceInfo || {};
  return (user.devices || []).map((id) => ({
    id, short: id.slice(0, 8), addedAt: info[id]?.addedAt || null, lastSeen: info[id]?.lastSeen || null
  }));
}

export const publicUser = (u) => ({
  username: u.username,
  displayName: u.displayName || '',
  companyId: u.licenseId,
  licenseId: u.licenseId,
  projectId: u.projectId || null,
  role: isAdminRole(u) ? 'admin' : 'user',
  active: u.active !== false,
  devices: publicDevice(u),
  lastLogin: u.lastLogin || null,
  createdAt: u.createdAt || null
});

export function publicProject(p, users = []) {
  const cats = normCategories(p.categories);
  return {
    id: p.id, name: p.name, active: p.active !== false, notes: p.notes || '',
    settings: normSettings(p.settings),
    categoryCount: cats.length,
    subCategoryCount: cats.reduce((n, c) => n + c.subs.length, 0),
    userCount: users.filter((u) => u.projectId === p.id).length,
    createdAt: p.createdAt || null
  };
}

export function publicCompany(c) {
  const term = normTerm(c);
  return {
    id: c.id,
    customer: c.customer,
    active: c.active !== false,
    startsAt: term.startsAt,
    months: term.months,
    expiresAt: c.expiresAt || null,
    maxUsers: Number(c.maxUsers || 1),
    maxDevicesPerUser: Number(c.maxDevicesPerUser || 1),
    aiEnabled: c.aiEnabled !== false,
    aiMonthlyCap: Number(c.aiMonthlyCap || 0),
    contactName: c.contactName || '',
    contactPhone: c.contactPhone || '',
    contactEmail: c.contactEmail || '',
    renewals: c.renewals || [],
    createdAt: c.createdAt || null
  };
}

export async function companyUsers(companyId) {
  return db.listAccounts(companyId);
}

// Full picture of one company, used by both panels.
export async function companySnapshot(company, { withNotes = false } = {}) {
  const projects = await ensureProjects(company);
  const users = await companyUsers(company.id);
  const fieldUsers = users.filter((u) => u.role === 'user');
  const m = monthStr();
  const usage = (await db.usageGet(company.id, m)) || { count: 0 };
  const pub = publicCompany(company);
  if (withNotes) pub.notes = company.notes || '';
  projects.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const counts = await assetCounts(company.id);
  const assetTotal = counts ? Object.values(counts).reduce((n, c) => n + Number(c || 0), 0) : null;
  return {
    month: m,
    sync: syncEnabled(),
    company: { ...pub, usage: { count: usage.count || 0 }, userCount: fieldUsers.length, assetCount: assetTotal },
    projects: projects.map((p) => ({ ...publicProject(p, fieldUsers), assetCount: counts ? Number(counts[p.id] || 0) : null })),
    users: fieldUsers.map(publicUser),
    admins: users.filter(isAdminRole).map(publicUser)
  };
}

// ---------- users ----------
// Creates or updates a field user (role "user") or a company admin (role "admin") in one company.
// Usernames are global, so a name owned by another company is refused rather than taken over.
export async function saveAccount(company, input, role) {
  const username = normUser(input?.username);
  if (!USERNAME_RE.test(username)) {
    return { error: err(400, 'bad_username', 'اسم المستخدم: 3-40 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو . _ -') };
  }
  const existing = await db.getAccount(username);
  if (existing && existing.licenseId !== company.id) {
    return { error: err(409, 'username_taken', 'اسم المستخدم مستخدم لدى جهة أخرى. اختر اسمًا مختلفًا') };
  }
  if (existing && (isAdminRole(existing) ? 'admin' : 'user') !== role) {
    return { error: err(409, 'username_taken', 'اسم المستخدم مستخدم لحساب من نوع آخر في نفس الشركة') };
  }
  if (!existing && !input.password) return { error: err(400, 'no_password', 'كلمة المرور مطلوبة للحساب الجديد') };
  if (input.password && String(input.password).length < 8) return { error: err(400, 'weak_password', 'كلمة المرور 8 أحرف على الأقل') };

  const rec = existing || { username, devices: [], createdAt: new Date().toISOString() };
  rec.licenseId = company.id;
  rec.role = role;
  rec.displayName = String(input.displayName || '').trim().slice(0, 80);
  rec.active = input.active !== false;

  if (role === 'admin') {
    rec.devices = [];
    rec.deviceInfo = {};
    rec.projectId = null;
  } else {
    const project = await db.getProject(company.id, input.projectId);
    if (!project) return { error: err(400, 'no_project', 'اختر المشروع الذي سيعمل عليه المستخدم') };
    rec.projectId = project.id;
    rec.settings = null; // settings now come from the project
  }
  if (input.password) Object.assign(rec, hashPassword(input.password));
  try {
    return { user: await db.saveAccount(rec) };
  } catch (e) {
    if (isUserLimitError(e)) {
      return { error: err(400, 'user_limit', `وصلت الرخصة للحد الأعلى من المستخدمين (${Number(company.maxUsers || 1)})`) };
    }
    throw e;
  }
}

export async function ownedUser(company, username) {
  const u = await db.getAccount(username);
  if (!u || u.licenseId !== company.id) return null;
  return u;
}

export async function removeDevice(company, username, deviceId) {
  const u = await ownedUser(company, username);
  if (!u) return err(404, 'not_found', 'المستخدم غير موجود');
  await db.removeDevice(u.username, deviceId || null);
  return null;
}

export async function deleteAccount(company, username) {
  const u = await ownedUser(company, username);
  if (!u) return err(404, 'not_found', 'المستخدم غير موجود');
  await db.deleteAccount(u.username);
  return null;
}

// ---------- projects ----------
export async function saveProject(company, input) {
  const name = String(input?.name || '').trim().slice(0, 120);
  if (!name) return { error: err(400, 'missing', 'اسم المشروع مطلوب') };
  const id = input.id || newId();
  const old = input.id ? await db.getProject(company.id, id) : null;
  if (input.id && !old) return { error: err(404, 'not_found', 'المشروع غير موجود') };
  const rec = {
    ...(old || { createdAt: new Date().toISOString(), categories: [] }),
    id, companyId: company.id, name,
    active: input.active !== false,
    notes: String(input.notes || '').slice(0, 500),
    settings: normSettings(input.settings || old?.settings)
  };
  const saved = await db.saveProject(rec);
  if (!saved) return { error: err(404, 'not_found', 'المشروع غير موجود') };
  return { project: saved };
}

export async function setCategories(company, projectId, categories) {
  const p = await db.getProject(company.id, projectId);
  if (!p) return { error: err(404, 'not_found', 'المشروع غير موجود') };
  p.categories = normCategories(categories);
  p.categoriesUpdatedAt = new Date().toISOString();
  return { project: await db.saveProject(p) };
}

export async function getProject(company, projectId) {
  return db.getProject(company.id, projectId);
}

export async function deleteProject(company, projectId) {
  const users = (await companyUsers(company.id)).filter((u) => u.projectId === projectId && u.role === 'user');
  if (users.length) return err(400, 'has_users', 'انقل مستخدمي هذا المشروع إلى مشروع آخر أولًا');
  const counts = await assetCounts(company.id);
  if (counts && Number(counts[projectId] || 0) > 0) {
    return err(400, 'has_assets', 'لهذا المشروع أصول مرفوعة على الخادم، فلا يمكن حذفه. يمكنك إيقافه بدل الحذف');
  }
  const projects = await db.listProjects(company.id);
  if (projects.length <= 1) return err(400, 'last_project', 'لا يمكن حذف آخر مشروع في الشركة');
  await db.deleteProject(company.id, projectId);
  return null;
}

export async function loadCompany(id) {
  return db.getCompany(id);
}
