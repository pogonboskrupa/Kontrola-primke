const VERSION = 'kp-v8';
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/jspdf.umd.min.js',
];

// Opcioni resursi: ako ne prođu, instalacija ne smije pasti
// (inače aplikacija uopšte ne bi radila offline).
const OPTIONAL_ASSETS = [
  './icons/screenshot-narrow.png',
  './icons/screenshot-wide.png',
];

const NAV_TIMEOUT_MS = 3000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const core = await caches.open(CORE_CACHE);
    await core.addAll(CORE_ASSETS);
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.allSettled(OPTIONAL_ASSETS.map(async url => {
      const res = await fetch(url);
      if (res.ok) await runtime.put(url, res);
    }));
    // Prvu instalaciju aktiviraj odmah; ažuriranja čekaju potvrdu korisnika (SKIP_WAITING).
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([CORE_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

// HTML: network-first (svježa verzija kad ima signala), uz timeout jer je na terenu
// signal često "tu, ali ne radi" – tada brzo padamo na keš.
async function handleNavigation(event) {
  const cache = await caches.open(CORE_CACHE);
  try {
    const network = (async () => (await event.preloadResponse) || fetch(event.request))();
    const res = await Promise.race([network, timeout(NAV_TIMEOUT_MS)]);
    if (res && res.ok) {
      cache.put('./index.html', res.clone());
      return res;
    }
    throw new Error('bad response');
  } catch (err) {
    return (await cache.match('./index.html')) || (await cache.match('./')) ||
      new Response('<h1>Offline</h1><p>Aplikacija još nije sačuvana na uređaju.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Ostalo: stale-while-revalidate – odmah iz keša, osvježi u pozadini.
async function handleAsset(event) {
  const cached = await caches.match(event.request);
  const network = fetch(event.request).then(async res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(event.request, res.clone());
    }
    return res;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  event.respondWith(handleAsset(event));
});
