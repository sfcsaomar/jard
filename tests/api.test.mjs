// Server functions end to end: legacy import, logins, licences, companies, projects, sync, locks.
// Runs against tests/lib/server.mjs (local copy of the site; no live services).
import { startServer } from './lib/server.mjs';
import { ok, finish, client } from './lib/check.mjs';

const SRV = await startServer({ port: 8901, legacy: true });
const B = SRV.url;
const { post, sql, mails } = client(B);
let h = await (await fetch(B + '/api/health')).json();
ok(h.db && h.accounts, 'health: db + legacy import done ' + JSON.stringify(h));
const counts = await sql("select (select count(*) from companies) c, (select count(*) from accounts) a, (select count(*) from projects) p, (select count from ai_usage where company_id='old1') u");
ok(counts[0].c == 1 && counts[0].a == 3 && counts[0].p == 1 && counts[0].u == 42, 'legacy rows imported ' + JSON.stringify(counts[0]));
const pw = await sql("select count(*) n from accounts where hash like '%oldpass%' or salt = ''");
ok(pw[0].n == 0, 'no plain passwords stored');

// Old field user keeps password, device and project settings.
let L = await post('/api/login', { username: 'old.user', password: 'oldpass123', deviceId: 'devOld' });
ok(L.ok && L.license.projectName === 'مشروع قديم' && L.license.settings.minPhotos === 2 && L.license.categories.length === 1, 'legacy field user logs in with old password');
let r = await post('/api/refresh', { deviceId: 'devOld' }, L.token);
ok(r.ok, 'legacy token refresh');
let L2 = await post('/api/login', { username: 'old.user', password: 'oldpass123', deviceId: 'devNew' });
ok(!L2.ok && L2.code === 'device_limit', 'legacy device limit kept');

// Old company admin.
let C = await post('/api/company', { action: 'login', username: 'old.admin', password: 'oldadmin123' });
ok(C.ok, 'legacy company admin logs in');
let o = await post('/api/company', { action: 'overview' }, C.token);
ok(o.ok && o.company.usage.count === 42 && o.users.length === 2, 'company overview from DB');
r = await post('/api/company', { action: 'saveUser', user: { username: 'new.one', password: 'newpass123', projectId: 'pold' } }, C.token);
ok(!r.ok && r.code === 'user_limit', 'user limit enforced by DB: ' + r.message);

// Provider panel: emergency, create account, account login.
let A = await post('/api/admin', { action: 'login', username: '', password: 'wrong-password' }, null, '9.9.9.9');
ok(!A.ok && A.status === 401, 'wrong emergency password refused');
A = await post('/api/admin', { action: 'login', username: '', password: 'emergency-pass-123' });
ok(A.ok, 'emergency login');
o = await post('/api/admin', { action: 'overview' }, A.token);
ok(o.ok && o.me.emergency && o.superAdmins.length === 0 && o.companies.length === 1, 'overview in emergency mode');
r = await post('/api/admin', { action: 'updateMe', newPassword: 'x'.repeat(12) }, A.token);
ok(!r.ok && r.code === 'emergency', 'emergency cannot change "my" password');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', displayName: 'Omar', password: 'short', email: 'o@x.com' } }, A.token);
ok(!r.ok && r.code === 'weak_password', 'provider password min 10');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'old.user', password: 'superpass123', email: 'q@x.com' } }, A.token);
ok(!r.ok && r.code === 'username_taken', 'cannot take a field username');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', displayName: 'Omar', password: 'superpass123', email: 'o@x.com' } }, A.token);
ok(r.ok, 'provider account created');
let S = await post('/api/admin', { action: 'login', username: 'omar', password: 'superpass123' });
ok(S.ok, 'provider account login');
o = await post('/api/admin', { action: 'overview' }, S.token);
ok(o.ok && !o.me.emergency && o.me.username === 'omar', 'overview as omar');
r = await post('/api/admin', { action: 'deleteSuperAdmin', username: 'omar' }, S.token);
ok(!r.ok && r.code === 'self', 'cannot delete self');
r = await post('/api/admin', { action: 'updateMe', currentPassword: 'superpass123', newPassword: 'newsuperpass1' }, S.token);
ok(r.ok, 'change own password');
ok((await post('/api/admin', { action: 'login', username: 'omar', password: 'superpass123' })).status === 401, 'old password rejected');
S = await post('/api/admin', { action: 'login', username: 'omar', password: 'newsuperpass1' });
ok(S.ok, 'new password works');
r = await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'omar', active: false, email: 'o@x.com' } }, A.token);
ok(!r.ok && r.code === 'last_admin', 'cannot disable last provider admin');
let field = await post('/api/login', { username: 'omar', password: 'newsuperpass1', deviceId: 'x' });
ok(!field.ok && field.code === 'admin_account', 'provider account blocked from field app');
let cAs = await post('/api/company', { action: 'login', username: 'omar', password: 'newsuperpass1' });
ok(!cAs.ok, 'provider account blocked from company panel');

// Company lifecycle on the DB.
r = await post('/api/admin', { action: 'saveCompany', company: { customer: 'Acme', startsAt: '2026-10-06', months: 6, maxUsers: 2, maxDevicesPerUser: 1 } }, S.token);
ok(r.ok && r.company.company.expiresAt === '2027-04-05', 'company created ' + r.company?.company?.expiresAt);
const cid = r.company.company.id;
r = await post('/api/admin', { action: 'saveCompanyAdmin', admin: { companyId: cid, username: 'acme.admin', password: 'adminpass1', email: 'a@acme.com' } }, S.token);
ok(r.ok, 'company admin created');
C = await post('/api/company', { action: 'login', username: 'acme.admin', password: 'adminpass1' });
r = await post('/api/company', { action: 'saveProject', project: { name: 'HQ', settings: { lang: 'ar', required: ['category'], minPhotos: 1 } } }, C.token);
const pid = r.id;
r = await post('/api/company', { action: 'setCategories', projectId: pid, categories: [{ code: '1', name: 'أثاث', subs: [{ code: '11', name: 'كراسي' }] }] }, C.token);
ok(r.ok, 'categories saved');
for (const u of ['f1x', 'f2x']) await post('/api/company', { action: 'saveUser', user: { username: u, password: 'fieldpass1', projectId: pid } }, C.token);
r = await post('/api/company', { action: 'saveUser', user: { username: 'f3x', password: 'fieldpass1', projectId: pid } }, C.token);
ok(!r.ok && r.code === 'user_limit', 'limit on new company');
r = await post('/api/company', { action: 'saveUser', user: { username: 'f1x', displayName: 'renamed', projectId: pid } }, C.token);
ok(r.ok && r.user.displayName === 'renamed', 'editing an existing user at the limit still works');
// Concurrency: two parallel creations against 1 free slot after deleting one.
await post('/api/company', { action: 'deleteUser', username: 'f2x' }, C.token);
const par = await Promise.all(['p1x', 'p2x', 'p3x'].map((u) => post('/api/company', { action: 'saveUser', user: { username: u, password: 'fieldpass1', projectId: pid } }, C.token)));
ok(par.filter((x) => x.ok).length === 1, 'parallel creations: exactly one succeeds (' + par.map((x) => x.ok).join(',') + ')');
r = await post('/api/company', { action: 'saveUser', user: { username: 'old.user', password: 'fieldpass1', projectId: pid } }, C.token);
ok(!r.ok && r.code === 'username_taken', 'cannot take another company\'s username');

let F = await post('/api/login', { username: 'f1x', password: 'fieldpass1', deviceId: 'dA' });
ok(F.ok && F.license.categories[0].subs[0].name === 'كراسي' && F.license.sync, 'field login on new company');
const parDev = await Promise.all(['dB', 'dC'].map((d) => post('/api/login', { username: 'f1x', password: 'fieldpass1', deviceId: d })));
ok(parDev.every((x) => !x.ok && x.code === 'device_limit'), 'device limit (atomic)');
o = await post('/api/company', { action: 'overview' }, C.token);
const dev = o.users.find((u) => u.username === 'f1x').devices[0];
ok(dev.id === 'dA' && dev.lastSeen, 'device lastSeen recorded');
r = await post('/api/company', { action: 'removeDevice', username: 'f1x', deviceId: 'dA' }, C.token);
ok((await post('/api/refresh', { deviceId: 'dA' }, F.token)).code === 'device_unknown', 'released device locked out');

// Sync still works on top.
F = await post('/api/login', { username: 'f1x', password: 'fieldpass1', deviceId: 'dB' });
r = await post('/api/sync', { action: 'push', deviceId: 'dB', assets: [{ uid: 'abcdef1234567890', tag: 'T-1', createdAt: Date.now(), updatedAt: Date.now(), photos: [], data: { name: 'x' } }] }, F.token);
ok(r.ok, 'sync push');
o = await post('/api/company', { action: 'overview' }, C.token);
ok(o.projects[0].assetCount === 1, 'asset count');

r = await post('/api/admin', { action: 'renewCompany', id: cid, months: 3 }, S.token);
ok(r.ok && r.expiresAt === '2027-07-05', 'renew');
r = await post('/api/admin', { action: 'deleteCompany', id: cid }, S.token);
ok(!r.ok && r.code === 'has_users', 'cannot delete company with users');
await post('/api/admin', { action: 'saveCompany', company: { id: cid, customer: 'Acme', startsAt: '2026-10-06', months: 6, maxUsers: 2, active: false } }, S.token);
ok((await post('/api/company', { action: 'overview' }, C.token)).code === 'company_disabled', 'disabled company blocks admin');
ok((await post('/api/refresh', { deviceId: 'dB' }, F.token)).code === 'license_disabled', 'disabled company blocks field user');

// Brute-force lock on field login (5 wrong tries).
for (let i = 0; i < 5; i++) await post('/api/login', { username: 'old.user', password: 'bad', deviceId: 'devOld' });
ok((await post('/api/login', { username: 'old.user', password: 'oldpass123', deviceId: 'devOld' })).code === 'locked', 'field login lock');
// Admin IP lock.
for (let i = 0; i < 5; i++) await post('/api/admin', { action: 'login', username: 'omar', password: 'bad' }, null, '7.7.7.7');
ok((await post('/api/admin', { action: 'login', username: 'omar', password: 'newsuperpass1' }, null, '7.7.7.7')).code === 'admin_locked', 'admin IP lock');
ok((await post('/api/admin', { action: 'login', username: 'omar', password: 'newsuperpass1' }, null, '8.8.8.8')).ok, 'other IP unaffected');

// Import is one-time: re-running does nothing.
const metaRows = await sql("select value->'counts' c from meta where key='legacy_import'");
ok(metaRows[0].c.accounts === 3, 'meta records import ' + JSON.stringify(metaRows[0].c));

await SRV.close();
finish();
