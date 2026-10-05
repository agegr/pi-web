import type {
  ProjectDeleteErrorResponse,
  ProjectDeleteResponse,
} from "@/lib/api-types";

// Pure helpers and the request for the sidebar's "Delete project…" flow
// (components/SessionSidebar.tsx). Client-safe: types and fetch only.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ProjectDeleteResult =
  | { ok: true; deletedSessions: number; removedDirs: number; failedPaths: string[] }
  | { ok: false; reason?: ProjectDeleteErrorResponse["reason"]; runningSessionTitles: string[]; error: string };

/**
 * The project's display name as the dropdown shows it: the last path segment,
 * which is what the user types to confirm. A trailing separator (a root) is
 * dropped first, so "/" still has a name.
 */
export function projectDisplayName(projectRoot: string): string {
  const trimmed = projectRoot.replace(/[/\\]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

/** Whether the typed confirmation matches the project's display name exactly. */
export function confirmationMatches(typed: string, projectRoot: string): boolean {
  const name = projectDisplayName(projectRoot);
  return name.length > 0 && typed === name;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Delete every session of a project. The server finds the project again in its
 * session catalogue by this key, so the key never becomes a path here or
 * there. A refusal carries its reason, which the dialog turns into a message;
 * a live project additionally names the sessions that hold their files. A
 * success still names whatever could not be removed, so a partial delete is
 * not reported as a clean one.
 */
export async function deleteProject(
  projectKey: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<ProjectDeleteResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/projects/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectKey }),
    });
  } catch (error) {
    return {
      ok: false,
      runningSessionTitles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const data: unknown = await response.json().catch(() => null);
  const record = data !== null && typeof data === "object" ? data as Record<string, unknown> : {};
  if (response.ok && typeof record.deletedSessions === "number") {
    // The paths, not a count: the dialog names what is still on disk, which is
    // the only way the user learns a stray file kept a directory alive.
    const failures = Array.isArray(record.failures) ? record.failures : [];
    return {
      ok: true,
      deletedSessions: record.deletedSessions,
      removedDirs: typeof record.removedDirs === "number" ? record.removedDirs : 0,
      failedPaths: failures
        .map((failure) => (failure !== null && typeof failure === "object" ? (failure as { path?: unknown }).path : undefined))
        .filter((path): path is string => typeof path === "string"),
    };
  }

  return {
    ok: false,
    ...(typeof record.reason === "string" ? { reason: record.reason as ProjectDeleteErrorResponse["reason"] } : {}),
    runningSessionTitles: stringArray(record.runningSessionTitles),
    error: typeof record.error === "string" ? record.error : `HTTP ${response.status}`,
  };
}

/** The response shape tests and callers may hold; kept for its type narrowing. */
export type ProjectDeleteSuccess = ProjectDeleteResponse;
