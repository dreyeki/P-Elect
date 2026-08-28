// 版本號每次發布都必須改，否則玩家會卡在舊版。
const VERSION = 'v0.3.0';
const CACHE = 'p-election-' + VERSION;
const CORE = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './css/reset.css', './css/theme.css', './css/layout.css', './css/components.css',
  './src/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 先問網路，拿到就順手更新快取；網路不通才回快取。
// 舊版是反過來的（快取優先），只要檔案進過快取就再也不會更新，
// 玩家因此永遠停在第一次開啟的版本。離線一樣可玩，但有網路時一定拿得到最新的。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
