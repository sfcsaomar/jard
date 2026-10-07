// v2.5 server side: dashboard numbers, Claude spend and balance, and English error messages.
import { startServer } from './lib/server.mjs';
import { ok, finish, client } from './lib/check.mjs';
import { toEnglish } from '../netlify/lib/messages-en.mjs';

const SRV = await startServer({ port: 8904 });
const { post, sql } = client(SRV.url);

const E = await post('/api/admin', { action: 'login', username: '', password: 'emergency-pass-123' });
ok(E.ok, 'emergency sign-in');

// ---------- English messages ----------
const bad = await post('/api/admin', { action: 'login', username: 'nobody', password: 'x' });
ok(bad.message === 'اسم المستخدم أو كلمة المرور غير صحيحة' && bad.messageEn === 'Wrong username or password', 'errors carry Arabic and English');
ok(toEnglish('محاولات خاطئة كثيرة. حاول بعد 12 دقيقة') === 'Too many wrong attempts. Try again in 12 minutes', 'numbers carried into the English message');
const fp = await post('/api/account', { action: 'requestReset', identifier: 'nobody' });
ok(fp.ok && /confirmed email/.test(fp.messageEn), 'success messages carry English too');

// ---------- dashboard numbers ----------
const co = await post('/api/admin', { action: 'saveCompany', company: { customer: 'Dash Co', maxUsers: 5 } }, E.token);
const cid = co.company.company.id;
await sql(`insert into assets (uid, company_id, project_id, username, created_at, client_updated_at) values
  ('d1','${cid}','p1','u1', now(), now()), ('d2','${cid}','p1','u1', now() - interval '2 days', now()),
  ('d3','${cid}','p1','u2', now() - interval '40 days', now())`);
await sql(`insert into ai_usage (company_id, month, count, input_tokens, output_tokens) values ('${cid}', to_char(now(), 'YYYY-MM'), 7, 1000, 100)`);
const d = await post('/api/admin', { action: 'dashboard' }, E.token);
ok(d.ok && d.activity.daily.length === 30, 'dashboard: 30 days of activity');
const pc = d.activity.perCompany.find((x) => x.companyId === cid);
ok(pc && pc.assets === 3 && pc.week === 2 && pc.today === 1, 'dashboard: per-company totals, week and today ' + JSON.stringify(pc));
ok(d.activity.daily.reduce((n, x) => n + x.assets, 0) === 2, 'dashboard: daily chart covers the last 30 days only');
ok(d.activity.aiMonths.at(-1).count === 7, 'dashboard: AI requests per month');

// ---------- Claude spend ----------
ok(d.claude.configured && d.claude.monthUsd > 0 && d.claude.daily.length >= 1, 'Claude: spend read from the cost report ' + JSON.stringify({ m: d.claude.monthUsd, n: d.claude.daily.length }));
ok(d.claude.daily.every((x) => x.usd === 1.5), 'Claude: cents converted to dollars per day');
ok(d.claude.balance === null && d.claude.remainingUsd === undefined, 'Claude: no balance until one is entered');

const threeDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
let r = await post('/api/admin', { action: 'setClaudeBalance', usd: 50, date: threeDaysAgo, warnUsd: 46 }, E.token);
ok(!r.ok && r.code === 'emergency', 'balance cannot be set from the emergency sign-in');
await post('/api/admin', { action: 'saveSuperAdmin', admin: { username: 'boss', email: 'boss@example.com', password: 'bosspassword1' } }, E.token);
const B = await post('/api/admin', { action: 'login', username: 'boss', password: 'bosspassword1' });
r = await post('/api/admin', { action: 'setClaudeBalance', usd: 'abc' }, B.token);
ok(!r.ok && r.code === 'bad_amount' && r.messageEn, 'invalid amount refused');
r = await post('/api/admin', { action: 'setClaudeBalance', usd: 50, date: threeDaysAgo, warnUsd: 46 }, B.token);
ok(r.ok && r.claude.sinceBalanceUsd === 4.5 && r.claude.remainingUsd === 45.5, 'remaining = balance − spend since its date ' + JSON.stringify({ s: r.claude.sinceBalanceUsd, rem: r.claude.remainingUsd }));
ok(r.claude.low === true, 'low-balance warning');

// cached for 15 minutes; fresh=true asks Anthropic again
const cache = await sql("select value->>'at' ts from meta where key='claude_cost_cache'");
ok(!!cache[0]?.ts, 'spend cached');
r = await post('/api/admin', { action: 'claude', fresh: true }, B.token);
ok(r.ok && r.claude.remainingUsd === 45.5, 'fresh update');

// a wrong admin key is reported, not thrown
process.env.ANTHROPIC_ADMIN_KEY = 'test-admin-key-wrong-00000000000';
r = await post('/api/admin', { action: 'claude', fresh: true }, B.token);
ok(r.ok && r.claude.error === 'bad_key', 'wrong admin key reported as bad_key');
delete process.env.ANTHROPIC_ADMIN_KEY;
r = await post('/api/admin', { action: 'claude' }, B.token);
ok(r.ok && r.claude.configured === false && r.claude.balance.usd === 50, 'without the key: not configured, balance kept');

// company admins and field users cannot reach these actions
const noTok = await post('/api/admin', { action: 'dashboard' });
ok(noTok.status === 401, 'dashboard needs a provider session');

await SRV.close();
finish();
