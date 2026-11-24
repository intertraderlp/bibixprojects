// Bibix Projects Service Worker
const CACHE = 'bibix-v3';

self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
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
  const d = e.notification.data || {};
  // Chats pushes carry a full url (/chats/?account=…&chat=…); open it inside the app shell at /chats
  const url = d.url ? d.url.replace(/^\/chats\/\?/, '/chats?') : d.link ? ('/' + d.link).replace('//', '/') : '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const existing = cls.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});

// ── Fetch caching ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  // Only handle http/https requests
  if (!e.request.url.startsWith('http')) return;
  // Skip API calls
  if (e.request.url.includes('/api/')) return;
  // For page navigations, always fetch from network (never use cache for HTML)
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }
  // For assets, try cache first then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
