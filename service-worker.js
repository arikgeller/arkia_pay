const CACHE_VERSION = 'arkia-shell-v346';

function getScopeUrl() {
  return self.registration.scope;
}

function getIndexUrl() {
  return new URL('./index.html', getScopeUrl()).href;
}

function getManifestUrl() {
  return new URL('./manifest.webmanifest', getScopeUrl()).href;
}

function getCoreUrls() {
  return [
    getScopeUrl(),
    getIndexUrl(),
    getManifestUrl(),
    new URL('./pdf.min.js', getScopeUrl()).href,
    new URL('./pdf.worker.min.js', getScopeUrl()).href
  ];
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(getCoreUrls());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => (key === CACHE_VERSION ? Promise.resolve() : caches.delete(key))));
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (request.method === 'GET' && response && response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

async function cacheShellAliases(urls = []) {
  const cache = await caches.open(CACHE_VERSION);
  const shell = (await cache.match(getIndexUrl(), { ignoreSearch: true }))
    || (await cache.match(getScopeUrl(), { ignoreSearch: true }));
  if (!shell) return;
  await Promise.all(urls.filter(Boolean).map(async rawUrl => {
    try {
      const normalizedUrl = new URL(rawUrl, getScopeUrl()).href;
      await cache.put(normalizedUrl, shell.clone());
    } catch (err) {
      return;
    }
  }));
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(getIndexUrl(), response.clone()).catch(() => {});
      cache.put(getScopeUrl(), response.clone()).catch(() => {});
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    return (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match(getIndexUrl(), { ignoreSearch: true }))
      || (await caches.match(getScopeUrl(), { ignoreSearch: true }));
  }
}

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'CACHE_CURRENT_URL') return;
  event.waitUntil(cacheShellAliases([data.url, data.indexUrl]));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (!isSameOrigin) return;

  event.respondWith(cacheFirst(request));
});
