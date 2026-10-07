// Provider panel (/admin): companies, licences, company admins, provider accounts, storage.
// Uses the helpers in panel/common.js.
const TOKEN_KEY = 'jard_admin_token';
let token = '';          // per tab; closing the tab signs out
try{ token = sessionStorage.getItem(TOKEN_KEY) || ''; }catch{}
let data = {companies:[]};
const openCos = new Set();
$('companyUrl').textContent = location.origin + '/company';

const today = ()=> new Date().toISOString().slice(0,10);

async function call(action, extra={}){
  let r, d = {};
  try{
    r = await fetch('/api/admin', {
      method:'POST',
      headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
      body: JSON.stringify({action, ...extra})
    });
    d = await r.json();
  }catch{ return {ok:false, message:'تعذّر الاتصال بالخادم'}; }
  if(action !== 'login' && r.status === 401) signOut(d.message || 'انتهت الجلسة. سجّل الدخول مجددًا');
  return d;
}
function signOut(msg){
  token = '';
  try{ sessionStorage.removeItem(TOKEN_KEY); }catch{}
  document.querySelectorAll('.modal-bg').forEach(m=>m.classList.remove('open'));
  $('appView').style.display = 'none';
  $('loginView').style.display = 'block';
  $('loginErr').textContent = msg || '';
}
$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('loginErr').textContent = '';
  const d = await call('login', {username: $('adminUser').value.trim(), password: $('adminPass').value});
  if(!d.ok){ $('loginErr').textContent = d.message || 'تعذّر الدخول'; return; }
  token = d.token;
  try{ sessionStorage.setItem(TOKEN_KEY, token); }catch{}
  $('adminPass').value = '';
  await load();
});
$('logoutBtn').addEventListener('click', ()=> signOut(''));
$('reloadBtn').addEventListener('click', load);
$('search').addEventListener('input', ()=> render(data));
async function load(){
  const d = await call('overview');
  if(!d.ok){ if(token) toast(d.message || 'تعذّر التحميل'); return; }
  $('loginView').style.display = 'none';
  $('appView').style.display = 'block';
  render(d);
}

// ---------- dates ----------
function addMonthsMinusDay(start, months){
  const [y,m,d] = start.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1+Number(months), d));
  if(dt.getUTCDate() !== d) dt.setUTCDate(0);
  dt.setUTCDate(dt.getUTCDate()-1);
  return dt.toISOString().slice(0,10);
}
function coStatus(c){
  if(!c.active) return '<span class="pill bad">موقوفة</span>';
  const d = daysLeft(c.expiresAt);
  if(d !== null && d < 0) return '<span class="pill bad">منتهية</span>';
  if(d !== null && d <= 30) return `<span class="pill bad">تنتهي خلال ${d} يوم</span>`;
  return '<span class="pill ok">فعّالة</span>';
}

// ---------- render ----------
function render(d){
  data = d;
  $('monthLbl').textContent = d.month || '';
  const me = d.me || {};
  $('meLbl').textContent = me.emergency ? 'دخول الطوارئ' : (me.displayName || me.username || '');
  $('emgCard').hidden = !me.emergency;
  $('myPassBtn').hidden = !!me.emergency;
  const notes = [];
  if(d.mail === false) notes.push('<b>إرسال البريد غير مفعّل:</b> أضف RESEND_API_KEY في Netlify. حتى ذلك الحين تظهر روابط الدعوة لتنسخها وترسلها بنفسك.');
  if(!me.emergency && !me.email) notes.push('<b>أضف بريدك</b> من «تغيير كلمة مروري» لتستطيع استعادة كلمة المرور بنفسك.');
  else if(!me.emergency && !me.emailVerified) notes.push('<b>بريدك غير مؤكَّد:</b> افتح رابط التأكيد الذي وصلك، أو احفظ بريدك مرة أخرى لإرسال رابط جديد.');
  $('noticeCard').innerHTML = notes.map(n=>`<div style="font-size:13.5px;line-height:1.8">${n}</div>`).join('');
  $('noticeCard').hidden = !notes.length;
  const st = d.storage;
  $('storageCard').hidden = !st;
  if(st){
    const gb = (b)=> (Number(b)/1024**3).toFixed(2);
    $('storageText').innerHTML = `<b class="mono">${gb(st.bytes)} GB</b> من <span class="mono">${gb(st.limitBytes)} GB</span> (${st.pct}%) · <span class="mono">${st.files}</span> ملف`
      + (st.orphanFiles ? ` · <span class="pill bad">${st.orphanFiles} ملف لشركات محذوفة</span>` : '')
      + (st.pct >= 80 ? '<br><b style="color:var(--warn)">اقترب التخزين من الحد. رقِّ خطة Supabase أو احذف صورًا قديمة قبل أن يفشل رفع الصور من الهواتف.</b>' : '');
    $('storageBar').style.width = Math.min(100, st.pct) + '%';
    $('storageBar').style.background = st.pct >= 80 ? 'var(--warn)' : 'var(--tag)';
    $('cleanupBtn').hidden = !st.orphanFiles;
  }
  const supers = d.superAdmins || [];
  $('superBody').innerHTML = supers.length ? supers.map(a=>`<tr>
      <td class="mono">${esc(a.username)}${a.username === me.username ? ' <span class="pill">أنت</span>' : ''}</td>
      <td>${esc(a.displayName || '—')}</td>
      <td>${emailCell(a)}</td>
      <td>${a.pending ? '<span class="pill">بانتظار التفعيل</span>' : a.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
      <td class="mono">${fmt(a.lastLogin)}</td>
      <td><div class="actions">
        ${a.pending && a.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(a.username)}">إعادة إرسال الدعوة</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-edit-super="${esc(a.username)}">تعديل / كلمة مرور</button>
        ${a.username === me.username ? '' : `<button class="btn btn-danger btn-sm" data-del-super="${esc(a.username)}">حذف</button>`}
      </div></td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">لا توجد حسابات بعد. أنشئ حسابك الآن.</td></tr>';
  const q = $('search').value.trim().toLowerCase();
  const list = d.companies.filter(s=> !q || s.company.customer.toLowerCase().includes(q));
  $('coList').innerHTML = list.length ? list.map(renderCompany).join('')
    : `<div class="empty">${d.companies.length ? 'لا توجد نتائج' : 'لا توجد شركات بعد. ابدأ بإنشاء أول شركة.'}</div>`;
}

function renderCompany(s){
  const c = s.company;
  const projById = Object.fromEntries(s.projects.map(p=>[p.id,p]));
  const admins = s.admins.length ? `<div class="table-wrap"><table>
      <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>البريد</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead><tbody>
      ${s.admins.map(a=>`<tr>
        <td class="mono">${esc(a.username)}</td><td>${esc(a.displayName || '—')}</td>
        <td>${emailCell(a)}</td>
        <td>${a.pending ? '<span class="pill">بانتظار التفعيل</span>' : a.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
        <td class="mono">${fmt(a.lastLogin)}</td>
        <td><div class="actions">
          ${a.pending && a.email ? `<button class="btn btn-ghost btn-sm" data-resend="${esc(a.username)}">إعادة إرسال الدعوة</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-edit-admin="${esc(c.id)}|${esc(a.username)}">تعديل / كلمة مرور</button>
          <button class="btn btn-danger btn-sm" data-del-user="${esc(c.id)}|${esc(a.username)}">حذف</button>
        </div></td></tr>`).join('')}
      </tbody></table></div>`
    : '<div class="hint">لا يوجد مدير لهذه الشركة بعد. أضف مديرًا ليتمكن العميل من إدارة حسابه.</div>';

  const projects = s.projects.length ? `<div class="table-wrap"><table>
      <thead><tr><th>المشروع</th><th>الحالة</th><th>لغة الإدخال</th><th>حقول إجبارية</th><th>الفئات</th><th>المستخدمون</th><th>الأصول</th></tr></thead><tbody>
      ${s.projects.map(p=>`<tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${p.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
        <td>${langName(p.settings.lang)}</td>
        <td class="stat">${p.settings.required.length}${p.settings.minPhotos>1 ? ` · ${p.settings.minPhotos} صور` : ''}</td>
        <td class="stat">${p.categoryCount} / ${p.subCategoryCount}</td>
        <td class="stat">${p.userCount}</td><td class="stat">${p.assetCount == null ? '—' : p.assetCount}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<div class="hint">لم يُنشئ مدير الشركة أي مشروع بعد.</div>';

  const users = s.users.length ? `<div class="table-wrap"><table>
      <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>البريد</th><th>المشروع</th><th>الحالة</th><th>الأجهزة</th><th>آخر دخول</th><th></th></tr></thead><tbody>
      ${s.users.map(u=>`<tr>
        <td class="mono">${esc(u.username)}</td><td>${esc(u.displayName || '—')}</td>
        <td>${emailCell(u)}</td>
        <td>${esc(projById[u.projectId]?.name || '—')}</td>
        <td>${u.pending ? '<span class="pill">بانتظار التفعيل</span>' : u.active ? '<span class="pill ok">فعّال</span>' : '<span class="pill bad">موقوف</span>'}</td>
        <td class="stat">${u.devices.length}/${c.maxDevicesPerUser}</td>
        <td class="mono">${fmt(u.lastLogin)}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" data-reset="${esc(c.id)}|${esc(u.username)}" ${u.devices.length ? '' : 'disabled'}>تحرير الأجهزة</button>
          <button class="btn btn-danger btn-sm" data-del-user="${esc(c.id)}|${esc(u.username)}">حذف</button>
        </div></td></tr>`).join('')}
      </tbody></table></div>`
    : '<div class="hint">لا يوجد مستخدمون ميدانيون بعد.</div>';

  const ai = c.aiEnabled ? `${c.usage.count}${c.aiMonthlyCap ? ' / ' + c.aiMonthlyCap : ''}` : 'غير مفعّل';
  return `<div class="co ${openCos.has(c.id) ? 'open' : ''}" data-co="${esc(c.id)}">
    <div class="co-head">
      <div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;"><h2>${esc(c.customer)}</h2>${coStatus(c)}</div>
        <div class="co-meta">
          <span>من <b class="mono">${esc(c.startsAt)}</b> لمدة <b>${c.months}</b> شهر حتى <b class="mono">${esc(c.expiresAt || '—')}</b></span>
          <span>المستخدمون <b class="mono">${c.userCount}/${c.maxUsers}</b></span>
          <span>أجهزة/مستخدم <b class="mono">${c.maxDevicesPerUser}</b></span>
          <span>المشاريع <b class="mono">${s.projects.length}</b></span>
          <span>AI هذا الشهر <b class="mono">${ai}</b></span>
          ${c.assetCount != null ? `<span>الأصول المرفوعة <b class="mono">${c.assetCount}</b></span>` : ''}
          ${c.contactName || c.contactPhone ? `<span>${esc(c.contactName)} <span class="mono">${esc(c.contactPhone)}</span></span>` : ''}
        </div>
        ${c.notes ? `<div class="sub" style="margin-top:6px">${esc(c.notes)}</div>` : ''}
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-toggle="${esc(c.id)}">${openCos.has(c.id) ? 'إخفاء التفاصيل' : 'التفاصيل'}</button>
        <button class="btn btn-ghost btn-sm" data-edit-co="${esc(c.id)}">تعديل</button>
        <button class="btn btn-ghost btn-sm" data-renew="${esc(c.id)}">تجديد</button>
        <button class="btn btn-primary btn-sm" data-new-admin="${esc(c.id)}">+ مدير الشركة</button>
        <button class="btn btn-danger btn-sm" data-del-co="${esc(c.id)}">حذف</button>
      </div>
    </div>
    <div class="co-body">
      <h3>مديرو الشركة</h3>${admins}
      <h3>المشاريع</h3>${projects}
      <h3>المستخدمون الميدانيون</h3>${users}
    </div>
  </div>`;
}

// ---------- modals ----------
document.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', closeModals));
document.querySelectorAll('.modal-bg').forEach(m=> m.addEventListener('click', e=>{ if(e.target===m) closeModals(); }));
const snap = (id)=> data.companies.find(s=> s.company.id === id);

function updateEnd(){
  const s = $('c_start').value, m = Number($('c_months').value);
  $('c_end').value = s && m > 0 ? addMonthsMinusDay(s, m) : '';
}
$('c_start').addEventListener('input', updateEnd);
$('c_months').addEventListener('input', updateEnd);

function openCompany(c){
  $('coTitle').textContent = c ? 'تعديل الشركة' : 'شركة جديدة';
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
  if(!d.ok){ $('coErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals(); await load();
  if(isNew){ toast('تم إنشاء الشركة. أضف الآن مدير الشركة'); openAdmin(d.company.company.id, null); }
  else toast('تم الحفظ');
});

function renewTarget(c, add){
  const expired = c.expiresAt && c.expiresAt < today();
  return expired ? addMonthsMinusDay(today(), add) : addMonthsMinusDay(c.startsAt, c.months + add);
}
function updateRenew(){
  const c = snap($('r_id').value).company;
  const add = Math.max(1, Number($('r_months').value) || 0);
  const expired = c.expiresAt && c.expiresAt < today();
  $('renewPreview').innerHTML = `تصبح نهاية الرخصة <b class="mono">${renewTarget(c, add)}</b>` +
    (expired ? '<br>الرخصة منتهية، فيبدأ التجديد من اليوم.' : '');
}
$('r_months').addEventListener('input', updateRenew);
$('renewForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const d = await call('renewCompany', {id: $('r_id').value, months: $('r_months').value});
  if(!d.ok){ $('renewErr').textContent = d.message || 'تعذّر التجديد'; return; }
  closeModals(); toast('تم التجديد حتى ' + d.expiresAt); load();
});

function genPassword(){
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(12); crypto.getRandomValues(arr);
  return Array.from(arr, n=> chars[n % chars.length]).join('');
}
$('aGenBtn').addEventListener('click', ()=>{ $('a_password').value = genPassword(); });

function openAdmin(companyId, a){
  const isNew = !a;
  $('adTitle').textContent = isNew ? 'مدير شركة جديد' : 'تعديل مدير الشركة';
  $('adCompany').textContent = snap(companyId)?.company.customer || '';
  $('a_company').value = companyId;
  $('a_username').value = a?.username || '';
  $('a_username').readOnly = !isNew;
  $('a_display').value = a?.displayName || '';
  $('a_email').value = a?.email || '';
  $('a_emailState').textContent = !a?.email ? '' : a.pending ? 'بانتظار التفعيل من رابط الدعوة' : a.emailVerified ? 'مؤكَّد ✓' : 'غير مؤكَّد';
  $('a_password').value = '';
  $('a_passLbl').textContent = isNew ? 'كلمة المرور (اتركها فارغة لإرسال دعوة)' : 'كلمة مرور جديدة (اتركها فارغة للإبقاء)';
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
  if(!d.ok){ $('adErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  openCos.add($('a_company').value);
  closeModals(); load();
  if(d.invite){ inviteResult(d.user, d.invite); return; }
  if(d.verifySent) toast('تم الحفظ وأُرسل رابط تأكيد إلى البريد الجديد');
  if(password){
    const text = `لوحة إدارة الشركة: ${location.origin}/company\nاسم المستخدم: ${d.user.username}\nكلمة المرور: ${password}`;
    try{ await navigator.clipboard.writeText(text); toast('تم الحفظ ونسخ بيانات الدخول لإرسالها للعميل'); }
    catch{ prompt('بيانات الدخول (انسخها وأرسلها للعميل):', text.replace(/\n/g,' | ')); }
  } else toast('تم الحفظ');
});

// ---------- email helpers ----------
// After an invitation: say where it went, or hand over the link if the email could not be sent.
async function inviteResult(user, invite){
  if(invite.sent){ toast(`أُرسلت دعوة التفعيل إلى ${user.email}`); return; }
  const text = `رابط تفعيل حسابك في أمان (${user.username}):\n${invite.url}`;
  try{ await navigator.clipboard.writeText(text); toast('تعذّر إرسال البريد، فنُسخ رابط التفعيل. أرسله بنفسك (صالح 7 أيام).'); }
  catch{ prompt('تعذّر إرسال البريد. انسخ رابط التفعيل وأرسله:', invite.url); }
}
$('cleanupBtn').addEventListener('click', async ()=>{
  if(!confirm('حذف صور الشركات المحذوفة نهائيًا من التخزين؟')) return;
  const d = await call('cleanupPhotos');
  if(d.ok){ toast(`حُذف ${d.deleted} ملف`); load(); } else toast(d.message || 'تعذّر الحذف');
});

// ---------- provider admins ----------
$('sGenBtn').addEventListener('click', ()=>{ $('s_password').value = genPassword() + genPassword().slice(0,4); });
function openSuper(a){
  const isNew = !a;
  $('supTitle').textContent = isNew ? 'حساب مزوّد جديد' : 'تعديل حساب المزوّد';
  $('s_username').value = a?.username || '';
  $('s_username').readOnly = !isNew;
  $('s_display').value = a?.displayName || '';
  $('s_email').value = a?.email || '';
  $('s_password').value = '';
  $('s_passLbl').textContent = isNew ? 'كلمة المرور (اتركها فارغة لإرسال دعوة)' : 'كلمة مرور جديدة (اتركها فارغة للإبقاء)';
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
  if(!d.ok){ $('supErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals();
  if(d.invite) inviteResult(d.admin, d.invite);
  else toast(d.verifySent ? 'تم الحفظ وأُرسل رابط تأكيد إلى البريد' : 'تم الحفظ');
  if(data.me?.emergency && !(data.superAdmins || []).length) toast('تم إنشاء حسابك. اخرج وادخل به من الآن');
  load();
});
$('myPassBtn').textContent = 'حسابي وكلمة المرور';
$('myPassBtn').addEventListener('click', ()=>{
  $('my_display').value = data.me?.displayName || '';
  $('my_email').value = data.me?.email || '';
  $('my_emailState').textContent = !data.me?.email ? 'مطلوب لاستعادة كلمة المرور بنفسك' : data.me.emailVerified ? 'مؤكَّد ✓' : 'غير مؤكَّد';
  $('my_cur').value = ''; $('my_new').value = ''; $('myErr').textContent = '';
  openModal('myModal');
});
$('myForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const body = {displayName: $('my_display').value, email: $('my_email').value};
  if($('my_new').value){ body.newPassword = $('my_new').value; body.currentPassword = $('my_cur').value; }
  const d = await call('updateMe', body);
  if(!d.ok){ $('myErr').textContent = d.message || 'تعذّر الحفظ'; return; }
  closeModals();
  toast(d.verifySent ? 'تم الحفظ. أرسلنا رابط تأكيد إلى بريدك' : body.newPassword ? 'تم تغيير كلمة المرور' : 'تم الحفظ');
  load();
});

// ---------- row actions ----------
document.addEventListener('click', async (e)=>{
  const b = e.target.closest('button'); if(!b) return;
  const ds = b.dataset;
  if(ds.editSuper) openSuper((data.superAdmins || []).find(a=> a.username === ds.editSuper));
  if(ds.resend){
    const d = await call('resendInvite', {username: ds.resend});
    const all = [...(data.superAdmins || []), ...data.companies.flatMap(s=> [...s.admins, ...s.users])];
    if(d.ok) inviteResult(all.find(u=> u.username === ds.resend) || {username: ds.resend}, d.invite);
    else toast(d.message || 'تعذّر الإرسال');
  }
  if(ds.delSuper){
    if(confirm(`حذف حساب المزوّد ${ds.delSuper}؟`)){
      const d = await call('deleteSuperAdmin', {username: ds.delSuper});
      if(d.ok){ toast('تم الحذف'); load(); } else toast(d.message || 'تعذّر الحذف');
    }
  }
  if(ds.toggle){ openCos.has(ds.toggle) ? openCos.delete(ds.toggle) : openCos.add(ds.toggle); render(data); }
  if(ds.editCo) openCompany(snap(ds.editCo).company);
  if(ds.newAdmin) openAdmin(ds.newAdmin, null);
  if(ds.editAdmin){ const [cid,u] = ds.editAdmin.split('|'); openAdmin(cid, snap(cid).admins.find(a=>a.username===u)); }
  if(ds.renew){
    const c = snap(ds.renew).company;
    $('r_id').value = c.id; $('r_months').value = 12; $('renewErr').textContent = '';
    $('renewInfo').textContent = `${c.customer}: تنتهي حاليًا في ${c.expiresAt || '—'}`;
    updateRenew(); openModal('renewModal');
  }
  if(ds.delCo){
    const s = snap(ds.delCo);
    if(confirm(`حذف شركة ${s.company.customer} ومشاريعها نهائيًا؟`)){
      const d = await call('deleteCompany', {id: s.company.id});
      if(d.ok){ toast('تم الحذف'); load(); } else toast(d.message || 'تعذّر الحذف');
    }
  }
  if(ds.reset){
    const [cid,u] = ds.reset.split('|');
    if(confirm(`تحرير كل أجهزة ${u}؟ سيتمكن من الدخول من جهاز جديد، ويتوقف الجهاز القديم عند أول اتصال.`)){
      const d = await call('resetDevices', {companyId: cid, username: u});
      if(d.ok){ toast('تم تحرير الأجهزة'); load(); } else toast(d.message || 'تعذّر التنفيذ');
    }
  }
  if(ds.delUser){
    const [cid,u] = ds.delUser.split('|');
    if(confirm(`حذف الحساب ${u} نهائيًا؟`)){
      const d = await call('deleteUser', {companyId: cid, username: u});
      if(d.ok){ toast('تم الحذف'); load(); } else toast(d.message || 'تعذّر الحذف');
    }
  }
});
if(token) load();
