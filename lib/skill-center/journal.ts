import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { requireValue } from "./errors";

export function stateDir() { const dir = join(getAgentDir(), "skill-center"); mkdirSync(dir, { recursive: true }); return dir; }
export function saveJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value), "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
export function readJson<T>(path: string): T | null { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as T : null; }
export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export interface WriteLease { token: string; pid: number; operationId: string | null; childPid?: number }
export function leaseRecord(directory = stateDir()): WriteLease | null {
  const lock = join(directory, "write.lock");
  if (!existsSync(lock)) return null;
  const file = readdirSync(lock).find(f => /^[a-f0-9-]{36}\.json$/.test(f));
  requireValue(file, "BUSY", "写入租约损坏，需要检查服务端状态。", 409);
  return readJson<WriteLease>(join(lock,file));
}
function removeLease(record: WriteLease, directory: string) {
  const lock = join(directory,"write.lock");
  // The token filename prevents a second recovery from removing a newer lease.
  try { unlinkSync(join(lock,`${record.token}.json`)); } catch { return; }
  for (const f of readdirSync(lock)) if (f.startsWith(record.token + ".json.") && f.endsWith(".tmp")) unlinkSync(join(lock,f));
  rmdirSync(lock);
}
export function acquireLease(operationId: string | null, directory = stateDir()) {
  const lock = join(directory, "write.lock");
  const record: WriteLease = { token: randomUUID(), pid: process.pid, operationId };
  const candidate = join(directory,`lease-${record.token}`);
  mkdirSync(candidate);
  saveJson(join(candidate,`${record.token}.json`),record);
  try { renameSync(candidate,lock); }
  catch { unlinkSync(join(candidate,`${record.token}.json`)); rmdirSync(candidate); requireValue(false,"BUSY","另一个技能写入操作正在运行或等待核验，请查看写入状态。",409); }
  return {
    record,
    child(pid: number) { record.childPid = pid; saveJson(join(lock,`${record.token}.json`),record); },
    release() { removeLease(record,directory); },
  };
}
export function releaseDeadLease(operationId: string | null) {
  const current = leaseRecord();
  requireValue(current && current.operationId === operationId && !isProcessAlive(current.pid) && (!current.childPid || !isProcessAlive(current.childPid)), "BUSY", "写入进程仍存活，不能释放租约。",409);
  removeLease(current,stateDir());
}
