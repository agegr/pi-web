import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { controlProjectDev, inspectProjectDev, projectDevPath, subscribeProjectDev } = await jiti.import("./project-dev-manager.ts");
const fixture = fileURLToPath(new URL("./__fixtures__/project-dev-process.mjs", import.meta.url));
const quote = (value) => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`;
const command = (mode) => `${quote(process.execPath)} ${quote(fixture)} ${mode}`;

function workspace(t, source) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pi-project-dev-")));
  writeFileSync(join(cwd, "Procfile.dev"), source);
  t.after(async () => {
    await controlProjectDev(cwd, "stop");
    rmSync(cwd, { recursive: true, force: true });
  });
  return cwd;
}
async function until(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "condition timed out");
    await delay(30);
  }
}
function reachable(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}
function collect(cwd) {
  let events = [];
  const unsubscribe = subscribeProjectDev(cwd, (event) => events.push(event));
  return { events, unsubscribe, text: () => events.flatMap((event) => event.type === "snapshot" ? event.logs : event.type === "log" ? [event.log] : []).map((entry) => entry.text).join("") };
}

test("inspection never executes Procfile commands and canonical paths resolve aliases", async (t) => {
  const cwd = workspace(t, "web: echo should-not-run");
  assert.equal(inspectProjectDev(cwd).status, "stopped");
  assert.equal(inspectProjectDev(cwd).found, true);
  const alias = `${cwd}-link`;
  symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
  t.after(() => rmSync(alias, { force: true }));
  assert.equal(projectDevPath(alias), cwd);
  const replay = collect(cwd);
  assert.deepEqual(replay.events[0].logs, []);
  replay.unsubscribe();
});

test("concurrent starts reuse one process group, logs replay after disconnect, restart frees descendant ports", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const cwd = workspace(t, `web: ${command("parent")}\nworker: ${command("idle")}`);
  const first = collect(cwd);
  t.after(first.unsubscribe);
  const oldPassword = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "must-not-reach-child";
  t.after(() => { if (oldPassword === undefined) delete process.env.PI_WEB_PASSWORD; else process.env.PI_WEB_PASSWORD = oldPassword; });
  await Promise.all([controlProjectDev(cwd, "start"), controlProjectDev(cwd, "start")]);
  await until(() => first.text().includes("password:absent"));
  assert.equal((first.text().match(/parent:/g) ?? []).length, 1);
  assert.ok(first.text().includes("stderr:ready"));
  const oldPort = Number(readFileSync(join(cwd, "port.txt"), "utf8"));
  assert.ok(await reachable(oldPort));
  first.unsubscribe();
  assert.equal(inspectProjectDev(cwd).status, "running");
  const replay = collect(cwd);
  t.after(replay.unsubscribe);
  assert.ok(replay.text().includes("password:absent"));
  assert.equal(replay.events[0].type, "snapshot");
  await controlProjectDev(cwd, "restart");
  assert.equal(await reachable(oldPort), false);
  await until(() => Number(readFileSync(join(cwd, "port.txt"), "utf8")) !== oldPort);
  const newPort = Number(readFileSync(join(cwd, "port.txt"), "utf8"));
  assert.ok(await reachable(newPort));
  await controlProjectDev(cwd, "stop");
  assert.equal(await reachable(newPort), false);
  assert.equal(inspectProjectDev(cwd).status, "stopped");
});

test("invalid replacement config leaves the running process alive", async (t) => {
  const cwd = workspace(t, `web: ${command("server")}`);
  const events = collect(cwd);
  t.after(events.unsubscribe);
  await controlProjectDev(cwd, "start");
  await until(() => events.text().includes("listening:"));
  const port = Number(readFileSync(join(cwd, "port.txt"), "utf8"));
  writeFileSync(join(cwd, "Procfile.dev"), "web:");
  await assert.rejects(controlProjectDev(cwd, "restart"), /line 1/);
  assert.equal(inspectProjectDev(cwd).status, "running");
  assert.ok(await reachable(port));
  await controlProjectDev(cwd, "stop");
  assert.equal(await reachable(port), false);
});

test("a process exiting reports its own error while siblings keep running", { timeout: 15_000 }, async (t) => {
  const cwd = workspace(t, `worker: ${command("server")}\nweb: ${quote(process.execPath)} -e "setTimeout(() => process.exit(7), 500)"`);
  const events = collect(cwd);
  t.after(events.unsubscribe);
  await controlProjectDev(cwd, "start");
  await until(() => inspectProjectDev(cwd).processes.find((item) => item.name === "web")?.status === "error");
  const info = inspectProjectDev(cwd);
  assert.equal(info.status, "running");
  assert.match(info.processes.find((item) => item.name === "web").error, /web exited \(7\)/);
  assert.equal(info.processes.find((item) => item.name === "web").exitCode, 7);
  const port = Number(readFileSync(join(cwd, "port.txt"), "utf8"));
  assert.ok(await reachable(port));
  await controlProjectDev(cwd, "stop", "web");
  assert.ok(await reachable(port), "stopping the failed service leaves its sibling running");
});

test("stopping escalates when a process ignores SIGTERM", { skip: process.platform === "win32", timeout: 12_000 }, async (t) => {
  const cwd = workspace(t, `web: exec ${command("ignore")}`);
  const events = collect(cwd);
  t.after(events.unsubscribe);
  await controlProjectDev(cwd, "start");
  await until(() => events.text().includes("ignoring-term"));
  await controlProjectDev(cwd, "stop");
  assert.equal(inspectProjectDev(cwd).status, "stopped");
});

test("individual start, restart and stop preserve the other service and its port", { timeout: 20_000 }, async (t) => {
  const cwd = workspace(t, `web: ${command("parent")} web-port.txt\nworker: ${command("server")} worker-port.txt`);
  await controlProjectDev(cwd, "start", "web");
  await until(() => existsSync(join(cwd, "web-port.txt")));
  let info = inspectProjectDev(cwd);
  assert.equal(info.processes.find((item) => item.name === "web").status, "running");
  assert.equal(info.processes.find((item) => item.name === "worker").status, "stopped");
  const firstWebPort = Number(readFileSync(join(cwd, "web-port.txt"), "utf8"));
  const firstWebPid = info.processes.find((item) => item.name === "web").pid;
  await controlProjectDev(cwd, "start", "worker");
  await until(() => existsSync(join(cwd, "worker-port.txt")));
  info = inspectProjectDev(cwd);
  const workerPid = info.processes.find((item) => item.name === "worker").pid;
  const workerPort = Number(readFileSync(join(cwd, "worker-port.txt"), "utf8"));
  assert.equal(info.processes.find((item) => item.name === "web").pid, firstWebPid);
  await controlProjectDev(cwd, "restart", "web");
  await until(() => Number(readFileSync(join(cwd, "web-port.txt"), "utf8")) !== firstWebPort);
  const secondWebPort = Number(readFileSync(join(cwd, "web-port.txt"), "utf8"));
  info = inspectProjectDev(cwd);
  assert.equal(await reachable(firstWebPort), false);
  assert.ok(await reachable(secondWebPort));
  assert.ok(await reachable(workerPort));
  assert.equal(info.processes.find((item) => item.name === "worker").pid, workerPid);
  await assert.rejects(controlProjectDev(cwd, "restart", "unknown"), /Unknown development service/);
  assert.ok(await reachable(secondWebPort));
  await controlProjectDev(cwd, "stop", "worker");
  assert.equal(await reachable(workerPort), false);
  assert.ok(await reachable(secondWebPort));
  const snapshot = collect(cwd);
  assert.equal(snapshot.events[0].info.processes.find((item) => item.name === "worker").status, "stopped");
  snapshot.unsubscribe();
});

test("a removed running service remains visible and can be stopped individually", async (t) => {
  const cwd = workspace(t, `web: ${command("server")}`);
  const events = collect(cwd);
  t.after(events.unsubscribe);
  await controlProjectDev(cwd, "start", "web");
  await until(() => events.text().includes("listening:"));
  const port = Number(readFileSync(join(cwd, "port.txt"), "utf8"));
  writeFileSync(join(cwd, "Procfile.dev"), `worker: ${command("idle")}`);
  const info = inspectProjectDev(cwd, true);
  const removed = info.processes.find((item) => item.name === "web");
  assert.equal(removed.configured, false);
  assert.equal(removed.status, "running");
  await assert.rejects(controlProjectDev(cwd, "restart", "web"), /Unknown development service/);
  assert.ok(await reachable(port));
  await controlProjectDev(cwd, "stop", "web");
  assert.equal(await reachable(port), false);
});

test("large output has a bounded replay buffer", async (t) => {
  const cwd = workspace(t, `web: ${command("flood")}`);
  const events = collect(cwd);
  t.after(events.unsubscribe);
  await controlProjectDev(cwd, "start");
  await until(() => events.text().includes("xxxxx"));
  await delay(100);
  const replay = collect(cwd);
  t.after(replay.unsubscribe);
  assert.ok(replay.events[0].logs.reduce((size, log) => size + log.text.length, 0) <= 256 * 1024);
});
