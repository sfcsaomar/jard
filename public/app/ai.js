// Field inventory app — AI description of an asset from its photos (through our server).
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- AI description (through our server) ----------
function updateAiButtonState(){
  const hasPhoto = currentPhotos.some(p=>p);
  const aiOn = !!(session && session.license.aiEnabled);
  const btn = $('aiSuggestBtn');
  btn.disabled = !aiOn || !hasPhoto;
  $('aiHint').textContent = !aiOn
    ? 'ميزة الذكاء الاصطناعي غير مفعّلة في رخصتك'
    : (!hasPhoto ? 'أضف صورة واحدة على الأقل أولاً' : 'تحتاج اتصالًا بالإنترنت');
}

// Downscale before upload: phone photos are often 4-8 MB, which exceeds server limits and costs more.
function resizeForAI(blob, maxSide=1024, quality=0.82){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

$('aiSuggestBtn').addEventListener('click', async ()=>{
  const photo = currentPhotos.find(p=>p);
  if(!photo || !session) return;
  if(!navigator.onLine){ toast('هذه الميزة تحتاج اتصالًا بالإنترنت'); return; }

  const btn = $('aiSuggestBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'جارٍ التحليل...';
  try{
    const image = await resizeForAI(photo);
    const r = await api('/api/ai-describe', {image, mediaType:'image/jpeg'}, session.token);
    if(r.ok && r.text){
      $('f_name').value = r.text;
      updateDescMeta();
      toast(r.remaining != null ? `تم اقتراح وصف (متبقٍ ${r.remaining} هذا الشهر)` : 'تم اقتراح وصف — تقدر تعدّله قبل الحفظ');
    } else if(HARD_FAIL.includes(r.code)){
      await doLogout(r.message);
    } else {
      toast(r.message || 'ما قدرنا نولّد وصف، جرّب مرة ثانية');
    }
  }catch(err){
    console.error(err);
    toast('فشل الاتصال بالخادم — تحقق من الإنترنت');
  }finally{
    btn.classList.remove('loading');
    btn.textContent = '✨ اقترح وصف بالذكاء الاصطناعي';
    updateAiButtonState();
  }
});
