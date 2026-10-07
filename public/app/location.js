// Field inventory app — Current building / location, and the more-fields toggle.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Location session ----------
function renderLocationBar(building, location){
  const el = $('locText');
  if(!building && !location){
    el.innerHTML = `<span class="loc-empty">${escapeHtml(t('app.loc.none'))}</span>`;
  } else {
    el.innerHTML = `<b>${escapeHtml(building||'—')}</b> · ${escapeHtml(location||'—')}`;
  }
}

async function loadLocationBar(){
  const building = await getSetting('currentBuilding');
  const location = await getSetting('currentLocation');
  renderLocationBar(building, location);
}

$('setLocationBtn').addEventListener('click', async ()=>{
  $('loc_building').value = await getSetting('currentBuilding');
  $('loc_room').value = await getSetting('currentLocation');
  $('locationSheet').classList.add('open');
});
$('closeLocationBtn').addEventListener('click', ()=> $('locationSheet').classList.remove('open'));
$('saveLocationBtn').addEventListener('click', async ()=>{
  const building = $('loc_building').value.trim();
  const room = $('loc_room').value.trim();
  await setSetting('currentBuilding', building);
  await setSetting('currentLocation', room);
  renderLocationBar(building, room);
  $('locationSheet').classList.remove('open');
  toast(t('app.loc.saved'));
});

// ---------- More fields toggle ----------
$('moreToggle').addEventListener('click', ()=>{
  $('moreToggle').classList.toggle('open');
  $('moreFields').classList.toggle('open');
});
