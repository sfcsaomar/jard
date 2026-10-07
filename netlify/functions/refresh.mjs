import { err, json, readBody, bearer, verifyToken, loadActive, issueToken, publicLicense, db, handler } from '../lib/common.mjs';

// Re-validates the session against the current license state and issues a fresh token.
// The app calls this whenever it is online, so a revoked or expired license locks the app
// within one offline-grace window at most.
export default handler(async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const payload = verifyToken(bearer(req));
  if (!payload) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const { deviceId } = await readBody(req);
  if (deviceId !== payload.dev) return err(401, 'device_mismatch', 'الجلسة لا تخص هذا الجهاز');

  const res = await loadActive(payload.u, payload.dev);
  if (res.error) return res.error;
  // Record when each device was last seen (at most once an hour) so the company admin can tell devices apart.
  const last = res.user.deviceInfo?.[payload.dev]?.lastSeen;
  if (!last || Date.now() - Date.parse(last) > 3600000) await db.seen(res.user.username, payload.dev, false);
  return json(200, { ok: true, token: issueToken(res.user, payload.dev), license: publicLicense(res.license, res.user, res.project) });
});

export const config = { path: '/api/refresh' };
