const CACHE = 'salt-shell-v5';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/build/main.js', '/build/main.css'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'DELETE_AVATAR_CACHE' || typeof event.data.url !== 'string') return;
  const url = new URL(event.data.url, self.location.origin);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/avatar/')) return;
  event.waitUntil(caches.open(CACHE).then(cache => cache.delete(url.href)));
});
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached && requestUrl.pathname.startsWith('/avatar/')) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && event.request.destination !== 'document') {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('/');
      throw new Error('This resource is not available offline.');
    }
  })());
});
