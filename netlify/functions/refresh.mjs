import { err, json, readBody, bearer, verifyToken, loadActive, issueToken, publicLicense } from '../lib/common.mjs';

// Re-validates the session against the current license state and issues a fresh token.
// The app calls this whenever it is online, so a revoked or expired license locks the app
// within one offline-grace window at most.
export default async (req) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const payload = verifyToken(bearer(req));
  if (!payload) return err(401, 'session_expired', 'انتهت الجلسة. سجّل الدخول مجددًا');
  const { deviceId } = await readBody(req);
  if (deviceId !== payload.dev) return err(401, 'device_mismatch', 'الجلسة لا تخص هذا الجهاز');

  const res = await loadActive(payload.u, payload.dev);
  if (res.error) return res.error;
  return json(200, { ok: true, token: issueToken(res.user, payload.dev), license: publicLicense(res.license, res.user) });
};

export const config = { path: '/api/refresh' };
