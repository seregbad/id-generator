/* Офлайн-кэш приложения. При изменении файлов увеличьте VERSION. */
const VERSION = 'idgen-v39';
const FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css', './js/core.js', './js/app.js', './js/pdf.js', './js/importer.js', './js/backup.js', './js/sync.js', './js/docx.js',
  './vendor/pdfmake.min.js', './vendor/vfs_tinos.js', './vendor/jszip.min.js',
  './vendor/xlsx.full.min.js', './vendor/pdfjs.min.js', './vendor/pdfjs.worker.min.js',
  './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js', './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  './vendor/tesseract/lang/rus.traineddata.gz', './vendor/tesseract/lang/eng.traineddata.gz',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// библиотеки — из кэша; файлы приложения — из сети (чтобы обновления приходили сразу), без сети — из кэша
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit && url.pathname.includes('/vendor/')) return hit;
    try {
      const r = await fetch(e.request);
      if (r && r.ok) cache.put(e.request, r.clone());
      return r;
    } catch (err) {
      return hit || (await cache.match('./index.html')) || new Response('Нет сети', { status: 503 });
    }
  }));
});
