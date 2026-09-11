import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./initial-navigation.ts");
}

test("uses cwd instead of session when both parameters are present", async () => {
  const { getInitialNavigation } = await loadSubject();
  const result = getInitialNavigation(
    new URLSearchParams({
      cwd: " /work/project ",
      session: "saved-session",
    }),
  );

  assert.deepEqual(result, {
    requestedCwd: "/work/project",
    sessionId: null,
    sidebarCollapsed: false,
  });
});

test("restores session when cwd is absent", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(new URLSearchParams({ session: "saved-session" })),
    { requestedCwd: null, sessionId: "saved-session", sidebarCollapsed: false },
  );
});

test("treats an empty cwd as absent", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(
      new URLSearchParams({ cwd: "  ", session: "saved-session" }),
    ),
    { requestedCwd: null, sessionId: "saved-session", sidebarCollapsed: false },
  );
});

test("preserves a URL-encoded Windows path", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(new URLSearchParams("cwd=C%3A%5CProjects%5Cpi-web")),
    {
      requestedCwd: "C:\\Projects\\pi-web",
      sessionId: null,
      sidebarCollapsed: false,
    },
  );
});

test("keeps the sidebar open when no sidebar parameter is present", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(getInitialNavigation(new URLSearchParams()), {
    requestedCwd: null,
    sessionId: null,
    sidebarCollapsed: false,
  });
});

test("collapses the sidebar for sidebar=collapsed", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(new URLSearchParams({ sidebar: "collapsed" })),
    {
      requestedCwd: null,
      sessionId: null,
      sidebarCollapsed: true,
    },
  );
});

test("collapses the sidebar when combined with a cwd parameter", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(
      new URLSearchParams({ cwd: "/work/project", sidebar: "collapsed" }),
    ),
    {
      requestedCwd: "/work/project",
      sessionId: null,
      sidebarCollapsed: true,
    },
  );
});

test("collapses the sidebar when combined with a session parameter", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(
      new URLSearchParams({ session: "saved-session", sidebar: "collapsed" }),
    ),
    {
      requestedCwd: null,
      sessionId: "saved-session",
      sidebarCollapsed: true,
    },
  );
});

test("ignores any other sidebar value", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(new URLSearchParams({ sidebar: "expanded" })),
    {
      requestedCwd: null,
      sessionId: null,
      sidebarCollapsed: false,
    },
  );
});

test("parses a URL-encoded sidebar parameter", async () => {
  const { getInitialNavigation } = await loadSubject();

  assert.deepEqual(
    getInitialNavigation(new URLSearchParams("sidebar=collapsed%20")),
    {
      requestedCwd: null,
      sessionId: null,
      sidebarCollapsed: false,
    },
  );
});
