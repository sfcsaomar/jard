import {
  err, json, readBody, db, verifyPassword, loadActive, issueToken, publicLicense, checkLock, recordFail, clearFails, handler,
  NOT_ACTIVATED
} from '../lib/common.mjs';
import { notify } from '../lib/accounts.mjs';

export default handler(async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const { username, password, deviceId } = await readBody(req);
  if (!username || !password || !deviceId) return err(400, 'missing', 'أدخل اسم المستخدم وكلمة المرور');

  const lockedMin = await checkLock(username);
  if (lockedMin) return err(429, 'locked', `محاولات كثيرة خاطئة. حاول بعد ${lockedMin} دقيقة`);

  const user = await db.getAccount(username);
  if (user?.needsPassword) return err(403, 'not_activated', NOT_ACTIVATED);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    await recordFail(username);
    return err(401, 'bad_credentials', 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  await clearFails(username);

  const res = await loadActive(username, deviceId, { registerDevice: true });
  if (res.error) return res.error;
  await db.seen(res.user.username, deviceId, true);
  if (res.newDevice && (res.user.devices || []).length > 1) {
    await notify(res.user, 'newDevice', { when: new Date().toISOString().slice(0, 16).replace('T', ' ') });
  }

  return json(200, { ok: true, token: issueToken(res.user, deviceId), license: publicLicense(res.license, res.user, res.project) });
});

export const config = { path: '/api/login' };
