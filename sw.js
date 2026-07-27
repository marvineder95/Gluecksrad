// Service Worker für PWA-Support (Add to Homescreen)
const CACHE_NAME = 'gluecksrad-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
    '/frontend/css/style.css',
    '/frontend/css/landing-new.css',
    '/frontend/js/config.js',
    '/frontend/js/utils/api.js',
    '/frontend/js/utils/auth.js',
    '/frontend/js/utils/confetti.js',
    '/frontend/js/utils/sounds.js',
    '/frontend/js/utils/spinAnimation.js',
    '/frontend/js/components/WheelComponent.js',
    '/frontend/js/components/SegmentImageEditor.js',
    '/frontend/js/pages/EventPage.js',
    '/frontend/js/pages/LandingPage.js',
    '/frontend/js/pages/DashboardPage.js',
    '/frontend/js/pages/SettingsPage.js',
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
    const url = new URL(event.request.url);

    // API-Requests nicht cachen
    if (url.pathname.includes('/backend/api/')) {
        return;
    }

    // Netzwerk-first für HTML/JS/CSS: immer aktuelle Version, Cache nur als Fallback
    if (event.request.mode === 'navigate' || url.pathname.match(/\.(html|js|css)$/)) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Für andere Assets (Bilder, Fonts): Cache-first, dann Netzwerk
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
