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
  // A required sub-category is checked on the visible picker when a list exists.
  FIELD_DEFS.subcat = has ? ['f_subcatSel', t('co.f.subcat'), false] : ['f_subcat', t('co.f.subcat'), true];
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
const DESC_MAX = 265;
// key -> [element id, label, inside "more details"?]
const FIELD_DEFS = {
  category:   ['f_category', t('co.f.category'), false],
  name:       ['f_name', t('co.f.name'), false],
  condition:  ['conditionChips', t('co.f.condition'), false],
  building:   ['f_building', t('co.f.building'), false],
  location:   ['f_location', t('co.f.location'), false],
  catcode:    ['f_catcode', t('co.f.catcode'), true],
  subcat:     ['f_subcat', t('co.f.subcat'), true],
  subcatcode: ['f_subcatcode', t('co.f.subcatcode'), true],
  brand:      ['f_brand', t('co.f.brand'), true],
  model:      ['f_model', t('co.f.model'), true],
  sn:         ['f_sn', t('co.f.sn'), true],
  plateno:    ['f_plateno', t('co.f.plateno'), true],
  value:      ['f_value', t('co.f.value'), true],
  notes:      ['f_notes', t('co.f.notes'), false]
};
function userSettings(){
  const st = (session && session.license && session.license.settings) || {};
  return {
    lang: st.lang === 'en' ? 'en' : 'ar',
    required: Array.isArray(st.required) ? st.required.filter(k=> FIELD_DEFS[k]) : [],
    minPhotos: Math.min(4, Math.max(1, Number(st.minPhotos) || 1))
  };
}
// The label of a field: the <label> right before the input, or the field's first label.
function fieldWrap(key){
  const el = $(FIELD_DEFS[key][0]);
  return el.closest('.two-col > div') || el.closest('.field');
}
function applyFieldSettings(){
  buildCategoryOptions();
  const st = userSettings();
  document.querySelectorAll('#formSheet .req-star').forEach(x=> x.remove());
  $('photoLabel').textContent = st.minPhotos > 1
    ? t('app.photos.min', {n: st.minPhotos})
    : t('app.photos.label');

  const star = ()=>{ const s = document.createElement('span'); s.className = 'req-star'; s.textContent = '*'; return s; };
  ['f_tag', 'photoGrid'].concat(st.required.map(k=> FIELD_DEFS[k][0])).forEach(id=>{
    const lbl = ($(id).closest('.two-col > div') || $(id).closest('.field')).querySelector('label');
    if(lbl) lbl.appendChild(star());
  });
  const en = st.lang === 'en';
  $('f_name').dir = en ? 'ltr' : 'rtl';
  // The example follows the project's entry language, not the interface language.
  $('f_name').placeholder = (en ? I18N.en : I18N.ar)['app.form.namePh'];
  if(st.required.some(k=> FIELD_DEFS[k][2])){
    $('moreToggle').classList.add('open'); $('moreFields').classList.add('open');
  }
}
function clearInvalid(){
  document.querySelectorAll('#formSheet .invalid').forEach(x=> x.classList.remove('invalid'));
}
function fieldIsEmpty(key){
  if(key === 'condition') return !currentCondition;
  return !String($(FIELD_DEFS[key][0]).value || '').trim();
}
function validateRequired(){
  clearInvalid();
  const st = userSettings();
  const missing = [];
  const mark = (wrap, label)=>{ wrap.classList.add('invalid'); missing.push({wrap, label}); };
  if(!$('f_tag').value.trim()) mark($('f_tag').closest('.field'), t('co.f.tag'));
  const photoCount = currentPhotos.filter(p=>p).length;
  if(photoCount < st.minPhotos) mark($('photoGrid').closest('.field'), st.minPhotos > 1 ? t('co.proj.photos', {n: st.minPhotos}) : t('app.photos.one'));
  st.required.forEach(k=>{ if(fieldIsEmpty(k)) mark(fieldWrap(k), FIELD_DEFS[k][1]); });
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
$('conditionChips').addEventListener('click', ()=>{
  const w = $('conditionChips').closest('.invalid'); if(w) w.classList.remove('invalid');
});

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
