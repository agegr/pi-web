import { type McpImportFormat, type McpImportNote, nameFromUrl, ServerDraft, setLiteralUrl } from "./mcp-import-core";
import { type EntryOutcome, isRecord, mapServerEntry, readInputs, siblingMcpUrl, sseRefusal } from "./mcp-import-json";
import { parseJsonc } from "./jsonc";

// A pasted address: an MCP endpoint, or an install link that carries a server
// config (Cursor, LM Studio, VS Code and its web redirects, Visual Studio,
// the GitHub Copilot app). Links that only name a server in a registry, a
// repository page and a badge image are recognised and explained instead.

export type LinkServers = { entries: EntryOutcome[]; notes: McpImportNote[] } | { error: McpImportNote };

/** `name=value` pairs of a query, decoded without turning `+` into a space (base64 keeps its `+`). */
function queryParams(search: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of search.replace(/^\?/, "").split("&")) {
    if (!pair) continue;
    const equals = pair.indexOf("=");
    const name = equals < 0 ? pair : pair.slice(0, equals);
    const value = equals < 0 ? "" : pair.slice(equals + 1);
    params.set(safeDecode(name), safeDecode(value));
  }
  return params;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Base64 (standard or URL-safe, padding optional) decoded as UTF-8; undefined when it is not. */
export function decodeBase64Utf8(text: string): string | undefined {
  let base64 = text.trim().replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(base64) || base64.length % 4 === 1) return undefined;
  base64 += "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** JSON that may still be percent-encoded once or twice more (VS Code's redirect links encode it twice). */
function decodeJson(text: string): unknown {
  let current = text.trim();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return parseJsonc(current);
    } catch {
      const decoded = safeDecode(current);
      if (decoded === current) break;
      current = decoded.trim();
    }
  }
  return undefined;
}

function invalid(detail: string): LinkServers {
  return { error: { code: "install-link-invalid", params: { detail } } };
}

/** Cursor's and LM Studio's `?name=<name>&config=<base64 of one server, without its name>`. */
function readCursorInstall(params: Map<string, string>): LinkServers {
  const config = params.get("config");
  if (!config) return invalid("config");
  const json = config.trim().startsWith("{") ? config : decodeBase64Utf8(config);
  const value = json === undefined ? undefined : decodeJson(json);
  if (!isRecord(value)) return invalid("config");
  const name = params.get("name") || undefined;
  return { entries: [mapServerEntry(name, value, { source: "cursor-install-link", flavor: "mcp-servers", rawPi: false })], notes: [] };
}

/** VS Code's install JSON: one server with its `name` (and sometimes `inputs`), or `config` + `name` + `inputs`. */
function readVsCodeInstall(json: unknown, source: McpImportFormat, name?: string, inputs?: unknown): LinkServers {
  if (!isRecord(json)) return invalid("config");
  const context = { source, flavor: "vscode" as const, rawPi: false, inputs: readInputs(inputs) };
  return { entries: [mapServerEntry(name, json, context)], notes: [] };
}

function byName(name: string): LinkServers {
  return { error: { code: "by-name-link", params: { name } } };
}

/** The part of a `scheme:path?query` link after its scheme, for schemes `URL` does not split into a host. */
function opaqueQuery(text: string): string {
  const question = text.indexOf("?");
  return question < 0 ? "" : text.slice(question + 1);
}

/** Reads a single pasted address. */
export function readLink(pasted: string, depth = 0): LinkServers {
  // A link copied from a page's HTML source keeps its `&amp;` separators.
  const text = pasted.replace(/&amp;/g, "&");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // `https://<your-host>/mcp` does not parse until its placeholder is filled in.
    if (/^https?:\/\/\S+$/i.test(text) && depth === 0) return { entries: [readEndpoint(undefined, text)], notes: [] };
    return { error: { code: "unrecognized-input" } };
  }
  if (depth > 3) return invalid("nesting");
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  switch (scheme) {
    case "cursor":
      if (/\/mcp\/install\/?$/.test(url.pathname)) return readCursorInstall(queryParams(url.search));
      return invalid("cursor");
    case "vscode":
    case "vscode-insiders":
    case "code-oss": {
      const path = text.slice(text.indexOf(":") + 1).replace(/^\/+/, "");
      const byNameMatch = /^mcp\/by-name\/([^?#]+)/.exec(path);
      if (byNameMatch) return byName(safeDecode(byNameMatch[1]));
      if (/^mcp\/api\.mcp\.github\.com\//.test(path)) return byName(path.replace(/^mcp\//, ""));
      if (/^mcp\/install\?/.test(path)) return readVsCodeInstall(decodeJson(opaqueQuery(text)), "vscode-install-link");
      return invalid(scheme);
    }
    case "vsweb+mcp":
      return readVsCodeInstall(decodeJson(opaqueQuery(text)), "visual-studio-install-link");
    case "ghapp":
      if (/^\/\/mcp\/install/.test(text.slice(text.indexOf(":") + 1))) {
        return readVsCodeInstall(decodeJson(opaqueQuery(text)), "copilot-app-install-link");
      }
      return invalid(scheme);
    case "ws":
    case "wss":
      return { entries: [{ note: { code: "websocket-transport", params: { url: text } } }], notes: [] };
    case "http":
    case "https":
      return readWebLink(url, text, depth);
    default:
      return { error: { code: "unsupported-url-scheme", params: { scheme } } };
  }
}

function readWebLink(url: URL, text: string, depth: number): LinkServers {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  if ((host === "cursor.com" || host === "lmstudio.ai") && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?install-mcp\/?$/.test(path)) {
    return readCursorInstall(queryParams(url.search));
  }
  if (host === "vscode.dev" || host === "insiders.vscode.dev") {
    const params = queryParams(url.search);
    if (/^\/redirect\/?$/.test(path) && params.get("url")) return readLink(params.get("url")!, depth + 1);
    if (/^\/redirect\/mcp\/install\/?$/.test(path)) {
      const config = params.get("config");
      if (!config) return invalid("config");
      return readVsCodeInstall(decodeJson(config), "vscode-install-link", params.get("name") || undefined, decodeJson(params.get("inputs") ?? "[]"));
    }
  }
  if (host === "aka.ms" && /^\/vs\/mcp-install\/?$/i.test(path)) {
    return readVsCodeInstall(decodeJson(url.search.slice(1)), "visual-studio-install-link");
  }
  if (host === "github.com" && /^\/copilot\/app\/launch\/?$/.test(path)) {
    const open = queryParams(url.search).get("open");
    if (open) return readLink(open, depth + 1);
    return invalid("open");
  }
  if (/\.(?:svg|png)$/i.test(path) && (host === "cursor.com" || host === "img.shields.io" || host.endsWith("githubusercontent.com"))) {
    return { error: { code: "badge-image" } };
  }
  if (host === "github.com") {
    // github.com serves web pages only; GitHub's own MCP server is api.githubcopilot.com.
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "mcp" && segments.length >= 2) return { error: { code: "github-mcp-page", params: { name: segments.slice(1).join("/") } } };
    if (segments[0] !== "mcp" && segments.length >= 2) return { error: { code: "github-repo-link", params: { repository: `${segments[0]}/${segments[1]}` } } };
    // The MCP registry index, an account page, the home page.
    return { error: { code: "github-page" } };
  }
  return { entries: [readEndpoint(url, text)], notes: [] };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A bare MCP endpoint, added like `pi mcp add --url`: no headers, so OAuth
 * applies when the server asks. `url` is undefined while a placeholder keeps
 * the address from parsing.
 */
function readEndpoint(url: URL | undefined, text: string): EntryOutcome {
  const name = nameFromUrl(text) || undefined;
  if (siblingMcpUrl(text) !== undefined) return { note: sseRefusal(name, text) };
  const draft = new ServerDraft("url", false);
  draft.transport = "http";
  setLiteralUrl(draft, text, false);
  if (url?.protocol === "http:" && !LOOPBACK.has(url.hostname)) draft.note("insecure-http", { host: url.hostname });
  return { draft };
}
