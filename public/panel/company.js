// Company panel (/company): home dashboard, synced inventory, projects (settings + categories),
// field users and devices, licence, and the admin's own account. Pages are switched by the address
// hash (#home, #inventory, #projects, #users, #licence, #account).
// Uses panel/common.js, panel/charts.js and the i18n texts (co.*, common.*).
const TOKEN_KEY = 'jard_company_token';
let token = '';
let data = null;
let dash = null;         // home numbers (assets per day / project / user)
try{ token = sessionStorage.getItem(TOKEN_KEY) || ''; }catch{}

// Entry fields a project can make required (keys match the phone app).
const FIELDS = ['category','subcat','name','condition','building','location','catcode','subcatcode','brand','model','sn','plateno','value','notes'];
const fieldName = (k)=> t('co.f.' + k);
$('p_required').innerHTML = FIELDS.map(k=>`<label><input type="checkbox" value="${k}">${esc(fieldName(k))}</label>`).join('');

async function call(action, extra={}){
  let r, d = {};
  try{
    r = await fetch('/api/company', {
      method:'POST',
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
      body: JSON.stringify({action, ...extra})
    });
    d = await r.json();
  }catch{ return {ok:false, message:t('common.offline'), messageEn:t('common.offline')}; }
  if(action !== 'login' && (r.status === 401 || ['user_disabled','company_disabled','no_company'].includes(d.code))){
    signOut(msgOf(d, 'common.sessionEnded'));
  }
  return d;
}
function signOut(msg){
  token = ''; data = null;
  try{ sessionStorage.removeItem(TOKEN_KEY); }catch{}
  closeModals();
  $('appView').style.display = 'none';
  $('loginView').style.display = 'block';
  $('loginErr').textContent = msg || '';
}

$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('loginErr').textContent = '';
  const btn = $('loginBtn'); btn.disabled = true;
  const d = await call('login', {username: $('lg_user').value.trim(), password: $('lg_pass').value});
  btn.disabled = false;
  if(!d.ok){ $('loginErr').textContent = msgOf(d, 'common.signInFailed'); return; }
  token = d.token;
  try{ sessionStorage.setItem(TOKEN_KEY, token); }catch{}
  $('lg_pass').value = '';
  await load();
});
$('logoutBtn').addEventListener('click', ()=> signOut(''));
$('reloadBtn').addEventListener('click', ()=> load());

async function load(){
  const d = await call('overview');
  if(!d.ok){ if(token) toast(msgOf(d, 'common.loadFailed')); return; }
  data = d;
  $('loginView').style.display = 'none';
  $('appView').style.display = 'flex';
  renderShell();
  route();
  if(data.sync){
    const s = await call('dashboard');
    if(s.ok){ dash = s.activity; if(currentRoute() === 'home') renderHome(); }
  }
}

// ---------- navigation ----------
const PAGES = ['home','inventory','projects','users','licence','account'];
const currentRoute = ()=>{ const p = location.hash.replace(/^#/, '').split('/')[0]; return PAGES.includes(p) ? p : 'home'; };
window.addEventListener('hashchange', ()=>{ route(); window.scrollTo(0, 0); });
$('menuBtn').addEventListener('click', ()=> $('appView').classList.toggle('nav-open'));
$('scrim').addEventListener('click', ()=> $('appView').classList.remove('nav-open'));
$('nav').addEventListener('click', (e)=>{ if(e.target.closest('a')) $('appView').classList.remove('nav-open'); });

function route(){
  if(!data || $('appView').style.display === 'none') return;
  const page = currentRoute();
  document.querySelectorAll('.page').forEach(p=> p.hidden = p.dataset.page !== page);
  document.querySelectorAll('#nav a').forEach(a=> a.classList.toggle('on', a.dataset.route === page));
  $('pageTitle').textContent = t('co.nav.' + page);
  $('pageSub').textContent = page === 'home' ? t('co.home.sub', {name: data.company.customer}) : '';
  ({home: renderHome, inventory: showInventory, projects: renderProjects, users: renderUsers, licence: renderLicence, account: renderAccount})[page]();
}

// ---------- shell ----------
function licState(c){
  if(!c.active) return 'off';
  const d = daysLeft(c.expiresAt);
  if(d !== null && d < 0) return 'expired';
  if(d !== null && d <= 30) return 'soon';
  return 'active';
}
function licPill(c){
  const s = licState(c);
  if(s === 'off') return `<span class="pill bad">${t('co.lic.off')}</span>`;
  if(s === 'expired') return `<span class="pill bad">${t('co.lic.expired')}</span>`;
  if(s === 'soon') return `<span class="pill caution">${t('co.lic.soon', {n: daysLeft(c.expiresAt)})}</span>`;
  return `<span class="pill ok">${t('co.lic.active')}</span>`;
}
function accountStatus(a){
  return a.pending ? `<span class="pill caution">${t('common.pending')}</span>`
    : a.active ? `<span class="pill ok">${t('common.active')}</span>` : `<span class="pill bad">${t('common.suspended')}</span>`;
}
function renderShell(){
  const c = data.company, me = data.me;
  $('coName').textContent = c.customer;
  $('meLbl').innerHTML = `${esc(me.displayName || me.username)}<small dir="ltr">${esc(me.email || me.username)}</small>`;
  const notes = [];
  const st = licState(c);
  if(st === 'expired') notes.push(t('co.note.expired'));
  else if(st === 'off') notes.push(t('co.note.off'));
  if(!me.email) notes.push(t('co.note.addEmail'));
  else if(!me.emailVerified) notes.push(t('co.note.verifyEmail'));
  $('notices').innerHTML = notes.map(n=> `<div class="notice">${n}</div>`).join('');
  const pending = data.users.filter(u=> u.pending).length;
  $('navPending').hidden = !pending; $('navPending').textContent = pending;
  $('navLic').hidden = st === 'active';
}
const projById = ()=> Object.fromEntries(data.projects.map(p=>[p.id,p]));
function kpi(href, label, value, detail, warn){
  return `<a class="kpi${warn ? ' warn' : ''}" href="${href}"><span class="k">${esc(label)}</span><span class="v">${value}</span><span class="d">${detail || ''}</span></a>`;
}

// ---------- home ----------
function renderHome(){
  const c = data.company;
  const d = daysLeft(c.expiresAt);
  const devices = data.users.reduce((n,u)=> n + u.devices.length, 0);
  const pending = data.users.filter(u=> u.pending);
  const k = [];
  k.push(kpi('#licence', t('co.k.licence'), d == null ? '—' : `${num(Math.max(0, d))} <small>${t('common.days')}</small>`,
    `<span class="mono">${esc(c.expiresAt || '—')}</span>`, ['expired','off'].includes(licState(c))));
  k.push(kpi('#users', t('co.k.users'), `${num(c.userCount)}<small> / ${num(c.maxUsers)}</small>`,
    pending.length ? `<span><i class="dot caution"></i> ${t('co.k.pending', {n: num(pending.length)})}</span>` : `<span>${t('co.k.devices', {n: num(devices), max: num(c.maxUsers * c.maxDevicesPerUser)})}</span>`));
  if(data.sync){
    k.push(kpi('#inventory', t('co.k.assets'), num(dash ? dash.total : (c.assetCount || 0)),
      dash ? `<span>+${num(dash.today)} ${t('co.k.today')}</span><span>· +${num(dash.week)} ${t('co.k.week')}</span>` : `<span>${t('co.k.fromAll')}</span>`));
  }
  k.push(kpi('#projects', t('co.k.projects'), num(data.projects.length),
    `<span>${t('co.k.activeProjects', {n: num(data.projects.filter(p=> p.active).length)})}</span>`));
  k.push(kpi('#licence', t('co.k.ai'), c.aiEnabled ? `${num(c.usage.count)}${c.aiMonthlyCap ? `<small> / ${num(c.aiMonthlyCap)}</small>` : ''}` : `<small>${t('common.off')}</small>`,
    `<span>${t('co.k.aiSub')}</span>`, c.aiMonthlyCap && c.usage.count >= c.aiMonthlyCap));
  if(dash?.flagged) k.push(kpi('#inventory', t('co.k.flagged'), num(dash.flagged), `<span>${t('co.k.flaggedSub')}</span>`));
  $('homeKpis').innerHTML = k.join('');

  if(!data.sync) $('chartDaily').innerHTML = `<div class="chart-empty">${t('co.inv.off')}</div>`;
  else if(dash) barChart($('chartDaily'), dash.daily, {label: (r)=> shortDay(r.day), value: (r)=> Number(r.assets), highlightLast: true, title: t('co.home.daily')});
  else $('chartDaily').innerHTML = `<div class="chart-empty">${t('common.loading')}</div>`;

  const per = Object.fromEntries((dash?.perProject || []).map(x=> [x.projectId, x]));
  $('homeProjBody').innerHTML = data.projects.length ? data.projects.map(p=>{
    const a = per[p.id];
    return `<tr class="link" data-go="#inventory" data-project="${esc(p.id)}"><td><b>${esc(p.name)}</b></td>
      <td>${p.active ? `<span class="pill ok">${t('common.active')}</span>` : `<span class="pill bad">${t('common.suspended')}</span>`}</td>
      <td class="stat">${num(p.userCount)}</td><td class="stat">${num(a?.assets ?? p.assetCount ?? 0)}</td>
      <td class="stat">${a ? '+' + num(a.week) : '—'}</td><td class="stat">${a?.flagged ? num(a.flagged) : '—'}</td>
      <td class="mono">${a?.lastSync ? fmtTime(a.lastSync) : '—'}</td></tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">${t('co.proj.none')}</td></tr>`;

  const pmap = projById();
  const perUser = Object.fromEntries((dash?.perUser || []).map(x=> [x.username, x]));
  const team = [...data.users].sort((a,b)=> Number(perUser[b.username]?.week || 0) - Number(perUser[a.username]?.week || 0));
  $('homeTeamBody').innerHTML = team.length ? team.slice(0, 10).map(u=>{
    const a = perUser[u.username];
    return `<tr><td><b>${esc(u.displayName || u.username)}</b>${u.displayName ? `<div class="sub mono">${esc(u.username)}</div>` : ''}</td>
      <td>${esc(pmap[u.projectId]?.name || '—')}</td><td class="stat">${num(a?.today || 0)}</td><td class="stat">${num(a?.week || 0)}</td>
      <td class="stat">${num(a?.total || 0)}</td><td class="mono">${a?.lastSync ? fmtTime(a.lastSync) : '—'}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">${t('co.user.none')}</td></tr>`;

  // Needs attention.
  const att = [];
  const st = licState(c);
  if(st === 'expired') att.push(['bad', t('co.att.expired', {date: c.expiresAt}), '#licence']);
  else if(st === 'soon') att.push(['caution', t('co.att.soon', {n: d, date: c.expiresAt}), '#licence']);
  if(c.userCount >= c.maxUsers) att.push(['caution', t('co.att.full', {n: c.maxUsers}), '#users']);
  for(const u of pending) att.push(['caution', t('co.att.pending', {user: u.displayName || u.username}), '#users']);
  for(const p of data.projects) if(p.active && !p.categoryCount) att.push(['caution', t('co.att.noCats', {name: p.name}), '#projects']);
  for(const p of data.projects) if(p.active && !p.userCount) att.push(['off', t('co.att.noUsers', {name: p.name}), '#users']);
  if(c.aiEnabled && c.aiMonthlyCap && c.usage.count >= c.aiMonthlyCap * 0.9) att.push(['caution', t('co.att.aiCap', {n: c.usage.count, cap: c.aiMonthlyCap}), '#licence']);
  const weekAgo = Date.now() - 7 * 86400000;
  for(const u of data.users){
    const a = perUser[u.username];
    if(!u.pending && u.active && dash && (!a?.lastSync || Date.parse(a.lastSync) < weekAgo)) att.push(['off', t('co.att.quiet', {user: u.displayName || u.username}), '#users']);
  }
  $('attentionList').innerHTML = att.length ? att.slice(0, 8).map(([dot, text, href])=> `<div class="item"><i class="dot ${dot}"></i><div class="grow"><span>${esc(text)}</span></div><a class="sub" href="${href}">${t('co.open')}</a></div>`).join('')
    : `<div class="empty">${t('co.att.none')}</div>`;

  // Getting started checklist.
  const steps = [
    [data.projects.length > 0, t('co.start.project'), '#projects'],
    [data.projects.some(p=> p.categoryCount), t('co.start.categories'), '#projects'],
    [data.users.length > 0, t('co.start.user'), '#users'],
    [data.users.some(u=> u.devices.length), t('co.start.phone'), '#users'],
    [!!(dash?.total || c.assetCount), t('co.start.asset'), '#inventory'],
    [!!(data.me.email && data.me.emailVerified), t('co.start.email'), '#account']
  ];
  $('startList').innerHTML = steps.map(([done, text, href])=> `<div class="item"><i class="dot ${done ? 'ok' : 'off'}"></i>
    <div class="grow"><span style="${done ? 'text-decoration:line-through' : 'color:var(--ink)'}">${esc(text)}</span></div>
    ${done ? '' : `<a class="sub" href="${href}">${t('co.open')}</a>`}</div>`).join('');
}

// ---------- licence ----------
function renderLicence(){
  const c = data.company;
  const d = daysLeft(c.expiresAt);
  $('licStatus').innerHTML = licPill(c);
  const devices = data.users.reduce((n,u)=> n + u.devices.length, 0);
  const pct = (a, b)=> b ? Math.min(100, Math.round(a / b * 100)) : 0;
  const bar = (p)=> `<div class="bar" style="width:100%"><i style="width:${p}%"></i></div>`;
  $('licTiles').innerHTML = [
    kpi('#licence', t('co.lic.term'), `${num(c.months)} <small>${t('co.lic.months')}</small>`, `<span class="mono">${esc(c.startsAt)} → ${esc(c.expiresAt || '—')}</span>`),
    kpi('#licence', t('co.k.licence'), d == null ? '—' : `${num(Math.max(0, d))} <small>${t('common.days')}</small>`, '', ['expired','off'].includes(licState(c))),
    kpi('#users', t('co.k.users'), `${num(c.userCount)}<small> / ${num(c.maxUsers)}</small>`, bar(pct(c.userCount, c.maxUsers))),
    kpi('#users', t('co.lic.devices'), `${num(devices)}<small> / ${num(c.maxUsers * c.maxDevicesPerUser)}</small>`, `<span>${t('co.lic.perUser', {n: c.maxDevicesPerUser})}</span>`),
    kpi('#licence', t('co.k.ai'), c.aiEnabled ? `${num(c.usage.count)}${c.aiMonthlyCap ? `<small> / ${num(c.aiMonthlyCap)}</small>` : ''}` : `<small>${t('common.off')}</small>`,
      c.aiEnabled && !c.aiMonthlyCap ? `<span>${t('co.lic.noCap')}</span>` : c.aiMonthlyCap ? bar(pct(c.usage.count, c.aiMonthlyCap)) : '')
  ].join('');
}

// ---------- projects ----------
function renderProjects(){
  $('projBody').innerHTML = data.projects.length ? data.projects.map(p=>`<tr>
    <td><b>${esc(p.name)}</b>${p.notes ? `<div class="sub">${esc(p.notes)}</div>` : ''}</td>
    <td>${p.active ? `<span class="pill ok">${t('common.active')}</span>` : `<span class="pill bad">${t('common.suspended')}</span>`}</td>
    <td>${langName(p.settings.lang)}</td>
    <td>${p.settings.required.length ? `<span class="pill" title="${esc(p.settings.required.map(fieldName).join(', '))}">${t('co.proj.fields', {n: p.settings.required.length})}</span>` : `<span class="sub">${t('co.proj.basicOnly')}</span>`}${p.settings.minPhotos > 1 ? ` <span class="pill">${t('co.proj.photos', {n: p.settings.minPhotos})}</span>` : ''}</td>
    <td>${p.categoryCount ? t('co.proj.catCount', {main: `<span class="stat">${num(p.categoryCount)}</span>`, sub: `<span class="stat">${num(p.subCategoryCount)}</span>`}) : `<span class="sub">${t('co.proj.noCats')}</span>`}</td>
    <td class="stat">${num(p.userCount)}</td>
    <td class="stat">${p.assetCount == null ? '—' : num(p.assetCount)}</td>
    <td><div class="actions">
      <button class="btn btn-ghost btn-sm" data-edit-proj="${esc(p.id)}">${t('co.proj.settings')}</button>
      <button class="btn btn-ghost btn-sm" data-cats="${esc(p.id)}">${t('co.proj.categories')}</button>
      <button class="btn btn-danger btn-sm" data-del-proj="${esc(p.id)}">${t('common.delete')}</button>
    </div></td></tr>`).join('') : `<tr><td colspan="8" class="empty">${t('co.proj.none')}</td></tr>`;
}

// ---------- users ----------
function renderUsers(){
  const c = data.company;
  const pmap = projById();
  const full = c.userCount >= c.maxUsers;
  $('userQuota').textContent = t('co.user.quota', {n: c.userCount, max: c.maxUsers, dev: c.maxDevicesPerUser}) + (full ? ' · ' + t('co.user.full') : '');
  $('newUserBtn').disabled = full || !data.projects.length;
  $('newUserBtn').title = !data.projects.length ? t('co.user.needProject') : full ? t('co.user.fullTitle') : '';
  $('userBody').innerHTML = data.users.length ? data.users.map(u=>`<tr>
    <td class="mono">${esc(u.username)}</td><td>${esc(u.displayName || '—')}</td>
    <td>${emailCell(u)}</td>
    <td>${esc(pmap[u.projectId]?.name || '—')}</td>
    <td>${accountStatus(u)}</td>
    <td class="stat">${num(u.devices.length)}/${num(c.maxDevicesPerUser)}</td>
    <td class="mono">${fmt(u.lastLogin)}</td>
    <td><div class="actions">
      ${u.pending && u.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(u.username)}">${t('common.resend')}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-edit-user="${esc(u.username)}">${t('common.edit')}</button>
      <button class="btn btn-ghost btn-sm" data-devices="${esc(u.username)}">${t('co.col.devices')}</button>
      <button class="btn btn-danger btn-sm" data-del-user="${esc(u.username)}">${t('common.delete')}</button>
    </div></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">${data.projects.length ? t('co.user.none') : t('co.user.projectFirst')}</td></tr>`;
}

// ---------- my account ----------
function renderAccount(){
  const me = data.me;
  $('m_user').value = me.username;
  if(document.activeElement !== $('m_display')) $('m_display').value = me.displayName || '';
  if(document.activeElement !== $('m_email')) $('m_email').value = me.email || '';
  $('m_emailState').textContent = !me.email ? t('common.emailNeeded') : me.emailVerified ? t('common.verified') : t('co.acc.notVerified');
}
$('meForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('meErr').textContent = '';
  const body = {displayName: $('m_display').value, email: $('m_email').value};
  if($('m_new').value){ body.newPassword = $('m_new').value; body.currentPassword = $('m_cur').value; }
  const d = await call('updateMe', body);
  if(!d.ok){ $('meErr').textContent = msgOf(d); return; }
  $('m_cur').value = ''; $('m_new').value = '';
  document.activeElement?.blur();
  toast(d.verifySent ? t('common.verifySent') : body.newPassword ? t('common.passwordChanged') : t('common.saved'));
  load();
});

// ---------- windows ----------
document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', closeModals));
document.querySelectorAll('.modal-bg').forEach(m=> m.addEventListener('click', e=>{ if(e.target===m) closeModals(); }));
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModals(); });

// ---------- projects: settings ----------
function openProject(p){
  $('projTitle').textContent = p ? t('co.proj.editTitle') : t('co.proj.newTitle');
  $('p_id').value = p?.id || '';
  $('p_name').value = p?.name || '';
  $('p_lang').value = p?.settings.lang === 'en' ? 'en' : 'ar';
  $('p_minPhotos').value = p?.settings.minPhotos || 1;
  $('p_active').checked = p ? p.active : true;
  $('p_notes').value = p?.notes || '';
  $('p_required').querySelectorAll('input').forEach(c=>{ c.checked = (p?.settings.required || []).includes(c.value); });
  $('projErr').textContent = '';
  openModal('projModal');
}
$('newProjBtn').addEventListener('click', ()=> openProject(null));
$('projForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const isNew = !$('p_id').value;
  const d = await call('saveProject', {project:{
    id: $('p_id').value || undefined, name: $('p_name').value, active: $('p_active').checked, notes: $('p_notes').value,
    settings: {
      lang: $('p_lang').value, minPhotos: Number($('p_minPhotos').value || 1),
      required: [...$('p_required').querySelectorAll('input:checked')].map(c=>c.value)
    }
  }});
  if(!d.ok){ $('projErr').textContent = msgOf(d); return; }
  closeModals(); await load();
  if(isNew){ toast(t('co.proj.created')); openCategories(d.id); }
  else toast(t('co.proj.saved'));
});

// ---------- projects: categories ----------
let catProject = null, catDraft = null;
async function openCategories(projectId){
  catProject = data.projects.find(p=> p.id === projectId);
  $('catProjName').textContent = catProject?.name || '';
  $('catErr').textContent = ''; $('catFile').value = '';
  catDraft = null; $('catSaveBtn').disabled = true;
  $('catSummary').textContent = t('common.loading'); $('catPreview').innerHTML = '';
  openModal('catModal');
  const d = await call('getProject', {projectId});
  if(!d.ok){ $('catSummary').textContent = msgOf(d); return; }
  catProject.categories = d.project.categories || [];
  showCategories(catProject.categories, false);
}
function showCategories(cats, isDraft){
  const subs = cats.reduce((n,c)=> n + c.subs.length, 0);
  $('catSummary').innerHTML = cats.length
    ? t(isDraft ? 'co.cat.preview' : 'co.cat.current', {main: `<span class="stat">${num(cats.length)}</span>`, sub: `<span class="stat">${num(subs)}</span>`})
    : esc(t('co.cat.empty'));
  const rows = [];
  for(const c of cats){
    if(!c.subs.length) rows.push(`<tr><td class="mono">${esc(c.code)}</td><td><b>${esc(c.name)}</b></td><td></td><td class="sub">—</td></tr>`);
    c.subs.forEach((s,i)=> rows.push(`<tr><td class="mono">${i ? '' : esc(c.code)}</td><td>${i ? '' : `<b>${esc(c.name)}</b>`}</td><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td></tr>`));
    if(rows.length > 600){ rows.push(`<tr><td colspan="4" class="sub">${t('co.cat.more')}</td></tr>`); break; }
  }
  $('catPreview').innerHTML = cats.length ? `<table><thead><tr><th>${t('co.f.catcode')}</th><th>${t('co.cat.main')}</th><th>${t('co.f.subcatcode')}</th><th>${t('co.f.subcat')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
  $('catPreview').style.display = cats.length ? '' : 'none';
}

// Header detection: English or Arabic, any order. Falls back to columns A-D.
function classify(h){
  const s = String(h || '').toLowerCase().replace(/[_\-.]/g,' ').replace(/\s+/g,' ').trim();
  if(!s) return null;
  const sub = /sub|فرعي/.test(s), code = /code|كود|رمز|no\b|رقم/.test(s);
  const name = /name|اسم|category|cat\b|فئة|الفئه|تصنيف/.test(s);
  if(code && /cat|فئ|تصنيف|sub|فرع/.test(s)) return sub ? 'subCode' : 'code';
  if(name) return sub ? 'subName' : 'name';
  return null;
}
function parseRows(rows){
  let start = 0, map = null;
  for(let i = 0; i < Math.min(rows.length, 10); i++){
    const m = {};
    rows[i].forEach((h, j)=>{ const k = classify(h); if(k && m[k] == null) m[k] = j; });
    if(m.name != null && (m.subName != null || m.code != null)){ map = m; start = i + 1; break; }
  }
  if(!map) map = {code:0, name:1, subCode:2, subName:3};
  const cats = [], byName = new Map();
  let cur = null;
  const v = (r, k)=> map[k] == null ? '' : String(r[map[k]] ?? '').replace(/\s+/g,' ').trim();
  for(const r of rows.slice(start)){
    const code = v(r,'code'), name = v(r,'name'), sc = v(r,'subCode'), sn = v(r,'subName');
    if(name){
      cur = byName.get(name);
      if(!cur){ cur = {code, name, subs:[]}; byName.set(name, cur); cats.push(cur); }
      else if(!cur.code && code) cur.code = code;
    } else if(code && !sn && !sc){
      continue; // a code with no name is not usable
    }
    if(sn && cur && !cur.subs.some(s=> s.name === sn)) cur.subs.push({code: sc, name: sn});
  }
  return cats;
}
async function readCatFile(file){
  $('catErr').textContent = '';
  try{
    const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:false});
    const cats = parseRows(rows);
    if(!cats.length){ $('catErr').textContent = t('co.cat.noneInFile'); return; }
    catDraft = cats;
    showCategories(cats, true);
    $('catSaveBtn').disabled = false;
  }catch(e){ $('catErr').textContent = t('co.cat.badFile'); }
}
$('catFile').addEventListener('change', (e)=>{ const f = e.target.files[0]; if(f) readCatFile(f); });
$('drop').addEventListener('dragover', (e)=>{ e.preventDefault(); });
$('drop').addEventListener('drop', (e)=>{ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) readCatFile(f); });
$('catSaveBtn').addEventListener('click', async ()=>{
  if(!catDraft) return;
  const d = await call('setCategories', {projectId: catProject.id, categories: catDraft});
  if(!d.ok){ $('catErr').textContent = msgOf(d); return; }
  closeModals(); toast(t('co.cat.saved')); load();
});
$('catClearBtn').addEventListener('click', async ()=>{
  if(!confirm(t('co.cat.clearConfirm'))) return;
  const d = await call('setCategories', {projectId: catProject.id, categories: []});
  if(d.ok){ closeModals(); toast(t('co.cat.cleared')); load(); } else $('catErr').textContent = msgOf(d);
});
function downloadSheet(rows, name){
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:16},{wch:30},{wch:18},{wch:34}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Categories');
  XLSX.writeFile(wb, name);
}
const HEAD = ['Category Code','Category Name','Sub Category Code','Sub Category Name'];
$('tplBtn').addEventListener('click', ()=> downloadSheet([HEAD,
  ['10000','Furniture','10054','Chairs, stools'], ['','','10055','Desks, tables'],
  ['20000','COMPUTER & NETWORK','20010','Laptops'], ['','','20011','Printers']], 'categories_template.xlsx'));
$('exportCatBtn').addEventListener('click', ()=>{
  const cats = catDraft || catProject?.categories || [];
  const rows = [HEAD];
  for(const c of cats){
    if(!c.subs.length) rows.push([c.code, c.name, '', '']);
    c.subs.forEach(s=> rows.push([c.code, c.name, s.code, s.name]));
  }
  downloadSheet(rows, `categories_${(catProject?.name || 'project').replace(/[\\/:*?"<>|]/g,'_')}.xlsx`);
});

// ---------- users: window ----------
function genPassword(){
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(10); crypto.getRandomValues(arr);
  return Array.from(arr, n=> chars[n % chars.length]).join('');
}
$('genPassBtn').addEventListener('click', ()=>{ $('u_password').value = genPassword(); });
function openUser(u){
  const isNew = !u;
  $('userTitle').textContent = isNew ? t('co.user.newTitle') : t('co.user.editTitle');
  $('u_username').value = u?.username || '';
  $('u_username').readOnly = !isNew;
  $('u_display').value = u?.displayName || '';
  $('u_project').innerHTML = data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.active ? '' : ' (' + esc(t('common.suspended')) + ')'}</option>`).join('');
  if(u?.projectId) $('u_project').value = u.projectId;
  $('u_email').value = u?.email || '';
  $('u_emailState').textContent = !u?.email ? '' : u.pending ? t('common.pendingInvite') : u.emailVerified ? t('common.verified') : t('common.notVerified');
  $('u_password').value = '';
  $('u_passLbl').textContent = isNew ? t('co.user.passwordOrInvite') : t('common.passwordKeep');
  $('u_active').checked = u ? u.active : true;
  $('userErr').textContent = '';
  openModal('userModal');
}
$('newUserBtn').addEventListener('click', ()=> openUser(null));
$('userForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const password = $('u_password').value;
  const d = await call('saveUser', {user:{
    username: $('u_username').value, displayName: $('u_display').value, projectId: $('u_project').value,
    email: $('u_email').value, password: password || undefined, active: $('u_active').checked
  }});
  if(!d.ok){ $('userErr').textContent = msgOf(d); return; }
  closeModals(); load();
  if(d.invite){ inviteResult(d.user, d.invite); return; }
  if(d.verifySent) toast(t('common.savedVerify'));
  if(password){
    const text = t('co.user.credentials', {url: location.origin, user: d.user.username, pass: password});
    try{ await navigator.clipboard.writeText(text); toast(t('co.user.copied')); }
    catch{ prompt(t('co.user.copyPrompt'), text.replace(/\n/g,' | ')); }
  } else if(!d.verifySent) toast(t('common.saved'));
});

// After an invitation: say where it went, or hand over the link if the email could not be sent.
async function inviteResult(user, invite){
  if(invite.sent){ toast(t('common.inviteSent', {email: user.email})); return; }
  const text = t('common.inviteText', {user: user.username, url: invite.url});
  try{ await navigator.clipboard.writeText(text); toast(t('common.inviteCopied')); }
  catch{ prompt(t('common.invitePrompt'), invite.url); }
}

let devUser = null;
function openDevices(username){
  devUser = data.users.find(u=> u.username === username);
  if(!devUser) return;
  const max = data.company.maxDevicesPerUser;
  $('devInfo').textContent = t('co.dev.info', {user: devUser.displayName || devUser.username, n: devUser.devices.length, max});
  $('devList').innerHTML = devUser.devices.length ? devUser.devices.map((d,i)=>`<div class="dev">
      <div><b>${t('co.dev.device', {n: i + 1})}</b> <span class="mono sub">${esc(d.short)}</span>
        <div class="sub" style="font-size:12px">${t('co.dev.dates', {added: fmt(d.addedAt), seen: fmt(d.lastSeen)})}</div></div>
      <button class="btn btn-danger btn-sm" data-release="${esc(d.id)}">${t('co.dev.release')}</button></div>`).join('')
    : `<div class="hint">${t('co.dev.none')}</div>`;
  openModal('devModal');
}

// ---------- row actions ----------
document.addEventListener('click', async (e)=>{
  if(!data) return;
  const row = e.target.closest('tr[data-go]');
  if(row && !e.target.closest('button, a')){
    if(row.dataset.project){ inv.projectId = row.dataset.project; inv.offset = 0; }
    location.hash = row.dataset.go; return;
  }
  const b = e.target.closest('button'); if(!b) return;
  const ds = b.dataset;
  if(ds.editProj) openProject(data.projects.find(p=> p.id === ds.editProj));
  if(ds.cats) openCategories(ds.cats);
  if(ds.delProj){
    const p = data.projects.find(x=> x.id === ds.delProj);
    if(confirm(t('co.proj.deleteConfirm', {name: p.name}))){
      const d = await call('deleteProject', {projectId: p.id});
      if(d.ok){ toast(t('common.deleted')); load(); } else toast(msgOf(d));
    }
  }
  if(ds.editUser) openUser(data.users.find(u=> u.username === ds.editUser));
  if(ds.resend){
    b.disabled = true;
    const d = await call('resendInvite', {username: ds.resend});
    b.disabled = false;
    if(d.ok) inviteResult(data.users.find(u=> u.username === ds.resend), d.invite); else toast(msgOf(d));
  }
  if(ds.devices) openDevices(ds.devices);
  if(ds.release){
    if(!confirm(t('co.dev.releaseConfirm'))) return;
    const d = await call('removeDevice', {username: devUser.username, deviceId: ds.release});
    if(!d.ok){ toast(msgOf(d)); return; }
    toast(t('co.dev.released'));
    await load(); openDevices(devUser.username);
  }
  if(ds.delUser){
    if(confirm(t('co.user.deleteConfirm', {user: ds.delUser}))){
      const d = await call('deleteUser', {username: ds.delUser});
      if(d.ok){ toast(t('common.deleted')); load(); } else toast(msgOf(d));
    }
  }
});

// ---------- inventory (synced from phones) ----------
const PAGE = 50;
const inv = {projectId: '', offset: 0, total: 0, rows: [], q: '', stats: null, seq: 0};
const conditionName = (c)=> ({'Good':t('co.cond.good'),'New':t('co.cond.new'),'Fair':t('co.cond.fair'),'Needs Maintenance':t('co.cond.maint')})[c] || c;

function showInventory(){
  $('invOff').hidden = !!data.sync;
  $('invOn').hidden = !data.sync;
  if(!data.sync) return;
  const sel = $('invProject');
  const keep = inv.projectId && data.projects.some(p=> p.id === inv.projectId) ? inv.projectId : data.projects[0]?.id || '';
  sel.innerHTML = data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.assetCount ? ` (${num(p.assetCount)})` : ''}</option>`).join('');
  sel.value = inv.projectId = keep;
  loadInventory();
}
$('invProject').addEventListener('change', ()=>{ inv.projectId = $('invProject').value; inv.offset = 0; loadInventory(); });
let searchTimer = null;
$('invSearch').addEventListener('input', ()=>{
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ inv.q = $('invSearch').value.trim(); inv.offset = 0; loadAssetsPage(); }, 350);
});
$('invPrev').addEventListener('click', ()=>{ inv.offset = Math.max(0, inv.offset - PAGE); loadAssetsPage(); });
$('invNext').addEventListener('click', ()=>{ if(inv.offset + PAGE < inv.total){ inv.offset += PAGE; loadAssetsPage(); } });

async function loadInventory(){
  if(!inv.projectId){ $('invTiles').innerHTML = `<div class="hint">${t('co.inv.needProject')}</div>`; return; }
  const d = await call('inventoryStats', {projectId: inv.projectId});
  if(!d.ok){ $('invTiles').innerHTML = `<div class="form-err">${esc(msgOf(d, 'common.loadFailed'))}</div>`; return; }
  const st = inv.stats = d.stats;
  $('invTiles').innerHTML = [
    kpi('#inventory', t('co.col.assets'), num(st.total), ''),
    kpi('#inventory', t('co.k.flagged'), num(st.flagged), '', false),
    kpi('#inventory', t('co.inv.photoCount'), num(st.photos), ''),
    kpi('#inventory', t('co.col.lastSync'), st.lastSync ? `<span style="font-size:16px">${fmtTime(st.lastSync)}</span>` : '—', '')
  ].join('');
  $('invByUser').innerHTML = st.byUser.length ? st.byUser.map(u=>`<tr><td class="mono">${esc(u.username)}</td><td class="stat">${num(u.count)}</td><td class="mono">${fmtTime(u.lastSync)}</td></tr>`).join('')
    : `<tr><td colspan="3" class="empty">${t('co.inv.nothingYet')}</td></tr>`;
  $('invByBuilding').innerHTML = st.byBuilding.length ? st.byBuilding.map(b=>`<tr><td>${esc(b.building)}</td><td class="stat">${num(b.count)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">—</td></tr>';
  loadAssetsPage();
}

async function loadAssetsPage(){
  const seq = ++inv.seq;
  $('invBody').innerHTML = `<tr><td colspan="7" class="empty">${t('common.loading')}</td></tr>`;
  const d = await call('listAssets', {projectId: inv.projectId, q: inv.q, limit: PAGE, offset: inv.offset});
  if(seq !== inv.seq) return;
  if(!d.ok){ $('invBody').innerHTML = `<tr><td colspan="7" class="form-err">${esc(msgOf(d, 'common.loadFailed'))}</td></tr>`; return; }
  inv.total = d.total; inv.rows = d.rows;
  $('invBody').innerHTML = d.rows.length ? d.rows.map((a,i)=>{
    const x = a.data || {};
    return `<tr data-asset="${i}" style="cursor:pointer">
      <td>${a.thumbUrl ? `<img src="${esc(a.thumbUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;display:block" loading="lazy">` : '<div style="width:48px;height:48px;border-radius:8px;background:var(--muted)"></div>'}</td>
      <td class="mono"><b>${esc(a.tag || '—')}</b>${a.flagged ? ` <span class="pill bad">${t('co.inv.flaggedPill')}</span>` : ''}</td>
      <td>${esc(x.name || '—')}</td>
      <td>${esc(x.category || '—')}${x.subCategory ? `<div class="sub">${esc(x.subCategory)}</div>` : ''}</td>
      <td>${esc([x.building, x.location].filter(Boolean).join(' - ') || '—')}</td>
      <td class="mono">${esc(a.username)}</td>
      <td class="mono">${fmtTime(a.syncedAt)}</td></tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">${inv.q ? t('common.noResults') : t('co.inv.emptyProject')}</td></tr>`;
  const from = d.total ? inv.offset + 1 : 0, to = Math.min(inv.offset + PAGE, d.total);
  $('invPageInfo').textContent = d.total ? t('co.inv.range', {from: num(from), to: num(to), total: num(d.total)}) : '';
  $('invPrev').disabled = inv.offset === 0;
  $('invNext').disabled = inv.offset + PAGE >= d.total;
}

$('invBody').addEventListener('click', (e)=>{
  const tr = e.target.closest('[data-asset]'); if(!tr) return;
  openAsset(inv.rows[Number(tr.dataset.asset)]);
});
async function openAsset(a){
  const x = a.data || {};
  $('am_tag').textContent = a.tag || '—';
  $('am_sub').textContent = t('co.inv.assetSub', {user: a.username, time: a.syncedAt ? isoTime(a.syncedAt) : '—'});
  const rows = [
    [fieldName('name'), x.name], [fieldName('category'), [x.catCode, x.category].filter(Boolean).join(' · ')],
    [fieldName('subcat'), [x.subCategoryCode, x.subCategory].filter(Boolean).join(' · ')],
    [fieldName('condition'), conditionName(x.condition)], [fieldName('building'), x.building], [fieldName('location'), x.location],
    [fieldName('brand'), x.brand], [fieldName('model'), x.model], [fieldName('sn'), x.sn], [fieldName('plateno'), x.plateNo],
    [fieldName('value'), x.value], [fieldName('notes'), x.notes],
    ...(x.deleteFlag ? [[t('co.inv.flagReason'), x.deleteFlag.reason]] : [])
  ].filter(([,v])=> v != null && v !== '');
  $('am_fields').innerHTML = rows.map(([k,v])=>`<tr><th style="width:160px">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const hashes = [...a.photos, ...(a.label ? [a.label] : [])];
  $('am_photos').innerHTML = `<div class="sub">${hashes.length ? t('co.inv.loadingPhotos') : t('co.inv.noPhotos')}</div>`;
  openModal('assetModal');
  if(!hashes.length) return;
  const d = await call('signPhotos', {hashes});
  if(!d.ok){ $('am_photos').innerHTML = `<div class="form-err">${esc(msgOf(d))}</div>`; return; }
  $('am_photos').innerHTML = hashes.map(h=> d.urls[h]
    ? `<a href="${esc(d.urls[h])}" target="_blank" rel="noopener"><img src="${esc(d.urls[h])}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block">${h === a.label ? `<div class="sub" style="text-align:center">${t('co.inv.nameplate')}</div>` : ''}</a>`
    : `<div class="sub">${t('co.inv.photoNotUploaded')}</div>`).join('');
}

// Loads every asset of the project (records only, no images) in pages of 1000.
async function fetchAllAssets(onProgress){
  const all = [];
  for(let off = 0; ; off += 1000){
    const d = await call('listAssets', {projectId: inv.projectId, limit: 1000, offset: off, thumbs: false});
    if(!d.ok) throw new Error(msgOf(d, 'common.loadFailed'));
    all.push(...d.rows);
    onProgress && onProgress(all.length, d.total);
    if(all.length >= d.total || !d.rows.length) break;
  }
  return all;
}
const projName = ()=> (data.projects.find(p=> p.id === inv.projectId)?.name || 'project').replace(/[\\/:*?"<>|]/g, '_');

$('invExcel').addEventListener('click', async ()=>{
  const btn = $('invExcel'); btn.disabled = true;
  try{
    const all = await fetchAllAssets((n, total)=> btn.textContent = t('co.inv.loadingN', {n: num(n), total: num(total)}));
    if(!all.length){ toast(t('co.inv.emptyProject')); return; }
    const HEADERS = ['Barcode','Category Code','Category Name','Sub Category Code','Sub Category Name','Description','Brand','Condition','Model','SN','PlateNo','Location','Building  Id','Remarks','Value'];
    const row = (a)=>{ const x = a.data || {}; return {
      'Barcode': a.tag || '', 'Category Code': x.catCode || '', 'Category Name': x.category || '',
      'Sub Category Code': x.subCategoryCode || '', 'Sub Category Name': x.subCategory || '', 'Description': x.name || '',
      'Brand': x.brand || '', 'Condition': x.condition || '', 'Model': x.model || '', 'SN': x.sn || '', 'PlateNo': x.plateNo || '',
      'Location': x.location || '', 'Building  Id': x.building || '', 'Remarks': x.notes || '',
      'Value': x.value ? Number(x.value) || x.value : '' }; };
    const ws = XLSX.utils.json_to_sheet(all.filter(a=> !a.flagged).map(row), {header: HEADERS});
    ws['!cols'] = [{wch:14},{wch:12},{wch:16},{wch:14},{wch:16},{wch:30},{wch:12},{wch:10},{wch:12},{wch:14},{wch:10},{wch:12},{wch:10},{wch:22},{wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('co.xl.sheet'));
    const flagged = all.filter(a=> a.flagged);
    if(flagged.length){
      const fws = XLSX.utils.json_to_sheet(flagged.map(a=>({
        'Barcode': a.tag || '', 'Description': a.data?.name || '', 'Category Name': a.data?.category || '',
        'Location': a.data?.location || '', 'Building  Id': a.data?.building || '',
        [t('co.xl.reason')]: a.data?.deleteFlag?.reason || '',
        [t('co.xl.flagDate')]: a.data?.deleteFlag?.at ? new Date(a.data.deleteFlag.at).toISOString().slice(0,10) : '',
        [t('co.xl.user')]: a.username
      })));
      fws['!cols'] = [{wch:14},{wch:30},{wch:16},{wch:12},{wch:10},{wch:30},{wch:12},{wch:16}];
      XLSX.utils.book_append_sheet(wb, fws, t('co.xl.flaggedSheet'));
    }
    XLSX.writeFile(wb, `${t('co.xl.file')}_${projName()}_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast(flagged.length ? t('co.inv.exportedFlagged', {n: num(all.length - flagged.length), f: num(flagged.length)}) : t('co.inv.exported', {n: num(all.length)}));
  }catch(e){ toast(e.message || t('common.failed')); }
  finally{ btn.disabled = false; btn.textContent = t('co.inv.excel'); }
});

// Photos: split into ZIP parts so the browser never holds the whole project at once.
const PART = 150;
let photoAssets = [];
$('invPhotosBtn').addEventListener('click', async ()=>{
  $('photosErr').textContent = '';
  $('photoParts').innerHTML = `<div class="sub">${t('common.loading')}</div>`;
  openModal('photosModal');
  try{
    photoAssets = (await fetchAllAssets()).filter(a=> a.photos.length || a.label);
  }catch(e){ $('photoParts').innerHTML = ''; $('photosErr').textContent = e.message; return; }
  if(!photoAssets.length){ $('photoParts').innerHTML = `<div class="hint">${t('co.photos.none')}</div>`; return; }
  const parts = Math.ceil(photoAssets.length / PART);
  $('photoParts').innerHTML = Array.from({length: parts}, (_, i)=>{
    const first = photoAssets[i * PART], last = photoAssets[Math.min(photoAssets.length, (i + 1) * PART) - 1];
    const n = Math.min(PART, photoAssets.length - i * PART);
    const count = photoAssets.slice(i * PART, i * PART + n).reduce((s, a)=> s + a.photos.length + (a.label ? 1 : 0), 0);
    return `<div class="dev"><div><b>${t('co.photos.part', {n: i + 1})}</b> <span class="sub">${t('co.photos.partInfo', {assets: num(n), photos: num(count)})}</span>
      <div class="sub mono" style="font-size:12px" dir="ltr">${esc(first.tag || '—')} → ${esc(last.tag || '—')}</div></div>
      <button class="btn btn-ghost btn-sm" data-part="${i}">${t('co.photos.download')}</button></div>`;
  }).join('');
});
$('photoParts').addEventListener('click', async (e)=>{
  const b = e.target.closest('[data-part]'); if(!b) return;
  const i = Number(b.dataset.part);
  const list = photoAssets.slice(i * PART, (i + 1) * PART);
  b.disabled = true;
  try{
    const hashes = [...new Set(list.flatMap(a=> [...a.photos, ...(a.label ? [a.label] : [])]))];
    const urls = {};
    for(let k = 0; k < hashes.length; k += 500){
      const d = await call('signPhotos', {hashes: hashes.slice(k, k + 500)});
      if(!d.ok) throw new Error(msgOf(d, 'common.loadFailed'));
      Object.assign(urls, d.urls);
    }
    const zip = new JSZip();
    const used = new Set();
    const unique = (base)=>{ let n = `${base}.jpg`, j = 2; while(used.has(n)) n = `${base}_${j++}.jpg`; used.add(n); return n; };
    const jobs = [];
    for(const a of list){
      const safe = (a.tag || 'asset').replace(/[\\/:*?"<>|]/g, '-');
      a.photos.forEach((h, n)=> jobs.push({h, name: unique(`${safe}-${n + 1}`)}));
      if(a.label) jobs.push({h: a.label, name: unique(`${safe}-label`)});
    }
    let done = 0, missing = 0;
    const worker = async ()=>{
      while(jobs.length){
        const j = jobs.shift();
        try{
          if(!urls[j.h]) throw 0;
          const r = await fetch(urls[j.h]);
          if(!r.ok) throw 0;
          zip.file(j.name, await r.blob());
        }catch{ missing++; }
        done++;
        b.textContent = `${done}/${done + jobs.length}`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    b.textContent = t('co.photos.zipping');
    const blob = await zip.generateAsync({type: 'blob'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t('co.photos.file')}_${projName()}_${i + 1}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 60000);
    b.textContent = t('co.photos.done');
    if(missing) $('photosErr').textContent = t('co.photos.missing', {n: missing});
  }catch(err){
    $('photosErr').textContent = err.message || t('common.failed');
    b.textContent = t('co.photos.retry');
  }finally{ b.disabled = false; }
});

if(token) load();
