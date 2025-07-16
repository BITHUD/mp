const CACHE_NAME = 'music-player-cache-v3'; // Increment version to trigger update!
const urlsToCache = [
  '/', // Caches the root path, typically your index.html
  '/index.html',
  '/manifest.json', // Add your manifest file
  // Add all your icon paths as specified in manifest.json
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  // You might want to cache some fallback UI images or other small static assets here
];

// IndexedDB Constants for Service Worker
const IDB_DATABASE_NAME = 'music-db';
const IDB_STORE_NAME = 'tracks';

// Helper function to open IndexedDB (can be reused in main script)
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME, 1); // Version 1

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' }); // Use track ID as key
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      console.error('Service Worker: IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  });
}

// Install event: This is where you pre-cache essential assets when the service worker is first installed.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache on install', error);
      })
  );
});

// Fetch event: This intercepts network requests made by the page.
// It tries to serve content from the cache first, then falls back to the network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if it's a request for a locally stored music file (using our custom protocol)
  if (url.protocol === 'indexeddb:') {
    const trackId = url.hostname; // The track ID will be the hostname in indexeddb://<trackId>

    event.respondWith(
      new Promise(async (resolve, reject) => {
        try {
          const db = await openIndexedDB();
          const transaction = db.transaction([IDB_STORE_NAME], 'readonly');
          const store = transaction.objectStore(IDB_STORE_NAME);
          const request = store.get(trackId);

          request.onsuccess = () => {
            const trackData = request.result;
            if (trackData && trackData.audioBlob) {
              console.log(`Service Worker: Serving track ${trackId} from IndexedDB cache.`);
              resolve(new Response(trackData.audioBlob, {
                headers: { 'Content-Type': trackData.mimeType || 'audio/mpeg' } // Use stored MIME type or default
              }));
            } else {
              console.warn(`Service Worker: Track ${trackId} not found in IndexedDB. Fetching from network (fallback).`);
              // If not found in IndexedDB, fall back to network for the original URL (if available)
              // This part assumes the original URL can be reconstructed or is stored elsewhere.
              // For simplicity, we'll just return a 404 if not found via custom protocol.
              resolve(new Response('Track not found in IndexedDB', { status: 404 }));
            }
          };

          request.onerror = (e) => {
            console.error('Service Worker: IndexedDB get error:', e.target.error);
            reject(e.target.error);
          };
        } catch (error) {
          console.error('Service Worker: Error opening IndexedDB for fetch:', error);
          reject(error);
        }
      })
    );
    return; // Important: Stop default fetch handling if it's an IndexedDB request
  }

  // --- Existing cache-first, then network strategy for other assets ---
  event.respondWith(
    caches.match(event.request) // Try to find the request in the current cache.
      .then((response) => {
        // If the resource is in the cache, return it.
        if (response) {
          return response;
        }

        // If not in cache, fetch from the network.
        return fetch(event.request)
          .then((networkResponse) => {
            // Check if we received a valid response.
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream and can only be consumed once.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                // Only cache GET requests, and typically exclude very large media files directly here.
                // Large media files should be handled by IndexedDB as implemented in index.html.
                const requestUrl = event.request.url;
                if (event.request.method === 'GET' &&
                    !requestUrl.includes('.mp3') &&
                    !requestUrl.includes('.wav') &&
                    !requestUrl.includes('.ogg') &&
                    !requestUrl.includes('.aac')) {
                    cache.put(event.request, responseToCache);
                }
              });

            return networkResponse; // Return the network response to the browser.
          })
          .catch(() => {
            // This catch block handles network errors.
            console.log('Service Worker: Fetch failed, request not in cache and network unavailable:', event.request.url);
            // You could return a specific offline fallback page here if desired.
          });
      })
  );
});

// Activate event: This is triggered when the service worker becomes active.
// It's commonly used to clean up old caches, ensuring users don't get stale content.
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME]; // Only keep caches with names in this whitelist.

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // If a cache name is not in the whitelist, delete it.
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});