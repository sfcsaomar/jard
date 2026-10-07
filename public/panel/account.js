// Account page (/account): forgot password, set a password from an invitation or reset link, confirm an email.
// Uses the helpers in panel/common.js and the i18n texts (acc.*, common.*).
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
// Remove the token from the address bar and history once read.
if(token) history.replaceState(null, '', location.pathname);

async function call(action, body){
  try{
    const r = await fetch('/api/account', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action, ...body})});
    return await r.json();
  }catch{ return {ok:false, message:t('common.offline'), messageEn:t('common.offline')}; }
}
function show(html){ $('view').innerHTML = html; }
function done(title, text, home){
  show(`<h2>${esc(title)}</h2><p class="msg ok-msg">${esc(text)}</p>
    ${home ? `<a class="btn btn-primary" style="display:block; text-align:center; text-decoration:none" href="${esc(home)}">${esc(t('common.signIn'))}</a>` : ''}`);
}

// ---------- forgot password ----------
function requestForm(){
  show(`<h2>${esc(t('acc.forgot.title'))}</h2>
    <p class="sub">${esc(t('acc.forgot.sub'))}</p>
    <form id="f">
      <label for="ident">${esc(t('acc.forgot.ident'))}</label>
      <input id="ident" dir="ltr" autocapitalize="none" autocomplete="username" required>
      <div class="form-err" id="e"></div>
      <button class="btn btn-primary" style="width:100%" id="b">${esc(t('acc.forgot.send'))}</button>
    </form>`);
  $('f').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    $('b').disabled = true; $('e').textContent = '';
    const d = await call('requestReset', {identifier: $('ident').value});
    $('b').disabled = false;
    if(!d.ok){ $('e').textContent = msgOf(d, 'acc.forgot.failed'); return; }
    done(t('acc.forgot.check'), msgOf(d), null);
  });
}

// ---------- set password (invitation or reset) ----------
function passwordForm(info){
  const invite = info.purpose === 'invite';
  show(`<h2>${esc(t(invite ? 'acc.activate' : 'acc.newPassword'))}</h2>
    <div class="who">${info.displayName ? `<b>${esc(info.displayName)}</b><br>` : ''}${esc(t('common.username'))}: <span class="mono" dir="ltr">${esc(info.username)}</span></div>
    <form id="f">
      <input type="text" value="${esc(info.username)}" autocomplete="username" hidden readonly>
      <label for="p1">${esc(t('acc.pw.min', {n: info.minLength}))}</label>
      <input id="p1" type="password" dir="ltr" autocomplete="new-password" minlength="${info.minLength}" required>
      <label for="p2">${esc(t('acc.pw.repeat'))}</label>
      <input id="p2" type="password" dir="ltr" autocomplete="new-password" required>
      <div class="form-err" id="e"></div>
      <button class="btn btn-primary" style="width:100%" id="b">${esc(t(invite ? 'acc.activate' : 'acc.pw.save'))}</button>
    </form>`);
  $('f').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    $('e').textContent = '';
    if($('p1').value.length < info.minLength){ $('e').textContent = t('acc.pw.short', {n: info.minLength}); return; }
    if($('p1').value !== $('p2').value){ $('e').textContent = t('acc.pw.mismatch'); return; }
    $('b').disabled = true;
    const d = await call('setPassword', {token, password: $('p1').value});
    $('b').disabled = false;
    if(!d.ok){ $('e').textContent = msgOf(d); return; }
    done(t(invite ? 'acc.activated' : 'acc.pw.changed'), t('acc.pw.signInNow', {user: d.username}), d.home);
  });
}

async function start(){
  if(!token){ requestForm(); return; }
  const info = await call('peek', {token});
  if(!info.ok){
    show(`<h2>${esc(t('acc.bad.title'))}</h2><p class="msg">${esc(msgOf(info))}</p>
      <button class="btn btn-ghost" style="width:100%" id="again">${esc(t('acc.bad.again'))}</button>`);
    $('again').addEventListener('click', requestForm);
    return;
  }
  if(info.purpose === 'verify_email'){
    const d = await call('verifyEmail', {token});
    if(d.ok) done(t('acc.verified'), t('acc.verifiedText', {email: d.email, user: d.username}), d.home);
    else show(`<h2>${esc(t('acc.verifyFailed'))}</h2><p class="msg">${esc(msgOf(d))}</p>`);
    return;
  }
  passwordForm(info);
}
start();
