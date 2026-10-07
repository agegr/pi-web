// An MCP stdio server that never answers, for tests that a connection is
// stopped on time. It reads stdin and ignores every message, stays alive
// after stdin closes, and with PI_WEB_FIXTURE_IGNORE_TERM set ignores SIGTERM
// too, so only SIGKILL ends it. It writes its pid to PI_WEB_FIXTURE_PID_FILE
// and a line to stderr, so a test can check the process and its stderr tail.
//
// It still ends by itself, so a test run that is interrupted (Ctrl-C, a CI
// step timeout) never leaves it running: pi-mcp spawns it in its own process
// group, which a Ctrl-C does not reach, and the SDK's SIGKILL timer dies with
// the test process. It exits once its parent is gone (it is re-parented) or
// after 30 s, far past the 2.5 s SIGKILL the tests check for.
import { writeFileSync } from "node:fs";

// Read before the pid file is written: a parent that waits for that file may be gone right after.
const parent = process.ppid;
const started = Date.now();
if (process.env.PI_WEB_FIXTURE_PID_FILE) writeFileSync(process.env.PI_WEB_FIXTURE_PID_FILE, String(process.pid));
if (process.env.PI_WEB_FIXTURE_IGNORE_TERM) process.on("SIGTERM", () => {});
process.stderr.write("hang fixture waiting\n");
process.stdin.on("data", () => {});
process.stdin.on("end", () => {});
setInterval(() => {
  if (process.ppid !== parent || Date.now() - started > 30_000) process.exit(0);
}, 200);
