import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

const outputDir = (process.argv[2] || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
const serverEntry = join(outputDir, "server", "index.mjs");
assert.ok(existsSync(serverEntry), `server entry missing: ${serverEntry}`);

const port = Number(process.env.PI_WEB_TANSTACK_SMOKE_PORT || 30142);
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

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready: ${url}\n${logs}`);
}

try {
  const root = await waitFor(`${origin}/`);
  assert.match(await root.text(), /Pi Web/);
  const sessions = await fetch(`${origin}/api/sessions`);
  assert.equal(sessions.status, 200);
  assert.equal(sessions.headers.get("cache-control"), "no-store");
  const body = await sessions.json();
  assert.ok(Array.isArray(body.sessions));
  assert.ok(Array.isArray(body.runningSessionIds));
  console.log(JSON.stringify({ origin, sessions: body.sessions.length }));
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
