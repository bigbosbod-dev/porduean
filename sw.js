// Service worker ของ "พอเดือน": ทำให้เปิดแอปได้แม้ไม่มีอินเทอร์เน็ต
// ดูแลเฉพาะหน้าของแอปนี้ (scope ./) ส่วนแคชก็ลบเฉพาะของตัวเอง เพราะอยู่โดเมนเดียวกับ StudyFlow
// เมื่อแก้ไฟล์ของแอป ให้เปลี่ยนเลขเวอร์ชันนี้ เพื่อให้แคชเก่าถูกล้าง
const CACHE = 'porduean-v8';

const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/fx.js',
  'js/extras.js',
  'js/slip.js',
  'js/report.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/3.4.16',
  'https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.all(CDN_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { mode: 'no-cors' });
        await cache.put(url, res);
      } catch (e) { /* ออฟไลน์ตอนติดตั้ง: จะลองแคชใหม่ตอนใช้งาน */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // ลบเฉพาะแคชเก่าของแอปนี้ แคชของ StudyFlow ต้องอยู่ครบ
    await Promise.all(keys.filter((k) => k.startsWith('porduean-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') return cache.match('index.html');
        throw e;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
    return res;
  })());
});
