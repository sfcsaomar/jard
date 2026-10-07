// The main paths in a real browser (Chromium through Playwright), against tests/lib/server.mjs:
//   provider panel → company + company admin by invitation → company panel → project + field user
//   → field user activates → phone app: sign in, add an asset with a photo, sync, export
//   → the app opens again with no network (offline cache) and still shows the asset.
// Any JavaScript error on any page fails the test. Screenshots go to tests/out/ for review.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/server.mjs';
import { ok, finish, client } from './lib/check.mjs';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const SRV = await startServer({ port: 8903 });
const B = SRV.url;
const { sql, mails } = client(B);
const link = async (to) => {
  const m = (await mails()).filter((x) => x.to[0] === to).pop();
  return m?.html.match(/(\/account\?t=[A-Za-z0-9_-]+)/)?.[1];
};

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return page;
};
const shot = (page, name, full = false) => page.screenshot({ path: OUT + name + '.png', fullPage: full });

try {
  // ---------- provider panel ----------
  const desk = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const admin = watch(await desk.newPage(), 'admin');
  await admin.goto(B + '/admin');
  await shot(admin, 'admin-login');
  await admin.fill('#adminPass', 'emergency-pass-123');
  await admin.click('#loginForm button');
  await admin.waitForSelector('#appView', { state: 'visible' });
  ok(await admin.isVisible('#emgCard'), 'emergency sign-in shows the warning card');
  await admin.click('#newSuperBtn');
  await admin.fill('#s_username', 'omar'); await admin.fill('#s_display', 'عمر'); await admin.fill('#s_email', 'omar@example.com');
  await admin.click('#supForm button[type=submit]');
  await admin.waitForTimeout(600);
  ok((await admin.innerText('#superBody')).includes('بانتظار التفعيل'), 'provider account waits for activation');

  // activate from the email link
  const acc = watch(await desk.newPage(), 'account');
  await acc.goto(B + await link('omar@example.com'));
  await acc.waitForSelector('#p1');
  ok(!acc.url().includes('t='), 'link token removed from the address bar');
  await shot(acc, 'account-activate');
  await acc.fill('#p1', 'omarpass12345'); await acc.fill('#p2', 'omarpass12345'); await acc.click('#b');
  await acc.waitForTimeout(500);
  ok((await acc.innerText('#view')).includes('تم تفعيل حسابك'), 'provider account activated');

  await admin.click('#logoutBtn');
  await admin.fill('#adminUser', 'omar'); await admin.fill('#adminPass', 'omarpass12345'); await admin.click('#loginForm button');
  await admin.waitForSelector('#appView', { state: 'visible' });
  await admin.waitForTimeout(400);
  ok(await admin.isHidden('#noticeCard'), 'provider signs in with own account');

  // company and its admin
  await admin.click('#newCoBtn'); await admin.fill('#c_name', 'شركة الاختبار'); await admin.click('#coForm button[type=submit]');
  await admin.waitForSelector('#adModal.open');
  await admin.fill('#a_username', 'co.admin'); await admin.fill('#a_email', 'co@acme.com');
  await admin.click('#adForm button[type=submit]');
  await admin.waitForTimeout(700);
  ok((await sql("select count(*) n from companies"))[0].n == 1, 'company created');
  await shot(admin, 'admin-panel', true);

  // ---------- company panel ----------
  const co = watch(await desk.newPage(), 'company');
  await co.goto(B + await link('co@acme.com'));
  await co.waitForSelector('#p1');
  await co.fill('#p1', 'copass123'); await co.fill('#p2', 'copass123'); await co.click('#b');
  await co.waitForTimeout(400);
  await co.click('text=تسجيل الدخول');
  await co.waitForSelector('#lg_user');
  await shot(co, 'company-login');
  await co.fill('#lg_user', 'co.admin'); await co.fill('#lg_pass', 'copass123'); await co.click('#loginBtn');
  await co.waitForSelector('#appView', { state: 'visible' });
  await co.click('[data-tab=projects]'); await co.click('#newProjBtn'); await co.fill('#p_name', 'HQ'); await co.click('#projForm button[type=submit]');
  await co.waitForSelector('#catModal.open'); await co.click('#catModal [data-close]');
  await co.click('[data-tab=users]'); await co.click('#newUserBtn');
  await co.fill('#u_username', 'walker'); await co.fill('#u_email', 'walker@acme.com');
  await co.click('#userForm button[type=submit]');
  await co.waitForTimeout(700);
  ok((await co.innerText('#userBody')).includes('walker'), 'field user invited');
  await shot(co, 'company-users', true);

  const w = watch(await desk.newPage(), 'account2');
  await w.goto(B + await link('walker@acme.com'));
  await w.waitForSelector('#p1');
  await w.fill('#p1', 'walkpass123'); await w.fill('#p2', 'walkpass123'); await w.click('#b');
  await w.waitForTimeout(400);

  // ---------- field app on a phone ----------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, serviceWorkers: 'allow' });
  const app = watch(await phone.newPage(), 'app');
  await app.goto(B + '/');
  await app.waitForSelector('#lg_user', { state: 'visible' });
  await shot(app, 'app-login');
  await app.fill('#lg_user', 'walker'); await app.fill('#lg_pass', 'walkpass123'); await app.click('#loginBtn');
  await app.waitForSelector('#loginScreen.hidden', { state: 'attached' });
  await app.waitForTimeout(800);
  await shot(app, 'app-home');

  await app.click('#addBtn');
  await app.waitForSelector('#formSheet.open');
  await app.fill('#f_tag', 'A-0001');
  const [chooser] = await Promise.all([app.waitForEvent('filechooser'), app.click('#photoGrid .photo-slot')]);
  await chooser.setFiles(PHOTO);
  await app.waitForSelector('#photoGrid img');
  await app.fill('#f_name', 'طاولة اجتماعات');
  await shot(app, 'app-form');
  await app.click('#saveBtn');
  await app.waitForTimeout(800);
  ok((await app.innerText('#assetCount')) === '1', 'asset saved on the phone');

  // sync reaches the server (assets and the photo)
  let synced = 0;
  for (let i = 0; i < 20 && !synced; i++) {
    await app.waitForTimeout(500);
    synced = Number((await sql("select count(*) n from assets where tag = 'A-0001'"))[0].n);
  }
  ok(synced === 1, 'asset synced to the server');

  const [download] = await Promise.all([app.waitForEvent('download', { timeout: 20000 }), app.click('#exportBtn')]);
  const zipBytes = fs.readFileSync(await download.path());
  ok(zipBytes.subarray(0, 2).toString() === 'PK' && zipBytes.includes(Buffer.from('data.json')) && zipBytes.length > 20000, 'export downloads a zip with the data and the photo');

  // ---------- offline ----------
  await app.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await app.evaluate(() => !!navigator.serviceWorker.controller))) { await app.reload(); await app.waitForTimeout(800); }
  await app.waitForTimeout(800); // let the offline cache finish filling
  await phone.setOffline(true);
  await app.reload();
  await app.waitForTimeout(1200);
  ok(await app.isHidden('#loginScreen'), 'offline: app opens without signing in again');
  ok((await app.innerText('#assetCount')) === '1' && (await app.innerText('#listWrap')).includes('A-0001'), 'offline: saved asset still listed');
  const styled = await app.evaluate(() => getComputedStyle(document.querySelector('.topbar-row')).backgroundColor);
  ok(styled === 'rgb(1, 52, 90)', 'offline: styles load (navy top bar)');
  await shot(app, 'app-offline');
  await phone.setOffline(false);

  // ---------- forgot password page ----------
  const fp = watch(await desk.newPage(), 'forgot');
  await fp.goto(B + '/account');
  await fp.waitForSelector('#ident');
  await shot(fp, 'account-forgot');
  await fp.goto(B + '/account?t=bogus');
  await fp.waitForTimeout(400);
  ok((await fp.innerText('h2')).includes('غير صالح'), 'bad link explained');
} catch (e) {
  ok(false, 'browser flow stopped: ' + (e?.message || e).split('\n')[0]);
} finally {
  ok(errors.length === 0, 'no JavaScript errors on any page' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  await SRV.close();
  finish();
}
