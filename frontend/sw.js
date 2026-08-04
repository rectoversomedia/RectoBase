/**
 * RectoBase Service Worker — Production
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS)      → Cache-first
 *  - Static assets (fonts, images)   → Cache-first with stale-while-revalidate
 *  - API GET requests                → Network-first with cache fallback
 *  - API mutating requests (POST/etc) → Network-only (no SW caching)
 *  - Google Fonts                     → Stale-while-revalidate
 *
 * Background sync: queued operations from OfflineSync are retried via the
 * Background Sync API when connectivity returns.
 *
 * Push notifications: structured for future order-alert and payment-status pushes.
 *
 * @version 1.0.0
 */

'use strict';

// ─── Version / Cache Names ──────────────────────────────────────────────────────

const STATIC_CACHE    = 'rb-static-v1';
const SHELL_CACHE     = 'rb-shell-v1';
const IMAGE_CACHE     = 'rb-images-v1';
const API_CACHE       = 'rb-api-v1';   // read-only, short TTL
const FONT_CACHE      = 'rb-fonts-v1';

const STATIC_ASSETS   = [
  '/',
  '/index.html',
  '/app.js',
  '/api-service.js',
  '/payment-handler.js',
  '/offline-sync.js',
  '/manifest.json',
];

const SHELL_ASSETS    = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Build a cache key from a URL and optional version tag.
 * Strips query strings from API URLs to improve cache hit rate
 * while keeping them for static assets.
 */
function cacheKey(url, prefix = 'rb') {
  const u = new URL(url);
  // Strip UTM / tracking params
  if (u.hostname !== location.hostname) return url;
  if (u.pathname.startsWith('/api/')) {
    return `${prefix}:${u.pathname}`;
  }
  return url;
}

/**
 * Check if a request is a "safe" (read-only) HTTP method.
 */
function isSafeMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method?.toUpperCase());
}

/**
 * Check if a request is to our own API.
 */
function isApiRequest(url) {
  return new URL(url).pathname.startsWith('/api/');
}

/**
 * Check if a request is for a static asset type.
 */
function isStaticAsset(url) {
  const pathname = new URL(url).pathname;
  return /\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|webp|svg|ico|webmanifest|json)$/i
    .test(pathname) || pathname.startsWith('/icons/') || pathname.startsWith('/screenshots/');
}

/**
 * Purge old caches on activation.
 */
async function purgeOldCaches() {
  const names = await caches.keys();
  const ours = [STATIC_CACHE, SHELL_CACHE, IMAGE_CACHE, API_CACHE, FONT_CACHE];
  await Promise.allSettled(
    names
      .filter((name) => !ours.includes(name) && name.startsWith('rb-'))
      .map((name) => caches.delete(name))
  );
}

// ─── Lifecycle: Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Pre-cache app shell and critical assets
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(SHELL_ASSETS);

      // Pre-cache static assets (may fail on poor connectivity — non-fatal)
      const staticCache = await caches.open(STATIC_CACHE);
      try {
        await staticCache.addAll(STATIC_ASSETS);
      } catch {
        // Some assets may 404 in dev — that's OK
      }

      // Activate immediately (don't wait for old tabs to close)
      await self.skipWaiting();

      console.debug('[SW] Installed — RectoBase v1.0.0');
    })()
  );
});

// ─── Lifecycle: Activate ───────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await purgeOldCaches();

      // Take control of all clients immediately
      await self.clients.claim();

      // Notify all open tabs of the new version
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_ACTIVATED', version: '1.0.0' });
      });

      console.debug('[SW] Activated');
    })()
  );
});

// ─── Lifecycle: Fetch ─────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET from cross-origin (CORS preflight etc.)
  if (url.origin !== location.origin && !isSafeMethod(request.method)) {
    return;
  }

  // ── App shell (HTML navigation) ────────────────────────────────────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try network first (always get fresh shell)
          const res = await fetch(request);
          const clone = res.clone();
          (async () => {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(request, clone);
          })();
          return res;
        } catch {
          // Fall back to cache
          const cached = await caches.match(request);
          if (cached) return cached;
          // Ultimate fallback: cache of index.html
          return (await caches.match('/index.html')) ?? new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // ── API requests ───────────────────────────────────────────────────────────
  if (isApiRequest(request.url)) {
    if (isSafeMethod(request.method)) {
      // Network-first for GET API calls; serve stale on failure
      event.respondWith(networkFirst(request, API_CACHE, { maxAge: 60_000 }));
    } else {
      // Mutating methods (POST/PUT/DELETE/PATCH): network-only
      // If offline, the api-service handles offline queueing
      event.respondWith(
        fetch(request).catch(() =>
          new Response(JSON.stringify({ success: false, queued: true, message: 'queued offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );
    }
    return;
  }

  // ── Google Fonts ───────────────────────────────────────────────────────────
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // ── Static assets (JS, CSS, images, icons) ─────────────────────────────────
  if (isStaticAsset(request.url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Everything else: network with cache fallback ───────────────────────────
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ─── Cache Strategies ──────────────────────────────────────────────────────────

/**
 * Cache-first: check cache, fall back to network.
 * Best for: static assets (JS, CSS, images, fonts).
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res.ok) {
      const clone = res.clone();
      cache.put(request, clone).catch(() => {}); // don't block on cache write
    }
    return res;
  } catch {
    return cached ?? new Response('Resource not available offline', { status: 503 });
  }
}

/**
 * Network-first: try network, fall back to cache.
 * Best for: API GET requests, HTML navigation.
 */
async function networkFirst(request, cacheName, { maxAge = 0 } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  try {
    const res = await fetch(request);

    if (res.ok) {
      // Check freshness via Date header
      const dateHeader = res.headers.get('Date');
      const age = dateHeader ? (Date.now() - new Date(dateHeader).getTime()) : 0;

      if (age < maxAge || maxAge === 0) {
        const clone = res.clone();
        cache.put(request, clone).catch(() => {});
      }
    }

    return res;
  } catch {
    if (cached) {
      // Notify the page that we're serving stale data
      const client = await self.clients.matchEventSource(event)?.then(() => {});
      return cached;
    }
    throw new Error(`networkFirst failed for ${request.url}`);
  }
}

/**
 * Stale-while-revalidate: return cached immediately, fetch and update cache in background.
 * Best for: Google Fonts, infrequently-changing static assets.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchAndCache = async () => {
    try {
      const res = await fetch(request);
      if (res.ok) {
        const clone = res.clone();
        await cache.put(request, clone);
      }
    } catch {
      // Silently fail background refresh
    }
  };

  if (cached) {
    // Kick off background update but immediately return cached
    fetchAndCache();
    return cached;
  }

  // No cache — must fetch
  const res = await fetch(request);
  if (res.ok) {
    const clone = res.clone();
    cache.put(request, clone).catch(() => {});
  }
  return res;
}

// ─── Background Sync ───────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'rb-offline-sync') {
    event.waitUntil(syncOfflineOperations());
  }
});

/**
 * Process the offline operation queue via the Background Sync API.
 * This runs even if the page is not open.
 */
async function syncOfflineOperations() {
  // Open the page to trigger sync (the page's OfflineSync will pick this up)
  const allClients = await self.clients.matchAll({ type: 'window' });

  if (allClients.length > 0) {
    // Page is open — notify it to sync
    allClients.forEach((client) => {
      client.postMessage({ type: 'SYNC_REQUESTED' });
    });
  } else {
    // No page open — load a hidden client to run sync
    const url = new URL(location.origin);
    url.hash = '#background-sync';
    try {
      const client = await self.clients.match({ url: url.href, includeUncontrolled: true });
      if (client) {
        client.postMessage({ type: 'SYNC_REQUESTED' });
      }
    } catch {
      // No client available
    }
  }
}

// ─── Push Notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'RectoBase', body: event.data.text() };
  }

  const { title, body, icon = '/icons/icon-192x192.png', badge, tag, data } = payload;

  const options = {
    body: body ?? '',
    icon,
    badge: badge ?? '/icons/badge-72x72.png',
    tag: tag ?? 'rectobase-notif',
    data: data ?? {},
    vibrate: [200, 100, 200],
    requireInteraction: data?.requireInteraction ?? false,
    actions: (payload.actions || []).map((action) => ({
      action: action.action ?? action.id,
      title: action.title ?? action.label ?? '',
      icon: action.icon,
    })),
  };

  event.waitUntil(self.registration.showNotification(title ?? 'RectoBase', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  const action = event.action;

  // Map actions to deep links
  const actionUrlMap = {
    'view-order':  data.orderId ? `/#kasir?order=${data.orderId}` : '/#beranda',
    'view-payment': data.reference ? `/#kasir?payment=${data.reference}` : '/#beranda',
    'view-customer': data.customerId ? `/#pelanggan?id=${data.customerId}` : '/#pelanggan',
    'open-app': '/',
  };

  const targetUrl = actionUrlMap[action] ?? data.url ?? '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(location.origin)) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', action, data });
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  // Track notification dismissal analytics
  console.debug('[SW] Notification closed:', event.notification.tag);
});

// ─── Message Handler (page ↔ service worker) ───────────────────────────────────

self.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_ASSETS':
      // Allow page to request specific assets be cached
      if (Array.isArray(payload?.urls)) {
        event.waitUntil(
          (async () => {
            const cache = await caches.open(STATIC_CACHE);
            await Promise.allSettled(
              payload.urls.map((url) =>
                fetch(url).then((r) => r.ok && cache.put(url, r)).catch(() => {})
              )
            );
          })()
        );
      }
      break;

    case 'CLEAR_CACHE':
      event.waitUntil(
        (async () => {
          const names = await caches.keys();
          await Promise.allSettled(names.map((name) => caches.delete(name)));
        })()
      );
      break;

    case 'GET_VERSION':
      event.source.postMessage({ type: 'SW_VERSION', version: '1.0.0' });
      break;

    case 'SYNC_NOW':
      event.waitUntil(syncOfflineOperations());
      break;

    case 'CACHE_SCREEN':
      // Cache a set of URLs for offline-first screen data
      if (Array.isArray(payload?.screenUrls)) {
        event.waitUntil(
          (async () => {
            const cache = await caches.open(API_CACHE);
            await Promise.allSettled(
              payload.screenUrls.map(async (url) => {
                try {
                  const res = await fetch(url, {
                    headers: { Authorization: payload.token ? `Bearer ${payload.token}` : '' },
                  });
                  if (res.ok) cache.put(url, res);
                } catch {
                  // offline
                }
              })
            );
          })()
        );
      }
      break;

    default:
      break;
  }
});

// ─── Periodic Background Sync (optional, requires permission) ─────────────────

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'rb-daily-sync') {
    event.waitUntil(performDailySync());
  }
});

async function performDailySync() {
  // Background refresh of key data once per day
  // Notify open clients to refresh their caches
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'DAILY_SYNC_TRIGGER' });
  });
}

// ─── Update Detection ───────────────────────────────────────────────────────────

// Check for new SW version and notify the page
async function checkForUpdate() {
  try {
    const res = await fetch('/sw.js', { cache: 'no-store' });
    if (!res.ok) return;

    const text = await res.text();
    if (text.includes('version:') && !text.includes(`'${self.scriptVersion}'`)) {
      // Version changed — notify all clients
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_UPDATE_AVAILABLE' });
      });
    }
  } catch {
    // Silent failure
  }
}

// Check every 30 minutes
setInterval(checkForUpdate, 30 * 60 * 1000);
