const CACHE_NAME = 'music-player-cache-v6'; // Increment version for updates!
const APP_SHELL_URLS = [
  '/', // Cache the root URL (index.html)
  '/index.html',
  '/styles.css', // Your external CSS file
  '/script.js',  // Your external JavaScript file
  '/manifest.json',
  // Ensure all icons from manifest.json are listed here
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  // Google Fonts (verify these URLs by inspecting network requests in your browser)
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp5fmWn_rF4.woff2', // Example font file, check actual URL
  // Add any other critical static assets here (e.g., other images, small audio snippets)
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
        // Log which asset failed to cache for debugging
        // console.error('Failed asset:', error.message);
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
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Ensure the service worker takes control of clients immediately
});

// Fetch event: Intercept network requests.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests and ignore chrome-extension:// for security/avoiding errors
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
    return;
  }

  // Use a "stale-while-revalidate" strategy for www.googleapis.com requests.
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
        // If asset is in cache, serve it
        if (response) {
          return response;
        }

        // If not in cache, go to network
        return fetch(request).then((networkResponse) => {
          // Check if we received a valid response
          // 'basic' type indicates same-origin requests, which are safe to cache.
          // 'opaque' responses (e.g., from CORS requests without CORS headers) cannot be cached directly.
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Important: Clone the response. A response is a stream and
          // can only be consumed once. We're consuming it once to cache it
          // and once to return it to the browser.
          const responseToCache = networkResponse.clone();

          // Open the cache and put the new response into it, but only for GET requests and if not already in APP_SHELL_URLS
          if (request.method === 'GET' && !APP_SHELL_URLS.includes(url.pathname)) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }

          return networkResponse;
        })
        .catch(() => {
          // This catch block handles network failures.
          // For HTML navigation requests, you might want to serve an offline page.
          if (request.mode === 'navigate') {
            // You can serve an offline HTML page here if desired.
            // return caches.match('/offline.html');
          }
          // Fallback for other requests (e.g., images) if network fails and not in cache
          console.warn('Service Worker: Fetch failed, request not in cache and network unavailable:', request.url);
          // Return a generic network error response or a fallback asset
          return new Response('Network error and no cache found for this resource.', { status: 503, statusText: 'Service Unavailable' });
        });
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