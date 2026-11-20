// Service worker: cache app shell saja.
// Video TIDAK di-cache — ukurannya besar dan harus selalu bisa di-stream.
const SHELL = 'studio-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './ikon/ikon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Video/thumb: biarkan jaringan yang menangani (butuh byte-range).
  if (url.pathname.includes('/video/') || url.pathname.includes('/thumb/')) return;

  // Jaringan dulu supaya deploy baru langsung terlihat; cache hanya cadangan offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
