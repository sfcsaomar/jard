// Field inventory app — Export to Excel + photos (zip), and restore from an export file.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Export ----------
$('exportBtn').addEventListener('click', async ()=>{
  const all = await dbAll();
  if(all.length === 0){
    toast(t('app.exp.none'));
    return;
  }
  $('exportBtn').textContent = t('app.exp.working');
  $('exportBtn').disabled = true;

  try{
    // Build Excel sheet
    const active = all.filter(a=> !isFlagged(a));
    const flagged = all.filter(isFlagged);
    const rows = active.map(a=>({
      'Barcode': a.tag || '',
      'Category Code': a.catCode || '',
      'Category Name': a.category || '',
      'Sub Category Code': a.subCategoryCode || '',
      'Sub Category Name': a.subCategory || '',
      'Description': a.name || '',
      'Brand': a.brand || '',
      'Condition': a.condition || '',
      'Model': a.model || '',
      'SN': a.sn || '',
      'PlateNo': a.plateNo || '',
      'Location': a.location || '',
      'Building  Id': a.building || '',
      'Remarks': a.notes || '',
      'Value': a.value ? Number(a.value) || a.value : ''
    }));
    const HEADERS = ['Barcode','Category Code','Category Name','Sub Category Code','Sub Category Name','Description','Brand','Condition','Model','SN','PlateNo','Location','Building  Id','Remarks','Value'];
    const ws = XLSX.utils.json_to_sheet(rows, {header: HEADERS});
    ws['!cols'] = [{wch:14},{wch:12},{wch:16},{wch:14},{wch:16},{wch:30},{wch:12},{wch:10},{wch:12},{wch:14},{wch:10},{wch:12},{wch:10},{wch:22},{wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t('co.xl.sheet'));
    if(flagged.length){
      const fRows = flagged.map(a=>({
        'Barcode': a.tag || '',
        'Description': a.name || '',
        'Category Name': a.category || '',
        'Location': a.location || '',
        'Building  Id': a.building || '',
        [t('co.xl.reason')]: a.deleteFlag.reason || '',
        [t('co.xl.flagDate')]: fmtDate(a.deleteFlag.at),
        [t('co.xl.user')]: session ? (session.license.displayName || session.license.username) : ''
      }));
      const fws = XLSX.utils.json_to_sheet(fRows);
      fws['!cols'] = [{wch:14},{wch:30},{wch:16},{wch:12},{wch:10},{wch:30},{wch:12},{wch:16}];
      XLSX.utils.book_append_sheet(wb, fws, t('co.xl.flaggedSheet'));
    }
    const xlsxData = XLSX.write(wb, {bookType:'xlsx', type:'array'});

    // Build ZIP: Excel + photos + data.json (data.json makes the export a restorable backup)
    const zip = new JSZip();
    zip.file(t('app.exp.xlsxName') + '.xlsx', xlsxData);
    const imgFolder = zip.folder(t('app.exp.folder'));
    const used = new Set();
    const uniqueName = (base)=>{
      let name = `${base}.jpg`, i = 2;
      while(used.has(name)){ name = `${base}_${i++}.jpg`; }
      used.add(name);
      return name;
    };
    const records = [];
    for(const a of all){
      const safeTag = (a.tag || t('app.exp.noTag')).replace(/[\\/:*?"<>|]/g, '-');
      const photoFiles = [];
      let n = 1;
      for(const p of a.photos){
        if(p){
          const name = uniqueName(`${safeTag}-${n}`);
          imgFolder.file(name, p);
          photoFiles.push(name);
          n++;
        }
      }
      let labelFile = null;
      if(a.labelPhoto){
        labelFile = uniqueName(`${safeTag}-label`);
        imgFolder.file(labelFile, a.labelPhoto);
      }
      const {id, photos, labelPhoto, dirty, upHashes, syncedAt, ...fields} = a;
      records.push({...fields, photoFiles, labelFile});
    }
    const user = session ? tokenPayload(session.token).u : '';
    zip.file('data.json', JSON.stringify({format:'asset-inventory-backup', version:1, exportedAt:new Date().toISOString(), user, assets:records}, null, 1));

    const zipBlob = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `${t('app.exp.xlsxName')}_${dateStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=> URL.revokeObjectURL(url), 60000);
    await setSetting('lastBackupAt', Date.now());
    updateBackupState();
    toast(flagged.length ? t('app.exp.doneFlagged', {n: flagged.length}) : t('app.exp.done'));
  } catch(err){
    console.error(err);
    toast(t('app.exp.failed'));
  } finally {
    $('exportBtn').textContent = t('app.export');
    $('exportBtn').disabled = false;
  }
});

// ---------- Restore from an export file ----------
$('restoreBtn').addEventListener('click', ()=> $('restoreInput').click());
$('restoreInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const btn = $('restoreBtn');
  btn.disabled = true; btn.textContent = t('app.res.working');
  try{
    const zip = await JSZip.loadAsync(file);
    const dataFile = zip.file('data.json');
    if(!dataFile){ toast(t('app.res.noData')); return; }
    const data = JSON.parse(await dataFile.async('string'));
    if(data.format !== 'asset-inventory-backup' || !Array.isArray(data.assets)){ toast(t('app.res.bad')); return; }
    const existing = await dbAll();
    const seen = new Set(existing.map(a=> normTag(a.tag) + '|' + a.createdAt));
    const readImg = async (name)=>{
      if(!name) return null;
      // Exports from either interface language: the photos folder is named in that language.
        const f = zip.file(I18N.ar['app.exp.folder'] + '/' + name) || zip.file(I18N.en['app.exp.folder'] + '/' + name);
      if(!f) return null;
      return new Blob([await f.async('arraybuffer')], {type:'image/jpeg'});
    };
    let added = 0, skipped = 0;
    for(const r of data.assets){
      const key = normTag(r.tag) + '|' + r.createdAt;
      if(seen.has(key)){ skipped++; continue; }
      const {photoFiles = [], labelFile = null, ...fields} = r;
      const photos = [null, null, null, null];
      for(let i = 0; i < Math.min(4, photoFiles.length); i++) photos[i] = await readImg(photoFiles[i]);
      await dbPut({...fields, photos, labelPhoto: await readImg(labelFile), createdAt: r.createdAt || Date.now()});
      seen.add(key);
      added++;
    }
    await setSetting('lastBackupAt', Date.now());
    await refreshList($('searchBox').value);
    $('settingsSheet').classList.remove('open');
    toast(skipped ? t('app.res.doneSkipped', {n: added, s: skipped}) : t('app.res.done', {n: added}));
  }catch(err){
    console.error(err);
    toast(t('app.res.readFailed'));
  }finally{
    btn.disabled = false; btn.textContent = t('app.acc.restore');
  }
});
