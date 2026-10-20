import type { ProjectDevAction, ProjectDevInfo } from "./project-dev-types";

export async function projectDevRequest<T>(body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/project-dev", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result as T;
}
export function controlProjectDevClient(cwd: string, action: ProjectDevAction, process?: string): Promise<ProjectDevInfo> {
  return projectDevRequest({ cwd, action, process, controlVersion: 2 });
}
/** A local event lets the sidebar refresh after controls in a log tab are used. */
export function notifyProjectDevChanged(): void {
  window.dispatchEvent(new Event("pi-web:project-dev-changed"));
}
