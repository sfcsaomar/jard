// Field inventory app — The add / edit asset form: photos, condition, delete flag, save.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Form sheet ----------
function renderPhotoGrid(){
  const grid = $('photoGrid');
  grid.innerHTML = '';
  currentPhotos.forEach((blob, idx)=>{
    const slot = document.createElement('div');
    slot.className = 'photo-slot';
    if(blob){
      const url = URL.createObjectURL(blob);
      slot.innerHTML = `<img src="${url}"><div class="remove-x" data-idx="${idx}">✕</div>`;
      slot.querySelector('img').addEventListener('click', ()=> openLightbox(url));
      slot.querySelector('.remove-x').addEventListener('click', (e)=>{
        e.stopPropagation();
        currentPhotos[idx] = null;
        renderPhotoGrid();
        updateAiButtonState();
      });
    } else {
      slot.innerHTML = `<span class="plus">+</span>`;
      slot.addEventListener('click', ()=> captureForSlot(idx));
    }
    grid.appendChild(slot);
  });
}

let captureSlotIndex = null;
function captureForSlot(idx){
  captureSlotIndex = idx;
  $('cameraInput').click();
}
// Phone photos are 4-8 MB each; shrink them on capture so storage and exports stay small.
function compressPhoto(blob, maxSide=1600, quality=0.8){
  return new Promise((resolve)=>{
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((out)=> resolve(out && out.size < blob.size ? out : blob), 'image/jpeg', quality);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

$('cameraInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  const idx = captureSlotIndex;
  e.target.value = '';
  if(file && idx !== null){
    currentPhotos[idx] = await compressPhoto(file);
    renderPhotoGrid();
    updateAiButtonState();
  }
});

function openLightbox(url){
  $('lightboxImg').src = url;
  $('lightbox').classList.add('open');
}
$('closeLightbox').addEventListener('click', ()=> $('lightbox').classList.remove('open'));

function setCondition(v){
  currentCondition = v;
  $('conditionChips').querySelectorAll('.chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.v === v);
  });
}
$('conditionChips').querySelectorAll('.chip').forEach(c=>{
  c.addEventListener('click', ()=> setCondition(c.dataset.v));
});
function setOpStatus(v){
  currentOpStatus = v;
  $('opStatusChips').querySelectorAll('.chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.v === v);
  });
}
$('opStatusChips').querySelectorAll('.chip').forEach(c=>{
  c.addEventListener('click', ()=> setOpStatus(c.dataset.v === currentOpStatus ? '' : c.dataset.v));
});

// Text fields of the form: every field in fields.js except the category picker and the two chip groups.
const TEXT_FIELDS = ASSET_FIELDS.filter(f=> !['category', 'condition', 'opstatus'].includes(f.key));
// Where the current-location value of a location field is kept on the device.
const LOC_SETTING = {building: 'currentBuilding', location: 'currentLocation'};
const locSetting = (key)=> LOC_SETTING[key] || ('currentLoc_' + key);

async function nextTagNumber(){
  const all = await dbAll();
  let maxNum = 0;
  let prefix = 'A-';
  all.forEach(a=>{
    const m = (a.tag||'').match(/^([A-Za-z\u0600-\u06FF]*-?)0*(\d+)$/);
    if(m){
      const num = parseInt(m[2], 10);
      if(num > maxNum){ maxNum = num; prefix = m[1] || 'A-'; }
    }
  });
  const next = String(maxNum + 1).padStart(4, '0');
  $('f_tag').value = prefix + next;
}
$('nextTagBtn').addEventListener('click', nextTagNumber);

async function openForm(id=null){
  buildCategoryOptions();
  currentEditId = id;
  currentPhotos = [null,null,null,null];
  currentCondition = '';
  $('moreToggle').classList.remove('open');
  $('moreFields').classList.remove('open');

  if(id){
    const a = assets.find(x=>x.id===id);
    $('formTitle').textContent = t('app.form.editTitle');
    $('f_tag').value = a.tag || '';
    TEXT_FIELDS.forEach(f=>{ $('f_' + f.key).value = a[f.prop] ?? ''; });
    setCategoryValue(a.category, a.subCategory);
    a.photos.forEach((p,i)=>{ if(i<4) currentPhotos[i] = p; });
    currentLabel = a.labelPhoto || null;
    setCondition(a.condition || '');
    setOpStatus(a.opStatus || '');
    $('deleteLink').style.display = 'block';
    $('deleteLink').textContent = isFlagged(a) ? t('app.flag.unmark') : t('app.flag.mark');
    $('flagNote').innerHTML = isFlagged(a)
      ? t('app.flag.note', {reason: escapeHtml(a.deleteFlag.reason || '—'), date: escapeHtml(fmtDate(a.deleteFlag.at))})
      : '';
    $('flagNote').classList.toggle('show', isFlagged(a));
    $('copyPrevBtn').style.visibility = 'hidden';
  } else {
    $('formTitle').textContent = t('app.form.newTitle');
    $('f_tag').value = '';
    for(const f of TEXT_FIELDS){
      $('f_' + f.key).value = f.loc ? await getSetting(locSetting(f.key)) : '';
    }
    if(fieldShown('qty')) $('f_qty').value = '1';
    setCategoryValue('', '');
    currentLabel = null;
    setCondition('');
    setOpStatus('');
    $('deleteLink').style.display = 'none';
    $('flagNote').classList.remove('show');
    $('copyPrevBtn').style.visibility = assets.length ? 'visible' : 'hidden';
    await nextTagNumber();
  }
  renderLabel();
  checkDuplicate();
  if(id && (a_hasMore(id))){ $('moreToggle').classList.add('open'); $('moreFields').classList.add('open'); }
  renderPhotoGrid();
  updateAiButtonState();
  applyFieldSettings();
  clearInvalid();
  updateDescMeta();
  $('formSheet').classList.add('open');
}

function closeForm(){
  $('formSheet').classList.remove('open');
}
$('closeFormBtn').addEventListener('click', closeForm);
$('addBtn').addEventListener('click', ()=> openForm(null));

$('saveBtn').addEventListener('click', async ()=>{
  const tag = $('f_tag').value.trim();
  if(!tag){
    toast(t('app.form.needTag'));
    return;
  }
  if(!validateRequired()) return;
  const dup = findDuplicate(tag);
  if(dup && !confirm(t('app.dup.confirm', {tag, name: dup.name || t('app.noName')}))){
    return;
  }
  const asset = {
    tag,
    category: $('f_category').value,
    condition: currentCondition,
    opStatus: currentOpStatus,
    photos: currentPhotos,
    labelPhoto: currentLabel,
    deleteFlag: currentEditId ? (assets.find(a=>a.id===currentEditId)?.deleteFlag || null) : null,
    createdAt: currentEditId ? (assets.find(a=>a.id===currentEditId)?.createdAt || Date.now()) : Date.now()
  };
  TEXT_FIELDS.forEach(f=>{ asset[f.prop] = $('f_' + f.key).value.trim(); });
  asset.name = asset.name.slice(0, DESC_MAX);
  if(currentEditId){
    asset.id = currentEditId;
    const prev = assets.find(a=> a.id === currentEditId);
    if(prev){ asset.uid = prev.uid; asset.upHashes = prev.upHashes; } // keep the server identity
  }
  await dbPut(asset);
  await setSetting('lastChangeAt', Date.now());
  closeForm();
  await refreshList($('searchBox').value);
  toast(t('common.saved'));
});

// Deleting is not allowed in the field. A wrong entry is flagged with a reason instead;
// the export lists flagged assets in a separate sheet so the client decides.
$('deleteLink').addEventListener('click', async ()=>{
  if(!currentEditId) return;
  const a = assets.find(x=>x.id===currentEditId);
  if(!a) return;
  if(isFlagged(a)){
    if(!confirm(t('app.flag.unmarkConfirm'))) return;
    a.deleteFlag = null;
    await dbPut(a);
    await setSetting('lastChangeAt', Date.now());
    closeForm();
    await refreshList($('searchBox').value);
    toast(t('app.flag.unmarked'));
    return;
  }
  let reason = prompt(t('app.flag.reasonPrompt'));
  if(reason === null) return;
  reason = reason.trim();
  if(!reason){ toast(t('app.flag.reasonNeeded')); return; }
  a.deleteFlag = {reason: reason.slice(0, 200), at: Date.now()};
  await dbPut(a);
  await setSetting('lastChangeAt', Date.now());
  closeForm();
  await refreshList($('searchBox').value);
  toast(t('app.flag.marked'));
});

$('searchBox').addEventListener('input', (e)=> refreshList(e.target.value));
