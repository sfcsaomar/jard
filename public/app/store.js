// Field inventory app — Local storage on the phone (IndexedDB, one database per signed-in user) and the app state.
// Loaded by index.html as a plain script, in the order listed there (later files may use earlier ones at load time, not the reverse).

// ---------- IndexedDB layer ----------
// Each signed-in user gets a separate database on the device.
let DB_NAME = 'assetInventoryDB';
const STORE = 'assets';
let db;

const SETTINGS_STORE = 'settings';

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e)=>{
      const _db = e.target.result;
      if(!_db.objectStoreNames.contains(STORE)){
        const store = _db.createObjectStore(STORE, {keyPath:'id', autoIncrement:true});
        store.createIndex('tag', 'tag', {unique:false});
      }
      if(!_db.objectStoreNames.contains(SETTINGS_STORE)){
        _db.createObjectStore(SETTINGS_STORE, {keyPath:'key'});
      }
    };
    req.onsuccess = (e)=>{ db = e.target.result; resolve(db); };
    req.onerror = (e)=> reject(e);
  });
}

function getSetting(key){
  return new Promise((resolve)=>{
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = ()=> resolve(req.result ? req.result.value : '');
    req.onerror = ()=> resolve('');
  });
}

function setSetting(key, value){
  return new Promise((resolve)=>{
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({key, value});
    tx.oncomplete = ()=> resolve();
  });
}

function dbAll(){
  return new Promise((resolve)=>{
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = ()=> resolve(req.result.sort((a,b)=> b.createdAt - a.createdAt));
  });
}

// Every save by the user marks the asset for upload; the sync engine saves with fromSync.
function newUid(){
  return crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(16) + Math.random().toString(16).slice(2, 14);
}
function dbGet(id){
  return new Promise((resolve)=>{
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> resolve(null);
  });
}
function dbPut(asset, {fromSync = false} = {}){
  if(!fromSync){
    asset.uid = asset.uid || newUid();
    asset.updatedAt = Date.now();
    asset.dirty = true;
    if(typeof scheduleSync === 'function') scheduleSync();
  }
  return new Promise((resolve)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = asset.id ? store.put(asset) : store.add(asset);
    req.onsuccess = (e)=> resolve(e.target.result);
  });
}

function dbDelete(id){
  return new Promise((resolve)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = ()=> resolve();
  });
}

// ---------- App state ----------
let assets = [];
let currentEditId = null;
let currentPhotos = [null, null, null, null]; // Blobs
let currentCondition = '';
let currentLabel = null; // nameplate photo (Blob)

const $ = (id)=> document.getElementById(id);

function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.classList.remove('show'), Math.max(1800, String(msg).length * 55));
}
