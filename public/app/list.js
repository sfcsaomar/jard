// Field inventory app — The asset list on the main screen.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Rendering the list ----------
async function refreshList(filter=''){
  assets = await dbAll();
  const flaggedCount = assets.filter(isFlagged).length;
  $('assetCount').textContent = assets.length - flaggedCount;
  $('flaggedCount').textContent = flaggedCount ? ` · ${flaggedCount} للحذف` : '';
  const wrap = $('listWrap');
  wrap.innerHTML = '';

  const f = filter.trim().toLowerCase();
  const filtered = !f ? assets : assets.filter(a =>
    (a.tag||'').toLowerCase().includes(f) || (a.name||'').toLowerCase().includes(f)
  );

  $('emptyState').style.display = (assets.length === 0) ? 'block' : 'none';
  if(syncOn() && !syncState.running) updateSyncUi(assets.filter(a=> a.dirty || !a.uid).length);
  updateBackupState();

  filtered.forEach(a=>{
    const card = document.createElement('div');
    card.className = 'asset-card' + (isFlagged(a) ? ' flagged' : '');
    const firstPhoto = a.photos.find(p=>p);
    const thumbSrc = firstPhoto ? URL.createObjectURL(firstPhoto) : '';
    card.innerHTML = `
      ${firstPhoto ? `<img class="asset-thumb" src="${thumbSrc}">` : `<div class="asset-thumb"></div>`}
      <div class="asset-info">
        <div class="asset-tag mono">${escapeHtml(a.tag || '—')}${isFlagged(a) ? '<span class="flag-badge">مطلوب حذفه</span>' : ''}${syncOn() && (a.dirty || !a.uid) ? '<span class="sync-dot" title="بانتظار الرفع">⏳</span>' : ''}</div>
        <div class="asset-name">${escapeHtml(a.name || 'بدون اسم')}</div>
        <div class="asset-meta">${escapeHtml(a.category||'')}${a.category && a.condition ? ' · ' : ''}${escapeHtml(conditionLabel(a.condition))}${(a.building||a.location) ? ' · ' + escapeHtml([a.building,a.location].filter(Boolean).join(' - ')) : ''}</div>
      </div>
      <div class="asset-photos-count">${a.photos.filter(p=>p).length}/4 📷</div>
    `;
    card.addEventListener('click', ()=> openForm(a.id));
    wrap.appendChild(card);
  });
}

const isFlagged = (a)=> !!(a && a.deleteFlag);

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const CONDITION_LABELS = {'Good':'جيد','New':'جديد','Fair':'متوسط','Needs Maintenance':'يحتاج صيانة'};
function conditionLabel(v){ return CONDITION_LABELS[v] || v || ''; }
