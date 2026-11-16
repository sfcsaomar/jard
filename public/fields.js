// Asset entry fields, shared by the field app (index.html) and the company panel (company.html).
// The server keeps the same keys in netlify/lib/common.mjs (FIELD_KEYS) and the same props in
// netlify/functions/sync.mjs (FIELDS); tests/static.test.mjs checks the three lists match.
//
//   key    settings key: a project's settings.hidden and settings.required hold these
//   prop   property on the asset record (phone database, sync, server data column)
//   en     English Excel header; for the original fields it is the client template's exact name
//   added  added in v2.6: hidden in projects whose settings were saved before it (settings.v !== 2)
//   extra  not in the v2.6 field list: hidden by default in a new project
//   loc    filled from the "current location" and kept from one asset to the next
//
// The order is the order of the Excel columns. The asset number (tag) is always shown and required.
var ASSET_FIELDS = [
  {key: 'oldtag',     prop: 'oldTag',          en: 'Old Asset Code', added: true},
  {key: 'category',   prop: 'category',        en: 'Category Name'},
  {key: 'catcode',    prop: 'catCode',         en: 'Category Code', extra: true},
  {key: 'subcat',     prop: 'subCategory',     en: 'Sub Category Name', extra: true},
  {key: 'subcatcode', prop: 'subCategoryCode', en: 'Sub Category Code', extra: true},
  {key: 'name',       prop: 'name',            en: 'Description'},
  {key: 'brand',      prop: 'brand',           en: 'Brand'},
  {key: 'model',      prop: 'model',           en: 'Model'},
  {key: 'sn',         prop: 'sn',              en: 'SN'},
  {key: 'year',       prop: 'year',            en: 'Manufacture Year', added: true},
  {key: 'qty',        prop: 'qty',             en: 'Quantity', added: true},
  {key: 'condition',  prop: 'condition',       en: 'Condition'},
  {key: 'opstatus',   prop: 'opStatus',        en: 'Operational Status', added: true},
  {key: 'region',     prop: 'region',          en: 'Region', added: true, loc: true},
  {key: 'city',       prop: 'city',            en: 'City', added: true, loc: true},
  {key: 'bname',      prop: 'buildingName',    en: 'Building Name', added: true, loc: true},
  {key: 'building',   prop: 'building',        en: 'Building  Id', loc: true},
  {key: 'floor',      prop: 'floor',           en: 'Floor', added: true, loc: true},
  {key: 'location',   prop: 'location',        en: 'Location', loc: true},
  {key: 'roomnotes',  prop: 'roomNotes',       en: 'Room Notes', added: true},
  {key: 'dept',       prop: 'department',      en: 'Department', added: true},
  {key: 'employee',   prop: 'employee',        en: 'Employee Name', added: true},
  {key: 'plateno',    prop: 'plateNo',         en: 'PlateNo', extra: true},
  {key: 'value',      prop: 'value',           en: 'Value', extra: true},
  {key: 'notes',      prop: 'notes',           en: 'Remarks'}
];
var FIELD_BY_KEY = Object.fromEntries(ASSET_FIELDS.map(f=> [f.key, f]));

// Stored values of the two choice fields are English; labels follow the language.
var CONDITION_KEYS = {'Good': 'co.cond.good', 'New': 'co.cond.new', 'Fair': 'co.cond.fair', 'Needs Maintenance': 'co.cond.maint'};
var OPSTATUS_KEYS = {'Working': 'co.op.working', 'Not Working': 'co.op.notWorking', 'Not Tested': 'co.op.untested'};

// Visible fields of a project, in column order. settings comes from the server (normSettings).
function visibleFields(settings){
  const hidden = new Set((settings && settings.hidden) || []);
  return ASSET_FIELDS.filter(f=> !hidden.has(f.key));
}

// One Excel sheet layout for both exports (phone and panel).
// Projects saved before v2.6 keep the original client template exactly (English headers, 15 columns).
// Newer projects get: row number, asset number, the visible fields, inventory date; headers in the entry language.
function excelLayout(settings){
  if(!settings || settings.v !== 2){
    const legacy = ['tag','catcode','category','subcatcode','subcat','name','brand','condition','model','sn','plateno','location','building','notes','value'];
    const head = {tag: 'Barcode'};
    return {
      headers: legacy.map(k=> head[k] || FIELD_BY_KEY[k].en),
      row: (a)=> legacy.map(k=> k === 'tag' ? (a.tag || '') : k === 'value' ? (a.value ? Number(a.value) || a.value : '') : (a[FIELD_BY_KEY[k].prop] || '')),
      widths: [14,12,16,14,16,30,12,10,12,14,10,12,10,22,10]
    };
  }
  const lang = settings.lang === 'en' ? 'en' : 'ar';
  const L = (k)=> (I18N[lang] && I18N[lang][k]) || k;
  const fields = visibleFields(settings);
  const head = (f)=> lang === 'en' ? f.en : L('co.f.' + f.key);
  const val = (f, a)=>{
    const v = a[f.prop];
    if(v == null || v === '') return '';
    if(f.key === 'condition' && CONDITION_KEYS[v]) return lang === 'en' ? v : L(CONDITION_KEYS[v]);
    if(f.key === 'opstatus' && OPSTATUS_KEYS[v]) return lang === 'en' ? v : L(OPSTATUS_KEYS[v]);
    if(f.key === 'value' || f.key === 'qty' || f.key === 'year') return Number(v) || v;
    return v;
  };
  const day = (ms)=> ms ? new Date(ms).toISOString().slice(0, 10) : '';
  return {
    headers: [lang === 'en' ? 'No.' : L('co.f.seq'), lang === 'en' ? 'Barcode' : L('co.f.tag'), ...fields.map(head), lang === 'en' ? 'Inventory Date' : L('co.f.invdate')],
    row: (a, i)=> [i + 1, a.tag || '', ...fields.map(f=> val(f, a)), day(a.createdAt)],
    widths: [6, 16, ...fields.map(f=> f.key === 'name' || f.key === 'notes' || f.key === 'roomnotes' ? 30 : 14), 12]
  };
}
// Rows as arrays of arrays, ready for XLSX.utils.aoa_to_sheet.
function excelSheet(settings, assets){
  const lay = excelLayout(settings);
  const ws = XLSX.utils.aoa_to_sheet([lay.headers, ...assets.map((a, i)=> lay.row(a, i))]);
  ws['!cols'] = lay.widths.map(w=> ({wch: w}));
  return ws;
}
