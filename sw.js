// Offline support: app shell is cached on install; sprites, item icons and
// map tiles are cached as you see them, so the Pokédex works offline.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime-v1';
const SHELL_FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'data/pokedex.json',
  'js/app.js', 'js/util.js', 'js/data.js', 'js/store.js', 'js/world.js', 'js/geo.js', 'js/ui.js',
  'js/views/pet.js', 'js/views/dex.js', 'js/views/map.js', 'js/views/box.js', 'js/views/bag.js',
  'js/views/starter.js', 'js/views/encounter.js', 'img/icon.svg', 'img/icon-192.png', 'img/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // own files: network first (so updates land), fall back to cache offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }

  // sprites / tiles / fonts / leaflet: cache first
  if (/raw\.githubusercontent\.com|tile\.openstreetmap\.org|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
