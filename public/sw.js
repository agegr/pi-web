const SW_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_REVISION = "20260725-wordmark-r2";
const CACHE_NAME = `pi-web-shell-${SW_VERSION}-${SHELL_REVISION}`;
const APP_SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/pwa-192.png", "/icons/pwa-512.png", "/icons/pwa-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // 页面导航优先访问网络，离线时回退到已缓存的应用外壳。
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  // 仅缓存构建产物和 PWA 静态资源，避免会话及文件数据进入缓存。
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/icons/")) return;
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      const cacheControl = response.headers.get("cache-control") || "";
      const isVersionedAsset = url.pathname.startsWith("/icons/") || cacheControl.includes("immutable");
      if (response.ok && isVersionedAsset) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
