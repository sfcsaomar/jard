// Field inventory app — Sync with the server: upload assets and photos, pull changes from other devices.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Server sync ----------
// Assets and photos upload in the background whenever the phone is online. Photos are named by
// their SHA-256, so an interrupted upload simply repeats; records use last-edit-wins on the server.
const syncState = {running: false, again: false, timer: null, pending: 0, lastOk: 0, error: ''};
function syncOn(){ return !!(session && session.license && session.license.sync); }
function scheduleSync(ms = 2500){
  if(!syncOn()) return;
  clearTimeout(syncState.timer);
  syncState.timer = setTimeout(runSync, ms);
}
async function sha256Hex(blob){
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map(b=> b.toString(16).padStart(2, '0')).join('');
}
function makeThumb(blob, maxSide = 320){
  return new Promise((resolve)=>{
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((out)=> resolve(out || blob), 'image/jpeg', 0.7);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}
const SYNC_FIELDS = ['category','catCode','subCategory','subCategoryCode','name','brand','condition','model','sn','plateNo','location','building','notes','value'];
function assetData(a){
  const d = {};
  for(const f of SYNC_FIELDS) if(a[f] != null && a[f] !== '') d[f] = a[f];
  if(a.deleteFlag) d.deleteFlag = a.deleteFlag;
  return d;
}
function syncFail(r){ const e = new Error((r && r.message) || 'تعذّرت المزامنة'); e.code = r && r.code; return e; }

function updateSyncUi(pending){
  if(pending != null) syncState.pending = pending;
  const el = $('syncPill');
  if(!syncOn()){ el.hidden = true; return; }
  el.hidden = false;
  el.className = 'sync-pill';
  if(syncState.running && syncState.pending){ el.classList.add('busy'); el.textContent = `⇡ ${syncState.pending}`; }
  else if(syncState.error){ el.classList.add('err'); el.textContent = syncState.pending ? `⚠ ${syncState.pending}` : '⚠'; }
  else if(syncState.pending){ el.textContent = navigator.onLine ? `⇡ ${syncState.pending}` : `⏳ ${syncState.pending}`; }
  else { el.classList.add('ok'); el.textContent = '☁ ✓'; }
}
$('syncPill').addEventListener('click', ()=>{
  if(!navigator.onLine){ toast(`لا يوجد اتصال. ${syncState.pending || 'لا'} أصل بانتظار الرفع، وتُرفع تلقائيًا عند الاتصال`); return; }
  if(syncState.error) toast('آخر محاولة: ' + syncState.error + '. جارٍ إعادة المحاولة');
  else if(syncState.pending) toast(`جارٍ رفع ${syncState.pending} أصل`);
  else toast('كل الأصول مرفوعة للخادم');
  runSync();
});

async function runSync(){
  if(!syncOn() || !db || !navigator.onLine) { updateSyncUi(); return; }
  if(syncState.running){ syncState.again = true; return; }
  syncState.running = true; syncState.error = '';
  let changed = false;
  try{
    const all = await dbAll();
    for(const a of all){
      if(!a.uid){ // assets saved before sync existed
        a.uid = newUid(); a.updatedAt = a.updatedAt || a.createdAt || Date.now(); a.dirty = true;
        await dbPut(a, {fromSync: true});
      }
    }
    const queue = all.filter(a=> a.dirty);
    updateSyncUi(queue.length);
    while(queue.length && syncOn() && navigator.onLine){
      const batch = queue.splice(0, 5);
      const prepared = [], need = [];
      for(const a of batch){
        const done = new Set(a.upHashes || []);
        const photos = [];
        for(const p of (a.photos || [])){
          if(!p) continue;
          const h = await sha256Hex(p);
          photos.push(h);
          if(!done.has(h) && !need.some(x=> x.h === h)) need.push({h, blob: p, thumb: true});
        }
        let label = null;
        if(a.labelPhoto){
          label = await sha256Hex(a.labelPhoto);
          if(!done.has(label) && !need.some(x=> x.h === label)) need.push({h: label, blob: a.labelPhoto, thumb: false});
        }
        prepared.push({a, photos, label});
      }
      for(let i = 0; i < need.length; i += 12){
        const chunk = need.slice(i, i + 12);
        const r = await api('/api/sync', {action: 'sign', deviceId: deviceId(),
          photos: chunk.map(x=> x.h), thumbs: chunk.filter(x=> x.thumb).map(x=> x.h)}, session.token);
        if(!r.ok) throw syncFail(r);
        for(const u of r.uploads){
          const item = chunk.find(x=> x.h === u.hash);
          const body = u.kind === 'thumb' ? await makeThumb(item.blob) : item.blob;
          const res = await fetch(u.url, {method: 'PUT', headers: {'Content-Type': 'image/jpeg', 'x-upsert': 'true'}, body});
          if(!res.ok) throw syncFail({message: 'تعذّر رفع صورة (' + res.status + ')'});
        }
      }
      const r = await api('/api/sync', {action: 'push', deviceId: deviceId(), assets: prepared.map(({a, photos, label})=>({
        uid: a.uid, tag: a.tag || '', createdAt: a.createdAt, updatedAt: a.updatedAt, photos, label, data: assetData(a)
      }))}, session.token);
      if(!r.ok) throw syncFail(r);
      for(const {a, photos, label} of prepared){
        const cur = await dbGet(a.id);
        if(!cur) continue;
        cur.upHashes = [...new Set([...(cur.upHashes || []), ...photos, ...(label ? [label] : [])])];
        if(cur.updatedAt === a.updatedAt){ cur.dirty = false; cur.syncedAt = Date.now(); }
        await dbPut(cur, {fromSync: true});
      }
      changed = true;
      updateSyncUi(queue.length);
    }
    if(!queue.length){ syncState.lastOk = Date.now(); await setSetting('lastSyncAt', syncState.lastOk); }
  }catch(e){
    syncState.error = e.message || 'تعذّرت المزامنة';
    if(HARD_FAIL.includes(e.code)) verifyOnline();
    else if(e.code === 'sync_off' || e.code === 'no_project') verifyOnline();
    clearTimeout(syncState.timer);
    syncState.timer = setTimeout(runSync, 60000); // retry later
  }finally{
    syncState.running = false;
    if(db){
      const left = (await dbAll()).filter(a=> a.dirty || !a.uid).length;
      updateSyncUi(left);
      if(changed && !$('formSheet').classList.contains('open')) await refreshList($('searchBox').value);
      else updateBackupState();
    }
    if(syncState.again){ syncState.again = false; scheduleSync(500); }
  }
}
