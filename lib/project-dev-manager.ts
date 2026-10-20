import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serializeByKey } from "./key-serializer";
import { readRegularFileText } from "./regular-file";
import { parseProcfile, type ProcfileProcess } from "./procfile";
import { projectDevActive, type ProjectDevAction, type ProjectDevEvent, type ProjectDevInfo, type ProjectDevLog, type ProjectDevStatus } from "./project-dev-types";

interface ManagedProcess {
  child: ChildProcess;
  name: string;
  pid?: number;
  closed: boolean;
}
interface ServiceRecord {
  definition: ProcfileProcess;
  status: ProjectDevStatus;
  error: string | null;
  exitCode: number | null;
  child?: ManagedProcess;
}
interface DevRecord {
  cwd: string;
  status: ProjectDevStatus;
  error: string | null;
  // Also retained for shutdown callbacks registered before a hot reload.
  children: ManagedProcess[];
  services: Map<string, ServiceRecord>;
  logs: ProjectDevLog[];
  logSize: number;
  sequence: number;
  listeners: Set<(event: ProjectDevEvent) => void>;
  config: { found: boolean; processes: ProcfileProcess[]; configError: string | null };
  configAt: number;
}
interface DevStore {
  records: Map<string, DevRecord>;
  shuttingDown: boolean;
}
const STORE = Symbol.for("pi-web:project-dev");
const LOCKS = Symbol.for("pi-web:project-dev-locks");
const MAX_LOG_SIZE = 256 * 1024;
const MAX_LOG_ENTRIES = 2000;
const CONFIG_TTL = 10_000;

function signalChild(child: ManagedProcess, force: boolean): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (!child.closed) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000, stdio: "ignore" });
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
function store(): DevStore {
  const globals = globalThis as Record<symbol, DevStore | undefined>;
  if (!globals[STORE]) {
    const state: DevStore = { records: new Map(), shuttingDown: false };
    globals[STORE] = state;
    const forceCleanup = () => {
      for (const record of state.records.values()) {
        for (const child of record.children) {
          try { signalChild(child, true); } catch { /* process is already exiting */ }
        }
      }
    };
    process.once("exit", forceCleanup);
    const shutdown = async (signal: NodeJS.Signals) => {
      if (state.shuttingDown) return;
      state.shuttingDown = true;
      const children = [...state.records.values()].flatMap((record) => record.children);
      for (const child of children) {
        try { signalChild(child, false); } catch { /* force cleanup below */ }
      }
      await waitForExit(children, 3000);
      for (const child of children) {
        try { if (groupAlive(child)) signalChild(child, true); } catch { /* process is already exiting */ }
      }
      await waitForExit(children, 2000);
      process.exit(128 + (signal === "SIGINT" ? 2 : 15));
    };
    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
    process.once("SIGINT", () => { void shutdown("SIGINT"); });
  }
  return globals[STORE]!;
}
export function projectDevPath(cwd: string): string { return realpathSync(cwd); }
function keyOf(cwd: string): string { return process.platform === "win32" ? cwd.toLowerCase() : cwd; }
function newService(definition: ProcfileProcess): ServiceRecord {
  return { definition, status: "stopped", error: null, exitCode: null };
}
function recordFor(cwd: string): DevRecord {
  const key = keyOf(cwd);
  let record = store().records.get(key);
  if (!record) {
    record = {
      cwd, status: "stopped", error: null, children: [], services: new Map(), logs: [], logSize: 0, sequence: 0,
      listeners: new Set(), config: { found: false, processes: [], configError: null }, configAt: 0,
    };
    store().records.set(key, record);
  }
  // Preserve services started by the earlier project-wide manager across HMR.
  if (!record.services) {
    record.services = new Map();
    for (const child of record.children) {
      const definition = record.config.processes.find((item) => item.name === child.name) ?? { name: child.name, command: "" };
      const service = newService(definition);
      service.child = child;
      service.status = child.closed ? "stopped" : "running";
      record.services.set(child.name, service);
      attachProcess(record, service, child);
    }
    record.configAt = 0;
  }
  return record;
}
function readConfig(record: DevRecord, force: boolean): void {
  if (!force && Date.now() - record.configAt < CONFIG_TTL) return;
  try {
    const text = readRegularFileText(join(record.cwd, "Procfile.dev"), 64 * 1024);
    record.config = text === undefined
      ? { found: false, processes: [], configError: null }
      : { found: true, processes: parseProcfile(text), configError: null };
    for (const definition of record.config.processes) {
      const existing = record.services.get(definition.name);
      if (existing) existing.definition = definition;
      else record.services.set(definition.name, newService(definition));
    }
  } catch (error) {
    record.config = { found: true, processes: [], configError: error instanceof Error ? error.message : String(error) };
  }
  record.configAt = Date.now();
}
function infoOf(record: DevRecord): ProjectDevInfo {
  const configured = new Set(record.config.processes.map((item) => item.name));
  const services = [...record.services.values()].filter((service) => configured.has(service.definition.name) || service.child || service.status === "error");
  const statuses = services.map((service) => service.status);
  const status = (["restarting", "stopping", "starting", "running", "error"] as const).find((candidate) => statuses.includes(candidate)) ?? "stopped";
  record.status = status;
  record.error = services.flatMap((service) => service.error ? [service.error] : []).join("; ") || null;
  record.children = [...record.services.values()].flatMap((service) => service.child ? [service.child] : []);
  return {
    cwd: record.cwd, found: record.config.found, configError: record.config.configError, status, error: record.error,
    processes: services.map((service) => ({
      ...service.definition, status: service.status, error: service.error, exitCode: service.exitCode,
      pid: service.child?.pid ?? null, configured: configured.has(service.definition.name),
    })),
  };
}
function emit(record: DevRecord, event: ProjectDevEvent): void {
  for (const listener of record.listeners) listener(event);
}
function emitState(record: DevRecord): void { emit(record, { type: "state", info: infoOf(record) }); }
function log(record: DevRecord, name: string, stream: ProjectDevLog["stream"], text: string): void {
  const entry = { id: ++record.sequence, process: name, stream, text: text.slice(-MAX_LOG_SIZE / 2) };
  record.logs.push(entry);
  record.logSize += entry.text.length;
  while (record.logSize > MAX_LOG_SIZE || record.logs.length > MAX_LOG_ENTRIES) record.logSize -= record.logs.shift()!.text.length;
  emit(record, { type: "log", log: entry });
}
export function inspectProjectDev(cwd: string, force = false): ProjectDevInfo {
  const record = recordFor(cwd);
  readConfig(record, force);
  return infoOf(record);
}
export function subscribeProjectDev(cwd: string, listener: (event: ProjectDevEvent) => void): () => void {
  const record = recordFor(cwd);
  readConfig(record, true);
  record.listeners.add(listener);
  listener({ type: "snapshot", info: infoOf(record), logs: [...record.logs] });
  return () => { record.listeners.delete(listener); };
}
function groupAlive(child: ManagedProcess): boolean {
  if (process.platform === "win32") return !child.closed;
  if (!child.pid) return !child.closed;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
async function groupsHaveLiveMembers(children: ManagedProcess[]): Promise<boolean> {
  if (process.platform === "win32") return children.some(groupAlive);
  const groups = new Set(children.flatMap((child) => child.pid ? [child.pid] : []));
  if (!groups.size) return children.some((child) => !child.closed);
  try {
    // Orphan zombies visible to kill(group, 0) cannot keep a service alive.
    const { stdout } = await promisify(execFile)("ps", ["-eo", "pgid=,stat="], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.split("\n").some((line) => {
      const match = /^\s*(\d+)\s+(\S+)/.exec(line);
      return match !== null && groups.has(Number(match[1])) && !match[2].startsWith("Z");
    });
  } catch { return true; }
}
async function waitForExit(children: ManagedProcess[], timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (children.some(groupAlive)) {
    if (Date.now() >= deadline) return !await groupsHaveLiveMembers(children);
    await delay(40);
  }
  return true;
}
async function stopService(service: ServiceRecord): Promise<void> {
  const child = service.child;
  if (!child) return;
  signalChild(child, false);
  if (!await waitForExit([child], 3000)) {
    signalChild(child, true);
    if (!await waitForExit([child], 2000)) throw new Error(`${service.definition.name}: process tree did not exit; restart was cancelled`);
  }
  if (service.child === child) service.child = undefined;
}
function childEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PI_WEB_PASSWORD") delete env[key];
  return env;
}
function attachProcess(record: DevRecord, service: ServiceRecord, managed: ManagedProcess): void {
  const child = managed.child;
  for (const event of ["error", "exit", "close"]) child.removeAllListeners(event);
  child.stdout?.removeAllListeners("data");
  child.stderr?.removeAllListeners("data");
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (text: string) => log(record, managed.name, "stdout", text));
  child.stderr?.on("data", (text: string) => log(record, managed.name, "stderr", text));
  const failed = (message: string, code: number | null) => {
    if (service.child !== managed || (service.status !== "running" && service.status !== "starting")) return;
    service.error = message;
    service.exitCode = code;
    service.status = "stopping";
    emitState(record);
    void serializeByKey(LOCKS, keyOf(record.cwd), async () => {
      // A newer start/stop may already have replaced this generation.
      if (service.child !== managed) return;
      try { await stopService(service); }
      catch (error) { service.error += `; ${error instanceof Error ? error.message : String(error)}`; }
      service.status = "error";
      emitState(record);
    });
  };
  child.on("error", (error) => {
    log(record, managed.name, "system", `${error.message}\n`);
    failed(`${managed.name}: ${error.message}`, null);
  });
  child.on("exit", (code, signal) => {
    log(record, managed.name, "system", `Exited (${signal ?? code ?? "unknown"})\n`);
    failed(`${managed.name} exited (${signal ?? code ?? "unknown"})`, code);
  });
  child.on("close", () => { managed.closed = true; });
}
function startService(record: DevRecord, service: ServiceRecord): void {
  const { name, command } = service.definition;
  const child = process.platform === "win32"
    ? spawn(command, { cwd: record.cwd, shell: process.env.ComSpec || "cmd.exe", env: childEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("/bin/sh", ["-c", command], { cwd: record.cwd, detached: true, env: childEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  const managed: ManagedProcess = { child, name, pid: child.pid, closed: false };
  service.child = managed;
  service.error = null;
  service.exitCode = null;
  attachProcess(record, service, managed);
  log(record, name, "system", `$ ${command}\n`);
  service.status = "running";
}

/** An omitted name controls all services; a name controls just that entry. */
export function controlProjectDev(cwd: string, action: ProjectDevAction, name?: string): Promise<ProjectDevInfo> {
  return serializeByKey(LOCKS, keyOf(cwd), async () => {
    if (store().shuttingDown) throw new Error("Pi Web is shutting down");
    const record = recordFor(cwd);
    if (action !== "stop") {
      readConfig(record, true);
      if (!record.config.found) throw new Error("Procfile.dev not found");
      if (record.config.configError) throw new Error(record.config.configError);
      if (name !== undefined && !record.config.processes.some((item) => item.name === name)) throw new Error(`Unknown development service: ${name}`);
    }
    const services = name !== undefined
      ? [record.services.get(name)].filter((service): service is ServiceRecord => Boolean(service))
      : action === "stop" || action === "restart" ? [...record.services.values()]
        : record.config.processes.map((item) => record.services.get(item.name)!);
    if (name !== undefined && !services.length) throw new Error(`Unknown development service: ${name}`);
    const targets = action === "start" ? services.filter((service) => !projectDevActive(service.status)) : services;
    for (const service of targets) service.status = action === "restart" ? "restarting" : action === "stop" ? "stopping" : "starting";
    emitState(record);
    const results = await Promise.allSettled(targets.map(async (service) => {
      try {
        await stopService(service);
        if (action === "stop" || !record.config.processes.some((item) => item.name === service.definition.name)) {
          service.status = "stopped";
          service.error = null;
          service.exitCode = null;
        } else startService(record, service);
      } catch (error) {
        service.error = error instanceof Error ? error.message : String(error);
        service.status = "stopping";
        try { await stopService(service); } catch { /* keep the child registered for another Stop */ }
        service.status = "error";
        throw error;
      }
    }));
    emitState(record);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    return infoOf(record);
  });
}
