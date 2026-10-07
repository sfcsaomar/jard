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
  ok((await admin.innerText('#notices')).includes('الطوارئ'), 'emergency sign-in shows the warning');
  ok(admin.url().endsWith('#providers') || await admin.isVisible('[data-page=providers]'), 'emergency sign-in opens the providers page');
  await admin.click('#nav a[data-route=providers]');
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
  ok((await admin.locator('#notices .notice').count()) === 0, 'provider signs in with own account (no warnings)');

  // company and its admin
  await admin.click('#nav a[data-route=companies]');
  await admin.click('#newCoBtn'); await admin.fill('#c_name', 'شركة الاختبار'); await admin.click('#coForm button[type=submit]');
  await admin.waitForSelector('#adModal.open');
  await admin.fill('#a_username', 'co.admin'); await admin.fill('#a_email', 'co@acme.com');
  await admin.click('#adForm button[type=submit]');
  await admin.waitForTimeout(700);
  ok((await sql("select count(*) n from companies"))[0].n == 1, 'company created');
  ok(admin.url().includes('#company/') && (await admin.innerText('#coDetail')).includes('co.admin'), 'new company opens on its own page with its admin');

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
  await co.click('#nav a[data-route=projects]'); await co.click('#newProjBtn'); await co.fill('#p_name', 'HQ'); await co.click('#projForm button[type=submit]');
  await co.waitForSelector('#catModal.open'); await co.click('#catModal [data-close]');
  await co.click('#nav a[data-route=users]'); await co.click('#newUserBtn');
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

  // ---------- the phone app in English ----------
  const appRawKey = /\b(adm|common|co|app|acc)\.[a-zA-Z]+\.?[a-zA-Z]*\b/;
  const arabicIn = (text) => text.replace(/شركة الاختبار|طاولة اجتماعات|العربية/g, '').match(/[\u0600-\u06FF]+/);
  await app.evaluate(() => localStorage.setItem('aman_lang', 'en'));
  await app.reload();
  await app.waitForTimeout(1200);
  let appText = await app.innerText('body');
  ok(await app.evaluate(() => document.documentElement.dir) === 'ltr' && !appRawKey.test(appText) && !arabicIn(appText),
    'app home (en): English, left to right' + (arabicIn(appText) ? ' — "' + arabicIn(appText)[0] + '"' : '') + (appRawKey.test(appText) ? ' — ' + appText.match(appRawKey)[0] : ''));
  await shot(app, 'app-en-home');
  await app.click('#addBtn');
  await app.waitForSelector('#formSheet.open');
  await app.click('#moreToggle');
  await app.waitForTimeout(300);
  appText = await app.innerText('#formSheet');
  ok(!appRawKey.test(appText) && !arabicIn(appText) && appText.includes('Asset number'), 'app form (en): English labels' + (arabicIn(appText) ? ' — "' + arabicIn(appText)[0] + '"' : ''));
  await shot(app, 'app-en-form', true);
  await app.click('#saveBtn');
  await app.waitForTimeout(300);
  ok((await app.innerText('#toast')).includes('Enter the asset number') || (await app.innerText('#toast')).includes('Fill in the required'), 'app validation message in English: ' + (await app.innerText('#toast')));
  await app.click('#closeFormBtn');
  await app.click('#settingsBtn');
  await app.waitForTimeout(400);
  appText = await app.innerText('#settingsSheet');
  ok(!appRawKey.test(appText) && !arabicIn(appText) && appText.includes('Interface language'), 'app settings (en): English' + (arabicIn(appText) ? ' — "' + arabicIn(appText)[0] + '"' : ''));
  await shot(app, 'app-en-settings');
  await app.click('#settingsSheet [data-lang-toggle]');
  await app.waitForTimeout(1200);
  ok(await app.evaluate(() => document.documentElement.dir) === 'rtl' && (await app.innerText('#addBtn')).includes('أصل جديد'), 'app language switch back to Arabic');
  await shot(app, 'app-ar-home');

  // ---------- provider dashboard, Arabic and English ----------
  const rawKey = /\b(adm|common|co|app|acc)\.(?!admin\b)[a-zA-Z]+\.?[a-zA-Z]*\b/; // co.admin is a username
  await admin.goto('about:blank');
  await admin.goto(B + '/admin#home');
  await admin.waitForSelector('#homeKpis .kpi');
  await admin.waitForTimeout(900);
  ok((await admin.innerText('#homeKpis')).includes('1'), 'home shows the numbers');
  ok(await admin.locator('#chartAssets svg rect.cbar').count() === 30, 'home chart: 30 days');
  await shot(admin, 'admin-home', true);
  for (const page of ['companies', 'providers', 'claude', 'storage', 'account']) {
    await admin.goto(B + '/admin#' + page);
    await admin.waitForTimeout(500);
    const text = await admin.innerText('body');
    ok(!rawKey.test(text), `admin ${page} (ar): no raw text keys` + (rawKey.test(text) ? ' — ' + text.match(rawKey)[0] : ''));
    await shot(admin, 'admin-' + page, true);
  }
  await admin.goto(B + '/admin#claude');
  await admin.waitForTimeout(300);
  ok((await admin.innerText('#aiKpis')).includes('$'), 'Claude page shows the spend');
  await admin.fill('#b_usd', '100'); await admin.fill('#b_date', new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  await admin.click('#balanceForm button[type=submit]');
  await admin.waitForTimeout(700);
  ok((await admin.innerText('#aiKpis')).includes('95.50'), 'balance saved and remaining shown');
  const coId = (await sql('select id from companies'))[0].id;
  await admin.goto(B + '/admin#company/' + coId);
  await admin.waitForTimeout(500);
  await shot(admin, 'admin-company', true);

  await admin.evaluate(() => localStorage.setItem('aman_lang', 'en'));
  await admin.goto('about:blank');
  for (const page of ['home', 'companies', 'company/' + coId, 'providers', 'claude', 'storage', 'account']) {
    await admin.goto(B + '/admin#' + page);
    await admin.waitForTimeout(700);
    const text = await admin.innerText('body');
    ok(!rawKey.test(text) && !/[\u0600-\u06FF]/.test(text.replace(/شركة الاختبار|عمر|العربية/g, '')), `admin ${page} (en): English only, no raw keys` + (rawKey.test(text) ? ' — ' + text.match(rawKey)[0] : ''));
    await shot(admin, 'admin-en-' + page.split('/')[0], true);
  }
  ok(await admin.evaluate(() => document.documentElement.dir) === 'ltr', 'English pages run left to right');
  await admin.goto(B + '/admin#home');
  await admin.waitForTimeout(300);
  await admin.click('#side [data-lang-toggle]');
  await admin.waitForTimeout(800);
  ok(await admin.evaluate(() => document.documentElement.dir) === 'rtl', 'language switch goes back to Arabic');

  // the provider panel on a phone: menu opens from the button
  const small = watch(await phone.newPage(), 'admin-phone');
  await small.goto(B + '/admin#home');
  await small.fill('#adminUser', 'omar'); await small.fill('#adminPass', 'omarpass12345'); await small.click('#loginForm button');
  await small.waitForSelector('#homeKpis .kpi');
  await small.waitForTimeout(600);
  await shot(small, 'admin-phone-home', true);
  await small.click('#menuBtn');
  await small.waitForTimeout(400);
  ok(await small.isVisible('#nav a[data-route=claude]'), 'phone: side menu opens');
  for (const page of ['home', 'companies', 'claude', 'providers']) {
    await small.goto(B + '/admin#' + page); await small.waitForTimeout(400);
    ok(await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `admin ${page} fits the phone width`);
  }
  await shot(small, 'admin-phone-menu');

  // ---------- company dashboard, Arabic and English ----------
  await co.goto('about:blank');
  await co.goto(B + '/company#home');
  await co.waitForSelector('#homeKpis .kpi');
  await co.waitForTimeout(900);
  ok(await co.locator('#chartDaily svg rect.cbar').count() === 30, 'company home chart: 30 days');
  ok((await co.innerText('#homeTeamBody')).includes('walker'), 'company home lists the team');
  for (const page of ['home', 'inventory', 'projects', 'users', 'licence', 'account']) {
    await co.goto(B + '/company#' + page);
    await co.waitForTimeout(600);
    const text = await co.innerText('body');
    ok(!rawKey.test(text), `company ${page} (ar): no raw text keys` + (rawKey.test(text) ? ' — ' + text.match(rawKey)[0] : ''));
    await shot(co, 'company-' + page, true);
  }
  ok((await co.innerText('#invBody')).includes('A-0001'), 'company inventory lists the synced asset');
  await co.evaluate(() => localStorage.setItem('aman_lang', 'en'));
  await co.goto('about:blank');
  for (const page of ['home', 'inventory', 'projects', 'users', 'licence', 'account']) {
    await co.goto(B + '/company#' + page);
    await co.waitForTimeout(700);
    const text = await co.innerText('body');
    const arabicLeft = text.replace(/شركة الاختبار|طاولة اجتماعات|العربية/g, '').match(/[\u0600-\u06FF]+/);
    ok(!rawKey.test(text) && !arabicLeft, `company ${page} (en): English only, no raw keys` + (rawKey.test(text) ? ' — ' + text.match(rawKey)[0] : '') + (arabicLeft ? ' — "' + arabicLeft[0] + '"' : ''));
    await shot(co, 'company-en-' + page, true);
  }
  await co.click('#nav a[data-route=projects]');
  await co.click('#projBody [data-edit-proj]');
  await co.waitForSelector('#projModal.open');
  await shot(co, 'company-en-project-window');
  await co.keyboard.press('Escape');
  ok(!(await co.isVisible('#projModal.open')), 'Esc closes windows');
  await co.evaluate(() => localStorage.setItem('aman_lang', 'ar'));
  const coPhone = watch(await phone.newPage(), 'company-phone');
  await coPhone.goto(B + '/company#home');
  await coPhone.fill('#lg_user', 'co.admin'); await coPhone.fill('#lg_pass', 'copass123'); await coPhone.click('#loginBtn');
  await coPhone.waitForSelector('#homeKpis .kpi');
  await coPhone.waitForTimeout(700);
  await shot(coPhone, 'company-phone-home', true);
  ok(await coPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'company home fits the phone width');
  for (const page of ['inventory', 'projects', 'users', 'licence']) {
    await coPhone.goto(B + '/company#' + page); await coPhone.waitForTimeout(400);
    ok(await coPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `company ${page} fits the phone width`);
  }

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
