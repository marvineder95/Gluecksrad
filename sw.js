// Service Worker für PWA-Support
const CACHE_NAME = 'gluecksrad-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/frontend/css/style.css',
    '/frontend/js/config.js',
    '/frontend/js/utils/api.js',
    '/frontend/js/utils/auth.js',
    '/frontend/js/utils/confetti.js',
    '/frontend/js/utils/spinAnimation.js',
    '/frontend/js/components/WheelComponent.js',
    '/frontend/js/pages/EventPage.js',
    '/frontend/js/pages/LoginPage.js',
    '/frontend/js/pages/AdminPage.js',
    '/frontend/js/app.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // API-Requests nicht cachen
    if (event.request.url.includes('/backend/api/')) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
