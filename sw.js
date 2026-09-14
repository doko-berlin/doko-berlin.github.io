// sw.js – Service Worker für die Doko-Saisonverwaltung (PWA-Hülle)
//
// WICHTIG für diese App: Der eigentliche Inhalt (Punktestände, Live-Entwürfe, Saisondaten)
// kommt in Echtzeit aus Firebase, nicht aus diesem Cache. Dieser Service Worker cached
// AUSSCHLIESSLICH die statische "Hülle" (index.html, tailwind.css, manifest.json, Icons),
// damit die App installierbar ist und offline zumindest lädt – niemals die Firebase-Daten
// selbst. Firebase-/CDN-Anfragen werden hier bewusst gar nicht erst angefasst.

// Bei jedem Deploy mit neuem Funktionsstand HOCHZÄHLEN (z.B. 'doko-shell-v3').
// Das ist der einzige Weg, wie Nutzer mit bereits installierter PWA einen alten,
// gecachten Stand von index.html verlässlich abgelöst bekommen.
const CACHE_VERSION = 'doko-shell-v2.3.0.3';

// Nur Dateien, die tatsächlich zur statischen Hülle gehören – siehe <head> von index.html
// sowie die Icon-Liste in manifest.json.
const APP_SHELL_FILES = [
    './',
    './index.html',
    './tailwind.css',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
    // Sofort aktivieren, statt auf das Schließen aller offenen Tabs zu warten – bei einer App,
    // die gerade mehrere Bugfixes/Sicherheitsfixes bekommen hat, soll ein neuer Service-Worker-
    // Stand so schnell wie möglich greifen.
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_VERSION).then((cache) => {
            // Einzeln statt cache.addAll(): Wenn EINE Datei fehlt/404 liefert (z.B. weil
            // manifest.json noch ein Icon referenziert, das nicht existiert), soll das nicht
            // die komplette Installation des Service Workers zum Scheitern bringen.
            return Promise.all(
                APP_SHELL_FILES.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[sw.js] Konnte nicht vorab cachen:', url, err);
                    })
                )
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Alte Cache-Versionen (von früheren CACHE_VERSION-Werten) aufräumen.
            caches.keys().then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE_VERSION)
                        .map((key) => caches.delete(key))
                )
            ),
            // Sofort für bereits offene Tabs zuständig werden, nicht erst beim nächsten Laden.
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Nur eigene, einfache GET-Anfragen behandeln. Alles andere unangetastet durchlassen:
    // - Cross-Origin (Firebase Realtime Database/Auth, gstatic.com SDKs, jsdelivr-CDN für
    //   Chart.js/SortableJS) NIEMALS abfangen. Insbesondere die Firebase-Synchronisation läuft
    //   größtenteils über WebSockets (die 'fetch' ohnehin nicht betreffen) und REST-Fallbacks,
    //   die immer frisch vom Server kommen müssen – ein gecachter alter Punktestand wäre fatal.
    // - POST/PUT/... (z.B. Firebase-Schreibvorgänge) werden von Service Workern ohnehin nicht
    //   sinnvoll gecacht und hier komplett ignoriert.
    if (req.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // Network-first mit Cache-Fallback: Ist der Nutzer online, kommt IMMER die aktuelle Version
    // von index.html/tailwind.css vom Server (wichtig, damit Bugfixes sofort ankommen und nicht
    // durch einen veralteten Cache verdeckt werden). Der Cache dient nur als Absicherung, wenn
    // gar keine Verbindung besteht (z.B. Autofahrt zum Doppelkopf-Abend ohne Empfang).
    event.respondWith(
        fetch(req)
            .then((networkResponse) => {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(req, responseClone));
                return networkResponse;
            })
            .catch(() =>
                caches.match(req).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    // Kein Netz und nichts im Cache: bei einer Navigation wenigstens die
                    // zuletzt gecachte index.html als Notlösung ausliefern.
                    if (req.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                    return Response.error();
                })
            )
    );
});
