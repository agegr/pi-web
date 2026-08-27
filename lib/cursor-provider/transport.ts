import { once } from "node:events";
import http from "node:http";
import http2, {
  type ClientHttp2Session,
  type IncomingHttpHeaders,
} from "node:http2";
import https from "node:https";
import type { Socket } from "node:net";
import tls from "node:tls";

const CURSOR_CLIENT_VERSION = "cli-2026.01.09-231024f";
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

const PROXY_URL_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

const NO_PROXY_KEYS = ["NO_PROXY", "no_proxy"] as const;

type ProviderEnv = Record<string, string | undefined>;

export function envFirst(
  env: ProviderEnv,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = env[name];
    if (value?.trim()) return value.trim();
  }
  return "";
}

export function resolveHttpsProxyUrl(env: ProviderEnv = process.env): string {
  const raw = envFirst(env, PROXY_URL_KEYS);
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function resolveNoProxy(env: ProviderEnv = process.env): string {
  return envFirst(env, NO_PROXY_KEYS);
}

export function hostBypassesProxy(hostname: string, noProxyList: string): boolean {
  if (!hostname || !noProxyList.trim()) return false;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  for (const raw of noProxyList.split(/[\s,]+/)) {
    let spec = raw.trim().toLowerCase();
    if (!spec) continue;
    if (spec === "*") return true;
    spec = spec.replace(/^\./, "").replace(/:\d+$/, "");
    if (spec && (host === spec || host.endsWith(`.${spec}`))) return true;
  }
  return false;
}

function abortError(): Error {
  return new Error("Request aborted");
}

function waitForConnect(
  session: ClientHttp2Session,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      session.removeListener("connect", onConnect);
      session.removeListener("error", onError);
    };
    const fail = (error: Error) => {
      cleanup();
      session.destroy();
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => fail(error);
    const onAbort = () => fail(abortError());
    const timer = setTimeout(
      () => fail(new Error("Cursor HTTP/2 connection timed out")),
      timeoutMs,
    );
    timer.unref();
    session.once("connect", onConnect);
    session.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function httpConnectTunnel(
  proxyUrl: string,
  hostname: string,
  port: number,
  timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const proxy = new URL(proxyUrl);
    const target = `${hostname}:${port}`;
    const headers: Record<string, string> = { Host: target };
    if (proxy.username || proxy.password) {
      const username = decodeURIComponent(proxy.username);
      const password = decodeURIComponent(proxy.password);
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

    const request = (proxy.protocol === "https:" ? https : http).request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: target,
      headers,
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      cleanup();
      request.destroy();
      reject(error);
    };
    const onAbort = () => fail(abortError());
    const timer = setTimeout(
      () => fail(new Error("Proxy CONNECT timed out")),
      timeoutMs,
    );
    timer.unref();

    request.once("connect", (response, socket, head) => {
      cleanup();
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT status ${response.statusCode ?? "unknown"}`));
        return;
      }
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    request.once("error", fail);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    request.end();
  });
}

async function connectTls(
  socket: Socket,
  hostname: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<tls.TLSSocket> {
  const tlsSocket = tls.connect({
    socket,
    servername: hostname,
    ALPNProtocols: ["h2"],
  });
  const timer = setTimeout(() => {
    tlsSocket.destroy(new Error("Proxy TLS handshake timed out"));
  }, timeoutMs);
  timer.unref();
  const onAbort = () => tlsSocket.destroy(abortError());
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    await once(tlsSocket, "secureConnect");
    return tlsSocket;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function connectCursorHttp2(
  url: string,
  env: ProviderEnv = process.env,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<ClientHttp2Session> {
  const target = new URL(url);
  const port = target.port
    ? Number(target.port)
    : target.protocol === "http:"
      ? 80
      : 443;
  const proxy = resolveHttpsProxyUrl(env);

  let session: ClientHttp2Session;
  if (!proxy || hostBypassesProxy(target.hostname, resolveNoProxy(env))) {
    session = http2.connect(url);
  } else {
    const socket = await httpConnectTunnel(
      proxy,
      target.hostname,
      port,
      timeoutMs,
      signal,
    );
    let tlsSocket: tls.TLSSocket;
    try {
      tlsSocket = await connectTls(socket, target.hostname, timeoutMs, signal);
    } catch (error) {
      socket.destroy();
      throw error;
    }
    session = http2.connect(url, { createConnection: () => tlsSocket });
  }

  await waitForConnect(session, timeoutMs, signal);
  return session;
}

export interface CursorBridgeResult {
  error?: Error;
  status?: number;
}

export interface CursorBridge {
  readonly alive: boolean;
  readonly response: Promise<{ status: number; headers: Record<string, string> }>;
  readonly closed: Promise<CursorBridgeResult>;
  write(data: Uint8Array): void;
  end(data?: Uint8Array): void;
  destroy(error?: Error): void;
  onData(callback: (chunk: Buffer) => void): void;
}

function headersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":")) continue;
    if (Array.isArray(value)) result[key] = value.join(", ");
    else if (value !== undefined) result[key] = String(value);
  }
  return result;
}

export async function openCursorBridge(options: {
  accessToken: string;
  rpcPath: string;
  url?: string;
  unary?: boolean;
  env?: ProviderEnv;
  signal?: AbortSignal;
}): Promise<CursorBridge> {
  const url = options.url ?? "https://api2.cursor.sh";
  const session = await connectCursorHttp2(
    url,
    { ...process.env, ...options.env },
    options.signal,
  );
  const stream = session.request({
    ":method": "POST",
    ":path": options.rpcPath,
    "content-type": options.unary ? "application/proto" : "application/connect+proto",
    "connect-protocol-version": "1",
    te: "trailers",
    authorization: `Bearer ${options.accessToken}`,
    "x-ghost-mode": "true",
    "x-cursor-client-version": CURSOR_CLIENT_VERSION,
    "x-cursor-client-type": "cli",
    "x-request-id": crypto.randomUUID(),
  });
  stream.pause();

  let alive = true;
  let status: number | undefined;
  let closeError: Error | undefined;
  let resolveResponse!: (value: { status: number; headers: Record<string, string> }) => void;
  let rejectResponse!: (error: Error) => void;
  let resolveClosed!: (value: CursorBridgeResult) => void;
  let responseSettled = false;
  let closedSettled = false;

  const response = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const closed = new Promise<CursorBridgeResult>((resolve) => {
    resolveClosed = resolve;
  });

  const finish = () => {
    if (closedSettled) return;
    closedSettled = true;
    alive = false;
    if (!responseSettled) {
      responseSettled = true;
      rejectResponse(closeError ?? new Error("Cursor stream closed before response headers"));
    }
    resolveClosed({ error: closeError, status });
    if (closeError) session.destroy();
    else session.close();
  };

  stream.once("response", (headers) => {
    status = Number(headers[":status"] ?? 0);
    responseSettled = true;
    resolveResponse({ status, headers: headersToRecord(headers) });
  });
  stream.once("error", (error) => {
    closeError = error;
    finish();
  });
  stream.once("end", finish);
  stream.once("close", finish);
  session.once("error", (error) => {
    closeError = error;
    finish();
  });

  const onAbort = () => {
    closeError = abortError();
    stream.destroy(closeError);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  void closed.then(() => options.signal?.removeEventListener("abort", onAbort));

  return {
    get alive() {
      return alive;
    },
    response,
    closed,
    write(data) {
      if (alive) stream.write(data);
    },
    end(data) {
      if (!alive) return;
      if (data) stream.end(data);
      else stream.end();
    },
    destroy(error) {
      if (!alive) return;
      closeError = error;
      stream.destroy(error);
    },
    onData(callback) {
      stream.on("data", callback);
      stream.resume();
    },
  };
}

export async function callCursorUnary(options: {
  accessToken: string;
  rpcPath: string;
  requestBody: Uint8Array;
  url?: string;
  env?: ProviderEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Uint8Array> {
  const bridge = await openCursorBridge({ ...options, unary: true });
  const chunks: Buffer[] = [];
  bridge.onData((chunk) => chunks.push(Buffer.from(chunk)));
  bridge.end(options.requestBody);

  const timeoutMs = options.timeoutMs ?? 15_000;
  const timer = setTimeout(
    () => bridge.destroy(new Error("Cursor unary request timed out")),
    timeoutMs,
  );
  timer.unref();
  try {
    const response = await bridge.response;
    const result = await bridge.closed;
    if (result.error) throw result.error;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Cursor HTTP ${response.status}`);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}
