// Field inventory app — Current building / location, and the more-fields toggle.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- Location session ----------
// The location fields the project shows (region, city, building name and number, floor, room) are
// kept on the device and fill every new asset until the user changes them.
// Ids: loc_<key> in the location sheet, except the room (loc_room). Settings: locSetting() in form.js.
const LOC_KEYS = ASSET_FIELDS.filter(f=> f.loc).map(f=> f.key);
const locInput = (key)=> $(key === 'location' ? 'loc_room' : 'loc_' + key);
async function currentLocValues(){
  const v = {};
  for(const k of LOC_KEYS) v[k] = await getSetting(locSetting(k));
  return v;
}
function renderLocationBar(v){
  const el = $('locText');
  const shown = LOC_KEYS.filter(k=> fieldShown(k) && v[k]);
  if(!shown.length){
    el.innerHTML = `<span class="loc-empty">${escapeHtml(t('app.loc.none'))}</span>`;
  } else {
    // The building is in bold; the wider area (region, city) is left out when the bar is long.
    const parts = shown.length > 3 ? shown.filter(k=> k !== 'region' && k !== 'city') : shown;
    el.innerHTML = parts.map(k=> k === 'building' || k === 'bname' ? `<b>${escapeHtml(v[k])}</b>` : escapeHtml(v[k])).join(' · ');
  }
}

async function loadLocationBar(){
  renderLocationBar(await currentLocValues());
}

$('setLocationBtn').addEventListener('click', async ()=>{
  const v = await currentLocValues();
  LOC_KEYS.forEach(k=>{
    locInput(k).value = v[k];
    locInput(k).closest('.field').hidden = !fieldShown(k);
  });
  $('locationSheet').classList.add('open');
});
$('closeLocationBtn').addEventListener('click', ()=> $('locationSheet').classList.remove('open'));
$('saveLocationBtn').addEventListener('click', async ()=>{
  const v = {};
  for(const k of LOC_KEYS){
    v[k] = locInput(k).value.trim();
    await setSetting(locSetting(k), v[k]);
  }
  renderLocationBar(v);
  $('locationSheet').classList.remove('open');
  toast(t('app.loc.saved'));
});

// ---------- More fields toggle ----------
$('moreToggle').addEventListener('click', ()=>{
  $('moreToggle').classList.toggle('open');
  $('moreFields').classList.toggle('open');
});
