// Bibix Chats service worker — push notifications + badge. Caches nothing on
// purpose (the shell must never go stale after a deploy); the app works
// online-only because it is a live chat client.
const VERSION = 'chats-v1';
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('chats-')) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('push', e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (_) {}
  const data = payload.data || {};
  const title = payload.title || 'Bibix Chats';
  e.waitUntil((async () => {
    // If a Chats window is open and focused, let the page show it inline instead.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.find(w => w.url.includes('/chats') && w.focused);
    if (focused) { focused.postMessage({ type: 'push', payload }); return; }
    await self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/chats/icon-192.png', badge: '/chats/icon-192.png',
      tag: data.url || 'chats', renotify: true, data,
      vibrate: [120, 60, 120],
    });
    if (self.navigator && 'setAppBadge' in self.navigator) { try { await self.navigator.setAppBadge(); } catch (_) {} }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/chats/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes('/chats') && 'focus' in w) { w.postMessage({ type: 'open', url }); return w.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener('message', e => { if (e.data === VERSION) e.source?.postMessage?.({ type: 'version', version: VERSION }); });
