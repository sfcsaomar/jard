// Field inventory app — Keeping data safe on the phone: persistent storage, add-to-home-screen, backup reminder.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Data protection: persistent storage + home-screen install ----------
// Browsers (Safari especially) may clear site data that is not "persistent", e.g. after 7 days unused.
// Installed home-screen apps and granted persistent storage are kept.
let storagePersisted = null;
let deferredInstall = null;
const INSTALL_SNOOZE_KEY = 'ai_install_snooze_v1';
const isStandalone = ()=> window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = ()=> /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function ensurePersistentStorage(){
  try{
    if(!navigator.storage || !navigator.storage.persist) { storagePersisted = null; return; }
    storagePersisted = await navigator.storage.persisted();
    if(!storagePersisted) storagePersisted = await navigator.storage.persist();
  }catch{ storagePersisted = null; }
}

window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstall = e;
  renderInstallCard();
});
window.addEventListener('appinstalled', ()=>{ deferredInstall = null; renderInstallCard(); });

function renderInstallCard(){
  const card = $('installCard');
  const snoozed = Number(lsGet(INSTALL_SNOOZE_KEY) || 0) > Date.now();
  if(!session || isStandalone() || snoozed){ card.classList.remove('show'); return; }
  let html;
  if(isIOS()){
    html = '<b>لحماية بياناتك:</b> قد يحذف Safari بيانات الجرد إذا لم يُفتح الموقع أسبوعًا. اضغط زر المشاركة <b>⬆︎</b> ثم <b>«إضافة إلى الشاشة الرئيسية»</b>، واعمل دائمًا من أيقونة التطبيق.';
    if(assets.length) html += '<br><b>مهم:</b> التطبيق المُضاف لا يرى بيانات Safari. صدّر ما سجلته الآن، ثم افتح التطبيق من الأيقونة وسجّل الدخول واستعد الملف من ⚙.';
    $('installBtn').style.display = 'none';
  } else if(deferredInstall){
    html = '<b>ثبّت التطبيق على هاتفك</b> ليفتح من أيقونة ويعمل دون إنترنت، وتبقى بياناتك محمية من الحذف التلقائي.';
    $('installBtn').style.display = 'inline-block';
  } else if(storagePersisted === true){
    card.classList.remove('show'); return;
  } else {
    html = '<b>لحماية بياناتك:</b> من قائمة المتصفح <b>⋮</b> اختر <b>«إضافة إلى الشاشة الرئيسية»</b> أو «تثبيت التطبيق»، واعمل دائمًا من أيقونته.';
    $('installBtn').style.display = 'none';
  }
  $('installText').innerHTML = html;
  card.classList.add('show');
}
$('installBtn').addEventListener('click', async ()=>{
  if(!deferredInstall) return;
  deferredInstall.prompt();
  try{ await deferredInstall.userChoice; }catch{}
  deferredInstall = null;
  renderInstallCard();
});
$('installLater').addEventListener('click', ()=>{
  lsSet(INSTALL_SNOOZE_KEY, Date.now() + 3 * 86400000);
  renderInstallCard();
});

// ---------- Backup reminder ----------
let backupMsg = '';
async function updateBackupState(){
  if(!db) return;
  const lastBackup = Number(await getSetting('lastBackupAt')) || 0;
  const lastChange = Number(await getSetting('lastChangeAt')) || 0;
  // With server sync, the backup reminder only matters for assets not uploaded yet.
  if(syncOn()){
    const unsynced = assets.filter(a=> a.dirty || !a.uid);
    const oldest = Math.min(...unsynced.map(a=> a.updatedAt || a.createdAt || Date.now()));
    backupMsg = unsynced.length && Date.now() - oldest > 12 * 3600000
      ? `${unsynced.length} أصل لم يُرفع للخادم منذ أكثر من 12 ساعة. اتصل بالإنترنت، أو صدّر نسخة احتياطية.`
      : '';
    renderLicenseBanner();
    return;
  }
  const pending = assets.length > 0 && lastChange > lastBackup;
  const stale = !lastBackup || (Date.now() - lastBackup) > 12 * 3600000;
  backupMsg = pending && stale
    ? (lastBackup ? 'لديك أصول غير محفوظة في نسخة احتياطية منذ آخر تصدير.' : 'لم تأخذ نسخة احتياطية بعد.') + ' اضغط «تصدير» بالأسفل واحفظ الملف.'
    : '';
  renderLicenseBanner();
}
