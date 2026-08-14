import { defineConfig } from "@playwright/test";
import { createTrajectoryFixture } from "./e2e/fixtures/trajectory-session";

// One isolated fixture per config load: a temp agent dir, one session with a
// trajectory sidecar, and a child session for subagent expansion.
const fixture = createTrajectoryFixture();
process.env.E2E_SESSION_ID = fixture.sessionId;
process.env.E2E_CHILD_SESSION_ID = fixture.childSessionId;

// The dev server inherits the host environment; drop web-auth overrides so
// the fixture app is reachable without a password on 127.0.0.1.
delete process.env.PI_WEB_PASSWORD;
delete process.env.PI_WEB_HOSTNAME;
delete process.env.PI_WEB_ALLOWED_HOSTS;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: fixture.appUrl,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: [
      `PI_CODING_AGENT_DIR=${fixture.agentDir}`,
      "node_modules/.bin/vite",
      "dev",
      "--configLoader",
      "runner",
      "--config",
      "vite.tanstack.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(fixture.port),
      "--strictPort",
    ].join(" "),
    url: fixture.appUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
