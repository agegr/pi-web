const CACHE_PREFIX = "pi-web";
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const SHELL_CACHE = `${CACHE_PREFIX}-shell-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([STATIC_CACHE, SHELL_CACHE]);
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
// A stalled network (reachable port, dead upstream) never rejects, so a plain
// fetch().catch() would hang the navigation forever. Bound every network wait.
const NAVIGATION_TIMEOUT_MS = 8000;
const ASSET_TIMEOUT_MS = 8000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await primeShellCache();
      await self.skipWaiting();
    })(),
  );
});

/**
 * Cache the app shell during install.
 *
 * The navigation that triggers the very first visit cannot be captured: the
 * worker is not controlling the page yet, so the fetch handler never sees that
 * response. Without priming the shell here, a user who installs the app and
 * then goes offline would still fall back to offline.html on the next launch.
 * A failed fetch (offline install) or a redirect to the login page simply
 * leaves the shell cache empty instead of failing the install.
 */
async function primeShellCache() {
  const request = new Request(new URL("/", self.location.origin));
  const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS).catch(() => null);
  if (!response) return;
  if (!isCacheableResponse(request, response) || !isHtml(response)) return;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(request, response);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && !CURRENT_CACHES.has(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Session data and live agent traffic must always come from the local server.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE_URLS.includes(url.pathname);

  if (isStaticAsset) {
    event.respondWith(networkFirst(request, STATIC_CACHE, ASSET_TIMEOUT_MS));
  }
});

/**
 * Navigation keeps working offline by replaying the last shell document for
 * this app. The client router reads the address bar itself, so serving the
 * cached shell for any in-app URL still resolves the right session once the
 * session list loads.
 */
async function handleNavigation(request) {
  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (isCacheableResponse(request, response) && isHtml(response)) {
      const copy = response.clone();
      void putAndTrim(SHELL_CACHE, request, copy);
    }
    return response;
  } catch {
    // Exact URL first, then any cached shell document, then offline.html, and
    // finally a self-contained page so a blank screen is never the outcome.
    const exact = await openAndMatch(SHELL_CACHE, request, { ignoreSearch: true });
    if (exact) return exact;

    const fallback = await cachedShellDocument();
    if (fallback) return fallback;

    const offline = await caches.match(OFFLINE_URL);
    return offline ?? offlineFallbackResponse();
  }
}

/** Guarantees readable output when neither a shell nor offline.html is cached. */
function offlineFallbackResponse() {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\">"
    + "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
    + "<title>Pi Web is offline</title>"
    + "<body style=\"margin:0;min-height:100dvh;display:grid;place-items:center;"
    + "background:#1a1a1a;color:#e8e8e8;font-family:system-ui,sans-serif;text-align:center\">"
    + "<div><h1 style=\"font-size:20px\">Pi Web is offline</h1>"
    + "<p style=\"color:#9ca3af;font-size:14px\">Reconnect to the Pi Web server, then try again.</p>"
    + "<button onclick=\"location.reload()\" style=\"margin-top:16px;padding:10px 18px;"
    + "background:#242424;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;font:inherit;"
    + "cursor:pointer\">Try again</button></div>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function openAndMatch(cacheName, request, options) {
  const cache = await caches.open(cacheName);
  return cache.match(request, options);
}

async function cachedShellDocument() {
  const cache = await caches.open(SHELL_CACHE);
  const keys = await cache.keys();
  // Prefer the root document; otherwise any cached HTML navigation.
  const ordered = [
    ...keys.filter((key) => new URL(key.url).pathname === "/"),
    ...keys.filter((key) => new URL(key.url).pathname !== "/"),
  ];
  for (const key of ordered) {
    const response = await cache.match(key);
    if (response && isHtml(response)) return response;
  }
  return undefined;
}

function isHtml(response) {
  return (response.headers.get("Content-Type") ?? "").toLowerCase().includes("text/html");
}

/**
 * A redirect (e.g. the web-auth login page) must never be stored under the
 * original URL: fetch follows redirects transparently, so the final body would
 * be cached against a key the app later expects to hold its own document.
 */
function isCacheableResponse(request, response) {
  return response.ok && response.type === "basic" && response.url === request.url;
}

async function networkFirst(request, cacheName, timeoutMs) {
  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (isCacheableResponse(request, response)) {
      const copy = response.clone();
      void putAndTrim(cacheName, request, copy);
    }
    return response;
  } catch {
    const cached = await openAndMatch(cacheName, request);
    return cached ?? Response.error();
  }
}

async function putAndTrim(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Storage pressure or a non-cacheable response must not break the fetch.
  }
}

async function fetchWithTimeout(request, timeoutMs) {
  if (!timeoutMs || !Number.isFinite(timeoutMs)) return fetch(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Ignore malformed or missing push payloads.
  }
  const { title, body, url, tag } = payload;
  if (typeof title !== "string" || !title || typeof body !== "string" || !body) return;

  // Always surface a system notification. iOS revokes the push subscription
  // when a service worker handles a push without showing a notification, so
  // suppressing the notification while a window is visible poisons the
  // subscription in the background-delivery case. Notifications sharing a tag
  // replace each other instead of stacking, so a visible window merely sees
  // the completion notification re-appear.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url: typeof url === "string" && url ? url : "/" },
      ...(typeof tag === "string" && tag ? { tag, renotify: true } : {}),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/";
  let targetUrl = new URL("/", self.location.origin);
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
      const targetClient = client.url === targetUrl
        ? client
        : (await client.navigate(targetUrl)) ?? client;
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}
