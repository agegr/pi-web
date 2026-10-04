import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MCP_INACTIVE_HOSTS_MAX,
  MCP_STATUS_MAX_RECORDS,
  clearMcpStatuses,
  forgetMcpHostInactive,
  forgetMcpStatus,
  isCurrentMcpStatus,
  mcpStatusCount,
  mcpStatusKey,
  readMcpHostInactive,
  readMcpStatus,
  recordMcpHostInactive,
  recordMcpStatus,
  replaceMcpStatus,
  withMcpStatuses,
} = await jiti.import("./mcp-status.ts");

beforeEach(() => clearMcpStatuses());

const GLOBAL = "/home/u/.pi/agent/mcp.json";
const PROJECT_A = "/work/a/.pi/mcp.json";
const PROJECT_B = "/work/b/.pi/mcp.json";

function status(state = "connected", extra = {}) {
  return { origin: "test", state, tools: [], toolCount: 0, durationMs: 5, testedAt: 1, ...extra };
}

function info(scope, sourcePath, name, configKey) {
  return { name, scope, sourcePath, configKey, enabled: true, validated: true, envNames: [], headerNames: [], usesOAuth: false, commandFields: [], variableReferences: [], masked: false };
}

test("a status is keyed by scope, file and name, so same-named entries never share one", () => {
  assert.equal(mcpStatusKey({ scope: "global", sourcePath: GLOBAL, name: "docs" }), `global\0${GLOBAL}\0docs`);
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "docs" }, "k1", status("connected"));
  recordMcpStatus({ scope: "project", sourcePath: PROJECT_A, name: "docs" }, "k2", status("failed"));
  recordMcpStatus({ scope: "project", sourcePath: PROJECT_B, name: "docs" }, "k3", status("needs-auth"));
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "docs" }, "k1").state, "connected");
  assert.equal(readMcpStatus({ scope: "project", sourcePath: PROJECT_A, name: "docs" }, "k2").state, "failed");
  assert.equal(readMcpStatus({ scope: "project", sourcePath: PROJECT_B, name: "docs" }, "k3").state, "needs-auth");
  // A later record for an entry replaces its earlier one.
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "docs" }, "k1", status("failed"));
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "docs" }, "k1").state, "failed");
  assert.equal(mcpStatusCount(), 3);
});

test("a status recorded for other content is stale: dropped, and not back when the entry is changed back", () => {
  const entry = { scope: "global", sourcePath: GLOBAL, name: "docs" };
  recordMcpStatus(entry, "before-edit", status());
  assert.equal(readMcpStatus(entry, "after-edit"), undefined);
  assert.equal(mcpStatusCount(), 0);
  assert.equal(readMcpStatus(entry, "before-edit"), undefined);
});

test("the listing gets each server's current status, and a read file's vanished names lose theirs", () => {
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "docs" }, "docs-key", status("connected"));
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "gone" }, "gone-key", status("failed"));
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "edited" }, "old-key", status("failed"));
  recordMcpStatus({ scope: "project", sourcePath: PROJECT_B, name: "other" }, "other-key", status("connected"));
  const servers = withMcpStatuses(
    [info("global", GLOBAL, "docs", "docs-key"), info("global", GLOBAL, "edited", "new-key"), info("global", GLOBAL, "fresh", "fresh-key")],
    [{ scope: "global", path: GLOBAL }],
  );
  assert.deepEqual(servers.map((server) => [server.name, server.status?.state]), [["docs", "connected"], ["edited", undefined], ["fresh", undefined]]);
  // The global file was read: "gone" is no longer in it, and "edited" changed. Project B's file was
  // not read here, so its record stays for the panel that shows that project.
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "gone" }, "gone-key"), undefined);
  assert.equal(readMcpStatus({ scope: "project", sourcePath: PROJECT_B, name: "other" }, "other-key").state, "connected");
  assert.equal(mcpStatusCount(), 2);
  // The input is not changed.
  const plain = info("global", GLOBAL, "docs", "docs-key");
  withMcpStatuses([plain], []);
  assert.equal(plain.status, undefined);
});

test("the store is bounded, dropping the entry written longest ago, and lives on globalThis", () => {
  for (let index = 0; index < MCP_STATUS_MAX_RECORDS + 5; index++) {
    recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: `s${index}` }, "k", status());
  }
  assert.equal(mcpStatusCount(), MCP_STATUS_MAX_RECORDS);
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "s0" }, "k"), undefined);
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: `s${MCP_STATUS_MAX_RECORDS + 4}` }, "k").state, "connected");
  // Written again counts as newest.
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "s5" }, "k", status("failed"));
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "extra" }, "k", status());
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "s5" }, "k").state, "failed");
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "s6" }, "k"), undefined);
  // Route handlers are bundled separately and hot reload re-evaluates modules: one map per process.
  // Its name changed with its shape, so a dev server's map from before is never read as this one.
  assert.ok(globalThis[Symbol.for("pi-web:mcp-status:by-config")] instanceof Map);
  assert.equal(globalThis[Symbol.for("pi-web:mcp-status:by-config")].size, mcpStatusCount());

  // Every record counts, also those of one entry for other content.
  clearMcpStatuses();
  const entry = { scope: "global", sourcePath: GLOBAL, name: "docs" };
  for (let index = 0; index < MCP_STATUS_MAX_RECORDS; index++) recordMcpStatus(entry, `k${index}`, status());
  recordMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "other" }, "k", status());
  assert.equal(mcpStatusCount(), MCP_STATUS_MAX_RECORDS);
  assert.equal(readMcpStatus({ scope: "global", sourcePath: GLOBAL, name: "other" }, "k").state, "connected");
});

test("a writer behind the file never replaces the record for the entry as the file holds it", () => {
  const entry = { scope: "global", sourcePath: GLOBAL, name: "docs" };
  // The file holds K2 now, and a test of it connected.
  const tested = status("connected", { testedAt: 2 });
  recordMcpStatus(entry, "K2", tested);
  // A session that synced before the edit still holds K1, and sees that server drop.
  recordMcpStatus(entry, "K1", { origin: "session", state: "disconnected", sessionId: "a", cwd: "/work/a", updatedAt: 3 });
  assert.equal(mcpStatusCount(), 2);
  assert.equal(readMcpStatus(entry, "K2"), tested);
  // The read dropped the record for other content, so an entry changed back still reads untested.
  assert.equal(mcpStatusCount(), 1);
  assert.equal(readMcpStatus(entry, "K1"), undefined);
  assert.equal(mcpStatusCount(), 0);
});

test("a writer forgets only the record it wrote, never one written since", () => {
  const entry = { scope: "global", sourcePath: GLOBAL, name: "docs" };
  const connecting = { origin: "session", state: "connecting", sessionId: "a", cwd: "/work/a", updatedAt: 1 };
  recordMcpStatus(entry, "k", connecting);
  assert.equal(isCurrentMcpStatus(entry, "k", connecting), true);
  assert.equal(isCurrentMcpStatus(entry, "other", connecting), false, "a record is the writer's only for the content it wrote it for");
  // Another session, or a test, reported since: the first session giving up leaves that alone.
  const tested = status("connected");
  recordMcpStatus(entry, "k", tested);
  assert.equal(isCurrentMcpStatus(entry, "k", connecting), false);
  assert.equal(forgetMcpStatus(entry, "k", connecting), false);
  assert.equal(readMcpStatus(entry, "k"), tested);
  assert.equal(forgetMcpStatus(entry, "k", tested), true);
  assert.equal(readMcpStatus(entry, "k"), undefined);
  assert.equal(mcpStatusCount(), 0);

  // Amending works the same way: only the writer's own record, while nobody replaced it.
  const connected = { ...connecting, state: "connected" };
  recordMcpStatus(entry, "k", connected);
  const closed = { ...connected, closedAt: 5 };
  assert.equal(replaceMcpStatus(entry, "k", connected, closed), true);
  assert.equal(readMcpStatus(entry, "k"), closed);
  recordMcpStatus(entry, "k", tested);
  assert.equal(replaceMcpStatus(entry, "k", closed, { ...closed, closedAt: 6 }), false);
  assert.equal(readMcpStatus(entry, "k"), tested);
});

test("sessions whose /mcp is another extension's are held per session, the panel's folder first", () => {
  const a = { owner: "/ext/a.ts", cwd: "/work/a", updatedAt: 1 };
  const b = { owner: "/ext/b.ts", cwd: "/work/b", updatedAt: 2 };
  recordMcpHostInactive("session-a", a);
  recordMcpHostInactive("session-b", b);
  assert.equal(readMcpHostInactive("/work/a"), a);
  assert.equal(readMcpHostInactive("/work/a/"), a, "folders compare as paths");
  // Another folder, or none, hears of the latest, which names its folder.
  assert.equal(readMcpHostInactive("/work/c"), b);
  assert.equal(readMcpHostInactive(), b);
  // Forgetting by identity leaves a record the session wrote since; without one, it goes.
  const again = { ...a, updatedAt: 3 };
  recordMcpHostInactive("session-a", again);
  forgetMcpHostInactive("session-a", a);
  assert.equal(readMcpHostInactive("/work/a"), again);
  forgetMcpHostInactive("session-a");
  assert.equal(readMcpHostInactive("/work/a"), b);
  for (let index = 0; index < MCP_INACTIVE_HOSTS_MAX + 3; index++) {
    recordMcpHostInactive(`s${index}`, { owner: "/ext/x.ts", cwd: `/work/${index}`, updatedAt: 10 + index });
  }
  assert.equal(readMcpHostInactive("/work/b")?.cwd, `/work/${MCP_INACTIVE_HOSTS_MAX + 2}`, "the oldest went first");
  assert.equal(readMcpHostInactive("/work/3")?.cwd, "/work/3");
  clearMcpStatuses();
  assert.equal(readMcpHostInactive(), undefined);
});
