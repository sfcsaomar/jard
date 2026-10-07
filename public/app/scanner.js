// Field inventory app — Barcode and QR scanning: live camera, and decoding a still photo.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Barcode / QR scanner ----------
// Live camera scan with a wide target box, high resolution, continuous focus, torch and zoom.
// 1D barcodes must be read twice in a row before they are accepted (guards against misreads).
// If live scanning struggles, "Photograph the barcode" takes a full-resolution photo and decodes that,
// and if that also fails the AI reads the printed number (user confirms it).
let scanner = null;
let scanCallback = null;
let lastRead = {value:'', at:0};
let torchOn = false;
const SCAN_HINT = t('app.scan.hint');

function loadScript(src){
  return new Promise((resolve, reject)=>{
    if(window.Html5Qrcode) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = reject;
    document.head.appendChild(el);
  });
}
function scanFormats(){
  const F = Html5QrcodeSupportedFormats;
  return [F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX];
}
// Wide, short box for long 1D barcodes; still tall enough for a QR code.
function scanBox(w, h){
  const width = Math.floor(Math.min(w * 0.9, 560));
  const height = Math.floor(Math.max(150, Math.min(h * 0.55, width * 0.62)));
  return {width, height};
}
function videoTrack(){
  const v = document.querySelector('#scanReader video');
  const st = v && v.srcObject;
  return st && st.getVideoTracks ? st.getVideoTracks()[0] : null;
}
async function setupCameraControls(){
  $('torchBtn').style.display = 'none';
  $('zoomRow').style.display = 'none';
  torchOn = false; $('torchBtn').classList.remove('on');
  const track = videoTrack();
  if(!track || !track.getCapabilities) return;
  let caps = {};
  try{ caps = track.getCapabilities() || {}; }catch{}
  try{
    if(Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')){
      await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
    }
  }catch{}
  if(caps.torch) $('torchBtn').style.display = 'inline-block';
  if(caps.zoom && caps.zoom.max > caps.zoom.min){
    const z = $('zoomSlider');
    z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 8); z.step = caps.zoom.step || 0.1;
    // A little zoom lets the phone stay far enough away to focus on small labels.
    const start = Math.min(Number(z.max), Math.max(Number(z.min), 1.5));
    z.value = start;
    try{ await track.applyConstraints({advanced:[{zoom:start}]}); }catch{}
    $('zoomRow').style.display = 'flex';
  }
}
$('zoomSlider').addEventListener('input', async (e)=>{
  const track = videoTrack(); if(!track) return;
  try{ await track.applyConstraints({advanced:[{zoom:Number(e.target.value)}]}); }catch{}
});
$('torchBtn').addEventListener('click', async ()=>{
  const track = videoTrack(); if(!track) return;
  try{
    await track.applyConstraints({advanced:[{torch:!torchOn}]});
    torchOn = !torchOn;
    $('torchBtn').classList.toggle('on', torchOn);
  }catch{ toast(t('app.scan.noTorch')); }
});

async function openScanner(onResult){
  scanCallback = onResult;
  lastRead = {value:'', at:0};
  try{
    await loadScript('/vendor/html5-qrcode.min.js');
  }catch{
    toast(t('app.scan.noLib'));
    return;
  }
  $('scanner').classList.add('open');
  $('scanHint').textContent = SCAN_HINT;
  scanner = new Html5Qrcode('scanReader', {
    verbose: false,
    formatsToSupport: scanFormats(),
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  });
  const onOk = (text, result)=> onScanned(text, result);
  try{
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: scanBox,
        videoConstraints: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      onOk, ()=>{}
    );
  }catch(err1){
    console.warn('high-res start failed, retrying', err1);
    try{
      try{ scanner.clear(); }catch{}
      scanner = new Html5Qrcode('scanReader', { verbose:false, formatsToSupport: scanFormats(),
        experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: scanBox }, onOk, ()=>{});
    }catch(err){
      console.error(err);
      await stopLiveScan();
      $('scanHint').textContent = t('app.scan.noCamera');
      return;
    }
  }
  setupCameraControls();
}
async function stopLiveScan(){
  if(scanner){
    try{ if(scanner.isScanning) await scanner.stop(); }catch{}
    try{ scanner.clear(); }catch{}
    scanner = null;
  }
}
async function closeScanner(){
  $('scanner').classList.remove('open');
  await stopLiveScan();
}
function isMatrixCode(result){
  const f = result && result.result && result.result.format && result.result.format.formatName || '';
  return /QR|DATA_MATRIX|AZTEC|PDF/i.test(f);
}
async function onScanned(text, result){
  const value = String(text || '').trim();
  if(!value || !scanCallback) return;
  if(!isMatrixCode(result)){
    const now = Date.now();
    if(lastRead.value !== value || now - lastRead.at > 2000){ lastRead = {value, at:now}; return; }
  }
  deliverScan(value);
}
async function deliverScan(value){
  if(!scanCallback) return;
  const cb = scanCallback;
  scanCallback = null;
  if(navigator.vibrate) navigator.vibrate(60);
  await closeScanner();
  cb(value);
}

// ---------- Decode a still photo of a barcode ----------
function imageVariant(file, maxSide, rotate=false){
  return new Promise((resolve)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = rotate ? h : w; c.height = rotate ? w : h;
      const ctx = c.getContext('2d');
      if(rotate){ ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((b)=> resolve(b ? new File([b], 'scan.jpg', {type:'image/jpeg'}) : null), 'image/jpeg', 0.92);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
async function decodePhoto(file){
  // 1) Native detector (Android Chrome): fast and accurate.
  if('BarcodeDetector' in window){
    try{
      const det = new BarcodeDetector();
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      const hit = codes.find(c=> c.rawValue && c.rawValue.trim());
      if(hit) return hit.rawValue.trim();
    }catch{}
  }
  // 2) Library decoder on several sizes and orientations.
  await loadScript('/vendor/html5-qrcode.min.js');
  const reader = new Html5Qrcode('scanFileReader', { verbose:false, formatsToSupport: scanFormats(),
    experimentalFeatures: { useBarCodeDetectorIfSupported: false } });
  const tries = [[1600,false],[2400,false],[1000,false],[1600,true]];
  try{
    for(const [side, rot] of tries){
      const f = await imageVariant(file, side, rot);
      if(!f) continue;
      try{ const text = await reader.scanFile(f, false); if(text && text.trim()) return text.trim(); }catch{}
    }
  }finally{ try{ reader.clear(); }catch{} }
  return '';
}
$('scanPhotoBtn').addEventListener('click', ()=> $('scanPhotoInput').click());
$('scanPhotoInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file || !scanCallback) return;
  await stopLiveScan();
  const btn = $('scanPhotoBtn');
  btn.disabled = true;
  $('scanHint').textContent = t('app.scan.reading');
  try{
    const code = await decodePhoto(file);
    if(code){ deliverScan(code); return; }
    const aiOn = !!(session && session.license.aiEnabled);
    if(aiOn && navigator.onLine){
      $('scanHint').textContent = t('app.scan.aiReading');
      const image = await resizeForAI(file, 1600, 0.85);
      const r = await api('/api/ai-describe', {image, mediaType:'image/jpeg', mode:'scan'}, session.token);
      if(HARD_FAIL.includes(r.code)){ await closeScanner(); await doLogout(r.message); return; }
      if(r.ok && r.code){
        if(confirm(t('app.scan.aiConfirm', {code: r.code}))){ deliverScan(r.code); return; }
      } else if(!r.ok && r.message){ toast(r.message); }
    }
    $('scanHint').textContent = t('app.scan.notRead');
  }catch(err){
    console.error(err);
    $('scanHint').textContent = t('app.scan.photoFailed');
  }finally{
    btn.disabled = false;
  }
});
$('closeScanBtn').addEventListener('click', ()=>{ scanCallback = null; closeScanner(); });

$('scanTagBtn').addEventListener('click', ()=> openScanner((code)=>{
  $('f_tag').value = code;
  checkDuplicate();
  toast(t('app.scan.done'));
}));

$('scanSearchBtn').addEventListener('click', ()=> openScanner(async (code)=>{
  const same = assets.filter(a => normTag(a.tag) === normTag(code));
  const found = same.find(a=> !isFlagged(a)) || same[0];
  if(found){ openForm(found.id); return; }
  if(confirm(t('app.scan.newConfirm', {code}))){
    await openForm(null);
    $('f_tag').value = code;
    checkDuplicate();
  }
}));
