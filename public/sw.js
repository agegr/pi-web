const CACHE_PREFIX = "pi-web";
// URLSearchParams is lenient (never throws on empty/malformed query), unlike new URL().
const CACHE_VERSION =
  new URLSearchParams(self.location.search).get("v") || "dev";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
// Resolve the mount prefix (e.g. "/pi-web/" behind a reverse proxy, or "/")
// from the service worker's own script path so precache/navigation checks work
// whether or not the app is deployed under a basePath.
// String ops only: "/pi-web/sw.js" -> "/pi-web/", "/sw.js" -> "/".
const BASE_PATH = self.location.pathname.replace(/[^/]*$/, "");
const OFFLINE_URL = `${BASE_PATH}offline.html`;
const PRECACHE_URLS = [
  OFFLINE_URL,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}icons/icon-192.png`,
  `${BASE_PATH}icons/icon-512.png`,
  `${BASE_PATH}icons/apple-touch-icon.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(`${CACHE_PREFIX}-`) && key !== STATIC_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Session data and live agent traffic must always come from the local server.
  if (
    url.pathname.startsWith(`${BASE_PATH}api/`) ||
    url.pathname === `${BASE_PATH}sw.js`
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match(OFFLINE_URL);
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith(`${BASE_PATH}_next/static/`) ||
    PRECACHE_URLS.includes(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Ignore malformed or missing push payloads.
  }
  const { title, body, url, tag } = payload;
  if (typeof title !== "string" || !title || typeof body !== "string" || !body)
    return;

  // The in-page notification path handles the visible case (and plays the
  // completion sound). Only surface a system notification when no window for
  // this app is visible — e.g. a backgrounded iOS PWA.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        if (clients.some((client) => client.visibilityState === "visible"))
          return;
        return self.registration.showNotification(title, {
          body,
          data: { url: typeof url === "string" && url ? url : BASE_PATH },
          ...(typeof tag === "string" && tag ? { tag, renotify: true } : {}),
        });
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl =
    typeof event.notification.data?.url === "string"
      ? event.notification.data.url
      : BASE_PATH;
  let targetUrl;
  try {
    targetUrl = new URL(BASE_PATH, self.location.origin);
  } catch {
    return;
  }
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Keep the root URL when notification data is malformed.
  }

  event.waitUntil(focusOrOpenWindow(targetUrl.href));
});

async function focusOrOpenWindow(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const exactClient = windowClients.find((client) => client.url === targetUrl);
  const candidates = exactClient
    ? [exactClient, ...windowClients.filter((client) => client !== exactClient)]
    : windowClients;

  for (const client of candidates) {
    try {
      const targetClient =
        client.url === targetUrl
          ? client
          : ((await client.navigate(targetUrl)) ?? client);
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}
