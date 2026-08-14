import { defineConfig } from "@playwright/test";

// Self-contained browser coverage for the visual subagent sessions feature.
//
// The suite predates the trajectory e2e config (testDir ./e2e) and lives in
// tests/, spawning its own Vite dev server against an isolated agent dir whose
// fake global extension implements the subagent RPC v1 protocol. Keeping a
// dedicated config preserves that isolation: the default `playwright test`
// stays scoped to ./e2e and does not double-boot servers.
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.e2e\.spec\.mjs/,
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
});
