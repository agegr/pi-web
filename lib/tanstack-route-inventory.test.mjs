import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const ROOT = process.cwd();
const jiti = createJiti(import.meta.url, { alias: { "@": ROOT }, moduleCache: false });

const EXPECTED_ROUTES = {
  "app/api/agent/[id]/bash-output/route.ts": ["GET"],
  "app/api/agent/[id]/events/route.ts": ["GET"],
  "app/api/agent/[id]/route.ts": ["GET", "POST"],
  "app/api/agent/[id]/subagents/route.ts": ["GET", "POST"],
  "app/api/agent/new/route.ts": ["POST"],
  "app/api/agent/running/events/route.ts": ["GET"],
  "app/api/agent/running/route.ts": ["GET"],
  "app/api/app-update/route.ts": ["GET"],
  "app/api/auth/all-providers/route.ts": ["GET"],
  "app/api/auth/api-key/[provider]/route.ts": ["DELETE", "GET", "POST"],
  "app/api/auth/login/[provider]/route.ts": ["GET", "POST"],
  "app/api/auth/logout/[provider]/route.ts": ["POST"],
  "app/api/auth/providers/route.ts": ["GET"],
  "app/api/cwd/browse/route.ts": ["GET", "POST"],
  "app/api/cwd/validate/route.ts": ["POST"],
  "app/api/default-cwd/route.ts": ["POST"],
  "app/api/file-index/route.ts": ["GET"],
  "app/api/files/[...path]/route.ts": ["GET", "POST"],
  "app/api/git/diff/route.ts": ["GET"],
  "app/api/git/status/route.ts": ["GET"],
  "app/api/home/route.ts": ["GET"],
  "app/api/models-config/catalog/route.ts": ["GET"],
  "app/api/models-config/discover/route.ts": ["POST"],
  "app/api/models-config/route.ts": ["GET", "PUT"],
  "app/api/models-config/test/route.ts": ["POST"],
  "app/api/models/route.ts": ["GET"],
  "app/api/plugins/route.ts": ["GET", "POST"],
  "app/api/project-trust/route.ts": ["GET", "POST"],
  "app/api/projects/route.ts": ["GET", "PATCH", "PUT"],
  "app/api/remote-access/route.ts": ["GET", "PUT"],
  "app/api/sessions/[id]/auto-name/route.ts": ["POST"],
  "app/api/sessions/[id]/context/route.ts": ["GET"],
  "app/api/sessions/[id]/entries/[entryId]/thinking/route.ts": ["GET"],
  "app/api/sessions/[id]/entries/[entryId]/tool-result/route.ts": ["GET"],
  "app/api/sessions/[id]/export/route.ts": ["GET"],
  "app/api/sessions/[id]/route.ts": ["DELETE", "GET", "PATCH"],
  "app/api/sessions/[id]/state/route.ts": ["GET"],
  "app/api/sessions/route.ts": ["GET"],
  "app/api/skills/check/route.ts": ["POST"],
  "app/api/skills/install/route.ts": ["POST"],
  "app/api/skills/route.ts": ["GET", "PATCH"],
  "app/api/skills/search/route.ts": ["POST"],
  "app/api/skills/update/route.ts": ["POST"],
  "app/api/ui-locale/route.ts": ["GET", "PUT"],
  "app/api/vision-toolkit/health/route.ts": ["POST"],
  "app/api/vision-toolkit/reveal/route.ts": ["POST"],
  "app/api/vision-toolkit/route.ts": ["GET", "PUT"],
  "app/api/worktrees/route.ts": ["DELETE", "GET", "POST"],
};

const EXPECTED_ADAPTERS = {
  "src/routes/api/agent/$id/bash-output.ts": { route: "/api/agent/$id/bash-output", methods: ["GET"] },
  "src/routes/api/agent/$id/events.ts": { route: "/api/agent/$id/events", methods: ["GET"] },
  "src/routes/api/agent/$id/subagents.ts": { route: "/api/agent/$id/subagents", methods: ["GET", "POST"] },
  "src/routes/api/agent/$id.ts": { route: "/api/agent/$id", methods: ["GET", "POST"] },
  "src/routes/api/agent/new.ts": { route: "/api/agent/new", methods: ["POST"] },
  "src/routes/api/agent/running/events.ts": { route: "/api/agent/running/events", methods: ["GET"] },
  "src/routes/api/agent/running.ts": { route: "/api/agent/running", methods: ["GET"] },
  "src/routes/api/app-update.ts": { route: "/api/app-update", methods: ["GET"] },
  "src/routes/api/auth/all-providers.ts": { route: "/api/auth/all-providers", methods: ["GET"] },
  "src/routes/api/auth/api-key/$provider.ts": { route: "/api/auth/api-key/$provider", methods: ["DELETE", "GET", "POST"] },
  "src/routes/api/auth/login/$provider.ts": { route: "/api/auth/login/$provider", methods: ["GET", "POST"] },
  "src/routes/api/auth/logout/$provider.ts": { route: "/api/auth/logout/$provider", methods: ["POST"] },
  "src/routes/api/auth/providers.ts": { route: "/api/auth/providers", methods: ["GET"] },
  "src/routes/api/cwd/browse.ts": { route: "/api/cwd/browse", methods: ["GET", "POST"] },
  "src/routes/api/cwd/validate.ts": { route: "/api/cwd/validate", methods: ["POST"] },
  "src/routes/api/default-cwd.ts": { route: "/api/default-cwd", methods: ["POST"] },
  "src/routes/api/file-index.ts": { route: "/api/file-index", methods: ["GET"] },
  "src/routes/api/files/$.ts": { route: "/api/files/$", methods: ["GET", "POST"] },
  "src/routes/api/git/diff.ts": { route: "/api/git/diff", methods: ["GET"] },
  "src/routes/api/git/status.ts": { route: "/api/git/status", methods: ["GET"] },
  "src/routes/api/home.ts": { route: "/api/home", methods: ["GET"] },
  "src/routes/api/models-config/catalog.ts": { route: "/api/models-config/catalog", methods: ["GET"] },
  "src/routes/api/models-config/discover.ts": { route: "/api/models-config/discover", methods: ["POST"] },
  "src/routes/api/models-config.ts": { route: "/api/models-config", methods: ["GET", "PUT"] },
  "src/routes/api/models-config/test.ts": { route: "/api/models-config/test", methods: ["POST"] },
  "src/routes/api/models.ts": { route: "/api/models", methods: ["GET"] },
  "src/routes/api/plugins.ts": { route: "/api/plugins", methods: ["GET", "POST"] },
  "src/routes/api/project-trust.ts": { route: "/api/project-trust", methods: ["GET", "POST"] },
  "src/routes/api/projects.ts": { route: "/api/projects", methods: ["GET", "PATCH", "PUT"] },
  "src/routes/api/remote-access.ts": { route: "/api/remote-access", methods: ["GET", "PUT"] },
  "src/routes/api/sessions/$id/auto-name.ts": { route: "/api/sessions/$id/auto-name", methods: ["POST"] },
  "src/routes/api/sessions/$id/context.ts": { route: "/api/sessions/$id/context", methods: ["GET"] },
  "src/routes/api/sessions/$id/entries/$entryId/thinking.ts": { route: "/api/sessions/$id/entries/$entryId/thinking", methods: ["GET"] },
  "src/routes/api/sessions/$id/entries/$entryId/tool-result.ts": { route: "/api/sessions/$id/entries/$entryId/tool-result", methods: ["GET"] },
  "src/routes/api/sessions/$id/export.ts": { route: "/api/sessions/$id/export", methods: ["GET"] },
  "src/routes/api/sessions/$id.ts": { route: "/api/sessions/$id", methods: ["DELETE", "GET", "PATCH"] },
  "src/routes/api/sessions/$id/state.ts": { route: "/api/sessions/$id/state", methods: ["GET"] },
  "src/routes/api/sessions.ts": { route: "/api/sessions", methods: ["GET"] },
  "src/routes/api/skills/check.ts": { route: "/api/skills/check", methods: ["POST"] },
  "src/routes/api/skills/install.ts": { route: "/api/skills/install", methods: ["POST"] },
  "src/routes/api/skills.ts": { route: "/api/skills", methods: ["GET", "PATCH"] },
  "src/routes/api/skills/search.ts": { route: "/api/skills/search", methods: ["POST"] },
  "src/routes/api/skills/update.ts": { route: "/api/skills/update", methods: ["POST"] },
  "src/routes/api/ui-locale.ts": { route: "/api/ui-locale", methods: ["GET", "PUT"] },
  "src/routes/api/vision-toolkit.ts": { route: "/api/vision-toolkit", methods: ["GET", "PUT"] },
  "src/routes/api/vision-toolkit/health.ts": { route: "/api/vision-toolkit/health", methods: ["POST"] },
  "src/routes/api/vision-toolkit/reveal.ts": { route: "/api/vision-toolkit/reveal", methods: ["POST"] },
  "src/routes/api/worktrees.ts": { route: "/api/worktrees", methods: ["DELETE", "GET", "POST"] },
};

test("every API handler has a thin TanStack adapter with the expected route and methods", async () => {
  assert.equal(Object.keys(EXPECTED_ADAPTERS).length, 48);
  for (const [file, expected] of Object.entries(EXPECTED_ADAPTERS)) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.ok(source.includes(`createFileRoute(${JSON.stringify(expected.route)})`), file);
    for (const method of expected.methods) {
      assert.match(source, new RegExp(`\\b${method}:`), `${file} ${method}`);
    }
  }
});

async function filesNamedRoute(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesNamedRoute(path);
    return entry.name === "route.ts" ? [relative(ROOT, path)] : [];
  }));
  return nested.flat().sort();
}

test("the internal API inventory contains exactly the expected 48 routes", async () => {
  const actual = await filesNamedRoute(join(ROOT, "app", "api"));
  assert.equal(actual.length, 48);
  assert.deepEqual(actual, Object.keys(EXPECTED_ROUTES).sort());
});

test("every internal API handler uses standard Web APIs and exports the expected methods", async () => {
  for (const [file, expectedMethods] of Object.entries(EXPECTED_ROUTES)) {
    const source = await readFile(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /from ["']next\/server["']/, file);
    assert.doesNotMatch(source, /\bNextRequest\b|\bNextResponse\b|\.nextUrl\b/, file);
    const methods = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)/gm)]
      .map((match) => match[1]);
    assert.deepEqual(methods.sort(), [...expectedMethods].sort(), file);
  }
});

test("the runtime method guard stays in sync with the adapter inventory", async () => {
  const { API_ROUTE_METHODS, matchApiRoutePattern } = await jiti.import("../src/api-methods.ts");
  assert.equal(Object.keys(API_ROUTE_METHODS).length, Object.keys(EXPECTED_ADAPTERS).length);
  for (const [file, expected] of Object.entries(EXPECTED_ADAPTERS)) {
    assert.deepEqual(
      [...API_ROUTE_METHODS[expected.route]].sort(),
      [...expected.methods].sort(),
      expected.route,
    );
  }
  // Pattern matcher: single-segment params, splat, and literal segments.
  assert.equal(matchApiRoutePattern("/api/agent/$id/events", "/api/agent/abc/events"), true);
  assert.equal(matchApiRoutePattern("/api/agent/$id/events", "/api/agent/abc/events/x"), false);
  assert.equal(matchApiRoutePattern("/api/files/$", "/api/files/a/b/c"), true);
  assert.equal(matchApiRoutePattern("/api/files/$", "/api/files"), false);
  assert.equal(matchApiRoutePattern("/api/sessions", "/api/sessions/abc"), false);
});

test("the shared route smoke covers every adapter URL", async () => {
  const smokeSource = await readFile(join(ROOT, "scripts", "tanstack-route-smoke.mjs"), "utf8");
  const routePattern = (route) => new RegExp(route
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "$") return "[^\"'`]*";
      if (segment.startsWith("$")) return "[^\"'`/]*";
      return segment;
    })
    .join("/"));
  for (const [file, expected] of Object.entries(EXPECTED_ADAPTERS)) {
    assert.match(smokeSource, routePattern(expected.route), `${file} (${expected.route}) missing from route smoke`);
  }
});
