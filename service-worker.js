// Nome da versão do cache
const CACHE_NAME = "dogesteps-v3";

// Ficheiros a serem colocados em cache para funcionamento offline
const ASSETS = [
  "./",
  "./index.html",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// INSTALAÇÃO — faz pre-cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// ATIVAÇÃO — limpa caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// FETCH — responde com cache primeiro, fallback online
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cacheResponse => {
      // Se existir no cache → devolve
      if (cacheResponse) return cacheResponse;

      // Caso contrário tenta buscar online e guarda no cache dinamicamente
      return fetch(event.request)
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            // Só coloca no cache pedidos GET (POST não podem ser cacheados)
            if (event.request.method === "GET") {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        })
        .catch(() => {
          // Se offline e pedido não existir → devolve fallback se tiveres
          return caches.match("./index.html");
        });
    })
  );
});
