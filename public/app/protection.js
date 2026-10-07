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
    html = t('app.prot.ios');
    if(assets.length) html += '<br>' + t('app.prot.iosMove');
    $('installBtn').style.display = 'none';
  } else if(deferredInstall){
    html = t('app.prot.install');
    $('installBtn').style.display = 'inline-block';
  } else if(storagePersisted === true){
    card.classList.remove('show'); return;
  } else {
    html = t('app.prot.android');
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
      ? t('app.prot.unsynced', {n: unsynced.length})
      : '';
    renderLicenseBanner();
    return;
  }
  const pending = assets.length > 0 && lastChange > lastBackup;
  const stale = !lastBackup || (Date.now() - lastBackup) > 12 * 3600000;
  backupMsg = pending && stale
    ? t(lastBackup ? 'app.prot.newSinceBackup' : 'app.prot.noBackup') + ' ' + t('app.prot.exportNow')
    : '';
  renderLicenseBanner();
}
