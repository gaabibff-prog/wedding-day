/* Offline support: keeps the app files on the phone so it opens with no signal.
   With signal, it checks for a newer version first (up to 3 seconds), so updates show up right away. */
const CACHE = 'gabi-day-v19';
const FILES = ['./', './index.html', './app.js', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
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
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((c) => {
      const fromCache = () => c.match(req, { ignoreSearch: true }).then((hit) => hit || c.match('./index.html'));
      const net = fetch(req, { cache: 'no-cache' }).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; });
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      return Promise.race([net.catch(() => null), timeout]).then((res) => res || fromCache());
    })
  );
});
