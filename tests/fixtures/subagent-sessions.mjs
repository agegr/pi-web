// Deterministic e2e fixture for the visual subagent sessions feature.
//
// The fixture owns:
// - a temporary PI_CODING_AGENT_DIR with a fake global extension that answers
//   the subagent RPC v1 protocol over pi.events;
// - a temporary project with root/child/grandchild session JSONL files;
// - a state file the test flips between running/paused/completed/incompatible;
// - a control log written by the fake extension.
//
// It never writes .pi-subagents/status.json or events.jsonl and never parses
// terminal output.
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const FAKE_ROOT_ID = "e2e-root-session";
export const FAKE_CHILD_ID = "e2e-child-session";
export const FAKE_GRAND_ID = "e2e-grand-session";

export function createSubagentFixture() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-agent-"));
  const projectDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-project-"));
  const statePath = join(projectDir, ".fake-subagents-state.json");
  const logPath = join(projectDir, ".fake-subagents-control.log");
  const sessionsDir = join(agentDir, "sessions", "project");
  const extensionsDir = join(agentDir, "extensions");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });

  const writeState = (state) => {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  };
  writeState({ mode: "running" });

  // Root/child/grandchild sessions with official subagent names so the web
  // session-relations classifier recognizes the children.
  const root = SessionManager.create(projectDir, sessionsDir, { id: FAKE_ROOT_ID });
  root.appendSessionInfo("Main e2e task");
  root.appendMessage({ role: "user", content: "Investigate the e2e fixture", timestamp: Date.now() });
  root.appendMessage({ role: "assistant", content: [{ type: "text", text: "I will delegate this work." }], timestamp: Date.now() });

  const child = SessionManager.create(projectDir, sessionsDir, { id: FAKE_CHILD_ID, parentSession: root.getSessionFile() });
  child.appendSessionInfo("subagent-worker-317e1ca0-1");
  child.appendMessage({ role: "user", content: "Implement the fixture worker", timestamp: Date.now() });
  child.appendMessage({ role: "assistant", content: [{ type: "text", text: "Implementing now." }], timestamp: Date.now() });

  const grand = SessionManager.create(projectDir, sessionsDir, { id: FAKE_GRAND_ID, parentSession: child.getSessionFile() });
  grand.appendSessionInfo("subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2");
  grand.appendMessage({ role: "user", content: "Review the worker output", timestamp: Date.now() });
  grand.appendMessage({ role: "assistant", content: [{ type: "text", text: "Reviewing now." }], timestamp: Date.now() });

  for (const id of [FAKE_ROOT_ID, FAKE_CHILD_ID, FAKE_GRAND_ID]) {
    const files = readdirSync(sessionsDir).filter((name) => name.endsWith(`_${id}.jsonl`));
    if (files.length !== 1) {
      throw new Error(`fixture session file was not flushed for ${id}: ${JSON.stringify(files)}`);
    }
  }

  const extensionSource = `export default async function fakeSubagentsBridge(pi) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const REQUEST = "subagents:rpc:v1:request";
  const REPLY = "subagents:rpc:v1:reply:";
  const statePath = ${JSON.stringify(statePath)};
  const logPath = ${JSON.stringify(logPath)};
  const readState = () => {
    try { return JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { return { mode: "running" }; }
  };
  const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

  pi.events.on(REQUEST, (raw) => {
    const reply = (data, error) => {
      pi.events.emit(REPLY + raw.requestId, {
        version: 1,
        requestId: raw.requestId,
        method: raw.method,
        success: !error,
        ...(error ? { error } : { data }),
      });
    };
    if (raw.method === "ping") {
      const state = readState();
      const capabilities = { status: true, fleetStatus: { version: 1 } };
      if (state.mode !== "incompatible") capabilities.runStatus = { version: 1 };
      reply({ version: 1, methods: ["ping", "status", "steer", "interrupt", "resume"], capabilities });
      return;
    }
    if (raw.method === "status") {
      const state = readState();
      const entries = state.entries ?? [];
      reply({ runs: { version: 1, entries, total: entries.length, omitted: 0 } });
      return;
    }
    if (raw.method === "steer" || raw.method === "resume" || raw.method === "interrupt") {
      const state = readState();
      fs.appendFileSync(logPath, JSON.stringify({ method: raw.method, params: raw.params, at: Date.now() }) + "\\n", "utf8");
      if (state.mode === "reject-steer" && raw.method === "steer") {
        reply({ ok: false }, { code: "execution_failed", message: "steer rejected by fixture" });
        return;
      }
      if (raw.method === "steer" || raw.method === "resume") {
        state.mode = "running";
      } else {
        state.mode = "paused";
      }
      if (state.entries) {
        state.entries = state.entries.map((entry) => ({ ...entry, state: state.mode === "paused" ? "paused" : "running" }));
      }
      writeState(state);
      reply({ ok: true });
      return;
    }
    reply({ ok: false }, { code: "unsupported_method", message: "Unsupported method: " + raw.method });
  });
};
`;
  writeFileSync(join(extensionsDir, "fake-subagents.ts"), extensionSource, "utf8");

  const setState = (state) => writeState(state);
  const readLog = () => {
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  };
  const sessionFilePath = (id) => {
    const name = readdirSync(sessionsDir).find((file) => file.endsWith(`_${id}.jsonl`));
    if (!name) throw new Error(`fixture session file missing for ${id}`);
    return join(sessionsDir, name);
  };

  return { agentDir, projectDir, statePath, logPath, setState, readLog, sessionsDir, sessionFilePath };
}

/** Entry shapes the fake extension serves for the fixture sessions. */
export function liveEntries({ mode, startedAt = Date.now() - 60_000 }) {
  const workerState = mode === "paused" ? "paused" : "running";
  return [
    {
      runId: "317e1ca0",
      index: 1,
      agent: "worker",
      state: workerState,
      activityState: mode === "paused" ? undefined : "active_long_running",
      currentTool: "bash",
      currentPath: "/repo",
      startedAt,
      lastActivityAt: startedAt + 100,
      updatedAt: startedAt + 100,
    },
    {
      runId: "76fa6d64-6031-4824-8a88-1282c22d9afa",
      index: 2,
      agent: "reviewer",
      state: mode === "completed" ? "complete" : "running",
      startedAt: startedAt + 50,
      updatedAt: startedAt + 60,
    },
  ];
}
