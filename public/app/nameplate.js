// Field inventory app — Reading brand, model and serial number from a photo of the nameplate (AI, through our server).
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Nameplate reading ----------
function renderLabel(){
  const img = $('labelThumb');
  if(currentLabel){
    const url = URL.createObjectURL(currentLabel);
    img.src = url; img.style.display = 'block';
    img.onclick = ()=> openLightbox(url);
  } else {
    img.removeAttribute('src'); img.style.display = 'none';
  }
}
$('labelReadBtn').addEventListener('click', ()=> $('labelInput').click());
$('labelInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  currentLabel = await compressPhoto(file, 2000, 0.85);
  renderLabel();
  if(!session || !session.license.aiEnabled){ toast('حُفظت صورة الملصق. القراءة الآلية غير مفعّلة في رخصتك'); return; }
  if(!navigator.onLine){ toast('حُفظت صورة الملصق. القراءة تحتاج اتصالًا بالإنترنت'); return; }
  const btn = $('labelReadBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'جارٍ قراءة الملصق...';
  try{
    const image = await resizeForAI(currentLabel, 1600, 0.85);
    const r = await api('/api/ai-describe', {image, mediaType:'image/jpeg', mode:'label'}, session.token);
    if(r.ok && r.fields){
      const got = [];
      if(r.fields.brand){ $('f_brand').value = r.fields.brand; got.push('الماركة'); }
      if(r.fields.model){ $('f_model').value = r.fields.model; got.push('الموديل'); }
      if(r.fields.sn){ $('f_sn').value = r.fields.sn; got.push('الرقم التسلسلي'); }
      toast(got.length ? `تمت قراءة: ${got.join('، ')} — راجعها قبل الحفظ` : 'لم تظهر بيانات واضحة. صوّر الملصق عن قرب');
    } else if(HARD_FAIL.includes(r.code)){
      await doLogout(r.message);
    } else {
      toast(r.message || 'تعذّرت القراءة، حاول مرة أخرى');
    }
  }catch(err){
    console.error(err);
    toast('فشل الاتصال بالخادم — تحقق من الإنترنت');
  }finally{
    btn.disabled = false; btn.textContent = label;
  }
});
