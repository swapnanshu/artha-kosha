const CACHE_VERSION = 'artha-kosha-cache-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Cache app shell + common static assets (cache-first)
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

function isStaticRequest(url) {
  // Treat same-origin assets as static.
  // NOTE: Keep this intentionally simple to avoid breaking navigation.
  return url.origin === self.location.origin;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  const cache = await caches.open(STATIC_CACHE);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

// Network-first for API calls (fallback to cache if network fails)
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

// Simple IndexedDB queue for background replay of failed manual POSTs.
// (No UI wiring yet — this is best-effort for offline behavior.)
const QUEUE_DB = 'artha-kosha-offline-queue';
const QUEUE_STORE = 'pending';

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function queueAction(action) {
  return openQueueDb().then(async (db) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const id = `q_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    store.put({ ...action, id, queuedAt: Date.now() });
    return tx.complete?.catch(() => undefined);
  });
}

function getQueuedActions() {
  return openQueueDb().then(async (db) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function deleteQueuedAction(id) {
  return openQueueDb().then(async (db) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    store.delete(id);
    return tx.complete?.catch(() => undefined);
  });
}

async function replayQueue() {
  const actions = await getQueuedActions();
  if (!actions || actions.length === 0) return;

  // Replay in order
  for (const a of actions) {
    try {
      if (a.type === 'POST' && a.url && a.body) {
        await fetch(a.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a.body),
        });
      }
      await deleteQueuedAction(a.id);
    } catch (e) {
      // If still failing (offline / server), keep it queued.
    }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      self.skipWaiting();
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(STATIC_ASSETS);
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (!k.startsWith(CACHE_VERSION)) return caches.delete(k);
        })
      );
    })()
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'artha-kosha-offline-sync') {
    event.waitUntil(replayQueue());
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Handle API calls with network-first
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith(
      (async () => {
        // Only queue manual transaction POSTs best-effort
        if (req.method === 'POST' && url.pathname === '/api/transactions/simulate') {
          try {
            return await networkFirst(req);
          } catch (err) {
            // Clone body for queue
            const bodyText = await req.clone().text();
            let body = null;
            try {
              body = JSON.parse(bodyText);
            } catch {
              body = bodyText;
            }

            await queueAction({ type: 'POST', url: url.toString(), body });
            // Attempt immediate replay; if offline, sync will cover later.
            try {
              await replayQueue();
            } catch {}
            try {
              await self.registration.sync.register('artha-kosha-offline-sync');
            } catch {}
            return new Response(JSON.stringify({ queued: true }), { status: 202 });
          }
        }

        return networkFirst(req);
      })()
    );
    return;
  }

  // Cache-first for static requests (including app shell assets)
  if (isStaticRequest(url) && (url.pathname === '/' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg'))) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // Fallback: default browser behavior
});
