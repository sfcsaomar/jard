// Field inventory app — Settings the company admin sets per project: category list and entry rules (language, required fields, photo count).
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Project categories (imported by the company admin) ----------
// With a category list, the user picks the main category then the sub-category, and both codes fill in.
// Without one, the built-in list is shown and codes are typed by hand, as before.
const DEFAULT_CATS = ['Furniture', 'COMPUTER & NET WORK', 'Electrical Appliances', 'Lighting', 'Fixtures & Fittings', 'Other'];
function projectCats(){
  const c = session && session.license && session.license.categories;
  return Array.isArray(c) ? c : [];
}
let catsSig = null;
function optionHtml(value, code){
  return `<option value="${escapeHtml(value)}">${escapeHtml(code ? code + ' · ' + value : value)}</option>`;
}
function buildCategoryOptions(){
  const cats = projectCats();
  const has = cats.length > 0;
  const sig = JSON.stringify(cats.map(c=> [c.code, c.name, c.subs.length]));
  if(sig !== catsSig){
    const keepCat = $('f_category').value, keepSub = $('f_subcat').value;
    catsSig = sig;
    $('f_category').innerHTML = `<option value="">${escapeHtml(t('app.cat.pick'))}</option>` +
      (has ? cats.map(c=> optionHtml(c.name, c.code)) : DEFAULT_CATS.map(n=> optionHtml(n, ''))).join('');
    setCategoryValue(keepCat, keepSub);
  }
  $('subcatPick').hidden = !has;
  ['f_catcode', 'f_subcat', 'f_subcatcode'].forEach(id=>{
    $(id).readOnly = has;
    $(id).style.background = has ? 'var(--muted)' : '';
  });
}
// Keeps values that are not in the list (assets saved before the list was imported) selectable.
function ensureOption(sel, value){
  value = value || '';
  if(value && ![...sel.options].some(o=> o.value === value)){
    const o = document.createElement('option'); o.value = value; o.textContent = value; sel.appendChild(o);
  }
  sel.value = value;
}
function fillSubOptions(){
  const cat = projectCats().find(c=> c.name === $('f_category').value);
  const subs = cat ? cat.subs : [];
  $('f_subcatSel').innerHTML = `<option value="">${escapeHtml(t(!$('f_category').value ? 'app.cat.mainFirst' : subs.length ? 'app.cat.pickSub' : 'app.cat.noSubs'))}</option>` +
    subs.map(s=> optionHtml(s.name, s.code)).join('');
}
function setCategoryValue(cat, sub){
  ensureOption($('f_category'), cat);
  fillSubOptions();
  ensureOption($('f_subcatSel'), sub);
}
$('f_category').addEventListener('change', ()=>{
  const cats = projectCats();
  fillSubOptions();
  if(!cats.length) return;
  const c = cats.find(x=> x.name === $('f_category').value);
  $('f_catcode').value = c ? c.code : '';
  $('f_subcat').value = '';
  $('f_subcatcode').value = '';
});
$('f_subcatSel').addEventListener('change', ()=>{
  const c = projectCats().find(x=> x.name === $('f_category').value);
  const s = c && c.subs.find(x=> x.name === $('f_subcatSel').value);
  $('f_subcat').value = s ? s.name : $('f_subcatSel').value;
  $('f_subcatcode').value = s ? s.code : $('f_subcatcode').value;
});

// ---------- Per-project entry settings (set by the company admin) ----------
// Each field (fields.js) is hidden, optional or required for the project.
const DESC_MAX = 265;
// The input that holds a field's value. A required sub-category is checked on the picker when a list exists.
function fieldEl(key){
  if(key === 'condition') return $('conditionChips');
  if(key === 'opstatus') return $('opStatusChips');
  if(key === 'subcat' && projectCats().length) return $('f_subcatSel');
  return $('f_' + key);
}
function userSettings(){
  const st = (session && session.license && session.license.settings) || {};
  // Settings from a server older than v2.6 have no hidden list: hide the fields added in v2.6.
  const hidden = Array.isArray(st.hidden) ? st.hidden.filter(k=> FIELD_BY_KEY[k]) : ASSET_FIELDS.filter(f=> f.added).map(f=> f.key);
  return {
    v: st.v === 2 ? 2 : 1,
    lang: st.lang === 'en' ? 'en' : 'ar',
    hidden,
    required: Array.isArray(st.required) ? st.required.filter(k=> FIELD_BY_KEY[k] && !hidden.includes(k)) : [],
    minPhotos: Math.min(4, Math.max(1, Number(st.minPhotos) || 1))
  };
}
function fieldShown(key){ return !userSettings().hidden.includes(key); }
function fieldWrap(key){ return fieldEl(key).closest('.field'); }
function applyFieldSettings(){
  buildCategoryOptions();
  const st = userSettings();
  const hidden = new Set(st.hidden);
  document.querySelectorAll('#formSheet [data-fkey]').forEach(w=>{ w.hidden = hidden.has(w.dataset.fkey); });
  $('subcatPick').hidden = !projectCats().length || hidden.has('subcat');
  $('labelRow').hidden = ['brand', 'model', 'sn'].every(k=> hidden.has(k));
  const moreShown = !$('labelRow').hidden || [...$('moreFields').querySelectorAll('[data-fkey]')].some(w=> !w.hidden);
  $('moreToggle').hidden = !moreShown;
  if(!moreShown){ $('moreToggle').classList.remove('open'); $('moreFields').classList.remove('open'); }

  document.querySelectorAll('#formSheet .req-star').forEach(x=> x.remove());
  $('photoLabel').textContent = st.minPhotos > 1
    ? t('app.photos.min', {n: st.minPhotos})
    : t('app.photos.label');
  const star = ()=>{ const s = document.createElement('span'); s.className = 'req-star'; s.textContent = '*'; return s; };
  [$('f_tag'), $('photoGrid')].concat(st.required.map(fieldEl)).forEach(el=>{
    const lbl = el.closest('.field').querySelector('label');
    if(lbl) lbl.appendChild(star());
  });
  const en = st.lang === 'en';
  $('f_name').dir = en ? 'ltr' : 'rtl';
  // The example follows the project's entry language, not the interface language.
  $('f_name').placeholder = (en ? I18N.en : I18N.ar)['app.form.namePh'];
  if(st.required.some(k=> $('moreFields').contains(fieldEl(k)))){
    $('moreToggle').classList.add('open'); $('moreFields').classList.add('open');
  }
}
function clearInvalid(){
  document.querySelectorAll('#formSheet .invalid').forEach(x=> x.classList.remove('invalid'));
}
function fieldIsEmpty(key){
  if(key === 'condition') return !currentCondition;
  if(key === 'opstatus') return !currentOpStatus;
  return !String(fieldEl(key).value || '').trim();
}
function validateRequired(){
  clearInvalid();
  const st = userSettings();
  const missing = [];
  const mark = (wrap, label)=>{ wrap.classList.add('invalid'); missing.push({wrap, label}); };
  if(!$('f_tag').value.trim()) mark($('f_tag').closest('.field'), t('co.f.tag'));
  const photoCount = currentPhotos.filter(p=>p).length;
  if(photoCount < st.minPhotos) mark($('photoGrid').closest('.field'), st.minPhotos > 1 ? t('co.proj.photos', {n: st.minPhotos}) : t('app.photos.one'));
  st.required.forEach(k=>{ if(fieldIsEmpty(k)) mark(fieldWrap(k), t('co.f.' + k)); });
  if(!missing.length) return true;
  if(missing.some(m=> $('moreFields').contains(m.wrap))){
    $('moreToggle').classList.add('open'); $('moreFields').classList.add('open');
  }
  missing[0].wrap.scrollIntoView({behavior:'smooth', block:'center'});
  toast(t('app.form.missing', {fields: missing.map(m=> m.label).join(t('app.listSep'))}));
  return false;
}
// Remove the red mark as soon as the field is filled.
$('formSheet').addEventListener('input', (e)=>{
  const w = e.target.closest('.invalid'); if(w) w.classList.remove('invalid');
});
$('formSheet').addEventListener('change', (e)=>{
  const w = e.target.closest('.invalid'); if(w) w.classList.remove('invalid');
});
['conditionChips', 'opStatusChips'].forEach(id=> $(id).addEventListener('click', ()=>{
  const w = $(id).closest('.invalid'); if(w) w.classList.remove('invalid');
}));

// Description box: grows with the text, 265-character cap, language check.
const AR_RE = /[\u0600-\u06FF]/;
const LATIN_RE = /[A-Za-z]/;
function updateDescMeta(){
  const el = $('f_name');
  el.style.height = 'auto';
  el.style.height = Math.max(52, el.scrollHeight + 2) + 'px';
  $('descCount').textContent = `${el.value.length}/${DESC_MAX}`;
  const v = el.value.trim();
  const lang = userSettings().lang;
  let warn = '';
  if(v && lang === 'ar' && !AR_RE.test(v) && LATIN_RE.test(v)) warn = I18N.ar['app.form.langAr'];
  if(v && lang === 'en' && AR_RE.test(v)) warn = 'Entry language for your account is English';
  $('langWarn').textContent = warn;
}
$('f_name').addEventListener('input', updateDescMeta);
