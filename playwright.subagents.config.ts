import { defineConfig } from "@playwright/test";

// Self-contained browser coverage for visual subagent sessions. The suite
// spawns its own Vite server against an isolated agent directory whose fake
// global extension implements the subagent RPC v1 protocol.
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.e2e\.spec\.mjs/,
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
});
