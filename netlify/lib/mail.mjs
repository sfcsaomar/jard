// Transactional email through Resend: invitations, password reset, email confirmation and security notices.
// Every message is bilingual (Arabic first, then English).
import crypto from 'node:crypto';

const RESEND_URL = () => process.env.RESEND_URL || 'https://api.resend.com/emails';
const FROM = () => process.env.MAIL_FROM || 'أمان | AMAN <support@amantrack.com>';
export const APP_URL = () => (process.env.APP_URL || 'https://field.amantrack.com').replace(/\/+$/, '');
export const mailEnabled = () => (process.env.RESEND_API_KEY || '').length > 10;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// AMAN identity v2: navy header with the wordmark, blue button, cool greys. Email clients ignore SVG,
// so the header logo is a PNG served from the app.
const C = { navy: '#01345A', accent: '#0068AF', page: '#F8FAFD', card: '#FFFFFF', line: '#E2E8EE', ink: '#1A242D', ink2: '#535C65', faint: '#626A72' };

function layout({ titleAr, titleEn, bodyAr, bodyEn, button, url, footAr, footEn }) {
  const btn = (label) => url
    ? `<p style="margin:22px 0"><a href="${esc(url)}" style="background:${C.accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>`
    : '';
  const link = url ? `<p style="font-size:12px;color:${C.faint};word-break:break-all">${esc(url)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:${C.page};font-family:Tahoma,Arial,sans-serif;color:${C.ink}">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
 <div style="background:${C.navy};border-radius:14px 14px 0 0;padding:18px 24px" align="center">
  <img src="${APP_URL()}/brand/aman-wordmark-email.png" width="109" height="24" alt="AMAN" style="display:block;border:0;height:24px;width:109px">
 </div>
 <div style="height:3px;line-height:3px;font-size:0;background:${C.accent};background-image:linear-gradient(90deg,#0068AF,#0B81D0,#329FF5)">&nbsp;</div>
 <div style="background:${C.card};border:1px solid ${C.line};border-top:none;border-radius:0 0 14px 14px;padding:24px" dir="rtl" align="right">
  <div style="font-size:13px;color:${C.faint};margin-bottom:6px">أمان · الجرد الميداني</div>
  <h2 style="margin:0 0 12px;font-size:20px;color:${C.navy}">${esc(titleAr)}</h2>
  <div style="font-size:15px;line-height:1.8">${bodyAr}</div>
  ${btn(button?.[0])}
  ${footAr ? `<p style="font-size:13px;color:${C.ink2};line-height:1.7">${footAr}</p>` : ''}
 </div>
 <div style="background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:24px;margin-top:12px" dir="ltr" align="left">
  <div style="font-size:13px;color:${C.faint};margin-bottom:6px">AMAN · Field Inventory</div>
  <h2 style="margin:0 0 12px;font-size:18px;color:${C.navy}">${esc(titleEn)}</h2>
  <div style="font-size:14px;line-height:1.7">${bodyEn}</div>
  ${btn(button?.[1])}
  ${footEn ? `<p style="font-size:12px;color:${C.ink2};line-height:1.6">${footEn}</p>` : ''}
  ${link}
 </div>
 <p style="font-size:11px;color:${C.faint};text-align:center;margin-top:14px">AMAN · amantrack.com · support@amantrack.com</p>
</div></body></html>`;
}

const IGNORE_AR = 'إذا لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغير شيء في حسابك.';
const IGNORE_EN = 'If you did not request this, ignore this email; nothing changes on your account.';

export const templates = {
  invite: ({ name, username, url, inviter }) => ({
    subject: 'دعوة لحسابك في أمان | Your AMAN account invitation',
    html: layout({
      titleAr: `أهلًا ${name || username}`,
      titleEn: `Welcome ${name || username}`,
      bodyAr: `أنشأ ${esc(inviter || 'مدير الحساب')} لك حسابًا في نظام أمان للجرد الميداني باسم المستخدم <b dir="ltr">${esc(username)}</b>. اضغط الزر لتضع كلمة مرورك وتفعّل الحساب.`,
      bodyEn: `${esc(/[A-Za-z]/.test(inviter || '') ? inviter : 'Your administrator')} created an AMAN Field Inventory account for you with the username <b>${esc(username)}</b>. Use the button to set your password and activate it.`,
      button: ['تفعيل الحساب', 'Activate account'], url,
      footAr: 'الرابط صالح لمدة 7 أيام ويُستخدم مرة واحدة.', footEn: 'The link is valid for 7 days and works once.'
    })
  }),
  reset: ({ name, username, url }) => ({
    subject: 'إعادة تعيين كلمة المرور | Reset your password',
    html: layout({
      titleAr: 'إعادة تعيين كلمة المرور', titleEn: 'Reset your password',
      bodyAr: `طلبنا إعادة تعيين كلمة المرور للحساب <b dir="ltr">${esc(username)}</b>${name ? ` (${esc(name)})` : ''}. اضغط الزر لاختيار كلمة مرور جديدة.`,
      bodyEn: `A password reset was requested for the account <b>${esc(username)}</b>. Use the button to choose a new password.`,
      button: ['اختر كلمة مرور جديدة', 'Choose a new password'], url,
      footAr: `الرابط صالح لمدة ساعة ويُستخدم مرة واحدة. ${IGNORE_AR}`, footEn: `The link is valid for one hour and works once. ${IGNORE_EN}`
    })
  }),
  verify: ({ username, email, url }) => ({
    subject: 'تأكيد البريد الإلكتروني | Confirm your email',
    html: layout({
      titleAr: 'تأكيد البريد الإلكتروني', titleEn: 'Confirm your email',
      bodyAr: `أُضيف هذا البريد (<span dir="ltr">${esc(email)}</span>) إلى الحساب <b dir="ltr">${esc(username)}</b>. اضغط الزر لتأكيده، فتصلك عليه رسائل إعادة تعيين كلمة المرور والتنبيهات.`,
      bodyEn: `This address (${esc(email)}) was added to the account <b>${esc(username)}</b>. Confirm it to receive password resets and security notices here.`,
      button: ['تأكيد البريد', 'Confirm email'], url,
      footAr: `الرابط صالح لمدة 3 أيام. ${IGNORE_AR}`, footEn: `The link is valid for 3 days. ${IGNORE_EN}`
    })
  }),
  passwordChanged: ({ username }) => ({
    subject: 'تم تغيير كلمة المرور | Your password was changed',
    html: layout({
      titleAr: 'تم تغيير كلمة المرور', titleEn: 'Your password was changed',
      bodyAr: `تغيّرت كلمة المرور للحساب <b dir="ltr">${esc(username)}</b> للتو.`,
      bodyEn: `The password for the account <b>${esc(username)}</b> was just changed.`,
      footAr: 'إن لم تكن أنت، فتواصل فورًا مع مدير حساب شركتك أو مع support@amantrack.com.',
      footEn: 'If this was not you, contact your company administrator or support@amantrack.com right away.'
    })
  }),
  newDevice: ({ username, when }) => ({
    subject: 'تسجيل الدخول من جهاز جديد | Sign-in from a new device',
    html: layout({
      titleAr: 'جهاز جديد على حسابك', titleEn: 'New device on your account',
      bodyAr: `سُجّل جهاز جديد على الحساب <b dir="ltr">${esc(username)}</b> بتاريخ <span dir="ltr">${esc(when)}</span> (توقيت UTC).`,
      bodyEn: `A new device was registered on the account <b>${esc(username)}</b> on ${esc(when)} (UTC).`,
      footAr: 'إن لم تكن أنت، فاطلب من مدير حساب شركتك تحرير الجهاز وتغيير كلمة المرور.',
      footEn: 'If this was not you, ask your company administrator to release the device and change your password.'
    })
  })
};

let _fetch = (...a) => fetch(...a);
export function _setMailFetchForTests(f) { _fetch = f; }

// Sends one message; returns true on success. Never throws, so a mail outage does not break the action.
export async function sendMail(to, { subject, html }) {
  if (!to || !mailEnabled()) return false;
  try {
    const r = await _fetch(RESEND_URL(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to], subject, html })
    });
    if (!r.ok) { console.error('Resend error', r.status, (await r.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error('Resend unreachable', e?.message);
    return false;
  }
}

// ---------- one-time links ----------
export const LINK_MINUTES = { invite: 7 * 24 * 60, reset: 60, verify_email: 3 * 24 * 60 };
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export function newToken() { return crypto.randomBytes(32).toString('base64url'); }
export function linkFor(token) { return `${APP_URL()}/account?t=${encodeURIComponent(token)}`; }

export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
export const normEmail = (e) => String(e || '').trim().toLowerCase();
