"use strict";

// A transport adapter, not an application router: the only upstream is the
// launcher's private loopback Next server. No buffering or SSE-specific logic.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const http = require("node:http");
const http2 = require("node:http2");
const tls = require("node:tls");
/* eslint-enable @typescript-eslint/no-require-imports */

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "http2-settings",
]);
const MAX_BACKEND_REQUESTS = 512;

// TLS parsing checks the chain and key, including whether they match, before
// any listener or child is started. Do not include OpenSSL's input in errors.
function readTlsFiles(certFile, keyFile) {
  let cert;
  let key;
  try {
    cert = fs.readFileSync(certFile);
    key = fs.readFileSync(keyFile);
  } catch (error) {
    throw new Error(`Could not read --https-cert/--https-key files (${error.code || "read failed"}).`);
  }
  try {
    tls.createSecureContext({ cert, key });
  } catch {
    throw new Error("Invalid --https-cert/--https-key PEM files: provide a certificate chain and matching unencrypted private key.");
  }
  return { cert, key };
}

function stripTransportHeaders(headers, { request = false } = {}) {
  const excluded = new Set(HOP_BY_HOP);
  const connection = headers.connection;
  for (const token of String(connection || "").split(",")) {
    excluded.add(token.trim().toLowerCase());
  }
  const result = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || excluded.has(lower)) continue;
    // Never trust a client's claim about a proxy chain or external origin.
    if (request && (lower === "forwarded" || lower.startsWith("x-forwarded-"))) continue;
    if (value !== undefined) result[lower] = value;
  }
  return result;
}

function parseAuthority(value) {
  if (typeof value !== "string" || !value || /[\s/@\\?#,]/.test(value)) return null;
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/") return null;
    return parsed;
  } catch {
    return null;
  }
}

function requestAuthority(request) {
  const host = request.headers.host;
  const authority = request.headers[":authority"];
  if (authority && host) {
    const a = parseAuthority(authority);
    const h = parseAuthority(host);
    if (!a || !h || a.host !== h.host) return null;
  }
  // HTTP/1 duplicates are ambiguous (Node normally discards the later Host).
  let hosts = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() === "host") hosts++;
  }
  if (hosts > 1) return null;
  const value = authority || host;
  return parseAuthority(value) ? value : null;
}

function publicLocation(value, authority, backendPort) {
  if (typeof value !== "string") return value;
  // Relative redirects already refer to the public origin. Only map the
  // *exact* private backend origin; redirects to other sites stay untouched.
  try {
    const location = new URL(value);
    if ((location.protocol === "http:" || location.protocol === "https:")
      && location.hostname === "127.0.0.1"
      && (location.port || (location.protocol === "http:" ? "80" : "443")) === String(backendPort)
      && !location.username && !location.password) {
      return `https://${authority}${location.pathname}${location.search}${location.hash}`;
    }
  } catch {
    // Relative URL.
  }
  return value;
}

function rejectRequest(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(message);
}

/**
 * Stable integration API: createHttp2Gateway({ backendPort, cert, key, isReady }) returns
 * { server, close }. Call server.listen(port, hostname) yourself; close() is an
 * idempotent Promise that cancels requests and destroys sessions/sockets/agent.
 * backendPort is fixed for this instance; its host is never configurable.
 * Optional isReady() lets the launcher return 503 during startup/shutdown;
 * standalone callers forward immediately by default.
 */
function createHttp2Gateway({ backendPort, cert, key, isReady = () => true }) {
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    throw new Error("The private backend port must be an integer between 1 and 65535.");
  }
  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: MAX_BACKEND_REQUESTS,
    maxTotalSockets: MAX_BACKEND_REQUESTS,
    maxFreeSockets: 16,
    scheduling: "lifo",
  });
  const requests = new Set();
  const sessions = new Set();
  const sockets = new Set();
  let closing;
  let stopped = false;

  let server;
  try {
    server = http2.createSecureServer({
    cert, key, allowHTTP1: true,
    // Well above the browser's HTTP/1 pool and the mixed-stream acceptance
    // load; both admission and the private agent are bounded. Never queue
    // short requests behind an unbounded number of long-lived responses.
    settings: { maxConcurrentStreams: 256 },
    maxSessionMemory: 16,
  }, (request, response) => {
    if (stopped || !isReady()) return rejectRequest(response, 503, "Gateway not ready or shutting down");
    if (request.method === "CONNECT" || request.headers[":protocol"] || request.headers.upgrade) {
      return rejectRequest(response, 501, "Upgrade protocols and CONNECT are not supported");
    }
    if (request.httpVersionMajor === 2 && request.headers[":scheme"] !== "https") {
      return rejectRequest(response, 400, "Expected HTTPS scheme");
    }
    // Origin-form only: no absolute URI, authority-form, //host or fragments.
    // In particular, http.request() below never receives a URL as its target.
    if (!request.url?.startsWith("/") || request.url.startsWith("//") || /[\\\s#]/.test(request.url)) {
      return rejectRequest(response, 400, "Only origin-form request targets are supported");
    }
    const authority = requestAuthority(request);
    if (!authority) return rejectRequest(response, 400, "Invalid or conflicting Host/authority");
    if (requests.size >= MAX_BACKEND_REQUESTS) {
      return rejectRequest(response, 503, "Too many active requests");
    }

    const nominated = String(request.headers.connection || "").split(",").map((h) => h.trim().toLowerCase());
    // Removing a nominated security header could turn a denied request into
    // an apparently header-less/non-browser request at the existing proxy.
    if (nominated.some((h) => ["host", "origin", "cookie", "authorization"].includes(h) || h.startsWith("sec-fetch-"))) {
      return rejectRequest(response, 400, "Security headers cannot be hop-by-hop");
    }
    const headers = stripTransportHeaders(request.headers, { request: true });
    headers.host = authority;
    headers["x-forwarded-host"] = authority;
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-port"] = parseAuthority(authority).port || "443";
    headers["x-forwarded-for"] = request.socket.remoteAddress;
    // Expect was handled by the TLS entry; do not wait for a second 100.
    delete headers.expect;
    const upstream = http.request({
      hostname: "127.0.0.1", port: backendPort,
      method: request.method, path: request.url, headers, agent,
    });
    requests.add(upstream);
    let backendResponse;
    const cancel = () => {
      upstream.destroy();
      backendResponse?.destroy();
    };
    request.on("aborted", cancel);
    request.on("error", cancel);
    // For h2 this is the response's stream, not the shared TLS session. A
    // closed tab/stream cancels only its own private request.
    response.on("close", () => {
      // A finished response may already have returned its socket to the
      // keep-alive agent. Only cancel an incomplete client response.
      if (!response.writableFinished) cancel();
    });
    response.on("error", cancel);
    upstream.once("close", () => requests.delete(upstream));
    upstream.on("error", () => {
      if (!response.headersSent && !response.destroyed) rejectRequest(response, 502, "Private backend unavailable");
      else response.destroy();
    });
    // An upstream upgrade must not strand an untracked upgraded socket.
    upstream.on("upgrade", (_response, socket) => {
      socket.destroy();
      rejectRequest(response, 502, "Backend upgrade protocols are not supported");
    });
    upstream.on("response", (incoming) => {
      backendResponse = incoming;
      if (request.aborted || response.destroyed || upstream.destroyed) {
        incoming.destroy();
        return;
      }
      const outgoing = stripTransportHeaders(incoming.headers);
      if (outgoing.location) outgoing.location = publicLocation(outgoing.location, authority, backendPort);
      // Node preserves set-cookie as an array: never join it with commas.
      try {
        response.writeHead(incoming.statusCode, outgoing);
      } catch {
        cancel();
        response.destroy();
        return;
      }
      incoming.on("error", () => response.destroy());
      incoming.on("aborted", () => response.destroy());
      incoming.pipe(response); // Node's pipe preserves download/SSE backpressure.
    });
    request.pipe(upstream); // Uploads stream too; no body-sized in-memory copy.
    });
  } catch {
    agent.destroy();
    throw new Error("Could not create the HTTPS/HTTP2 entry point: invalid TLS certificate or key.");
  }
  server.on("session", (session) => {
    sessions.add(session);
    session.on("error", () => {}); // A bad/aborted peer is not a launcher failure.
    session.once("close", () => sessions.delete(session));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroySoon();
  });
  server.on("connect", (_request, target) => {
    if (typeof target.writeHead === "function") rejectRequest(target, 501, "CONNECT is not supported");
    else {
      target.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      target.destroySoon();
    }
  });

  return {
    server,
    close() {
      if (closing) return closing;
      stopped = true;
      closing = new Promise((resolve) => {
        server.close(() => resolve());
        for (const request of requests) request.destroy();
        agent.destroy();
        for (const session of sessions) session.destroy();
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

module.exports = { createHttp2Gateway, readTlsFiles };
