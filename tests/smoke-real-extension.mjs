// Lightweight protocol smoke against the DEVELOPMENT pi-subagents source.
//
// Starts Pi Web with an isolated agent dir whose extensions directory
// symlinks the pi-subagents source worktree, then verifies the real bridge
// advertises runStatus v1 and answers status with a bounded runs projection
// that never leaks private handles.
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const SUBAGENTS_WORKTREE = "/Users/kale/.local/share/pi-worktrees/pi-subagents/visual-run-status";
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-smoke-agent-"));
const projectDir = mkdtempSync(join(tmpdir(), "pi-web-smoke-project-"));
const sessionsDir = join(agentDir, "sessions", "smoke");
mkdirSync(sessionsDir, { recursive: true });
mkdirSync(join(agentDir, "extensions"), { recursive: true });
symlinkSync(SUBAGENTS_WORKTREE, join(agentDir, "extensions", "pi-subagents"));

const root = SessionManager.create(projectDir, sessionsDir, { id: "smoke-root" });
root.appendSessionInfo("Smoke root");
root.appendMessage({ role: "user", content: "Smoke", timestamp: Date.now() });
root.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ok" }], timestamp: Date.now() });

const server = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "dev",
  "--configLoader", "runner", "--config", "vite.tanstack.config.ts",
  "--host", "127.0.0.1", "--port", "31751", "--strictPort",
], {
  cwd: process.cwd(),
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let booted = false;
server.stdout.on("data", (c) => { output += String(c); const m = output.replace(/\u001b\[[0-9;]*m/g, "").match(/Local:\s+(\S+)/); if (m && !booted) { booted = true; void run(m[1]); } });
server.stderr.on("data", (c) => { output += String(c); });
server.on("exit", (code) => { if (!booted) { console.error("server exited", code, output.slice(0, 1000)); process.exit(1); } });

async function run(origin) {
  let failed = false;
  const check = (label, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed = true;
  };
  try {
    // Start the root wrapper (like the tree GET does) and wait for extension binding.
    const tree = await fetch(`${origin}/api/agent/smoke-root/subagents`);
    check("GET subagents status", tree.status === 200, `HTTP ${tree.status}`);
    const body = await tree.json();
    check("rpcAvailable from real bridge", body.rpcAvailable === true, JSON.stringify(body.unavailableReason ?? ""));
    check("runStatus v1 projection present", Array.isArray(body.nodes), `nodes=${body.nodes.length}`);
    const serialized = JSON.stringify(body);
    for (const secret of ["asyncDir", "sessionFile", "transcriptPath", "capabilityToken", "controlInbox", "intercomTarget"]) {
      check(`no ${secret} leaked`, !serialized.includes(secret));
    }
  } catch (error) {
    check("smoke completed", false, String(error));
  }
  server.kill();
  process.exit(failed ? 1 : 0);
}
setTimeout(() => { console.error("smoke timed out"); server.kill(); process.exit(1); }, 120_000);
