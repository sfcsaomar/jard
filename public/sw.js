// Offline support: the app shell and libraries are cached so the app opens without internet.
// Every file index.html loads must be listed in SHELL (tests/static.test.mjs checks this).
const CACHE = 'asset-inv-v9';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/app/app.css',
  '/app/store.js',
  '/app/list.js',
  '/app/form.js',
  '/app/project-settings.js',
  '/app/form-helpers.js',
  '/app/scanner.js',
  '/app/nameplate.js',
  '/app/protection.js',
  '/app/location.js',
  '/app/session.js',
  '/app/ai.js',
  '/app/sync.js',
  '/app/export.js',
  '/app/main.js',
  '/icon-192.png',
  '/brand/aman-wordmark-on-dark.svg',
  '/brand/aman-logo-on-dark.svg',
  '/vendor/xlsx.full.min.js',
  '/vendor/jszip.min.js',
  '/vendor/html5-qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/company') || url.pathname === '/panel.css') return;

  // Pages: only the app itself is cached; other pages (account links) always load from the network.
  if (req.mode === 'navigate' && url.pathname !== '/' && url.pathname !== '/index.html') return;
  // App page: network first so updates arrive, cache as fallback when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copy)); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // The app's own code and styles: network first so an update never mixes old and new files,
  // cache as fallback when offline.
  if (url.origin === location.origin && url.pathname.startsWith('/app/')) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Libraries, fonts, icons: cache first.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
