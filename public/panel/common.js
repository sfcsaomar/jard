// Helpers shared by the provider panel (admin.html), the company panel (company.html)
// and the account page (account.html). Loaded before each page's own script; needs i18n/i18n.js.
const $ = (id)=> document.getElementById(id);
const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }

// ---------- dates (Latin digits, 2026-10-07) ----------
const fmt = (iso)=> iso ? esc(iso.slice(0,10)) : '—';
const isoTime = (d)=> { const x = new Date(d); return isNaN(x) ? '' : new Date(x - x.getTimezoneOffset()*60000).toISOString().slice(0,16).replace('T',' '); };
const fmtTime = (iso)=> iso ? esc(isoTime(iso)) : '—';
function daysLeft(date){ return date ? Math.ceil((new Date(date+'T23:59:59Z') - Date.now())/86400000) : null; }
const langName = (l)=> l === 'en' ? 'English' : 'العربية';  // a data language, always named in itself

// ---------- windows ----------
function openModal(id){ $(id).classList.add('open'); }
function closeModals(){ document.querySelectorAll('.modal-bg').forEach(m=>m.classList.remove('open')); }

// ---------- accounts ----------
function emailCell(u){
  if(!u.email) return '<span class="sub">—</span>';
  return `<span dir="ltr" style="font-size:12.5px">${esc(u.email)}</span>` +
    (u.emailVerified ? '' : ` <span class="pill" title="${esc(t('common.notVerifiedYet'))}">${esc(t('common.notVerified'))}</span>`);
}
