const CACHE = 'bibix-pwa-v7';
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const path = new URL(e.request.url).pathname;
  // Never cache the HTML page or API calls — always fetch fresh
  if (path.startsWith('/api/') || path === '/app/' || path === '/app/index.html') return;
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r.ok && e.request.method === 'GET') {
        const clone = r.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
      }
      return r;
    }))
  );
});

// Handle incoming push notifications
self.addEventListener('push', e => {
  let title = 'Bibix';
  let body = 'You have a new notification';
  let data = {};
  try {
    const payload = e.data ? e.data.json() : {};
    title = payload.title || title;
    body  = payload.body  || body;
    data  = payload.data  || {};
  } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/app/icon.svg',
      badge: '/app/icon.svg',
      data,
      vibrate: [200, 100, 200],
    })
  );
});

// Tap on notification opens the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/app') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/app/');
    })
  );
});
