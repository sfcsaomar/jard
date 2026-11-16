// Field inventory app — Form helpers: more-details check, duplicate asset number warning, copy from previous asset.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- More details helper ----------
function a_hasMore(id){
  const a = assets.find(x=>x.id===id);
  return !!(a && (a.labelPhoto || [...$('moreFields').querySelectorAll('[data-fkey]')].some(w=> a[FIELD_BY_KEY[w.dataset.fkey].prop])));
}

// ---------- Duplicate barcode ----------
const normTag = (v)=> String(v || '').trim().toLowerCase();
function findDuplicate(tag){
  const key = normTag(tag);
  if(!key) return null;
  return assets.find(a => normTag(a.tag) === key && a.id !== currentEditId && !isFlagged(a)) || null;
}
function checkDuplicate(){
  const dup = findDuplicate($('f_tag').value);
  const el = $('dupWarn');
  if(dup){
    el.innerHTML = `${escapeHtml(t('app.dup.exists'))} ${escapeHtml(dup.name || t('app.noName'))}${dup.location ? ' · ' + escapeHtml(dup.location) : ''} · <a id="openDupLink">${escapeHtml(t('app.dup.open'))}</a>`;
    el.classList.add('show');
    $('openDupLink').addEventListener('click', ()=> openForm(dup.id));
  } else {
    el.classList.remove('show');
    el.innerHTML = '';
  }
}
$('f_tag').addEventListener('input', checkDuplicate);
$('nextTagBtn').addEventListener('click', ()=> setTimeout(checkDuplicate, 50));

// ---------- Copy from previous asset ----------
$('copyPrevBtn').addEventListener('click', ()=>{
  const prev = assets.find(a=> !isFlagged(a));
  if(!prev){ toast(t('app.copy.none')); return; }
  // The descriptive fields; not the numbers that identify this one asset (tag, old code, serial, plate), not the location.
  ['catcode', 'subcat', 'subcatcode', 'name', 'brand', 'model', 'year', 'qty', 'value'].forEach(k=>{
    $('f_' + k).value = prev[FIELD_BY_KEY[k].prop] ?? '';
  });
  setCategoryValue(prev.category, prev.subCategory);
  setCondition(prev.condition || '');
  setOpStatus(prev.opStatus || '');
  updateDescMeta();
  toast(t('app.copy.done', {tag: prev.tag}));
});
