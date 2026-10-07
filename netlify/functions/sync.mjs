// Field-app sync: the phone asks for signed upload URLs for its photos, uploads them straight
// to storage, then pushes the asset records. Every call re-checks the license and the device.
import { err, json, readBody, bearer, verifyToken, loadActive, handler } from '../lib/common.mjs';
import { syncEnabled, rpc, signUpload, photoPath, thumbPath, HASH_RE } from '../lib/supa.mjs';

const MAX_SIGN = 40;
const MAX_PUSH = 25;
const FIELDS = ['category', 'catCode', 'subCategory', 'subCategoryCode', 'name', 'brand', 'condition',
  'model', 'sn', 'plateNo', 'location', 'building', 'notes', 'value'];

const str = (v, n) => String(v ?? '').slice(0, n);

function cleanAsset(a) {
  if (!a || typeof a.uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(a.uid)) return null;
  const data = {};
  for (const f of FIELDS) if (a.data?.[f] != null && a.data[f] !== '') data[f] = str(a.data[f], f === 'name' ? 300 : 200);
  if (a.data?.deleteFlag?.reason) {
    data.deleteFlag = { reason: str(a.data.deleteFlag.reason, 200), at: Number(a.data.deleteFlag.at) || Date.now() };
  }
  const photos = (Array.isArray(a.photos) ? a.photos : []).filter((h) => HASH_RE.test(h)).slice(0, 4);
  const now = Date.now();
  const clampTime = (t) => Math.min(now + 86400000, Math.max(0, Number(t) || now));
  return {
    uid: a.uid,
    tag: str(a.tag, 80),
    data,
    photos,
    label: HASH_RE.test(a.label || '') ? a.label : null,
    flagged: !!data.deleteFlag,
    createdAt: clampTime(a.createdAt),
    updatedAt: clampTime(a.updatedAt)
  };
}

export default handler(async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const payload = verifyToken(bearer(req));
  if (!payload) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const body = await readBody(req);
  if (body.deviceId !== payload.dev) return err(401, 'device_mismatch', 'الجلسة لا تخص هذا الجهاز');
  const res = await loadActive(payload.u, payload.dev);
  if (res.error) return res.error;
  if (!syncEnabled()) return err(503, 'sync_off', 'المزامنة غير مفعّلة على الخادم');
  if (!res.project) return err(409, 'no_project', 'حسابك غير مرتبط بمشروع. تواصل مع مدير حساب شركتك');
  const companyId = res.license.id;

  try {
    if (body.action === 'sign') {
      const photos = [...new Set((body.photos || []).filter((h) => HASH_RE.test(h)))];
      const thumbs = [...new Set((body.thumbs || []).filter((h) => HASH_RE.test(h)))];
      if (photos.length + thumbs.length > MAX_SIGN) return err(400, 'too_many', 'طلبات كثيرة دفعة واحدة');
      const uploads = [];
      for (const h of photos) uploads.push({ hash: h, kind: 'photo', url: await signUpload(photoPath(companyId, h)) });
      for (const h of thumbs) uploads.push({ hash: h, kind: 'thumb', url: await signUpload(thumbPath(companyId, h)) });
      return json(200, { ok: true, uploads });
    }

    if (body.action === 'push') {
      const rows = (Array.isArray(body.assets) ? body.assets : []).slice(0, MAX_PUSH).map(cleanAsset).filter(Boolean);
      if (!rows.length) return json(200, { ok: true, saved: [] });
      await rpc('upsert_assets', {
        p_company: companyId, p_project: res.project.id, p_user: res.user.username, p_device: payload.dev, p_rows: rows
      });
      return json(200, { ok: true, saved: rows.map((r) => ({ uid: r.uid, updatedAt: r.updatedAt })) });
    }
  } catch (e) {
    return err(502, 'sync_failed', 'تعذّر الاتصال بخادم التخزين، ستُعاد المحاولة تلقائيًا');
  }
  return err(400, 'bad_action', 'Unknown action');
});

export const config = { path: '/api/sync' };
