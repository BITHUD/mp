const CACHE_NAME = 'music-player-cache-v4'; // Incremented version for update
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
];

// Install event: Pre-cache the application shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(APP_SHELL_URLS);
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache on install', error);
      })
  );
});

// Activate event: Clean up old caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event: Intercept network requests.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Use a "stale-while-revalidate" strategy for YouTube API requests.
  // This serves a cached response immediately (if available) for a fast offline experience,
  // then fetches an updated version from the network to update the cache for next time.
  if (url.hostname === 'www.googleapis.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            // If the fetch is successful, clone it and put it in the cache.
            if (networkResponse.ok) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          });

          // Return the cached response immediately if it exists, otherwise wait for the network.
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }
  
  // NOTE on caching audio/video streams:
  // Caching media from services like YouTube directly via a service worker can violate
  // their Terms of Service and is technically complex. It often requires a server-side
  // component to fetch and relay the media stream.
  // For direct audio streams (.mp3, .aac), you could implement a dynamic caching
  // strategy here, but it's complex due to potential large file sizes and byte-range requests.
  // The current implementation focuses on caching app shell and API data for a robust offline UI.

  // For all other requests, use a cache-first strategy.
  event.respondWith(
    caches.match(request)
      .then((response) => {
        return response || fetch(request).then((networkResponse) => {
          // Optionally, cache other static assets dynamically if needed.
          // Be careful not to cache very large files or opaque responses.
          if (networkResponse.ok && request.method === 'GET' && !APP_SHELL_URLS.includes(url.pathname)) {
            // Example: Caching fonts or other static assets
            // const responseToCache = networkResponse.clone();
            // caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
          }
          return networkResponse;
        });
      })
      .catch(() => {
        // If both cache and network fail, you could return a fallback offline page.
        console.warn('Service Worker: Fetch failed, request not in cache and network unavailable:', request.url);
        // e.g., return caches.match('/offline.html');
      })
  );
});


// --- Advanced PWA Features (Stubs) ---

// Background Sync: For retrying failed requests (e.g., adding to a playlist) when connection is restored.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-playlist') {
    console.log('Service Worker: Background sync for "sync-playlist" triggered.');
    // Here you would typically read queued data from IndexedDB and send it to your server.
    // event.waitUntil(syncPlaylistData()); 
  }
});

// Periodic Background Sync: For fetching new content periodically.
// Note: This requires user permission and is used sparingly by browsers.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'get-latest-content') {
    console.log('Service Worker: Periodic sync for "get-latest-content" triggered.');
    // Here you could fetch updates for a followed playlist or new releases.
    // event.waitUntil(fetchLatestContent());
  }
});
