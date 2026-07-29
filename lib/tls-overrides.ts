/**
 * Scoped TLS overrides for intranet HTTPS endpoints.
 *
 * Problem: some internal model APIs (e.g. https://172.16.111.183:9443) serve a
 * publicly-issued certificate whose SAN only contains a DNS name
 * (ai.secsign.online), so connecting by IP fails with
 * ERR_TLS_CERT_ALTNAME_INVALID. The blunt workaround — a global
 * NODE_TLS_REJECT_UNAUTHORIZED=0 — disables certificate verification for ALL
 * traffic, including public APIs, which is unsafe.
 *
 * Solution: resolve per-origin TLS connect options that the global undici
 * dispatcher applies (Node's fetch goes through it, including the
 * Anthropic/OpenAI-compatible clients used by pi-ai):
 *
 *  1. For every https://<ip>:<port> provider baseUrl found in
 *     ~/.pi/agent/models.json, probe the peer certificate and reuse its first
 *     SAN DNS name as the TLS servername → full certificate chain AND hostname
 *     verification still happen, just against the correct name.
 *  2. If probing fails (VPN down, truly self-signed cert, ...), fall back to
 *     rejectUnauthorized:false for THAT ORIGIN ONLY. Everything else keeps
 *     strict default verification.
 *
 * Manual overrides (comma-separated env vars):
 *   PI_WEB_TLS_SERVERNAME_OVERRIDES="10.0.0.1:8443=api.internal,10.0.0.2:443=gw.corp"
 *   PI_WEB_TLS_INSECURE_HOSTS="10.0.0.3:9443"   // skip verification for these only
 *   PI_WEB_TLS_AUTO=0                            // disable models.json auto-detection
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { isIP } from "node:net";

type Override =
  | { kind: "servername"; servername: string }
  | { kind: "insecure" };

const overrides = new Map<string, Override>();
let loaded: Promise<void> | null = null;

function originOf(host: string, port: string): string {
  return port === "443" ? `https://${host}` : `https://${host}:${port}`;
}

function parseHostPort(entry: string): { host: string; port: string } | null {
  const m = entry.trim().match(/^([^:]+)(?::(\d+))?$/);
  if (!m) return null;
  return { host: m[1], port: m[2] ?? "443" };
}

/** Collect https://<ip> baseUrls from ~/.pi/agent/models.json providers. */
function collectIpOriginsFromModelsJson(): { host: string; port: string }[] {
  if (process.env.PI_WEB_TLS_AUTO === "0") return [];
  const file = join(homedir(), ".pi", "agent", "models.json");
  if (!existsSync(file)) return [];
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as { providers?: Record<string, { baseUrl?: string }> };
    const out: { host: string; port: string }[] = [];
    for (const provider of Object.values(json?.providers ?? {})) {
      if (!provider?.baseUrl) continue;
      try {
        const url = new URL(provider.baseUrl);
        if (url.protocol === "https:" && isIP(url.hostname) !== 0) {
          out.push({ host: url.hostname, port: url.port || "443" });
        }
      } catch {
        // ignore malformed baseUrl
      }
    }
    return out;
  } catch (err) {
    console.warn("[tls-overrides] failed to parse models.json:", err);
    return [];
  }
}

/** Probe the peer certificate and return its first SAN DNS name, if any. */
function probeServername(host: string, port: number, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const san: string | undefined = cert?.subjectaltname;
      const dns = san
        ?.split(",")
        .map((s) => s.trim())
        .find((s) => s.startsWith("DNS:") && !s.includes("*"))
        ?.slice(4);
      const cn = cert?.subject?.CN;
      resolve(dns || (Array.isArray(cn) ? cn[0] : cn) || null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function registerIpOrigin(host: string, port: string): Promise<void> {
  const origin = originOf(host, port);
  if (overrides.has(origin)) return;
  const servername = await probeServername(host, Number(port));
  if (servername && isIP(servername) === 0) {
    overrides.set(origin, { kind: "servername", servername });
    console.log(`[tls-overrides] ${origin} → SNI override "${servername}" (full certificate verification kept)`);
  } else {
    overrides.set(origin, { kind: "insecure" });
    console.warn(`[tls-overrides] ${origin} → certificate verification disabled FOR THIS HOST ONLY (probe failed)`);
  }
}

function loadEnvOverrides(): void {
  for (const entry of (process.env.PI_WEB_TLS_SERVERNAME_OVERRIDES ?? "").split(",")) {
    const [target, servername] = entry.split("=").map((s) => s?.trim());
    const hp = target ? parseHostPort(target) : null;
    if (hp && servername) {
      overrides.set(originOf(hp.host, hp.port), { kind: "servername", servername });
    }
  }
  for (const entry of (process.env.PI_WEB_TLS_INSECURE_HOSTS ?? "").split(",")) {
    const hp = entry.trim() ? parseHostPort(entry) : null;
    if (hp) {
      overrides.set(originOf(hp.host, hp.port), { kind: "insecure" });
    }
  }
}

/**
 * Detect intranet https endpoints. Safe to call multiple times; detection runs
 * once and later calls await the same probe.
 */
export function loadTlsOverrides(): Promise<void> {
  if (typeof window !== "undefined") return Promise.resolve();
  loaded ??= (async () => {
    loadEnvOverrides();
    await Promise.all(
      collectIpOriginsFromModelsJson().map(({ host, port }) => registerIpOrigin(host, port)),
    );
  })();
  return loaded;
}

/**
 * Merge this origin's TLS override into undici client/pool options. Origins
 * without an override are returned untouched, so public traffic keeps Node's
 * strict defaults.
 */
export function withTlsOverride<T extends object>(origin: string | URL, options: T): T {
  const override = overrides.get(String(origin));
  if (!override) return options;

  const connect = (options as { connect?: Record<string, unknown> }).connect;
  return {
    ...options,
    connect: override.kind === "servername"
      ? { ...connect, servername: override.servername, rejectUnauthorized: true }
      : { ...connect, rejectUnauthorized: false },
  };
}
