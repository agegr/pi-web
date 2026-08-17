import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile(new URL("./Dashboard.tsx", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../SessionSidebar.tsx", import.meta.url), "utf8");

test("dashboard round trips preserve the selected session or fresh cwd", () => {
  assert.match(
    sidebarSource,
    /pathname: "\/dashboard",\s*query: selectedSessionId\s*\? \{ session: selectedSessionId \}\s*: selectedCwd\s*\? \{ cwd: selectedCwd \}/,
  );
  assert.match(
    dashboardSource,
    /const \{ sessionId, requestedCwd: cwd \} = getInitialNavigation\(searchParams\)/,
  );
  assert.match(
    dashboardSource,
    /pathname: "\/",\s*query: sessionId\s*\? \{ session: sessionId \}\s*: cwd\s*\? \{ cwd \}/,
  );
});
