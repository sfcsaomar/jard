// Email on accounts: invitations, password reset, email confirmation, notices, photo cleanup.
// Runs against tests/lib/server.mjs (local copy of the site; no live services).
import { startServer } from './lib/server.mjs';
import { ok, finish, client } from './lib/check.mjs';

const SRV = await startServer({ port: 8902, legacy: false });
const B = SRV.url;
const { post, sql, mails } = client(B);
const lastLink = async (to) => { const m = (await mails()).filter((x) => x.to[0] === to).pop(); const t = m?.html.match(/\/account\?t=([A-Za-z0-9_-]+)/); return { m, token: t && t[1] }; };

// Emergency → create provider account by invite.
const E = await post('/api/admin', { action: 'login', username: '', password: 'emergency-pass-123' });
let r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', displayName: 'عمر' } }, E.token);
ok(!r.ok && r.code === 'email_required', 'provider needs email');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', email: 'not-an-email' } }, E.token);
ok(!r.ok && r.code === 'bad_email', 'email format checked');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', displayName: 'عمر', email: 'Omar@Example.com' } }, E.token);
ok(r.ok && r.invite?.sent && r.admin.pending && r.admin.email === 'omar@example.com', 'provider invited by email');
let L = await post('/api/admin', { action: 'login', username: 'omar', password: 'whatever12345' });
ok(L.code === 'not_activated', 'pending account cannot sign in: ' + L.message);
let { m, token } = await lastLink('omar@example.com');
ok(m && /دعوة/.test(m.subject) && m.html.includes('dir="rtl"') && m.from.includes('support@amantrack.com'), 'invite email bilingual from support@');
let p = await post('/api/account', { action: 'peek', token });
ok(p.ok && p.purpose === 'invite' && p.username === 'omar' && p.minLength === 10, 'peek invite');
r = await post('/api/account', { action: 'setPassword', token, password: 'short' });
ok(r.code === 'weak_password', 'provider min 10 on activation');
r = await post('/api/account', { action: 'setPassword', token, password: 'omarpass12345' });
ok(r.ok && r.home === '/admin', 'activated via link');
ok((await post('/api/account', { action: 'setPassword', token, password: 'omarpass12345' })).code === 'bad_link', 'link works once');
const S = await post('/api/admin', { action: 'login', username: 'omar', password: 'omarpass12345' });
ok(S.ok, 'provider signs in');
let o = await post('/api/admin', { action: 'overview' }, S.token);
ok(o.me.emailVerified && !o.me.pending && o.mail === true && o.storage, 'email verified by activation; storage stats present');

// Company + admin invited, field user with and without email.
r = await post('/api/admin', { action: 'saveCompany', company: { customer: 'Acme', months: 12, maxUsers: 3 } }, S.token);
const cid = r.company.company.id;
r = await post('/api/admin', { action: 'saveCompanyAdmin', admin: { companyId: cid, username: 'acme.admin', password: 'adminpass1' } }, S.token);
ok(!r.ok && r.code === 'email_required', 'company admin needs email');
r = await post('/api/admin', { action: 'saveCompanyAdmin', admin: { companyId: cid, username: 'acme.admin', email: 'omar@example.com' } }, S.token);
ok(!r.ok && r.code === 'email_taken', 'duplicate email refused');
r = await post('/api/admin', { action: 'saveCompanyAdmin', admin: { companyId: cid, username: 'acme.admin', email: 'boss@acme.com' } }, S.token);
ok(r.ok && r.invite.sent, 'company admin invited');
({ token } = await lastLink('boss@acme.com'));
r = await post('/api/account', { action: 'setPassword', token, password: 'bosspass1' });
ok(r.ok && r.home === '/company', 'company admin activated → /company');
const C = await post('/api/company', { action: 'login', username: 'acme.admin', password: 'bosspass1' });
ok(C.ok, 'company admin signs in');
r = await post('/api/company', { action: 'saveProject', project: { name: 'HQ' } }, C.token);
const pid = r.id;
r = await post('/api/company', { action: 'saveUser', user: { username: 'noemail.user', projectId: pid } }, C.token);
ok(!r.ok && r.code === 'no_password', 'field user needs email or password');
r = await post('/api/company', { action: 'saveUser', user: { username: 'noemail.user', projectId: pid, password: 'fieldpass1' } }, C.token);
ok(r.ok && !r.invite && !r.user.email, 'field user without email (manual password)');
r = await post('/api/company', { action: 'saveUser', user: { username: 'field.mail', projectId: pid, email: 'f@acme.com' } }, C.token);
ok(r.ok && r.invite.sent && r.user.pending, 'field user invited');
// Mail outage: invitation still created and the link is handed back.
await fetch(B + '/__maildown?v=1');
r = await post('/api/company', { action: 'saveUser', user: { username: 'field.down', projectId: pid, email: 'down@acme.com' } }, C.token);
ok(r.ok && r.invite && r.invite.sent === false && r.invite.url.includes('/account?t='), 'mail down: link returned to admin');
await fetch(B + '/__maildown?v=0');
r = await post('/api/company', { action: 'resendInvite', username: 'field.down' }, C.token);
ok(r.ok && r.invite.sent, 'resend invitation');
const oldDown = r.invite.url;
r = await post('/api/company', { action: 'resendInvite', username: 'noemail.user' }, C.token);
ok(!r.ok && r.code === 'not_pending', 'cannot resend to active/no-email');

// Field user activates, signs in, second device → notice.
({ token } = await lastLink('f@acme.com'));
r = await post('/api/account', { action: 'setPassword', token, password: 'fieldpass2' });
ok(r.ok && r.home === '/', 'field activation → app');
await post('/api/admin', { action: 'saveCompany', company: { id: cid, customer: 'Acme', months: 12, maxUsers: 3, maxDevicesPerUser: 2 } }, S.token);
let F = await post('/api/login', { username: 'field.mail', password: 'fieldpass2', deviceId: 'd1' });
ok(F.ok, 'field sign in');
let before = (await mails()).length;
F = await post('/api/login', { username: 'field.mail', password: 'fieldpass2', deviceId: 'd2' });
let after = await mails();
ok(F.ok && after.length === before + 1 && /جهاز جديد/.test(after.at(-1).subject), 'new device notice');

// Forgot password flows.
before = (await mails()).length;
r = await post('/api/account', { action: 'requestReset', identifier: 'nobody' });
ok(r.ok && (await mails()).length === before, 'unknown account: generic reply, no mail');
r = await post('/api/account', { action: 'requestReset', identifier: 'noemail.user' });
ok(r.ok && (await mails()).length === before, 'no email: generic reply, no mail');
r = await post('/api/account', { action: 'requestReset', identifier: 'F@ACME.com' }, null, '5.5.5.5');
({ m, token } = await lastLink('f@acme.com'));
ok(r.ok && /إعادة تعيين/.test(m.subject), 'reset by email');
p = await post('/api/account', { action: 'peek', token });
ok(p.purpose === 'reset' && p.minLength === 8, 'peek reset');
before = (await mails()).length;
r = await post('/api/account', { action: 'setPassword', token, password: 'newfield99' });
after = await mails();
ok(r.ok && /تغيير كلمة المرور/.test(after.at(-1).subject), 'reset done + changed notice');
ok((await post('/api/login', { username: 'field.mail', password: 'newfield99', deviceId: 'd1' })).ok, 'new password works');
ok((await post('/api/login', { username: 'field.mail', password: 'fieldpass2', deviceId: 'd1' })).code === 'bad_credentials', 'old password gone');
// Pending account asking for reset gets the invitation again (old link revoked).
r = await post('/api/account', { action: 'requestReset', identifier: 'field.down' }, null, '6.6.6.6');
({ token } = await lastLink('down@acme.com'));
ok(r.ok && (await post('/api/account', { action: 'peek', token })).purpose === 'invite', 'pending account: reset request resends invite');
ok((await post('/api/account', { action: 'peek', token: oldDown.split('t=')[1] })).code === 'bad_link', 'older invite revoked');
// Rate limit: 3 per account per hour.
before = (await mails()).length;
for (let i = 0; i < 5; i++) await post('/api/account', { action: 'requestReset', identifier: 'acme.admin' }, null, '7.7.7.' + i);
ok((await mails()).length - before === 3, 'reset limited to 3 per account per hour');
// Expired token.
await sql("update auth_tokens set expires_at = now() - interval '1 minute' where purpose='invite' and username='field.down'");
ok((await post('/api/account', { action: 'peek', token })).code === 'bad_link', 'expired link refused');

// Email change → verification; my account.
r = await post('/api/company', { action: 'updateMe', email: '' }, C.token);
ok(r.code === 'email_required', 'company admin cannot drop email');
r = await post('/api/company', { action: 'updateMe', email: 'new.boss@acme.com' }, C.token);
ok(r.ok && r.verifySent && !r.me.emailVerified, 'email change → verify sent, unverified');
({ token } = await lastLink('new.boss@acme.com'));
r = await post('/api/account', { action: 'verifyEmail', token });
ok(r.ok && r.email === 'new.boss@acme.com', 'email verified');
o = await post('/api/company', { action: 'overview' }, C.token);
ok(o.me.emailVerified, 'verified shows in panel');
// Verify link becomes useless if the email changed again.
await post('/api/company', { action: 'updateMe', email: 'third@acme.com' }, C.token);
({ token } = await lastLink('third@acme.com'));
await post('/api/company', { action: 'updateMe', email: 'fourth@acme.com' }, C.token);
r = await post('/api/account', { action: 'peek', token });
ok(!r.ok, 'stale verify link (superseded) refused');
// Admin resets a user password manually → notice to verified email.
before = (await mails()).length;
r = await post('/api/company', { action: 'saveUser', user: { username: 'field.mail', projectId: pid, email: 'f@acme.com', password: 'adminset88' } }, C.token);
ok(r.ok && (await mails()).length === before + 1, 'admin-set password → notice');

// Photos: sync upload then company deletion cleans storage; orphan cleanup.
F = await post('/api/login', { username: 'field.mail', password: 'adminset88', deviceId: 'd1' });
const h = 'a'.repeat(64);
r = await post('/api/sync', { action: 'sign', deviceId: 'd1', photos: [h], thumbs: [h] }, F.token);
for (const u of r.uploads) await fetch(u.url, { method: 'PUT', body: 'x'.repeat(500) });
await sql("insert into storage.objects (bucket_id, name, metadata) values ('photos','deadco/x.jpg','{\"size\":7}')");
o = await post('/api/admin', { action: 'overview' }, S.token);
ok(o.storage.files === 3 && o.storage.orphanFiles === 1 && o.storage.bytes === 1007, 'storage usage ' + JSON.stringify(o.storage));
r = await post('/api/admin', { action: 'cleanupPhotos' }, S.token);
ok(r.ok && r.deleted === 1, 'orphan cleanup');
for (const u of ['field.mail', 'noemail.user', 'field.down', 'acme.admin']) await post('/api/admin', { action: 'deleteUser', companyId: cid, username: u }, S.token);
r = await post('/api/admin', { action: 'deleteCompany', id: cid }, S.token);
ok(r.ok && r.photosDeleted === 2, 'company delete removes its photos');
o = await post('/api/admin', { action: 'overview' }, S.token);
ok(o.storage.files === 0, 'storage empty');
const k = await (await fetch(B + '/api/keepalive', { method: 'POST' })).text();
ok(k === 'ok', 'keep-alive runs');
const tok = await sql('select count(*) n, count(*) filter (where length(token_hash)=64) h from auth_tokens');
ok(tok[0].n === tok[0].h, 'only token hashes stored');

await SRV.close();
finish();
