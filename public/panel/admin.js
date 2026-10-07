// Provider panel (/admin): home dashboard, companies (list + one page per company), provider accounts,
// Claude spend, photo storage and the signed-in provider's own account. Pages are switched by the
// address hash (#home, #companies, #company/<id>, #providers, #claude, #storage, #account).
// Uses panel/common.js, panel/charts.js and the i18n texts (adm.*, common.*).
const TOKEN_KEY = 'jard_admin_token';
let token = '';          // per tab; closing the tab signs out
try{ token = sessionStorage.getItem(TOKEN_KEY) || ''; }catch{}
let data = {companies:[]};
let dash = null;         // dashboard numbers (activity + Claude)
let coFilter = 'all';

const today = ()=> new Date().toISOString().slice(0,10);
const isEmergency = ()=> !!data.me?.emergency;

async function call(action, extra={}){
  let r, d = {};
  try{
    r = await fetch('/api/admin', {
      method:'POST',
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
      body: JSON.stringify({action, ...extra})
    });
    d = await r.json();
  }catch{ return {ok:false, message:t('common.offline'), messageEn:t('common.offline')}; }
  if(action !== 'login' && r.status === 401) signOut(msgOf(d, 'common.sessionEnded'));
  return d;
}
function signOut(msg){
  token = '';
  try{ sessionStorage.removeItem(TOKEN_KEY); }catch{}
  closeModals();
  $('appView').style.display = 'none';
  $('loginView').style.display = 'block';
  $('loginErr').textContent = msg || '';
}
$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('loginErr').textContent = '';
  const d = await call('login', {username: $('adminUser').value.trim(), password: $('adminPass').value});
  if(!d.ok){ $('loginErr').textContent = msgOf(d, 'common.signInFailed'); return; }
  token = d.token;
  try{ sessionStorage.setItem(TOKEN_KEY, token); }catch{}
  $('adminPass').value = '';
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
  const s = await call('dashboard');
  if(s.ok){ dash = s; route(); }
}

// ---------- navigation ----------
const PAGES = ['home','companies','company','providers','claude','storage','account'];
function currentRoute(){
  const [page, id] = location.hash.replace(/^#/, '').split('/');
  return {page: PAGES.includes(page) ? page : (isEmergency() ? 'providers' : 'home'), id: decodeURIComponent(id || '')};
}
window.addEventListener('hashchange', ()=>{ route(); window.scrollTo(0, 0); });
$('menuBtn').addEventListener('click', ()=> $('appView').classList.toggle('nav-open'));
$('scrim').addEventListener('click', ()=> $('appView').classList.remove('nav-open'));
$('nav').addEventListener('click', (e)=>{ if(e.target.closest('a')) $('appView').classList.remove('nav-open'); });

function route(){
  if($('appView').style.display === 'none') return;
  const {page, id} = currentRoute();
  document.querySelectorAll('.page').forEach(p=> p.hidden = p.dataset.page !== page);
  document.querySelectorAll('#nav a').forEach(a=> a.classList.toggle('on', a.dataset.route === page || (page === 'company' && a.dataset.route === 'companies')));
  const titles = {home:'adm.nav.home', companies:'adm.nav.companies', company:'adm.nav.companies', providers:'adm.nav.providers', claude:'adm.nav.claude', storage:'adm.nav.storage', account:'adm.nav.account'};
  $('pageTitle').textContent = t(titles[page]);
  $('pageSub').textContent = page === 'home' ? t('adm.home.sub', {month: data.month || ''}) : '';
  ({home: renderHome, companies: renderCompanies, company: ()=> renderCompany(id), providers: renderProviders,
    claude: renderClaude, storage: renderStorage, account: renderAccount})[page]();
}

// ---------- shell: notices and the side menu ----------
function renderShell(){
  const me = data.me || {};
  $('meLbl').innerHTML = me.emergency
    ? `${esc(t('adm.emergency'))}<small>${esc(t('adm.emergencySub'))}</small>`
    : `${esc(me.displayName || me.username)}<small dir="ltr">${esc(me.email || me.username)}</small>`;
  const notes = [];
  if(me.emergency) notes.push(t('adm.note.emergency'));
  if(data.mail === false) notes.push(t('adm.note.noMail'));
  if(!me.emergency && !me.email) notes.push(t('adm.note.addEmail'));
  else if(!me.emergency && !me.emailVerified) notes.push(t('adm.note.verifyEmail'));
  $('notices').innerHTML = notes.map(n=> `<div class="notice">${n}</div>`).join('');
  const attention = data.companies.filter(s=> ['expired','soon','off'].includes(coState(s.company))).length;
  $('navCoCount').hidden = !attention;
  $('navCoCount').textContent = attention;
  $('coHint').innerHTML = t('adm.companiesHint', {url: `<span class="mono" dir="ltr">${esc(location.origin)}/company</span>`});
}

// ---------- shared bits ----------
function addMonthsMinusDay(start, months){
  const [y,m,d] = start.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1+Number(months), d));
  if(dt.getUTCDate() !== d) dt.setUTCDate(0);
  dt.setUTCDate(dt.getUTCDate()-1);
  return dt.toISOString().slice(0,10);
}
// active | soon (≤30 days) | expired | off (suspended)
function coState(c){
  if(!c.active) return 'off';
  const d = daysLeft(c.expiresAt);
  if(d !== null && d < 0) return 'expired';
  if(d !== null && d <= 30) return 'soon';
  return 'active';
}
function coStatus(c){
  const s = coState(c);
  if(s === 'off') return `<span class="pill bad">${t('adm.state.off')}</span>`;
  if(s === 'expired') return `<span class="pill bad">${t('adm.state.expired')}</span>`;
  if(s === 'soon') return `<span class="pill caution">${t('adm.state.soon', {n: daysLeft(c.expiresAt)})}</span>`;
  return `<span class="pill ok">${t('adm.state.active')}</span>`;
}
function accountStatus(a){
  return a.pending ? `<span class="pill caution">${t('common.pending')}</span>`
    : a.active ? `<span class="pill ok">${t('common.active')}</span>` : `<span class="pill bad">${t('common.suspended')}</span>`;
}
const snap = (id)=> data.companies.find(s=> s.company.id === id);
const activityOf = (id)=> (dash?.activity?.perCompany || []).find(x=> x.companyId === id);
const allAccounts = ()=> [
  ...(data.superAdmins || []).map(a=> ({...a, kind:'provider'})),
  ...data.companies.flatMap(s=> [...s.admins.map(a=> ({...a, kind:'admin', co:s.company})), ...s.users.map(u=> ({...u, kind:'user', co:s.company}))])
];
// Dollar amounts kept left-to-right inside Arabic text (invisible isolation marks).
const money = (v)=> v == null ? '—' : '\u2066$' + num(v, 2) + '\u2069';

// ---------- home ----------
function renderHome(){
  const cos = data.companies.map(s=> s.company);
  const states = cos.map(coState);
  const count = (s)=> states.filter(x=> x === s).length;
  const fieldUsers = data.companies.flatMap(s=> s.users);
  const admins = data.companies.flatMap(s=> s.admins);
  const devices = fieldUsers.reduce((n,u)=> n + (u.devices?.length || 0), 0);
  const pending = allAccounts().filter(a=> a.pending);
  const act = dash?.activity;
  const totalAssets = act ? act.perCompany.reduce((n,x)=> n + Number(x.assets), 0) : cos.reduce((n,c)=> n + Number(c.assetCount || 0), 0);
  const week = act ? act.perCompany.reduce((n,x)=> n + Number(x.week), 0) : null;
  const todayN = act ? act.perCompany.reduce((n,x)=> n + Number(x.today), 0) : null;
  const aiReq = cos.reduce((n,c)=> n + Number(c.usage?.count || 0), 0);
  const st = data.storage;
  const cl = dash?.claude;

  const k = [];
  k.push(kpi('#companies', t('adm.k.companies'), num(cos.length),
    `<span><i class="dot ok"></i> ${num(count('active'))} ${t('adm.state.active')}</span>` +
    (count('soon') ? `<span><i class="dot caution"></i> ${num(count('soon'))} ${t('adm.k.expiring')}</span>` : '') +
    (count('expired') + count('off') ? `<span><i class="dot bad"></i> ${num(count('expired') + count('off'))} ${t('adm.k.stopped')}</span>` : '')));
  k.push(kpi('#companies', t('adm.k.users'), num(fieldUsers.length),
    `<span>${num(admins.length)} ${t('adm.k.admins')}</span><span>· ${num(devices)} ${t('adm.k.devices')}</span>`));
  k.push(kpi('#companies', t('adm.k.assets'), num(totalAssets),
    week == null ? `<span>${t('adm.k.needsSql')}</span>` : `<span>+${num(week)} ${t('adm.k.thisWeek')}</span><span>· +${num(todayN)} ${t('adm.k.today')}</span>`));
  k.push(kpi('#claude', t('adm.k.claude'),
    cl?.configured && cl.monthUsd != null ? money(cl.monthUsd) : `${num(aiReq)} <small>${t('adm.k.requests')}</small>`,
    cl?.remainingUsd != null ? `<span>${t('adm.k.remaining')}: <b class="money">${money(cl.remainingUsd)}</b></span>` : `<span>${num(aiReq)} ${t('adm.k.requestsMonth')}</span>`,
    cl?.low));
  if(st) k.push(kpi('#storage', t('adm.k.storage'), `${num(st.pct, 1)}<small>%</small>`,
    `<span>${gb(st.bytes)} / ${gb(st.limitBytes)} GB</span>`, st.pct >= 80));
  k.push(kpi('#providers', t('adm.k.pending'), num(pending.length), `<span>${t('adm.k.pendingSub')}</span>`, false));
  $('homeKpis').innerHTML = k.join('');

  if(act) barChart($('chartAssets'), act.daily, {label: (r)=> shortDay(r.day), value: (r)=> Number(r.assets), highlightLast: true, title: t('adm.home.assetsDaily')});
  else $('chartAssets').innerHTML = `<div class="chart-empty">${t('adm.k.needsSql')}</div>`;

  const rows = data.companies.map(s=> ({s, a: activityOf(s.company.id)}))
    .sort((x,y)=> Number(y.a?.week || 0) - Number(x.a?.week || 0) || Number(y.s.company.assetCount || 0) - Number(x.s.company.assetCount || 0))
    .slice(0, 8);
  $('homeCoBody').innerHTML = rows.length ? rows.map(({s,a})=> `<tr class="link" data-go="#company/${encodeURIComponent(s.company.id)}">
      <td><b>${esc(s.company.customer)}</b></td><td>${coStatus(s.company)}</td>
      <td class="stat">${num(a?.assets ?? s.company.assetCount ?? 0)}</td><td class="stat">${a ? '+' + num(a.week) : '—'}</td>
      <td class="mono">${a?.lastSync ? fmtTime(a.lastSync) : '—'}</td></tr>`).join('')
    : `<tr><td colspan="5" class="empty">${t('adm.noCompanies')}</td></tr>`;

  // Needs attention: licences ending or stopped, companies at their user limit, companies without an admin.
  const att = [];
  for(const s of data.companies){
    const c = s.company, st = coState(c);
    if(st === 'expired') att.push([`<i class="dot bad"></i>`, c, t('adm.att.expired', {date: c.expiresAt})]);
    else if(st === 'soon') att.push([`<i class="dot caution"></i>`, c, t('adm.att.soon', {n: daysLeft(c.expiresAt), date: c.expiresAt})]);
    else if(st === 'off') att.push([`<i class="dot off"></i>`, c, t('adm.att.off')]);
    if(c.active && c.userCount >= c.maxUsers) att.push([`<i class="dot caution"></i>`, c, t('adm.att.full', {n: c.maxUsers})]);
    if(!s.admins.length) att.push([`<i class="dot caution"></i>`, c, t('adm.att.noAdmin')]);
    if(c.aiEnabled && c.aiMonthlyCap && c.usage.count >= c.aiMonthlyCap * 0.9) att.push([`<i class="dot caution"></i>`, c, t('adm.att.aiCap', {n: c.usage.count, cap: c.aiMonthlyCap})]);
  }
  if(cl?.low) att.unshift([`<i class="dot bad"></i>`, null, t('adm.att.claudeLow', {usd: money(cl.remainingUsd)})]);
  if(st && st.pct >= 80) att.unshift([`<i class="dot bad"></i>`, null, t('adm.att.storage', {pct: num(st.pct, 1)})]);
  $('attentionList').innerHTML = att.length ? att.slice(0, 8).map(([dot, c, text])=> `<div class="item">${dot}<div class="grow">
      ${c ? `<b><a href="#company/${encodeURIComponent(c.id)}">${esc(c.customer)}</a></b>` : ''}<span>${esc(text)}</span></div></div>`).join('')
    : `<div class="empty">${t('adm.att.none')}</div>`;

  $('pendingList').innerHTML = pending.length ? pending.slice(0, 6).map(a=> `<div class="item"><div class="grow">
      <b>${esc(a.displayName || a.username)}</b><span>${esc(t('adm.kind.' + a.kind))}${a.co ? ' · ' + esc(a.co.customer) : ''} · <span dir="ltr">${esc(a.email)}</span></span></div>
      <button class="btn btn-ghost btn-sm" data-resend="${esc(a.username)}">${t('common.resend')}</button></div>`).join('')
    : `<div class="empty">${t('adm.pendingNone')}</div>`;

  const recent = allAccounts().filter(a=> a.lastLogin).sort((x,y)=> String(y.lastLogin).localeCompare(String(x.lastLogin))).slice(0, 6);
  $('recentList').innerHTML = recent.length ? recent.map(a=> `<div class="item"><div class="grow">
      <b>${esc(a.displayName || a.username)}</b><span>${esc(t('adm.kind.' + a.kind))}${a.co ? ' · ' + esc(a.co.customer) : ''}</span></div>
      <span class="mono sub">${fmtTime(a.lastLogin)}</span></div>`).join('')
    : `<div class="empty">${t('common.noData')}</div>`;
}
function kpi(href, label, value, detail, warn){
  return `<a class="kpi${warn ? ' warn' : ''}" href="${href}"><span class="k">${esc(label)}</span><span class="v">${value}</span><span class="d">${detail || ''}</span></a>`;
}
const gb = (b)=> num(Number(b) / 1024**3, 2);

// ---------- companies ----------
$('search').addEventListener('input', ()=> renderCompanies());
function renderCompanies(){
  const states = {all: data.companies.length};
  for(const s of data.companies){ const st = coState(s.company); states[st] = (states[st] || 0) + 1; }
  $('coFilters').innerHTML = ['all','active','soon','expired','off'].map(f=>
    `<button type="button" class="chip${coFilter === f ? ' on' : ''}" data-filter="${f}">${t('adm.filter.' + f)}<span class="n">${num(states[f] || 0)}</span></button>`).join('');
  const q = $('search').value.trim().toLowerCase();
  const list = data.companies.filter(s=> (coFilter === 'all' || coState(s.company) === coFilter) && (!q || s.company.customer.toLowerCase().includes(q)));
  $('coBody').innerHTML = list.length ? list.map(s=>{
    const c = s.company, a = activityOf(c.id);
    const ai = c.aiEnabled ? `${num(c.usage.count)}${c.aiMonthlyCap ? ' / ' + num(c.aiMonthlyCap) : ''}` : t('common.off');
    return `<tr class="link" data-go="#company/${encodeURIComponent(c.id)}">
      <td><b>${esc(c.customer)}</b>${c.contactName ? `<div class="sub">${esc(c.contactName)}</div>` : ''}</td>
      <td>${coStatus(c)}</td><td class="mono">${esc(c.expiresAt || '—')}</td>
      <td class="stat">${num(c.userCount)}/${num(c.maxUsers)}</td><td class="stat">${num(s.projects.length)}</td>
      <td class="stat">${num(a?.assets ?? c.assetCount ?? 0)}</td><td class="stat">${ai}</td>
      <td class="mono">${a?.lastSync ? fmtTime(a.lastSync) : '—'}</td></tr>`;
  }).join('') : `<tr><td colspan="8" class="empty">${data.companies.length ? t('common.noResults') : t('adm.noCompanies')}</td></tr>`;
}

// ---------- one company ----------
function renderCompany(id){
  const s = snap(id);
  if(!s){ $('coDetail').innerHTML = `<div class="card empty">${t('adm.coMissing')}</div>`; return; }
  const c = s.company, a = activityOf(c.id);
  $('pageTitle').textContent = c.customer;
  const projById = Object.fromEntries(s.projects.map(p=>[p.id,p]));
  const ai = c.aiEnabled ? `${num(c.usage.count)}${c.aiMonthlyCap ? ' / ' + num(c.aiMonthlyCap) : ''}` : t('common.off');
  const devices = s.users.reduce((n,u)=> n + (u.devices?.length || 0), 0);
  $('coDetail').innerHTML = `
    <div class="detail-head">
      <div><div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap"><h2>${esc(c.customer)}</h2>${coStatus(c)}</div>
        ${c.contactName || c.contactPhone || c.contactEmail ? `<div class="sub" style="margin-top:4px">${esc(c.contactName || '')} <span dir="ltr" class="mono">${esc(c.contactPhone || '')}</span> <span dir="ltr">${esc(c.contactEmail || '')}</span></div>` : ''}</div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-edit-co="${esc(c.id)}">${t('common.edit')}</button>
        <button class="btn btn-ghost btn-sm" data-renew="${esc(c.id)}">${t('adm.renew.btn')}</button>
        <button class="btn btn-primary btn-sm" data-new-admin="${esc(c.id)}">${t('adm.addAdmin')}</button>
        <button class="btn btn-danger btn-sm" data-del-co="${esc(c.id)}">${t('common.delete')}</button>
      </div>
    </div>
    <div class="kpis">
      ${kpi('#company/' + encodeURIComponent(c.id), t('adm.d.licence'), c.expiresAt ? num(Math.max(0, daysLeft(c.expiresAt))) + ` <small>${t('common.days')}</small>` : '—', `<span class="mono">${esc(c.startsAt)} → ${esc(c.expiresAt || '—')}</span>`, ['expired','off'].includes(coState(c)))}
      ${kpi('#company/' + encodeURIComponent(c.id), t('adm.k.users'), `${num(c.userCount)}<small> / ${num(c.maxUsers)}</small>`, `<span>${num(devices)} ${t('adm.k.devices')} · ${num(c.maxDevicesPerUser)} ${t('adm.d.perUser')}</span>`, c.userCount >= c.maxUsers)}
      ${kpi('#company/' + encodeURIComponent(c.id), t('adm.k.assets'), num(a?.assets ?? c.assetCount ?? 0), a ? `<span>+${num(a.week)} ${t('adm.k.thisWeek')}</span>` : '')}
      ${kpi('#claude', t('adm.d.ai'), ai, `<span>${t('adm.k.requestsMonth')}</span>`)}
    </div>
    ${c.notes ? `<div class="notice info"><b>${t('adm.d.notes')}:</b> ${esc(c.notes)}</div>` : ''}
    <div class="card"><h3>${t('adm.d.admins')}</h3>${s.admins.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${t('common.username')}</th><th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('common.status')}</th><th>${t('common.lastLogin')}</th><th></th></tr></thead><tbody>
      ${s.admins.map(u=> `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.displayName || '—')}</td><td>${emailCell(u)}</td><td>${accountStatus(u)}</td><td class="mono">${fmt(u.lastLogin)}</td>
        <td><div class="actions">
          ${u.pending && u.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(u.username)}">${t('common.resend')}</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-edit-admin="${esc(c.id)}|${esc(u.username)}">${t('common.editPassword')}</button>
          <button class="btn btn-danger btn-sm" data-del-user="${esc(c.id)}|${esc(u.username)}">${t('common.delete')}</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="hint">${t('adm.d.noAdmin')}</div>`}</div>
    <div class="card"><h3>${t('adm.d.projects')}</h3>${s.projects.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${t('adm.d.project')}</th><th>${t('common.status')}</th><th>${t('adm.d.entryLang')}</th><th>${t('adm.d.required')}</th><th>${t('adm.d.categories')}</th><th>${t('adm.col.users')}</th><th>${t('adm.col.assets')}</th></tr></thead><tbody>
      ${s.projects.map(p=> `<tr><td><b>${esc(p.name)}</b></td><td>${p.active ? `<span class="pill ok">${t('common.active')}</span>` : `<span class="pill bad">${t('common.suspended')}</span>`}</td>
        <td>${langName(p.settings.lang)}</td><td class="stat">${num(p.settings.required.length)}${p.settings.minPhotos > 1 ? ' · ' + t('adm.d.photos', {n: p.settings.minPhotos}) : ''}</td>
        <td class="stat">${num(p.categoryCount)} / ${num(p.subCategoryCount)}</td><td class="stat">${num(p.userCount)}</td><td class="stat">${p.assetCount == null ? '—' : num(p.assetCount)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="hint">${t('adm.d.noProjects')}</div>`}</div>
    <div class="card"><h3>${t('adm.d.users')}</h3>${s.users.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${t('common.username')}</th><th>${t('common.name')}</th><th>${t('common.email')}</th><th>${t('adm.d.project')}</th><th>${t('common.status')}</th><th>${t('adm.col.devices')}</th><th>${t('common.lastLogin')}</th><th></th></tr></thead><tbody>
      ${s.users.map(u=> `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.displayName || '—')}</td><td>${emailCell(u)}</td>
        <td>${esc(projById[u.projectId]?.name || '—')}</td><td>${accountStatus(u)}</td><td class="stat">${num(u.devices.length)}/${num(c.maxDevicesPerUser)}</td>
        <td class="mono">${fmt(u.lastLogin)}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" data-reset="${esc(c.id)}|${esc(u.username)}" ${u.devices.length ? '' : 'disabled'}>${t('adm.d.releaseDevices')}</button>
          <button class="btn btn-danger btn-sm" data-del-user="${esc(c.id)}|${esc(u.username)}">${t('common.delete')}</button></div></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="hint">${t('adm.d.noUsers')}</div>`}</div>`;
}

// ---------- providers ----------
function renderProviders(){
  const me = data.me || {};
  const supers = data.superAdmins || [];
  $('superBody').innerHTML = supers.length ? supers.map(a=> `<tr>
      <td class="mono">${esc(a.username)}${a.username === me.username ? ` <span class="pill">${t('common.you')}</span>` : ''}</td>
      <td>${esc(a.displayName || '—')}</td><td>${emailCell(a)}</td><td>${accountStatus(a)}</td>
      <td class="mono">${fmtTime(a.lastLogin)}</td>
      <td><div class="actions">
        ${a.pending && a.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(a.username)}">${t('common.resend')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-edit-super="${esc(a.username)}">${t('common.editPassword')}</button>
        ${a.username === me.username ? '' : `<button class="btn btn-danger btn-sm" data-del-super="${esc(a.username)}">${t('common.delete')}</button>`}
      </div></td></tr>`).join('')
    : `<tr><td colspan="6" class="empty">${t('adm.prov.none')}</td></tr>`;
}

// ---------- Claude ----------
function renderClaude(){
  const cl = dash?.claude;
  const cos = data.companies.map(s=> s.company);
  const totalReq = cos.reduce((n,c)=> n + Number(c.usage?.count || 0), 0);
  const k = [];
  if(cl?.configured && !cl.error){
    k.push(kpi('#claude', t('adm.ai.month'), money(cl.monthUsd), `<span>${t('adm.ai.monthSub')}</span>`));
    if(cl.balance) k.push(kpi('#claude', t('adm.ai.remaining'), money(cl.remainingUsd),
      `<span>${t('adm.ai.since', {usd: money(cl.balance.usd), date: cl.balance.date})}</span>`, cl.low));
    if(cl.balance) k.push(kpi('#claude', t('adm.ai.spentSince'), money(cl.sinceBalanceUsd), `<span class="mono">${esc(cl.balance.date)} →</span>`));
  }
  k.push(kpi('#claude', t('adm.ai.requestsMonth'), num(totalReq), `<span>${t('adm.ai.requestsSub', {month: data.month || ''})}</span>`));
  $('aiKpis').innerHTML = k.join('');

  let setup = '';
  if(!cl) setup = `<div class="notice info">${t('common.loading')}</div>`;
  else if(!cl.configured) setup = `<div class="notice info"><b>${t('adm.ai.setupTitle')}</b><ol class="steps">${t('adm.ai.setupSteps')}</ol></div>`;
  else if(cl.error === 'bad_key') setup = `<div class="notice">${t('adm.ai.badKey')}</div>`;
  else if(cl.error) setup = `<div class="notice">${t('adm.ai.unreachable')}</div>`;
  else if(!cl.balance) setup = `<div class="notice info">${t('adm.ai.noBalance')}</div>`;
  $('aiSetup').innerHTML = setup;

  if(cl?.configured && cl.daily?.length) barChart($('chartCost'), cl.daily, {label: (r)=> shortDay(r.day), value: (r)=> r.usd, format: (v)=> '\u2066$' + num(v, v < 10 ? 2 : 0) + '\u2069', highlightLast: true, title: t('adm.ai.daily')});
  else $('chartCost').innerHTML = `<div class="chart-empty">${t(cl?.configured ? 'common.noData' : 'adm.ai.needsKey')}</div>`;
  $('aiUpdated').textContent = cl?.updatedAt ? t('adm.ai.updated', {time: isoTime(cl.updatedAt)}) : '';
  $('aiFreshBtn').hidden = !cl?.configured;

  const rows = data.companies.filter(s=> s.company.aiEnabled || s.company.usage.count)
    .sort((x,y)=> y.company.usage.count - x.company.usage.count);
  $('aiCoBody').innerHTML = rows.length ? rows.map(s=>{
    const c = s.company, share = totalReq ? Math.round(c.usage.count / totalReq * 100) : 0;
    return `<tr class="link" data-go="#company/${encodeURIComponent(c.id)}"><td><b>${esc(c.customer)}</b></td>
      <td class="stat">${num(c.usage.count)}</td><td class="stat">${c.aiEnabled ? (c.aiMonthlyCap ? num(c.aiMonthlyCap) : '∞') : t('common.off')}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1;margin:0"><i style="width:${share}%"></i></div><span class="stat">${share}%</span></div></td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">${t('common.noData')}</td></tr>`;

  const months = dash?.activity?.aiMonths || [];
  barChart($('chartAiMonths'), months, {label: (r)=> r.month.slice(2), value: (r)=> Number(r.count), highlightLast: true, height: 150, title: t('adm.ai.months')});

  const b = cl?.balance;
  if(document.activeElement?.form !== $('balanceForm')){
    $('b_usd').value = b?.usd ?? '';
    $('b_date').value = b?.date || today();
    $('b_warn').value = b?.warnUsd ?? 20;
  }
}
$('aiFreshBtn').addEventListener('click', async ()=>{
  $('aiFreshBtn').disabled = true;
  const d = await call('claude', {fresh: true});
  $('aiFreshBtn').disabled = false;
  if(d.ok){ dash = {...(dash || {}), claude: d.claude}; route(); } else toast(msgOf(d));
});
$('balanceForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('balanceErr').textContent = '';
  const d = await call('setClaudeBalance', {usd: $('b_usd').value, date: $('b_date').value, warnUsd: $('b_warn').value});
  if(!d.ok){ $('balanceErr').textContent = msgOf(d); return; }
  dash = {...(dash || {}), claude: d.claude};
  toast(t('common.saved'));
  document.activeElement?.blur();
  route();
});

// ---------- storage ----------
function renderStorage(){
  const st = data.storage;
  if(!st){ $('stKpis').innerHTML = ''; $('storageText').textContent = t('common.noData'); return; }
  $('stKpis').innerHTML = [
    kpi('#storage', t('adm.st.used'), `${gb(st.bytes)} <small>GB</small>`, `<span>${t('adm.st.of', {gb: gb(st.limitBytes)})}</span>`, st.pct >= 80),
    kpi('#storage', t('adm.st.files'), num(st.files), `<span>${t('adm.st.filesSub')}</span>`),
    kpi('#storage', t('adm.st.orphans'), num(st.orphanFiles || 0), `<span>${t('adm.st.orphansSub')}</span>`, !!st.orphanFiles)
  ].join('');
  $('storageText').innerHTML = `<b class="mono">${gb(st.bytes)} GB</b> / <span class="mono">${gb(st.limitBytes)} GB</span> (${num(st.pct, 1)}%)`
    + (st.pct >= 80 ? `<br><b style="color:var(--warn)">${t('adm.st.nearLimit')}</b>` : '');
  $('storageBar').style.width = Math.min(100, st.pct) + '%';
  $('storageBar').style.background = st.pct >= 80 ? 'var(--warn)' : '';
  $('cleanupBtn').hidden = !st.orphanFiles;
}
$('cleanupBtn').addEventListener('click', async ()=>{
  if(!confirm(t('adm.st.cleanupConfirm'))) return;
  const d = await call('cleanupPhotos');
  if(d.ok){ toast(t('adm.st.deleted', {n: d.deleted})); load(); } else toast(msgOf(d));
});

// ---------- my account ----------
function renderAccount(){
  const me = data.me || {};
  if(me.emergency){
    $('myForm').innerHTML = `<h2>${t('adm.nav.account')}</h2><p class="hint">${t('adm.note.emergency')}</p>`;
    return;
  }
  if(document.activeElement?.form === $('myForm')) return;
  $('my_display').value = me.displayName || '';
  $('my_email').value = me.email || '';
  $('my_emailState').textContent = !me.email ? t('common.emailNeeded') : me.emailVerified ? t('common.verified') : t('common.notVerified');
  $('my_cur').value = ''; $('my_new').value = ''; $('myErr').textContent = '';
}
$('myForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = {displayName: $('my_display').value, email: $('my_email').value};
  if($('my_new').value){ body.newPassword = $('my_new').value; body.currentPassword = $('my_cur').value; }
  const d = await call('updateMe', body);
  if(!d.ok){ $('myErr').textContent = msgOf(d); return; }
  document.activeElement?.blur();
  toast(d.verifySent ? t('common.verifySent') : body.newPassword ? t('common.passwordChanged') : t('common.saved'));
  load();
});

// ---------- windows: company ----------
document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', closeModals));
document.querySelectorAll('.modal-bg').forEach(m=> m.addEventListener('click', e=>{ if(e.target===m) closeModals(); }));
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModals(); });

function updateEnd(){
  const s = $('c_start').value, m = Number($('c_months').value);
  $('c_end').value = s && m > 0 ? addMonthsMinusDay(s, m) : '';
}
$('c_start').addEventListener('input', updateEnd);
$('c_months').addEventListener('input', updateEnd);

function openCompany(c){
  $('coTitle').textContent = c ? t('adm.co.edit') : t('adm.co.new');
  $('c_id').value = c?.id || '';
  $('c_name').value = c?.customer || '';
  $('c_contact').value = c?.contactName || '';
  $('c_phone').value = c?.contactPhone || '';
  $('c_email').value = c?.contactEmail || '';
  $('c_start').value = c?.startsAt || today();
  $('c_months').value = c?.months ?? 12;
  $('c_maxUsers').value = c?.maxUsers ?? 1;
  $('c_maxDevices').value = c?.maxDevicesPerUser ?? 1;
  $('c_aiCap').value = c?.aiMonthlyCap ?? 300;
  $('c_ai').checked = c ? c.aiEnabled !== false : true;
  $('c_active').checked = c ? c.active !== false : true;
  $('c_notes').value = c?.notes || '';
  $('coErr').textContent = '';
  updateEnd();
  openModal('coModal');
}
$('newCoBtn').addEventListener('click', ()=> openCompany(null));
$('coForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const isNew = !$('c_id').value;
  const d = await call('saveCompany', {company:{
    id: $('c_id').value || undefined,
    customer: $('c_name').value,
    contactName: $('c_contact').value, contactPhone: $('c_phone').value, contactEmail: $('c_email').value,
    startsAt: $('c_start').value, months: $('c_months').value,
    maxUsers: $('c_maxUsers').value, maxDevicesPerUser: $('c_maxDevices').value,
    aiMonthlyCap: $('c_aiCap').value, aiEnabled: $('c_ai').checked, active: $('c_active').checked,
    notes: $('c_notes').value
  }});
  if(!d.ok){ $('coErr').textContent = msgOf(d); return; }
  closeModals(); await load();
  if(isNew){
    location.hash = '#company/' + encodeURIComponent(d.company.company.id);
    toast(t('adm.co.created'));
    openAdmin(d.company.company.id, null);
  } else toast(t('common.saved'));
});

function renewTarget(c, add){
  const expired = c.expiresAt && c.expiresAt < today();
  return expired ? addMonthsMinusDay(today(), add) : addMonthsMinusDay(c.startsAt, c.months + add);
}
function updateRenew(){
  const c = snap($('r_id').value).company;
  const add = Math.max(1, Number($('r_months').value) || 0);
  const expired = c.expiresAt && c.expiresAt < today();
  $('renewPreview').innerHTML = t('adm.renew.preview', {date: `<b class="mono">${renewTarget(c, add)}</b>`}) + (expired ? '<br>' + t('adm.renew.fromToday') : '');
}
$('r_months').addEventListener('input', updateRenew);
$('renewForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const d = await call('renewCompany', {id: $('r_id').value, months: $('r_months').value});
  if(!d.ok){ $('renewErr').textContent = msgOf(d); return; }
  closeModals(); toast(t('adm.renew.done', {date: d.expiresAt})); load();
});

// ---------- windows: company admin, provider ----------
function genPassword(){
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(12); crypto.getRandomValues(arr);
  return Array.from(arr, n=> chars[n % chars.length]).join('');
}
$('aGenBtn').addEventListener('click', ()=>{ $('a_password').value = genPassword(); });
$('sGenBtn').addEventListener('click', ()=>{ $('s_password').value = genPassword() + genPassword().slice(0,4); });

function openAdmin(companyId, a){
  const isNew = !a;
  $('adTitle').textContent = isNew ? t('adm.admin.new') : t('adm.admin.edit');
  $('adCompany').textContent = snap(companyId)?.company.customer || '';
  $('a_company').value = companyId;
  $('a_username').value = a?.username || '';
  $('a_username').readOnly = !isNew;
  $('a_display').value = a?.displayName || '';
  $('a_email').value = a?.email || '';
  $('a_emailState').textContent = !a?.email ? '' : a.pending ? t('common.pendingInvite') : a.emailVerified ? t('common.verified') : t('common.notVerified');
  $('a_password').value = '';
  $('a_passLbl').textContent = isNew ? t('common.passwordOrInvite') : t('common.passwordKeep');
  $('a_active').checked = a ? a.active : true;
  $('adErr').textContent = '';
  openModal('adModal');
}
$('adForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const password = $('a_password').value;
  const d = await call('saveCompanyAdmin', {admin:{
    companyId: $('a_company').value, username: $('a_username').value, email: $('a_email').value,
    displayName: $('a_display').value, password: password || undefined, active: $('a_active').checked
  }});
  if(!d.ok){ $('adErr').textContent = msgOf(d); return; }
  closeModals(); load();
  if(d.invite){ inviteResult(d.user, d.invite); return; }
  if(d.verifySent) toast(t('common.savedVerify'));
  if(password){
    const text = t('adm.admin.credentials', {url: location.origin + '/company', user: d.user.username, pass: password});
    try{ await navigator.clipboard.writeText(text); toast(t('adm.admin.copied')); }
    catch{ prompt(t('adm.admin.copyPrompt'), text.replace(/\n/g,' | ')); }
  } else if(!d.verifySent) toast(t('common.saved'));
});

function openSuper(a){
  const isNew = !a;
  $('supTitle').textContent = isNew ? t('adm.prov.new') : t('adm.prov.edit');
  $('s_username').value = a?.username || '';
  $('s_username').readOnly = !isNew;
  $('s_display').value = a?.displayName || '';
  $('s_email').value = a?.email || '';
  $('s_password').value = '';
  $('s_passLbl').textContent = isNew ? t('common.passwordOrInvite') : t('common.passwordKeep');
  $('s_active').checked = a ? a.active : true;
  $('supErr').textContent = '';
  openModal('supModal');
}
$('newSuperBtn').addEventListener('click', ()=> openSuper(null));
$('supForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const d = await call('saveSuperAdmin', {admin:{
    username: $('s_username').value, displayName: $('s_display').value, email: $('s_email').value,
    password: $('s_password').value || undefined, active: $('s_active').checked
  }});
  if(!d.ok){ $('supErr').textContent = msgOf(d); return; }
  closeModals();
  if(d.invite) inviteResult(d.admin, d.invite);
  else toast(d.verifySent ? t('common.savedVerify') : t('common.saved'));
  if(isEmergency() && !(data.superAdmins || []).length) toast(t('adm.prov.firstCreated'));
  load();
});

// After an invitation: say where it went, or hand over the link if the email could not be sent.
async function inviteResult(user, invite){
  if(invite.sent){ toast(t('common.inviteSent', {email: user.email})); return; }
  const text = t('common.inviteText', {user: user.username, url: invite.url});
  try{ await navigator.clipboard.writeText(text); toast(t('common.inviteCopied')); }
  catch{ prompt(t('common.invitePrompt'), invite.url); }
}

// ---------- row actions ----------
document.addEventListener('click', async (e)=>{
  const row = e.target.closest('tr[data-go]');
  if(row && !e.target.closest('button, a')){ location.hash = row.dataset.go; return; }
  const filter = e.target.closest('[data-filter]');
  if(filter){ coFilter = filter.dataset.filter; renderCompanies(); return; }
  const b = e.target.closest('button'); if(!b) return;
  const ds = b.dataset;
  if(ds.editSuper) openSuper((data.superAdmins || []).find(a=> a.username === ds.editSuper));
  if(ds.resend){
    b.disabled = true;
    const d = await call('resendInvite', {username: ds.resend});
    b.disabled = false;
    if(d.ok) inviteResult(allAccounts().find(u=> u.username === ds.resend) || {username: ds.resend}, d.invite);
    else toast(msgOf(d));
  }
  if(ds.delSuper && confirm(t('adm.prov.confirmDelete', {user: ds.delSuper}))){
    const d = await call('deleteSuperAdmin', {username: ds.delSuper});
    if(d.ok){ toast(t('common.deleted')); load(); } else toast(msgOf(d));
  }
  if(ds.editCo) openCompany(snap(ds.editCo).company);
  if(ds.newAdmin) openAdmin(ds.newAdmin, null);
  if(ds.editAdmin){ const [cid,u] = ds.editAdmin.split('|'); openAdmin(cid, snap(cid).admins.find(a=>a.username===u)); }
  if(ds.renew){
    const c = snap(ds.renew).company;
    $('r_id').value = c.id; $('r_months').value = 12; $('renewErr').textContent = '';
    $('renewInfo').textContent = t('adm.renew.info', {name: c.customer, date: c.expiresAt || '—'});
    updateRenew(); openModal('renewModal');
  }
  if(ds.delCo){
    const s = snap(ds.delCo);
    if(confirm(t('adm.co.confirmDelete', {name: s.company.customer}))){
      const d = await call('deleteCompany', {id: s.company.id});
      if(d.ok){ toast(t('common.deleted')); location.hash = '#companies'; load(); } else toast(msgOf(d));
    }
  }
  if(ds.reset){
    const [cid,u] = ds.reset.split('|');
    if(confirm(t('adm.d.releaseConfirm', {user: u}))){
      const d = await call('resetDevices', {companyId: cid, username: u});
      if(d.ok){ toast(t('adm.d.released')); load(); } else toast(msgOf(d));
    }
  }
  if(ds.delUser){
    const [cid,u] = ds.delUser.split('|');
    if(confirm(t('common.confirmDeleteAccount', {user: u}))){
      const d = await call('deleteUser', {companyId: cid, username: u});
      if(d.ok){ toast(t('common.deleted')); load(); } else toast(msgOf(d));
    }
  }
});
if(token) load();
