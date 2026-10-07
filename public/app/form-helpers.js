// Field inventory app — Form helpers: more-details check, duplicate asset number warning, copy from previous asset.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- More details helper ----------
function a_hasMore(id){
  const a = assets.find(x=>x.id===id);
  return !!(a && (a.brand || a.model || a.sn || a.labelPhoto || a.plateNo || a.catCode));
}

// ---------- Duplicate barcode ----------
const normTag = (t)=> String(t || '').trim().toLowerCase();
function findDuplicate(tag){
  const t = normTag(tag);
  if(!t) return null;
  return assets.find(a => normTag(a.tag) === t && a.id !== currentEditId && !isFlagged(a)) || null;
}
function checkDuplicate(){
  const dup = findDuplicate($('f_tag').value);
  const el = $('dupWarn');
  if(dup){
    el.innerHTML = `هذا الرقم مسجّل مسبقًا: ${escapeHtml(dup.name || 'بدون اسم')}${dup.location ? ' · ' + escapeHtml(dup.location) : ''} — <a id="openDupLink">فتح الأصل</a>`;
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
  if(!prev){ toast('لا يوجد أصل سابق'); return; }
  $('f_catcode').value = prev.catCode || '';
  $('f_subcat').value = prev.subCategory || '';
  $('f_subcatcode').value = prev.subCategoryCode || '';
  setCategoryValue(prev.category, prev.subCategory);
  $('f_name').value = prev.name || '';
  $('f_brand').value = prev.brand || '';
  $('f_model').value = prev.model || '';
  $('f_value').value = prev.value || '';
  setCondition(prev.condition || '');
  updateDescMeta();
  toast(`تم نسخ بيانات ${prev.tag} — امسح الرقم وصوّر فقط`);
});
