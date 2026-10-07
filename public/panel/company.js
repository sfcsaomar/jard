// Company panel (/company): licence, synced inventory, projects, field users and devices, own account.
// Uses the helpers in panel/common.js.
const TOKEN_KEY = 'jard_company_token';
let token = '';
let data = null;
try{ token = sessionStorage.getItem(TOKEN_KEY) || ''; }catch{}

const FIELDS = [
  ['category','الفئة'], ['subcat','الفئة الفرعية'], ['name','الوصف'], ['condition','الحالة'],
  ['building','رقم المبنى'], ['location','الموقع / الغرفة'], ['catcode','كود الفئة'],
  ['subcatcode','كود الفئة الفرعية'], ['brand','الماركة'], ['model','الموديل'], ['sn','الرقم التسلسلي'],
  ['plateno','رقم اللوحة'], ['value','القيمة'], ['notes','الملاحظات']
];
const FIELD_NAME = Object.fromEntries(FIELDS);
$('p_required').innerHTML = FIELDS.map(([k,t])=>`<label><input type="checkbox" value="${k}">${t}</label>`).join('');


async function call(action, extra={}){
  let r, d = {};
  try{
    r = await fetch('/api/company', {
      method:'POST',
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
      body: JSON.stringify({action, ...extra})
    });
    d = await r.json();
  }catch{ return {ok:false, message:'تعذّر الاتصال بالخادم. تحقق من الإنترنت'}; }
  if(action !== 'login' && (r.status === 401 || ['user_disabled','company_disabled','no_company'].includes(d.code))){
    signOut(d.message);
  }
  return d;
}
function signOut(msg){
  token = ''; data = null;
  try{ sessionStorage.removeItem(TOKEN_KEY); }catch{}
  document.querySelectorAll('.modal-bg').forEach(m=>m.classList.remove('open'));
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
  if(!d.ok){ $('loginErr').textContent = d.message || 'تعذّر تسجيل الدخول'; return; }
  token = d.token;
  try{ sessionStorage.setItem(TOKEN_KEY, token); }catch{}
  $('lg_pass').value = '';
  await load();
});
$('logoutBtn').addEventListener('click', ()=> signOut(''));
$('reloadBtn').addEventListener('click', ()=> load());

async function load(){
  const d = await call('overview');
  if(!d.ok){ if(token) toast(d.message || 'تعذّر التحميل'); return; }
  data = d;
  $('loginView').style.display = 'none';
  $('appView').style.display = 'block';
  render();
}

// ---------- tabs ----------
$('tabs').addEventListener('click', (e)=>{
  const b = e.target.closest('[data-tab]'); if(!b) return;
  showTab(b.dataset.tab);
});
function showTab(name){
  document.querySelectorAll('#tabs .tab').forEach(t=> t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('[data-pane]').forEach(p=> p.hidden = p.dataset.pane !== name);
  if(name === 'inventory' && data?.sync) loadInventory();
}

// ---------- render ----------
function render(){
  const c = data.company;
  $('coName').textContent = c.customer;
  $('meLbl').textContent = data.me.displayName ? `${data.me.displayName} (${data.me.username})` : data.me.username;

  const d = daysLeft(c.expiresAt);
  $('licStatus').innerHTML = !c.active ? '<span class="pill bad">موقوفة</span>'
    : d !== null && d < 0 ? '<span class="pill bad">منتهية: المستخدمون لا يستطيعون العمل</span>'
    : d !== null && d <= 30 ? `<span class="pill bad">تنتهي خلال ${d} يوم</span>` : '<span class="pill ok">فعّالة</span>';
  const usedPct = (a, b)=> b ? Math.min(100, Math.round(a / b * 100)) : 0;
  const totalDevices = data.users.reduce((n,u)=> n + u.devices.length, 0);
  const tiles = [
    ['مدة الرخصة', `${c.months} <small>شهر</small>`, `من ${esc(c.startsAt)}`],
    ['تنتهي في', esc(c.expiresAt || '—'), d !== null && d >= 0 ? `متبقٍ ${d} يوم` : ''],
    ['المستخدمون', `${c.userCount} <small>/ ${c.maxUsers}</small>`, '', usedPct(c.userCount, c.maxUsers)],
    ['الأجهزة المسجّلة', `${totalDevices} <small>/ ${c.maxUsers * c.maxDevicesPerUser}</small>`, `${c.maxDevicesPerUser} لكل مستخدم`, usedPct(totalDevices, c.maxUsers * c.maxDevicesPerUser)],
    ['طلبات الذكاء الاصطناعي هذا الشهر', c.aiEnabled ? `${c.usage.count}${c.aiMonthlyCap ? ` <small>/ ${c.aiMonthlyCap}</small>` : ''}` : '<small>غير مفعّل</small>',
      c.aiEnabled && !c.aiMonthlyCap ? 'بلا حد شهري' : '', c.aiMonthlyCap ? usedPct(c.usage.count, c.aiMonthlyCap) : null],
    ['المشاريع', String(data.projects.length), ''],
    ...(data.sync && c.assetCount != null ? [['الأصول المرفوعة للخادم', String(c.assetCount), 'من كل المشاريع']] : [])
  ];
  $('licTiles').innerHTML = tiles.map(([k,v,s,p])=>`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>
    ${s ? `<div class="sub" style="font-size:12px">${s}</div>` : ''}${p != null && p !== '' ? `<div class="bar"><i style="width:${p}%"></i></div>` : ''}</div>`).join('');

  $('projBody').innerHTML = data.projects.length ? data.projects.map(p=>`<tr>
    <td><b>${esc(p.name)}</b>${p.notes ? `<div class="sub">${esc(p.notes)}</div>` : ''}</td>
    <td>${p.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
    <td>${langName(p.settings.lang)}</td>
    <td>${p.settings.required.length ? `<span class="pill" title="${esc(p.settings.required.map(k=>FIELD_NAME[k]).join('، '))}">${p.settings.required.length} حقل</span>` : '<span class="sub">الأساسية فقط</span>'}${p.settings.minPhotos > 1 ? ` <span class="pill">${p.settings.minPhotos} صور</span>` : ''}</td>
    <td>${p.categoryCount ? `<span class="stat">${p.categoryCount}</span> رئيسية · <span class="stat">${p.subCategoryCount}</span> فرعية` : '<span class="sub">لم تُستورد</span>'}</td>
    <td class="stat">${p.userCount}</td>
    <td class="stat">${p.assetCount == null ? '—' : p.assetCount}</td>
    <td><div class="actions">
      <button class="btn btn-ghost btn-sm" data-edit-proj="${esc(p.id)}">الإعدادات</button>
      <button class="btn btn-ghost btn-sm" data-cats="${esc(p.id)}">الفئات</button>
      <button class="btn btn-danger btn-sm" data-del-proj="${esc(p.id)}">حذف</button>
    </div></td></tr>`).join('') : '<tr><td colspan="8" class="empty">لا توجد مشاريع بعد. أنشئ أول مشروع، ثم أضف المستخدمين إليه.</td></tr>';

  const projById = Object.fromEntries(data.projects.map(p=>[p.id,p]));
  const full = c.userCount >= c.maxUsers;
  $('userQuota').textContent = `${c.userCount} من ${c.maxUsers} مستخدم · ${c.maxDevicesPerUser} جهاز لكل مستخدم` + (full ? ' · وصلت للحد الأعلى' : '');
  $('newUserBtn').disabled = full || !data.projects.length;
  $('newUserBtn').title = !data.projects.length ? 'أنشئ مشروعًا أولًا' : full ? 'وصلت الرخصة للحد الأعلى من المستخدمين' : '';
  $('userBody').innerHTML = data.users.length ? data.users.map(u=>`<tr>
    <td class="mono">${esc(u.username)}</td><td>${esc(u.displayName || '—')}</td>
    <td>${emailCell(u)}</td>
    <td>${esc(projById[u.projectId]?.name || '—')}</td>
    <td>${u.pending ? '<span class="pill">بانتظار التفعيل</span>' : u.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
    <td class="stat">${u.devices.length}/${c.maxDevicesPerUser}</td>
    <td class="mono">${fmt(u.lastLogin)}</td>
    <td><div class="actions">
      ${u.pending && u.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(u.username)}">إعادة إرسال الدعوة</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-edit-user="${esc(u.username)}">تعديل</button>
      <button class="btn btn-ghost btn-sm" data-devices="${esc(u.username)}">الأجهزة</button>
      <button class="btn btn-danger btn-sm" data-del-user="${esc(u.username)}">حذف</button>
    </div></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">${data.projects.length ? 'لا يوجد مستخدمون بعد.' : 'أنشئ مشروعًا أولًا من تبويب «المشاريع»، ثم أضف المستخدمين.'}</td></tr>`;

  renderInventoryShell();
  $('m_user').value = data.me.username;
  if(document.activeElement !== $('m_display')) $('m_display').value = data.me.displayName || '';
  if(document.activeElement !== $('m_email')) $('m_email').value = data.me.email || '';
  $('m_emailState').textContent = !data.me.email ? 'أضف بريدك لتستطيع استعادة كلمة المرور بنفسك'
    : data.me.emailVerified ? 'مؤكَّد ✓' : 'غير مؤكَّد: افتح رابط التأكيد الذي وصلك';
}

// ---------- modals ----------
document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', closeModals));
document.querySelectorAll('.modal-bg').forEach(m=> m.addEventListener('click', e=>{ if(e.target===m) closeModals(); }));

// ---------- projects ----------
function openProject(p){
  $('projTitle').textContent = p ? 'إعدادات المشروع' : 'مشروع جديد';
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
  if(!d.ok){ $('projErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals(); await load();
  if(isNew){ toast('تم إنشاء المشروع. استورد فئاته الآن'); openCategories(d.id); }
  else toast('تم الحفظ. تصل الإعدادات للهواتف عند أول اتصال');
});

// ---------- categories ----------
let catProject = null, catDraft = null;
async function openCategories(projectId){
  catProject = data.projects.find(p=> p.id === projectId);
  $('catProjName').textContent = catProject?.name || '';
  $('catErr').textContent = ''; $('catFile').value = '';
  catDraft = null; $('catSaveBtn').disabled = true;
  $('catSummary').textContent = 'جارٍ التحميل...'; $('catPreview').innerHTML = '';
  openModal('catModal');
  const d = await call('getProject', {projectId});
  if(!d.ok){ $('catSummary').textContent = d.message || ''; return; }
  catProject.categories = d.project.categories || [];
  showCategories(catProject.categories, false);
}
function showCategories(cats, isDraft){
  const subs = cats.reduce((n,c)=> n + c.subs.length, 0);
  $('catSummary').innerHTML = cats.length
    ? `${isDraft ? '<b>معاينة الملف:</b> ' : 'القائمة الحالية: '}<span class="stat">${cats.length}</span> فئة رئيسية، <span class="stat">${subs}</span> فئة فرعية${isDraft ? '. اضغط «حفظ الفئات» لاعتمادها.' : ''}`
    : 'لا توجد فئات. بدون قائمة، يكتب المستخدم الفئة والأكواد يدويًا.';
  const rows = [];
  for(const c of cats){
    if(!c.subs.length) rows.push(`<tr><td class="mono">${esc(c.code)}</td><td><b>${esc(c.name)}</b></td><td></td><td class="sub">—</td></tr>`);
    c.subs.forEach((s,i)=> rows.push(`<tr><td class="mono">${i ? '' : esc(c.code)}</td><td>${i ? '' : `<b>${esc(c.name)}</b>`}</td><td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td></tr>`));
    if(rows.length > 600){ rows.push('<tr><td colspan="4" class="sub">... والباقي</td></tr>'); break; }
  }
  $('catPreview').innerHTML = cats.length ? `<table><thead><tr><th>كود الفئة</th><th>الفئة الرئيسية</th><th>كود الفرعية</th><th>الفئة الفرعية</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
  $('catPreview').style.display = cats.length ? '' : 'none';
}

// Header detection: English or Arabic, any order. Falls back to columns A-D.
function classify(h){
  const t = String(h || '').toLowerCase().replace(/[_\-.]/g,' ').replace(/\s+/g,' ').trim();
  if(!t) return null;
  const sub = /sub|فرعي/.test(t), code = /code|كود|رمز|no\b|رقم/.test(t);
  const name = /name|اسم|category|cat\b|فئة|الفئه|تصنيف/.test(t);
  if(code && /cat|فئ|تصنيف|sub|فرع/.test(t)) return sub ? 'subCode' : 'code';
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
    if(!cats.length){ $('catErr').textContent = 'لم أجد فئات في الملف. تأكد من الأعمدة كما في القالب.'; return; }
    catDraft = cats;
    showCategories(cats, true);
    $('catSaveBtn').disabled = false;
  }catch(e){ $('catErr').textContent = 'تعذّرت قراءة الملف. استخدم ملف Excel (.xlsx) أو CSV.'; }
}
$('catFile').addEventListener('change', (e)=>{ const f = e.target.files[0]; if(f) readCatFile(f); });
$('drop').addEventListener('dragover', (e)=>{ e.preventDefault(); });
$('drop').addEventListener('drop', (e)=>{ e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) readCatFile(f); });
$('catSaveBtn').addEventListener('click', async ()=>{
  if(!catDraft) return;
  const d = await call('setCategories', {projectId: catProject.id, categories: catDraft});
  if(!d.ok){ $('catErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals(); toast('تم حفظ الفئات. تصل للهواتف عند أول اتصال'); load();
});
$('catClearBtn').addEventListener('click', async ()=>{
  if(!confirm('إفراغ قائمة فئات هذا المشروع؟ سيكتب المستخدمون الفئات يدويًا.')) return;
  const d = await call('setCategories', {projectId: catProject.id, categories: []});
  if(d.ok){ closeModals(); toast('تم إفراغ القائمة'); load(); } else $('catErr').textContent = d.message || 'تعذّر الحفظ';
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

// ---------- users ----------
function genPassword(){
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(10); crypto.getRandomValues(arr);
  return Array.from(arr, n=> chars[n % chars.length]).join('');
}
$('genPassBtn').addEventListener('click', ()=>{ $('u_password').value = genPassword(); });
function openUser(u){
  const isNew = !u;
  $('userTitle').textContent = isNew ? 'مستخدم جديد' : 'تعديل المستخدم';
  $('u_username').value = u?.username || '';
  $('u_username').readOnly = !isNew;
  $('u_display').value = u?.displayName || '';
  $('u_project').innerHTML = data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.active ? '' : ' (موقوف)'}</option>`).join('');
  if(u?.projectId) $('u_project').value = u.projectId;
  $('u_email').value = u?.email || '';
  $('u_emailState').textContent = !u?.email ? '' : u.pending ? 'بانتظار التفعيل من رابط الدعوة'
    : u.emailVerified ? 'مؤكَّد ✓' : 'غير مؤكَّد';
  $('u_password').value = '';
  $('u_passLbl').textContent = isNew ? 'كلمة المرور (اتركها فارغة لإرسال دعوة بالبريد)' : 'كلمة مرور جديدة (اتركها فارغة للإبقاء)';
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
  if(!d.ok){ $('userErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals(); load();
  if(d.invite){ inviteResult(d.user, d.invite); return; }
  if(d.verifySent) toast('تم الحفظ وأُرسل رابط تأكيد إلى البريد الجديد');
  if(password){
    const text = `تطبيق الجرد: ${location.origin}\nاسم المستخدم: ${d.user.username}\nكلمة المرور: ${password}`;
    try{ await navigator.clipboard.writeText(text); toast('تم الحفظ ونسخ بيانات الدخول لإرسالها للمستخدم'); }
    catch{ prompt('بيانات الدخول (انسخها وأرسلها للمستخدم):', text.replace(/\n/g,' | ')); }
  } else toast('تم الحفظ');
});

// After an invitation: say where it went, or hand over the link if the email could not be sent.
async function inviteResult(user, invite){
  if(invite.sent){ toast(`أُرسلت دعوة التفعيل إلى ${user.email}`); return; }
  const text = `رابط تفعيل حسابك في أمان (${user.username}):\n${invite.url}`;
  try{ await navigator.clipboard.writeText(text); alertBox('تعذّر إرسال البريد، فنُسخ رابط التفعيل. أرسله للمستخدم بنفسك (صالح 7 أيام).'); }
  catch{ prompt('تعذّر إرسال البريد. انسخ رابط التفعيل وأرسله للمستخدم:', invite.url); }
}
function alertBox(m){ toast(m); }

let devUser = null;
function openDevices(username){
  devUser = data.users.find(u=> u.username === username);
  if(!devUser) return;
  const max = data.company.maxDevicesPerUser;
  $('devInfo').textContent = `${devUser.displayName || devUser.username}: ${devUser.devices.length} من ${max} جهاز مسجّل`;
  $('devList').innerHTML = devUser.devices.length ? devUser.devices.map((d,i)=>`<div class="dev">
      <div><b>جهاز ${i+1}</b> <span class="mono sub">${esc(d.short)}</span>
        <div class="sub" style="font-size:12px">سُجّل ${fmt(d.addedAt)} · آخر اتصال ${fmt(d.lastSeen)}</div></div>
      <button class="btn btn-danger btn-sm" data-release="${esc(d.id)}">تحرير</button></div>`).join('')
    : '<div class="hint">لا توجد أجهزة مسجّلة. يسجّل الهاتف تلقائيًا عند أول دخول للمستخدم.</div>';
  openModal('devModal');
}

document.addEventListener('click', async (e)=>{
  const b = e.target.closest('button'); if(!b || !data) return;
  const ds = b.dataset;
  if(ds.editProj) openProject(data.projects.find(p=> p.id === ds.editProj));
  if(ds.cats) openCategories(ds.cats);
  if(ds.delProj){
    const p = data.projects.find(x=> x.id === ds.delProj);
    if(confirm(`حذف المشروع «${p.name}» وفئاته نهائيًا؟`)){
      const d = await call('deleteProject', {projectId: p.id});
      if(d.ok){ toast('تم الحذف'); load(); } else toast(d.message || 'تعذّر الحذف');
    }
  }
  if(ds.editUser) openUser(data.users.find(u=> u.username === ds.editUser));
  if(ds.resend){
    const d = await call('resendInvite', {username: ds.resend});
    if(d.ok) inviteResult(data.users.find(u=> u.username === ds.resend), d.invite); else toast(d.message || 'تعذّر الإرسال');
  }
  if(ds.devices) openDevices(ds.devices);
  if(ds.release){
    if(!confirm('تحرير هذا الجهاز؟ يتوقف عند أول اتصال، ويستطيع المستخدم الدخول من هاتف جديد.')) return;
    const d = await call('removeDevice', {username: devUser.username, deviceId: ds.release});
    if(!d.ok){ toast(d.message || 'تعذّر التنفيذ'); return; }
    toast('تم تحرير الجهاز');
    await load(); openDevices(devUser.username);
  }
  if(ds.delUser){
    if(confirm(`حذف المستخدم ${ds.delUser} نهائيًا؟ تأكد أنه صدّر بيانات الجرد من هاتفه أولًا.`)){
      const d = await call('deleteUser', {username: ds.delUser});
      if(d.ok){ toast('تم الحذف'); load(); } else toast(d.message || 'تعذّر الحذف');
    }
  }
});

// ---------- inventory (synced from phones) ----------
const PAGE = 50;
const inv = {projectId: '', offset: 0, total: 0, rows: [], q: '', stats: null, seq: 0};
const CONDITION_AR = {'Good':'جيد','New':'جديد','Fair':'متوسط','Needs Maintenance':'يحتاج صيانة'};

function renderInventoryShell(){
  $('invOff').hidden = !!data.sync;
  $('invOn').hidden = !data.sync;
  if(!data.sync) return;
  const sel = $('invProject');
  const keep = inv.projectId && data.projects.some(p=> p.id === inv.projectId) ? inv.projectId : data.projects[0]?.id || '';
  sel.innerHTML = data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.assetCount ? ` (${p.assetCount})` : ''}</option>`).join('');
  sel.value = inv.projectId = keep;
  if(!document.querySelector('[data-pane=inventory]').hidden) loadInventory();
}
$('invProject').addEventListener('change', ()=>{ inv.projectId = $('invProject').value; inv.offset = 0; loadInventory(); });
$('invReload').addEventListener('click', ()=> loadInventory());
let searchTimer = null;
$('invSearch').addEventListener('input', ()=>{
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ inv.q = $('invSearch').value.trim(); inv.offset = 0; loadAssetsPage(); }, 350);
});
$('invPrev').addEventListener('click', ()=>{ inv.offset = Math.max(0, inv.offset - PAGE); loadAssetsPage(); });
$('invNext').addEventListener('click', ()=>{ if(inv.offset + PAGE < inv.total){ inv.offset += PAGE; loadAssetsPage(); } });

async function loadInventory(){
  if(!inv.projectId){ $('invTiles').innerHTML = '<div class="hint">أنشئ مشروعًا أولًا.</div>'; return; }
  const d = await call('inventoryStats', {projectId: inv.projectId});
  if(!d.ok){ $('invTiles').innerHTML = `<div class="form-err">${esc(d.message || 'تعذّر التحميل')}</div>`; return; }
  const st = inv.stats = d.stats;
  $('invTiles').innerHTML = [
    ['الأصول', st.total], ['موسومة للحذف', st.flagged], ['الصور', st.photos],
    ['آخر رفع', st.lastSync ? `<span style="font-size:14px">${fmtTime(st.lastSync)}</span>` : '—']
  ].map(([k,v])=>`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('invByUser').innerHTML = st.byUser.length ? st.byUser.map(u=>`<tr><td class="mono">${esc(u.username)}</td><td class="stat">${u.count}</td><td class="mono">${fmtTime(u.lastSync)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">لم يُرفع شيء بعد</td></tr>';
  $('invByBuilding').innerHTML = st.byBuilding.length ? st.byBuilding.map(b=>`<tr><td>${esc(b.building)}</td><td class="stat">${b.count}</td></tr>`).join('')
    : '<tr><td colspan="2" class="empty">—</td></tr>';
  loadAssetsPage();
}

async function loadAssetsPage(){
  const seq = ++inv.seq;
  $('invBody').innerHTML = '<tr><td colspan="7" class="empty">جارٍ التحميل...</td></tr>';
  const d = await call('listAssets', {projectId: inv.projectId, q: inv.q, limit: PAGE, offset: inv.offset});
  if(seq !== inv.seq) return;
  if(!d.ok){ $('invBody').innerHTML = `<tr><td colspan="7" class="form-err">${esc(d.message || 'تعذّر التحميل')}</td></tr>`; return; }
  inv.total = d.total; inv.rows = d.rows;
  $('invBody').innerHTML = d.rows.length ? d.rows.map((a,i)=>{
    const x = a.data || {};
    return `<tr data-asset="${i}" style="cursor:pointer">
      <td>${a.thumbUrl ? `<img src="${esc(a.thumbUrl)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;display:block" loading="lazy">` : '<div style="width:48px;height:48px;border-radius:8px;background:var(--muted)"></div>'}</td>
      <td class="mono"><b>${esc(a.tag || '—')}</b>${a.flagged ? ' <span class="pill bad">للحذف</span>' : ''}</td>
      <td>${esc(x.name || '—')}</td>
      <td>${esc(x.category || '—')}${x.subCategory ? `<div class="sub">${esc(x.subCategory)}</div>` : ''}</td>
      <td>${esc([x.building, x.location].filter(Boolean).join(' - ') || '—')}</td>
      <td class="mono">${esc(a.username)}</td>
      <td class="mono">${fmtTime(a.syncedAt)}</td></tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">${inv.q ? 'لا توجد نتائج' : 'لا توجد أصول مرفوعة في هذا المشروع بعد'}</td></tr>`;
  const from = d.total ? inv.offset + 1 : 0, to = Math.min(inv.offset + PAGE, d.total);
  $('invPageInfo').textContent = d.total ? `${from}-${to} من ${d.total}` : '';
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
  $('am_sub').textContent = `${a.username} · رُفع ${a.syncedAt ? isoTime(a.syncedAt) : '—'}`;
  const rows = [
    ['الوصف', x.name], ['الفئة', [x.catCode, x.category].filter(Boolean).join(' · ')],
    ['الفئة الفرعية', [x.subCategoryCode, x.subCategory].filter(Boolean).join(' · ')],
    ['الحالة', CONDITION_AR[x.condition] || x.condition], ['المبنى', x.building], ['الموقع / الغرفة', x.location],
    ['الماركة', x.brand], ['الموديل', x.model], ['الرقم التسلسلي', x.sn], ['رقم اللوحة', x.plateNo],
    ['القيمة', x.value], ['الملاحظات', x.notes],
    ...(x.deleteFlag ? [['سبب وسم الحذف', x.deleteFlag.reason]] : [])
  ].filter(([,v])=> v != null && v !== '');
  $('am_fields').innerHTML = rows.map(([k,v])=>`<tr><th style="width:160px">${k}</th><td>${esc(v)}</td></tr>`).join('');
  const hashes = [...a.photos, ...(a.label ? [a.label] : [])];
  $('am_photos').innerHTML = hashes.length ? '<div class="sub">جارٍ تحميل الصور...</div>' : '<div class="sub">لا توجد صور</div>';
  openModal('assetModal');
  if(!hashes.length) return;
  const d = await call('signPhotos', {hashes});
  if(!d.ok){ $('am_photos').innerHTML = `<div class="form-err">${esc(d.message || '')}</div>`; return; }
  $('am_photos').innerHTML = hashes.map(h=> d.urls[h]
    ? `<a href="${esc(d.urls[h])}" target="_blank" rel="noopener"><img src="${esc(d.urls[h])}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;display:block">${h === a.label ? '<div class="sub" style="text-align:center">لوحة البيانات</div>' : ''}</a>`
    : '<div class="sub">الصورة لم تُرفع بعد</div>').join('');
}

// Loads every asset of the project (records only, no images) in pages of 1000.
async function fetchAllAssets(onProgress){
  const all = [];
  for(let off = 0; ; off += 1000){
    const d = await call('listAssets', {projectId: inv.projectId, limit: 1000, offset: off, thumbs: false});
    if(!d.ok) throw new Error(d.message || 'تعذّر التحميل');
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
    const all = await fetchAllAssets((n, t)=> btn.textContent = `جارٍ التحميل ${n}/${t}`);
    if(!all.length){ toast('لا توجد أصول مرفوعة في هذا المشروع'); return; }
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
    XLSX.utils.book_append_sheet(wb, ws, 'جرد الأصول');
    const flagged = all.filter(a=> a.flagged);
    if(flagged.length){
      const fws = XLSX.utils.json_to_sheet(flagged.map(a=>({
        'Barcode': a.tag || '', 'Description': a.data?.name || '', 'Category Name': a.data?.category || '',
        'Location': a.data?.location || '', 'Building  Id': a.data?.building || '',
        'سبب الحذف': a.data?.deleteFlag?.reason || '',
        'تاريخ الوسم': a.data?.deleteFlag?.at ? new Date(a.data.deleteFlag.at).toISOString().slice(0,10) : '',
        'المستخدم': a.username
      })));
      fws['!cols'] = [{wch:14},{wch:30},{wch:16},{wch:12},{wch:10},{wch:30},{wch:12},{wch:16}];
      XLSX.utils.book_append_sheet(wb, fws, 'مطلوب حذفها');
    }
    XLSX.writeFile(wb, `جرد_${projName()}_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast(`تم تصدير ${all.length - flagged.length} أصل${flagged.length ? ` و${flagged.length} في ورقة «مطلوب حذفها»` : ''}`);
  }catch(e){ toast(e.message || 'تعذّر التصدير'); }
  finally{ btn.disabled = false; btn.textContent = 'تصدير Excel'; }
});

// Photos: split into ZIP parts so the browser never holds the whole project at once.
const PART = 150;
let photoAssets = [];
$('invPhotosBtn').addEventListener('click', async ()=>{
  $('photosErr').textContent = '';
  $('photoParts').innerHTML = '<div class="sub">جارٍ تجهيز القائمة...</div>';
  openModal('photosModal');
  try{
    photoAssets = (await fetchAllAssets()).filter(a=> a.photos.length || a.label);
  }catch(e){ $('photoParts').innerHTML = ''; $('photosErr').textContent = e.message; return; }
  if(!photoAssets.length){ $('photoParts').innerHTML = '<div class="hint">لا توجد صور مرفوعة في هذا المشروع بعد.</div>'; return; }
  const parts = Math.ceil(photoAssets.length / PART);
  $('photoParts').innerHTML = Array.from({length: parts}, (_, i)=>{
    const first = photoAssets[i * PART], last = photoAssets[Math.min(photoAssets.length, (i + 1) * PART) - 1];
    const n = Math.min(PART, photoAssets.length - i * PART);
    const count = photoAssets.slice(i * PART, i * PART + n).reduce((s, a)=> s + a.photos.length + (a.label ? 1 : 0), 0);
    return `<div class="dev"><div><b>الجزء ${i + 1}</b> <span class="sub">${n} أصل · ${count} صورة</span>
      <div class="sub mono" style="font-size:12px">${esc(first.tag || '—')} ← ${esc(last.tag || '—')}</div></div>
      <button class="btn btn-ghost btn-sm" data-part="${i}">تنزيل</button></div>`;
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
      if(!d.ok) throw new Error(d.message || 'تعذّر التحميل');
      Object.assign(urls, d.urls);
    }
    const zip = new JSZip();
    const used = new Set();
    const unique = (base)=>{ let n = `${base}.jpg`, j = 2; while(used.has(n)) n = `${base}_${j++}.jpg`; used.add(n); return n; };
    const jobs = [];
    for(const a of list){
      const safe = (a.tag || 'اصل').replace(/[\\/:*?"<>|]/g, '-');
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
    b.textContent = 'جارٍ الضغط...';
    const blob = await zip.generateAsync({type: 'blob'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `صور_${projName()}_جزء${i + 1}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 60000);
    b.textContent = 'تم ✓';
    if(missing) $('photosErr').textContent = `${missing} صورة لم تُنزَّل (قد لا تكون رُفعت بعد من الهاتف).`;
  }catch(err){
    $('photosErr').textContent = err.message || 'تعذّر التنزيل';
    b.textContent = 'إعادة المحاولة';
  }finally{ b.disabled = false; }
});

// ---------- my account ----------
$('meForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('meErr').textContent = '';
  const body = {displayName: $('m_display').value, email: $('m_email').value};
  if($('m_new').value){ body.newPassword = $('m_new').value; body.currentPassword = $('m_cur').value; }
  const d = await call('updateMe', body);
  if(!d.ok){ $('meErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  $('m_cur').value = ''; $('m_new').value = '';
  toast(d.verifySent ? 'تم الحفظ. أرسلنا رابط تأكيد إلى بريدك' : body.newPassword ? 'تم تغيير كلمة المرور' : 'تم الحفظ');
  load();
});

if(token) load();
