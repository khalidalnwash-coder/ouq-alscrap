// Service worker for تشليح الخليج — app-shell caching + offline fallback only.
// Never caches /api/* (live marketplace data) or /uploads/* (user media) —
// those always go straight to the network, untouched by this file.
//
// IMPORTANT for future changes: bump CACHE_VERSION whenever APP_SHELL's file
// list changes (a file added/removed), so the old cache gets cleaned up in
// `activate`. Freshness of file *contents* doesn't depend on this version —
// the fetch handler below is network-first, so installed users always get
// the latest app.js/styles.css/index.html when they're online; the cache is
// purely an offline fallback, never a staleness risk.
const CACHE_VERSION = 'alscrap-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/vendor/lucide.min.js',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Activate this new worker immediately instead of waiting for every open
  // tab to close first — together with clients.claim() below, this is what
  // gets an update to already-open tabs without the user doing anything.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept POST/PATCH/DELETE — let those hit the network directly

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, Cloudinary media, etc. — untouched
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return; // live data/media — untouched

  // A full page load (including the very first visit while offline, or a
  // reload after connectivity drops) — try the network first, and only show
  // our own Arabic "no internet" page instead of the browser's generic error.
  // cache: 'no-store' forces an actual network attempt rather than letting
  // the browser's own (non-service-worker) HTTP cache quietly serve a still
  // fresh copy without ever touching the network — which would skip this
  // offline check entirely and defeat the point of testing connectivity.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('/offline.html')));
    return;
  }

  // The small, fixed app-shell file list only: network-first (so an online
  // user always gets the current file), falling back to the cached copy
  // when offline.
  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
