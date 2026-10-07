// Database rules, straight against the migrations (no server): licence limits, devices,
// usage, locks, legacy import, email tokens, photo storage queries and access rights.
import { freshDb, callRpc } from './lib/db.mjs';
import { ok, finish } from './lib/check.mjs';

const db = await freshDb();
const c = (fn, a) => callRpc(db, fn, a);
const fails = async (p) => { try { await p; return ''; } catch (e) { return e.message || 'error'; } };

// ---------- companies, projects, accounts ----------
await c('co_save', { p: { id: 'co1', customer: 'Acme', max_users: 2, max_devices_per_user: 1 } });
await c('proj_save', { p: { id: 'pr1', company_id: 'co1', name: 'HQ' } });
const mk = (u, role, extra = {}) => c('acct_save', { p: { username: u, role, company_id: role === 'super' ? null : 'co1', project_id: role === 'user' ? 'pr1' : null, salt: 's', hash: 'h', ...extra } });
await mk('a1', 'admin'); await mk('u1', 'user'); await mk('u2', 'user');
ok((await fails(mk('u3', 'user'))).includes('user_limit'), 'field users capped by the licence');
await mk('u2', 'user', { display_name: 'edit ok' });
ok((await c('acct_get', { p_username: 'U2' })).display_name === 'edit ok', 'editing an existing user is not blocked by the cap; usernames are case-insensitive');
ok((await mk('boss', 'super')).role === 'super' && (await c('acct_list', { p_company: null })).length === 1, 'provider account has no company');
ok((await fails(mk('bad', 'super', { company_id: 'co1' }))) !== '', 'provider account with a company is rejected');

// ---------- devices ----------
const reg = (d) => c('acct_register_device', { p_username: 'u1', p_device: d, p_max: 1 });
ok((await reg('d1')) === 'ok' && (await reg('d1')) === 'ok' && (await reg('d2')) === 'limit', 'device limit per user');
await c('acct_seen', { p_username: 'u1', p_device: 'd1', p_login: true });
const u1 = await c('acct_get', { p_username: 'u1' });
ok(!!u1.device_info.d1.lastSeen && !!u1.last_login, 'last seen and last login recorded');
await c('acct_remove_device', { p_username: 'u1', p_device: 'd1' });
ok((await c('acct_get', { p_username: 'u1' })).devices.length === 0, 'device released');

// ---------- AI usage and sign-in locks ----------
ok((await c('usage_add', { p_company: 'co1', p_month: '2026-10', p_in: 10, p_out: 2 })) === 1 && (await c('usage_add', { p_company: 'co1', p_month: '2026-10', p_in: 10, p_out: 2 })) === 2, 'AI usage counts up');
const usage = await c('usage_get', { p_company: 'co1', p_month: '2026-10' });
ok(usage.count === 2 && usage.inputTokens === 20 && usage.outputTokens === 4, 'AI usage totals');
for (let i = 0; i < 5; i++) await c('lock_fail', { p_key: 'k', p_max: 5, p_minutes: 15 });
ok((await c('lock_check', { p_key: 'k' })) === 15, 'lock after 5 failures, 15 minutes');
await c('lock_clear', { p_key: 'k' });
ok((await c('lock_check', { p_key: 'k' })) === 0, 'lock cleared');
ok((await c('co_delete', { p_id: 'co1' })) === 'has_users', 'company with users cannot be deleted');

// ---------- one-time import of the old store ----------
const imp = {
  companies: [{ id: 'old', customer: 'Legacy', max_users: 1 }, { id: 'co1', customer: 'SHOULD NOT OVERWRITE' }],
  projects: [{ id: 'op', company_id: 'old', name: 'Default' }],
  accounts: [{ username: 'l1', role: 'user', company_id: 'old', project_id: 'op', salt: 'x', hash: 'y' }, { username: 'l2', role: 'user', company_id: 'old', project_id: 'ghost', salt: 'x', hash: 'y' }],
  usage: [{ company_id: 'old', month: '2026-09', count: 7 }]
};
const first = await c('import_legacy', { p: imp });
const again = await c('import_legacy', { p: imp });
ok(first.companies === 1 && first.accounts === 2 && first.projects === 1 && first.usage === 1, 'legacy import inserts new rows only (and ignores the user cap)');
ok(again.companies === 0 && again.accounts === 0, 'legacy import twice is harmless');
ok((await c('co_get', { p_id: 'co1' })).customer === 'Acme', 'import never overwrites');
ok((await c('acct_get', { p_username: 'l2' })).project_id == null, 'import drops a missing project');
ok((await c('proj_save', { p: { id: 'op', company_id: 'co1', name: 'HACK' } })) === null && (await c('proj_get', { p_company: 'old', p_id: 'op' })).name === 'Default', 'a project cannot be taken over by another company');

// ---------- email and one-time links ----------
await c('co_save', { p: { id: 'co2', customer: 'B', max_users: 5 } });
const a = await c('acct_save', { p: { username: 'm1', role: 'admin', company_id: 'co2', salt: 's', hash: 'h', email: 'Ali@X.com', needs_password: true } });
ok(a.email === 'ali@x.com' && a.needs_password === true, 'email stored lower-case');
ok((await fails(c('acct_save', { p: { username: 'm2', role: 'admin', company_id: 'co2', salt: 's', hash: 'h', email: 'ali@x.com' } }))) !== '', 'one email per account');
ok((await c('acct_by_email', { p_email: ' ALI@x.com ' })).username === 'm1', 'find account by email');
await c('tok_create', { p_hash: 'h1', p_username: 'm1', p_purpose: 'invite', p_email: 'ali@x.com', p_minutes: 60 });
const peek = await c('tok_peek', { p_hash: 'h1' });
ok(peek.purpose === 'invite' && peek.username === 'm1', 'link can be read');
ok((await c('tok_consume', { p_hash: 'h1', p_purpose: 'reset' })) === null, 'link only works for its purpose');
ok((await c('tok_consume', { p_hash: 'h1', p_purpose: 'invite' }))?.username === 'm1' && (await c('tok_consume', { p_hash: 'h1', p_purpose: 'invite' })) === null, 'link works once');
await c('tok_create', { p_hash: 'r1', p_username: 'm1', p_purpose: 'reset', p_email: null, p_minutes: 60 });
await c('tok_create', { p_hash: 'r2', p_username: 'm1', p_purpose: 'reset', p_email: null, p_minutes: 60 });
ok((await c('tok_peek', { p_hash: 'r1' })) === null && !!(await c('tok_peek', { p_hash: 'r2' })), 'a new link cancels the older one');
await c('tok_create', { p_hash: 'x1', p_username: 'm1', p_purpose: 'verify_email', p_email: 'ali@x.com', p_minutes: -1 });
ok((await c('tok_peek', { p_hash: 'x1' })) === null, 'expired link refused');

// ---------- photo storage ----------
await db.exec(`insert into storage.objects (bucket_id, name, metadata) values
  ('photos','co2/a.jpg','{"size":1000}'),('photos','co2/t/a.jpg','{"size":100}'),('photos','gone/b.jpg','{"size":5000}'),('other','co2/z','{"size":9}')`);
const st = await c('storage_usage', {});
ok(st.bytes === 6100 && st.files === 3 && st.orphanFiles === 1, 'storage usage counts only the photos bucket and finds orphans');
ok(JSON.stringify(await c('photo_paths', { p_company: null, p_limit: 100 })) === '["gone/b.jpg"]', 'orphan photos listed');
ok((await c('photo_paths', { p_company: 'co2', p_limit: 100 })).length === 2, 'company photos listed');
await db.exec(`insert into assets (uid, company_id, project_id, username, client_updated_at) values ('as1','co2','px','x', now())`);
await c('acct_delete', { p_username: 'm1' });
ok(Number((await db.query('select count(*) n from auth_tokens')).rows[0].n) === 0, 'deleting an account deletes its links');
ok((await c('co_delete', { p_id: 'co2' })) === 'ok' && Number((await db.query('select count(*) n from assets')).rows[0].n) === 0, 'deleting a company deletes its assets');

// ---------- access rights: only the server key may use the database ----------
for (const role of ['anon', 'authenticated']) {
  const r = (await db.query(`select has_function_privilege('${role}','public.acct_get(text)','execute') f1,
    has_function_privilege('${role}','public.tok_consume(text,text)','execute') f2,
    has_table_privilege('${role}','public.accounts','select') t1, has_table_privilege('${role}','public.auth_tokens','select') t2,
    has_table_privilege('${role}','public.assets','select') t3`)).rows[0];
  ok(!r.f1 && !r.f2 && !r.t1 && !r.t2 && !r.t3, `${role} cannot read accounts, links or assets`);
}
const rls = (await db.query(`select count(*) filter (where not relrowsecurity) n from pg_class where relnamespace='public'::regnamespace and relkind='r'`)).rows[0];
ok(Number(rls.n) === 0, 'row-level security on every table');

finish();
