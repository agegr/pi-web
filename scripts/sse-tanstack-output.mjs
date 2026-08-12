import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

const outputDir = (process.argv[2] || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
const serverEntry = join(outputDir, "server", "index.mjs");
assert.ok(existsSync(serverEntry), `server entry missing: ${serverEntry}`);

const port = Number(process.env.PI_WEB_TANSTACK_SMOKE_PORT || 30147);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [serverEntry], {
  cwd: outputDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    PI_WEB_HOSTNAME: "127.0.0.1",
  },
});

let logs = "";
child.stdout.on("data", (chunk) => { logs += chunk; process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { logs += chunk; process.stderr.write(chunk); });

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/sessions`);
      if (response.status === 200) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${origin}\n${logs}`);
}

let sawConnected = false;
let heartbeatCount = 0;
let elapsedMs = 0;

try {
  const sessionsResponse = await waitForReady();
  const { sessions } = await sessionsResponse.json();
  const candidate = Array.isArray(sessions)
    ? sessions.find((session) => session && typeof session.id === "string" && !session.transient)
    : undefined;
  assert.ok(candidate, "no persisted local Pi session available for the SSE gate");

  const controller = new AbortController();
  const eventsResponse = await fetch(
    `${origin}/api/agent/${encodeURIComponent(candidate.id)}/events`,
    { signal: controller.signal },
  );
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsResponse.headers.get("content-type"), "text/event-stream");
  assert.equal(eventsResponse.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(eventsResponse.headers.get("connection"), "keep-alive");
  assert.equal(eventsResponse.headers.get("x-accel-buffering"), "no");

  const reader = eventsResponse.body.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  let buffer = "";

  while (elapsedMs < 310_000) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line === ":") {
        heartbeatCount += 1;
      } else if (line.startsWith("data:") && line.includes('"type":"connected"')) {
        sawConnected = true;
      }
    }
    elapsedMs = Date.now() - started;
  }

  controller.abort();
  await reader.cancel().catch(() => {});
  console.log(JSON.stringify({ elapsedMs, heartbeatCount, sawConnected }));

  assert.ok(elapsedMs >= 310_000, `SSE ended after ${elapsedMs}ms`);
  assert.ok(sawConnected, "connected frame was not observed");
  assert.ok(heartbeatCount >= 10, `only ${heartbeatCount} heartbeats were observed`);
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
