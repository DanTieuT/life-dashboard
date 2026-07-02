// Service Worker — Command Center PWA
// Caches the app shell for offline use
// NOTE: bump CACHE_NAME on every deploy so clients pick up the new shell.

const CACHE_NAME = 'cc-shell-v4';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  '/js/main.js',
  '/js/core.js',
  '/js/habits.js',
  '/js/tasks.js',
  '/js/projects.js',
  '/js/finance.js',
  '/js/calendar.js',
  '/js/dashboard.js',
  '/js/shipping.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only intercept same-origin GET requests for the app shell
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Netlify functions — always go to network, fall through on failure
  if (url.pathname.startsWith('/.netlify/')) return;

  // Firebase — skip, these need to be live
  if (url.hostname.includes('firestore') || url.hostname.includes('firebase') || url.hostname.includes('googleapis')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache shell pages on successful fetch
        if (response.ok && (url.pathname === '/' || SHELL_URLS.includes(url.pathname))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // For navigation requests, return the cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});

// ── Push notifications ─────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Command Center';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
