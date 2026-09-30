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

export async function getJSON(key) { return (await store().get(key, { type: 'json' })) || null; }
export async function setJSON(key, val) { await store().setJSON(key, val); }

// ---------- license validation ----------
// Returns { user, license } or an error Response.
export async function loadActive(username, deviceId, { registerDevice = false } = {}) {
  const user = await getJSON(userKey(username));
  if (!user) return { error: err(401, 'bad_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة') };
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
      return { error: err(403, 'device_limit', `تجاوزت عدد الأجهزة المسموح (${max}). اطلب من المزوّد إعادة ضبط الأجهزة`) };
    }
    devices.push(deviceId);
    user.devices = devices;
    await setJSON(userKey(username), user);
  }
  return { user, license };
}

export function publicLicense(license, user) {
  return {
    customer: license.customer,
    expiresAt: license.expiresAt || null,
    aiEnabled: license.aiEnabled !== false,
    username: user.username,
    displayName: user.displayName || user.username
  };
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
