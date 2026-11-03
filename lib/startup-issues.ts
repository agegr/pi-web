/**
 * What pi's TUI prints when a session starts (`interactive-mode.js`: startup
 * diagnostics, the model it could not restore, `[Extension issues]`), as the
 * notices a session's first watcher gets. Without them an extension with a
 * syntax error just vanished.
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
  /** `resourceLoader.getExtensions()`: extensions that failed to load, and their warnings. */
  extensions?: {
    errors?: readonly { path: string; error: string }[];
    warnings?: readonly { path: string; warning: string }[];
  };
  /** `extensionRunner.getCommandDiagnostics()`: commands two extensions both register. */
  commandDiagnostics?: readonly Diagnostic[];
  /** `createAgentSessionFromServices()`: the saved model could not be restored. */
  modelFallbackMessage?: string;
}

/** At most this many notices: a broken package can fail dozens of files at once. */
export const STARTUP_ISSUE_LIMIT = 8;

function withPath(message: string, path: string | undefined): string {
  return path && !message.includes(path) ? `${path}: ${message}` : message;
}

export function collectStartupIssues(sources: StartupIssueSources): StartupIssue[] {
  const issues: StartupIssue[] = [];
  for (const diagnostic of sources.diagnostics ?? []) {
    if (diagnostic.type === "error" || diagnostic.type === "warning") {
      issues.push({ type: diagnostic.type, message: withPath(diagnostic.message, diagnostic.path) });
    }
  }
  for (const error of sources.extensions?.errors ?? []) {
    // pi's loader already says "Failed to load extension: …" with the file's place.
    const message = withPath(error.error, error.path);
    issues.push({ type: "error", message: /extension/i.test(message) ? message : `Extension failed to load: ${message}` });
  }
  for (const warning of sources.extensions?.warnings ?? []) {
    issues.push({ type: "warning", message: `Extension: ${withPath(warning.warning, warning.path)}` });
  }
  for (const diagnostic of sources.commandDiagnostics ?? []) {
    issues.push({ type: diagnostic.type === "error" ? "error" : "warning", message: withPath(diagnostic.message, diagnostic.path) });
  }
  if (sources.modelFallbackMessage) issues.push({ type: "warning", message: sources.modelFallbackMessage });
  if (issues.length <= STARTUP_ISSUE_LIMIT) return issues;
  const shown = issues.slice(0, STARTUP_ISSUE_LIMIT - 1);
  shown.push({ type: "warning", message: `${issues.length - shown.length} more startup issues: see the server log` });
  return shown;
}
