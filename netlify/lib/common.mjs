// Shared helpers for all functions: storage, password hashing, signed tokens, license checks.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const TOKEN_DAYS = Number(process.env.OFFLINE_GRACE_DAYS || 7);
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

let _store = null;
export function store() {
  if (!_store) _store = getStore({ name: 'licensing', consistency: 'strong' });
  return _store;
}
export function _setStoreForTests(s) { _store = s; }

// ---------- responses ----------
export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
export const err = (status, code, message) => json(status, { ok: false, code, message });

// ---------- passwords ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// ---------- tokens ----------
function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 24) throw new Error('TOKEN_SECRET env var missing or too short');
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
export function bearer(req) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// ---------- keys ----------
export const normUser = (u) => String(u || '').trim().toLowerCase();
export const userKey = (u) => `users/${normUser(u)}`;
export const licKey = (id) => `licenses/${id}`;
export const monthStr = (d = new Date()) => d.toISOString().slice(0, 7);
export const usageKey = (licId, m = monthStr()) => `usage/${licId}/${m}`;
export const projectKey = (companyId, pid) => `projects/${companyId}/${pid}`;
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
export const isAdminRole = (u) => u?.role === 'admin';

export async function listPrefix(prefix) {
  const { blobs } = await store().list({ prefix });
  const out = [];
  for (const b of blobs) { const v = await getJSON(b.key); if (v) out.push(v); }
  return out;
}

export async function getJSON(key) { return (await store().get(key, { type: 'json' })) || null; }
export async function setJSON(key, val) { await store().setJSON(key, val); }

// ---------- license validation ----------
// Returns { user, license } or an error Response.
export async function loadActive(username, deviceId, { registerDevice = false } = {}) {
  const user = await getJSON(userKey(username));
  if (!user) return { error: err(401, 'bad_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة') };
  if (isAdminRole(user)) return { error: err(403, 'admin_account', 'هذا حساب إدارة الشركة. ادخل من لوحة الشركة: /company') };
  if (!user.active) return { error: err(403, 'user_disabled', 'هذا الحساب موقوف. تواصل مع المزوّد') };
  const license = await getJSON(licKey(user.licenseId));
  if (!license) return { error: err(403, 'no_license', 'لا توجد رخصة مرتبطة بهذا الحساب') };
  if (!license.active) return { error: err(403, 'license_disabled', 'الرخصة موقوفة. تواصل مع المزوّد') };
  if (license.expiresAt && new Date(license.expiresAt + 'T23:59:59Z').getTime() < Date.now()) {
    return { error: err(403, 'license_expired', 'انتهت صلاحية الرخصة. تواصل مع المزوّد للتجديد') };
  }
  const devices = user.devices || [];
  if (deviceId && !devices.includes(deviceId)) {
    const max = Number(license.maxDevicesPerUser || 1);
    if (!registerDevice) return { error: err(403, 'device_unknown', 'هذا الجهاز غير مسجّل لهذا الحساب') };
    if (devices.length >= max) {
      return { error: err(403, 'device_limit', `تجاوزت عدد الأجهزة المسموح (${max}). اطلب من مدير حساب شركتك تحرير جهاز سابق`) };
    }
    devices.push(deviceId);
    user.devices = devices;
    user.deviceInfo = { ...(user.deviceInfo || {}), [deviceId]: { addedAt: new Date().toISOString() } };
    await setJSON(userKey(username), user);
  }
  const project = user.projectId ? await getJSON(projectKey(license.id, user.projectId)) : null;
  if (project && project.active === false) {
    return { error: err(403, 'project_disabled', 'المشروع المرتبط بحسابك موقوف. تواصل مع مدير حساب شركتك') };
  }
  return { user, license, project, settings: normSettings(project ? project.settings : user.settings) };
}

// ---------- license term (months) ----------
const today = () => new Date().toISOString().slice(0, 10);
export function addMonthsMinusDay(start, months) {
  const [y, m, d] = String(start).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + Number(months), d));
  if (dt.getUTCDate() !== d) dt.setUTCDate(0); // e.g. Jan 31 + 1 month -> end of Feb
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
// Legacy licenses had only expiresAt; derive a start date and a month count for them.
export function normTerm(c) {
  const startsAt = /^\d{4}-\d{2}-\d{2}$/.test(c.startsAt || '') ? c.startsAt : String(c.createdAt || today()).slice(0, 10);
  let months = Math.floor(Number(c.months) || 0);
  if (!months && c.expiresAt) {
    const a = new Date(startsAt), b = new Date(c.expiresAt);
    months = Math.max(1, Math.round((b - a) / (30.44 * 86400000)));
  }
  return { startsAt, months: months || 12 };
}

// ---------- categories ----------
const MAX_CATS = 1000, MAX_SUBS = 10000;
const cstr = (v, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function normCategories(list) {
  const out = [];
  let subs = 0;
  for (const c of Array.isArray(list) ? list : []) {
    const name = cstr(c?.name);
    if (!name || out.length >= MAX_CATS) continue;
    const seen = new Set();
    const s = [];
    for (const x of Array.isArray(c.subs) ? c.subs : []) {
      const sn = cstr(x?.name);
      if (!sn || seen.has(sn) || subs >= MAX_SUBS) continue;
      seen.add(sn); subs++;
      s.push({ code: cstr(x.code, 40), name: sn });
    }
    out.push({ code: cstr(c.code, 40), name, subs: s });
  }
  return out;
}

// ---------- per-user field settings ----------
// Fields the admin can make mandatory for a user. The asset number and at least
// one photo are always mandatory; minPhotos (1-4) raises the photo minimum.
export const REQUIRABLE_FIELDS = [
  'category', 'name', 'condition', 'building', 'location',
  'catcode', 'subcat', 'subcatcode', 'brand', 'model', 'sn', 'plateno', 'value', 'notes'
];
export function normSettings(s) {
  const lang = s?.lang === 'en' ? 'en' : 'ar';
  const required = Array.isArray(s?.required)
    ? [...new Set(s.required.filter((f) => REQUIRABLE_FIELDS.includes(f)))]
    : [];
  const minPhotos = Math.min(4, Math.max(1, Math.floor(Number(s?.minPhotos) || 1)));
  return { lang, required, minPhotos };
}

export function publicLicense(license, user, project) {
  return {
    customer: license.customer,
    expiresAt: license.expiresAt || null,
    aiEnabled: license.aiEnabled !== false,
    username: user.username,
    displayName: user.displayName || user.username,
    projectId: project?.id || null,
    projectName: project?.name || '',
    settings: normSettings(project ? project.settings : user.settings),
    categories: project ? normCategories(project.categories) : []
  };
}

// ---------- one-time migration: legacy license -> company with a default project ----------
// Older data had settings per user and no projects. The first time a company is opened,
// create one default project (taking the first user's settings) and move every user into it.
export async function ensureProjects(company) {
  const projects = await listPrefix(`projects/${company.id}/`);
  const users = (await listPrefix('users/')).filter((u) => u.licenseId === company.id && !isAdminRole(u));
  const orphans = users.filter((u) => !u.projectId || !projects.some((p) => p.id === u.projectId));
  if (!orphans.length) return projects;
  let target = projects[0];
  if (!target) {
    target = {
      id: newId(), companyId: company.id, name: 'المشروع الافتراضي', active: true,
      settings: normSettings(orphans[0]?.settings), categories: [], createdAt: new Date().toISOString()
    };
    await setJSON(projectKey(company.id, target.id), target);
    projects.push(target);
  }
  for (const u of orphans) { u.projectId = target.id; await setJSON(userKey(u.username), u); }
  return projects;
}

export function issueToken(user, deviceId) {
  const now = Date.now();
  return signToken({ u: user.username, lic: user.licenseId, dev: deviceId, iat: now, exp: now + TOKEN_DAYS * 86400000 });
}

// ---------- brute-force lock ----------
export async function checkLock(username) {
  const rec = await getJSON(`locks/${normUser(username)}`);
  if (rec && rec.until && rec.until > Date.now()) return Math.ceil((rec.until - Date.now()) / 60000);
  return 0;
}
export async function recordFail(username) {
  const key = `locks/${normUser(username)}`;
  const rec = (await getJSON(key)) || { count: 0 };
  rec.count = (rec.count || 0) + 1;
  if (rec.count >= MAX_FAILED) { rec.until = Date.now() + LOCK_MINUTES * 60000; rec.count = 0; }
  await setJSON(key, rec);
}
export async function clearFails(username) { await store().delete(`locks/${normUser(username)}`); }

export async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}
