import type { ProcfileProcess } from "./procfile";

export type ProjectDevStatus = "stopped" | "starting" | "running" | "stopping" | "restarting" | "error";
export type ProjectDevAction = "start" | "stop" | "restart";
export interface ProjectDevProcess extends ProcfileProcess {
  status: ProjectDevStatus;
  error: string | null;
  exitCode: number | null;
  pid: number | null;
  configured: boolean;
}
export interface ProjectDevInfo {
  cwd: string;
  found: boolean;
  configError: string | null;
  processes: ProjectDevProcess[];
  status: ProjectDevStatus;
  error: string | null;
}
export interface ProjectDevLog {
  id: number;
  process: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}
export type ProjectDevEvent =
  | { type: "snapshot"; info: ProjectDevInfo; logs: ProjectDevLog[] }
  | { type: "state"; info: ProjectDevInfo }
  | { type: "log"; log: ProjectDevLog };

export function projectDevBusy(status?: ProjectDevStatus): boolean {
  return status === "starting" || status === "stopping" || status === "restarting";
}

export function projectDevActive(status?: ProjectDevStatus): boolean {
  return status === "running" || projectDevBusy(status);
}
