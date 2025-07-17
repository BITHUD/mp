const CACHE_NAME = 'music-player-cache-v7'; // Increment version for updates!
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
  // Example font file, check actual URL, combine both provided examples
  'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp5fmWn_rF4.woff2',
  'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp5fmWzMxV-v3A.woff2',
  // Add any other critical static assets here (e.g., other images, small audio snippets)
];

// Install event: Pre-cache the application shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell'); // Merged log
        return cache.addAll(APP_SHELL_URLS);
      })
      .catch((error) => {
        console.error('[Service Worker] Failed to cache on install:', error); // Merged log
      })
  );
});

// Activate event: Clean up old caches.
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate'); // Merged log
  event.waitUntil(
    caches.keys().then((cacheNames) => { // KeyList from second code
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache', cacheName); // Merged log
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
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') { // Combined conditions
    return;
  }

  // Strategy 1: Cache-first for app shell (already cached during install)
  // These are the files in APP_SHELL_URLS. We'll primarily rely on the cache for these, falling back to network.
  if (APP_SHELL_URLS.includes(url.pathname) || APP_SHELL_URLS.includes(request.url)) { // Combined check
    event.respondWith(
      caches.match(request)
        .then((response) => {
          if (response) {
            console.log('[Service Worker] Serving from cache (app shell):', request.url); // New log
            return response;
          }
          console.log('[Service Worker] Fetching from network (app shell fallback):', request.url); // Merged log
          return fetch(request);
        })
        .catch((error) => {
          console.error('[Service Worker] Fetch failed for app shell:', request.url, error); // Merged log
        })
    );
    return;
  }

  // Strategy 2: Stale-While-Revalidate for www.googleapis.com requests (for dynamic content like fonts)
  if (url.hostname === 'www.googleapis.com') { // From first code
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse.ok) { // Check for successful response
              cache.put(request, networkResponse.clone());
              console.log('[Service Worker] Updated cache with fresh network response (Google API):', request.url); // New log
            }
            return networkResponse;
          });
          console.log('[Service Worker] Serving stale-while-revalidate for Google API:', request.url); // New log
          return cachedResponse || fetchPromise; // Serve cached immediately, revalidate in background
        });
      })
    );
    return;
  }

  // Strategy 3: Cache-then-network for dynamically added Blob URLs (e.g., local audio files)
  // This is for local audio files that the user adds. The service worker will intercept the blob URLs.
  if (url.protocol === 'blob:') { // From second code
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[Service Worker] Serving Blob from cache:', request.url); // Merged log
            return cachedResponse;
          }
          // If not in cache, fetch and add to cache
          return fetch(request).then(response => {
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
              console.log('[Service Worker] Caching Blob from network:', request.url); // Merged log
            });
            return response;
          });
        })
        .catch((error) => {
          console.error('[Service Worker] Fetch failed for Blob:', request.url, error); // Merged log
        })
    );
    return;
  }

  // Strategy 4: Network-first with cache fallback for external streams/dynamic content (e.g., YouTube)
  // This handles external HTTP/HTTPS requests, prioritizing network but providing cache fallback for stability.
  if (url.protocol.startsWith('http')) { // Broadly covers HTTP/HTTPS
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // If we get a valid response, cache it (if appropriate)
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
              console.log('[Service Worker] Caching network response (network-first):', request.url); // Merged log
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails, try to serve from cache
          console.log('[Service Worker] Network failed, trying cache (network-first fallback) for:', request.url); // Merged log
          return caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback for requests that are neither cached nor fetched
            // For HTML navigation requests, you might want to serve an offline page.
            if (request.mode === 'navigate') { // From first code
              // return caches.match('/offline.html'); // Example for an offline page
            }
            console.warn('Service Worker: Network and cache unavailable for:', request.url); // From first code
            return new Response('Network error and no cache found for this resource.', { status: 503, statusText: 'Service Unavailable' }); // From first code
          });
        })
    );
    return;
  }

  // Default: Go to network for anything else not explicitly handled
  event.respondWith(fetch(request)); // From second code
});


// --- Advanced PWA Features (Stubs) ---

// Background Sync: For retrying failed requests (e.g., adding to a playlist) when connection is restored.
self.addEventListener('sync', (event) => { // From first code
  if (event.tag === 'sync-playlist') {
    console.log('Service Worker: Background sync for "sync-playlist" triggered.');
    // Here you would typically read queued data from IndexedDB and send it to your server.
    // event.waitUntil(syncPlaylistData());
  }
});

// Periodic Background Sync: For fetching new content periodically.
// Note: This requires user permission and is used sparingly by browsers.
self.addEventListener('periodicsync', (event) => { // From first code
  if (event.tag === 'get-latest-content') {
    console.log('Service Worker: Periodic sync for "get-latest-content" triggered.');
    // Here you could fetch updates for a followed playlist or new releases.
    // event.waitUntil(fetchLatestContent());
  }
});