// Offline support: cache the whole game on first visit, then serve it from the device.
// Strategy: stale-while-revalidate — instant (and offline) loads from the cache, with a background
// refresh whenever the network is available, so updates arrive on the next launch.
const VERSION = 'fore-v12';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/util.js',
  'js/biomes.js',
  'js/course.js',
  'js/physics.js',
  'js/render.js',
  'js/audio.js',
  'js/music.js',
  'js/game.js',
  'manifest.webmanifest',
  'icon.svg',
  'logo.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // Ignore the query string (e.g. ?seed=...) when matching the page itself.
      const cached = await cache.match(req, { ignoreSearch: true });
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(new Request(req.url.split('?')[0]), res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const res = await refresh;
      return res || (await cache.match('index.html')) || Response.error();
    }),
  );
});
