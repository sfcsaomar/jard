// Interface language (Arabic / English) for every page: the panels, the account page and the field app.
// Texts live in i18n/ar.js and i18n/en.js (same keys in both; tests/static.test.mjs checks this).
// Loaded in <head> right after the two dictionaries, so the page direction is set before it is drawn.
//   t('key', {n: 3})        text in the current language, {n} replaced
//   data-i18n="key"         element text      data-i18n-html="key"  element HTML
//   data-i18n-ph="key"      placeholder       data-i18n-title="key" title + aria-label
//   msgOf(response)         server message in the current language
// The choice is stored on the device (aman_lang). Changing it reloads the page.
var I18N = window.I18N || {};
const LANG_KEY = 'aman_lang';
const LANG = (function(){
  let l = '';
  try{ l = localStorage.getItem(LANG_KEY) || ''; }catch{}
  return l === 'en' || l === 'ar' ? l : 'ar';
})();
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';

function t(key, vars){
  let s = I18N[LANG]?.[key];
  if(s == null) s = I18N.ar?.[key];
  if(s == null) return key;
  if(vars) s = s.replace(/\{(\w+)\}/g, (m, k)=> vars[k] ?? m);
  return s;
}
function applyI18n(root){
  const r = root || document;
  r.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  r.querySelectorAll('[data-i18n-html]').forEach(el=>{ el.innerHTML = t(el.dataset.i18nHtml); });
  r.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPh); });
  r.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
}
function setLang(l){
  try{ localStorage.setItem(LANG_KEY, l); }catch{}
  location.reload();
}
function otherLangLabel(){ return LANG === 'ar' ? 'English' : 'العربية'; }
function toggleLang(){ setLang(LANG === 'ar' ? 'en' : 'ar'); }
// A server reply's message in the current language, or a fallback text key.
function msgOf(d, fallbackKey){
  const m = LANG === 'en' ? (d?.messageEn || '') : (d?.message || '');
  return m || t(fallbackKey || 'common.failed');
}
// Numbers always with Latin digits; thousands separated.
function num(n, digits){
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', {maximumFractionDigits: digits ?? 0, minimumFractionDigits: digits ?? 0});
}
document.addEventListener('DOMContentLoaded', ()=>{
  applyI18n();
  document.querySelectorAll('[data-lang-toggle]').forEach(b=>{
    b.textContent = otherLangLabel();
    b.lang = LANG === 'ar' ? 'en' : 'ar';
    b.addEventListener('click', toggleLang);
  });
});
