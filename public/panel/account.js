// Account page (/account): forgot password, set a password from an invitation or reset link, confirm an email.
// Uses the helpers in panel/common.js.
const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
// Remove the token from the address bar and history once read.
if(token) history.replaceState(null, '', location.pathname);

async function call(action, body){
  try{
    const r = await fetch('/api/account', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action, ...body})});
    return await r.json();
  }catch{ return {ok:false, message:'تعذّر الاتصال بالخادم. تحقق من الإنترنت'}; }
}
function show(html){ $('view').innerHTML = html; }
function done(title, text, home){
  show(`<h2>${esc(title)}</h2><p class="msg ok-msg">${esc(text)}</p>
    ${home ? `<a class="btn btn-primary" style="display:block; text-align:center; text-decoration:none" href="${esc(home)}">تسجيل الدخول</a>` : ''}`);
}

// ---------- forgot password ----------
function requestForm(){
  show(`<h2>نسيت كلمة المرور</h2>
    <p class="sub">أدخل اسم المستخدم أو البريد المسجّل في حسابك، وسنرسل لك رابطًا لاختيار كلمة مرور جديدة.</p>
    <form id="f">
      <input id="ident" dir="ltr" autocapitalize="none" autocomplete="username" placeholder="اسم المستخدم أو البريد الإلكتروني" required>
      <div class="form-err" id="e"></div>
      <button class="btn btn-primary" style="width:100%" id="b">إرسال الرابط</button>
    </form>`);
  $('f').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    $('b').disabled = true; $('e').textContent = '';
    const d = await call('requestReset', {identifier: $('ident').value});
    $('b').disabled = false;
    if(!d.ok){ $('e').textContent = d.message || 'تعذّر الإرسال'; return; }
    done('تحقق من بريدك', d.message, null);
  });
}

// ---------- set password (invitation or reset) ----------
function passwordForm(info){
  const invite = info.purpose === 'invite';
  show(`<h2>${invite ? 'تفعيل الحساب' : 'كلمة مرور جديدة'}</h2>
    <div class="who">${info.displayName ? `<b>${esc(info.displayName)}</b><br>` : ''}اسم المستخدم: <span class="mono" dir="ltr">${esc(info.username)}</span></div>
    <form id="f">
      <input type="text" value="${esc(info.username)}" autocomplete="username" hidden readonly>
      <label>كلمة المرور (${info.minLength} أحرف على الأقل)</label>
      <input id="p1" type="password" dir="ltr" autocomplete="new-password" minlength="${info.minLength}" required>
      <label>أعد كتابة كلمة المرور</label>
      <input id="p2" type="password" dir="ltr" autocomplete="new-password" required>
      <div class="form-err" id="e"></div>
      <button class="btn btn-primary" style="width:100%" id="b">${invite ? 'تفعيل الحساب' : 'حفظ كلمة المرور'}</button>
    </form>`);
  $('f').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    $('e').textContent = '';
    if($('p1').value.length < info.minLength){ $('e').textContent = `كلمة المرور ${info.minLength} أحرف على الأقل`; return; }
    if($('p1').value !== $('p2').value){ $('e').textContent = 'كلمتا المرور غير متطابقتين'; return; }
    $('b').disabled = true;
    const d = await call('setPassword', {token, password: $('p1').value});
    $('b').disabled = false;
    if(!d.ok){ $('e').textContent = d.message || 'تعذّر الحفظ'; return; }
    done(invite ? 'تم تفعيل حسابك' : 'تم تغيير كلمة المرور',
      `ادخل الآن باسم المستخدم ${d.username} وكلمة المرور الجديدة.`, d.home);
  });
}

async function start(){
  if(!token){ requestForm(); return; }
  const info = await call('peek', {token});
  if(!info.ok){
    show(`<h2>الرابط غير صالح</h2><p class="msg">${esc(info.message || '')}</p>
      <button class="btn btn-ghost" style="width:100%" id="again">طلب رابط جديد</button>`);
    $('again').addEventListener('click', requestForm);
    return;
  }
  if(info.purpose === 'verify_email'){
    const d = await call('verifyEmail', {token});
    if(d.ok) done('تم تأكيد البريد', `أصبح ${d.email} البريد المعتمد لحساب ${d.username}.`, d.home);
    else show(`<h2>تعذّر التأكيد</h2><p class="msg">${esc(d.message || '')}</p>`);
    return;
  }
  passwordForm(info);
}
start();
