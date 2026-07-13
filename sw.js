// Service Worker de PadelRank
// Estrategia: network-first para el HTML (siempre la versión más reciente si hay conexión),
// cache-first para iconos/manifest (no cambian casi nunca).
// Los scripts de terceros (React, Supabase, Chart.js) NO se cachean aquí: el navegador
// ya los cachea por su cuenta vía HTTP cache, y cachearlos nosotros con "no-cors" podría
// dejarte pegado a una versión antigua sin darte cuenta.

const CACHE_NAME = "padelrank-cache-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo gestionamos peticiones GET de nuestro propio origen (mismo dominio).
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Navegación (cargar la app): red primero, caché como respaldo si no hay conexión.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  // Resto de recursos propios (iconos, manifest): caché primero, red como respaldo.
  event.respondWith(
    caches.match(request).then((cached) => {
      return (
        cached ||
        fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
      );
    })
  );
});

// --- NOTIFICACIONES PUSH ---

// Se dispara cuando llega una notificación push desde el servidor (Supabase Edge Function).
self.addEventListener("push", (event) => {
  let payload = { title: "PadelRank", body: "Tienes una notificación nueva.", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // Si el payload no es JSON válido, se usa el texto tal cual como cuerpo del mensaje.
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-96.png",
    data: { url: payload.url || "/" },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Se dispara cuando el usuario toca la notificación: abre (o enfoca) la app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
