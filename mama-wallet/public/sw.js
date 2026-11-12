// Cache only the public shell. API responses and session data never enter CacheStorage.
const CACHE = 'mama-shell-v6';
const ASSETS = ['/illustrations/family-connect.webp','/illustrations/family-help.webp','/illustrations/wallet-care.webp','/illustrations/family-ready.webp','/brand/mama-wallet-logo.webp','/favicon.ico','/favicon-32.png','/apple-touch-icon.png','/', '/app.js', '/views.js', '/router.js', '/components.js', '/api.js', '/style.css', '/fonts/manrope-variable.woff2', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mama-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/'))); return; }
  if (ASSETS.includes(url.pathname)) event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
});
