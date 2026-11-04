/**
 * What pi's TUI prints when a session starts (`interactive-mode.js`: startup
 * diagnostics, `[Extension issues]`, an extension's `session_start` error), as
 * the notices each page watching the session gets. Without them an extension
 * with a syntax error just vanished. Client-safe: the page's half is
 * `extensionErrorMessage()` and `createShownNotices()`.
 */
export interface StartupIssue {
  type: "error" | "warning";
  message: string;
}

interface Diagnostic {
  type: string;
  message: string;
  path?: string;
}

export interface StartupIssueSources {
  /** `createAgentSessionServices().diagnostics`: extension providers that failed to register, flags. */
  diagnostics?: readonly Diagnostic[];
  /** `resourceLoader.getExtensions()`: extensions that failed to load or conflict, and their warnings. */
  extensions?: {
    errors?: readonly { path: string; error: string }[];
    warnings?: readonly { path: string; warning: string }[];
  };
}

/** At most this many notices: a broken package can fail dozens of files at once. */
export const STARTUP_ISSUE_LIMIT = 8;

function withPath(message: string, path: string | undefined): string {
  return path && !message.includes(path) ? `${path}: ${message}` : message;
}

/** Every issue, for the server log; `limitStartupNotices()` picks what the page is told. */
export function collectStartupIssues(sources: StartupIssueSources): StartupIssue[] {
  const issues: StartupIssue[] = [];
  for (const diagnostic of sources.diagnostics ?? []) {
    if (diagnostic.type === "error" || diagnostic.type === "warning") {
      issues.push({ type: diagnostic.type, message: withPath(diagnostic.message, diagnostic.path) });
    }
  }
  // pi's loader words them itself ("Failed to load extension: …", a tool's conflict), as the TUI lists them.
  for (const error of sources.extensions?.errors ?? []) {
    issues.push({ type: "error", message: withPath(error.error, error.path) });
  }
  for (const warning of sources.extensions?.warnings ?? []) {
    issues.push({ type: "warning", message: `Extension: ${withPath(warning.warning, warning.path)}` });
  }
  return issues;
}

/** The page's notices: the first ones, then a count of the rest, which the server log has. */
export function limitStartupNotices(issues: readonly StartupIssue[]): StartupIssue[] {
  if (issues.length <= STARTUP_ISSUE_LIMIT) return [...issues];
  const shown = issues.slice(0, STARTUP_ISSUE_LIMIT - 1);
  shown.push({ type: "warning", message: `${issues.length - shown.length} more startup issues: see the server log` });
  return shown;
}

// pi-web's own `extension_error`s (a custom panel's input, a widget factory) carry a key, not a path.
const PI_WEB_ERROR_KEY = /^(?:custom-ui|extension-widget):/;

/** pi's TUI wording of an `extension_error` (`showExtensionError()`): it names the extension. */
export function extensionErrorMessage(extensionPath: unknown, error: string): string {
  return typeof extensionPath === "string" && extensionPath && !PI_WEB_ERROR_KEY.test(extensionPath)
    ? `Extension "${extensionPath}" error: ${error}`
    : error;
}

/**
 * The notice ids a page has shown: a session's wrapper tells its startup issues to every
 * stream it opens, under the same ids, so a reconnect or a return to the session would say
 * them again. Remembers the latest `limit` ids; true the first time an id is seen.
 */
export function createShownNotices(limit = 200): (id: string) => boolean {
  const shown = new Set<string>();
  return (id) => {
    if (shown.has(id)) return false;
    shown.add(id);
    if (shown.size > limit) shown.delete(shown.values().next().value as string);
    return true;
  };
}
