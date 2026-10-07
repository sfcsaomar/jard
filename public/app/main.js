// Field inventory app — Start-up: offline support (service worker) and opening the session.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Init ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
(async function boot(){
  session = lsGet(SESSION_KEY);
  const p = session && session.token ? tokenPayload(session.token) : null;
  if(p && p.exp > Date.now() && p.dev === deviceId()){
    await enterApp();
    verifyOnline();
  } else {
    const had = !!session;
    session = null; lsDel(SESSION_KEY);
    showLogin(had ? t('app.login.graceOver') : '');
  }
})();
