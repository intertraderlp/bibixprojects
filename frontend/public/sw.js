// Bibix Projects Service Worker — push notifications only.
// NOTE: this worker intentionally does NOT cache or intercept any fetch.
// A cache-first fetch handler used to serve stale app-shell/assets after a
// deploy, producing blank pages. We now always hit the network for everything
// and wipe every cache on activate so returning clients self-heal.
const CACHE = 'bibix-v5';

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Bibix Projects', body: 'You have a new notification' };
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/bibix-logo.png',
      badge: '/bibix-logo.png',
      vibrate: [100, 50, 100],
      data: data.data || {},
      actions: [{ action: 'open', title: 'Open' }],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.link ? ('/' + e.notification.data.link).replace('//', '/') : '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const existing = cls.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});

// ── Fetch caching ─────────────────────────────────────────────────────────────
// No fetch handler: the browser handles every request from the network as if
// no service worker were installed. (Push + notificationclick above still work.)
