// Field inventory app — Sign-in, licence checks, offline grace period, and the account sheet.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Session & license ----------
const SESSION_KEY = 'ai_session_v1';
const DEVICE_KEY = 'ai_device_v1';
let session = null; // {token, license, lastCheck}

function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch{ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch{} }

function deviceId(){
  let id = lsGet(DEVICE_KEY);
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    lsSet(DEVICE_KEY, id);
  }
  return id;
}

function tokenPayload(token){
  try{
    const b = token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
    const txt = decodeURIComponent(escape(atob(b + '==='.slice((b.length + 3) % 4))));
    return JSON.parse(txt);
  }catch{ return null; }
}

async function api(path, body, token){
  const headers = {'Content-Type':'application/json'};
  if(token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(path, {method:'POST', headers, body: JSON.stringify(body || {})});
  let data = {};
  try{ data = await r.json(); }catch{}
  return {status: r.status, ...data};
}

// Codes that mean the server has definitively refused this session (not a network issue).
const HARD_FAIL = ['user_disabled','no_license','license_disabled','license_expired','device_unknown','device_mismatch','session_expired','bad_credentials'];

function showLogin(message){
  $('loginScreen').classList.remove('hidden', 'booting');
  $('loginErr').textContent = message || '';
  $('lg_pass').value = '';
}

async function enterApp(){
  const p = tokenPayload(session.token);
  DB_NAME = 'assetInventoryDB_' + p.u;
  if(db){ try{ db.close(); }catch{} db = null; }
  await openDB();
  $('loginScreen').classList.add('hidden');
  renderLicenseBanner();
  await refreshList($('searchBox').value);
  await loadLocationBar();
  await ensurePersistentStorage();
  renderInstallCard();
  updateSyncUi();
  scheduleSync(1500);
}

async function doLogout(message){
  session = null;
  lsDel(SESSION_KEY);
  if(db){ try{ db.close(); }catch{} db = null; }
  document.querySelectorAll('.sheet.open').forEach(s=> s.classList.remove('open'));
  $('listWrap').innerHTML = '';
  $('installCard').classList.remove('show');
  showLogin(message);
}

async function verifyOnline(){
  if(!session || !navigator.onLine) return false;
  try{
    const r = await api('/api/refresh', {deviceId: deviceId()}, session.token);
    if(r.ok){
      session = {token: r.token, license: r.license, lastCheck: Date.now()};
      lsSet(SESSION_KEY, session);
      renderLicenseBanner();
      updateSyncUi();
      if($('formSheet').classList.contains('open')){ applyFieldSettings(); updateDescMeta(); }
      return true;
    }
    if(HARD_FAIL.includes(r.code)){ await doLogout(r.message); }
  }catch(e){ /* offline or server unreachable: keep working within grace */ }
  return false;
}

function daysLeft(dateStr){
  if(!dateStr) return null;
  return Math.ceil((new Date(dateStr + 'T23:59:59Z').getTime() - Date.now()) / 86400000);
}

function renderLicenseBanner(){
  const el = $('licBanner');
  if(!session){ el.classList.remove('show'); return; }
  const msgs = [];
  const d = daysLeft(session.license.expiresAt);
  if(d !== null && d <= 14) msgs.push(`تنتهي الرخصة خلال ${d} يوم. تواصل مع المزوّد للتجديد.`);
  const p = tokenPayload(session.token);
  const g = Math.ceil((p.exp - Date.now()) / 86400000);
  if(g <= 2) msgs.push(`اتصل بالإنترنت خلال ${g} يوم لتجديد التحقق وإلا سيُطلب منك تسجيل الدخول.`);
  if(backupMsg) msgs.push(backupMsg);
  el.textContent = msgs.join(' ');
  el.classList.toggle('show', msgs.length > 0);
}

$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const username = $('lg_user').value.trim();
  const password = $('lg_pass').value;
  if(!username || !password){ $('loginErr').textContent = 'أدخل اسم المستخدم وكلمة المرور'; return; }
  if(!navigator.onLine){ $('loginErr').textContent = 'تسجيل الدخول يحتاج اتصالًا بالإنترنت'; return; }
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'جارٍ التحقق...';
  try{
    const r = await api('/api/login', {username, password, deviceId: deviceId()});
    if(!r.ok){ $('loginErr').textContent = r.message || 'تعذّر تسجيل الدخول'; return; }
    session = {token: r.token, license: r.license, lastCheck: Date.now()};
    lsSet(SESSION_KEY, session);
    await enterApp();
    toast('أهلًا ' + (r.license.displayName || r.license.username));
  }catch(err){
    $('loginErr').textContent = 'تعذّر الاتصال بالخادم. تحقق من الإنترنت';
  }finally{
    btn.disabled = false; btn.textContent = 'دخول';
  }
});

// ---------- Account sheet ----------
const fmtDate = (ms)=> ms ? new Date(ms).toISOString().slice(0,10) : '—';
function fillAccount(){
  if(!session) return;
  const L = session.license, p = tokenPayload(session.token);
  $('acc_user').textContent = L.displayName ? `${L.displayName} (${L.username})` : L.username;
  $('acc_customer').textContent = L.customer || '—';
  $('acc_project').textContent = L.projectName || '—';
  $('acc_expiry').textContent = L.expiresAt || 'غير محدد';
  $('acc_ai').textContent = L.aiEnabled ? 'مفعّل' : 'غير مفعّل';
  $('acc_lang').textContent = userSettings().lang === 'en' ? 'English' : 'العربية';
  $('acc_checked').textContent = fmtDate(session.lastCheck);
  $('acc_sync').textContent = !syncOn() ? 'غير مفعّلة' : syncState.error ? 'تعذّرت آخر محاولة' :
    syncState.pending ? `${syncState.pending} بانتظار الرفع` : (syncState.lastOk ? 'كل الأصول مرفوعة' : '—');
  $('acc_grace').textContent = fmtDate(p.exp);
  $('acc_storage').textContent = isStandalone() || storagePersisted === true ? 'مفعّلة' : 'غير مضمونة — أضف التطبيق للشاشة الرئيسية';
  getSetting('lastBackupAt').then(v=> $('acc_backup').textContent = v ? new Date(Number(v) - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16).replace('T',' ') : 'لم يتم بعد');
}
$('settingsBtn').addEventListener('click', ()=>{ fillAccount(); $('settingsSheet').classList.add('open'); });
$('closeSettingsBtn').addEventListener('click', ()=> $('settingsSheet').classList.remove('open'));
$('checkNowBtn').addEventListener('click', async ()=>{
  if(!navigator.onLine){ toast('لا يوجد اتصال بالإنترنت'); return; }
  const ok = await verifyOnline();
  if(ok){ fillAccount(); toast('تم التحقق من الرخصة'); }
  else if(session){ toast('تعذّر الوصول للخادم، حاول لاحقًا'); }
});
$('logoutBtn').addEventListener('click', async ()=>{
  if(confirm('تسجيل الخروج؟ بياناتك تبقى محفوظة على هذا الجهاز، لكن تحتاج إنترنت للدخول مرة أخرى.')){
    await doLogout('');
  }
});
window.addEventListener('online', async ()=>{ await verifyOnline(); scheduleSync(1000); });
setInterval(()=>{ if(document.visibilityState === 'visible') scheduleSync(0); }, 120000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') scheduleSync(1500); });
