// Public account actions reached from emailed links: request a password reset, read a link,
// set a password (invitation or reset), and confirm an email address.
import crypto from 'node:crypto';
import { err, json, readBody, db, hashPassword, normUser, handler } from '../lib/common.mjs';
import { sendInvite, notify } from '../lib/accounts.mjs';
import { toEnglish } from '../lib/messages-en.mjs';
import { sendMail, templates, newToken, hashToken, linkFor, LINK_MINUTES, normEmail } from '../lib/mail.mjs';

const ok = (body = {}) => json(200, { ok: true, ...body, ...(body.message ? { messageEn: toEnglish(body.message) } : {}) });
const BAD_LINK = 'الرابط غير صالح أو انتهت صلاحيته أو استُخدم من قبل. اطلب رابطًا جديدًا';
const minLengthFor = (role) => (role === 'super' ? 10 : 8);
const ipOf = (req, context) => String(context?.ip || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
const keyHash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

// Where the account owner signs in after setting a password.
const homeFor = (role) => (role === 'super' ? '/admin' : role === 'admin' ? '/company' : '/');

async function requestReset(req, context, { identifier }) {
  const id = String(identifier || '').trim().toLowerCase().slice(0, 200);
  const generic = ok({ message: 'إذا كان الحساب موجودًا وله بريد مؤكَّد، فستصلك رسالة خلال دقائق. المستخدم الذي ليس له بريد يطلب من مدير حساب شركته إعادة تعيين كلمة مروره.' });
  if (!id) return err(400, 'missing', 'أدخل اسم المستخدم أو البريد الإلكتروني');

  // At most 10 requests per address and 3 per account in an hour, so the form cannot be used to flood inboxes.
  const ipKey = 'rip:' + keyHash(ipOf(req, context));
  const idKey = 'rid:' + keyHash(id);
  if ((await db.lockCheck(ipKey)) || (await db.lockCheck(idKey))) return generic;
  await db.lockFail(ipKey, 10, 60);
  await db.lockFail(idKey, 3, 60);

  const user = id.includes('@') ? await db.getAccountByEmail(normEmail(id)) : await db.getAccount(normUser(id));
  if (!user || user.active === false || !user.email) return generic;
  if (user.needsPassword) { await sendInvite(user); return generic; } // never activated: resend the invitation
  if (!user.emailVerifiedAt) return generic;
  const token = newToken();
  await db.tokCreate(hashToken(token), user.username, 'reset', user.email, LINK_MINUTES.reset);
  await sendMail(user.email, templates.reset({ name: user.displayName, username: user.username, url: linkFor(token) }));
  return generic;
}

async function peek({ token }) {
  const t = token ? await db.tokPeek(hashToken(token)) : null;
  if (!t) return err(410, 'bad_link', BAD_LINK);
  const user = await db.getAccount(t.username);
  if (!user || user.active === false) return err(410, 'bad_link', BAD_LINK);
  return ok({
    purpose: t.purpose, username: user.username, displayName: user.displayName || '',
    email: t.email || '', minLength: minLengthFor(user.role)
  });
}

async function setPassword({ token, password }) {
  const hash = hashToken(token || '');
  const t = await db.tokPeek(hash);
  if (!t || (t.purpose !== 'invite' && t.purpose !== 'reset')) return err(410, 'bad_link', BAD_LINK);
  const user = await db.getAccount(t.username);
  if (!user || user.active === false) return err(410, 'bad_link', BAD_LINK);
  const min = minLengthFor(user.role);
  if (String(password || '').length < min) return err(400, 'weak_password', `كلمة المرور ${min} أحرف على الأقل`);
  // Consuming is atomic: a link opened twice at the same moment only works once.
  const used = await db.tokConsume(hash, t.purpose);
  if (!used) return err(410, 'bad_link', BAD_LINK);
  Object.assign(user, hashPassword(password));
  user.needsPassword = false;
  // Opening a link sent to this address proves the mailbox belongs to the account owner.
  if (used.email && used.email === user.email) user.emailVerifiedAt = new Date().toISOString();
  const saved = await db.saveAccount(user);
  await db.lockClear(`u:${user.username}`);
  if (t.purpose === 'reset') await notify(saved, 'passwordChanged');
  return ok({ username: saved.username, role: saved.role, home: homeFor(saved.role), purpose: t.purpose });
}

async function verifyEmail({ token }) {
  const used = await db.tokConsume(hashToken(token || ''), 'verify_email');
  if (!used) return err(410, 'bad_link', BAD_LINK);
  const user = await db.getAccount(used.username);
  if (!user || !user.email || user.email !== used.email) return err(410, 'bad_link', 'تغيّر البريد المسجّل لهذا الحساب بعد إرسال الرابط');
  user.emailVerifiedAt = new Date().toISOString();
  await db.saveAccount(user);
  return ok({ username: user.username, email: user.email, home: homeFor(user.role) });
}

export default handler(async (req, context) => {
  if (req.method !== 'POST') return err(405, 'method', 'Method not allowed');
  const body = await readBody(req);
  if (body.action === 'requestReset') return requestReset(req, context, body);
  if (body.action === 'peek') return peek(body);
  if (body.action === 'setPassword') return setPassword(body);
  if (body.action === 'verifyEmail') return verifyEmail(body);
  return err(400, 'bad_action', 'Unknown action');
});

export const config = { path: '/api/account' };
